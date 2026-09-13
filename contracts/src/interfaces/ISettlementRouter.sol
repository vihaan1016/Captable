// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISettlementRouter {
    event BidPlaced(uint256 indexed bidId, address indexed beneficiary, uint256 maxPriceQ96, uint128 amount);
    event HoldCreated(uint256 indexed bidId, uint256 indexed holdId, bytes32 lockHash, uint256 expiration);
    event Settled(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint8 path);
    event RefundedIneligible(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint256 refundValue);

    error IncorrectValue();
    error AlreadySettled();
    error ReserveUnderfunded(uint256 needed, uint256 have);
    error InvalidStateTransition(uint8 from, uint8 to);
    error BidDoesNotExist(uint256 bidId);

    function placeBid(uint256 maxPriceQ96, uint128 amount, uint256 prevTickPriceQ96)
        external
        payable
        returns (uint256 bidId);

    function exitBid(uint256 bidId) external;

    function settle(uint256 bidId) external;

    function executeHold(uint256 bidId, bytes32 secret) external;

    function fundReserve() external payable;

    function pendingAmountFor(address beneficiary) external view returns (uint256);

    function isPendingBeneficiary(address beneficiary) external view returns (bool);

    function pendingNewBeneficiaryCount() external view returns (uint256);
}
