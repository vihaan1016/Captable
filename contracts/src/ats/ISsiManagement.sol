// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Minimal ABI surface for the ATS SSI management facet.
interface ISsiManagement {
    function addIssuer(address _issuer) external returns (bool success_);

    function isIssuer(address _issuer) external view returns (bool);
}
