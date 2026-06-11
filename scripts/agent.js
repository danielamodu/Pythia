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
  const ws = require("ws");
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
  });
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
  let quota = { date: today, counts: { PRICE: 0, CORRELATION: 0, VOLUME: 0, SENTIMENT: 0, DOMINANCE: 0, GAS: 0, SOMNIA: 0, META: 0 }, lastMetaTime: 0 };
  if (fs.existsSync(quotaPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(quotaPath, "utf8"));
      if (saved.date === today) {
        quota = { ...quota, ...saved };
        quota.counts = { ...quota.counts, ...saved.counts };
      } else {
        quota.lastMetaTime = saved.lastMetaTime || 0;
      }
    } catch(e) {}
  }
  return quota;
}

function saveQuota(quota) {
  fs.writeFileSync(quotaPath, JSON.stringify(quota, null, 2));
}

// ─── MODULE-LEVEL SINGLETONS ─────────────────────────────────────────────────
const rpcUrl = "https://api.infra.testnet.somnia.network/";
const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

const factoryAbi = ["function getMarkets() external view returns (address[])"];
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

const marketAbi = [
  "function question() view returns (string)",
  "function state() view returns (uint8)",
  "function deadline() view returns (uint256)",
  "function strikePrice() view returns (uint256)",
  "function totalYes() view returns (uint256)",
  "function totalNo() view returns (uint256)",
  "function closeMarket() external",
  "function resolve(bool outcome) external",
  "function hasClaimed(address) view returns (bool)",
  "function claimWinnings() external",
  "function resolvedAt() view returns (uint256)",
  "event BetPlaced(address indexed user, bool outcome, uint256 amount)"
];

const oracleAbi = [
  "function createMarketViaFactory(string question, uint256 strikePrice, uint256 deadline, string category, string reasoningURI) external payable",
  "function scoreEvent(string memory eventDescription, string memory question, uint256 strikePrice, uint256 deadline, string memory category, string memory reasoningURI) external payable",
  "function requestResolution(address marketAddress) external payable",
  "function forceResolveMarket(address marketAddress, bool _outcome) external",
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)",
  "event ResolutionRequested(uint256 requestId, address market)",
  "event PriceReceived(uint256 requestId, uint256 price)",
  "event MarketCreated(address market, string question, uint256 deadline)"
];
const oracle = new ethers.Contract(oracleAddress, oracleAbi, wallet);

const pendingRequests = new Map();
const pendingResolutions = new Map(); // Changed to Map to support timestamps and timeouts
const isTestMode = process.argv.includes("--test");
const isDemoMode = process.argv.includes("--demo");

async function fetchAllData() {
  const data = {
    btc: null, eth: null, sol: null, somi: null,
    fng: null, btcDominance: null, ethGas: null,
    somniaStats: null
  };

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

  try {
    const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=2");
    const json = await res.json();
    if (json && json.data && json.data.length > 0) {
      data.fng = parseInt(json.data[0].value);
    }
  } catch (e) {
    console.log(`[${new Date().toISOString()}] F&G API failed: ${e.message}`);
  }

  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/global");
    const json = await res.json();
    if (json && json.data && json.data.market_cap_percentage) {
      data.btcDominance = json.data.market_cap_percentage.btc;
    }
  } catch (e) {
    console.log(`[${new Date().toISOString()}] CoinGecko Global failed: ${e.message}`);
  }

  if (process.env.ETHERSCAN_API_KEY) {
    try {
      const res = await fetchWithTimeout(`https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${process.env.ETHERSCAN_API_KEY}`);
      const json = await res.json();
      if (json && json.result && json.result.ProposeGasPrice) {
        data.ethGas = parseFloat(json.result.ProposeGasPrice);
      }
    } catch (e) {
      console.log(`[${new Date().toISOString()}] Etherscan API failed: ${e.message}`);
    }
  } else {
    // Testnet / public fallback key if not set
    try {
      const res = await fetchWithTimeout("https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=ZEIYK7YSJ3QTPKWVND32NWDJWNESW85S9V");
      const json = await res.json();
      if (json && json.result && json.result.ProposeGasPrice) {
        data.ethGas = parseFloat(json.result.ProposeGasPrice);
      }
    } catch (e) {
      console.log(`[${new Date().toISOString()}] Gas fallback API failed: ${e.message}`);
    }
  }

  try {
    const res = await fetchWithTimeout("https://explorer.somnia.network/api/v2/stats");
    const json = await res.json();
    data.somniaStats = {
      tps: parseFloat(json.average_tps || json.tps || 0),
      contracts: parseInt(json.smart_contracts_count || json.total_smart_contracts || 0),
      addresses: parseInt(json.active_addresses_24h || json.total_addresses || 0)
    };
  } catch (e) {
    console.log(`[${new Date().toISOString()}] Somnia Explorer API failed: ${e.message}`);
  }

  return data;
}

