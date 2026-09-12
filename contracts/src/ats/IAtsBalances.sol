// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Held/locked balance readers registered on the deployed ATS diamond.
/// @dev `balanceOf` returns AVAILABLE balance only; these two complete the total
///      (available + held + locked) picture used by the register projection.
interface IAtsBalances {
    function getHeldAmountFor(address account) external view returns (uint256);
    function getLockedAmountFor(address account) external view returns (uint256);
}
