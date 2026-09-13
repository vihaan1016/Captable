// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script} from 'forge-std/Script.sol';
import {console2} from 'forge-std/console2.sol';
import {stdJson} from 'forge-std/StdJson.sol';

import {Isin} from 'cap-table/Isin.sol';
import {PriceQ96} from 'cap-table/PriceQ96.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {SettlementRouter} from 'cap-table/SettlementRouter.sol';
import {CapTableComplianceModule} from 'cap-table/CapTableComplianceModule.sol';
import {MockV3Aggregator} from 'cap-table/MockV3Aggregator.sol';

import {IAtsFactory} from 'cap-table/ats/IAtsFactory.sol';
import {IAccessControl} from 'cap-table/ats/IAccessControl.sol';
import {ISsiManagement} from 'cap-table/ats/ISsiManagement.sol';
import {IKyc} from 'cap-table/ats/IKyc.sol';
import {IMint} from 'cap-table/ats/IMint.sol';
import {IComplianceFacet} from 'cap-table/ats/IComplianceFacet.sol';
import {AtsRoles} from 'cap-table/ats/AtsRoles.sol';

import {ContinuousClearingAuctionFactory} from
    'continuous-clearing-auction/ContinuousClearingAuctionFactory.sol';
import {AuctionParameters, IContinuousClearingAuction} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol';
import {IContinuousClearingAuctionFactory} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuctionFactory.sol';

