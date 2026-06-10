const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });
if (!process.env.PRIVATE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });
}

const SOMNIA_PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const MARKET_FACTORY = "0xAED91BD6bc2ca0AD1e002580b0B3d3B9CE2Ff54a";
const RPC_URL = "https://api.infra.testnet.somnia.network/";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in .env files.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Deploying from wallet: ${wallet.address}`);

  // Load ABI and Bytecode from foundry build
  const oracleArtifactPath = path.join(__dirname, "../out/PythiaOracle.sol/PythiaOracle.json");
  const oracleArtifact = JSON.parse(fs.readFileSync(oracleArtifactPath, "utf8"));
  
  const oracleFactory = new ethers.ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode.object, wallet);
  
  console.log(`Deploying PythiaOracle with platform: ${SOMNIA_PLATFORM}...`);
  const oracle = await oracleFactory.deploy(SOMNIA_PLATFORM, {
    gasPrice: ethers.parseUnits("10", "gwei")
  });
  const deployTx = oracle.deploymentTransaction();
  console.log(`Deployment transaction sent! Hash: ${deployTx.hash}`);
  console.log("Waiting for confirmation on-chain...");
  await oracle.waitForDeployment();
  
  const oracleAddress = await oracle.getAddress();
  console.log(`\n✅ PythiaOracle deployed to: ${oracleAddress}`);

  console.log(`\nLinking to MarketFactory at ${MARKET_FACTORY}...`);
  const tx = await oracle.setMarketFactory(MARKET_FACTORY);
  await tx.wait();
  console.log(`✅ MarketFactory linked successfully!`);

  console.log(`\nRemember to fund the Oracle contract (${oracleAddress}) with STT so it can pay for deposits and market seeds!`);
  
  // Update frontend constants if possible
  const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
  if (fs.existsSync(constantsPath)) {
    let constantsData = fs.readFileSync(constantsPath, "utf8");
    constantsData = constantsData.replace(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/, `export const PYTHIA_ORACLE_ADDRESS = "${oracleAddress}";`);
    fs.writeFileSync(constantsPath, constantsData);
    console.log("✅ Updated frontend constants.ts with new Oracle address.");
  }
}

main().catch(console.error);
