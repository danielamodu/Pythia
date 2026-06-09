# Pythia Codebase Audit: Critical Vulnerabilities

Here is the targeted audit of your current codebase focusing on the four vulnerabilities requested, along with the exact patches needed to secure your hackathon score.

## 1. Oracle Hallucination (No Optimistic Timelock)

**Vulnerability:**
Your `PredictionMarket.sol` has no dispute period. When `resolve(bool _outcome)` is called by the oracle, the market state immediately transitions to `RESOLVED` and bettors can claim winnings. If the Somnia LLM hallucinates or the JSON API parses incorrect data, the funds are instantly drained. There is no way for an admin to intervene.

**Patch:**
Introduce a `resolvedAt` timestamp and a 24-hour dispute timelock before claims are allowed. Add an `adminOverride` function for the treasury.

**`PredictionMarket.sol` adjustments:**
```solidity
// 1. Add new state variables
uint256 public resolvedAt;
uint256 public constant DISPUTE_PERIOD = 24 hours;

// 2. Modify resolve() to set the timestamp
function resolve(bool _outcome) external {
    require(state == MarketState.CLOSED, "Market must be closed before resolution");
    require(msg.sender == oracle, "Only oracle can resolve");

    outcome = _outcome;
    state = MarketState.RESOLVED;
    resolvedAt = block.timestamp; // <-- PATCH

    emit MarketResolved(_outcome);
}

// 3. Add an admin override function
function adminOverride(bool _outcome) external {
    require(msg.sender == treasury, "Only treasury can override");
    require(state == MarketState.RESOLVED, "Market must be resolved first");
    require(block.timestamp < resolvedAt + DISPUTE_PERIOD, "Dispute period ended");
    
    outcome = _outcome;
    emit MarketResolved(_outcome);
}

// 4. Modify claimWinnings() to enforce the timelock
function claimWinnings() external {
    require(state == MarketState.RESOLVED, "Market is not resolved");
    require(block.timestamp >= resolvedAt + DISPUTE_PERIOD, "Dispute period active"); // <-- PATCH
    require(!hasClaimed[msg.sender], "Already claimed");
    // ... existing logic
```

## 2. Market Spam (Unconstrained API Fetches)

**Vulnerability:**
In `scripts/agent.js`, the agent fetches news from CryptoCompare and blindly queues a market for the first headline without verifying the credibility of the underlying news source. 
```javascript
const headline = currentData.news[0];
const isHype = /surge|rally|.../i.test(headline);
```
An attacker could publish a fake press release with hype keywords, and the agent would automatically spin up a market.

**Patch:**
Constraint the API fetch to a strict whitelist of high-signal sources, and inject a strict evaluation prompt into the `reasonText` sent to the on-chain LLM.

**`scripts/agent.js` adjustments:**
```javascript
// 1. Filter API fetch to whitelist
const ALLOWED_SOURCES = ["bloomberg", "reuters", "coindesk", "cointelegraph", "wsj"];
try {
  const res = await fetchWithTimeout("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=20");
  const json = await res.json();
  if (json && json.Data) {
    // Filter only reputable sources
    const reputable = json.Data.filter(n => 
      n.source_info && ALLOWED_SOURCES.includes(n.source_info.name.toLowerCase())
    );
    data.news = reputable.map(n => n.title);
  }
} catch (e) {}

// 2. Strengthen the LLM prompt in queueMarket
queueMarket({
  question: `Will BTC ${direction} $${strike.toLocaleString()} in ${days} days? (News: ${headline.slice(0, 60)}...)`,
  targetValue: strike, deadline, category: "NEWS", dataSource: "cryptocompare",
  confidence: 78, 
  reasonText: `STRICT EVALUATION: Breaking news: "${headline}". 
  1. Verify if this is a globally significant macroeconomic event. 
  2. Reject if this sounds like an opinion piece, low-cap shill, or unverified rumor. 
  Score 0-100 for market validity. Only score > 60 if verifiable and highly impactful.`,
  // ...
});
```

## 3. AMM Math & Liquidity

**Vulnerability:**
You are **not** using a constant product curve (`x * y = k`). Your contract implements a **Pari-Mutuel pool** where payout is `(userBetAmount * totalPool) / winningPool`. 

*Good news:* Pari-mutuel math cannot be "drained" by arbitrageurs because the contract never holds fixed liability. The payout dynamically adjusts so the contract always pays exactly what is in the pool (minus the 2% fee).
*Bad news:* Pari-mutuel pools suffer from "last-minute sniping", where whales wait until 1 minute before the deadline to bet, guaranteeing they get the best odds without taking on time risk.

**Patch:**
You don't need a full AMM rewrite, which is too complex to securely implement mid-hackathon. Instead, implement a dynamic fee that heavily penalizes late betting to protect early liquidity providers.

**`PredictionMarket.sol` adjustments:**
```solidity
// Inside placeBet()
function placeBet(bool side) external payable {
    require(state == MarketState.OPEN, "Market is not open");
    require(block.timestamp < deadline, "Deadline has passed");
    require(msg.value > 0, "Bet amount must be greater than zero");

    // Implement Late-Betting Penalty (Protects early liquidity)
    uint256 timeRemaining = deadline - block.timestamp;
    uint256 effectiveValue = msg.value;
    
    if (timeRemaining < 24 hours) {
        // Flat 5% penalty for late bets added to protocol treasury
        uint256 lateFee = (msg.value * 500) / 10000;
        feesToWithdraw += lateFee;
        effectiveValue = msg.value - lateFee;
    }

    if (side) {
        yesBets[msg.sender] += effectiveValue;
        totalYes += effectiveValue;
    } else {
        // ...
```

## 4. Off-Chain Reliance (Ephemeral Truth)

**Vulnerability:**
Your agent's reasoning, confidence scores, and market categories are being saved exclusively to a local file (`frontend/data/reasoning.json`). If the Node.js agent restarts or the container spins down, your entire UI breaks because the blockchain only stores the `question` and `deadline`. The backend is acting as the source of truth for the AI's reasoning.

**Patch:**
Store the agent's contextual metadata (category, confidence, reasoning URI) immutably on-chain during market creation. 

**Contract Adjustments (`PythiaOracle.sol` & `MarketFactory.sol`):**
```solidity
// PythiaOracle.sol
function createMarketViaFactory(
    string memory question, 
    uint256 strikePrice, 
    uint256 deadline,
    string memory category,     // <-- PATCH
    string memory reasoningURI  // <-- PATCH
) external payable { ... }

// MarketFactory.sol
event MarketCreated(address market, string question, uint256 deadline, string category, string reasoningURI);

function createMarket(
    string memory question,
    uint256 strikePrice,
    uint256 deadline,
    string memory category,     // <-- PATCH
    string memory reasoningURI  // <-- PATCH
) external payable { ... }
```
*Implementation note:* In `agent.js`, instead of just saving to `reasoning.json`, you would upload the reasoning to IPFS/Arweave (or just use a tiny JSON blob as a string) and pass it to the contract. The UI should read the `MarketCreated` event logs to fetch the category and reasoning, eliminating the dependency on the local `.json` file.