/// @title DeployCapTable
/// @notice Idempotent issuance + KYC + auction creation for the Cap Table demo.
/// @dev State lives in deployments/hedera-testnet.json; each step checks for its
///      own completion marker and logs SKIP or EXEC. Transactions are broadcast
///      with `vm.startBroadcast`; run with `--broadcast --private-key`.
contract DeployCapTable is Script {
    using stdJson for string;
    using PriceQ96 for uint256;

    uint24 internal constant MPS = 1e7;
    uint256 internal constant Q96 = 2 ** 96;

    string internal statePath = 'deployments/hedera-testnet.json';
    string internal json;
    // forge-std's serialize keeps an in-memory accumulator keyed by a stable
    // object name. Reusing `json` as that key resets the accumulator every call,
    // so only the last `_set` survives. Keep the read buffer and write buffer
    // separate and seed the write accumulator once from the file contents.
    string internal stateObj = 'cap-table-state';
    string internal serialized;

    address internal ATS_FACTORY;
    address internal BLR_PROXY;
    address internal deployer;
    address internal seller;

    // Config.
    string internal countryCode;
    string internal nsin;
    string internal bondName;
    string internal bondSymbol;
    uint8 internal bondDecimals;
    uint256 internal nominalValue;
    uint8 internal nominalValueDecimals;
    uint256 internal maturityDaysOut;
    uint256 internal totalSupplyRaw;
    uint256 internal maxInvestors;
    uint256 internal maxOwnershipBps;
    uint256 internal tickSpacingBps;
    uint256 internal navDiscountBps;
    uint256 internal reserveRatioBps;
    uint256 internal navDefaultCents;

    uint64 internal startDelta;
    uint64 internal endDelta;
    uint64 internal claimDelta;
    uint256 internal auctionScale;
    bytes32 internal auctionSalt;

    function setUp() public {
        ATS_FACTORY = vm.envAddress('ATS_FACTORY');
        BLR_PROXY = vm.envAddress('BLR_PROXY');
        deployer = vm.addr(vm.envUint('DEPLOYER_PRIVATE_KEY'));
        seller = deployer;

        string memory cfg = vm.readFile('contracts/config/bond.testnet.json');
        countryCode = vm.parseJsonString(cfg, '.countryCode');
        nsin = vm.parseJsonString(cfg, '.nsin');
        bondName = vm.parseJsonString(cfg, '.bond.name');
        bondSymbol = vm.parseJsonString(cfg, '.bond.symbol');
        bondDecimals = uint8(vm.parseJsonUint(cfg, '.bond.decimals'));
        nominalValue = vm.parseJsonUint(cfg, '.bond.nominalValue');
        nominalValueDecimals = uint8(vm.parseJsonUint(cfg, '.bond.nominalValueDecimals'));
        maturityDaysOut = vm.parseJsonUint(cfg, '.bond.maturityDaysOut');
        totalSupplyRaw = vm.parseJsonUint(cfg, '.bond.totalSupply');
        maxInvestors = vm.parseJsonUint(cfg, '.compliance.maxInvestors');
        maxOwnershipBps = vm.parseJsonUint(cfg, '.compliance.maxOwnershipBps');
        tickSpacingBps = vm.parseJsonUint(cfg, '.auction.tickSpacingBps');
        navDiscountBps = vm.parseJsonUint(cfg, '.auction.navDiscountBps');
        reserveRatioBps = vm.parseJsonUint(cfg, '.auction.reserveRatioBps');

        // navDefault is a JSON string ("103.31"); parse and scale to cents basis
        // (103.31 -> 10331) so it matches the Q96 raw price basis used elsewhere.
        navDefaultCents = _navCents(vm.parseJsonString(cfg, '.auction.navDefault'));

        // Auction schedule. The config carries the SHORT profile; the long profile
        // is the same shape scaled by 1000 (AUCTION_PROFILE=short|long, default long).
        bool isShort = false;
        if (vm.envExists('AUCTION_PROFILE')) {
            isShort = keccak256(bytes(vm.envString('AUCTION_PROFILE'))) == keccak256(bytes('short'));
        }
        auctionScale = isShort ? 1 : 1000;
        startDelta = uint64(vm.parseJsonUint(cfg, '.auction.startBlockDelta'));
        endDelta = uint64(vm.parseJsonUint(cfg, '.auction.endBlockDelta') * auctionScale);
        claimDelta = uint64(vm.parseJsonUint(cfg, '.auction.claimBlockDelta'));
        auctionSalt = vm.envExists('AUCTION_SALT') ? vm.envBytes32('AUCTION_SALT') : bytes32(0);

        if (vm.exists(statePath)) {
            json = vm.readFile(statePath);
        } else {
            json = '{}';
        }

        serialized = stateObj.serialize(json);
    }

    function run() public {
        vm.startBroadcast();

        string memory isin = Isin.generate(countryCode, nsin);
        console2.log('[EXEC] ISIN:', isin);

        address bond = _stepBond(isin);
        _stepSsi(bond);
        _stepKyc(bond, deployer);
        if (seller != deployer) {
            _stepKyc(bond, seller);
        }
        _stepMint(bond);

        address compliance = _stepCompliance(bond);
        address aggregator = _stepAggregator();

        _stepAuction(bond, compliance, aggregator);

        vm.stopBroadcast();

        _write();

        console2.log('=== Deployment complete ===');
        console2.log('deployer  ', deployer);
        console2.log('bond      ', bond);
        console2.log('compliance', compliance);
        console2.log('aggregator', aggregator);
        console2.log('auction   ', _addr('.auction'));
        console2.log('hook      ', _addr('.hook'));
        console2.log('router    ', _addr('.router'));
        console2.log('ccaFactory', _addr('.ccaFactory'));
    }

    // ------------------------------------------------------------------
    // Idempotent steps
    // ------------------------------------------------------------------

    function _stepBond(string memory isin) internal returns (address bond) {
        if (_has('.bond')) {
            bond = _addr('.bond');
            console2.log('[SKIP] bond', bond);
            return bond;
        }

        // v4.x requires `startingDate` to be strictly in the future
        // (`_checkTimestamp` reverts WrongTimestamp when start <= block.timestamp).
        uint256 startingDate = block.timestamp + 1 hours;
        uint256 maturityDate = startingDate + maturityDaysOut * 1 days;

        IAtsFactory.SecurityData memory security = IAtsFactory.SecurityData({
            arePartitionsProtected: false,
            isMultiPartition: false,
            resolver: BLR_PROXY,
            resolverProxyConfiguration: IAtsFactory.ResolverProxyConfiguration({
                key: 0x0000000000000000000000000000000000000000000000000000000000000002, // BOND_CONFIG_ID
                version: 1
            }),
            rbacs: _defaultRbacs(),
            isControllable: true,
            isWhiteList: false,
            maxSupply: totalSupplyRaw,
            erc20MetadataInfo: IAtsFactory.ERC20MetadataInfo({
                name: bondName,
                symbol: bondSymbol,
                isin: isin,
                decimals: bondDecimals
            }),
            clearingActive: false,
            internalKycActivated: true,
            externalPauses: new address[](0),
            externalControlLists: new address[](0),
            externalKycLists: new address[](0),
            erc20VotesActivated: false,
            compliance: address(0),
            identityRegistry: address(0)
        });

        IAtsFactory.BondDetailsData memory details = IAtsFactory.BondDetailsData({
            currency: bytes3('USD'),
            nominalValue: nominalValue,
            nominalValueDecimals: nominalValueDecimals,
            startingDate: startingDate,
            maturityDate: maturityDate
        });

        IAtsFactory.BondData memory bondData = IAtsFactory.BondData({
            security: security,
            bondDetails: details,
            proceedRecipients: new address[](0),
            proceedRecipientsData: new bytes[](0)
        });

        IAtsFactory.FactoryRegulationData memory regulation = IAtsFactory.FactoryRegulationData({
            regulationType: IAtsFactory.RegulationType.REG_S,
            regulationSubType: IAtsFactory.RegulationSubType.NONE,
            additionalSecurityData: IAtsFactory.AdditionalSecurityData({
                countriesControlListType: true,
                listOfCountries: 'US',
                info: 'Cap Table demo bond'
            })
        });

        bond = IAtsFactory(ATS_FACTORY).deployBond(bondData, regulation);
        _set('.bond', bond);
        console2.log('[EXEC] bond', bond);
    }

    function _stepSsi(address bond) internal {
        if (_bool('.ssiDone')) {
            console2.log('[SKIP] ssi sequence');
            return;
        }

        // FR-3 order: grantRole(ROLE_SSI_MANAGER) -> addIssuer -> grantKyc.
        // We also grant the KYC, issuer and TREX-owner roles here because the
        // deployer is the sole admin and every later step needs one of them.
        IAccessControl(bond).grantRole(AtsRoles.ROLE_SSI_MANAGER, deployer);
        IAccessControl(bond).grantRole(AtsRoles.ROLE_KYC, deployer);
        IAccessControl(bond).grantRole(AtsRoles.ROLE_ISSUER, deployer);
        IAccessControl(bond).grantRole(AtsRoles.ROLE_TREX_OWNER, deployer);
        ISsiManagement(bond).addIssuer(deployer);

        _set('.ssiDone', true);
        console2.log('[EXEC] ssi sequence');
    }

    function _stepKyc(address bond, address account) internal {
        // Flat key (no internal dot) so forge-std serializes it as a single
        // top-level field and the dotted read path (".kyc_<addr>") resolves.
        string memory key = string(abi.encodePacked('.kyc_', vm.toString(account)));
        if (_bool(key)) {
            console2.log('[SKIP] kyc', account);
            return;
        }
        IKyc(bond).grantKyc(account, 'demo', block.timestamp, block.timestamp + 365 days, deployer);
        _set(key, true);
        console2.log('[EXEC] kyc', account);
    }

    function _stepMint(address bond) internal {
        if (_bool('.mintDone')) {
            console2.log('[SKIP] mint');
            return;
        }
        // Issue the full supply to the seller before the auction is created. The
        // seller is KYC-granted and the compliance/identity modules are still the
        // zero defaults, so issuance succeeds. After this we wire the compliance
        // module and exempt the seller so the later seller->auction transfer can
        // move the whole supply.
        IMint(bond).mint(seller, totalSupplyRaw);
        _set('.mintDone', true);
        console2.log('[EXEC] mint', totalSupplyRaw, 'to', seller);
    }

    function _stepCompliance(address bond) internal returns (address compliance) {
        if (_has('.compliance')) {
            compliance = _addr('.compliance');
            console2.log('[SKIP] compliance', compliance);
            return compliance;
        }

        compliance = address(new CapTableComplianceModule(bond));
        CapTableComplianceModule(compliance).setRules(uint32(maxInvestors), uint16(maxOwnershipBps), true);
        CapTableComplianceModule(compliance).setExempt(seller, true);

        IComplianceFacet(bond).setCompliance(compliance);

        _set('.compliance', compliance);
        console2.log('[EXEC] compliance', compliance);
    }

    function _stepAggregator() internal returns (address aggregator) {
        if (_has('.aggregator')) {
            aggregator = _addr('.aggregator');
            console2.log('[SKIP] aggregator', aggregator);
            return aggregator;
        }

        aggregator = address(new MockV3Aggregator(int256(navDefaultCents)));
        _set('.aggregator', aggregator);
        console2.log('[EXEC] aggregator', aggregator);
    }

    function _stepAuction(address bond, address compliance, address aggregator) internal {
        if (_has('.auction')) {
            console2.log('[SKIP] auction', _addr('.auction'));
            return;
        }

        address ccaFactory;
        if (_has('.ccaFactory')) {
            ccaFactory = _addr('.ccaFactory');
        } else {
            // Unmodified CCA factory with no protocol fee controller.
            ccaFactory = address(new ContinuousClearingAuctionFactory(address(0)));
            _set('.ccaFactory', ccaFactory);
        }

        // Auction parameters (FR-6) derived from config + AUCTION_PROFILE.
        uint64 startBlock = uint64(block.number) + startDelta;
        uint64 endBlock = startBlock + endDelta;
        uint64 claimBlock = endBlock + claimDelta;

        uint256 floorRaw = navDefaultCents * (10_000 - navDiscountBps) / 10_000;
        // The CCA constructor requires the floor price to sit exactly on a tick
        // boundary (TickPriceNotAtBoundary otherwise). tickSpacingBps is already
        // in the same raw price basis, so snap floorRaw down to the nearest
        // multiple (10124 -> 10100 for a 25 spacing).
        floorRaw -= floorRaw % tickSpacingBps;
        uint256 floorPrice = floorRaw.toQ96();
        // tickSpacingBps is already in the same raw price basis as `floorRaw`
        // (25 = 0.25 price points on a par-100 basis), so it converts to Q96
        // directly. Dividing by 10_000 here would corrupt the spacing.
        uint256 tickSpacing = tickSpacingBps.toQ96();
        uint256 requiredCurrencyRaised = totalSupplyRaw * floorRaw / 100 * reserveRatioBps / 10_000;

        // Two steps releasing 100% of supply (1e7 mps) over endDelta. The step
        // validator requires Σ(mps × blockDelta) == 1e7 exactly, and a single step
        // cannot encode it because 1e7 is not divisible by the block delta.
        //   long  (scale 1000): 200_000 blocks @ 25 mps  + 100_000 blocks @ 50 mps
        //   short (scale 1):        200 blocks @ 25_000 mps + 100 blocks @ 50_000 mps
        uint24 mps1 = uint24(25_000 / auctionScale);
        uint40 blocks1 = uint40(200 * auctionScale);
        uint24 mps2 = uint24(50_000 / auctionScale);
        uint40 blocks2 = uint40(100 * auctionScale);
        bytes memory auctionStepsData = abi.encodePacked(mps1, blocks1, mps2, blocks2);

        AuctionParameters memory parameters = AuctionParameters({
            currency: address(0),
            tokensRecipient: seller,
            fundsRecipient: seller,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: claimBlock,
            tickSpacing: tickSpacing,
            validationHook: address(0),
            floorPrice: floorPrice,
            requiredCurrencyRaised: uint128(requiredCurrencyRaised),
            auctionStepsData: auctionStepsData
        });

        IContinuousClearingAuctionFactory factory = IContinuousClearingAuctionFactory(ccaFactory);
        bytes32 salt = auctionSalt;

        // Deploy router and hook with a zero auction placeholder. Their AUCTION
        // field is storage (not immutable) so the code hash is independent of the
        // auction address, which breaks the hook<->router<->auction cycle.
        address payable router = payable(address(new SettlementRouter(address(0), bond)));
        address hook = address(
            new CapTableValidationHook(
                address(0),
                bond,
                router,
                bond, // KYC facet
                bond, // control-list facet
                compliance,
                bond, // security-holders facet
                aggregator,
                100, // MIN_BID: 100 raw = 1.00 bond
                1000, // bandBps ±10%
                3600 // maxStaleness
            )
        );

        parameters.validationHook = hook;
        bytes memory configData = abi.encode(parameters);

        address predicted = address(factory.getAddress(bond, totalSupplyRaw, configData, salt, seller));

        // Resolve the cycle now that the real auction address is known.
        SettlementRouter(router).setAuction(predicted);
        CapTableValidationHook(hook).setAuction(predicted);

        // Exempt the counterfactual auction and router from per-holder ownership
        // caps so custody legs (seller->auction, auction->router) can move the
        // whole supply; the seller is already exempt.
        CapTableComplianceModule(compliance).setExempt(predicted, true);
        CapTableComplianceModule(compliance).setExempt(router, true);

        // KYC-grant the counterfactual auction before it exists (FR-7) and the router (FR-9).
        _stepKyc(bond, predicted);
        _stepKyc(bond, router);

        // Transfer TOTAL_SUPPLY to the counterfactual auction. The demo uses one
        // funded account, so the seller must be the broadcast deployer.
        require(seller == deployer, 'SELLER_MUST_EQUAL_DEPLOYER');
        _transfer(bond, seller, predicted, totalSupplyRaw);

        // Create (FR-7 step 4).
        address auction = address(factory.create(bond, totalSupplyRaw, configData, salt));

        // The unmodified CCA checks `TOKEN.balanceOf(address(this)) >= TOTAL_SUPPLY`
        // inside `onTokensReceived()`, not the constructor, and the factory does not
        // call it. Activate the auction by notifying it that the supply has landed.
        IContinuousClearingAuction(auction).onTokensReceived();

        _set('.auction', auction);
        _set('.hook', hook);
        _set('.router', router);
        console2.log('[EXEC] auction', auction);
        console2.log('[EXEC] hook', hook);
        console2.log('[EXEC] router', router);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _transfer(address bond, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = bond.call(abi.encodeWithSignature('transfer(address,uint256)', to, amount));
        require(ok, 'TRANSFER_FAILED');
        require(data.length == 0 || abi.decode(data, (bool)), 'TRANSFER_RETURNED_FALSE');
        console2.log('[EXEC] transfer', amount, 'to', to);
    }

    function _defaultRbacs() internal view returns (IAtsFactory.Rbac[] memory) {
        IAtsFactory.Rbac[] memory rbacs = new IAtsFactory.Rbac[](1);
        address[] memory members = new address[](1);
        members[0] = deployer;
        rbacs[0] = IAtsFactory.Rbac({role: AtsRoles.DEFAULT_ADMIN_ROLE, members: members});
        return rbacs;
    }

    function _navCents(string memory nav) internal pure returns (uint256) {
        // "103.31" -> 10331. Split on the decimal point with fixed-width handling.
        bytes memory b = bytes(nav);
        uint256 whole;
        uint256 frac;
        bool dot;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == '.') {
                dot = true;
                continue;
            }
            uint8 d = uint8(b[i]) - 0x30;
            if (!dot) whole = whole * 10 + d;
            else frac = frac * 10 + d;
        }
        return whole * 100 + frac;
    }

    // -- JSON state ------------------------------------------------------

    function _has(string memory key) internal view returns (bool) {
        return serialized.parseRaw(key).length != 0 && !_isEmpty(key);
    }

    function _isEmpty(string memory key) internal view returns (bool) {
        return keccak256(bytes(serialized.parseRaw(key))) == keccak256(bytes('null'))
            || keccak256(bytes(serialized.parseRaw(key))) == keccak256(bytes('0x0000000000000000000000000000000000000000'));
    }

    function _addr(string memory key) internal view returns (address) {
        return serialized.readAddress(key);
    }

    function _bool(string memory key) internal view returns (bool) {
        if (!_has(key)) return false;
        return serialized.readBool(key);
    }

    function _set(string memory key, address value) internal {
        serialized = stateObj.serialize(_bareKey(key), value);
    }

    function _set(string memory key, bool value) internal {
        serialized = stateObj.serialize(_bareKey(key), value);
    }

    function _set(string memory key, uint256 value) internal {
        serialized = stateObj.serialize(_bareKey(key), value);
    }

    /// @dev forge-std serializes a bare key ("bond") and reads it back via a
    ///      leading-dot JSONPath (".bond"). The script's read helpers pass dotted
    ///      keys, so strip the leading dot on the write side so the JSON carries
    ///      clean keys (which the indexer also reads: `bond`, `auction`, `router`).
    function _bareKey(string memory key) internal pure returns (string memory) {
        bytes memory b = bytes(key);
        if (b.length > 0 && b[0] == '.') {
            bytes memory out = new bytes(b.length - 1);
            for (uint256 i = 1; i < b.length; i++) {
                out[i - 1] = b[i];
            }
            return string(out);
        }
        return key;
    }

    function _write() internal {
        vm.writeJson(serialized, statePath);
    }
}