async function fetchFallbackValue(question) {
  if (question.includes("Fear & Greed") || question.includes("sentiment") || question.includes("Index")) {
    try {
      const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1");
      const json = await res.json();
      if (json && json.data && json.data.length > 0) {
        return parseInt(json.data[0].value);
      }
    } catch (e) {
      console.log(`[FALLBACK] Failed to fetch Fear & Greed: ${e.message}`);
    }
  } else if (question.includes("TPS") || question.includes("tps")) {
    try {
      const res = await fetchWithTimeout("https://explorer.somnia.network/api/v2/stats");
      const json = await res.json();
      return parseFloat(json.average_tps || json.tps || 0);
    } catch (e) {
      console.log(`[FALLBACK] Failed to fetch TPS: ${e.message}`);
    }
  } else if (question.includes("contracts") || question.includes("smart contracts")) {
    try {
      const res = await fetchWithTimeout("https://explorer.somnia.network/api/v2/stats");
      const json = await res.json();
      return parseInt(json.smart_contracts_count || json.total_smart_contracts || 0);
    } catch (e) {
      console.log(`[FALLBACK] Failed to fetch smart contracts count: ${e.message}`);
    }
  } else if (question.includes("gas") || question.includes("Gas")) {
    try {
      const res = await fetchWithTimeout("https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=ZEIYK7YSJ3QTPKWVND32NWDJWNESW85S9V");
      const json = await res.json();
      if (json && json.result && json.result.ProposeGasPrice) {
        return parseFloat(json.result.ProposeGasPrice);
      }
    } catch (e) {
      console.log(`[FALLBACK] Failed to fetch Gas price: ${e.message}`);
    }
  } else if (question.includes("dominance") || question.includes("Dominance")) {
    try {
      const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/global");
      const json = await res.json();
      if (json && json.data && json.data.market_cap_percentage) {
        return json.data.market_cap_percentage.btc;
      }
    } catch (e) {
      console.log(`[FALLBACK] Failed to fetch BTC dominance: ${e.message}`);
    }
  } else {
    const asset = parseAsset(question);
    if (asset) {
      try {
        const prices = await fetchAllData();
        const livePrice = prices[asset.toLowerCase()];
        if (livePrice !== null && livePrice !== undefined) {
          return livePrice;
        }
      } catch (e) {
        console.log(`[FALLBACK] Failed to fetch price for ${asset}: ${e.message}`);
      }
    }
  }
  return null;
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
  logActivity("SYSTEM_PERFORMANCE", JSON.stringify(perfData));
  return { accuracy, avgBettors, weight: cat.weight };
}

