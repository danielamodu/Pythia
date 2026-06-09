const { ethers } = require("ethers");

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing PRIVATE_KEY in environment variables");

  const rpcUrl = "https://dream-rpc.somnia.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);

  const oracleAddress = "0xf4B43Db8abEe2dC653d34b09686A742ecE97C535";
  const oracleAbi = [
    {
      "inputs": [
        { "name": "question", "type": "string" },
        { "name": "strikePrice", "type": "uint256" },
        { "name": "deadline", "type": "uint256" }
      ],
      "name": "createMarketViaFactory",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    }
  ];
  const oracle = new ethers.Contract(oracleAddress, oracleAbi, wallet);
  
  // Interface to parse MarketFactory events
  const factoryInterface = new ethers.Interface([
    "event MarketCreated(address market, string question, uint256 strikePrice, uint256 deadline)"
  ]);

  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days from now

  const markets = [
    { question: "Will BTC exceed $110,000 by June 10, 2026?", strikePrice: 110000 },
    { question: "Will ETH exceed $3,000 by June 10, 2026?", strikePrice: 3000 },
    { question: "Will SOL exceed $200 by June 10, 2026?", strikePrice: 200 }
  ];

  console.log(`Using wallet: ${wallet.address}`);
  console.log("--------------------------------------------------");

  for (const m of markets) {
    console.log(`Creating market: "${m.question}"`);
    try {
      const tx = await oracle.createMarketViaFactory(m.question, m.strikePrice, deadline, {
        value: ethers.parseEther("0.01")
      });
      console.log(`  Tx hash: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      let marketAddress = "Unknown";
      for (const log of receipt.logs) {
        try {
          const parsed = factoryInterface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === "MarketCreated") {
            marketAddress = parsed.args.market;
            break;
          }
        } catch (e) {
          // Ignore logs from other contracts or events that don't match
        }
      }
      console.log(`  New market address: ${marketAddress}`);
    } catch (err) {
      console.error(`  Error creating market:`, err.message);
    }
    console.log("--------------------------------------------------");
  }
}

main().catch(console.error);
