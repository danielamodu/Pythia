"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import * as ethers from "ethers";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../utils/constants";
import { MARKET_FACTORY_ABI, PREDICTION_MARKET_ABI } from "../utils/abis";
import MarketDetailModal from "./MarketDetailModal";
import { Sparkline } from "./PriceTicker";
import styles from "./MarketsBrowser.module.css";

export type BetInfo = { user: string; side: boolean; amount: string };

export type MarketData = {
  address: string;
  question: string;
  totalYes: string;
  totalNo: string;
  deadline: number;
  state: number;
  outcome: boolean;
  confidence?: number;
  reasoning?: string;
  type?: string;
  uniqueBettors: string[];
  bets: BetInfo[];
};

const ASSETS_MAP: Record<string, string> = {
  "BTC": "bitcoin",
  "ETH": "ethereum",
  "SOL": "solana",
  "SOMI": "somnia"
};

export default function MarketsBrowser({ selectedAsset }: { selectedAsset: string | null }) {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<{ market: MarketData, initialSide: "YES" | "NO" } | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("ALL");
  const searchParams = useSearchParams();
  const searchQuery = searchParams?.get("q") || "";
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});

  useEffect(() => {
    async function fetchSparklines() {
      const data: Record<string, number[]> = {};
      for (const [ticker, id] of Object.entries(ASSETS_MAP)) {
        try {
          const res = await fetch(`/api/sparkline?id=${id}`);
          if (res.ok) {
            const json = await res.json();
            if (json.prices) {
              data[ticker] = json.prices.map((p: any) => p[1]);
            }
          }
        } catch (e) {}
      }
      setSparklines(data);
    }
    fetchSparklines();
    const interval = setInterval(fetchSparklines, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const marketAddresses: string[] = await factory.getMarkets();

        let reasoningData: any[] = [];
        try {
          const res = await fetch("/api/reasoning");
          reasoningData = await res.json();
        } catch (e) {
          console.error("Failed to fetch reasoning", e);
        }

        const marketPromises = marketAddresses.map(async (address) => {
          const marketContract = new ethers.Contract(address, PREDICTION_MARKET_ABI, provider);
          
          const [question, totalYes, totalNo, deadline, state, outcome] = await Promise.all([
            marketContract.question(),
            marketContract.totalYes(),
            marketContract.totalNo(),
            marketContract.deadline(),
            marketContract.state(),
            marketContract.outcome()
          ]);

          let bets: BetInfo[] = [];
          let uniqueBettors: string[] = [];
          try {
            const filter = marketContract.filters.BetPlaced();
            const logs = await marketContract.queryFilter(filter);
            const bettersSet = new Set<string>();
            logs.forEach((log: any) => {
              const parsed = marketContract.interface.parseLog({ topics: log.topics, data: log.data });
              if (parsed) {
                const user = parsed.args[0];
                bettersSet.add(user);
                bets.push({
                  user,
                  side: parsed.args[1],
                  amount: ethers.formatEther(parsed.args[2])
                });
              }
            });
            uniqueBettors = Array.from(bettersSet);
          } catch(e) {}

          const marketReasoning = reasoningData.find(r => r.marketAddress?.toLowerCase() === address.toLowerCase() || r.question === question);

          return {
            address,
            question,
            totalYes: ethers.formatEther(totalYes),
            totalNo: ethers.formatEther(totalNo),
            deadline: Number(deadline),
            state: Number(state),
            outcome,
            confidence: marketReasoning?.confidence,
            reasoning: marketReasoning?.reasoning,
            type: marketReasoning?.type || "PRICE",
            uniqueBettors,
            bets
          };
        });

        const resolvedMarkets = await Promise.all(marketPromises);
        resolvedMarkets.sort((a, b) => {
          if (a.state !== b.state) return a.state - b.state;
          return b.deadline - a.deadline;
        });

        setMarkets(resolvedMarkets);
      } catch (err) {
        console.error("Failed to fetch markets", err);
      }
    }

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 10000);
    return () => clearInterval(interval);
  }, []);

  const getFilteredMarkets = () => {
    return markets.filter(m => {
      // Asset filtering
      if (selectedAsset && !m.question.includes(selectedAsset)) return false;

      // Text search filtering
      if (searchQuery && !m.question.toLowerCase().includes(searchQuery.toLowerCase())) return false;

      // Tab filtering
      if (activeFilter === "OPEN") return m.state === 0;
      if (activeFilter === "RESOLVED") return m.state === 2;
      if (activeFilter === "CORRELATION") return m.type === "CORRELATION";
      if (activeFilter === "PRICE") return m.type === "PRICE";
      if (activeFilter === "VOLUME") return m.type === "VOLUME";

      return true; // "ALL"
    });
  };

  const filteredMarkets = getFilteredMarkets();

  return (
    <div className={styles.container}>
      <div className={styles.filterRow}>
        <div className={styles.tabs}>
          {["ALL", "OPEN", "RESOLVED", "CORRELATION", "PRICE", "VOLUME"].map(tab => (
            <button 
              key={tab} 
              className={`${styles.tabBtn} ${activeFilter === tab ? styles.activeTab : ""}`}
              onClick={() => setActiveFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {filteredMarkets.length === 0 && (
          <div className={styles.emptyState}>
            NO MARKETS FOUND
          </div>
        )}
        {filteredMarkets.map((market) => {
          const totalPool = parseFloat(market.totalYes) + parseFloat(market.totalNo);
          let yesProb = 50;
          let noProb = 50;
          if (totalPool > 0) {
            yesProb = Math.round((parseFloat(market.totalYes) / totalPool) * 100);
            noProb = 100 - yesProb;
          }

          const isOpen = market.state === 0;

          const now = Math.floor(Date.now() / 1000);
          const diff = market.deadline - now;
          let deadlineStr = "";
          if (diff <= 0) {
            deadlineStr = "ENDED";
          } else {
            const days = Math.floor(diff / (24 * 3600));
            const hours = Math.floor((diff % (24 * 3600)) / 3600);
            deadlineStr = `${days}d ${hours}h remaining`;
          }

          let correlatedAssets = "";
          if (market.type === "CORRELATION") {
            if (market.question.includes("BTC") && market.question.includes("ETH")) correlatedAssets = "BTC · ETH";
            else if (market.question.includes("BTC") && market.question.includes("SOL")) correlatedAssets = "BTC · SOL";
            else if (market.question.includes("ETH") && market.question.includes("SOL")) correlatedAssets = "ETH · SOL";
          }

          let primaryAsset = "";
          if (market.question.includes("BTC")) primaryAsset = "BTC";
          else if (market.question.includes("ETH")) primaryAsset = "ETH";
          else if (market.question.includes("SOL")) primaryAsset = "SOL";
          else if (market.question.includes("SOMI")) primaryAsset = "SOMI";

          const marketSparkline = primaryAsset ? sparklines[primaryAsset] : [];

          return (
            <motion.div 
              key={market.address} 
              className={styles.card} 
              onClick={() => setSelectedMarket({ market, initialSide: "YES" })}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              whileHover={{ y: -5, boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
            >
              <div className={styles.cardHeader}>
                <div className={styles.oracleTag} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {market.reasoning ? (
                    <>
                      <span style={{ color: '#00ff00', fontSize: '10px' }}>●</span>
                      <span>DEPLOYED BY PYTHIA</span>
                    </>
                  ) : (
                    <span>⬡ PYTHIA ORACLE</span>
                  )}
                </div>
                {market.type === "CORRELATION" ? (
                  <div className={styles.compoundBadge}>⬡ COMPOUND {correlatedAssets}</div>
                ) : (
                  <div className={styles.typeBadge}>{market.type}</div>
                )}
              </div>
              
              <h3 className={styles.question}>{market.question}</h3>
              
              <div className={styles.agentReasoning}>
                <span className={styles.confidence}>CONFIDENCE {market.confidence ? `${market.confidence}%` : "—"}</span>
                {market.reasoning && <p className={styles.reasoningText}>{market.reasoning}</p>}
              </div>

              {primaryAsset && (
                <div style={{ marginTop: '16px', opacity: 0.5, display: 'flex', alignItems: 'center', height: '32px' }}>
                  <div style={{ width: '80px', height: '100%' }}>
                    <Sparkline prices={marketSparkline} />
                  </div>
                  <span style={{ fontSize: '10px', marginLeft: '12px', fontFamily: 'var(--font-space-mono)' }}>1M {primaryAsset}</span>
                </div>
              )}

              <div className={styles.probabilityBar}>
                <div className={styles.yesBar} style={{ width: `${yesProb}%` }}></div>
              </div>
              
              <div className={styles.odds}>
                <span>YES {yesProb}%</span>
                <span>NO {noProb}%</span>
              </div>

              <div className={styles.statsRow}>
                <span>VOL: {totalPool.toFixed(2)} STT</span>
                <span>{deadlineStr}</span>
                <span>{market.uniqueBettors.length} bettors</span>
              </div>

              {isOpen ? (
                <div className={styles.cardButtons}>
                  <button 
                    className={styles.cardYesBtn}
                    onClick={(e) => { e.stopPropagation(); setSelectedMarket({ market, initialSide: "YES" }); }}
                  >
                    YES
                  </button>
                  <button 
                    className={styles.cardNoBtn}
                    onClick={(e) => { e.stopPropagation(); setSelectedMarket({ market, initialSide: "NO" }); }}
                  >
                    NO
                  </button>
                </div>
              ) : (
                <div className={styles.cardStateContainer}>
                  <div className={market.state === 1 ? styles.closedState : styles.resolvedState}>
                    {market.state === 1 ? "CLOSED" : `RESOLVED: ${market.outcome ? "YES" : "NO"}`}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      
      {selectedMarket && (
        <MarketDetailModal 
          market={selectedMarket.market} 
          initialSide={selectedMarket.initialSide}
          onClose={() => setSelectedMarket(null)} 
        />
      )}
    </div>
  );
}
