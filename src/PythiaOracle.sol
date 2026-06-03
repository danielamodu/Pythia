// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Type of consensus required for a request
enum ConsensusType { Majority, Threshold }

/// @notice Status of an agent response
enum ResponseStatus { None, Pending, Success, Failed, TimedOut }

/// @notice Struct representing an individual agent response
struct Response {
    bytes result;
    address agent;
    uint256 timestamp;
}

/// @notice Struct representing a request to an agent
struct Request {
    uint256 agentId;
    bytes payload;
    ConsensusType consensusType;
    uint256 threshold;
    address callbackAddress;
    bytes4 callbackSelector;
    uint256 deadline;
}

/// @notice Interface for interacting with the Somnia platform agent requester
interface IAgentRequester {
    /// @notice Creates a new request to an agent
    /// @param request The request details
    /// @return The unique ID of the created request
    function createRequest(Request calldata request) external payable returns (uint256);

    /// @notice Gets the required deposit amount for a specific agent ID
    /// @param agentId The ID of the agent
    /// @return The required deposit in wei
    function getRequestDeposit(uint256 agentId) external view returns (uint256);
}

/// @notice Interface for handling responses from the Somnia platform
interface IAgentRequesterHandler {
    /// @notice Callback invoked by the platform when a request is fulfilled, failed, or timed out
    /// @param requestId The ID of the request
    /// @param status The final status of the request
    /// @param responses Array of responses from agents
    /// @param context Additional context passed during request creation
    function handleResponse(
        uint256 requestId,
        ResponseStatus status,
        Response[] calldata responses,
        bytes calldata context
    ) external;
}

/// @notice Interface for interacting with the MarketFactory
interface IMarketFactory {
    function createMarket(string memory question, uint256 strikePrice, uint256 deadline) external payable;
}

/// @title PythiaOracle
/// @notice Autonomous prediction market oracle for Somnia testnet
contract PythiaOracle is IAgentRequesterHandler {
    /// @notice The SomniaAgents platform address
    address public immutable platform;

    /// @notice The owner (deployer) of the contract
    address public owner;

    /// @notice The MarketFactory address
    address public marketFactory;

    /// @notice Placeholder ID for the JSON API Agent
    uint256 public constant JSON_API_AGENT_ID = 1;

    /// @notice Mapping to track pending requests by ID
    mapping(uint256 => bool) public pendingRequests;

    /// @notice Mapping to store metadata (e.g., URL) for each request ID
    mapping(uint256 => string) public requestMeta;

    /// @notice Event emitted when a price fetch request is initiated
    /// @param requestId The ID of the request
    /// @param url The URL being fetched
    event PriceRequested(uint256 requestId, string url);

    /// @notice Event emitted when a price is successfully received
    /// @param requestId The ID of the request
    /// @param price The price fetched
    event PriceReceived(uint256 requestId, uint256 price);

    /// @notice Constructor to initialize the platform address and owner
    /// @param _platform The SomniaAgents platform contract address
    constructor(address _platform) {
        platform = _platform;
        owner = msg.sender;
    }

    /// @notice Requests a price fetch from a specific URL and JSON path
    /// @param url The URL to fetch data from
    /// @param jsonPath The JSON path to extract the value from
    function requestPriceFetch(string calldata url, string calldata jsonPath) external payable {
        // Encode the payload for the agent (assumes the agent expects a string function name followed by arguments)
        bytes memory payload = abi.encode("fetchUint", url, jsonPath);

        // Build the request object
        Request memory request = Request({
            agentId: JSON_API_AGENT_ID,
            payload: payload,
            consensusType: ConsensusType.Majority,
            threshold: 1, // Single response is sufficient for now
            callbackAddress: address(this),
            callbackSelector: this.handleResponse.selector,
            deadline: block.timestamp + 1 hours // Timeout after 1 hour
        });

        // Ensure sufficient msg.value was provided for the deposit
        uint256 requiredDeposit = IAgentRequester(platform).getRequestDeposit(JSON_API_AGENT_ID);
        require(msg.value >= requiredDeposit, "Insufficient deposit for request");

        // Send the request to the platform
        uint256 requestId = IAgentRequester(platform).createRequest{value: msg.value}(request);

        // Store request state
        pendingRequests[requestId] = true;
        requestMeta[requestId] = url;

        // Emit event
        emit PriceRequested(requestId, url);
    }

    /// @notice Callback function used by the Somnia platform to deliver the agent's response
    /// @param requestId The ID of the completed request
    /// @param status The final status of the request
    /// @param responses Array of agent responses
    /// @param context Optional context bytes
    function handleResponse(
        uint256 requestId,
        ResponseStatus status,
        Response[] calldata responses,
        bytes calldata context
    ) external override {
        // Enforce access control to ensure only the platform can call this function
        require(msg.sender == platform, "Only platform can call");

        // Check if the request is actually pending
        require(pendingRequests[requestId], "Request not pending");

        // Mark the request as no longer pending
        pendingRequests[requestId] = false;

        // Process successful responses
        if (status == ResponseStatus.Success && responses.length > 0) {
            // Decode the uint256 price from the first response's result
            uint256 price = abi.decode(responses[0].result, (uint256));
            
            emit PriceReceived(requestId, price);
        }
    }

    /// @notice Sets the MarketFactory address. Only callable by the owner.
    /// @param _factory The address of the new MarketFactory
    function setMarketFactory(address _factory) external {
        require(msg.sender == owner, "Only owner can set factory");
        require(_factory != address(0), "Invalid factory address");
        marketFactory = _factory;
    }

    /// @notice Creates a new PredictionMarket via the factory. Only callable by the owner.
    /// @param question The question being predicted.
    /// @param strikePrice The strike price for price-based markets.
    /// @param deadline The deadline after which bets can no longer be placed.
    function createMarketViaFactory(string memory question, uint256 strikePrice, uint256 deadline) external payable {
        require(msg.sender == owner, "Only owner can create markets via factory");
        require(marketFactory != address(0), "MarketFactory not set");
        
        IMarketFactory(marketFactory).createMarket{value: msg.value}(question, strikePrice, deadline);
    }

    /// @notice Allow the contract to receive ETH (e.g., for unused deposit rebates from the platform)
    receive() external payable {}
}
