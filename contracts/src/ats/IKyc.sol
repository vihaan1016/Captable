// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Minimal ABI surface for the Asset Tokenization Studio KYC facet.
/// @dev Signatures match the deployed `KycFacet` in hashgraph/asset-tokenization-studio.
interface IKyc {
    enum KycStatus {
        NOT_GRANTED,
        GRANTED
    }

    function getKycStatusFor(address _account) external view returns (KycStatus kycStatus_);

    function grantKyc(
        address _account,
        string memory _vcId,
        uint256 _validFrom,
        uint256 _validTo,
        address _issuer
    ) external returns (bool success_);

    function revokeKyc(address _account) external returns (bool success_);
}
