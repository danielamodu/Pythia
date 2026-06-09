const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const RPC_URL = "https://dream-rpc.somnia.network";
const ORACLE_ADDRESS = "0x153e324e6E7D65720da3dd947620C145a5a3f235";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const treasury = wallet.address;

  // Deploy MarketFactory
  const factoryArtifactPath = path.join(__dirname, "../out/MarketFactory.sol/MarketFactory.json");
  const factoryArtifact = JSON.parse(fs.readFileSync(factoryArtifactPath, "utf8"));
  
  const factoryFactory = new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode.object, wallet);
  
  console.log(`Deploying MarketFactory with oracle: ${ORACLE_ADDRESS}...`);
  const marketFactory = await factoryFactory.deploy(ORACLE_ADDRESS, treasury);
  await marketFactory.waitForDeployment();
  
  const marketFactoryAddress = await marketFactory.getAddress();
  console.log(`\n✅ MarketFactory deployed to: ${marketFactoryAddress}`);

  // Link Oracle to Factory
  const oracleArtifactPath = path.join(__dirname, "../out/PythiaOracle.sol/PythiaOracle.json");
  const oracleArtifact = JSON.parse(fs.readFileSync(oracleArtifactPath, "utf8"));
  const oracle = new ethers.Contract(ORACLE_ADDRESS, oracleArtifact.abi, wallet);
  
  console.log(`Linking PythiaOracle to MarketFactory...`);
  const tx = await oracle.setMarketFactory(marketFactoryAddress);
  await tx.wait();
  console.log(`✅ Linked!`);

  // Update constants.ts
  const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
  if (fs.existsSync(constantsPath)) {
    let constantsData = fs.readFileSync(constantsPath, "utf8");
    constantsData = constantsData.replace(/export const MARKET_FACTORY_ADDRESS = "(0x[a-fA-F0-9]{40})";/, `export const MARKET_FACTORY_ADDRESS = "${marketFactoryAddress}";`);
    fs.writeFileSync(constantsPath, constantsData);
    console.log("✅ Updated frontend constants.ts with new MarketFactory address.");
  }
}

main().catch(console.error);
