// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {console2} from 'forge-std/console2.sol';
import {IERC20} from 'cap-table/ats/IERC20.sol';
import {ISecurityHolders} from 'cap-table/ats/ISecurityHolders.sol';
import {IHoldByPartition} from 'cap-table/ats/IHoldByPartition.sol';

/// @title AtsRegisterSemanticsForkTest
/// @notice Pins the two ATS register semantics the hook's projection depends on,
///         against the DEPLOYED (Config ID 2, Version 1) bond rather than v8 source:
///           A. does `balanceOf` include tokens sitting in an unexecuted hold?
///           B. does a holder whose entire balance is held still occupy a register slot?
///         Run with:
///         forge test --match-path contracts/test/AtsRegisterSemantics.t.sol \
///           --fork-url https://testnet.hashio.io/api -vv
contract AtsRegisterSemanticsForkTest is Test {
    address internal constant BOND = 0x40dbbB7587180F94388ABfDA89303e57aF19b5aA;
    address internal constant HOLDER = 0x7d69464Ec69F1413C421188485442f07F2c02C01; // live auction, holds full supply
    address internal constant KYCED_TO = 0x479178aEE7ac68C31D64e19Fa08955b791757C6F;
    address internal constant ESCROW = 0x63B5149d0525222540A0a43d120209b7068FF319;  // settlement router
    bytes32 internal constant DEFAULT_PARTITION = bytes32(uint256(1));

    function test_HoldAccountingVsRegister() public {
        if (block.chainid != 296) {
            console2.log('skipped: not forked against Hedera testnet (chainid 296)');
            return;
        }

        uint256 balBefore = IERC20(BOND).balanceOf(HOLDER);
        uint256 holdersBefore = ISecurityHolders(BOND).getTotalSecurityHolders();
        console2.log('before: balanceOf   =', balBefore);
        console2.log('before: holderCount =', holdersBefore);
        require(balBefore > 0, 'holder has no balance on this fork');

        // Put the ENTIRE balance into an unexecuted hold.
        IHoldByPartition.Hold memory hold = IHoldByPartition.Hold({
            amount: balBefore,
            expirationTimestamp: block.timestamp + 7 days,
            escrow: ESCROW,
            to: KYCED_TO,
            data: ''
        });

        vm.prank(HOLDER);
        (bool ok,) = IHoldByPartition(BOND).createHoldByPartition(DEFAULT_PARTITION, hold);
        require(ok, 'createHoldByPartition failed');

        uint256 balAfter = IERC20(BOND).balanceOf(HOLDER);
        uint256 holdersAfter = ISecurityHolders(BOND).getTotalSecurityHolders();
        (bool okHeld, bytes memory heldRet) =
            BOND.staticcall(abi.encodeWithSignature('getHeldAmountFor(address)', HOLDER));
        uint256 held = okHeld ? abi.decode(heldRet, (uint256)) : type(uint256).max;

        console2.log('after : balanceOf   =', balAfter);
        console2.log('after : heldAmount  =', held);
        console2.log('after : holderCount =', holdersAfter);

        if (balAfter == balBefore) {
            console2.log('=> A: balanceOf INCLUDES held tokens (total). Router balanceOf==0 probe is SAFE.');
        } else if (balAfter == 0) {
            console2.log('=> A: balanceOf EXCLUDES held tokens (available). Router WILL double-count.');
        } else {
            console2.log('=> A: balanceOf changed partially - inspect.');
        }

        if (holdersAfter == holdersBefore) {
            console2.log('=> B: a fully-held holder STILL occupies a register slot.');
        } else {
            console2.log('=> B: register slot RELEASED while tokens are still held.');
        }
    }
}
