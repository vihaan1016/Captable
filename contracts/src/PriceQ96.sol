// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title PriceQ96
/// @notice Single audited helper for all price-to-Q96 conversions.
/// @dev pricePerBondCents is currency-wei per bond-unit, where one bond unit is
///      100 raw tokens (bond decimals = 2). Par 100.00 is therefore 10_000
///      cents of price basis, and `priceQ96 = price × 2^96`.
library PriceQ96 {
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    /// @notice Convert a price expressed in currency-wei per bond-unit (raw, 100 = 1 bond)
    ///         to its Q96 form.
    function toQ96(uint256 pricePerBondRaw) internal pure returns (uint256) {
        return pricePerBondRaw * Q96;
    }

    /// @notice Convert a Q96 price back to currency-wei per bond-unit (floor).
    function fromQ96(uint256 priceQ96) internal pure returns (uint256) {
        return priceQ96 / Q96;
    }

    /// @notice Display price with two decimals of bond precision (e.g. 101.25).
    /// @dev pricePerBondRaw is currency-wei per 100 raw tokens; dividing by 100
    ///      yields the whole-bond unit price with 2dp.
    function displayBps(uint256 priceQ96) internal pure returns (uint256) {
        return fromQ96(priceQ96) / 100;
    }
}
