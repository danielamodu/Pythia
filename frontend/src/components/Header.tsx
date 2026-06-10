"use client";

import { useEffect, useState } from "react";
import * as ethers from "ethers";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../utils/constants";
import { MARKET_FACTORY_ABI, PREDICTION_MARKET_ABI } from "../utils/abis";
import styles from "./Header.module.css";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, Suspense } from "react";
import { Info, Brain, GlobeLock, Zap, X } from "lucide-react";

export default function Header() {
  return (
    <Suspense fallback={<header className={styles.header}><div className={styles.topRow}>PYTHIA</div></header>}>
      <HeaderInner />
    </Suspense>
  );
}

function HeaderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const [stats, setStats] = useState({
    markets: 0,
    activeBettors: 0,
    totalVolume: 0,
    resolved: 0
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const marketAddresses: string[] = await factory.getMarkets();

        let totalVolume = 0;
        let resolvedCount = 0;
        let bettorsSet = new Set<string>();

        if (marketAddresses.length > 0) {
          const marketPromises = marketAddresses.map(async (address) => {
            const marketContract = new ethers.Contract(address, PREDICTION_MARKET_ABI, provider);
            let yesVal = 0n;
            let noVal = 0n;

            try {
              const [yes, no, state] = await Promise.all([
                marketContract.totalYes(), 
                marketContract.totalNo(),
                marketContract.state()
              ]);
              yesVal = yes;
              noVal = no;
              if (Number(state) === 2) resolvedCount++;
            } catch(e) {
              console.error("Failed to fetch state for market", address, e);
            }
            
            try {
              const filter = marketContract.filters.BetPlaced();
              const logs = await marketContract.queryFilter(filter);
              logs.forEach((log: any) => {
                const parsed = marketContract.interface.parseLog({ topics: log.topics, data: log.data });
                if (parsed) {
                  bettorsSet.add(parsed.args[0]);
                }
              });
            } catch(e) {
              console.error("Failed to query bets for market", address, e);
            }

            return parseFloat(ethers.formatEther(yesVal)) + parseFloat(ethers.formatEther(noVal));
          });
          const volumes = await Promise.all(marketPromises);
          totalVolume = volumes.reduce((acc, curr) => acc + curr, 0);
        }

        setStats({
          markets: marketAddresses.length,
          activeBettors: bettorsSet.size,
          totalVolume,
          resolved: resolvedCount
        });
      } catch (err) {
        console.error("Failed to fetch stats", err);
      }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
        setSearchQuery("");
        router.push("/");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.trim()) {
      router.push(`/?q=${encodeURIComponent(val)}`);
    } else {
      router.push("/");
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <div className={styles.brand}>
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>PYTHIA</h1>
          </Link>
          <span className={styles.badge}>POWERED BY SOMNIA AGENTIC L1</span>
        </div>

        <div className={styles.searchContainer} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input 
              ref={searchInputRef}
              type="text" 
              className={styles.searchInput} 
              placeholder="Search markets..." 
              value={searchQuery}
              onChange={handleSearchChange}
            />
            <span className={styles.searchShortcut}>/</span>
          </div>
          <button 
            onClick={() => setIsAboutOpen(true)}
            style={{ 
              background: 'none', 
              border: '1px solid #333', 
              color: '#888', 
              padding: '6px 12px', 
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'var(--font-space-mono)',
              fontSize: '0.85rem'
            }}
          >
            <Info size={16} /> HOW IT WORKS
          </button>
        </div>

        <ConnectButton.Custom>
          {({
            account,
            chain,
            openAccountModal,
            openChainModal,
            openConnectModal,
            mounted,
          }) => {
            const ready = mounted;
            const connected = ready && account && chain;

            return (
              <div
                {...(!ready && {
                  'aria-hidden': true,
                  style: {
                    opacity: 0,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  },
                })}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <button onClick={openConnectModal} type="button" className={styles.connectBtn}>
                        CONNECT WALLET
                      </button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <button onClick={openChainModal} type="button" className={styles.connectBtn}>
                        WRONG NETWORK
                      </button>
                    );
                  }

                  return (
                    <button onClick={openAccountModal} type="button" className={styles.connectBtn}>
                      {account.displayName}
                    </button>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>MARKETS CREATED</span>
          <span className={styles.statValue}>{stats.markets}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>TOTAL VOLUME</span>
          <span className={styles.statValue}>{stats.totalVolume.toFixed(2)} STT</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>ACTIVE BETTORS</span>
          <span className={styles.statValue}>{stats.activeBettors}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>RESOLVED</span>
          <span className={styles.statValue}>{stats.resolved}</span>
        </div>
      </div>

      {isAboutOpen && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.8)",
          zIndex: 1000,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backdropFilter: "blur(4px)"
        }} onClick={() => setIsAboutOpen(false)}>
          <div style={{
            background: "#111",
            border: "1px solid #333",
            padding: "40px",
            borderRadius: "12px",
            width: "500px",
            maxWidth: "90%",
            color: "#fff",
            position: "relative"
          }} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setIsAboutOpen(false)}
              style={{ position: "absolute", top: "20px", right: "20px", background: "none", border: "none", color: "#888", cursor: "pointer" }}
            >
              <X size={24} />
            </button>
            <h2 style={{ fontSize: "1.8rem", marginBottom: "15px", fontWeight: "bold" }}>Autonomous Architecture</h2>
            <p style={{ color: "#aaa", marginBottom: "30px", lineHeight: "1.5" }}>
              Pythia is an end-to-end agentic platform powered by the Somnia Network. 
              Real-world news is parsed by LLM Agents to autonomously create markets, and resolved on-chain purely by JSON API Agents.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", gap: "15px", alignItems: "flex-start" }}>
                <Brain color="#fff" size={24} style={{ marginTop: "3px" }} />
                <div>
                  <h4 style={{ fontWeight: "bold", marginBottom: "5px" }}>LLM Inference</h4>
                  <p style={{ color: "#888", fontSize: "0.9rem" }}>Autonomously scores breaking crypto news to deploy high-quality markets.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "15px", alignItems: "flex-start" }}>
                <GlobeLock color="#fff" size={24} style={{ marginTop: "3px" }} />
                <div>
                  <h4 style={{ fontWeight: "bold", marginBottom: "5px" }}>JSON API Agent</h4>
                  <p style={{ color: "#888", fontSize: "0.9rem" }}>Fetches and verifies real-world market data on-chain for trustless resolution.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "15px", alignItems: "flex-start" }}>
                <Zap color="#fff" size={24} style={{ marginTop: "3px" }} />
                <div>
                  <h4 style={{ fontWeight: "bold", marginBottom: "5px" }}>Somnia Validators</h4>
                  <p style={{ color: "#888", fontSize: "0.9rem" }}>Off-chain heavy computation executed securely via decentralized consensus.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
