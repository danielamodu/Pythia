const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });
if (!process.env.PRIVATE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });
}

const SOMNIA_PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const RPC_URL = "https://api.infra.testnet.somnia.network/";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in .env files.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`\n🚀 [REDEPLOY] Starting redeployment sequence from: ${wallet.address}`);
  console.log(`Connected to RPC: ${RPC_URL}`);

  const treasury = wallet.address;

  // 1. Deploy PythiaOracle
  const oracleArtifactPath = path.join(__dirname, "../out/PythiaOracle.sol/PythiaOracle.json");
  if (!fs.existsSync(oracleArtifactPath)) {
    console.error(`Artifact not found at ${oracleArtifactPath}. Please compile first.`);
    process.exit(1);
  }
  const oracleArtifact = JSON.parse(fs.readFileSync(oracleArtifactPath, "utf8"));
  const oracleFactory = new ethers.ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode.object, wallet);
  
  console.log(`\nStep 1: Deploying PythiaOracle with platform: ${SOMNIA_PLATFORM}...`);
  const oracle = await oracleFactory.deploy(SOMNIA_PLATFORM, {
    gasPrice: ethers.parseUnits("15", "gwei") // higher gas for fast inclusion
  });
  const oracleTx = oracle.deploymentTransaction();
  console.log(`Transaction sent! Hash: ${oracleTx.hash}`);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`✅ PythiaOracle deployed to: ${oracleAddress}`);

  // 2. Deploy MarketFactory
  const factoryArtifactPath = path.join(__dirname, "../out/MarketFactory.sol/MarketFactory.json");
  if (!fs.existsSync(factoryArtifactPath)) {
    console.error(`Artifact not found at ${factoryArtifactPath}. Please compile first.`);
    process.exit(1);
  }
  const factoryArtifact = JSON.parse(fs.readFileSync(factoryArtifactPath, "utf8"));
  const factoryFactory = new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode.object, wallet);
  
  console.log(`\nStep 2: Deploying MarketFactory with oracle: ${oracleAddress}...`);
  const marketFactory = await factoryFactory.deploy(oracleAddress, treasury, {
    gasPrice: ethers.parseUnits("15", "gwei")
  });
  const factoryTx = marketFactory.deploymentTransaction();
  console.log(`Transaction sent! Hash: ${factoryTx.hash}`);
  await marketFactory.waitForDeployment();
  const marketFactoryAddress = await marketFactory.getAddress();
  console.log(`✅ MarketFactory deployed to: ${marketFactoryAddress}`);

  // 3. Link Oracle to Factory
  console.log(`\nStep 3: Linking PythiaOracle to MarketFactory...`);
  const linkTx = await oracle.setMarketFactory(marketFactoryAddress, {
    gasPrice: ethers.parseUnits("15", "gwei")
  });
  console.log(`Transaction sent! Hash: ${linkTx.hash}`);
  await linkTx.wait();
  console.log(`✅ Oracle linked to MarketFactory!`);

  // 4. Update constants.ts
  console.log(`\nStep 4: Updating frontend constants.ts...`);
  const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
  if (fs.existsSync(constantsPath)) {
    let constantsData = fs.readFileSync(constantsPath, "utf8");
    
    // Replace oracle address
    constantsData = constantsData.replace(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/, `export const PYTHIA_ORACLE_ADDRESS = "${oracleAddress}";`);
    // Replace factory address
    constantsData = constantsData.replace(/export const MARKET_FACTORY_ADDRESS = "(0x[a-fA-F0-9]{40})";/, `export const MARKET_FACTORY_ADDRESS = "${marketFactoryAddress}";`);
    
    fs.writeFileSync(constantsPath, constantsData);
    console.log("✅ Updated constants.ts successfully!");
  } else {
    console.warn(`⚠️ frontend constants.ts not found at ${constantsPath}. Skipping auto-update.`);
  }

  console.log(`\n🎉 [REDEPLOY COMPLETE]`);
  console.log(`Oracle Address: ${oracleAddress}`);
  console.log(`Factory Address: ${marketFactoryAddress}`);
  console.log(`Please update your backend pm2 script and restart the agent!`);
}

main().catch((err) => {
  console.error("\n❌ Redeployment failed:", err.message);
  process.exit(1);
});
