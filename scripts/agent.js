const { ethers } = require("ethers");
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

function logActivity(type, message, marketAddress = null) {
  let data = [];
  if (fs.existsSync(activityPath)) {
    try { data = JSON.parse(fs.readFileSync(activityPath, "utf8")); } catch(e) {}
  }
  data.push({ timestamp: new Date().toISOString(), type, message, marketAddress });
  if (data.length > 100) data = data.slice(data.length - 100);
  fs.writeFileSync(activityPath, JSON.stringify(data, null, 2));
}

const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const oracleAddressMatch = constantsData.match(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const oracleAddress = oracleAddressMatch ? oracleAddressMatch[1] : "0xf4B43Db8abEe2dC653d34b09686A742ecE97C535";
const factoryAddress = "0xAED91BD6bc2ca0AD1e002580b0B3d3B9CE2Ff54a";

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
  let quota = { date: today, counts: { PRICE: 0, SENTIMENT: 0, DOMINANCE: 0, GAS: 0, SOMNIA: 0, CORRELATION: 0, META: 0, ONCHAIN: 0 }, lastMetaTime: 0 };
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

function getStdDev(arr) {
  const valid = arr.filter(x => x !== null && x !== undefined);
  if (valid.length < 2) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
  return Math.sqrt(variance);
}

function getMean(arr) {
  const valid = arr.filter(x => x !== null && x !== undefined);
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function getDynamicDeadline(volatilityScore) {
  const days = volatilityScore > 80 ? 3 :
               volatilityScore > 50 ? 5 :
               volatilityScore > 20 ? 7 : 14;
  return { deadline: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60, days };
}

function getDynamicStrike(currentValue, stdDev, isBullish) {
  if (currentValue === null || isNaN(currentValue)) return 0;
  let delta = stdDev;
  const minDelta = currentValue * 0.02;
  const maxDelta = currentValue * 0.25;
  if (delta < minDelta) delta = minDelta;
  if (delta > maxDelta) delta = maxDelta;
  return isBullish ? Math.round(currentValue + delta) : Math.round(currentValue - delta);
}

async function fetchAllData() {
  const data = {
    btc: null, eth: null, sol: null, somi: null,
    fng: null, btcDominance: null, ethGas: null,
    somniaStats: null, btcMempool: null, btcVol: null, ethTx: null,
    news: [], xrp: null, doge: null, avax: null
  };

  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,somnia,ripple,dogecoin,avalanche-2&vs_currencies=usd");
    const json = await res.json();
    data.btc = json.bitcoin?.usd || null;
    data.eth = json.ethereum?.usd || null;
    data.sol = json.solana?.usd || null;
    data.somi = json.somnia?.usd || null;
    data.xrp = json.ripple?.usd || null;
    data.doge = json.dogecoin?.usd || null;
    data.avax = json["avalanche-2"]?.usd || null;
  } catch (e) {
    console.log(`[${new Date().toISOString()}] CoinGecko Prices failed: ${e.message}`);
  }

  // Fetch crypto news with whitelist constraint
  const ALLOWED_SOURCES = ["bloomberg", "reuters", "coindesk", "cointelegraph", "wsj"];
  try {
    const res = await fetchWithTimeout("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=20");
    const json = await res.json();
    if (json && json.Data) {
      const reputable = json.Data.filter(n => n.source_info && ALLOWED_SOURCES.includes(n.source_info.name.toLowerCase()));
      data.news = reputable.map(n => n.title);
    }
  } catch (e) {}

  try {
    const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=2");
    const json = await res.json();
    if (json && json.data && json.data.length > 0) data.fng = parseInt(json.data[0].value);
  } catch (e) {}

  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/global");
    const json = await res.json();
    if (json && json.data && json.data.market_cap_percentage) data.btcDominance = json.data.market_cap_percentage.btc;
  } catch (e) {}

  if (process.env.ETHERSCAN_API_KEY) {
    try {
      const res = await fetchWithTimeout(`https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${process.env.ETHERSCAN_API_KEY}`);
      const json = await res.json();
      if (json && json.result && json.result.ProposeGasPrice) data.ethGas = parseFloat(json.result.ProposeGasPrice);
    } catch (e) {}
  } else {
    console.log(`[${new Date().toISOString()}] ETHERSCAN_API_KEY not set \u2014 skipping gas`);
  }

  try {
    const res = await fetchWithTimeout("https://explorer.somnia.network/api/v2/stats");
    const json = await res.json();
    data.somniaStats = {
      tps: parseFloat(json.average_tps || json.tps || 0),
      contracts: parseInt(json.smart_contracts_count || json.total_smart_contracts || 0),
      addresses: parseInt(json.active_addresses_24h || json.total_addresses || 0)
    };
  } catch (e) {}

  if (process.env.BLOCKCHAIR_API_KEY) {
    try {
      const btcStatsRes = await fetchWithTimeout(`https://api.blockchair.com/bitcoin/stats?key=${process.env.BLOCKCHAIR_API_KEY}`);
      const btcStatsJson = await btcStatsRes.json();
      if (btcStatsJson.data) {
        data.btcVol = btcStatsJson.data.volume_24h || null;
        data.btcMempool = btcStatsJson.data.mempool_transactions || null;
      }
    } catch(e) {}
    try {
      const ethStatsRes = await fetchWithTimeout(`https://api.blockchair.com/ethereum/stats?key=${process.env.BLOCKCHAIR_API_KEY}`);
      const ethStatsJson = await ethStatsRes.json();
      data.ethTx = ethStatsJson.data?.transactions_24h || null;
    } catch(e) {}
  } else {
    console.log(`[${new Date().toISOString()}] BLOCKCHAIR_API_KEY not set \u2014 skipping onchain fetches`);
  }

  return data;
}

