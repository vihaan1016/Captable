// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from 'forge-std/Test.sol';
import {console2} from 'forge-std/console2.sol';
import {MockBond} from './mocks/MockBond.sol';
import {CapTableValidationHook} from 'cap-table/CapTableValidationHook.sol';
import {SettlementRouter} from 'cap-table/SettlementRouter.sol';
import {CapTableComplianceModule} from 'cap-table/CapTableComplianceModule.sol';
import {MockV3Aggregator} from 'cap-table/MockV3Aggregator.sol';
import {ContinuousClearingAuctionFactory} from
    'continuous-clearing-auction/ContinuousClearingAuctionFactory.sol';
import {AuctionParameters, IContinuousClearingAuction} from
    'continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol';

/// @title GasMeasurementTest
/// @notice Records submitBid gas with and without the validation hook (§6.5).
contract GasMeasurementTest is Test {
    MockBond internal bond;
    ContinuousClearingAuctionFactory internal factory;
    MockV3Aggregator internal aggregator;

    address internal seller = address(0x5E11);
    address internal bidder = address(0xB0B);

    uint256 internal constant TOTAL_SUPPLY = 1_000_000;

    function setUp() public {
        bond = new MockBond();
        factory = new ContinuousClearingAuctionFactory(address(0));
        aggregator = new MockV3Aggregator(10331);

        bond.mint(seller, TOTAL_SUPPLY);
        bond.grantKyc(bidder, '', block.timestamp, block.timestamp + 1 days, address(this));
        vm.deal(bidder, 100_000);
    }

    function _parameters(address hook) internal view returns (AuctionParameters memory) {
        uint64 startBlock = uint64(block.number + 1);
        uint64 endBlock = startBlock + 100;
        return AuctionParameters({
            currency: address(0),
            tokensRecipient: seller,
            fundsRecipient: seller,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock + 10,
            tickSpacing: uint256(25) << 96,
            validationHook: hook,
            floorPrice: (10125 << 96),
            requiredCurrencyRaised: uint128((TOTAL_SUPPLY * 10125 / 100) * 6000 / 10_000),
            auctionStepsData: abi.encodePacked(uint24(100_000), uint40(100))
        });
    }

    function _deploy(address hook) internal returns (IContinuousClearingAuction auction) {
        AuctionParameters memory params = _parameters(hook);
        bytes memory configData = abi.encode(params);
        address predicted = address(factory.getAddress(address(bond), TOTAL_SUPPLY, configData, bytes32(0), seller));
        vm.startPrank(seller);
        bond.transfer(predicted, TOTAL_SUPPLY);
        auction = IContinuousClearingAuction(address(factory.create(address(bond), TOTAL_SUPPLY, configData, bytes32(0))));
        vm.stopPrank();
        auction.onTokensReceived();
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 2);
    }

    function test_GasWithoutHook() public {
        IContinuousClearingAuction auction = _deploy(address(0));

        vm.prank(bidder);
        uint256 start = gasleft();
        auction.submitBid{value: 1000}(10150 << 96, 1000, bidder, abi.encode(bidder, bytes32(0)));
        uint256 used = start - gasleft();

        console2.log('submitBid WITHOUT hook gas:', used);
    }

    function test_GasWithHook() public {
        CapTableComplianceModule compliance = new CapTableComplianceModule(address(bond));
        compliance.setRules(50, 1500, true);
        compliance.setExempt(seller, true);
        bond.setCompliance(address(compliance));

        SettlementRouter router = new SettlementRouter(address(0), address(bond));
        CapTableValidationHook hook = new CapTableValidationHook(
            address(0),
            address(bond),
            address(router),
            address(bond),
            address(bond),
            address(compliance),
            address(bond),
            address(aggregator),
            100,
            1000,
            3600
        );

        IContinuousClearingAuction auction = _deploy(address(hook));
        router.setAuction(address(auction));
        hook.setAuction(address(auction));
        compliance.setExempt(address(auction), true);
        compliance.setExempt(address(router), true);

        vm.prank(bidder);
        uint256 start = gasleft();
        router.placeBid{value: 1000}(10150 << 96, 1000, 0);
        uint256 used = start - gasleft();

        console2.log('submitBid WITH hook gas:', used);
    }
}
