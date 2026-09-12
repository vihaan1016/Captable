// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IValidationHook} from 'cap-table/interfaces/IValidationHook.sol';
import {ISettlementRouter} from 'cap-table/interfaces/ISettlementRouter.sol';
import {IKyc} from 'cap-table/ats/IKyc.sol';
import {IControlList} from 'cap-table/ats/IControlList.sol';
import {ICompliance} from 'cap-table/ats/ICompliance.sol';
import {ISecurityHolders} from 'cap-table/ats/ISecurityHolders.sol';
import {IERC20} from 'cap-table/ats/IERC20.sol';
import {IAggregatorV3} from 'cap-table/interfaces/IAggregatorV3.sol';
import {AtsBalance} from 'cap-table/AtsBalance.sol';

/// @title CapTableValidationHook
/// @notice The register-projection validation hook for a CCA auction.
/// @dev Instead of asking "may this address hold the token", it asks "if this bid fills
///      to its worst case, does the resulting shareholder register still satisfy the issuer's
///      compliance rules?" Pending state lives in the SettlementRouter, which writes it before
///      calling submitBid and rolls it back on revert.
contract CapTableValidationHook is IValidationHook {
    error DirectBidsNotPermitted();
    error ZeroBeneficialOwner();
    error BidderNotKycGranted(address beneficialOwner);
    error BidderBlocked(address beneficialOwner);
    error TransferWouldFailCompliance(address beneficialOwner, uint256 amount);
    error WouldExceedMaxInvestors(uint256 projected, uint256 max);
    error WouldExceedMaxOwnership(uint256 projectedBps, uint256 maxBps);
    error PriceOutsideNavBand(uint256 maxPrice, uint256 lo, uint256 hi);
    error BidBelowMinimum(uint256 amount, uint256 minBid);

    event NavFeedStale(uint256 updatedAt);

    address public AUCTION;
    address public immutable BOND;
    address public immutable SETTLEMENT_ROUTER;
    address public immutable KYC;
    address public immutable CONTROL_LIST;
    address public immutable COMPLIANCE;
    address public immutable SECURITY_HOLDERS;
    address public immutable AGGREGATOR;

    uint256 public immutable MIN_BID;
    uint256 public bandBps;
    uint256 public maxStaleness;

    // §6.5: cached at construction. The register projection re-reads only the
    // mutable holder count; these two are stable for the life of the demo.
    uint256 public immutable MAX_INVESTORS;
    uint256 public immutable MAX_OWNERSHIP_BPS;

    address public owner;
    bool internal _auctionSet;

    bytes4 internal constant REASON_OK = 0x00000000;

    /// @notice Custom-error selectors for previewValidate return. These are the
    ///         real typed-error selectors so the web app and the revert path agree.
    bytes4 internal constant SEL_DIRECT = 0x09770986;
    bytes4 internal constant SEL_ZERO = 0xc78bc3cb;
    bytes4 internal constant SEL_KYC = 0xff3c09d5;
    bytes4 internal constant SEL_BLOCKED = 0xa608dbef;
    bytes4 internal constant SEL_COMPLIANCE = 0xaebf4ec4;
    bytes4 internal constant SEL_MAX_INVESTORS = 0xf94e2d7c;
    bytes4 internal constant SEL_MAX_OWNERSHIP = 0x840308b8;
    bytes4 internal constant SEL_NAV = 0xf08edadc;
    bytes4 internal constant SEL_MIN_BID = 0xf7ea5440;

    constructor(
        address auction,
        address bond,
        address settlementRouter,
        address kyc,
        address controlList,
        address compliance,
        address securityHolders,
        address aggregator,
        uint256 minBid,
        uint256 _bandBps,
        uint256 _maxStaleness
    ) {
        AUCTION = auction;
        BOND = bond;
        SETTLEMENT_ROUTER = settlementRouter;
        KYC = kyc;
        CONTROL_LIST = controlList;
        COMPLIANCE = compliance;
        SECURITY_HOLDERS = securityHolders;
        AGGREGATOR = aggregator;
        MIN_BID = minBid;
        bandBps = _bandBps;
        maxStaleness = _maxStaleness;
        owner = msg.sender;
        if (auction != address(0)) _auctionSet = true;

        // Cache stable compliance values once (§6.5) to keep the bid path under
        // the 400k gas budget. The holder count is still read live.
        MAX_INVESTORS = _readComplianceUint('maxInvestors()');
        MAX_OWNERSHIP_BPS = _readComplianceUint('maxOwnershipBps()');
    }

    /// @notice The auction address is part of the CREATE2 salt the factory uses,
    ///         which creates a circular dependency between the hook and the
    ///         counterfactual auction. The deploy script therefore deploys with a
    ///         zero placeholder and calls this exactly once after prediction.
    function setAuction(address auction) external {
        require(msg.sender == owner, 'NOT_OWNER');
        require(!_auctionSet, 'ALREADY_SET');
        require(auction != address(0), 'ZERO_AUCTION');
        AUCTION = auction;
        _auctionSet = true;
    }

    function setBandBps(uint256 _bandBps) external {
        require(msg.sender == owner, 'NOT_OWNER');
        require(_bandBps <= 10_000, 'BAND_TOO_LARGE');
        bandBps = _bandBps;
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, 'NOT_OWNER');
        maxStaleness = _maxStaleness;
    }

    /// @inheritdoc IValidationHook
    /// @dev MUST revert to reject. `owner` is always the router; `beneficialOwner`
    ///      is decoded from `hookData`.
    function validate(uint256 maxPrice, uint128 amount, address, address sender, bytes calldata hookData)
        external
    {
        (address beneficialOwner,) = abi.decode(hookData, (address, bytes32));

        _runChecks(maxPrice, amount, beneficialOwner, sender);
    }

    /// @notice Identical logic as `validate` but returns `(ok, reason)` without reverting.
    function previewValidate(uint256 maxPrice, uint128 amount, address beneficialOwner)
        external
        view
        returns (bool ok, bytes4 reason)
    {
        return _previewChecks(maxPrice, amount, beneficialOwner);
    }

    /// @notice Current register state used by the web app.
    function registerState() external view returns (uint256 holders, uint256 maxInvestors, uint256 largestBps, uint256 maxOwnershipBps) {
        holders = ISecurityHolders(SECURITY_HOLDERS).getTotalSecurityHolders();
        maxInvestors = MAX_INVESTORS;
        largestBps = _largestHolderBps();
        maxOwnershipBps = MAX_OWNERSHIP_BPS;
    }

    // ------------------------------------------------------------------
    // Internal validation — single source of truth for both paths.
    // ------------------------------------------------------------------

    function _runChecks(uint256 maxPrice, uint128 amount, address beneficialOwner, address sender) internal {
        if (sender != SETTLEMENT_ROUTER) revert DirectBidsNotPermitted();
        if (beneficialOwner == address(0)) revert ZeroBeneficialOwner();
        if (amount < MIN_BID) revert BidBelowMinimum(amount, MIN_BID);
        if (IKyc(KYC).getKycStatusFor(beneficialOwner) != IKyc.KycStatus.GRANTED) {
            revert BidderNotKycGranted(beneficialOwner);
        }
        if (_isBlocked(beneficialOwner)) revert BidderBlocked(beneficialOwner);
        if (!ICompliance(COMPLIANCE).canTransfer(AUCTION, beneficialOwner, amount)) {
            revert TransferWouldFailCompliance(beneficialOwner, amount);
        }

        ISettlementRouter router = ISettlementRouter(SETTLEMENT_ROUTER);
        uint256 currentHolders = ISecurityHolders(SECURITY_HOLDERS).getTotalSecurityHolders();
        uint256 maxInvestors = MAX_INVESTORS;
        bool isExistingHolder = AtsBalance.totalOf(BOND, beneficialOwner) > 0
            || router.isPendingBeneficiary(beneficialOwner);
        uint256 projectedHolders = currentHolders + (isExistingHolder ? 0 : 1) + router.pendingNewBeneficiaryCount();
        if (projectedHolders > maxInvestors) revert WouldExceedMaxInvestors(projectedHolders, maxInvestors);

        uint256 projectedBalance =
            AtsBalance.totalOf(BOND, beneficialOwner) + router.pendingAmountFor(beneficialOwner) + amount;
        uint256 projectedBps = projectedBalance * 10_000 / IERC20(BOND).totalSupply();
        uint256 maxOwnershipBps = MAX_OWNERSHIP_BPS;
        if (projectedBps > maxOwnershipBps) revert WouldExceedMaxOwnership(projectedBps, maxOwnershipBps);

        _checkNavBand(maxPrice);
    }

    function _previewChecks(uint256 maxPrice, uint128 amount, address beneficialOwner)
        internal
        view
        returns (bool ok, bytes4 reason)
    {
        if (beneficialOwner == address(0)) return (false, SEL_ZERO);
        if (amount < MIN_BID) return (false, SEL_MIN_BID);
        if (IKyc(KYC).getKycStatusFor(beneficialOwner) != IKyc.KycStatus.GRANTED) {
            return (false, SEL_KYC);
        }
        if (_isBlocked(beneficialOwner)) return (false, SEL_BLOCKED);
        if (!ICompliance(COMPLIANCE).canTransfer(AUCTION, beneficialOwner, amount)) {
            return (false, SEL_COMPLIANCE);
        }

        ISettlementRouter router = ISettlementRouter(SETTLEMENT_ROUTER);
        uint256 currentHolders = ISecurityHolders(SECURITY_HOLDERS).getTotalSecurityHolders();
        uint256 maxInvestors = MAX_INVESTORS;
        bool isExistingHolder = AtsBalance.totalOf(BOND, beneficialOwner) > 0
            || router.isPendingBeneficiary(beneficialOwner);
        uint256 projectedHolders = currentHolders + (isExistingHolder ? 0 : 1) + router.pendingNewBeneficiaryCount();
        if (projectedHolders > maxInvestors) return (false, SEL_MAX_INVESTORS);

        uint256 projectedBalance =
            AtsBalance.totalOf(BOND, beneficialOwner) + router.pendingAmountFor(beneficialOwner) + amount;
        uint256 projectedBps = projectedBalance * 10_000 / IERC20(BOND).totalSupply();
        uint256 maxOwnershipBps = MAX_OWNERSHIP_BPS;
        if (projectedBps > maxOwnershipBps) return (false, SEL_MAX_OWNERSHIP);

        (bool navOk,,) = _navBandView(maxPrice);
        if (!navOk) return (false, SEL_NAV);

        return (true, REASON_OK);
    }

    function _checkNavBand(uint256 maxPrice) internal {
        (bool ok, uint256 lo, uint256 hi) = _navBand(maxPrice);
        if (!ok) revert PriceOutsideNavBand(maxPrice, lo, hi);
    }

    function _navBand(uint256 maxPrice) internal returns (bool ok, uint256 lo, uint256 hi) {
        if (AGGREGATOR == address(0)) return (true, 0, 0);

        // A reverting or gas-griefing aggregator must never brick the bid path.
        (bool success, bytes memory data) =
            AGGREGATOR.staticcall{gas: 50_000}(abi.encodeCall(IAggregatorV3.latestRoundData, ()));
        if (!success) {
            emit NavFeedStale(0);
            return (true, 0, 0);
        }

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        if (answer <= 0 || roundId == 0 || answeredInRound < roundId || updatedAt == 0) {
            emit NavFeedStale(updatedAt);
            return (true, 0, 0);
        }
        if (block.timestamp > updatedAt + maxStaleness) {
            emit NavFeedStale(updatedAt);
            return (true, 0, 0);
        }

        return _bandFromAnswer(uint256(answer), maxPrice);
    }

    /// @notice View-safe band check used by `previewValidate`; never emits.
    function _navBandView(uint256 maxPrice) internal view returns (bool ok, uint256 lo, uint256 hi) {
        if (AGGREGATOR == address(0)) return (true, 0, 0);

        (bool success, bytes memory data) =
            AGGREGATOR.staticcall(abi.encodeCall(IAggregatorV3.latestRoundData, ()));
        if (!success) return (true, 0, 0);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        if (answer <= 0 || roundId == 0 || answeredInRound < roundId || updatedAt == 0) {
            return (true, 0, 0);
        }
        if (block.timestamp > updatedAt + maxStaleness) return (true, 0, 0);

        return _bandFromAnswer(uint256(answer), maxPrice);
    }

    function _bandFromAnswer(uint256 nav, uint256 maxPrice) internal view returns (bool ok, uint256 lo, uint256 hi) {
        uint256 navQ96 = nav << 96;
        lo = navQ96 * (10_000 - bandBps) / 10_000;
        hi = navQ96 * (10_000 + bandBps) / 10_000;
        ok = maxPrice >= lo && maxPrice <= hi;
    }

    function _isBlocked(address account) internal view returns (bool) {
        // `getControlListType()` returns true when the list operates as a whitelist.
        // `isInControlList()` returns raw membership.
        bool isWhiteList = IControlList(CONTROL_LIST).getControlListType();
        bool inList = IControlList(CONTROL_LIST).isInControlList(account);
        return isWhiteList ? !inList : inList;
    }

    function _maxInvestors() internal view returns (uint256) {
        return MAX_INVESTORS;
    }

    function _maxOwnershipBps() internal view returns (uint256) {
        return MAX_OWNERSHIP_BPS;
    }

    /// @dev Cached at construction (§6.5). Treat a missing getter as "unlimited".
    function _readComplianceUint(string memory sig) internal view returns (uint256) {
        (bool ok, bytes memory data) = COMPLIANCE.staticcall(abi.encodeWithSignature(sig));
        if (ok && data.length >= 32) return abi.decode(data, (uint256));
        return type(uint256).max;
    }

    function _largestHolderBps() internal view returns (uint256) {
        // This is an unbounded scan and is only called by the off-chain read path via
        // `registerState`, never inside the bid path. The bid path uses the cached
        // compliance caps above.
        uint256 total = IERC20(BOND).totalSupply();
        if (total == 0) return 0;
        uint256 count = ISecurityHolders(SECURITY_HOLDERS).getTotalSecurityHolders();
        uint256 pageLength = 500;
        uint256 pages = (count + pageLength - 1) / pageLength;
        uint256 largest;
        for (uint256 p = 0; p < pages; p++) {
            address[] memory holders = ISecurityHolders(SECURITY_HOLDERS).getSecurityHolders(p, pageLength);
            for (uint256 i = 0; i < holders.length; i++) {
                uint256 bps = IERC20(BOND).balanceOf(holders[i]) * 10_000 / total;
                if (bps > largest) largest = bps;
            }
        }
        return largest;
    }
}
