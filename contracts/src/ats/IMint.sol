// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice ATS issuance surface consumed by the deploy script.
interface IMint {
    function mint(address _to, uint256 _amount) external;
    function issue(address _tokenHolder, uint256 _value, bytes calldata _data) external;
}
