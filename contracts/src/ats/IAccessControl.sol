// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Access-control surface of the ATS Diamond.
interface IAccessControl {
    function grantRole(bytes32 role, address account) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
}
