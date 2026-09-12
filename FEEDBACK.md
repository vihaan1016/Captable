# Cap Table — Feedback

This file records the load-bearing limitations and findings surfaced while
building Cap Table against the **real** upstream contracts. Three are required
by the submission brief; the rest are honest integration costs.

The strongest first-hand finding is §1. It is reproduced by a fork test in this
repo (`contracts/test/AtsRegisterSemantics.t.sol`) and by three regression tests
in `contracts/test/RegisterProjection.t.sol`.

---

## 1. ATS `balanceOf` returns *available* balance, while `getTotalSecurityHolders()` counts on *total* — the obvious projection fails open

The deployed bond (ATS diamond, Config ID 2, Version 1) returns **available**
balance from `balanceOf`: creating an unexecuted hold moves the amount out of
`balanceOf`. But `getTotalSecurityHolders()` counts any address whose **total**
(available + held + locked) is non-zero, and a fully-held holder still occupies
a register slot.

Proven against the deployed bond:

```
before: balanceOf = 1000000, holderCount = 1
create hold for the whole balance
after : balanceOf = 0, heldAmount = 1000000, holderCount = 1
```

Consequences for a compliance projection built on `balanceOf` alone:

- **Ownership is under-counted (fails open).** A bidder holding 14% in an
  unexecuted hold who bids for 14% more projects as 14% and passes a 1500 bps
  cap at an actual 28%. This is reachable during any settlement window — in a
  live auction, most of the time.
- A fully-held holder reads as a *new* investor, over-counting the register
  (fails closed, but still wrong).
- A mid-settlement bidder with a held balance gets counted twice.

Cap Table closes this with `contracts/src/AtsBalance.sol`, which sums
`balanceOf` + `getHeldAmountFor` + `getLockedAmountFor` (degrading gracefully if
the hold/lock facets are absent), and uses it at all four projection sites in
`SettlementRouter.sol:97` and `CapTableValidationHook.sol:171,176,203,208`.

**Recommendation:** either document that `balanceOf` is available-only (the
current docs describe it as a total), or expose a total-balance getter. Any
project built on `balanceOf` silently mis-prices ownership — this is precisely
the kind of semantic trap that a secondary-market cap exists to prevent.

## 2. ATS documents a "lock hash" on holds that does not exist

The hold documentation describes a `lockHash`/secret-reveal field for
HTLC-style holds. The deployed `Hold` struct
(`{amount, expirationTimestamp, escrow, to, data}`) has **no hash field**; the
secret-reveal flow must be implemented by the caller (Cap Table does it in
`SettlementRouter`, hashing the secret into the hold's `data`).

> **Attribution.** This finding came from other builders in the ATS holds
> thread and was shared with us; it is reproduced here with their knowledge.
> (Names added on request.)

## 3. ERC-3643 creation accepts any address as Identity Registry or compliance with no interface check

`deployBond` accepts any address for the identity registry and compliance
fields. A wrong address fails only at the first mint/receiver call, reverting
`IdentityRegistryCallFailed` (`0xad87849e`) or `ComplianceCallFailed`
(`0x67fba102`) with no diagnostic about *which* address is wrong. A minimal
ERC-165/interface check at bond creation would turn a 3 a.m. support call into
a legible revert.

> **Attribution.** Same provenance as §2 — reported by other builders in the
> ATS holds thread, reproduced here with their knowledge. (Names added on
> request.)

## 4. CCA's Permit2 dependency has no `transferFrom` fallback

`ContinuousClearingAuction.submitBid` has exactly two currency paths:

1. `CURRENCY.isAddressZero()` → `msg.value == _amount`
2. otherwise → `SafeTransferLib.permit2TransferFrom(...)`

There is no plain `transferFrom`. Any ERC-20 auction currency therefore assumes
Permit2 is deployed at the canonical address and that the bidder has approved it.
We sidestep this entirely by using `currency = address(0)` (native HBAR).

**Recommendation:** expose the ERC-20 path as a distinct, documented option (or
add a standard-approval fallback) so teams can choose native-vs-ERC20 without
reading the source to discover the hidden Permit2 requirement.

## 5. The counterfactual-KYC requirement is created by the constructor's balance check

The auction constructor reverts unless
`TOKEN.balanceOf(address(this)) >= TOTAL_SUPPLY`, and the factory does not pull
tokens — it only `new`s the contract with a CREATE2 salt. Combined with ATS's
"to address must be compliant" transfer rule, the bonds must sit at a
**compliant counterfactual address** before the contract exists.

This forces the `getAddress → grantKyc → transfer → create` sequence, and means
the KYC-granted counterfactual address must be predicted exactly. It is a real
footgun: any parameter change after prediction orphans the transferred tokens.

**Recommendation:** document this sequence prominently in the CCA README, and
consider a factory path that pulls tokens (or an explicit `onTokensReceived`
deposit step) to decouple custody from deployment.

## 6. There is no claim-time compliance re-check

CCA's `claimTokens` does a raw `Currency.transfer(owner, tokensFilled)` with no
eligibility check. A bidder who was KYC-granted at bid time but frozen before
`claimBlock` either reverts inside ATS compliance (stranding HBAR) or — if the
transfer were permissive — receives tokens they should not hold.

Cap Table works around this with `SettlementRouter.settle`, which re-checks
`kyc`, `controlList`, and `compliance.canTransfer` before settling, and refunds
ineligible bidders from a settlement reserve. **This is the single most
important gap to close upstream** for any compliant-securities use of CCA.

## 7. The real ATS surface differs from the published simplified ABIs

The spec's idealized surface (`grantKyc(address)`, `holdByPartition(...)`,
`getKycStatus`, `isBlocked`) does not match the deployed ATS facets:

