// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISettlementRouter} from 'cap-table/interfaces/ISettlementRouter.sol';
import {IContinuousClearingAuction} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol';
import {IKyc} from 'cap-table/ats/IKyc.sol';
import {IERC20} from 'cap-table/ats/IERC20.sol';
import {IHoldByPartition} from 'cap-table/ats/IHoldByPartition.sol';
import {AtsBalance} from 'cap-table/AtsBalance.sol';

/// @title SettlementRouter
/// @notice The only permitted bid submitter for a Cap Table auction. It holds
///         beneficial-ownership records, converts CCA's raw token distribution
///         into ATS hold-based DvP settlement, and refunds bidders whose
///         eligibility lapsed between bidding and claiming.
contract SettlementRouter is ISettlementRouter {
    uint8 internal constant STATE_NONE = 0;
    uint8 internal constant STATE_PLACED = 1;
    uint8 internal constant STATE_EXITED = 2;
    uint8 internal constant STATE_CLAIMABLE = 3;
    uint8 internal constant STATE_HELD = 4;
    uint8 internal constant STATE_SETTLED = 5;
    uint8 internal constant STATE_HOLD_EXPIRED = 6;
    uint8 internal constant STATE_REFUNDED_INELIGIBLE = 7;

    struct Bid {
        address beneficiary;
        uint128 amount;
        uint256 maxPriceQ96;
        uint128 tokensFilled;
        uint64 placedBlock;
        uint64 settledBlock;
        bytes32 lockHash;
        uint256 holdId;
        uint8 state;
    }

    address public AUCTION;
    address public immutable BOND;
    // The deployed ATS uses bytes32(1) as its default partition (see
    // `constants/values.sol` `_DEFAULT_PARTITION`), NOT bytes32(0).
    bytes32 public constant DEFAULT_PARTITION = bytes32(uint256(1));

    address public owner;
    bool internal _auctionSet;

    bytes32 internal constant SALT = 0x6361707461626c65000000000000000000000000000000000000000000000000;

    mapping(uint256 bidId => Bid) public bids;
    mapping(address beneficiary => uint256) public pendingAmount;
    mapping(address beneficiary => bool) public isPendingBeneficiary;
    uint256 public pendingNewBeneficiaries;
    uint256 public settlementReserve;
    uint256 public nonce;

    constructor(address auction, address bond) {
        AUCTION = auction;
        BOND = bond;
        owner = msg.sender;
        if (auction != address(0)) _auctionSet = true;
    }

    /// @dev CCA's `exitBid` refunds unused currency to the bid owner (this router).
    ///      Without a payable receive, that refund reverts NativeTransferFailed.
    receive() external payable {}

    /// @notice The auction address depends on the hook, whose address depends on
    ///         the router; the deploy script resolves the cycle by deploying both
    ///         with a zero placeholder and calling this once after prediction.
    function setAuction(address auction) external {
        require(msg.sender == owner, 'NOT_OWNER');
        require(!_auctionSet, 'ALREADY_SET');
        require(auction != address(0), 'ZERO_AUCTION');
        AUCTION = auction;
        _auctionSet = true;
    }

    // ------------------------------------------------------------------
    // Bid lifecycle
    // ------------------------------------------------------------------

    /// @inheritdoc ISettlementRouter
    function placeBid(uint256 maxPriceQ96, uint128 amount, uint256 prevTickPriceQ96)
        external
        payable
        returns (uint256 bidId)
    {
        if (msg.value != amount) revert IncorrectValue();

        // The holder-count projection must see this bid *before* submitBid so
        // concurrent new beneficiaries race correctly (§7.1). The ownership
        // projection is written after submitBid (see below) to avoid
        // double-counting the current bid, which the hook adds via `+ amount`.
        // Total (available + held + locked) matters: a fully-held holder is an
        // existing beneficiary and must not be counted again as a new one (F-13).
        if (!isPendingBeneficiary[msg.sender] && AtsBalance.totalOf(BOND, msg.sender) == 0) {
            isPendingBeneficiary[msg.sender] = true;
            pendingNewBeneficiaries++;
        }

        bytes memory hookData = abi.encode(msg.sender, _nextNonce());
        // Use the 4-arg submitBid overload, which supplies the floor price as the
        // previous-tick hint. A zero hint would revert `TickPreviousPriceInvalid`.
        bidId = IContinuousClearingAuction(AUCTION).submitBid{value: amount}(
            maxPriceQ96, amount, address(this), hookData
        );

        // Ownership pending is recorded after a successful submit. The hook's
        // ownership projection reads `pendingAmountFor` (prior bids only) plus the
        // current `amount`, so writing it now keeps the two consistent.
        pendingAmount[msg.sender] += amount;

        bids[bidId] = Bid({
            beneficiary: msg.sender,
            amount: amount,
            maxPriceQ96: maxPriceQ96,
            tokensFilled: 0,
            placedBlock: uint64(block.number),
            settledBlock: 0,
            lockHash: bytes32(0),
            holdId: 0,
            state: STATE_PLACED
        });

        emit BidPlaced(bidId, msg.sender, maxPriceQ96, amount);
    }

    /// @inheritdoc ISettlementRouter
    /// @dev Full refund path for a non-graduated auction. CCA's `exitBid` refunds
    ///      the entire bid amount to `owner` (this router), which is then forwarded.
    function exitBid(uint256 bidId) external {
        Bid storage b = _getBid(bidId);
        _requireBeneficiary(b, msg.sender);
        _transition(b, STATE_PLACED, STATE_EXITED);

        uint256 beforeNative = address(this).balance;
        IContinuousClearingAuction(AUCTION).exitBid(bidId);
        uint256 refund = address(this).balance - beforeNative;

        _decrementPending(b.beneficiary, b.amount);

        if (refund > 0) _sendNative(b.beneficiary, refund);
    }

    /// @inheritdoc ISettlementRouter
    /// @dev Settles a bid after `claimBlock` for a graduated auction.
    function settle(uint256 bidId) external {
        Bid storage b = _getBid(bidId);
        if (b.state == STATE_SETTLED || b.state == STATE_REFUNDED_INELIGIBLE) revert AlreadySettled();
        _transition(b, STATE_PLACED, STATE_CLAIMABLE);

        // beforeBond/tokensFilled measure a delta from `claimTokens`, which is a raw
        // transfer into AVAILABLE balance — correct as-is, not a total-balance probe.
        uint256 beforeBond = IERC20(BOND).balanceOf(address(this));
        uint256 beforeNative = address(this).balance;

        // The real CCA requires a bid to be exited before its tokens can be claimed.
        // `exitBid` computes the fill and refunds unused currency to the owner (the router).
        IContinuousClearingAuction(AUCTION).exitBid(bidId);
        IContinuousClearingAuction(AUCTION).claimTokens(bidId);

        uint256 tokensFilled = IERC20(BOND).balanceOf(address(this)) - beforeBond;
        uint256 currencyRefund = address(this).balance - beforeNative;

        b.tokensFilled = uint128(tokensFilled);
        b.settledBlock = uint64(block.number);

        if (_isEligible(b.beneficiary, tokensFilled)) {
            _createDvpHold(bidId, b, tokensFilled);
            _transition(b, STATE_CLAIMABLE, STATE_HELD);
            emit Settled(bidId, b.beneficiary, uint128(tokensFilled), STATE_HELD);
        } else {
            _refundIneligible(bidId, b, tokensFilled);
            _transition(b, STATE_CLAIMABLE, STATE_REFUNDED_INELIGIBLE);
            emit Settled(bidId, b.beneficiary, uint128(tokensFilled), STATE_REFUNDED_INELIGIBLE);
        }

        _decrementPending(b.beneficiary, b.amount);

        if (currencyRefund > 0) _sendNative(b.beneficiary, currencyRefund);
    }

    /// @inheritdoc ISettlementRouter
    /// @dev Reveals the DvP secret and executes the ATS hold.
    function executeHold(uint256 bidId, bytes32 secret) external {
        Bid storage b = _getBid(bidId);
        _requireBeneficiary(b, msg.sender);
        if (b.lockHash != keccak256(abi.encode(secret))) revert('WRONG_SECRET');
        _transition(b, STATE_HELD, STATE_SETTLED);

        IHoldByPartition.HoldIdentifier memory id = IHoldByPartition.HoldIdentifier({
            partition: DEFAULT_PARTITION,
            tokenHolder: address(this),
            holdId: b.holdId
        });
        IHoldByPartition(BOND).executeHoldByPartition(id, b.beneficiary, b.tokensFilled);
    }

    /// @inheritdoc ISettlementRouter
    function fundReserve() external payable {
        settlementReserve += msg.value;
    }

    // ------------------------------------------------------------------
    // Views consumed by the validation hook
    // ------------------------------------------------------------------

    function pendingAmountFor(address beneficiary) external view returns (uint256) {
        return pendingAmount[beneficiary];
    }

    function pendingNewBeneficiaryCount() external view returns (uint256) {
        return pendingNewBeneficiaries;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _nextNonce() internal returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encodePacked(nonce++, block.chainid, msg.sender))));
    }

    function _getBid(uint256 bidId) internal view returns (Bid storage) {
        Bid storage b = bids[bidId];
        if (b.beneficiary == address(0)) revert BidDoesNotExist(bidId);
        return b;
    }

    function _requireBeneficiary(Bid storage b, address caller) internal view {
        require(caller == b.beneficiary, 'NOT_BENEFICIARY');
    }

    function _transition(Bid storage b, uint8 from, uint8 to) internal {
        if (b.state != from) revert InvalidStateTransition(b.state, to);
        b.state = to;
    }

    function _decrementPending(address beneficiary, uint256 amount) internal {
        if (pendingAmount[beneficiary] <= amount) {
            pendingAmount[beneficiary] = 0;
            if (isPendingBeneficiary[beneficiary]) {
                isPendingBeneficiary[beneficiary] = false;
                pendingNewBeneficiaries--;
            }
        } else {
            pendingAmount[beneficiary] -= amount;
        }
    }

    function _isEligible(address beneficiary, uint256 tokensFilled) internal view returns (bool) {
        if (IKyc(BOND).getKycStatusFor(beneficiary) != IKyc.KycStatus.GRANTED) return false;
        if (_isBlocked(beneficiary)) return false;
        address compliance = _complianceOf();
        if (compliance == address(0)) return true;
        (bool ok, bytes memory data) =
            compliance.staticcall(abi.encodeWithSignature('canTransfer(address,address,uint256)', address(this), beneficiary, tokensFilled));
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    function _isBlocked(address account) internal view returns (bool) {
        (bool okList, bytes memory listData) = BOND.staticcall(abi.encodeWithSignature('getControlListType()'));
        (bool okIn, bytes memory inData) =
            BOND.staticcall(abi.encodeWithSignature('isInControlList(address)', account));
        bool isWhiteList = okList && listData.length >= 32 && abi.decode(listData, (bool));
        bool inList = okIn && inData.length >= 32 && abi.decode(inData, (bool));
        return isWhiteList ? !inList : inList;
    }

    function _complianceOf() internal view returns (address) {
        (bool ok, bytes memory data) = BOND.staticcall(abi.encodeWithSignature('compliance()'));
        if (ok && data.length >= 32) return abi.decode(data, (address));
        return address(0);
    }

    function _createDvpHold(uint256 bidId, Bid storage b, uint256 tokensFilled) internal {
        bytes32 secret = keccak256(abi.encode(b.beneficiary, tokensFilled, block.chainid, SALT));
        bytes32 lockHash = keccak256(abi.encode(secret));

        IHoldByPartition.Hold memory hold = IHoldByPartition.Hold({
            amount: tokensFilled,
            expirationTimestamp: block.timestamp + 7 days,
            escrow: address(this),
            to: b.beneficiary,
            data: abi.encode(lockHash)
        });

        (bool ok, uint256 holdId) = IHoldByPartition(BOND).createHoldByPartition(DEFAULT_PARTITION, hold);
        require(ok, 'HOLD_CREATE_FAILED');

        b.lockHash = lockHash;
        b.holdId = holdId;

        emit HoldCreated(bidId, holdId, lockHash, hold.expirationTimestamp);
    }

    function _refundIneligible(uint256 bidId, Bid storage b, uint256 tokensFilled) internal {
        uint256 clearingPriceQ96 = IContinuousClearingAuction(AUCTION).clearingPrice();
        uint256 refundValue = tokensFilled * clearingPriceQ96 >> 96;

        if (refundValue > settlementReserve) revert ReserveUnderfunded(refundValue, settlementReserve);
        settlementReserve -= refundValue;

        // Return the unclaimable tokens to the seller.
        address tokensRecipient = IContinuousClearingAuction(AUCTION).tokensRecipient();
        require(IERC20(BOND).transfer(tokensRecipient, tokensFilled), 'TOKEN_RETURN_FAILED');

        _sendNative(b.beneficiary, refundValue);

        emit RefundedIneligible(bidId, b.beneficiary, uint128(tokensFilled), refundValue);
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}('');
        require(ok, 'NATIVE_TRANSFER_FAILED');
    }
}
