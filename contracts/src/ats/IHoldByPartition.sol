// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice ATS ERC-1410 hold types and the hold-by-partition writer surface.
interface IHoldByPartition {
    struct HoldIdentifier {
        bytes32 partition;
        address tokenHolder;
        uint256 holdId;
    }

    struct Hold {
        uint256 amount;
        uint256 expirationTimestamp;
        address escrow;
        address to;
        bytes data;
    }

    function createHoldByPartition(
        bytes32 _partition,
        Hold calldata _hold
    ) external returns (bool success_, uint256 holdId_);

    function executeHoldByPartition(
        HoldIdentifier calldata _holdIdentifier,
        address _to,
        uint256 _amount
    ) external returns (bool success_, bytes32 partition_);

    function releaseHoldByPartition(
        HoldIdentifier calldata _holdIdentifier,
        uint256 _amount
    ) external returns (bool success_);

    function reclaimHoldByPartition(HoldIdentifier calldata _holdIdentifier) external returns (bool success_);
}
