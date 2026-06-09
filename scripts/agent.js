const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
if (!process.env.PRIVATE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });
}

const reasoningPath = path.join(__dirname, "../frontend/data/reasoning.json");
const historyPath = path.join(__dirname, "../frontend/data/history.json");
const activityPath = path.join(__dirname, "activity.json");
const quotaPath = path.join(__dirname, "quota.json");
const perfPath = path.join(__dirname, "../frontend/data/performance.json");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

function logActivity(type, message, marketAddress = null) {
  let data = [];
  if (fs.existsSync(activityPath)) {
    try { data = JSON.parse(fs.readFileSync(activityPath, "utf8")); } catch(e) {}
  }
  data.push({ timestamp: new Date().toISOString(), type, message, marketAddress });
  if (data.length > 100) data = data.slice(data.length - 100);
  fs.writeFileSync(activityPath, JSON.stringify(data, null, 2));

  // Push to Supabase asynchronously (fire and forget)
  if (supabase) {
    supabase.from("pythia_activity").insert([{
      type,
      message,
      market_address: marketAddress
    }]).then(({ error }) => {
      if (error) console.error("[SUPABASE ERROR]", error.message);
    });
  }
}

const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const oracleAddressMatch = constantsData.match(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const oracleAddress = oracleAddressMatch ? oracleAddressMatch[1] : "0xf4B43Db8abEe2dC653d34b09686A742ecE97C535";
const factoryAddressMatch = constantsData.match(/export const MARKET_FACTORY_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const factoryAddress = factoryAddressMatch ? factoryAddressMatch[1] : "0xAED91BD6bc2ca0AD1e002580b0B3d3B9CE2Ff54a";

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function getQuota() {
  const today = new Date().toISOString().split("T")[0];
  let quota = { date: today, counts: { PRICE: 0 }, lastMetaTime: 0 };
  if (fs.existsSync(quotaPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(quotaPath, "utf8"));
      if (saved.date === today) {
        quota = { ...quota, ...saved };
        quota.counts = { ...quota.counts, ...saved.counts };
      }
    } catch(e) {}
  }
  return quota;
}

function saveQuota(quota) {
  fs.writeFileSync(quotaPath, JSON.stringify(quota, null, 2));
}

// ─── MODULE-LEVEL SINGLETONS ─────────────────────────────────────────────────
const rpcUrl = "https://dream-rpc.somnia.network";
const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

const factoryAbi = ["function getMarkets() external view returns (address[])"];
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

const marketAbi = [
  "function question() view returns (string)",
  "function state() view returns (uint8)",
  "function deadline() view returns (uint256)",
  "function strikePrice() view returns (uint256)",
  "function closeMarket() external",
  "function resolve(bool outcome) external",
  "event BetPlaced(address indexed user, bool outcome, uint256 amount)"
];

const oracleAbi = [
  "function createMarketViaFactory(string question, uint256 strikePrice, uint256 deadline) external payable",
  "function scoreEvent(string memory eventDescription, string memory question, uint256 strikePrice, uint256 deadline, string memory category, string memory reasoningURI) external payable",
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)",
  "event MarketCreated(address market, string question, uint256 deadline)"
];
const oracle = new ethers.Contract(oracleAddress, oracleAbi, wallet);

const pendingRequests = new Map();
const isTestMode = process.argv.includes("--test");
const isDemoMode = process.argv.includes("--demo");

async function fetchCryptoPrices() {
  const data = { btc: null, eth: null, sol: null, somi: null };
  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,somnia&vs_currencies=usd");
    const json = await res.json();
    data.btc = json.bitcoin?.usd || null;
    data.eth = json.ethereum?.usd || null;
    data.sol = json.solana?.usd || null;
    data.somi = json.somnia?.usd || null;
  } catch (e) {
    console.log(`[${new Date().toISOString()}] CoinGecko Prices failed: ${e.message}`);
  }
  return data;
}

function parseAsset(question) {
  if (question.includes("BTC")) return "BTC";
  if (question.includes("ETH")) return "ETH";
  if (question.includes("SOL")) return "SOL";
  if (question.includes("SOMI")) return "SOMI";
  return null;
}

