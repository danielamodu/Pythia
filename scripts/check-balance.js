const { ethers } = require("ethers");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });
if (!process.env.PRIVATE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });
}

const RPC_URL = "https://api.infra.testnet.somnia.network/";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in .env files.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();
  
  console.log("----------------------------------------");
  console.log(`Wallet Address: ${wallet.address}`);
  console.log(`Current Balance: ${ethers.formatEther(balance)} STT`);
  console.log(`Gas Price (Recommended): ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} gwei`);
  console.log("----------------------------------------");
}

main().catch(console.error);
