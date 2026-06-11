"use client";

import { useEffect, useState } from "react";
import * as ethers from "ethers";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../utils/constants";
import { MARKET_FACTORY_ABI, PREDICTION_MARKET_ABI } from "../utils/abis";
import styles from "./AgentPortfolio.module.css";

export default function AgentPortfolio() {
  const [stats, setStats] = useState({
    totalSeeded: "0.00",
    totalMarkets: 0,
    winRate: "0.0",
    netEarnings: "0.0000"
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAgentStats() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const markets = await factory.getMarkets();
        
        let reasoningData = [];
        try {
          const res = await fetch("/api/reasoning");
          if (res.ok) {
            reasoningData = await res.json();
          }
        } catch(e) {
          console.error("Failed to fetch reasoning data", e);
        }

        const marketPromises = markets.map(async (address: string) => {
          try {
            const marketContract = new ethers.Contract(address, PREDICTION_MARKET_ABI, provider);
            const [state, outcome, totalYes, totalNo, question] = await Promise.all([
              marketContract.state(),
              marketContract.outcome(),
              marketContract.totalYes(),
              marketContract.totalNo(),
              marketContract.question()
            ]);
            return {
              address,
              state: Number(state),
              outcome,
              totalYes: parseFloat(ethers.formatEther(totalYes)),
              totalNo: parseFloat(ethers.formatEther(totalNo)),
              question
            };
          } catch (e) {
            console.error(`Failed to fetch market details for ${address}`, e);
            return null;
          }
        });

        const resolvedMarkets = (await Promise.all(marketPromises)).filter((m): m is Exclude<typeof m, null> => m !== null);

        let totalSeeded = 0.0;
        let totalResolved = 0;
        let correctPredictions = 0;
        let netEarnings = 0.0;

        for (const m of resolvedMarkets) {
          totalSeeded += 0.01; // 0.01 STT seeded per market (0.005 YES + 0.005 NO)

          if (m.state === 2) {
            totalResolved++;
            
            // Find reasoning entry to determine agent's confidence/prediction
            const reasoning = reasoningData.find(
              (r: any) => r.marketAddress?.toLowerCase() === m.address.toLowerCase() || r.question === m.question
            );
            let confidence = 75; // default fallback if not found
            if (reasoning && reasoning.confidence !== undefined) {
              confidence = reasoning.confidence;
            }

            const agentPredictedYes = confidence > 50;
            const isCorrect = (agentPredictedYes && m.outcome) || (!agentPredictedYes && !m.outcome);
            if (isCorrect) {
              correctPredictions++;
            }

            // Precise net earnings from this market
            // Payout calculation: (userBetAmount * totalPool) / winningPool
            const userBetAmount = 0.005;
            const winningPool = m.outcome ? m.totalYes : m.totalNo;
            const totalPool = m.totalYes + m.totalNo;

            if (winningPool > 0) {
              const payout = (userBetAmount * totalPool) / winningPool;
              // Protocol fee is 2%
              const netPayout = payout * 0.98;
              const earnings = netPayout - 0.01; // seeded cost was 0.01 STT
              netEarnings += earnings;
            } else {
              netEarnings -= 0.01;
            }
          }
        }

        const winRate = totalResolved > 0 ? (correctPredictions / totalResolved) * 100 : 0.0;

        setStats({
          totalSeeded: totalSeeded.toFixed(2),
          totalMarkets: markets.length,
          winRate: winRate.toFixed(1),
          netEarnings: netEarnings.toFixed(4)
        });
      } catch(e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchAgentStats();
  }, []);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>AGENT TREASURY</h2>
      
      {loading ? (
        <div style={{ color: "#888", fontFamily: "var(--font-space-mono)", fontSize: "12px", padding: "10px" }}>
          CALCULATING TREASURY BALANCE & METRICS...
        </div>
      ) : (
        <div className={styles.grid}>
          <div className={styles.statCard}>
            <label className={styles.label}>TOTAL SEEDED LIQUIDITY</label>
            <span className={styles.value}>{stats.totalSeeded} STT</span>
          </div>
          
          <div className={styles.statCard}>
            <label className={styles.label}>NET TREASURY EARNINGS</label>
            <span 
              className={styles.value} 
              style={{ color: parseFloat(stats.netEarnings) >= 0 ? "#00ff00" : "#ff3333" }}
            >
              {parseFloat(stats.netEarnings) >= 0 ? "+" : ""}{stats.netEarnings} STT
            </span>
          </div>
          
          <div className={styles.statCard}>
            <label className={styles.label}>PREDICTION WIN RATE</label>
            <span className={styles.value}>{stats.winRate}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
