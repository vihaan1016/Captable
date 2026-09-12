// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Coupon facet surface for the deployed ATS (Config ID 2, Version 1).
/// @dev Struct field order is load-bearing: it determines the `setCoupon` selector.
///      Mirrors ATS `packages/ats/contracts/contracts/facets/coupon/ICouponTypes.sol`.
interface ICoupon {
    struct Coupon {
        uint256 recordDate;
        uint256 executionDate;
        uint256 startDate;
        uint256 endDate;
        uint256 fixingDate;
        uint256 rate;
        uint8 rateDecimals;
        uint8 rateStatus; // RateCalculationStatus enum
    }

    function setCoupon(Coupon calldata newCoupon) external returns (uint256 couponID_);

    function getCouponCount() external view returns (uint256);
}
