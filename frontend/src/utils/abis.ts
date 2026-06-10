export const MARKET_FACTORY_ABI = [
  "function getMarkets() external view returns (address[] memory)",
  "function getMarketCount() external view returns (uint256)",
  "function createMarket(string question, uint256 strikePrice, uint256 deadline, string category, string reasoningURI) external payable",
  "event MarketCreated(address market, string question, uint256 deadline, string category, string reasoningURI)"
];

export const PREDICTION_MARKET_ABI = [
  "function question() view returns (string)",
  "function strikePrice() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function oracle() view returns (address)",
  "function totalYes() view returns (uint256)",
  "function totalNo() view returns (uint256)",
  "function outcome() view returns (bool)",
  "function state() view returns (uint8)",
  "function placeBet(bool side) external payable",
  "function claimWinnings() external",
  "function yesBets(address) view returns (uint256)",
  "function noBets(address) view returns (uint256)",
  "event BetPlaced(address indexed user, bool side, uint256 amount)",
  "event MarketClosed()",
  "event MarketResolved(bool outcome)",
  "event WinningsClaimed(address indexed user, uint256 amount)"
];

export const PYTHIA_ORACLE_ABI = [
  "function scoreEvent(string eventDescription, string question, uint256 strikePrice, uint256 deadline, string category, string reasoningURI) external payable",
  "function requestResolution(address marketAddress) external payable",
  "function setMarketFactory(address _factory) external",
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)",
  "event ResolutionRequested(uint256 requestId, address market)",
  "event PriceReceived(uint256 requestId, uint256 price)"
];
