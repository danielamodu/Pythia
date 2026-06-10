const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://api.infra.testnet.somnia.network/";
const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const factoryAddressMatch = constantsData.match(/export const MARKET_FACTORY_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const factoryAddress = factoryAddressMatch ? factoryAddressMatch[1] : "0xA8AcAB87d7daf8A54aAD6E47fBf14b610aB92C2c";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const factoryAbi = [
    "function getMarkets() external view returns (address[])"
  ];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

  const marketAbi = [
    "function totalYes() view returns (uint256)",
    "function totalNo() view returns (uint256)",
    "function state() view returns (uint8)",
    "event BetPlaced(address indexed user, bool outcome, uint256 amount)"
  ];

  const markets = await factory.getMarkets();
  console.log(`Total markets deployed: ${markets.length}`);

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - 900);

  let totalVolume = 0;
  let resolvedCount = 0;
  let bettorsSet = new Set();

  for (const addr of markets) {
    const marketContract = new ethers.Contract(addr, marketAbi, provider);
    let yesVal = 0n;
    let noVal = 0n;
    try {
      const [yes, no, state] = await Promise.all([
        marketContract.totalYes(), 
        marketContract.totalNo(),
        marketContract.state()
      ]);
      yesVal = yes;
      noVal = no;
      if (Number(state) === 2) resolvedCount++;
    } catch(e) {
      console.error("Failed to fetch state for market", addr, e);
    }
    
    try {
      const filter = marketContract.filters.BetPlaced();
      const logs = await marketContract.queryFilter(filter, fromBlock, latestBlock);
      logs.forEach((log) => {
        const parsed = marketContract.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed) {
          bettorsSet.add(parsed.args[0]);
        }
      });
    } catch(e) {
      console.error("Failed to query bets for market", addr, e);
    }

    const vol = parseFloat(ethers.formatEther(yesVal)) + parseFloat(ethers.formatEther(noVal));
    totalVolume += vol;
  }

  console.log(`Total Volume: ${totalVolume} STT`);
  console.log(`Resolved Markets: ${resolvedCount}`);
  console.log(`Unique Bettors: ${bettorsSet.size}`);
}

main().catch(console.error);
