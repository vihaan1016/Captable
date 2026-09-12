// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice ATS compliance facet writer surface consumed by the deploy script.
interface IComplianceFacet {
    function setCompliance(address _compliance) external;
    function compliance() external view returns (address);
}
