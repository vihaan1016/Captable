// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Isin} from 'cap-table/Isin.sol';

contract IsinWrapper {
    function generate(string memory cc, string memory nsin) external pure returns (string memory) {
        return Isin.generate(cc, nsin);
    }
}
