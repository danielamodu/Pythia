const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://dream-rpc.somnia.network";
const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const factoryAddressMatch = constantsData.match(/export const MARKET_FACTORY_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const factoryAddress = factoryAddressMatch ? factoryAddressMatch[1] : "0xA8AcAB87d7daf8A54aAD6E47fBf14b610aB92C2c";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const factoryAbi = [
    "function getMarkets() external view returns (address[])",
    "function getMarketCount() external view returns (uint256)"
  ];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

  const marketAbi = [
    "function question() view returns (string)",
    "function state() view returns (uint8)",
    "function deadline() view returns (uint256)",
    "function strikePrice() view returns (uint256)",
    "function totalYes() view returns (uint256)",
    "function totalNo() view returns (uint256)"
  ];

  console.log(`Querying MarketFactory at: ${factoryAddress}`);
  const markets = await factory.getMarkets();
  console.log(`Total markets deployed: ${markets.length}`);
  console.log("--------------------------------------------------");

  for (const addr of markets) {
    const market = new ethers.Contract(addr, marketAbi, provider);
    const [q, state, deadline, strike, yes, no] = await Promise.all([
      market.question(),
      market.state(),
      market.deadline(),
      market.strikePrice(),
      market.totalYes(),
      market.totalNo()
    ]);
    console.log(`Address: ${addr}`);
    console.log(`Question: ${q}`);
    console.log(`State: ${state} (0=OPEN, 1=CLOSED, 2=RESOLVED)`);
    console.log(`Deadline: ${new Date(Number(deadline) * 1000).toLocaleString()}`);
    console.log(`Strike: ${strike.toString()}`);
    console.log(`Pool: YES=${ethers.formatEther(yes)} STT | NO=${ethers.formatEther(no)} STT`);
    console.log("--------------------------------------------------");
  }
}

main().catch(console.error);
