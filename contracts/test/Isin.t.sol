// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {Isin} from 'cap-table/Isin.sol';
import {PriceQ96} from 'cap-table/PriceQ96.sol';
import {IsinWrapper} from './mocks/IsinWrapper.sol';

contract IsinTest is Test {
    using PriceQ96 for uint256;

    IsinWrapper internal wrapper;

    function setUp() public {
        wrapper = new IsinWrapper();
    }

    function test_AppleReference() public pure {
        assertEq(Isin.generate('US', '037833100'), 'US0378331005');
    }

    function test_Length() public pure {
        assertEq(bytes(Isin.generate('GB', '000263494')).length, 12);
    }

    function test_InvalidCountryCode() public {
        vm.expectRevert(Isin.InvalidCountryCode.selector);
        wrapper.generate('U', '037833100');
    }

    function test_InvalidNsin() public {
        vm.expectRevert(Isin.InvalidNsin.selector);
        wrapper.generate('US', '03783310');
    }

    function test_Q96RoundTrip() public pure {
        uint256 raw = 10125;
        assertEq(raw.toQ96().fromQ96(), raw);
    }

    function test_Q96Display() public pure {
        assertEq(PriceQ96.displayBps(uint256(10125).toQ96()), 101);
    }
}
