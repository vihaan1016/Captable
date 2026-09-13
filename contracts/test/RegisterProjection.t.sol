// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {MockBond} from './mocks/MockBond.sol';
import {MockRouter} from './mocks/MockRouter.sol';
import {MockCompliance} from './mocks/MockCompliance.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {MockV3Aggregator} from 'cap-table/MockV3Aggregator.sol';
import {PriceQ96} from 'cap-table/PriceQ96.sol';

/// @title RegisterProjectionTest
/// @notice The concurrent-bid holder-cap race (§7.1) and ownership-cap boundary (§7.12).
contract RegisterProjectionTest is Test {
    using PriceQ96 for uint256;

    MockBond internal bond;
    MockRouter internal router;
    MockCompliance internal compliance;
    CapTableValidationHook internal hook;
    MockV3Aggregator internal aggregator;
    address internal auction = address(0xAAAA);

    address internal seller = address(0x5E11);

    function setUp() public {
        bond = new MockBond();
        router = new MockRouter();
        compliance = new MockCompliance(address(bond));
        aggregator = new MockV3Aggregator(10331); // 103.31 price basis

        // 50 investors max, 1500 bps ownership cap.
        compliance.setCaps(50, 1500);

        hook = new CapTableValidationHook(
            auction,
            address(bond),
            address(router),
            address(bond),
            address(bond),
            address(compliance),
            address(bond),
            address(aggregator),
            100,
            1000,
            3600
        );

        // Wire compliance into the bond.
        bond.setCompliance(address(compliance));
    }

    function _price(uint256 cents) internal pure returns (uint256) {
        return cents.toQ96();
    }

    function _grant(address a) internal {
        bond.grantKyc(a, '', block.timestamp, block.timestamp + 1 days, address(this));
    }

    function test_ConcurrentBidHolderCapRace() public {
        // Fill the register to 49 of 50 holders.
        address[49] memory existing;
        for (uint256 i = 0; i < 49; i++) {
            existing[i] = address(uint160(0x1000 + i));
            bond.mint(existing[i], 100);
            _grant(existing[i]);
        }
        assertEq(bond.getTotalSecurityHolders(), 49);

        // Five new beneficiaries each bid simultaneously (same block).
        address[5] memory bidders = [
            address(0xB01),
            address(0xB02),
            address(0xB03),
            address(0xB04),
            address(0xB05)
        ];

        uint256 successes;
        for (uint256 i = 0; i < 5; i++) {
            _grant(bidders[i]);
            // Simulate the router recording the pending new beneficiary before
            // submitBid, exactly as SettlementRouter.placeBid does.
            router.setPending(bidders[i], 100, true);
            try hook.validate(_price(10125), 100, address(router), address(router), abi.encode(bidders[i], bytes32(0)))
            {
                successes++;
            } catch {}
        }

        // Exactly one new beneficiary can be admitted (50 - 49 = 1 slot).
        assertEq(successes, 1);
    }

    function test_OwnershipExactBoundaryPasses() public {
        // Total supply exactly 1_000_000; cap 1500 bps => 150_000 tokens max.
        // Seller holds 860_000, bidder holds 140_000.
        bond.mint(seller, 860_000);
        address bidder = address(0xB0B);
        _grant(bidder);
        bond.mint(bidder, 140_000);
        router.setPending(bidder, 0, false);
        compliance.setPermissive(true);

        // Bid of 10_000 => projected 150_000 => 1500 bps (== cap, must pass).
        hook.validate(_price(10125), 10_000, address(router), address(router), abi.encode(bidder, bytes32(0)));
    }

    function test_OwnershipOneBpsAboveReverts() public {
        bond.mint(seller, 860_000);
        address bidder = address(0xB0B);
        _grant(bidder);
        bond.mint(bidder, 140_000);
        router.setPending(bidder, 0, false);
        compliance.setPermissive(true);

        // 10_100 => 150_100 => 1501 bps => revert.
        vm.expectRevert(
            abi.encodeWithSelector(CapTableValidationHook.WouldExceedMaxOwnership.selector, 1501, 1500)
        );
        hook.validate(_price(10125), 10_100, address(router), address(router), abi.encode(bidder, bytes32(0)));
    }

    function test_HeldTokensCountTowardOwnership() public {
        // F-13: 14% held entirely in an unexecuted hold; bidding 14% more must
        // project 28% and revert. balanceOf reads 0 (available) but totalOf sees
        // the held tokens, closing the fail-open ownership under-count.
        bond.mint(seller, 860_000);
        address bidder = address(0xB0B);
        _grant(bidder);
        bond.mint(bidder, 140_000);
        bond.setHeld(bidder, 140_000);
        router.setPending(bidder, 0, false);
        compliance.setPermissive(true);

        vm.expectRevert(
            abi.encodeWithSelector(CapTableValidationHook.WouldExceedMaxOwnership.selector, 2800, 1500)
        );
        hook.validate(_price(10125), 140_000, address(router), address(router), abi.encode(bidder, bytes32(0)));
    }

    function test_FullyHeldHolderIsNotCountedAsNewInvestor() public {
        // F-13: a holder whose whole balance is held must be recognised as an
        // existing investor, not a new one, so they do not consume a register slot.
        compliance.setCaps(2, 1500);
        hook = new CapTableValidationHook(
            auction,
            address(bond),
            address(router),
            address(bond),
            address(bond),
            address(compliance),
            address(bond),
            address(aggregator),
            100,
            1000,
            3600
        );
        bond.setCompliance(address(compliance));

        bond.mint(seller, 860_000);
        address bidder = address(0xB0B);
        _grant(bidder);
        bond.mint(bidder, 140_000);
        bond.setHeld(bidder, 140_000);
        router.setPending(bidder, 0, false);
        compliance.setPermissive(true);

        // Must NOT revert: projectedHolders stays 2 (no +1 for the held holder).
        hook.validate(_price(10125), 100, address(router), address(router), abi.encode(bidder, bytes32(0)));
    }
}