- `grantKyc(address, string vcId, uint256 validFrom, uint256 validTo, address issuer)`
- `getKycStatusFor(address)` (not `getKycStatus`)
- `createHoldByPartition(bytes32, Hold calldata)` (not `holdByPartition`)
- `executeHoldByPartition(HoldIdentifier, address, uint256)` (not `executeHold`)
- control-list uses `isInControlList` + `getControlListType`, not `isBlocked`

Cap Table ships adapter interfaces under `contracts/src/ats/` that match the
deployed facets. Anyone integrating ATS against CCA must resolve every selector
through `DiamondLoupe.facetAddress(bytes4)` before writing code — the reference
ATS deployment is a proxy whose implementation can drift.

## 8. CCA requires a bid to be exited before it can be claimed

`claimTokens` reverts `BidNotExited` unless the bid was first processed through
`exitBid` or `exitPartiallyFilledBid`. The simplified flow
"call `claimTokens` directly" is wrong. `SettlementRouter.settle` calls
`exitBid` then `claimTokens` in that order, and computes the fill/refund from
the resulting balance deltas.

## 9. The register projection is a correctness core, not a convenience

Without `pendingNewBeneficiaryCount` and `pendingAmountFor`, N simultaneous bids
each project `currentHolders + 1` and all pass, then settle and breach the cap.
The hook reads the router's pending accounting, which is written before
`submitBid` and rolled back on revert. This is why the hook is **router-only**
(`DirectBidsNotPermitted`): the indirection is what makes the projection sound.

## 10. ATS default partition is bytes32(1), not bytes32(0)

The ATS `_DEFAULT_PARTITION` constant is `bytes32(uint256(1))`, not the zero
partition that a naive ERC-1400 integration assumes. `SettlementRouter` initially
used `bytes32(0)`, so `createHoldByPartition` reverted
`PartitionNotAllowedInSinglePartitionMode(bytes32)`. The DvP hold path must use
the ATS default partition explicitly.

## 11. CCA refunds to the bid owner require a payable fallback

`ContinuousClearingAuction.exitBid` refunds unused native currency to the bid
`owner` (the router, since bids are router-owned). A router without a payable
`receive`/fallback reverts `NativeTransferFailed`. The settlement router must
accept native value or every settlement leg strands the refund.

## 12. The register projection double-counts the current bid unless pending state is split

If both `pendingAmount` and `pendingNewBeneficiaries` are written *before*
`submitBid`, the ownership projection reads `pendingAmountFor(bidder)` (which
already includes this bid) and adds `amount` again, doubling the projected
ownership. The holder-count race needs the flag written before submit, but the
ownership pending must be written after a successful submit. The two cannot be
one atomic "write pending first" step.

## 13. The NAV stale-oracle trade-off is real design tension

A stale or reverting NAV feed must not brick bidding (an oracle outage would
otherwise halt the auction), so the hook treats staleness as *skip*. But a
silent skip means the guard is absent exactly when it matters: while the feed
was stale on the testnet deployment, an out-of-band bid at ~4.8× NAV was
accepted. Skipping is the right availability call, but it deserves a loud
on-chain event (the hook emits `NavFeedStale`) and honest UI, because the
failure mode is a compliance guard quietly disappearing.

## 14. Published ATS docs and `main` describe a v8 that deployed v4 diamonds do not have

The published docs and the ATS `main` branch describe internals that are
absent from the deployed v4 diamond (Config ID 2, Version 1): the corporate
action role hash differs (`security.token.standard.role.corporateAction` is the
v4 preimage; the v8 constant silently does nothing), `getTotalTokenHolders()`
and `getAvailableBalanceFor()` are **not registered**, and `cancelCoupon` does
not exist. This cost real time twice: once on the coupon role hash, once on
holder-count internals.

**Recommendation:** version-tag the docs against the deployed diamond config,
and have the docs reference the *deployed* facet surface, not `main`.