function updatePerformanceMetrics(marketAddress, outcome, bettorCount, category) {
  let perfData = { categoryStats: {}, resolvedMarkets: [] };
  if (fs.existsSync(perfPath)) {
    try { perfData = JSON.parse(fs.readFileSync(perfPath, "utf8")); } catch(e) {}
  }

  if (!perfData.categoryStats) perfData.categoryStats = {};
  if (!perfData.categoryStats[category]) {
    perfData.categoryStats[category] = { totalResolved: 0, accurateCount: 0, totalBettors: 0, weight: 1.0 };
  }

  let agentConfidence = 50;
  if (fs.existsSync(reasoningPath)) {
    try {
      const reasoning = JSON.parse(fs.readFileSync(reasoningPath, "utf8"));
      const r = reasoning.find(x => x.marketAddress === marketAddress);
      if (r && r.adjustedConfidence !== undefined) agentConfidence = r.adjustedConfidence;
    } catch(e) {}
  }

  const agentPredictedYes = agentConfidence > 50;
  const isAccurate = (agentPredictedYes && outcome) || (!agentPredictedYes && !outcome);

  perfData.categoryStats[category].totalResolved += 1;
  if (isAccurate) perfData.categoryStats[category].accurateCount += 1;
  perfData.categoryStats[category].totalBettors += bettorCount;

  const cat = perfData.categoryStats[category];
  const avgBettors = cat.totalBettors / cat.totalResolved;
  const accuracy = cat.accurateCount / cat.totalResolved;
  let newWeight = 1.0;
  if (accuracy >= 0.7) newWeight += 0.2;
  else if (accuracy < 0.5) newWeight -= 0.3;
  if (avgBettors > 5) newWeight += 0.5;
  else if (avgBettors > 2) newWeight += 0.2;
  else if (avgBettors < 1) newWeight -= 0.2;
  cat.weight = Math.max(0.2, Math.min(2.0, newWeight));

  perfData.resolvedMarkets.push({
    marketAddress, outcome, bettorCount, isAccurate, timestamp: Math.floor(Date.now() / 1000)
  });
  fs.writeFileSync(perfPath, JSON.stringify(perfData, null, 2));
  return { accuracy, avgBettors, weight: cat.weight };
}

