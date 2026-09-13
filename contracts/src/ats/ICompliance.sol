// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice ERC-3643 compliance module surface consumed by the ATS token.
/// @dev This is the exact interface implemented by the built-in modules and by
///      our own `CapTableComplianceModule`.
interface ICompliance {
    function canTransfer(address _from, address _to, uint256 _amount) external view returns (bool);

    function transferred(address _from, address _to, uint256 _amount) external;

    function created(address _to, uint256 _amount) external;

    function destroyed(address _from, uint256 _amount) external;
}
