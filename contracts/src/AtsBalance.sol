// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from 'cap-table/ats/IERC20.sol';

/// @title AtsBalance
/// @notice Total (available + held + locked) balance of an ATS holder.
/// @dev ATS `balanceOf` returns AVAILABLE only; `getTotalSecurityHolders()` counts
///      on TOTAL. See `contracts/test/AtsRegisterSemantics.t.sol`. Degrades
///      gracefully to `balanceOf` when the hold/lock facets are absent, so a bond
///      without them cannot brick the bid path.
library AtsBalance {
    /// @notice available + held + locked.
    function totalOf(address bond, address account) internal view returns (uint256 total) {
        total = IERC20(bond).balanceOf(account);

        (bool okH, bytes memory h) =
            bond.staticcall(abi.encodeWithSelector(0x8493aabb, account)); // getHeldAmountFor
        if (okH && h.length >= 32) total += abi.decode(h, (uint256));

        (bool okL, bytes memory l) =
            bond.staticcall(abi.encodeWithSelector(0x36e74467, account)); // getLockedAmountFor
        if (okL && l.length >= 32) total += abi.decode(l, (uint256));
    }
}