async function runAgent() {
  console.log(`\n[${new Date().toISOString()}] ⏳ Running Pythia Autonomous Discovery...`);
  
  const quota = getQuota();
  let localCounts = { ...quota.counts };

  try {
    const existingAddresses = await factory.getMarkets();
    const existingQuestions = new Set();
    const activeAssets = new Set();
    for (const address of existingAddresses) {
      const m = new ethers.Contract(address, marketAbi, provider);
      try { 
        const q = await m.question();
        const state = await m.state();
        if (Number(state) === 0) { // Only track OPEN markets as active
          existingQuestions.add(q);
          const a = parseAsset(q);
          if (a) activeAssets.add(a);
        }
      } catch (e) {}
    }

    for (const req of pendingRequests.values()) {
      const a = parseAsset(req.dep.question);
      if (a) activeAssets.add(a);
    }

    const pendingDeployments = [];
    
    // FETCH LIVE DATA
    const currentData = await fetchCryptoPrices();
    const priceAssets = [
      { key: "btc", name: "BTC", multipliers: [1.02, 1.05] },
      { key: "eth", name: "ETH", multipliers: [1.02, 1.05] },
      { key: "sol", name: "SOL", multipliers: [1.02, 1.05] },
      { key: "somi", name: "SOMI", multipliers: [1.02, 1.05] },
    ];
    
    for (const asset of priceAssets) {
      if (activeAssets.has(asset.name)) {
        console.log(`[SKIP] An open or pending market for ${asset.name} already exists.`);
        continue;
      }

      const curr = currentData[asset.key];
      if (curr === null) continue;
      
      const strikeMultiplier = asset.multipliers[Math.floor(Math.random() * asset.multipliers.length)];
      const strike = Math.round(curr * strikeMultiplier);
      const days = isDemoMode ? "2 mins" : "7 days";
      const deadline = isDemoMode ? Math.floor(Date.now() / 1000) + 120 : Math.floor(Date.now() / 1000) + 7 * 86400;
      
      const question = `Will ${asset.name} exceed $${strike.toLocaleString()} in ${days}?`;
      
      if (!existingQuestions.has(question) && (localCounts["PRICE"] || 0) < (isDemoMode ? 100 : 20)) {
        pendingDeployments.push({
          question, targetValue: strike, deadline, category: "PRICE", dataSource: "coingecko",
          confidence: 75,
          reasonText: `${asset.name} is currently at $${curr.toLocaleString()}. Proposing a ${((strikeMultiplier - 1) * 100).toFixed(0)}% upside market based on volatility profile.`,
          dynamicStrike: strike, dynamicDeadline: isDemoMode ? 0 : 7, macroScore: 0, macroSentiment: "NEUTRAL", signalCount: 0, signals: [],
          categoryWeight: 1.0, adjustedConfidence: 75
        });
        localCounts["PRICE"] = (localCounts["PRICE"] || 0) + 1;
        existingQuestions.add(question);
      }
    }

    for (const dep of pendingDeployments) {
      console.log(`\n⚡ Discovery Trigger: Submitting to onchain LLM...`);
      logActivity("EVALUATE", `Analyzing market conditions: ${dep.reasonText}`);
      
      try {
        const platformAbi = ["function getRequestDeposit() view returns (uint256)"];
        const platformContract = new ethers.Contract("0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776", platformAbi, provider);
        const deposit = await platformContract.getRequestDeposit();

        // Include reasoning in IPFS link dummy
        const reasoningURI = "ipfs://QmdummyHashForNow";
        const tx = await oracle.scoreEvent(dep.reasonText, dep.question, dep.targetValue, dep.deadline, dep.category, reasoningURI, { value: deposit });
        const receipt = await tx.wait();
        
        let requestId = null;
        for (const log of receipt.logs) {
          try {
            const parsed = oracle.interface.parseLog(log);
            if (parsed && parsed.name === "EventScoringRequested") requestId = parsed.args[0];
          } catch(e) {}
        }

        if (requestId !== null) {
           console.log(`Waiting for Somnia LLM response for request ${requestId}...`);
           let reasoningData = [];
           if (fs.existsSync(reasoningPath)) {
             try { reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8")); } catch(e) {}
           }
           pendingRequests.set(requestId.toString(), { dep, reasoningData });
           logActivity("LLM_EVAL", `Requested on-chain LLM validation for: "${dep.question}"`);
        }
      } catch (err) {
        console.error("Failed to process event through Oracle:", err.message);
      }
    }

  } catch (error) {
    logActivity("ERROR", `Discovery phase failed: ${error.message}`);
    throw error;
  }
}

async function runResolver() {
  console.log(`\n[${new Date().toISOString()}] ⏳ Running Pythia Resolution Checker...`);
  
  try {
    const marketAddresses = await factory.getMarkets();
    const currentData = await fetchCryptoPrices();

    for (const address of marketAddresses) {
      const market = new ethers.Contract(address, marketAbi, wallet);
      const [state, deadline, strikePrice, question] = await Promise.all([
        market.state(), market.deadline(), market.strikePrice(), market.question()
      ]);

      const now = Math.floor(Date.now() / 1000);

      if (state === 0n && now >= deadline) {
        logActivity("VERDICT", `Market deadline reached. Preparing to close: ${question}`);
        const tx = await market.closeMarket();
        await tx.wait();
        console.log(`✅ Closed market: ${question}`);
        continue;
      }

      if (state === 1n) {
        logActivity("RESOLVER", `Fetching external API data to resolve: ${question}`);
        
        let outcome = false;
        const asset = parseAsset(question);
        if (asset) {
          const idMap = { "BTC": "btc", "ETH": "eth", "SOL": "sol", "SOMI": "somi" };
          const currentPrice = currentData[idMap[asset]];
          if (currentPrice !== null) {
            const numericStrike = Number(strikePrice);
            outcome = currentPrice >= numericStrike;
            console.log(`[RESOLVE] ${asset} Current Price: $${currentPrice} | Strike: $${numericStrike} -> ${outcome}`);
            
            const outcomeStr = outcome ? "YES" : "NO";
            const tx = await market.resolve(outcome);
            await tx.wait();
            
            logActivity("PAYOUT", `Resolved market: ${question} -> ${outcomeStr}. Distributing funds.`);
            
            let bettorCount = 0;
            try {
               const logs = await market.queryFilter(market.filters.BetPlaced());
               const bettorsSet = new Set(logs.map(log => {
                 const p = market.interface.parseLog({ topics: log.topics, data: log.data });
                 return p ? p.args[0] : null;
               }).filter(x => x));
               bettorCount = bettorsSet.size;
            } catch (e) {}

            updatePerformanceMetrics(address, outcome, bettorCount, "PRICE");
          }
        }
      }
    }
  } catch (error) {
    logActivity("ERROR", `Resolver phase failed: ${error.message}`);
    throw error;
  }
}

function saveReasoning(dep, reasoningData, marketAddress) {
  if (marketAddress) {
    reasoningData.push({
      marketAddress, question: dep.question, category: dep.category,
      dataSource: dep.dataSource, triggerReason: dep.reasonText, confidence: dep.confidence,
      reasoning: dep.reasonText + " — verified strictly.", macroScore: dep.macroScore, macroSentiment: dep.macroSentiment,
      signalCount: dep.signalCount, signals: dep.signals, dynamicStrike: dep.dynamicStrike,
      dynamicDeadline: dep.dynamicDeadline, categoryWeight: dep.categoryWeight, adjustedConfidence: dep.adjustedConfidence,
      timestamp: Math.floor(Date.now() / 1000)
    });
    fs.writeFileSync(reasoningPath, JSON.stringify(reasoningData, null, 2));
    
    const currentQuota = getQuota();
    currentQuota.counts[dep.category]++;
    saveQuota(currentQuota);
  }
}

oracle.on("EventScored", async (reqId, score) => {
  const key = reqId.toString();
  console.log(`\n[EVENT RECEIVED] EventScored fired for request ${key} with score ${score}`);
  const pending = pendingRequests.get(key);
  if (!pending) {
    console.log(`[WARNING] No pending request found for id ${key}. Ignoring.`);
    return;
  }

  logActivity("LLM_SCORED", `LLM scored market proposal: ${score}/100 \u2014 ${pending.dep.question}`);

  if (Number(score) > 60) {
    console.log(`\u2705 Score ${score} > 60 \u2014 market creation triggered onchain!`);
  } else {
    logActivity("REJECTED", `LLM rejected market (score ${score}/100): ${pending.dep.question}`);
  }
});

oracle.on("MarketCreated", (marketAddr, question, deadline) => {
  console.log(`\n[EVENT RECEIVED] MarketCreated fired for market ${marketAddr}: ${question}`);
  logActivity("DEPLOY", `New market deployed onchain: ${question}`, marketAddr);
  
  let matchedReqId = null;
  for (const [id, req] of pendingRequests.entries()) {
    if (req.dep.question === question) {
      matchedReqId = id;
      break;
    }
  }

  if (matchedReqId) {
    const req = pendingRequests.get(matchedReqId);
    saveReasoning(req.dep, req.reasoningData, marketAddr);
    pendingRequests.delete(matchedReqId);
    console.log(`[SUCCESS] Matched market ${marketAddr} to request ${matchedReqId} and saved reasoning.`);
  } else {
    console.log(`[WARNING] Could not match MarketCreated event to any pending request for question: ${question}`);
  }
});

console.log(`⚡ [AGENT] Initialized ${isDemoMode ? "in DEMO MODE (120s deadlines)" : "for PRODUCTION"}`);
console.log(`⚡ [AGENT] Persistent listeners registered.`);

let consecutiveErrors = 0;
const MAX_RETRIES = 5;

async function mainLoop() {
  try {
    await runAgent();
    await runResolver();
    consecutiveErrors = 0; // reset on success
  } catch (error) {
    consecutiveErrors++;
    console.error(`[ERROR] Main loop failed (Attempt ${consecutiveErrors}/${MAX_RETRIES}):`, error.message);
    if (consecutiveErrors >= MAX_RETRIES) {
      logActivity("FATAL", "Max retries exceeded. Halting operations for 1 hour to prevent infinite loops.");
      console.log("Max retries exceeded. Sleeping for 1 hour...");
      setTimeout(mainLoop, 60 * 60 * 1000);
      return;
    }
  }

  const baseIntervalMs = isDemoMode ? 15000 : 15 * 60 * 1000;
  // Exponential backoff if there are errors (1x, 2x, 4x, 8x...)
  const nextIntervalMs = consecutiveErrors > 0 
    ? baseIntervalMs * (2 ** (consecutiveErrors - 1)) 
    : baseIntervalMs;
    
  setTimeout(mainLoop, nextIntervalMs);
}

mainLoop();
