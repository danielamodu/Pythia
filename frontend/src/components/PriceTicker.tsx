"use client";

import { useEffect, useState } from "react";
import styles from "./PriceTicker.module.css";

const ASSETS = [
  { id: "bitcoin", ticker: "BTC", name: "Bitcoin" },
  { id: "ethereum", ticker: "ETH", name: "Ethereum" },
  { id: "solana", ticker: "SOL", name: "Solana" },
  { id: "somnia", ticker: "SOMI", name: "Somnia" },
  { id: "hyperliquid", ticker: "HYPE", name: "Hyperliquid" },
  { id: "the-open-network", ticker: "TON", name: "Toncoin" },
  { id: "sui", ticker: "SUI", name: "Sui" },
];

type AssetData = {
  id: string;
  ticker: string;
  name: string;
  price: number;
  change1m: number;
  sparkline: number[]; // just prices
};

export function Sparkline({ prices }: { prices: number[] }) {
  if (!prices || !prices.length) {
    return <span style={{ fontFamily: "var(--font-dm-mono)", color: "#888888" }}>——</span>;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const width = 100;
  const height = 32;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - ((p - min) / (max - min || 1)) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline 
        points={points} 
        fill="none" 
        stroke="white" 
        strokeWidth="1.5" 
        vectorEffect="non-scaling-stroke"
        className={styles.sparklinePoly}
      />
    </svg>
  );
}

export default function PriceTicker({ 
  selectedAsset, 
  onSelectAsset 
}: { 
  selectedAsset: string | null, 
  onSelectAsset: (asset: string | null) => void 
}) {
  const [data, setData] = useState<AssetData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTickers() {
      try {
        const fetched = await Promise.all(
          ASSETS.map(async (asset) => {
            const res = await fetch(`/api/sparkline?id=${asset.id}`);
            if (!res.ok) return null;
            const json = await res.json();
            const prices = json.prices as [number, number][];
            if (!prices || prices.length === 0) return null;
            
            const currentPrice = prices[prices.length - 1][1];
            const oldPrice = prices[0][1];
            const change1m = ((currentPrice - oldPrice) / oldPrice) * 100;
            
            return {
              id: asset.id,
              ticker: asset.ticker,
              name: asset.name,
              price: currentPrice,
              change1m,
              sparkline: prices.map(p => p[1])
            };
          })
        );
        setData(fetched.filter(Boolean) as AssetData[]);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch ticker data", err);
      }
    }
    fetchTickers();
    const interval = setInterval(fetchTickers, 5 * 60 * 1000); // 5 min
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (price: number) => {
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
  };

  return (
    <div className={styles.tickerContainer}>
      {loading && ASSETS.map(asset => (
        <div key={asset.id} className={styles.card}>
          <div className={styles.assetInfo}>
            <div className={styles.assetName}>{asset.name} · {asset.ticker}</div>
            <div className={styles.priceRow}>
              <span className={styles.price}>——</span>
            </div>
          </div>
          <div className={styles.chart}>
            <span style={{ fontFamily: "var(--font-dm-mono)", color: "#888888" }}>——</span>
          </div>
        </div>
      ))}
      {!loading && data.map(asset => {
        const isPositive = asset.change1m >= 0;
        const isActive = selectedAsset === asset.ticker;
        return (
          <div 
            key={asset.id} 
            className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
            onClick={() => onSelectAsset(isActive ? null : asset.ticker)}
          >
            <div className={styles.assetInfo}>
              <div className={styles.assetName}>{asset.name} · {asset.ticker}</div>
              <div className={styles.priceRow}>
                <span className={styles.price}>${formatPrice(asset.price)}</span>
                <span className={`${styles.change} ${isPositive ? styles.positive : styles.negative}`}>
                  {isPositive ? "↑" : "↓"} {Math.abs(asset.change1m).toFixed(2)}%
                </span>
              </div>
            </div>
            <div className={styles.chart}>
              <Sparkline prices={asset.sparkline} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
