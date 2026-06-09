require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://dream-rpc.somnia.network";

// Get oracle address from constants.ts where deploy_oracle.js saved it
const constantsPath = path.join(__dirname, "../frontend/src/utils/constants.ts");
const constantsData = fs.readFileSync(constantsPath, "utf8");
const oracleAddressMatch = constantsData.match(/export const PYTHIA_ORACLE_ADDRESS = "(0x[a-fA-F0-9]{40})";/);
const ORACLE_ADDRESS = oracleAddressMatch ? oracleAddressMatch[1] : null;

if (!ORACLE_ADDRESS) {
  console.error("Could not find Oracle Address in constants.ts");
  process.exit(1);
}

const pythiaOracleAbi = [
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "question",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "strikePrice",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      }
    ],
    "name": "createMarketViaFactory",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, 50312);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Using oracle at: ${ORACLE_ADDRESS}`);
  console.log(`Account: ${wallet.address}`);

  const oracle = new ethers.Contract(ORACLE_ADDRESS, pythiaOracleAbi, wallet);

  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;

  const markets = [
    {
      question: "Will BTC exceed $105,000 by June 11, 2026?",
      strikePrice: 105000n * 10n**8n,
      deadline: now + 7 * day,
    },
    {
      question: "Will ETH exceed $2,500 by June 11, 2026?",
      strikePrice: 2500n * 10n**8n,
      deadline: now + 7 * day,
    },
    {
      question: "Will SOL exceed $180 by June 11, 2026?",
      strikePrice: 180n * 10n**8n,
      deadline: now + 5 * day,
    },
    {
      question: "Will SOMI exceed $0.20 by June 15, 2026?",
      strikePrice: 20000000n, // 0.20 * 10^8
      deadline: now + 11 * day,
    }
  ];

  for (const market of markets) {
    console.log(`Creating market: ${market.question}`);
    try {
      const tx = await oracle.createMarketViaFactory(
        market.question, 
        market.strikePrice, 
        market.deadline,
        { value: ethers.parseEther("0.005") }
      );
      console.log(`Tx sent: ${tx.hash}`);
      await tx.wait();
      console.log(`Market created successfully!\n`);
    } catch (e) {
      console.error(`Failed to create market:`, e);
    }
  }
}

main().catch(console.error);
