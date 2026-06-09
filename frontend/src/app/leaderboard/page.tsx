"use client";

import { useEffect, useState } from "react";
import * as ethers from "ethers";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../../utils/constants";
import { MARKET_FACTORY_ABI, PREDICTION_MARKET_ABI } from "../../utils/abis";
import Header from "../../components/Header";
import styles from "./Leaderboard.module.css";

type BettorStat = {
  address: string;
  betsPlaced: number;
  volume: number;
  marketsWon: number;
  marketsResolved: number;
  winRate: number;
};

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<BettorStat[]>([]);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const marketAddresses: string[] = await factory.getMarkets();

        const statsMap = new Map<string, BettorStat>();
        const pythiaAddress = "0xAgent00000000000000000000000000000000000";

        for (const address of marketAddresses) {
          const market = new ethers.Contract(address, PREDICTION_MARKET_ABI, provider);
          try {
            const [state, outcome] = await Promise.all([
              market.state(),
              market.outcome()
            ]);
            
            const isResolved = Number(state) === 2;

            const filter = market.filters.BetPlaced();
            const logs = await market.queryFilter(filter);
            
            // To calculate win rate properly, we need to see what side they bet on.
            // If they bet multiple times on the same market, we just sum volume.
            // We'll simplify: if they bet on the winning side, they get a win point for this market.
            const userSides = new Map<string, boolean>();

            logs.forEach((log: any) => {
              const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
              if (parsed) {
                const user = parsed.args[0];
                const side = parsed.args[1];
                const amount = parseFloat(ethers.formatEther(parsed.args[2]));

                if (!statsMap.has(user)) {
                  statsMap.set(user, { address: user, betsPlaced: 0, volume: 0, marketsWon: 0, marketsResolved: 0, winRate: 0 });
                }
                const st = statsMap.get(user)!;
                st.betsPlaced += 1;
                st.volume += amount;
                userSides.set(user, side);
              }
            });

            if (isResolved) {
              for (const [user, side] of userSides.entries()) {
                const st = statsMap.get(user)!;
                st.marketsResolved += 1;
                if (side === outcome) {
                  st.marketsWon += 1;
                }
              }
            }
          } catch(e) {}
        }

        // Add dummy Pythia agent
        if (!statsMap.has(pythiaAddress)) {
          statsMap.set(pythiaAddress, {
            address: pythiaAddress,
            betsPlaced: marketAddresses.length * 2,
            volume: marketAddresses.length * 0.01,
            marketsWon: Math.floor(marketAddresses.length / 2),
            marketsResolved: marketAddresses.length,
            winRate: 50
          });
        }

        const sorted = Array.from(statsMap.values()).map(st => {
          st.winRate = st.marketsResolved > 0 ? (st.marketsWon / st.marketsResolved) * 100 : 0;
          return st;
        });
        
        // Remove agent from sorting pool
        const pythia = sorted.find(s => s.address === pythiaAddress)!;
        const others = sorted.filter(s => s.address !== pythiaAddress).sort((a, b) => b.volume - a.volume);

        setLeaderboard([pythia, ...others]);

      } catch (e) {
        console.error(e);
      }
    }
    fetchLeaderboard();
  }, []);

  return (
    <main className={styles.main}>
      <Header />
      
      <div className={styles.container}>
        <h1 className={styles.title}>LEADERBOARD</h1>
        <p className={styles.subtitle}>TOP TRADERS BY VOLUME</p>

        {leaderboard.length > 1 && (
          <div className={styles.podium}>
            {leaderboard.slice(1, 4).map((trader, idx) => (
              <div key={trader.address} className={`${styles.podiumCard} ${idx === 0 ? styles.firstPlace : ""}`}>
                <div className={styles.rankBadge}>#{idx + 1}</div>
                <div className={styles.address}>{trader.address.slice(0, 6)}...{trader.address.slice(-4)}</div>
                <div className={styles.volume}>{trader.volume.toFixed(2)} STT</div>
                <div className={styles.winRate}>{trader.winRate.toFixed(1)}% WR</div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>RANK</th>
                <th>TRADER</th>
                <th className={styles.rightAlign}>BETS</th>
                <th className={styles.rightAlign}>VOLUME</th>
                <th className={styles.rightAlign}>WIN RATE</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((trader, idx) => {
                const isPythia = trader.address === "0xAgent00000000000000000000000000000000000";
                const rank = isPythia ? "—" : idx;
                
                return (
                  <tr key={trader.address} className={isPythia ? styles.agentRow : ""}>
                    <td>{rank}</td>
                    <td>
                      {isPythia ? (
                        <span className={styles.agentBadge}>⬡ PYTHIA AGENT</span>
                      ) : (
                        `${trader.address.slice(0, 6)}...${trader.address.slice(-4)}`
                      )}
                    </td>
                    <td className={styles.rightAlign}>{trader.betsPlaced}</td>
                    <td className={styles.rightAlign}>{trader.volume.toFixed(2)} STT</td>
                    <td className={styles.rightAlign}>{trader.winRate.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
