// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAggregatorV3} from 'cap-table/interfaces/IAggregatorV3.sol';

/// @title MockV3Aggregator
/// @notice Minimal Chainlink AggregatorV3-compatible mock for the demo NAV feed.
contract MockV3Aggregator is IAggregatorV3 {
    uint8 public immutable override decimals = 8;
    uint80 private _roundId = 1;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
    }

    function setNav(int256 answer) external {
        _answer = answer;
        _roundId++;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _roundId);
    }
}
