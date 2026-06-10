const { ethers } = require("ethers");
const RPC_URL = "https://api.infra.testnet.somnia.network/";
const ADDR = "0x57aB6F5f9033bd2Ae32e4FF3E6Cd10FddC3E0DB0";
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const balance = await provider.getBalance(ADDR);
  const txCount = await provider.getTransactionCount(ADDR);
  const pendingTxCount = await provider.getTransactionCount(ADDR, "pending");
  console.log("Wallet:", ADDR);
  console.log("Balance:", ethers.formatEther(balance), "STT");
  console.log("Transaction Count (Latest):", txCount);
  console.log("Transaction Count (Pending):", pendingTxCount);
}
main().catch(console.error);
