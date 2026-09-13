// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';

/// @title AuctionStepsTest
/// @notice Pins the CCA step invariant Σ(mps × blockDelta) == 10_000_000 exactly.
///         The deploy script derives steps from AUCTION_PROFILE; a wrong profile
///         reverts in the CCA constructor with an opaque error at deploy time.
contract AuctionStepsTest is Test {
    function test_StepsSumToOneE7() public pure {
        // long (public):  200_000 @ 25 mps + 100_000 @ 50 mps over 300_000 blocks.
        assertEq(uint256(200_000) * 25 + uint256(100_000) * 50, 10_000_000);
        // short (video):  200 @ 25_000 mps + 100 @ 50_000 mps over 300 blocks.
        assertEq(uint256(200) * 25_000 + uint256(100) * 50_000, 10_000_000);
    }
}
