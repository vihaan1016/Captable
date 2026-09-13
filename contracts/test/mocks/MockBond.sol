// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from 'cap-table/ats/IERC20.sol';
import {IKyc} from 'cap-table/ats/IKyc.sol';
import {IControlList} from 'cap-table/ats/IControlList.sol';
import {ICompliance} from 'cap-table/ats/ICompliance.sol';
import {ISecurityHolders} from 'cap-table/ats/ISecurityHolders.sol';
import {IHoldByPartition} from 'cap-table/ats/IHoldByPartition.sol';

/// @title MockBond
/// @notice ATS-like token mock combining ERC-20, KYC, control-list, compliance,
///         security-holders, and hold-by-partition behaviours for unit tests.
contract MockBond is IERC20, IKyc, IControlList, ICompliance, ISecurityHolders, IHoldByPartition {
    string public name;
    string public symbol;
    uint8 public immutable override(IERC20) decimals = 2;

    uint256 public totalSupply_;
    mapping(address => uint256) public balanceOf_;

    // KYC
    mapping(address => KycStatus) public kyc;
    address public kycIssuer;

    // Control list (blacklist mode).
    bool public isWhiteList;
    mapping(address => bool) public inControlList;

    // Compliance delegate.
    address public complianceModule;

    // Holders registry.
    address[] public holderList;
    mapping(address => bool) public isHolder;

    // Holds.
    mapping(bytes32 => Hold) public holdById;
    mapping(address => uint256) public holdCount;
    uint256 public nextHoldId;

    // Held / locked balances. `balanceOf` returns AVAILABLE only, mirroring the
    // deployed ATS where a created (unexecuted) hold removes from `balanceOf`.
    mapping(address => uint256) public heldOf;
    mapping(address => uint256) public lockedOf;

    constructor() {
        name = 'MockBond';
        symbol = 'MB';
        kycIssuer = msg.sender;
    }

    // -- ERC20 -----------------------------------------------------------

    function balanceOf(address account) external view returns (uint256) {
        return balanceOf_[account];
    }

    function totalSupply() external view returns (uint256) {
        return totalSupply_;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf_[msg.sender] >= amount, 'BALANCE');
        require(canTransfer(msg.sender, to, amount), 'COMPLIANCE');
        balanceOf_[msg.sender] -= amount;
        balanceOf_[to] += amount;
        _trackHolder(to);
        return true;
    }

    // -- KYC -------------------------------------------------------------

    function getKycStatusFor(address _account) external view returns (KycStatus) {
        return kyc[_account];
    }

    function grantKyc(
        address _account,
        string memory,
        uint256,
        uint256,
        address _issuer
    ) external returns (bool) {
        kyc[_account] = KycStatus.GRANTED;
        kycIssuer = _issuer;
        return true;
    }

    function revokeKyc(address _account) external returns (bool) {
        kyc[_account] = KycStatus.NOT_GRANTED;
        return true;
    }

    // -- Control list ----------------------------------------------------

    function isInControlList(address _account) external view returns (bool) {
        return inControlList[_account];
    }

    function getControlListType() external view returns (bool) {
        return isWhiteList;
    }

    function addToControlList(address _account) external returns (bool success_) {
        inControlList[_account] = true;
        return true;
    }

    function removeFromControlList(address _account) external returns (bool success_) {
        inControlList[_account] = false;
        return true;
    }

    // -- Compliance ------------------------------------------------------

    function setCompliance(address c) external {
        complianceModule = c;
    }

    function canTransfer(address _from, address _to, uint256 _amount) public view returns (bool) {
        if (complianceModule != address(0)) {
            return ICompliance(complianceModule).canTransfer(_from, _to, _amount);
        }
        return true;
    }

    function transferred(address, address, uint256) external {}

    function created(address, uint256) external {}

    function destroyed(address, uint256) external {}

    // -- Security holders -------------------------------------------------

    function getTotalSecurityHolders() external view returns (uint256) {
        return holderList.length;
    }

    function getSecurityHolders(uint256 _pageIndex, uint256 _pageLength)
        external
        view
        returns (address[] memory holders)
    {
        uint256 start = _pageIndex * _pageLength;
        if (start >= holderList.length) return new address[](0);
        uint256 end = start + _pageLength > holderList.length ? holderList.length : start + _pageLength;
        holders = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            holders[i - start] = holderList[i];
        }
    }

    // -- Hold by partition ----------------------------------------------

    function createHoldByPartition(bytes32 _partition, Hold calldata _hold)
        external
        returns (bool, uint256)
    {
        require(_hold.amount > 0, 'AMOUNT');
        uint256 holdId = nextHoldId++;
        holdById[keccak256(abi.encode(_partition, msg.sender, holdId))] = _hold;
        return (true, holdId);
    }

    function executeHoldByPartition(HoldIdentifier calldata _id, address _to, uint256 _amount)
        external
        returns (bool, bytes32)
    {
        Hold storage h = holdById[keccak256(abi.encode(_id.partition, _id.tokenHolder, _id.holdId))];
        require(h.amount >= _amount, 'AMOUNT');
        h.amount -= _amount;
        require(balanceOf_[_id.tokenHolder] >= _amount, 'BALANCE');
        balanceOf_[_id.tokenHolder] -= _amount;
        balanceOf_[_to] += _amount;
        _trackHolder(_to);
        return (true, _id.partition);
    }

    function releaseHoldByPartition(HoldIdentifier calldata, uint256) external returns (bool) {
        return true;
    }

    function reclaimHoldByPartition(HoldIdentifier calldata) external returns (bool) {
        return true;
    }

    function getHeldAmountFor(address account) external view returns (uint256) {
        return heldOf[account];
    }

    function getLockedAmountFor(address account) external view returns (uint256) {
        return lockedOf[account];
    }

    /// @dev Test-only: move available balance into an unexecuted hold, mirroring
    ///      ATS where `createHoldByPartition` reduces `balanceOf` but the holder
    ///      still occupies a register slot.
    function setHeld(address account, uint256 amount) external {
        require(balanceOf_[account] >= amount, 'BALANCE');
        balanceOf_[account] -= amount;
        heldOf[account] += amount;
    }

    // -- Test helpers -----------------------------------------------------

    function mint(address to, uint256 amount) external {
        balanceOf_[to] += amount;
        totalSupply_ += amount;
        _trackHolder(to);
    }

    function _trackHolder(address account) internal {
        if (balanceOf_[account] > 0 && !isHolder[account]) {
            isHolder[account] = true;
            holderList.push(account);
        }
    }
}
