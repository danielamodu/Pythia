const { ethers } = require("ethers");
const RPC_URL = "https://api.infra.testnet.somnia.network/";
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const feeData = await provider.getFeeData();
  console.log("Fee Data:");
  console.log(" - gasPrice:", feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") + " gwei" : "null");
  console.log(" - maxFeePerGas:", feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") + " gwei" : "null");
  console.log(" - maxPriorityFeePerGas:", feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei") + " gwei" : "null");
}
main().catch(console.error);
