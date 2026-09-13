// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface ISecurityHolders {
    function getTotalSecurityHolders() external view returns (uint256 count);

    function getSecurityHolders(
        uint256 _pageIndex,
        uint256 _pageLength
    ) external view returns (address[] memory holders);
}
