// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./PredictionMarket.sol";

/**
 * @title MarketFactory
 * @dev Factory contract for deploying new PredictionMarket instances for the Pythia protocol.
 */
contract MarketFactory {
    address public oracle;
    address public treasury;
    address[] public allMarkets;
    address public owner;

    event MarketCreated(address market, string question, uint256 deadline);

    /**
     * @dev Initializes the factory, setting the oracle, treasury, and deployer as owner.
     * @param _oracle The address of the PythiaOracle contract.
     * @param _treasury The address of the protocol treasury.
     */
    constructor(address _oracle, address _treasury) {
        require(_oracle != address(0), "Invalid oracle address");
        require(_treasury != address(0), "Invalid treasury address");
        oracle = _oracle;
        treasury = _treasury;
        owner = msg.sender;
    }

    /**
     * @dev Deploys a new PredictionMarket instance.
     * Passes any provided msg.value to the market as initial seed liquidity.
     * Only callable by the oracle or the owner of the factory.
     * @param question The question being predicted.
     * @param strikePrice The strike price for price-based markets.
     * @param deadline The unix timestamp deadline for placing bets.
     */
    function createMarket(
        string memory question,
        uint256 strikePrice,
        uint256 deadline
    ) external payable {
        require(msg.sender == owner || msg.sender == oracle, "Only owner or oracle can create markets");

        PredictionMarket newMarket = (new PredictionMarket){value: msg.value}(
            question,
            strikePrice,
            deadline,
            oracle,
            treasury
        );

        allMarkets.push(address(newMarket));

        emit MarketCreated(address(newMarket), question, deadline);
    }

    /**
     * @dev Returns an array of all created market addresses.
     * @return An array of PredictionMarket contract addresses.
     */
    function getMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    /**
     * @dev Returns the total number of markets created by the factory.
     * @return The count of all deployed markets.
     */
    function getMarketCount() external view returns (uint256) {
        return allMarkets.length;
    }
}
