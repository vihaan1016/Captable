// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Minimal ABI surface for the ATS control-list facet.
/// @dev `isBlocked` is a project-level helper; the real ATS facet exposes raw
///      membership via `isInControlList` plus a whitelist/blacklist mode flag.
interface IControlList {
    function isInControlList(address _account) external view returns (bool);

    function getControlListType() external view returns (bool);

    function addToControlList(address _account) external returns (bool success_);

    function removeFromControlList(address _account) external returns (bool success_);
}
