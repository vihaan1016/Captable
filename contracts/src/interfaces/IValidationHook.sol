// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IValidationHook {
    function validate(uint256 maxPrice, uint128 amount, address owner, address sender, bytes calldata hookData)
        external;
}
