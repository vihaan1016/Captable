// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {console2} from 'forge-std/console2.sol';

import {PriceQ96} from 'cap-table/PriceQ96.sol';
import {SettlementRouter} from 'cap-table/SettlementRouter.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {CapTableComplianceModule} from 'cap-table/CapTableComplianceModule.sol';
import {IKyc} from 'cap-table/ats/IKyc.sol';
import {IControlList} from 'cap-table/ats/IControlList.sol';
import {IAccessControl} from 'cap-table/ats/IAccessControl.sol';
import {AtsRoles} from 'cap-table/ats/AtsRoles.sol';
import {IERC20} from 'cap-table/ats/IERC20.sol';

import {ContinuousClearingAuctionFactory} from
    'continuous-clearing-auction/ContinuousClearingAuctionFactory.sol';
import {AuctionParameters, IContinuousClearingAuction} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol';
import {IContinuousClearingAuctionFactory} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuctionFactory.sol';
import {ValidationHookLib} from 'continuous-clearing-auction/libraries/ValidationHookLib.sol';

/// @title DemoBeatsForkTest
/// @notice Proves the five demo beats end-to-end against the live Hedera testnet
///         deployment on a fork. The live bond/compliance/aggregator/factory are
///         reused; the supply is swept from the live auction and a fresh
///         short-reserve auction is created so the beats run in one test. Run with:
///         forge test --match-path contracts/test/DemoBeats.t.sol --fork-url https://testnet.hashio.io/api -vv
contract DemoBeatsForkTest is Test {
    using PriceQ96 for uint256;

    address internal constant DEPLOYER = 0x479178aEE7ac68C31D64e19Fa08955b791757C6F;
    address internal constant BOND = 0x40dbbB7587180F94388ABfDA89303e57aF19b5aA;
    address internal constant COMPLIANCE = 0x28815D9ffDCb4E8c6c387C4eAAdb02AC418Bbb46;
    address internal constant AGGREGATOR = 0x07741F1afedcC0371C0976F0aFFE7B501F1911Fa;
    address internal constant CCA_FACTORY = 0xCF4D1A8cFeb27A25e6Fb8c9CC0109FF34dDdeb27;
    address internal constant LIVE_AUCTION = 0x7d69464Ec69F1413C421188485442f07F2c02C01;

    address internal constant BIDDER_REJECT = 0x1B073c4A3aedB1B2c8Bb8C9d9141218C960066EB;
    address internal constant BIDDER_ACCEPT = 0x6fc3C2052c2D80B123cAbCE7343281690cb7cE91;
    address internal constant BIDDER_FROZEN = 0xCb9B78EA41E4160187421b3d0D03378CFe02Afef;

    uint256 internal constant TOTAL_SUPPLY = 1_000_000;
    uint256 internal constant FLOOR_RAW = 10_100;
    uint256 internal constant TICK_SPACING_BPS = 25;

    IContinuousClearingAuction internal auction;
    SettlementRouter internal router;
    CapTableValidationHook internal hook;

    function setUp() public {
        if (block.chainid != 296) {
            console2.log('skipped: not forked against Hedera testnet (chainid 296)');
            return;
        }

        vm.deal(DEPLOYER, 100_000 ether);
        vm.deal(BIDDER_REJECT, 10_000 ether);
        vm.deal(BIDDER_ACCEPT, 10_000 ether);
        vm.deal(BIDDER_FROZEN, 10_000 ether);

        vm.startPrank(DEPLOYER);

        // Reclaim the full supply from the live auction so the demo is
        // self-contained (the live auction has not yet ended, so sweep it via a
        // fork-time advance first).
        IContinuousClearingAuction live = IContinuousClearingAuction(LIVE_AUCTION);
        vm.roll(live.endBlock());
        live.sweepUnsoldTokens();

        IAccessControl(BOND).grantRole(AtsRoles.ROLE_CONTROL_LIST, DEPLOYER);
        _freshAuction();
        vm.stopPrank();

        // Advance to the auction's start block so bids can be submitted.
        vm.roll(auction.startBlock());
    }

    function test_AllFiveBeats() public {
        if (block.chainid != 296) return;
        uint256 maxPrice = (FLOOR_RAW + TICK_SPACING_BPS).toQ96();

        // ---- Beat 1: reject on identity -------------------------------
        uint128 small = 100_000;
        vm.startPrank(BIDDER_REJECT);
        vm.expectRevert(
            abi.encodeWithSelector(
                ValidationHookLib.ValidationHookCallFailed.selector,
                abi.encodeWithSelector(CapTableValidationHook.BidderNotKycGranted.selector, BIDDER_REJECT)
            )
        );
        router.placeBid{value: small}(maxPrice, small, 0);
        vm.stopPrank();
        console2.log('beat 1: reject on identity OK');

        // ---- Beat 2: reject on register --------------------------------
        vm.prank(DEPLOYER);
        IKyc(BOND).grantKyc(BIDDER_ACCEPT, 'demo', block.timestamp, block.timestamp + 365 days, DEPLOYER);

        uint128 bigAmount = 160_000;
        vm.startPrank(BIDDER_ACCEPT);
        vm.expectRevert(
            abi.encodeWithSelector(
                ValidationHookLib.ValidationHookCallFailed.selector,
                abi.encodeWithSelector(CapTableValidationHook.WouldExceedMaxOwnership.selector, 1600, 1500)
            )
        );
        router.placeBid{value: bigAmount}(maxPrice, bigAmount, 0);
        vm.stopPrank();
        console2.log('beat 2: reject on register OK');

        // ---- Beat 3: accept a valid bid --------------------------------
        uint128 acceptAmount = 100_000;
        vm.startPrank(BIDDER_ACCEPT);
        uint256 bidId = router.placeBid{value: acceptAmount}(maxPrice, acceptAmount, 0);
        vm.stopPrank();
        console2.log('beat 3: accepted bid', bidId);

        // ---- Beat 5 (setup): place a second valid bid BEFORE the auction ends.
        vm.prank(DEPLOYER);
        IKyc(BOND).grantKyc(BIDDER_FROZEN, 'demo', block.timestamp, block.timestamp + 365 days, DEPLOYER);

        uint128 frozenAmount = 50_000;
        vm.startPrank(BIDDER_FROZEN);
        uint256 frozenBid = router.placeBid{value: frozenAmount}(maxPrice, frozenAmount, 0);
        vm.stopPrank();

        // ---- Advance past claimBlock -----------------------------------
        vm.roll(auction.claimBlock() + 1);
        vm.warp(block.timestamp + 2000);

        // ---- Beat 4: settle + execute hold ------------------------------
        vm.prank(BIDDER_ACCEPT);
        router.settle(bidId);

        (,,, uint128 tokensFilled,,,,,) = router.bids(bidId);
        assertGt(tokensFilled, 0);
        bytes32 secret = keccak256(abi.encode(BIDDER_ACCEPT, tokensFilled, block.chainid, 0x6361707461626c65000000000000000000000000000000000000000000000000));
        vm.prank(BIDDER_ACCEPT);
        router.executeHold(bidId, secret);
        console2.log('beat 4: settle + execute hold OK');

        // ---- Beat 5: freeze and refund --------------------------------
        vm.prank(DEPLOYER);
        IControlList(BOND).addToControlList(BIDDER_FROZEN);

        vm.prank(DEPLOYER);
        router.fundReserve{value: 10_000 ether}();

        vm.prank(BIDDER_FROZEN);
        router.settle(frozenBid);

        (,,,,,,,, uint8 state) = router.bids(frozenBid);
        assertEq(state, 7); // REFUNDED_INELIGIBLE
        console2.log('beat 5: refund-ineligible OK');
    }

    function _freshAuction() internal {
        uint64 startBlock = uint64(block.number + 10);
        uint64 endBlock = startBlock + 300;
        uint64 claimBlock = endBlock + 10;

        uint256 floorPrice = FLOOR_RAW.toQ96();
        uint256 tickSpacing = uint256(TICK_SPACING_BPS).toQ96();
        // The demo uses a symbolic reserve (1 wei) so a single valid bid
        // graduates; graduation is not the point of the register-projection demo.
        uint256 requiredCurrencyRaised = 1;

        bytes memory auctionStepsData =
            abi.encodePacked(uint24(25_000), uint40(200), uint24(50_000), uint40(100));

        router = new SettlementRouter(address(0), BOND);
        hook = new CapTableValidationHook(
            address(0),
            BOND,
            address(router),
            BOND,
            BOND,
            COMPLIANCE,
            BOND,
            AGGREGATOR,
            100,
            1000,
            3600
        );

        AuctionParameters memory parameters = AuctionParameters({
            currency: address(0),
            tokensRecipient: DEPLOYER,
            fundsRecipient: DEPLOYER,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: claimBlock,
            tickSpacing: tickSpacing,
            validationHook: address(hook),
            floorPrice: floorPrice,
            requiredCurrencyRaised: uint128(requiredCurrencyRaised),
            auctionStepsData: auctionStepsData
        });

        IContinuousClearingAuctionFactory factory = IContinuousClearingAuctionFactory(CCA_FACTORY);
        bytes32 salt = bytes32(uint256(1));
        bytes memory configData = abi.encode(parameters);
        address predicted = address(factory.getAddress(BOND, TOTAL_SUPPLY, configData, salt, DEPLOYER));

        router.setAuction(predicted);
        hook.setAuction(predicted);
        CapTableComplianceModule(COMPLIANCE).setExempt(predicted, true);
        CapTableComplianceModule(COMPLIANCE).setExempt(address(router), true);
        IKyc(BOND).grantKyc(predicted, 'demo', block.timestamp, block.timestamp + 365 days, DEPLOYER);
        IKyc(BOND).grantKyc(address(router), 'demo', block.timestamp, block.timestamp + 365 days, DEPLOYER);

        IERC20(BOND).transfer(predicted, TOTAL_SUPPLY);
        auction = IContinuousClearingAuction(address(factory.create(BOND, TOTAL_SUPPLY, configData, salt)));
        auction.onTokensReceived();
    }
}
