const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
if (!process.env.PRIVATE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });
}

const activityPath = path.join(__dirname, "activity.json");
const reasoningPath = path.join(__dirname, "../frontend/data/reasoning.json");
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

async function fetchPrice(asset) {
  const map = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "SOMI": "somnia"
  };
  const id = map[asset];
  if (!id) return null;
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  const data = await res.json();
  return data[id]?.usd || null;
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

  // Load reasoning to check what the agent predicted
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

  // Calculate new weight
  const cat = perfData.categoryStats[category];
  const avgBettors = cat.totalBettors / cat.totalResolved;
  const accuracy = cat.accurateCount / cat.totalResolved;

  let newWeight = 1.0;
  
  // Base weight adjustment based on accuracy
  if (accuracy >= 0.7) newWeight += 0.2;
  else if (accuracy < 0.5) newWeight -= 0.3;

  // Multiplier adjustment based on bettors
  if (avgBettors > 5) newWeight += 0.5;
  else if (avgBettors > 2) newWeight += 0.2;
  else if (avgBettors < 1) newWeight -= 0.2;

  // Clamp weight 0.2 to 2.0
  cat.weight = Math.max(0.2, Math.min(2.0, newWeight));

  perfData.resolvedMarkets.push({
    marketAddress, outcome, bettorCount, isAccurate, timestamp: Math.floor(Date.now() / 1000)
  });

  fs.writeFileSync(perfPath, JSON.stringify(perfData, null, 2));
  return { accuracy, avgBettors, weight: cat.weight };
}

async function runResolver() {
  console.log(`[${new Date().toISOString()}] Starting Pythia Resolution Loop...`);
  
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing PRIVATE_KEY in env");

  const rpcUrl = "https://dream-rpc.somnia.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);

  const factoryAddress = "0xAED91BD6bc2ca0AD1e002580b0B3d3B9CE2Ff54a";
  const factoryAbi = ["function getMarkets() external view returns (address[])"];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

  const marketAbi = [
    "function state() view returns (uint8)",
    "function deadline() view returns (uint256)",
    "function strikePrice() view returns (uint256)",
    "function question() view returns (string)",
    "function closeMarket() external",
    "function resolve(bool outcome) external",
    "event BetPlaced(address indexed user, bool outcome, uint256 amount)"
  ];

  try {
    const marketAddresses = await factory.getMarkets();
    
    // Determine category based on reasoning.json
    let reasoningData = [];
    if (fs.existsSync(reasoningPath)) {
      try { reasoningData = JSON.parse(fs.readFileSync(reasoningPath, "utf8")); } catch(e) {}
    }

    for (const address of marketAddresses) {
      const market = new ethers.Contract(address, marketAbi, wallet);
      const [state, deadline, strikePrice, question] = await Promise.all([
        market.state(),
        market.deadline(),
        market.strikePrice(),
        market.question()
      ]);

      const now = Math.floor(Date.now() / 1000);

      // 1. Close expired OPEN markets
      if (state === 0n && now >= deadline) {
        console.log(`[${new Date().toISOString()}] Closing expired market: ${question}`);
        logActivity("EVALUATE", `Closing expired market: ${question}`);
        const tx = await market.closeMarket();
        await tx.wait();
        console.log(`[${new Date().toISOString()}]   Closed successfully (Tx: ${tx.hash})`);
        continue;
      }

      // 2. Resolve CLOSED markets
      if (state === 1n) {
        console.log(`[${new Date().toISOString()}] Attempting to resolve: ${question}`);
        
        let outcome = false;
        const reasoningMatch = reasoningData.find(r => r.marketAddress === address);
        const category = reasoningMatch ? reasoningMatch.category : "PRICE";

        // Logic for specific categories
        if (category === "PRICE" || category === "SOMNIA") {
          const asset = parseAsset(question);
          if (!asset) {
            console.log(`[${new Date().toISOString()}]   Could not parse asset, skipping.`);
            continue;
          }
          const currentPrice = await fetchPrice(asset);
          if (currentPrice === null) {
             console.log(`[${new Date().toISOString()}]   Failed to fetch price for ${asset}, skipping.`);
             continue;
          }
          const numericStrike = Number(strikePrice);
          outcome = currentPrice >= numericStrike;
          console.log(`[${new Date().toISOString()}]   Current Price: $${currentPrice} | Strike: $${numericStrike}`);
        } else {
          // Mock resolution for other categories (since we aren't tracking historical FNG exactly at resolution time)
          // Ideally, we'd fetch the current stat. We will just use Math.random() for demo if it's not a price market.
          outcome = Math.random() > 0.5;
          console.log(`[${new Date().toISOString()}]   Non-price market resolved as ${outcome}`);
        }

        const outcomeStr = outcome ? "YES" : "NO";
        
        // Count bettors
        let bettorCount = 0;
        try {
           const filter = market.filters.BetPlaced();
           const logs = await market.queryFilter(filter);
           const bettorsSet = new Set();
           for (const log of logs) {
             const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
             if (parsed) bettorsSet.add(parsed.args[0]);
           }
           bettorCount = bettorsSet.size;
        } catch (e) {
           console.error("Error fetching Bettor Count:", e);
        }

        try {
          const tx = await market.resolve(outcome);
          await tx.wait();
          console.log(`[${new Date().toISOString()}] \u2705 Resolved "${question}" -> ${outcomeStr} (Tx: ${tx.hash})`);
          logActivity("VERDICT", `Resolved market: ${question} -> ${outcomeStr}`);

          const { accuracy, avgBettors, weight } = updatePerformanceMetrics(address, outcome, bettorCount, category);
          console.log(`   [PERF] ${category} \u2014 Bettors: ${bettorCount} | Avg Bettors: ${avgBettors.toFixed(1)} | Acc: ${(accuracy*100).toFixed(0)}% | New Weight: ${weight.toFixed(2)}x`);

        } catch (err) {
          console.error(`[${new Date().toISOString()}]   Error resolving market:`, err.message || err);
        }
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Resolver encountered an error:`, error);
  }
  
  console.log(`[${new Date().toISOString()}] Resolution loop complete. Sleeping for 30 minutes...\n`);
}

runResolver();
setInterval(runResolver, 30 * 60 * 1000);
