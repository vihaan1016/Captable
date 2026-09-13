// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {SettlementRouter} from 'cap-table/SettlementRouter.sol';
import {ISettlementRouter} from 'cap-table/interfaces/ISettlementRouter.sol';
import {MockBond} from './mocks/MockBond.sol';
import {MockAuction} from './mocks/MockAuction.sol';

/// @title SettlementRouterTest
/// @notice Exercises the router lifecycle, including the frozen-bidder refund path (§7.2).
contract SettlementRouterTest is Test {
    MockBond internal bond;
    MockAuction internal auction;
    SettlementRouter internal router;

    address internal bidder = address(0xB0B);
    address internal seller = address(0x5E11);

    function setUp() public {
        bond = new MockBond();
        auction = new MockAuction(address(bond), seller);
        router = new SettlementRouter(address(auction), address(bond));

        // Give the router the bond tokens it needs for claim simulation.
        bond.mint(address(router), 10_000);

        // KYC-grant the bidder and fund reserve.
        bond.grantKyc(bidder, '', block.timestamp, block.timestamp + 1 days, address(this));
        vm.deal(bidder, 100_000);
    }

    function test_PlaceBid() public {
        vm.prank(bidder);
        uint256 bidId = router.placeBid{value: 1000}(100 << 96, 1000, 0);
        assertEq(bidId, 1);
        assertEq(router.pendingAmountFor(bidder), 1000);
        assertTrue(router.isPendingBeneficiary(bidder));
    }

    function test_PlaceBidIncorrectValue() public {
        vm.prank(bidder);
        vm.expectRevert(ISettlementRouter.IncorrectValue.selector);
        router.placeBid{value: 999}(100 << 96, 1000, 0);
    }

    function test_SettleEligibleCreatesHold() public {
        // Bidder is KYC-granted; settlement should create a hold and go HELD.
        vm.startPrank(bidder);
        router.placeBid{value: 1000}(100 << 96, 1000, 0);
        vm.stopPrank();

        // The auction claims 1000 tokens to the router. We pre-fund the auction
        // with bond balance so the mock's transfer succeeds, and set the claim
        // amount so the router's balance delta is non-zero.
        bond.mint(address(auction), 1000);
        auction.setClaimTokens(1000);

        router.settle(1);
        (,,,,,,,, uint8 state) = router.bids(1);
        assertEq(state, 4); // HELD
    }

    function test_FrozenBidderRefunded() public {
        // Bid while eligible, then freeze before settlement.
        vm.startPrank(bidder);
        router.placeBid{value: 1000}(100 << 96, 1000, 0);
        vm.stopPrank();

        // Freeze the bidder by adding to the control list (blacklist mode).
        bond.addToControlList(bidder);

        // Fund the reserve to cover the refund (1000 tokens × clearing price 100).
        router.fundReserve{value: 200_000}();

        // The auction claims 1000 tokens to the router (pre-fund the auction).
        bond.mint(address(auction), 1000);
        auction.setClaimTokens(1000);

        router.settle(1);
        (,,,,,,,, uint8 state) = router.bids(1);
        assertEq(state, 7); // REFUNDED_INELIGIBLE
    }

    function test_ReserveUnderfundedReverts() public {
        vm.startPrank(bidder);
        router.placeBid{value: 1000}(100 << 96, 1000, 0);
        vm.stopPrank();

        bond.addToControlList(bidder);
        // No reserve funded.

        bond.mint(address(auction), 1000);
        auction.setClaimTokens(1000);

        // The refund would exceed the reserve; settle must revert and leave state unchanged.
        vm.expectRevert();
        router.settle(1);

        (,,,,,,,, uint8 state) = router.bids(1);
        assertEq(state, 1); // still PLACED
    }

    function test_MidSettlementBidderNotDoubleCounted() public {
        // F-13 site (a): a fully-held holder (available balance 0) bidding again
        // must not be counted as a NEW beneficiary. balanceOf reads 0; totalOf
        // sees the held balance, so pendingNewBeneficiaries stays 0.
        bond.mint(bidder, 140_000);
        bond.setHeld(bidder, 140_000);
        vm.deal(bidder, 1 ether);

        vm.prank(bidder);
        router.placeBid{value: 100}(100 << 96, 100, 0);

        assertEq(router.pendingNewBeneficiaryCount(), 0);
        assertFalse(router.isPendingBeneficiary(bidder));
    }
}
