// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {MockBond} from './mocks/MockBond.sol';
import {MockRouter} from './mocks/MockRouter.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {MockV3Aggregator} from 'cap-table/MockV3Aggregator.sol';

contract CapTableValidationHookTest is Test {
    MockBond internal bond;
    MockRouter internal router;
    CapTableValidationHook internal hook;
    MockV3Aggregator internal aggregator;
    address internal auction = address(0xAAAA);

    address internal kycBidder = address(0xB0B);
    address internal nonKycBidder = address(0xBAD);

    function setUp() public {
        bond = new MockBond();
        router = new MockRouter();
        aggregator = new MockV3Aggregator(10331); // 103.31 price basis

        hook = new CapTableValidationHook(
            auction,
            address(bond),
            address(router),
            address(bond),
            address(bond),
            address(bond),
            address(bond),
            address(aggregator),
            100,
            1000,
            3600
        );

        // KYC-grant the bidder.
        bond.grantKyc(kycBidder, '', block.timestamp, block.timestamp + 1 days, address(this));

        // Seed a NAV within band and a non-zero supply so ownership projection
        // does not divide by zero.
        aggregator.setNav(10331);
        bond.mint(address(this), 1000);
    }

    function _price(uint256 cents) internal pure returns (uint256) {
        return cents * (2 ** 96);
    }

    function test_DirectBidReverts() public {
        // A non-router sender must revert before any compliance read (FR-11, §7.4).
        vm.expectRevert(CapTableValidationHook.DirectBidsNotPermitted.selector);
        hook.validate(_price(10125), 100, address(router), address(this), abi.encode(kycBidder, bytes32(0)));
    }

    function test_KycRequired() public {
        vm.expectRevert(abi.encodeWithSelector(CapTableValidationHook.BidderNotKycGranted.selector, nonKycBidder));
        hook.validate(_price(10125), 100, address(router), address(router), abi.encode(nonKycBidder, bytes32(0)));
    }

    function test_OwnerBypassRevertsBeforeComplianceRead() public {
        // Even a KYC-granted caller sending through the router with a non-granted
        // beneficial owner is rejected. Direct calls to submitBid are blocked by the
        // router-only sender check (§7.4).
        vm.expectRevert(CapTableValidationHook.DirectBidsNotPermitted.selector);
        hook.validate(_price(10125), 100, address(router), kycBidder, abi.encode(nonKycBidder, bytes32(0)));
    }

    function test_PreviewMatchesValidate() public {
        // previewValidate and validate must agree on the shared internal path (§FR-18).
        (bool ok, bytes4 reason) = hook.previewValidate(_price(10125), 100, kycBidder);
        assertTrue(ok);
        assertEq(reason, bytes4(0));
    }

    function test_NavBandRejectsFarPrice() public {
        // ±10% band around 103.31 -> [92.979, 113.641]. A price of 150 is far out.
        vm.expectRevert();
        hook.validate(_price(15000), 100, address(router), address(router), abi.encode(kycBidder, bytes32(0)));
    }

    function test_MinBidEnforced() public {
        vm.expectRevert(abi.encodeWithSelector(CapTableValidationHook.BidBelowMinimum.selector, 99, 100));
        hook.validate(_price(10125), 99, address(router), address(router), abi.encode(kycBidder, bytes32(0)));
    }
}
