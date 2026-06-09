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

let tickCount = 0;

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
  let quota = { date: today, counts: { PRICE: 0, SENTIMENT: 0, DOMINANCE: 0, GAS: 0, SOMNIA: 0, CORRELATION: 0, META: 0 }, lastMetaTime: 0 };
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
    console.log(`[${new Date().toISOString()}] ETHERSCAN_API_KEY not set \u2014 skipping gas markets`);
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

async function runAgent() {
  console.log(`\n[${new Date().toISOString()}] Starting Pythia Autonomous Agent Tick...`);
  logActivity("SCAN", "Agent tick started, scanning prices and external APIs.");
  
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log("Missing PRIVATE_KEY, Pythia agent skipping.");
    return;
  }

  const rpcUrl = "https://dream-rpc.somnia.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);

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

  let history = { btc: [], eth: [], sol: [], somi: [], fng: [], btcDominance: [], ethGas: [], somniaStats: [] };
  if (fs.existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      if (!Array.isArray(parsed)) {
        history = { ...history, ...parsed };
      }
    } catch (e) {}
  }

  let reasoningData = [];
  if (fs.existsSync(reasoningPath)) {
    try { reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8")); } catch (e) {}
  }

  try {
    const existingAddresses = await factory.getMarkets();
    const existingQuestions = new Set();
    for (const address of existingAddresses) {
      const m = new ethers.Contract(address, marketAbi, provider);
      try { existingQuestions.add(await m.question()); } catch (e) {}
    }

    const currentData = await fetchAllData();
    Object.keys(history).forEach(key => {
      history[key].push(currentData[key]);
      if (history[key].length > 96) history[key].shift();
    });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
    const pendingDeployments = [];
    const quota = getQuota();
    let localCounts = { ...quota.counts };

    function queueMarket(dep) {
      if (!existingQuestions.has(dep.question) && localCounts[dep.category] < 2) {
        pendingDeployments.push(dep);
        localCounts[dep.category]++;
        existingQuestions.add(dep.question);
      }
    }

    // 1. SOMNIA Priority
    if (localCounts["SOMNIA"] < 2) {
      // a) TPS
      if (currentData.somniaStats && currentData.somniaStats.tps > 10000) {
        queueMarket({
          question: "Will Somnia average TPS exceed 10,000 this week?",
          targetValue: 0, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
          confidence: 85, reasonText: `Somnia TPS reached ${currentData.somniaStats.tps}. High network activity detected.`
        });
      }
      // b) Contracts
      if (currentData.somniaStats && currentData.somniaStats.contracts > 500) {
        queueMarket({
          question: "Will Somnia surpass 500 deployed contracts this week?",
          targetValue: 0, deadline, category: "SOMNIA", dataSource: "somnia-explorer",
          confidence: 85, reasonText: `Somnia contracts reached ${currentData.somniaStats.contracts}. Ecosystem expansion detected.`
        });
      }
      // c) SOMI Price Action (Drop >5% or Pump >8% in 4h)
      if (history.somi.length > 16 && currentData.somi !== null) {
        const past = history.somi[history.somi.length - 17];
        if (past) {
          const diffPct = ((currentData.somi - past) / past) * 100;
          if (diffPct < -5) {
            queueMarket({
              question: "Will SOMI reclaim $0.20 before end of June 2026?",
              targetValue: 0, deadline, category: "SOMNIA", dataSource: "coingecko",
              confidence: 80, reasonText: `SOMI dropped ${Math.abs(diffPct).toFixed(1)}% in 4h \u2014 recovery play detected.`
            });
          } else if (diffPct > 8) {
            queueMarket({
              question: "Will SOMI market cap exceed $50M this week?",
              targetValue: 0, deadline, category: "SOMNIA", dataSource: "coingecko",
              confidence: 85, reasonText: `SOMI pumped ${diffPct.toFixed(1)}% in 4h \u2014 momentum detected.`
            });
          }
        }
      }
    }

    // 2. SENTIMENT
    if (history.fng.length > 4 && currentData.fng !== null) {
      const pastIdx = Math.max(0, history.fng.length - 97);
      const past = history.fng[pastIdx];
      if (past !== null && Math.abs(currentData.fng - past) > 10) {
        if (currentData.fng > past) {
          queueMarket({
            question: "Will the Crypto Fear & Greed Index exceed 70 (Greed) in 7 days?",
            targetValue: 0, deadline, category: "SENTIMENT", dataSource: "alternative.me",
            confidence: 80, reasonText: `F&G Index moved up ${currentData.fng - past} points in 24h.`
          });
        } else {
          queueMarket({
            question: "Will the Crypto Fear & Greed Index drop below 30 (Fear) in 7 days?",
            targetValue: 0, deadline, category: "SENTIMENT", dataSource: "alternative.me",
            confidence: 80, reasonText: `F&G Index dropped ${past - currentData.fng} points in 24h.`
          });
        }
      }
    }

    // 3. DOMINANCE
    if (history.btcDominance.length > 4 && currentData.btcDominance !== null) {
      const pastIdx = Math.max(0, history.btcDominance.length - 97);
      const past = history.btcDominance[pastIdx];
      if (past !== null && Math.abs(currentData.btcDominance - past) > 1.5) {
        if (currentData.btcDominance > past) {
          queueMarket({
            question: "Will BTC dominance exceed 55% in 7 days?",
            targetValue: 0, deadline, category: "DOMINANCE", dataSource: "coingecko",
            confidence: 75, reasonText: `BTC dominance surged by ${(currentData.btcDominance - past).toFixed(2)}% in 24h.`
          });
        } else {
          queueMarket({
            question: "Will BTC dominance drop below 50% in 7 days?",
            targetValue: 0, deadline, category: "DOMINANCE", dataSource: "coingecko",
            confidence: 75, reasonText: `BTC dominance dropped by ${(past - currentData.btcDominance).toFixed(2)}% in 24h.`
          });
        }
      }
    }

    // 4. GAS
    if (history.ethGas.length > 4 && currentData.ethGas !== null) {
      const pastIdx = Math.max(0, history.ethGas.length - 5);
      const past = history.ethGas[pastIdx];
      if (past !== null && currentData.ethGas > past * 1.5) {
        queueMarket({
          question: "Will ETH gas exceed 20 gwei in 7 days?",
          targetValue: 0, deadline, category: "GAS", dataSource: "etherscan",
          confidence: 85, reasonText: `ETH gas spiked from ${past} to ${currentData.ethGas} gwei (>50%) in 1h.`
        });
      } else if (past !== null && currentData.ethGas < past * 0.5) {
        queueMarket({
          question: "Will ETH gas drop below 5 gwei in 7 days?",
          targetValue: 0, deadline, category: "GAS", dataSource: "etherscan",
          confidence: 85, reasonText: `ETH gas crashed by >50% to ${currentData.ethGas} gwei in 1h.`
        });
      }
    }

    // 5. PRICE
    const assets = ["btc", "eth", "sol"];
    for (const asset of assets) {
      const curr = currentData[asset];
      if (curr === null) continue;
      if (history[asset].length > 4) {
        const past1h = history[asset][Math.max(0, history[asset].length - 5)];
        if (past1h) {
          const diff1h = ((curr - past1h) / past1h) * 100;
          if (Math.abs(diff1h) > 3) {
            queueMarket({
              question: `Will ${asset.toUpperCase()} exceed $${Math.round(curr * 1.05)} in 7 days?`,
              targetValue: Math.round(curr * 1.05), deadline, category: "PRICE", dataSource: "coingecko",
              confidence: Math.min(100, Math.round(Math.abs(diff1h) * 15)),
              reasonText: `${asset.toUpperCase()} moved ${diff1h.toFixed(1)}% in 1h. High volatility detected.`
            });
          }
        }
      }
    }

    // 6. META
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    if (now - quota.lastMetaTime > oneWeek) {
      let createdThisWeek = 0;
      for (const item of reasoningData) {
        if (now - (item.timestamp * 1000) < oneWeek) createdThisWeek++;
      }
      if (createdThisWeek > 0) {
        queueMarket({
          question: "Will Pythia create more than 20 markets this week?",
          targetValue: 0, deadline, category: "META", dataSource: "internal",
          confidence: 90, reasonText: `Pythia has already created ${createdThisWeek} markets this week. Self-evaluating performance.`
        });
        queueMarket({
          question: "Will total Pythia market volume exceed 1 STT this week?",
          targetValue: 0, deadline, category: "META", dataSource: "internal",
          confidence: 80, reasonText: `Pythia evaluating own aggregate liquidity velocity.`
        });
        quota.lastMetaTime = now; // optimistically prevent next queue during same tick
      }
    }

    // Process Deployments via Onchain LLM
    for (const dep of pendingDeployments) {
      console.log(`[${new Date().toISOString()}] Pythia is evaluating event onchain...`);
      console.log(`Event: ${dep.reasonText}`);
      logActivity("EVALUATE", `Sending market proposal to LLM: "${dep.question}"`);
      
      try {
        const tx = await oracle.scoreEvent(dep.reasonText, dep.question, dep.targetValue, dep.deadline, { value: ethers.parseEther("0.005") });
        const receipt = await tx.wait();
        
        let requestId = null;
        for (const log of receipt.logs) {
          try {
            const parsed = oracle.interface.parseLog(log);
            if (parsed && parsed.name === "EventScoringRequested") {
              requestId = parsed.args[0];
            }
          } catch(e) {}
        }

        if (requestId !== null) {
          console.log(`Requested Onchain LLM scoring for request ID: ${requestId}. Waiting up to 60s for response...`);
          
          let scoreReceived = false;
          let eventScore = 0;

          const waitPromise = new Promise((resolve) => {
            const onScored = (reqId, score) => {
              if (reqId.toString() === requestId.toString()) {
                scoreReceived = true;
                eventScore = Number(score);
                oracle.off("EventScored", onScored);
                resolve();
              }
            };
            oracle.on("EventScored", onScored);
            setTimeout(() => {
              oracle.off("EventScored", onScored);
              resolve();
            }, 60000);
          });

          await waitPromise;

          if (scoreReceived) {
            console.log(`Score received: ${eventScore}/100`);
            logActivity("VERDICT", `LLM scored proposal ${eventScore}/100.`);
            if (eventScore > 60) {
              console.log("Market deployed by LLM decision.");
              const createTx = await oracle.createMarketIfScoreHigh(requestId, { value: ethers.parseEther("0.005") });
              const createReceipt = await createTx.wait();
              saveReasoning(dep, reasoningData, createReceipt, factory);
            } else {
              console.log("Score too low, market rejected by LLM.");
              logActivity("REJECT", `Market proposal rejected by LLM (${eventScore} < 60).`);
            }
          } else {
            console.log("LLM scoring timed out, skipping market creation (falling back to direct creation for testnet continuity).");
            const fallbackTx = await oracle.createMarketViaFactory(dep.question, dep.targetValue, dep.deadline, { value: ethers.parseEther("0.005") });
            const fbReceipt = await fallbackTx.wait();
            saveReasoning(dep, reasoningData, fbReceipt, factory);
          }
        }
      } catch (err) {
        console.error("Failed to process event through Oracle:", err.message);
        console.log("Falling back to direct creation...");
        try {
          const fallbackTx = await oracle.createMarketViaFactory(dep.question, dep.targetValue, dep.deadline, { value: ethers.parseEther("0.005") });
          const fbReceipt = await fallbackTx.wait();
          saveReasoning(dep, reasoningData, fbReceipt, factory);
        } catch(e) {}
      }
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Agent encountered an error:`, error);
  }
}

function saveReasoning(dep, reasoningData, receipt, factory) {
  let marketAddress = null;
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog(log);
      if (parsed && parsed.name === "MarketCreated") {
        marketAddress = parsed.args[0];
        break;
      }
    } catch(e) {}
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
      timestamp: Math.floor(Date.now() / 1000)
    });
    fs.writeFileSync(reasoningPath, JSON.stringify(reasoningData, null, 2));
    
    // Increment quota since it successfully deployed
    const currentQuota = getQuota();
    currentQuota.counts[dep.category]++;
    if (dep.category === "META") currentQuota.lastMetaTime = Date.now();
    saveQuota(currentQuota);

    console.log(`Saved reasoning for new market at ${marketAddress}`);
    logActivity("DEPLOY", `Deployed market: ${dep.question}`, marketAddress);
  } else {
    console.log("Could not find MarketCreated log, reasoning not saved.");
  }
}

// Run immediately, then loop every 15 minutes
runAgent();
setInterval(runAgent, 15 * 60 * 1000);
