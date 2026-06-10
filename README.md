# Pythia ⬡ Autonomous Prediction Markets

[![Somnia Network](https://img.shields.io/badge/Somnia-Testnet-blue?style=for-the-badge&logo=ethereum&color=blueviolet)](https://somnia.network)
[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live_Demo-black?style=for-the-badge&logo=vercel)](https://pythia-danielamodu.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](https://opensource.org/licenses/MIT)

> **The first fully autonomous, end-to-end prediction market protocol powered entirely by the Somnia Network's Agentic L1 Architecture.**

Live Demo: [pythiaxbt.vercel.app](https://pythiaxbt.vercel.app)  
GitHub: [github.com/danielamodu/Pythia](https://github.com/danielamodu/Pythia)

---

## 👁️ Project Overview

Pythia represents a shift from hybrid Web3 apps to **native Agent-Driven DeFi (ADF)**. 

Traditional prediction markets (such as Polymarket) rely on centralized off-chain API scraping or manual optimistic oracle disputes (like UMA) to settle markets. Pythia is **100% autonomous**—executed by decentralized on-chain agents that run within validator nodes on Somnia. The protocol discovers opportunities, analyzes news impact, launches prediction pools, seeds liquidity, gathers real-world outcomes, and settles payouts trustlessly with **zero human intervention at any stage**.

---

## 🧠 On-Chain Agent Architecture

Pythia utilizes three distinct Somnia decentralized agent types to drive its autonomous lifecycle:

```text
                       [ REAL-WORLD DATA FEEDS ]
                     (Prices, Sentiment, Gas, Mempool)
                                   │
                                   ▼
                         🤖 off-chain agent.js
                       (PM2 Daemon on AWS EC2)
                                   │
                    1. scoreEvent(news_headline)
                                   │
                                   ▼
                       📜 PythiaOracle Contract
              (0x153e324e6E7D65720da3dd947620C145a5a3f235)
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │ 2. query                                            │ 5. query
        ▼                                                     ▼
🧠 Somnia LLM Agent                                   🌐 Somnia JSON API Agent
(ID: 12847293847561029384)                            (ID: 13174292974160097713)
  └─────┬───────────────────────────────────────────────────────┘
        │ 3. handleResponse() callback
        ▼
   [ Score > 60? ]
        │
        ├─► Yes: 🏭 MarketFactory.createMarket()
        │        │
        │        ▼
        │     📜 PredictionMarket Contract (Instance)
        │        │  - YES / NO pools
        │        │  - Automated late betting fee structure
        │        │  - Proportional pool payout mathematics
        │        │
        │        ├─◄ 4. User Places Bets (Web App UI)
        │        │
        │        └─◄ 6. resolve(outcome)
        │              (Callback comparing strike vs API price)
        │
        └─► No: Discard proposal
```

### Deployed Agent IDs & Mappings
1. **LLM Inference Agent (`12847293847561029384`)**: Powered by a fine-tuned `Qwen3-30B` LLM. It ingests news, scores the headline's potential impact on a `0-100` index on-chain, and produces the logical justification for market parameters.
2. **JSON API Request Agent (`13174292974160097713`)**: Queries external REST endpoints (e.g. CoinGecko) in a decentralized validator container, parses the payload on-chain, and feeds the numerical results back to the Oracle contract.
3. **LLM Parse Website Agent (`128754011420769069085`)**: Used to crawl and structure text outcome pages for non-price markets (such as sentiment and correlation channels).

---

## 🛠️ Tech Stack

* **Smart Contracts**: Solidity (v0.8.20), Foundry
* **Frontend Web App**: Next.js 15 (App Router), React 19, RainbowKit & Wagmi, Ethers.js v6, Framer Motion
* **Agent Infrastructure**: Node.js, PM2 process runner, AWS EC2
* **Off-chain State Sync**: Supabase Realtime (for dynamic dashboard metrics and activity syncing)
* **RPC Endpoint**: `https://dream-rpc.somnia.network` (Chain ID: `50312`)

---

## 📋 Deployed Contract Addresses

| Contract Name | Network | Address |
|---|---|---|
| **PythiaOracle** | Somnia Testnet | `0x153e324e6E7D65720da3dd947620C145a5a3f235` |
| **MarketFactory** | Somnia Testnet | `0xA8AcAB87d7daf8A54aAD6E47fBf14b610aB92C2c` |
| **PredictionMarkets** | Somnia Testnet | Deployed dynamically (34 instances live) |

---

## ⚖️ Judging Criteria Alignment

### 1. Functionality & Integration
* **Status**: Fully operational. 34 unique prediction markets have been autonomously deployed, funded, and are awaiting trustless resolving.
* **Betting & Payout Engine**: Dynamic contract math splits the total STT pool proportionally among the winning side, deducting a standard `2%` protocol treasury fee. A progressive `5%` late fee is applied to bets placed within 24 hours of the deadline to penalize last-minute arbitrageurs.

### 2. Agent-First Protocol Design
* **On-Chain Sentiment**: Off-chain scripts cannot create markets. Creation decisions are delegated entirely to the on-chain LLM scoring response. If the LLM returns an impact score of 60 or below, the proposal is discarded, protecting the treasury from low-utility deployments.
* **Consent & Execution**: The Oracle contract handles deposits and triggers callbacks natively, keeping the validation path trustless.

### 3. Innovation & Logic Depth
* **Dynamic Strike Calculation**: Strike targets are not hardcoded. They are calculated dynamically using asset price volatility (standard deviation metrics) over the past 24 hours, ensuring fair risk/reward ratios.
* **Macro Reasoning Engine**: The agent cross-references on-chain metrics (SOMI gas fees, active address thresholds, fear & greed indexes, and BTC dominance percentage) to establish market correlation indexes.
* **Recursive META Markets**: Pythia creates markets based on its own performance (e.g., "Will Pythia maintain an LLM accuracy rate above 75% this week?").

### 4. Fully Autonomous Operation
* **Infrastructure**: The off-chain orchestrator daemon (`agent.js`) runs continuously via PM2 on AWS EC2. It polls prices, feeds triggers, and manages oracle resolution calls.
* **Zero Human Input**: Expired markets are closed, resolved on-chain via the JSON API agent, and payouts distributed with no administrative key requirements.

---

## 🗂️ Project Repository Structure

```text
├── src/                      # Solidity Smart Contracts
│   ├── PythiaOracle.sol      # Requests/callbacks gateway to Somnia platform
│   ├── MarketFactory.sol     # Factory deploying individual prediction pools
│   └── PredictionMarket.sol  # Pool logic, bet placements, and claiming math
├── scripts/                  # Onchain Agent & Operational Scripts
│   ├── agent.js              # The PM2-managed orchestrator daemon
│   ├── resolve.js            # Resolution trigger cron running every 30min
│   ├── seed-markets.js       # Developer bootstrapping script
│   └── calc-metrics.js       # Live contract metrics validator
└── frontend/                 # Next.js App Router Web UI
    ├── src/app/              # / (Markets), /agent (Metrics), /leaderboard, /claims
    ├── src/components/       # Header, MarketsBrowser, PriceTicker, AgentFeed
    └── public/               # Favicon assets and site manifest metadata
```

---

## 🚦 Local Installation & Setup

### Prerequisites
* [Node.js v18+](https://nodejs.org)
* [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract compiling)

### 1. Clone & Build Contracts
```bash
git clone https://github.com/danielamodu/Pythia.git
cd Pythia
forge build
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory and the `frontend/` directory using the following values:
```env
PRIVATE_KEY="your-funded-wallet-private-key"
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
```

### 3. Launch Frontend Web App
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the client dashboard.

### 4. Start the Off-chain Autonomous Agent
To run the automated loop locally in demo-mode (fast 2-minute market expiration thresholds):
```bash
node scripts/agent.js --demo
```

---

## 📸 Screenshots & UI

*(Screenshots will be uploaded here showing the Sleek Dark Glassmorphic Theme, the Live Agent Feed, and the Betting Interface)*

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