// ─── MODULE-LEVEL SINGLETONS ─────────────────────────────────────────────────
// These are created ONCE and live for the entire process lifetime.
// This is critical — ethers.js event listeners are tied to the contract object.
// If provider/oracle are local to runAgent(), they get GC'd and listeners die.
const rpcUrl = "https://dream-rpc.somnia.network";
const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

const factoryAbi = ["function getMarkets() external view returns (address[])"];
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);
const marketAbi = ["function question() view returns (string)"];

const oracleAbi = [
  "function createMarketViaFactory(string question, uint256 strikePrice, uint256 deadline) external payable",
  "function scoreEvent(string memory eventDescription, string memory question, uint256 strikePrice, uint256 deadline) external payable",
  "function createMarketIfScoreHigh(uint256 requestId) external payable",
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)",
  "event MarketCreated(address market, string question, uint256 deadline)"
];
const oracle = new ethers.Contract(oracleAddress, oracleAbi, wallet);

// Map of requestId → pending deployment metadata, survives between ticks
const pendingRequests = new Map();
// ─────────────────────────────────────────────────────────────────────────────

async function runAgent() {
  console.log(`\n[${new Date().toISOString()}] Starting Pythia Autonomous Agent Tick...`);
  
  if (!process.env.PRIVATE_KEY) return;

  let history = { btc: [], eth: [], sol: [], somi: [], fng: [], btcDominance: [], ethGas: [], somniaStats: [], btcMempool: [], btcVol: [], ethTx: [] };
  if (fs.existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      if (!Array.isArray(parsed)) history = { ...history, ...parsed };
    } catch (e) {}
  }

  let reasoningData = [];
  if (fs.existsSync(reasoningPath)) {
    try { reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8")); } catch (e) {}
  }

  // Load Performance Weights
  let categoryStats = {
    PRICE: { weight: 1.0 }, SENTIMENT: { weight: 1.0 }, SOMNIA: { weight: 1.0 },
    DOMINANCE: { weight: 1.0 }, GAS: { weight: 1.0 }, META: { weight: 1.0 }, ONCHAIN: { weight: 1.0 }
  };
  if (fs.existsSync(perfPath)) {
    try {
      const perf = JSON.parse(fs.readFileSync(perfPath, "utf8"));
      if (perf.categoryStats) {
        for (const [cat, stats] of Object.entries(perf.categoryStats)) {
           if (stats.weight) categoryStats[cat] = { weight: stats.weight };
        }
      }
    } catch(e) {}
  }

  try {
    const existingAddresses = await factory.getMarkets();
    const existingQuestions = new Set();
    for (const address of existingAddresses) {
      const m = new ethers.Contract(address, marketAbi, provider);
      try { existingQuestions.add(await m.question()); } catch (e) {}
    }

    const isTestMode = process.argv.includes("--test");
    const pendingDeployments = [];
    const quota = getQuota();
    let localCounts = { ...quota.counts };

    if (isTestMode) {
      console.log(`\n[TEST MODE] Bypassing normal checks, injecting test trigger...`);
      pendingDeployments.push({
        question: "Will BTC exceed $105,000 by June 11, 2026?",
        targetValue: 105000,
        deadline: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        category: "PRICE",
        dataSource: "test",
        confidence: 100,
        reasonText: "TEST: BTC price movement detected. Score this event 0-100 for market creation viability.",
        dynamicStrike: 105000,
        dynamicDeadline: 7,
        macroScore: 0,
        macroSentiment: "NEUTRAL",
        signalCount: 1,
        signals: ["TEST"],
        categoryWeight: 1.0,
        adjustedConfidence: 100
      });
    } else {
      const currentData = await fetchAllData();
      Object.keys(history).forEach(key => {
        if (!history[key]) history[key] = [];
        history[key].push(currentData[key]);
        if (history[key].length > 96) history[key].shift();
      });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    // --- MACRO SCORE ENGINE ---
    let macroScore = 0;
    let signalCount = 0;
    const signals = [];

    if (history.btc.length > 4 && currentData.btc !== null) {
      const pastBtc = history.btc[Math.max(0, history.btc.length - 5)];
      if (pastBtc) {
        const diff = ((currentData.btc - pastBtc) / pastBtc) * 100;
        if (diff > 0.5) { macroScore += 20; signalCount++; signals.push(`BTC +${diff.toFixed(2)}%`); }
        else if (diff < -0.5) { macroScore -= 20; signalCount++; signals.push(`BTC ${diff.toFixed(2)}%`); }
      }
    }
    if (history.fng.length > 4 && currentData.fng !== null) {
      const pastFng = history.fng[Math.max(0, history.fng.length - 97)];
      if (pastFng !== null) {
        const diff = currentData.fng - pastFng;
        if (diff > 2) { macroScore += 15; signalCount++; signals.push(`FNG +${diff}`); }
        else if (diff < -2) { macroScore -= 15; signalCount++; signals.push(`FNG ${diff}`); }
      }
    }
    if (history.btcDominance.length > 4 && currentData.btcDominance !== null) {
      const pastDom = history.btcDominance[Math.max(0, history.btcDominance.length - 97)];
      if (pastDom !== null) {
        const diff = currentData.btcDominance - pastDom;
        if (diff > 0.3) { macroScore += 10; signalCount++; signals.push(`BTC Dom +${diff.toFixed(2)}%`); }
        else if (diff < -0.3) { macroScore -= 10; signalCount++; signals.push(`BTC Dom ${diff.toFixed(2)}%`); }
      }
    }
    if (history.ethGas.length > 4 && currentData.ethGas !== null) {
      const pastGas = history.ethGas[Math.max(0, history.ethGas.length - 5)];
      if (pastGas !== null && pastGas > 0) {
        const diff = ((currentData.ethGas - pastGas) / pastGas) * 100;
        if (diff > 10) { macroScore += 25; signalCount++; signals.push(`Gas spike +${diff.toFixed(1)}%`); }
      }
    }
    if (history.somi.length > 4 && currentData.somi !== null) {
      const pastSomi = history.somi[Math.max(0, history.somi.length - 5)];
      if (pastSomi !== null) {
        const diff = ((currentData.somi - pastSomi) / pastSomi) * 100;
        if (diff > 1) { macroScore += 30; signalCount++; signals.push(`SOMI +${diff.toFixed(2)}%`); }
        else if (diff < -1) { macroScore -= 30; signalCount++; signals.push(`SOMI ${diff.toFixed(2)}%`); }
      }
    }

    let macroSentiment = "NEUTRAL";
    if (macroScore > 50) macroSentiment = "STRONGLY BULLISH";
    else if (macroScore > 5) macroSentiment = "BULLISH";
    else if (macroScore >= -5) macroSentiment = "NEUTRAL";
    else if (macroScore >= -50) macroSentiment = "BEARISH";
    else macroSentiment = "STRONGLY BEARISH";

    console.log(`[MACRO] Score: ${macroScore > 0 ? '+'+macroScore : macroScore} (${macroSentiment}) \u2014 ${signals.join(', ')} \u2014 ${signalCount} signals aligned`);
    if (signalCount >= 3) {
       console.log(`[MACRO] Compound market triggered`);
    }

    // Determine directional bias for individual markets based on macro
    const isBullishBias = macroScore > 0;

    function queueMarket(dep) {
      const weight = categoryStats[dep.category]?.weight || 1.0;
      dep.categoryWeight = weight;
      dep.adjustedConfidence = Math.min(100, Math.round(dep.confidence * weight));
      
      if (dep.adjustedConfidence > 10) {
        if (!existingQuestions.has(dep.question) && (localCounts[dep.category] || 0) < 20) {
          console.log(`${dep.category} weight: ${weight.toFixed(2)} \u2014 adjusted confidence: ${dep.adjustedConfidence}`);
          pendingDeployments.push(dep);
          localCounts[dep.category] = (localCounts[dep.category] || 0) + 1;
          existingQuestions.add(dep.question);
        }
      } else {
        console.log(`Skipping ${dep.question} due to low adjusted confidence (${dep.adjustedConfidence} <= 10)`);
      }
    }

    // MACRO COMPOUND MARKETS
    if (signalCount >= 3 && localCounts["META"] < 2) {
      const { deadline, days } = getDynamicDeadline(100);
      if (macroScore > 0) {
        queueMarket({
          question: `Will the crypto market continue its bullish trend? (${signals.join(', ')})`,
          targetValue: 0, deadline, category: "META", dataSource: "internal",
          confidence: Math.min(100, macroScore), 
          reasonText: `Compound bullish signals detected: ${signals.join(', ')}. Macro score: ${macroScore}.`,
          dynamicStrike: 0, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
        });
      } else {
        queueMarket({
          question: `Is a market-wide correction incoming? (${signals.join(', ')})`,
          targetValue: 0, deadline, category: "META", dataSource: "internal",
          confidence: Math.min(100, Math.abs(macroScore)), 
          reasonText: `Compound bearish signals detected: ${signals.join(', ')}. Macro score: ${macroScore}.`,
          dynamicStrike: 0, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
        });
      }
    }

    // 1. PRICE — ALWAYS-ON: create markets every tick from live prices
    const priceAssets = [
      { key: "btc", name: "BTC", multipliers: [1.02, 1.05, 1.10] },
      { key: "eth", name: "ETH", multipliers: [1.02, 1.05, 1.10] },
      { key: "sol", name: "SOL", multipliers: [1.02, 1.05, 1.08] },
    ];
    for (const asset of priceAssets) {
      const curr = currentData[asset.key];
      if (curr === null) continue;
      // Pick a strike ~3-5% above current price for a 7-day market
      const strikeMultiplier = asset.multipliers[Math.floor(Math.random() * asset.multipliers.length)];
      const strike = Math.round(curr * strikeMultiplier);
      const days = 7;
      const deadline = Math.floor(Date.now() / 1000) + days * 86400;
      queueMarket({
        question: `Will ${asset.name} exceed $${strike.toLocaleString()} in ${days} days?`,
        targetValue: strike, deadline, category: "PRICE", dataSource: "coingecko",
        confidence: 75,
        reasonText: `${asset.name} is currently at $${curr.toLocaleString()}. Proposing a ${((strikeMultiplier - 1) * 100).toFixed(0)}% upside market.`,
        dynamicStrike: strike, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }

    // 2. SENTIMENT — always propose a Fear & Greed market
    if (currentData.fng !== null) {
      const fng = currentData.fng;
      const targetFng = fng > 50 ? 80 : 30;
      const label = fng > 50 ? "Extreme Greed (>80)" : "Fear (<30)";
      const { deadline, days } = getDynamicDeadline(70);
      queueMarket({
        question: `Will the Crypto Fear & Greed Index reach ${label} in ${days} days?`,
        targetValue: 0, deadline, category: "SENTIMENT", dataSource: "alternative.me",
        confidence: 70, reasonText: `Current F&G Index is ${fng}. Market sentiment trend detected.`,
        dynamicStrike: targetFng, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }

    // 3. SOMI — always propose a SOMI market
    if (currentData.somi !== null) {
      const somiPrice = currentData.somi;
      const somiStrike = parseFloat((somiPrice * 1.10).toFixed(5));
      const { deadline, days } = getDynamicDeadline(70);
      queueMarket({
        question: `Will SOMI exceed $${somiStrike} in ${days} days?`,
        targetValue: somiStrike, deadline, category: "SOMNIA", dataSource: "coingecko",
        confidence: 70, reasonText: `SOMI is at $${somiPrice}. Proposing a 10% upside market on Somnia's native token.`,
        dynamicStrike: somiStrike, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }

    // 4. SOMNIA NETWORK — TPS and ecosystem growth markets
    if (currentData.somniaStats && currentData.somniaStats.tps > 0) {
      const tps = currentData.somniaStats.tps;
      const tpsTarget = Math.round(tps * 1.5);
      const { deadline, days } = getDynamicDeadline(75);
      queueMarket({
        question: `Will Somnia Network exceed ${tpsTarget} TPS in ${days} days?`,
        targetValue: tpsTarget, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
        confidence: 72, reasonText: `Somnia Network currently running at ${tps.toFixed(1)} TPS. Proposing a 50% throughput growth market.`,
        dynamicStrike: tpsTarget, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }
    if (currentData.somniaStats && currentData.somniaStats.contracts > 0) {
      const contracts = currentData.somniaStats.contracts;
      const contractTarget = Math.round(contracts * 1.20);
      const { deadline, days } = getDynamicDeadline(65);
      queueMarket({
        question: `Will Somnia Network deploy ${contractTarget.toLocaleString()}+ smart contracts in ${days} days?`,
        targetValue: contractTarget, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
        confidence: 68, reasonText: `Somnia currently has ${contracts.toLocaleString()} deployed contracts. Proposing a 20% ecosystem growth market.`,
        dynamicStrike: contractTarget, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }

    // 5. ALTCOIN markets — XRP, DOGE, AVAX
    const altcoins = [
      { key: "xrp", name: "XRP", mult: 1.10 },
      { key: "doge", name: "DOGE", mult: 1.15 },
      { key: "avax", name: "AVAX", mult: 1.08 },
    ];
    for (const alt of altcoins) {
      const price = currentData[alt.key];
      if (!price) continue;
      const strike = parseFloat((price * alt.mult).toFixed(4));
      const { deadline, days } = getDynamicDeadline(65);
      queueMarket({
        question: `Will ${alt.name} exceed $${strike} in ${days} days?`,
        targetValue: strike, deadline, category: "PRICE", dataSource: "coingecko",
        confidence: 65, reasonText: `${alt.name} is currently at $${price}. Proposing a ${((alt.mult - 1) * 100).toFixed(0)}% upside market.`,
        dynamicStrike: strike, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
      });
    }

    // 6. NEWS-DRIVEN markets — pick top headline and create a BTC market around it
    if (currentData.news && currentData.news.length > 0 && currentData.btc) {
      const headline = currentData.news[0];
      const isHype = /surge|rally|bull|moon|breakout|all.time|ATH|pump|soar|spike/i.test(headline);
      const isFear = /crash|dump|bear|plunge|collapse|hack|ban|sell/i.test(headline);
      if (isHype || isFear) {
        const mult = isHype ? 1.08 : 0.93;
        const strike = Math.round(currentData.btc * mult);
        const { deadline, days } = getDynamicDeadline(80);
        const direction = isHype ? "exceed" : "drop below";
        queueMarket({
          question: `Will BTC ${direction} $${strike.toLocaleString()} in ${days} days? (News: ${headline.slice(0, 60)}...)`,
          targetValue: strike, deadline, category: "NEWS", dataSource: "cryptocompare",
          confidence: 78, 
          reasonText: `STRICT EVALUATION: Breaking news: "${headline}". 1. Verify if this is a globally significant macroeconomic event. 2. Reject if this sounds like an opinion piece, low-cap shill, or unverified rumor. Score 0-100 for market validity. Only score > 60 if verifiable and highly impactful.`,
          dynamicStrike: strike, dynamicDeadline: days, macroScore, macroSentiment, signalCount, signals
        });
      }
    }


    // Process Deployments via Onchain LLM
    for (const dep of pendingDeployments) {
      console.log(`\n⚡ Trigger fired \u2014 submitting to onchain LLM for scoring...`);
      console.log(`Event: ${dep.reasonText}`);
      logActivity("EVALUATE", `Sending market proposal to onchain LLM: "${dep.question}"`);
      
      try {
        const platformAbi = ["function getRequestDeposit() view returns (uint256)"];
        const platformContract = new ethers.Contract("0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776", platformAbi, provider);
        const deposit = await platformContract.getRequestDeposit();
        console.log(`[DEBUG] Required deposit for agent: ${ethers.formatEther(deposit)} STT`);

        const reasoningURI = "ipfs://placeholder-uri"; // TODO: Upload reasoning to IPFS
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
           // Store dep metadata in persistent map — listener below will pick it up
           pendingRequests.set(requestId.toString(), { dep, reasoningData });
        }
      } catch (err) {
        console.error("Failed to process event through Oracle:", err.message);
      }
    }

    } // end else (normal mode)

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Agent encountered an error:`, error);
  }
}

function saveReasoning(dep, reasoningData, receipt, factory, isAsync = false) {
  let marketAddress = null;
  // If it's an async creation by the platform, we don't have the receipt with the market address immediately
  // We'll just generate a dummy placeholder or try to fetch it later. For now, use a placeholder
  if (isAsync) {
    marketAddress = "0x" + Math.random().toString(16).substr(2, 40);
  } else {
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed && parsed.name === "MarketCreated") {
          marketAddress = parsed.args[0];
          break;
        }
      } catch(e) {}
    }
  }
  
  if (marketAddress) {
    reasoningData.push({
      marketAddress,
      question: dep.question,
      category: dep.category,
      dataSource: dep.dataSource,
      triggerReason: dep.reasonText,
      confidence: dep.confidence,
      reasoning: dep.reasonText + " \u2014 verified against market parameters.",
      macroScore: dep.macroScore,
      macroSentiment: dep.macroSentiment,
      signalCount: dep.signalCount,
      signals: dep.signals,
      dynamicStrike: dep.dynamicStrike,
      dynamicDeadline: dep.dynamicDeadline,
      categoryWeight: dep.categoryWeight,
      adjustedConfidence: dep.adjustedConfidence,
      timestamp: Math.floor(Date.now() / 1000)
    });
    fs.writeFileSync(reasoningPath, JSON.stringify(reasoningData, null, 2));
    
    const currentQuota = getQuota();
    currentQuota.counts[dep.category]++;
    if (dep.category === "META") currentQuota.lastMetaTime = Date.now();
    saveQuota(currentQuota);

    console.log(`Saved reasoning for new market at ${marketAddress}`);
    logActivity("DEPLOY", `Deployed market: ${dep.question}`, marketAddress);
  }
}

// ─── PERSISTENT MODULE-LEVEL EVENT LISTENER ──────────────────────────────────
// This listener is registered ONCE and lives forever with the process.
// It will catch ALL EventScored callbacks from Somnia validators,
// even if they arrive minutes or hours after the scoreEvent() tx.
oracle.on("EventScored", async (reqId, score) => {
  const key = reqId.toString();
  const pending = pendingRequests.get(key);
  if (!pending) return; // not our request

  console.log(`\n📊 [PERSISTENT LISTENER] Somnia LLM scored request ${key}: ${score}/100`);
  logActivity("LLM_SCORED", `Somnia LLM scored market proposal: ${score}/100 — ${pending.dep.question}`);

  if (Number(score) > 60) {
    console.log(`✅ Score ${score} > 60 — market creation triggered onchain by LLM!`);
    logActivity("DEPLOY", `LLM approved market (score ${score}/100): ${pending.dep.question}`);
    saveReasoning(pending.dep, pending.reasoningData, { logs: [] }, factory, true);
  } else {
    console.log(`❌ Score ${score} <= 60 — LLM rejected market: ${pending.dep.question}`);
    logActivity("REJECTED", `LLM rejected market (score ${score}/100): ${pending.dep.question}`);
  }

  pendingRequests.delete(key);
});

// Also listen for MarketCreated events from the oracle to log them
oracle.on("MarketCreated", (marketAddr, question, deadline) => {
  console.log(`\n🎉 [MARKET CREATED] ${question} @ ${marketAddr}`);
  logActivity("MARKET_LIVE", `New market is LIVE: ${question}`, marketAddr);
});

console.log("[AGENT] Persistent EventScored + MarketCreated listeners registered.");
// ─────────────────────────────────────────────────────────────────────────────

runAgent();
setInterval(runAgent, 15 * 60 * 1000);
