// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {MockBond} from './mocks/MockBond.sol';
import {MockRouter} from './mocks/MockRouter.sol';
import {MockCompliance} from './mocks/MockCompliance.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {MockV3Aggregator} from 'cap-table/MockV3Aggregator.sol';

/// @title ValidationAgreementTest
/// @notice §8.2: previewValidate and validate agree on 1,000 fuzzed inputs.
contract ValidationAgreementTest is Test {
    MockBond internal bond;
    MockRouter internal router;
    MockCompliance internal compliance;
    CapTableValidationHook internal hook;
    MockV3Aggregator internal aggregator;

    address internal seller = address(0x5E11);
    address internal beneficiary = address(0xB0B);

    function setUp() public {
        bond = new MockBond();
        router = new MockRouter();
        compliance = new MockCompliance(address(bond));
        aggregator = new MockV3Aggregator(10331);

        compliance.setCaps(50, 1500);
        compliance.setPermissive(true);

        hook = new CapTableValidationHook(
            address(0xAAAA),
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
        bond.grantKyc(beneficiary, '', block.timestamp, block.timestamp + 1 days, address(this));
        bond.mint(seller, 1_000_000);
    }

    function testFuzz_PreviewMatchesValidate(uint256 priceCents, uint128 amount, bool kyced, bool blocked) public {
        // Bound price into the NAV band so NAV is never the discriminating check;
        // the test targets agreement between the two paths for the same inputs.
        priceCents = bound(priceCents, 10125, 10125 + 5000);
        amount = uint128(bound(amount, 0, 1_000_000));

        address who = kyced ? beneficiary : address(0xBAD);
        if (blocked) {
            bond.addToControlList(who);
        } else {
            // fresh blacklist-mode bond: add only when blocked
        }

        (bool previewOk,) = hook.previewValidate(priceCents << 96, amount, who);

        bool validateOk = true;
        try hook.validate(priceCents << 96, amount, address(router), address(router), abi.encode(who, bytes32(0))) {}
        catch {
            validateOk = false;
        }

        assertEq(previewOk, validateOk, 'preview/validate disagreement');
    }
}
