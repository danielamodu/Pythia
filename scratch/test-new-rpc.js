const { ethers } = require("ethers");
const RPC_URL = "https://api.infra.testnet.somnia.network/";
async function main() {
  console.log("Connecting to", RPC_URL);
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const block = await provider.getBlockNumber();
  console.log("Connected! Block:", block);
}
main().catch(console.error);
