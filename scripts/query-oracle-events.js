const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://api.infra.testnet.somnia.network/";
const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const oracleAddressMatch = constantsData.match(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const oracleAddress = oracleAddressMatch ? oracleAddressMatch[1] : "0x153e324e6E7D65720da3dd947620C145a5a3f235";

const oracleAbi = [
  "event EventScoringRequested(uint256 requestId, string eventDescription)",
  "event EventScored(uint256 requestId, uint256 score)",
  "event ResolutionRequested(uint256 requestId, address market)",
  "event PriceReceived(uint256 requestId, uint256 price)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const oracle = new ethers.Contract(oracleAddress, oracleAbi, provider);

  console.log(`Querying events for PythiaOracle at: ${oracleAddress}`);
  
  const latestBlock = await provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}`);
  
  const fromBlock = latestBlock - 900; // block range <= 1000
  console.log(`Querying from block ${fromBlock} to ${latestBlock}...`);
  
  const [scoringReqs, scoredEvents, resReqs, priceRcvd] = await Promise.all([
    oracle.queryFilter(oracle.filters.EventScoringRequested(), fromBlock, latestBlock),
    oracle.queryFilter(oracle.filters.EventScored(), fromBlock, latestBlock),
    oracle.queryFilter(oracle.filters.ResolutionRequested(), fromBlock, latestBlock),
    oracle.queryFilter(oracle.filters.PriceReceived(), fromBlock, latestBlock)
  ]);

  console.log(`EventScoringRequested: ${scoringReqs.length}`);
  scoringReqs.forEach(e => {
    console.log(` - ReqId: ${e.args[0]}, Desc: ${e.args[1]}`);
  });

  console.log(`EventScored: ${scoredEvents.length}`);
  scoredEvents.forEach(e => {
    console.log(` - ReqId: ${e.args[0]}, Score: ${e.args[1]}`);
  });

  console.log(`ResolutionRequested: ${resReqs.length}`);
  resReqs.forEach(e => {
    console.log(` - ReqId: ${e.args[0]}, Market: ${e.args[1]}`);
  });

  console.log(`PriceReceived: ${priceRcvd.length}`);
  priceRcvd.forEach(e => {
    console.log(` - ReqId: ${e.args[0]}, Price: ${e.args[1]}`);
  });
}

main().catch(console.error);
