"use client";

import { Suspense } from "react";
import Header from "../../components/Header";
import AgentPortfolio from "../../components/AgentPortfolio";
import AgentFeed from "../../components/AgentFeed";
import MarketsBrowser from "../../components/MarketsBrowser";
import IntelligenceDashboard from "../../components/IntelligenceDashboard";
import styles from "./Agent.module.css";

export default function AgentPage() {
  return (
    <Suspense fallback={<div style={{color: '#888', padding: '2rem'}}>Loading Agent...</div>}>
      <main className={styles.main}>
        <Header />
        
        <div className={styles.hero}>
          <h1 className={styles.title}>PYTHIA · AUTONOMOUS AGENT</h1>
          <p className={styles.subtitle}>CONTINUOUS ON-CHAIN PREDICTION MARKET DEPLOYER</p>
        </div>

        <IntelligenceDashboard />

        <div className={styles.splitLayout}>
          <div className={styles.leftCol}>
            <AgentPortfolio />
          </div>
          <div className={styles.rightCol}>
            <AgentFeed />
          </div>
        </div>

        <div className={styles.marketsSection}>
          <h2 className={styles.sectionTitle}>MARKETS DEPLOYED BY PYTHIA</h2>
          <MarketsBrowser selectedAsset={null} />
        </div>
      </main>
    </Suspense>
  );
}
