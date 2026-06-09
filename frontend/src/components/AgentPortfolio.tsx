"use client";

import { useEffect, useState } from "react";
import * as ethers from "ethers";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../utils/constants";
import { MARKET_FACTORY_ABI } from "../utils/abis";
import styles from "./AgentPortfolio.module.css";

export default function AgentPortfolio() {
  const [stats, setStats] = useState({
    totalSeeded: "0.00",
    totalMarkets: 0,
    winRate: "0.0"
  });

  useEffect(() => {
    async function fetchAgentStats() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const markets = await factory.getMarkets();
        
        // Agent seeds 0.005 STT per market to YES and NO (0.01 total)
        const totalSeeded = markets.length * 0.01;
        
        setStats({
          totalSeeded: totalSeeded.toFixed(2),
          totalMarkets: markets.length,
          winRate: "50.0" // Simulated
        });
      } catch(e) {
        console.error(e);
      }
    }
    fetchAgentStats();
  }, []);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>AGENT TREASURY</h2>
      
      <div className={styles.grid}>
        <div className={styles.statCard}>
          <label className={styles.label}>TOTAL SEEDED LIQUIDITY</label>
          <span className={styles.value}>{stats.totalSeeded} STT</span>
        </div>
        
        <div className={styles.statCard}>
          <label className={styles.label}>MARKETS DEPLOYED</label>
          <span className={styles.value}>{stats.totalMarkets}</span>
        </div>
        
        <div className={styles.statCard}>
          <label className={styles.label}>WIN RATE (SIMULATED)</label>
          <span className={styles.value}>{stats.winRate}%</span>
        </div>
      </div>
    </div>
  );
}
