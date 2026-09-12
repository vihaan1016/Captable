// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Canonical role identifiers for the deployed ATS (v4.x) on Hedera testnet.
/// @dev These differ from the v8.x constants in .research/ats. Do not use v8 hashes.
library AtsRoles {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    // keccak256('security.token.standard.role.ssi.manager')
    bytes32 internal constant ROLE_SSI_MANAGER = 0x0995a089e16ba792fdf9ec5a4235cba5445a9fb250d6e96224c586678b81ebd0;

    // keccak256('security.token.standard.role.kyc')
    bytes32 internal constant ROLE_KYC = 0x6fbd421e041603fa367357d79ffc3b2f9fd37a6fc4eec661aa5537a9ae75f93d;

    // keccak256('security.token.standard.role.issuer')
    bytes32 internal constant ROLE_ISSUER = 0x4be32e8849414d19186807008dabd451c1d87dae5f8e22f32f5ce94d486da842;

    // keccak256('security.token.standard.role.trexOwner')
    bytes32 internal constant ROLE_TREX_OWNER = 0x03ce2fdc316501dd97f5219e6ad908a3238f1e90f910aa17b627f801a6aafab7;

    // keccak256('security.token.standard.role.controlList')
    bytes32 internal constant ROLE_CONTROL_LIST = 0xca537e1c88c9f52dc5692c96c482841c3bea25aafc5f3bfe96f645b5f800cac3;
}
