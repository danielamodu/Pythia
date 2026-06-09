"use client";

import { useState, useEffect } from "react";
import { parseAbi, parseEther } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import toast from "react-hot-toast";
import type { MarketData } from "./MarketsBrowser";
import styles from "./MarketDetailModal.module.css";

const PREDICTION_MARKET_ABI = parseAbi([
  "function placeBet(bool side) external payable",
  "function claimWinnings() external"
]);

export default function MarketDetailModal({ market, initialSide = "YES", onClose }: { market: MarketData, initialSide?: "YES" | "NO", onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState<"YES" | "NO">(initialSide);
  
  const { isConnected } = useAccount();
  const { data: hash, isPending, writeContract, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const totalPool = parseFloat(market.totalYes) + parseFloat(market.totalNo);
  let yesProb = 50;
  let noProb = 50;
  if (totalPool > 0) {
    yesProb = Math.round((parseFloat(market.totalYes) / totalPool) * 100);
    noProb = 100 - yesProb;
  }

  useEffect(() => {
    if (isSuccess) {
      toast.success("Transaction confirmed!", {
        duration: 4000,
        style: {
          border: '1px solid #00ff00',
          background: 'rgba(0, 255, 0, 0.08)'
        }
      });
      // Refresh market data by whatever means the app uses, though simple approach is a timeout
      // In a real app we'd call a refetch function from props, but let's just close it after 2s
      setTimeout(() => {
        onClose();
        window.location.reload(); // Simple way to refresh data per request
      }, 2000);
    }
  }, [isSuccess, onClose]);

  useEffect(() => {
    if (error) {
      console.error(error);
      toast.error("Transaction failed", {
        style: {
          border: '1px solid #ff3333',
          background: 'rgba(255, 51, 51, 0.08)'
        }
      });
    }
  }, [error]);

  const handleBet = () => {
    if (!isConnected) {
      toast("Wallet not connected", {
        style: {
          border: '1px solid #666',
          background: 'rgba(255, 255, 255, 0.05)'
        }
      });
      return;
    }
    if (!amount) return;
    writeContract({
      address: market.address as `0x${string}`,
      abi: PREDICTION_MARKET_ABI,
      functionName: "placeBet",
      args: [side === "YES"],
      value: parseEther(amount),
    });
  };

  const handleClaim = () => {
    if (!isConnected) {
      toast("Wallet not connected", {
        style: {
          border: '1px solid #666',
          background: 'rgba(255, 255, 255, 0.05)'
        }
      });
      return;
    }
    writeContract({
      address: market.address as `0x${string}`,
      abi: PREDICTION_MARKET_ABI,
      functionName: "claimWinnings",
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <h2 className={styles.question}>{market.question}</h2>
        
        <div className={styles.stats}>
          <div className={styles.statBox}>
            <label>YES PROBABILITY</label>
            <span>{yesProb}%</span>
          </div>
          <div className={styles.statBox}>
            <label>NO PROBABILITY</label>
            <span>{noProb}%</span>
          </div>
          <div className={styles.statBox}>
            <label>TOTAL VOLUME</label>
            <span>{totalPool.toFixed(2)} STT</span>
          </div>
        </div>

        {market.state === 0 ? (
          <div className={styles.tradingUI}>
            <div className={styles.toggleGroup}>
              <button 
                className={`${styles.toggleBtn} ${side === "YES" ? styles.selected : ""}`}
                onClick={() => setSide("YES")}
              >
                YES
              </button>
              <button 
                className={`${styles.toggleBtn} ${side === "NO" ? styles.selected : ""}`}
                onClick={() => setSide("NO")}
              >
                NO
              </button>
            </div>
            <input 
              type="number" 
              placeholder="Amount (STT)" 
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className={styles.input}
            />
            <button 
              className={styles.placeBetBtn} 
              onClick={handleBet}
              disabled={isPending || isConfirming}
            >
              {isPending ? "CONFIRM IN WALLET..." : isConfirming ? "MINING..." : error ? "RETRY BET" : "PLACE BET"}
            </button>
            {error && (
              <div style={{ fontSize: '11px', marginTop: '12px', color: '#ff3333', border: '1px solid #ff3333', padding: '8px', background: 'rgba(255,51,51,0.08)', fontFamily: 'var(--font-space-mono)' }}>
                <strong>TX FAILED:</strong> {((error as any).shortMessage || error.message).slice(0, 80)}...
              </div>
            )}
            {hash && (
              <div style={{ fontSize: '10px', marginTop: '16px', color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'var(--font-dm-mono)' }}>
                TX: <a href={`https://shannon-explorer.somnia.network/tx/${hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: '#fff' }}>{hash}</a>
              </div>
            )}
          </div>
        ) : market.state === 1 ? (
          <div className={styles.closedState}>
            MARKET CLOSED - WAITING FOR RESOLUTION
          </div>
        ) : (
          <div className={styles.closedState}>
            <div>RESOLVED: {market.outcome ? "YES" : "NO"}</div>
            <button 
              className={styles.claimBtn} 
              onClick={handleClaim}
              disabled={isPending || isConfirming}
            >
              {isPending || isConfirming ? "CLAIMING..." : error ? "RETRY CLAIM" : "CLAIM WINNINGS"}
            </button>
            {error && (
              <div style={{ fontSize: '11px', marginTop: '12px', color: '#ff3333', border: '1px solid #ff3333', padding: '8px', background: 'rgba(255,51,51,0.08)', fontFamily: 'var(--font-space-mono)', textAlign: 'left' }}>
                <strong>TX FAILED:</strong> {((error as any).shortMessage || error.message).slice(0, 80)}...
              </div>
            )}
            {hash && (
              <div style={{ fontSize: '10px', marginTop: '16px', color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'var(--font-dm-mono)' }}>
                TX: <a href={`https://shannon-explorer.somnia.network/tx/${hash}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: '#fff' }}>{hash}</a>
              </div>
            )}
          </div>
        )}

        <div className={styles.bettorListSection}>
          <h3 className={styles.bettorListTitle}>ACTIVITY ({market.bets.length} BETS)</h3>
          <div className={styles.bettorList}>
            {market.bets.length === 0 ? (
              <div className={styles.emptyBets}>NO BETS YET</div>
            ) : (
              market.bets.map((bet, idx) => (
                <div key={idx} className={styles.betRow}>
                  <span className={styles.betUser}>{bet.user.slice(0, 6)}...{bet.user.slice(-4)}</span>
                  <span className={bet.side ? styles.betSideYes : styles.betSideNo}>{bet.side ? "YES" : "NO"}</span>
                  <span className={styles.betAmount}>{parseFloat(bet.amount).toFixed(2)} STT</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
