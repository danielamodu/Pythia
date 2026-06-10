// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Type of consensus required for a request
enum ConsensusType { Majority, Threshold }

/// @notice Status of an agent response
enum ResponseStatus {
    None,       // 0 - Default zero value
    Pending,    // 1 - Awaiting responses
    Success,    // 2 - Consensus reached normally
    Failed,     // 3 - Validators reported failure
    TimedOut    // 4 - Request timed out
}

/// @notice Struct representing an individual agent response
struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

/// @notice Interface for interacting with the Somnia platform agent requester
interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

/// @notice Interface for handling responses from the Somnia platform
interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}

interface IMarketFactory {
    function createMarket(string memory question, uint256 strikePrice, uint256 deadline, string memory category, string memory reasoningURI) external payable;
}

interface IPredictionMarket {
    function question() external view returns (string memory);
    function strikePrice() external view returns (uint256);
    function deadline() external view returns (uint256);
    function state() external view returns (uint8);
    function resolve(bool outcome) external;
}

/// @title PythiaOracle
/// @notice Autonomous prediction market oracle for Somnia testnet
contract PythiaOracle is IAgentRequesterHandler {
    address public immutable platform;
    address public owner;
    address public marketFactory;

    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384;

    mapping(uint256 => bool) public pendingRequests;
    
    // For tracking market creation (LLM_INFERENCE)
    mapping(uint256 => string) public pendingQuestions;
    mapping(uint256 => uint256) public pendingStrikePrices;
    mapping(uint256 => uint256) public pendingDeadlines;
    mapping(uint256 => string) public pendingCategories;
    mapping(uint256 => string) public pendingReasoningURIs;

    // For tracking market resolution (JSON_API)
    mapping(uint256 => address) public resolutionRequests;

    event EventScoringRequested(uint256 requestId, string eventDescription);
    event EventScored(uint256 requestId, uint256 score);
    event ResolutionRequested(uint256 requestId, address market);
    event PriceReceived(uint256 requestId, uint256 price);

    constructor(address _platform) {
        platform = _platform;
        owner = msg.sender;
    }

    /// @notice Calls Somnia's LLM inference agent to score an event
    function scoreEvent(
        string memory eventDescription,
        string memory question,
        uint256 strikePrice,
        uint256 deadline,
        string memory category,
        string memory reasoningURI
    ) external payable {
        bytes memory payload = abi.encodeWithSignature("inferNumber(string,uint256,uint256)", eventDescription, uint256(0), uint256(100));

        uint256 requiredDeposit = IAgentRequester(platform).getRequestDeposit();
        require(msg.value >= requiredDeposit, "Insufficient deposit for request");

        uint256 requestId = IAgentRequester(platform).createRequest{value: msg.value}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        pendingQuestions[requestId] = question;
        pendingStrikePrices[requestId] = strikePrice;
        pendingDeadlines[requestId] = deadline;
        pendingCategories[requestId] = category;
        pendingReasoningURIs[requestId] = reasoningURI;

        emit EventScoringRequested(requestId, eventDescription);
    }

    /// @notice Requests resolution for a market
    function requestResolution(address marketAddress) external payable {
        IPredictionMarket market = IPredictionMarket(marketAddress);
        require(market.state() == 1, "Market is not closed"); // 1 = CLOSED

        string memory question = market.question();
        string memory url;
        string memory jsonPath;

        // Basic parsing to figure out the asset
        if (_contains(question, "BTC")) {
            url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
            jsonPath = "bitcoin.usd";
        } else if (_contains(question, "ETH")) {
            url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
            jsonPath = "ethereum.usd";
        } else if (_contains(question, "SOL")) {
            url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
            jsonPath = "solana.usd";
        } else if (_contains(question, "SOMI") || _contains(question, "Somnia")) {
            url = "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd";
            jsonPath = "somnia.usd";
        } else {
            revert("Unknown asset in question");
        }

        bytes memory payload = abi.encodeWithSignature("fetchUint(string,string,uint8)", url, jsonPath, uint8(8));

        uint256 requiredDeposit = IAgentRequester(platform).getRequestDeposit();
        require(msg.value >= requiredDeposit, "Insufficient deposit for request");

        uint256 requestId = IAgentRequester(platform).createRequest{value: msg.value}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        resolutionRequests[requestId] = marketAddress;

        emit ResolutionRequested(requestId, marketAddress);
    }

    /// @notice Callback from platform
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external override {
        require(msg.sender == platform, "Only platform can call");
        require(pendingRequests[requestId], "Request not pending");

        pendingRequests[requestId] = false;

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 resultValue = abi.decode(responses[0].result, (uint256));

            if (bytes(pendingQuestions[requestId]).length > 0) {
                // It was an event scoring
                emit EventScored(requestId, resultValue);
                if (resultValue > 60 && marketFactory != address(0)) {
                    string memory q = pendingQuestions[requestId];
                    uint256 sp = pendingStrikePrices[requestId];
                    uint256 dl = pendingDeadlines[requestId];
                    string memory cat = pendingCategories[requestId];
                    string memory uri = pendingReasoningURIs[requestId];
                    IMarketFactory(marketFactory).createMarket{value: 0.005 ether}(q, sp, dl, cat, uri);
                }
            } else if (resolutionRequests[requestId] != address(0)) {
                // It was a resolution request
                emit PriceReceived(requestId, resultValue);
                address marketAddress = resolutionRequests[requestId];
                uint256 strikePrice = IPredictionMarket(marketAddress).strikePrice();
                bool outcome = resultValue >= strikePrice;
                IPredictionMarket(marketAddress).resolve(outcome);
            }
        }
    }

    function _contains(string memory what, string memory find) internal pure returns (bool) {
        bytes memory whatBytes = bytes(what);
        bytes memory findBytes = bytes(find);
        if(findBytes.length == 0) return true;
        if(whatBytes.length < findBytes.length) return false;
        
        for (uint i = 0; i <= whatBytes.length - findBytes.length; i++) {
            bool found = true;
            for (uint j = 0; j < findBytes.length; j++) {
                if (whatBytes[i + j] != findBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }

    function setMarketFactory(address _factory) external {
        require(msg.sender == owner, "Only owner can set factory");
        require(_factory != address(0), "Invalid factory address");
        marketFactory = _factory;
    }

    function createMarketViaFactory(
        string memory question, 
        uint256 strikePrice, 
        uint256 deadline,
        string memory category,
        string memory reasoningURI
    ) external payable {
        require(msg.sender == owner, "Only owner can call this");
        require(marketFactory != address(0), "MarketFactory not set");
        IMarketFactory(marketFactory).createMarket{value: msg.value}(question, strikePrice, deadline, category, reasoningURI);
    }

    /// @notice Force resolves a market in case of platform issues. Only callable by owner.
    function forceResolveMarket(address marketAddress, bool _outcome) external {
        require(msg.sender == owner, "Only owner can force resolve");
        IPredictionMarket(marketAddress).resolve(_outcome);
    }

    receive() external payable {}
}
