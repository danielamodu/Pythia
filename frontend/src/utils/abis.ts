export const MARKET_FACTORY_ABI = [
  "function getMarkets() external view returns (address[] memory)",
  "function getMarketCount() external view returns (uint256)",
  "event MarketCreated(address market, string question, uint256 deadline)"
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
  "function requestPriceFetch(string calldata url, string calldata jsonPath) external payable",
  "function scoreEvent(string memory eventDescription, string memory question, uint256 strikePrice, uint256 deadline) external payable",
  "function createMarketIfScoreHigh(uint256 requestId) external payable",
  "function eventScores(uint256) view returns (uint256)",
  "event PriceRequested(uint256 requestId, string url)",
  "event PriceReceived(uint256 requestId, uint256 price)",
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)"
];