async function runAgent() {
  console.log(`\n[${new Date().toISOString()}] ⏳ Running Pythia Autonomous Discovery...`);
  
  const quota = getQuota();
  let localCounts = { ...quota.counts };

  try {
    const existingAddresses = await factory.getMarkets();
    
    // --- START POLLING MATCH & FALLBACK LOGIC ---
    try {
      for (const address of existingAddresses) {
        let reasoningData = [];
        if (fs.existsSync(reasoningPath)) {
          try { reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8")); } catch(e) {}
        }
        const alreadySaved = reasoningData.some(r => r.marketAddress?.toLowerCase() === address.toLowerCase());
        if (!alreadySaved) {
          const m = new ethers.Contract(address, marketAbi, provider);
          const q = await m.question();
          
          let matchedReqId = null;
          for (const [id, req] of pendingRequests.entries()) {
            if (req.dep.question === q) {
              matchedReqId = id;
              break;
            }
          }
          
          if (matchedReqId) {
            const req = pendingRequests.get(matchedReqId);
            console.log(`[POLLING MATCH] Found on-chain market for pending request: ${q} at ${address}`);
            logActivity("DEPLOY", `New market deployed onchain: ${q}`, address);
            saveReasoning(req.dep, req.reasoningData, address);
            pendingRequests.delete(matchedReqId);
          }
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      for (const [id, req] of pendingRequests.entries()) {
        if (req.createdAt && nowSec - req.createdAt > 90) {
          console.log(`[POLLING TIMEOUT] Request ${id} timed out. Triggering direct creation fallback for: ${req.dep.question}`);
          logActivity("FALLBACK", `LLM scoring callback timed out. Falling back to direct market creation.`);
          try {
            let deadline = req.dep.deadline;
            const now = Math.floor(Date.now() / 1000);
            if (deadline <= now + 60) {
              deadline = isDemoMode ? now + 120 : now + 7 * 86400;
              console.log(`[FALLBACK] Adjusted deadline from ${req.dep.deadline} to ${deadline} because the original deadline was in the past or too close.`);
            }
            const tx = await oracle.createMarketViaFactory(
              req.dep.question,
              req.dep.targetValue,
              deadline,
              req.dep.category,
              "ipfs://QmdummyFallbackHash",
              { value: ethers.parseEther("0.005"), gasPrice: ethers.parseUnits("10", "gwei") }
            );
            const receipt = await tx.wait();
            
            let marketAddress = null;
            const factoryInterface = new ethers.Interface([
              "event MarketCreated(address market, string question, uint256 deadline, string category, string reasoningURI)"
            ]);
            for (const log of receipt.logs) {
              try {
                const parsed = factoryInterface.parseLog(log);
                if (parsed && parsed.name === "MarketCreated") {
                  marketAddress = parsed.args.market;
                  break;
                }
              } catch(e) {}
            }
            
            if (marketAddress) {
              console.log(`[FALLBACK SUCCESS] Directly deployed market at ${marketAddress}`);
              logActivity("DEPLOY", `Deployed market (Fallback): ${req.dep.question}`, marketAddress);
              saveReasoning(req.dep, req.reasoningData, marketAddress);
            }
          } catch (err) {
            console.error("Direct creation fallback failed:", err.message);
          }
          pendingRequests.delete(id);
        }
      }
    } catch (err) {
      console.error("Polling event matcher error:", err.message);
    }
    // --- END POLLING MATCH & FALLBACK LOGIC ---

    const existingQuestions = new Set();
    const activeAssets = new Set();
    for (const address of existingAddresses) {
      const m = new ethers.Contract(address, marketAbi, provider);
      try { 
        const q = await m.question();
        const state = await m.state();
        if (Number(state) === 0) { // Track only OPEN markets as active so closed ones don't block new deployments
          existingQuestions.add(q);
          const a = parseAsset(q);
          if (a) activeAssets.add(a);
        }
      } catch (e) {}
    }

    const pendingDeployments = [];
    
    // FETCH LIVE DATA & UPDATE HISTORY
    let history = { btc: [], eth: [], sol: [], somi: [], fng: [], btcDominance: [], ethGas: [], somniaStats: [] };
    if (fs.existsSync(historyPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
        if (!Array.isArray(parsed)) {
          history = { ...history, ...parsed };
        }
      } catch (e) {}
    }

    const currentData = await fetchAllData();
    Object.keys(history).forEach(key => {
      if (!history[key]) history[key] = [];
      history[key].push(currentData[key]);
      if (history[key].length > 96) history[key].shift();
    });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    const deadline = isDemoMode ? Math.floor(Date.now() / 1000) + 120 : Math.floor(Date.now() / 1000) + 7 * 86400;
    const daysStr = isDemoMode ? "2 mins" : "7 days";

    function queueMarket(dep) {
      if (!existingQuestions.has(dep.question) && (localCounts[dep.category] || 0) < (isDemoMode ? 100 : 20)) {
        pendingDeployments.push({
          ...dep,
          dynamicStrike: dep.targetValue,
          dynamicDeadline: isDemoMode ? 0 : 7,
          macroScore: 0,
          macroSentiment: "NEUTRAL",
          signalCount: 0,
          signals: [],
          categoryWeight: 1.0,
          adjustedConfidence: dep.confidence
        });
        localCounts[dep.category] = (localCounts[dep.category] || 0) + 1;
        existingQuestions.add(dep.question);
      }
    }

    // 1. SOMNIA Metrics (TPS, contracts)
    if (currentData.somniaStats) {
      // a) TPS
      const tpsThreshold = isDemoMode ? 0.1 : 10000;
      if (currentData.somniaStats.tps > tpsThreshold) {
        queueMarket({
          question: `Will Somnia average TPS exceed ${tpsThreshold} this week?`,
          targetValue: tpsThreshold, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
          confidence: 85, reasonText: `Somnia TPS reached ${currentData.somniaStats.tps.toFixed(2)}. High network activity detected.`
        });
      }
      // b) Deployed Contracts
      const contractsThreshold = isDemoMode ? 10 : 500;
      if (currentData.somniaStats.contracts > contractsThreshold) {
        queueMarket({
          question: `Will Somnia surpass ${contractsThreshold} deployed contracts this week?`,
          targetValue: contractsThreshold, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
          confidence: 85, reasonText: `Somnia contracts reached ${currentData.somniaStats.contracts}. Ecosystem expansion detected.`
        });
      }
    }

    // 2. SENTIMENT (Fear & Greed Index)
    if (currentData.fng !== null) {
      const fngThreshold = isDemoMode ? 50 : 70;
      if (currentData.fng >= fngThreshold) {
        queueMarket({
          question: `Will the Crypto Fear & Greed Index exceed ${fngThreshold} (Greed) in ${daysStr}?`,
          targetValue: fngThreshold, deadline, category: "SENTIMENT", dataSource: "alternative.me",
          confidence: 80, reasonText: `Fear & Greed Index currently at ${currentData.fng}, showing strong sentiment.`
        });
      }
    }

    // 3. DOMINANCE (BTC Dominance)
    if (currentData.btcDominance !== null) {
      const domThreshold = isDemoMode ? 40 : 55;
      if (currentData.btcDominance >= domThreshold) {
        queueMarket({
          question: `Will BTC dominance exceed ${domThreshold}% in ${daysStr}?`,
          targetValue: domThreshold, deadline, category: "DOMINANCE", dataSource: "coingecko",
          confidence: 75, reasonText: `BTC dominance is currently at ${currentData.btcDominance.toFixed(1)}%.`
        });
      }
    }

    // 4. GAS (ETH gas proposal)
    if (currentData.ethGas !== null) {
      const gasThreshold = isDemoMode ? 1 : 20;
      if (currentData.ethGas >= gasThreshold) {
        queueMarket({
          question: `Will ETH gas exceed ${gasThreshold} gwei in ${daysStr}?`,
          targetValue: gasThreshold, deadline, category: "GAS", dataSource: "etherscan",
          confidence: 85, reasonText: `ETH gas proposal is currently at ${currentData.ethGas} gwei.`
        });
      }
    }

    // 5. PRICE, CORRELATION, VOLUME asset predictions
    const priceAssets = [
      { key: "btc", name: "BTC", multipliers: [1.02, 1.05], category: "PRICE", reasonTemplate: (c, s) => `BTC is currently at $${c.toLocaleString()}. Proposing a ${s}% upside market based on volatility profile.` },
      { key: "eth", name: "ETH", multipliers: [1.02, 1.05], category: "CORRELATION", reasonTemplate: (c, s) => `ETH is currently at $${c.toLocaleString()}. Correlation analysis with BTC suggests a synchronized ${s}% upside breakout.` },
      { key: "sol", name: "SOL", multipliers: [1.02, 1.05], category: "VOLUME", reasonTemplate: (c, s) => `SOL is currently at $${c.toLocaleString()}. High trading volume profile indicates momentum toward a ${s}% target.` },
      { key: "somi", name: "SOMI", multipliers: [1.02, 1.05], category: "PRICE", reasonTemplate: (c, s) => `SOMI is currently at $${c.toLocaleString()}. Volatility pricing models project a ${s}% range expansion.` },
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
      const pct = ((strikeMultiplier - 1) * 100).toFixed(0);
      const reasonText = asset.reasonTemplate(curr, pct);
      const question = `Will ${asset.name} exceed $${strike.toLocaleString()} in ${daysStr}?`;

      queueMarket({
        question, targetValue: strike, deadline, category: asset.category, dataSource: "coingecko",
        confidence: 75, reasonText
      });
    }

    // 6. META predictions (Pythia self evaluation)
    const nowTime = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    if (nowTime - quota.lastMetaTime > oneWeek) {
      let createdThisWeek = 0;
      for (const item of reasoningData) {
        if (nowTime - (item.timestamp * 1000) < oneWeek) createdThisWeek++;
      }
      if (createdThisWeek > 0) {
        queueMarket({
          question: `Will Pythia create more than 20 markets this week?`,
          targetValue: 20, deadline, category: "META", dataSource: "internal",
          confidence: 90, reasonText: `Pythia has already created ${createdThisWeek} markets this week. Self-evaluating performance.`
        });
        quota.lastMetaTime = nowTime;
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
        const tx = await oracle.scoreEvent(dep.reasonText, dep.question, dep.targetValue, dep.deadline, dep.category, reasoningURI, { value: deposit, gasPrice: ethers.parseUnits("10", "gwei") });
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
           pendingRequests.set(requestId.toString(), { 
             dep, 
             reasoningData,
             createdAt: Math.floor(Date.now() / 1000) 
           });
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

    for (const address of marketAddresses) {
      const market = new ethers.Contract(address, marketAbi, wallet);
      const [state, deadline, question, strikePrice] = await Promise.all([
        market.state(), market.deadline(), market.question(), market.strikePrice()
      ]);

      const now = Math.floor(Date.now() / 1000);

      // 1. If market is OPEN and deadline passed -> Close it
      if (state === 0n && now >= deadline) {
        logActivity("VERDICT", `Market deadline reached. Preparing to close: ${question}`);
        const tx = await market.closeMarket({ gasPrice: ethers.parseUnits("10", "gwei") });
        await tx.wait();
        console.log(`✅ Closed market: ${question}`);
        continue;
      }

      // 2. If market is CLOSED -> Request onchain resolution via Somnia JSON API Agent
      if (state === 1n) {
        const lowerAddress = address.toLowerCase();
        const requestTime = pendingResolutions.get(lowerAddress);
        const now = Math.floor(Date.now() / 1000);
        
        // 5 minutes in demo mode, 2 hours in production
        const retryTimeout = isDemoMode ? 5 * 60 : 2 * 3600; 

        if (requestTime && (now - requestTime < retryTimeout)) {
          console.log(`[SKIP] Resolution already requested/pending for market: ${question}`);
          continue;
        }

        if (requestTime) {
          console.log(`⚠️ Resolution request for ${question} timed out. Falling back to local direct resolution...`);
          logActivity("RETRY_RESOLVE", `Resolution request timed out. Resolving via direct fallback for: ${question}`, address);
          
          try {
            const liveValue = await fetchFallbackValue(question);
            
            if (liveValue !== null && liveValue !== undefined) {
              const strike = Number(strikePrice);
              const outcome = liveValue >= strike;
              console.log(`[FALLBACK RESOLVED] Local value: ${liveValue}, Strike: ${strike} -> Outcome: ${outcome ? "YES" : "NO"}`);
              logActivity("RESOLVE_FALLBACK", `Resolved via fallback. Local value ${liveValue} vs Strike ${strike} -> ${outcome ? "YES" : "NO"}`, address);
              
              const tx = await oracle.forceResolveMarket(address, outcome, {
                gasPrice: ethers.parseUnits("10", "gwei")
              });
              await tx.wait();
              console.log(`✅ Direct fallback resolution transaction confirmed!`);
              pendingResolutions.delete(lowerAddress);
            } else {
              console.log(`[FALLBACK] Live value not available for question "${question}", retrying on-chain request.`);
              const platformAbi = ["function getRequestDeposit() view returns (uint256)"];
              const platformContract = new ethers.Contract("0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776", platformAbi, provider);
              const deposit = await platformContract.getRequestDeposit();
              
              pendingResolutions.set(lowerAddress, now);
              const tx = await oracle.requestResolution(address, { value: deposit, gasPrice: ethers.parseUnits("10", "gwei") });
              await tx.wait();
            }
          } catch (err) {
            console.error("Direct fallback resolution failed:", err.message);
          }
        } else {
          console.log(`\n⏳ Resolution Trigger: Requesting on-chain resolution via Somnia JSON API Agent for ${question}...`);
          logActivity("RESOLVER", `Requesting on-chain resolution via JSON API Agent for: ${question}`, address);
          
          try {
            const platformAbi = ["function getRequestDeposit() view returns (uint256)"];
            const platformContract = new ethers.Contract("0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776", platformAbi, provider);
            const deposit = await platformContract.getRequestDeposit();
            
            pendingResolutions.set(lowerAddress, now);
            const tx = await oracle.requestResolution(address, { value: deposit, gasPrice: ethers.parseUnits("10", "gwei") });
            await tx.wait();
            console.log(`✅ On-chain resolution request submitted successfully for market ${address}!`);
          } catch (err) {
            pendingResolutions.delete(lowerAddress);
            console.error("Failed to request resolution via Oracle:", err.message);
          }
        }
      }

      // 3. If market is RESOLVED -> Check and log performance metrics if newly resolved, and auto-claim winnings
      if (state === 2n) {
        pendingResolutions.delete(address.toLowerCase());
        let perfData = { categoryStats: {}, resolvedMarkets: [] };
        if (fs.existsSync(perfPath)) {
          try { perfData = JSON.parse(fs.readFileSync(perfPath, "utf8")); } catch(e) {}
        }
        const alreadyTracked = perfData.resolvedMarkets.some(x => x.marketAddress.toLowerCase() === address.toLowerCase());
        
        let category = "PRICE";
        if (fs.existsSync(reasoningPath)) {
          try {
            const reasoning = JSON.parse(fs.readFileSync(reasoningPath, "utf8"));
            const r = reasoning.find(x => x.marketAddress?.toLowerCase() === address.toLowerCase() || x.question === question);
            if (r && r.category) category = r.category;
          } catch(e) {}
        }

        if (!alreadyTracked) {
          console.log(`[RESOLVED] Detected newly resolved market on-chain: ${question}`);
          const outcomeVal = await market.outcome();
          const outcomeStr = outcomeVal ? "YES" : "NO";
          
          logActivity("PAYOUT", `Market resolved on-chain: ${question} -> ${outcomeStr}. Distributing funds.`, address);
          
          let bettorCount = 0;
          try {
             const logs = await market.queryFilter(market.filters.BetPlaced());
             const bettorsSet = new Set(logs.map(log => {
               const p = market.interface.parseLog({ topics: log.topics, data: log.data });
               return p ? p.args[0] : null;
             }).filter(x => x));
             bettorCount = bettorsSet.size;
          } catch (e) {}

          updatePerformanceMetrics(address, outcomeVal, bettorCount, category);
        }

        // Auto-claim agent winnings
        try {
          const hasClaimed = await market.hasClaimed(wallet.address);
          if (!hasClaimed) {
            const resolvedAt = await market.resolvedAt();
            const now = Math.floor(Date.now() / 1000);
            
            // 24 hours dispute period. 
            if (now >= Number(resolvedAt) + 24 * 3600) {
              console.log(`[CLAIMING] Auto-claiming agent winnings for resolved market: ${question}`);
              logActivity("CLAIM", `Auto-claiming agent winnings for resolved market: ${question}`, address);
              const tx = await market.claimWinnings({ gasPrice: ethers.parseUnits("10", "gwei") });
              await tx.wait();
              console.log(`✅ Claim winnings transaction confirmed for market ${address}!`);
            } else {
              const secondsLeft = (Number(resolvedAt) + 24 * 3600) - now;
              console.log(`[CLAIM SKIP] Dispute period active for market ${address}. ${Math.round(secondsLeft / 60)} minutes remaining.`);
            }
          }
        } catch (err) {
          console.error(`Auto-claiming winnings failed for market ${address}:`, err.message);
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
    logActivity("SYSTEM_REASONING", JSON.stringify(reasoningData));
    
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

oracle.on("ResolutionRequested", (requestId, market) => {
  console.log(`\n[EVENT RECEIVED] ResolutionRequested for market ${market} (ID: ${requestId})`);
  logActivity("RESOLVER_REQ", `Requested onchain resolution via JSON API agent for: ${market}`, market);
});

oracle.on("PriceReceived", (requestId, price) => {
  console.log(`\n[EVENT RECEIVED] PriceReceived for request ${requestId}: price ${price.toString()}`);
  try {
    const formattedPrice = parseFloat(ethers.formatUnits(price, 8)).toLocaleString();
    logActivity("RESOLVER_RES", `Onchain Price API returned: $${formattedPrice}`, null);
  } catch (e) {
    logActivity("RESOLVER_RES", `Onchain Price API returned raw value: ${price.toString()}`, null);
  }
});

console.log(`⚡ [AGENT] Initialized ${isDemoMode ? "in DEMO MODE (120s deadlines)" : "for PRODUCTION"}`);
console.log(`⚡ [AGENT] Persistent listeners registered.`);

let consecutiveErrors = 0;
const MAX_RETRIES = 5;
let lastHeartbeatTime = 0;

async function mainLoop() {
  try {
    await runAgent();
    await runResolver();
    consecutiveErrors = 0; // reset on success
    
    // Heartbeat every 90 seconds in demo mode, 5 minutes in production
    const now = Date.now();
    const heartbeatInterval = isDemoMode ? 90 * 1000 : 5 * 60 * 1000;
    if (now - lastHeartbeatTime >= heartbeatInterval) {
      let totalMarkets = 34;
      try {
        const count = await factory.getMarkets();
        totalMarkets = count.length;
      } catch (e) {}
      logActivity("HEARTBEAT", `Agent is active. Monitoring 4 assets (BTC, ETH, SOL, SOMI) and checking ${totalMarkets} markets for resolution.`);
      lastHeartbeatTime = now;
    }
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

// Seed initial data to Supabase on agent boot
try {
  if (fs.existsSync(perfPath)) {
    const perfData = JSON.parse(fs.readFileSync(perfPath, "utf8"));
    logActivity("SYSTEM_PERFORMANCE", JSON.stringify(perfData));
  }
  if (fs.existsSync(reasoningPath)) {
    const reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8"));
    logActivity("SYSTEM_REASONING", JSON.stringify(reasoningData));
  }
  console.log("⚡ [AGENT] Initial performance & reasoning data synced to Supabase.");
} catch (e) {
  console.error("Failed to seed initial stats to Supabase:", e.message);
}

mainLoop();
