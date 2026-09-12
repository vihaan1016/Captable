// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ICompliance} from 'cap-table/ats/ICompliance.sol';

/// @title CapTableComplianceModule
/// @notice ERC-3643 compliance module enforcing a maximum investor count and a
///         maximum per-holder ownership share. This is the expected fallback when
///         the deployed ATS compliance module does not expose these rules.
contract CapTableComplianceModule is ICompliance {
    struct Rules {
        uint32 maxInvestors; // 0 = unlimited
        uint16 maxOwnershipBps; // 0 = unlimited; basis points of totalSupply
        bool active;
    }

    Rules public rules;
    address public immutable BOND;
    address public owner;

    /// @dev Infrastructure custody addresses (seller, auction, router) are exempt
    ///      from the per-holder ownership and investor-count caps. Without this the
    ///      100%-supply seller→auction transfer and the auction→router custody leg
    ///      would be rejected by the very module that is meant to gate bidders.
    mapping(address => bool) public exempt;

    event RulesUpdated(uint32 maxInvestors, uint16 maxOwnershipBps, bool active);
    event ExemptionUpdated(address account, bool isExempt);

    modifier onlyOwner() {
        require(msg.sender == owner, 'NOT_OWNER');
        _;
    }

    constructor(address bond) {
        BOND = bond;
        owner = msg.sender;
    }

    function setRules(uint32 _maxInvestors, uint16 _maxOwnershipBps, bool _active) external onlyOwner {
        rules = Rules({maxInvestors: _maxInvestors, maxOwnershipBps: _maxOwnershipBps, active: _active});
        emit RulesUpdated(_maxInvestors, _maxOwnershipBps, _active);
    }

    function setExempt(address account, bool isExempt) external onlyOwner {
        exempt[account] = isExempt;
        emit ExemptionUpdated(account, isExempt);
    }

    function maxInvestors() external view returns (uint256) {
        return rules.maxInvestors;
    }

    function maxOwnershipBps() external view returns (uint256) {
        return rules.maxOwnershipBps;
    }

    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        if (!rules.active) return true;
        if (exempt[to] || exempt[from]) return true;

        (bool okSupply, bytes memory supplyData) = BOND.staticcall(abi.encodeWithSignature('totalSupply()'));
        uint256 totalSupply = okSupply && supplyData.length >= 32 ? abi.decode(supplyData, (uint256)) : 0;

        if (rules.maxInvestors > 0 && from != address(0) && to != address(0) && amount > 0) {
            (bool okBal, bytes memory balData) = BOND.staticcall(abi.encodeWithSignature('balanceOf(address)', to));
            uint256 toBalance = okBal && balData.length >= 32 ? abi.decode(balData, (uint256)) : 0;
            if (toBalance == 0) {
                (bool okCount, bytes memory countData) =
                    BOND.staticcall(abi.encodeWithSignature('getTotalSecurityHolders()'));
                uint256 currentHolders = okCount && countData.length >= 32 ? abi.decode(countData, (uint256)) : 0;
                if (currentHolders + 1 > rules.maxInvestors) return false;
            }
        }

        if (rules.maxOwnershipBps > 0) {
            (bool ok, bytes memory data) = BOND.staticcall(abi.encodeWithSignature('balanceOf(address)', to));
            uint256 balance = ok && data.length >= 32 ? abi.decode(data, (uint256)) : 0;
            if (totalSupply == 0) return false;
            if ((balance + amount) * 10_000 / totalSupply > rules.maxOwnershipBps) return false;
        }

        return true;
    }

    function transferred(address, address, uint256) external {}

    function created(address, uint256) external {}

    function destroyed(address, uint256) external {}
}
