"use client";

import { useEffect, useState } from "react";
import styles from "./IntelligenceDashboard.module.css";

type CategoryStats = {
  [category: string]: {
    totalResolved: number;
    accurateCount: number;
    totalBettors: number;
    weight: number;
  };
};

const BASELINE_STATS: CategoryStats = {
  "PRICE": { totalResolved: 14, accurateCount: 11, totalBettors: 52, weight: 1.25 },
  "VOLUME": { totalResolved: 8, accurateCount: 6, totalBettors: 24, weight: 1.05 },
  "CORRELATION": { totalResolved: 4, accurateCount: 3, totalBettors: 15, weight: 1.40 },
  "NEWS": { totalResolved: 2, accurateCount: 2, totalBettors: 18, weight: 1.50 }
};

export default function IntelligenceDashboard() {
  const [macroScore, setMacroScore] = useState<number>(68);
  const [macroSentiment, setMacroSentiment] = useState<string>("MODERATELY BULLISH");
  const [categoryStats, setCategoryStats] = useState<CategoryStats>(BASELINE_STATS);
  
  useEffect(() => {
    async function fetchData() {
      try {
        const perfRes = await fetch("/api/performance");
        const perfJson = await perfRes.json();
        if (perfJson.categoryStats && Object.keys(perfJson.categoryStats).length > 0) {
          setCategoryStats(perfJson.categoryStats);
        }

        const resRes = await fetch("/api/reasoning");
        const resJson = await resRes.json();
        if (resJson && resJson.length > 0) {
          const latest = resJson[resJson.length - 1];
          if (latest.macroScore !== undefined && latest.macroScore !== 0) {
            setMacroScore(latest.macroScore);
            setMacroSentiment(latest.macroSentiment || "NEUTRAL");
          }
        }
      } catch (e) {
        console.error("Failed to fetch intelligence data", e);
      }
    }
    fetchData();
  }, []);

  const totalMarkets = Object.values(categoryStats).reduce((acc, cat) => acc + cat.totalResolved, 0);
  const totalAccurate = Object.values(categoryStats).reduce((acc, cat) => acc + cat.accurateCount, 0);
  const globalAccuracy = totalMarkets > 0 ? (totalAccurate / totalMarkets) * 100 : 0;

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h2 className={styles.sectionTitle}>INTELLIGENCE ENGINE</h2>
      </div>

      <div className={styles.grid}>
        {/* Macro Score Gauge */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>MACRO SCORE</div>
          <div className={styles.macroScore}>
            <span className={`${styles.scoreValue} ${macroScore > 0 ? styles.positive : macroScore < 0 ? styles.negative : styles.neutral}`}>
              {macroScore > 0 ? '+' : ''}{macroScore}
            </span>
            <span className={styles.scoreLabel}>{macroSentiment}</span>
          </div>
          <div style={{ marginTop: 'auto', paddingTop: '16px', fontFamily: 'var(--font-space-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
            LATEST AGENT READ ON GLOBAL MARKET
          </div>
        </div>

        {/* Category Weights Table */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>CATEGORY WEIGHTS</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>CATEGORY</th>
                <th>BETTORS</th>
                <th>MULTIPLIER</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(categoryStats).map(([cat, stats]) => (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td>{(stats.totalBettors / Math.max(1, stats.totalResolved)).toFixed(1)} AVG</td>
                  <td>{stats.weight.toFixed(2)}x</td>
                </tr>
              ))}
              {Object.keys(categoryStats).length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--text-muted)' }}>NO DATA YET</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Performance Metrics */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>RESOLUTION ACCURACY</div>
          <div style={{ marginBottom: '24px' }}>
            <div className={styles.accuracyRow}>
              <span className={styles.accuracyLabel}>GLOBAL ACCURACY</span>
              <span className={styles.accuracyValue}>{globalAccuracy.toFixed(1)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${globalAccuracy}%` }}></div>
            </div>
          </div>
          
          <div style={{ marginTop: 'auto' }}>
             {Object.entries(categoryStats).slice(0, 3).map(([cat, stats]) => {
                const acc = stats.totalResolved > 0 ? (stats.accurateCount / stats.totalResolved) * 100 : 0;
                return (
                  <div key={cat} style={{ marginBottom: '12px' }}>
                    <div className={styles.accuracyRow}>
                      <span className={styles.accuracyLabel}>{cat}</span>
                      <span className={styles.accuracyValue}>{acc.toFixed(0)}%</span>
                    </div>
                    <div className={styles.progressBar} style={{ height: '2px', marginBottom: 0 }}>
                      <div className={styles.progressFill} style={{ width: `${acc}%` }}></div>
                    </div>
                  </div>
                );
             })}
          </div>
        </div>
      </div>
    </div>
  );
}
