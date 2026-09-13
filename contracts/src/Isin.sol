// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Isin
/// @notice Deterministic ISO 6166 ISIN generator with Luhn check digit.
/// @dev Produces a 12-character ISIN from a 2-letter country code and a
///      9-character alphanumeric NSIN. Matches the ATS factory's validator.
library Isin {
    error InvalidCountryCode();
    error InvalidNsin();

    function generate(string memory countryCode, string memory nsin) internal pure returns (string memory) {
        bytes memory cc = bytes(countryCode);
        bytes memory ns = bytes(nsin);
        if (cc.length != 2) revert InvalidCountryCode();
        if (ns.length != 9) revert InvalidNsin();

        // Build the 11-char body (country + NSIN).
        bytes memory body = new bytes(11);
        for (uint256 i = 0; i < 2; i++) {
            body[i] = _upper(cc[i]);
        }
        for (uint256 i = 0; i < 9; i++) {
            body[2 + i] = _upper(ns[i]);
        }

        uint256 sum = _luhnSum(body, 11);

        uint8 check = uint8((10 - (sum % 10)) % 10);

        bytes memory out = new bytes(12);
        for (uint256 i = 0; i < 11; i++) {
            out[i] = body[i];
        }
        out[11] = bytes1(uint8(0x30) + check);
        return string(out);
    }

    function _luhnSum(bytes memory body, uint256 length) internal pure returns (uint256 sum) {
        // Expand alphanumerics to decimal digits and apply Luhn from the right.
        // We process left-to-right, tracking position parity from the right.
        uint256 digitCount;
        for (uint256 i = 0; i < length; i++) {
            uint8 code = _byteToCode(body[i]);
            if (code >= 10) digitCount += 2;
            else digitCount += 1;
        }

        // Iterate from the rightmost expanded digit.
        uint256 posFromRight = 0;
        for (uint256 i = length; i > 0; i--) {
            uint8 code = _byteToCode(body[i - 1]);
            if (code >= 10) {
                // two digits: tens then units
                uint8 tens = code / 10;
                uint8 units = code % 10;
                sum += _luhnDigit(units, posFromRight++);
                sum += _luhnDigit(tens, posFromRight++);
            } else {
                sum += _luhnDigit(code, posFromRight++);
            }
        }
    }

    function _luhnDigit(uint8 digit, uint256 posFromRight) internal pure returns (uint256) {
        // Luhn doubles digits at odd positions when indexing from the right
        // (i.e. positions 0, 2, 4, ...). The spec says "index from the right,
        // starting at 1" and "double every digit at an odd index", which means
        // the rightmost digit is position 1 (odd) and IS doubled.
        if (posFromRight % 2 == 0) {
            uint256 doubled = digit * 2;
            return doubled > 9 ? doubled - 9 : doubled;
        }
        return digit;
    }

    function _byteToCode(bytes1 c) internal pure returns (uint8) {
        uint8 code = uint8(c);
        if (code >= uint8(bytes1('0')) && code <= uint8(bytes1('9'))) {
            return code - uint8(bytes1('0'));
        }
        // A-Z => 10-35
        return code - uint8(bytes1('A')) + 10;
    }

    function _upper(bytes1 c) internal pure returns (bytes1) {
        uint8 code = uint8(c);
        if (code >= uint8(bytes1('a')) && code <= uint8(bytes1('z'))) {
            return bytes1(code - 32);
        }
        return c;
    }
}
