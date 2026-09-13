// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title MockRouter
/// @notice Minimal router surface for exercising CapTableValidationHook in isolation.
contract MockRouter {
    mapping(address => uint256) public pendingAmount;
    mapping(address => bool) public isPendingBeneficiary;
    uint256 public pendingNewBeneficiaries;

    function pendingAmountFor(address a) external view returns (uint256) {
        return pendingAmount[a];
    }

    function pendingNewBeneficiaryCount() external view returns (uint256) {
        return pendingNewBeneficiaries;
    }

    function setPending(address a, uint256 amount, bool newBeneficiary) external {
        pendingAmount[a] = amount;
        isPendingBeneficiary[a] = newBeneficiary;
        if (newBeneficiary) pendingNewBeneficiaries++;
    }

    function setPendingNewBeneficiaries(uint256 n) external {
        pendingNewBeneficiaries = n;
    }
}
