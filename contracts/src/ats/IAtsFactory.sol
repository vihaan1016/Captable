// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @notice Minimal ABI surface for the deployed ATS Factory diamond (v4.x).
/// @dev Field order matches the v4.x IFactory on Hedera testnet, NOT the v8.x
///      layout in .research/ats. The two differ: v4.x orders SecurityData with
///      `arePartitionsProtected` and `isMultiPartition` first, and `SecurityType`
///      is a 2-value enum (Bond, Equity). The deployBond selector is 0x5133f0e0.
interface IAtsFactory {
    enum SecurityType {
        Bond,
        Equity
    }

    enum DividendType {
        NONE,
        PREFERRED,
        COMMON
    }

    enum RegulationType {
        NONE,
        REG_S,
        REG_D
    }

    enum RegulationSubType {
        NONE,
        REG_D_506_B,
        REG_D_506_C
    }

    struct ResolverProxyConfiguration {
        bytes32 key;
        uint256 version;
    }

    struct Rbac {
        bytes32 role;
        address[] members;
    }

    struct ERC20MetadataInfo {
        string name;
        string symbol;
        string isin;
        uint8 decimals;
    }

    struct SecurityData {
        bool arePartitionsProtected;
        bool isMultiPartition;
        address resolver;
        ResolverProxyConfiguration resolverProxyConfiguration;
        Rbac[] rbacs;
        bool isControllable;
        bool isWhiteList;
        uint256 maxSupply;
        ERC20MetadataInfo erc20MetadataInfo;
        bool clearingActive;
        bool internalKycActivated;
        address[] externalPauses;
        address[] externalControlLists;
        address[] externalKycLists;
        bool erc20VotesActivated;
        address compliance;
        address identityRegistry;
    }

    struct BondDetailsData {
        bytes3 currency;
        uint256 nominalValue;
        uint8 nominalValueDecimals;
        uint256 startingDate;
        uint256 maturityDate;
    }

    struct BondData {
        SecurityData security;
        BondDetailsData bondDetails;
        address[] proceedRecipients;
        bytes[] proceedRecipientsData;
    }

    struct AdditionalSecurityData {
        bool countriesControlListType;
        string listOfCountries;
        string info;
    }

    struct FactoryRegulationData {
        RegulationType regulationType;
        RegulationSubType regulationSubType;
        AdditionalSecurityData additionalSecurityData;
    }

    function deployBond(BondData calldata _bondData, FactoryRegulationData calldata _factoryRegulationData)
        external
        returns (address bondAddress_);
}
