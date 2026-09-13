// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title MockAuction
/// @notice Minimal CCA-compatible surface for exercising SettlementRouter without
///         deploying the full auction.
contract MockAuction {
    uint256 public clearingPrice_ = 100 << 96; // 100 raw per bond unit
    address public tokensRecipient;
    address public token;

    mapping(uint256 => bool) public exited;
    uint256 public exitRefundValue = 0;
    uint256 public claimTokensValue = 0;

    constructor(address _token, address _tokensRecipient) {
        token = _token;
        tokensRecipient = _tokensRecipient;
    }

    function setClearingPrice(uint256 q96) external {
        clearingPrice_ = q96;
    }

    function clearingPrice() external view returns (uint256) {
        return clearingPrice_;
    }

    function setExitRefund(uint256 v) external {
        exitRefundValue = v;
    }

    function setClaimTokens(uint256 v) external {
        claimTokensValue = v;
    }

    function submitBid(uint256, uint128 amount, address, uint256, bytes calldata)
        external
        payable
        returns (uint256)
    {
        require(msg.value == amount, 'VALUE');
        return 1;
    }

    function submitBid(uint256, uint128 amount, address, bytes calldata)
        external
        payable
        returns (uint256)
    {
        require(msg.value == amount, 'VALUE');
        return 1;
    }

    function exitBid(uint256 bidId) external {
        exited[bidId] = true;
        if (exitRefundValue > 0) {
            (bool ok,) = msg.sender.call{value: exitRefundValue}('');
            require(ok, 'REFUND');
        }
    }

    function claimTokens(uint256 bidId) external {
        // Transfer claimTokensValue tokens to the router (msg.sender).
        if (claimTokensValue > 0) {
            (bool ok,) = token.call(abi.encodeWithSignature('transfer(address,uint256)', msg.sender, claimTokensValue));
            require(ok, 'CLAIM');
        }
    }
}
