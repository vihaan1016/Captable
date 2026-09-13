// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ICompliance} from 'cap-table/ats/ICompliance.sol';

/// @title MockCompliance
/// @notice Configurable compliance module exposing investor-count and ownership caps.
contract MockCompliance is ICompliance {
    uint256 public maxInvestors_;
    uint256 public maxOwnershipBps_;
    address public bond;
    bool public permissive;

    constructor(address _bond) {
        bond = _bond;
    }

    function setCaps(uint256 _maxInvestors, uint256 _maxOwnershipBps) external {
        maxInvestors_ = _maxInvestors;
        maxOwnershipBps_ = _maxOwnershipBps;
    }

    function setPermissive(bool _permissive) external {
        permissive = _permissive;
    }

    function maxInvestors() external view returns (uint256) {
        return maxInvestors_;
    }

    function maxOwnershipBps() external view returns (uint256) {
        return maxOwnershipBps_;
    }

    function canTransfer(address, address to, uint256 amount) external view returns (bool) {
        if (permissive) return true;
        if (maxOwnershipBps_ == 0) return true;
        uint256 balance = _balanceOf(to);
        uint256 supply = _totalSupply();
        if (supply == 0) return true;
        return (balance + amount) * 10_000 / supply <= maxOwnershipBps_;
    }

    function _balanceOf(address a) internal view returns (uint256) {
        (bool ok, bytes memory data) = bond.staticcall(abi.encodeWithSignature('balanceOf(address)', a));
        return ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
    }

    function _totalSupply() internal view returns (uint256) {
        (bool ok, bytes memory data) = bond.staticcall(abi.encodeWithSignature('totalSupply()'));
        return ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
    }

    function transferred(address, address, uint256) external {}

    function created(address, uint256) external {}

    function destroyed(address, uint256) external {}
}
