"use client";

import { useEffect, useState } from "react";
import * as ethers from "ethers";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { RPC_URL, MARKET_FACTORY_ADDRESS } from "../../utils/constants";
import { MARKET_FACTORY_ABI, PREDICTION_MARKET_ABI } from "../../utils/abis";
import Header from "../../components/Header";
import styles from "./Claims.module.css";
import { parseAbi } from "viem";

const CLAIM_ABI = parseAbi([
  "function claimWinnings() external"
]);

type ClaimableMarket = {
  address: string;
  question: string;
  winnings: number;
};

export default function ClaimsPage() {
  const { address, isConnected } = useAccount();
  const [claimable, setClaimable] = useState<ClaimableMarket[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    async function fetchClaims() {
      if (!address) {
        setLoading(false);
        return;
      }
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(MARKET_FACTORY_ADDRESS, MARKET_FACTORY_ABI, provider);
        const marketAddresses: string[] = await factory.getMarkets();

        const claims: ClaimableMarket[] = [];

        const marketPromises = marketAddresses.map(async (marketAddr) => {
          const market = new ethers.Contract(marketAddr, PREDICTION_MARKET_ABI, provider);
          try {
            const [state, outcome, question] = await Promise.all([
              market.state(),
              market.outcome(),
              market.question()
            ]);

            // If resolved
            if (Number(state) === 2) {
              const filter = market.filters.BetPlaced(address);
              const logs = await market.queryFilter(filter);
              
              let hasClaimed = false;
              try {
                const claimFilter = market.filters.WinningsClaimed(address);
                const claimLogs = await market.queryFilter(claimFilter);
                if (claimLogs.length > 0) hasClaimed = true;
              } catch(e) {}

              if (!hasClaimed) {
                let betOnWinningSide = false;
                let userVolume = 0;
                
                logs.forEach((log: any) => {
                  const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
                  if (parsed && parsed.args[1] === outcome) {
                    betOnWinningSide = true;
                    userVolume += parseFloat(ethers.formatEther(parsed.args[2]));
                  }
                });

                if (betOnWinningSide) {
                  // Simplified winnings calculation for display
                  // Real calculation involves pool shares
                  const [totalYes, totalNo] = await Promise.all([market.totalYes(), market.totalNo()]);
                  const pool = parseFloat(ethers.formatEther(totalYes)) + parseFloat(ethers.formatEther(totalNo));
                  const winningPool = outcome ? parseFloat(ethers.formatEther(totalYes)) : parseFloat(ethers.formatEther(totalNo));
                  
                  const share = userVolume / winningPool;
                  const estimatedWinnings = pool * share;

                  claims.push({
                    address: marketAddr,
                    question,
                    winnings: estimatedWinnings
                  });
                }
              }
            }
          } catch(e) {}
        });

        await Promise.all(marketPromises);
        setClaimable(claims);
      } catch(e) {
        console.error(e);
      }
      setLoading(false);
    }
    fetchClaims();
  }, [address, isSuccess]);

  const handleClaim = (marketAddr: string) => {
    writeContract({
      address: marketAddr as `0x${string}`,
      abi: CLAIM_ABI,
      functionName: "claimWinnings",
    });
  };

  return (
    <main className={styles.main}>
      <Header />
      
      <div className={styles.container}>
        <h1 className={styles.title}>YOUR CLAIMS</h1>
        <p className={styles.subtitle}>UNCLAIMED WINNINGS</p>

        {!isConnected ? (
          <div className={styles.emptyState}>CONNECT WALLET TO VIEW CLAIMS</div>
        ) : loading ? (
          <div className={styles.emptyState}>LOADING...</div>
        ) : claimable.length === 0 ? (
          <div className={styles.emptyState}>NO UNCLAIMED WINNINGS</div>
        ) : (
          <div className={styles.grid}>
            {claimable.map(claim => (
              <div key={claim.address} className={styles.claimCard}>
                <div className={styles.question}>{claim.question}</div>
                <div className={styles.bottomRow}>
                  <div className={styles.winningsInfo}>
                    <span className={styles.label}>ESTIMATED RETURN</span>
                    <span className={styles.amount}>{claim.winnings.toFixed(2)} STT</span>
                  </div>
                  <button 
                    className={styles.claimBtn}
                    onClick={() => handleClaim(claim.address)}
                    disabled={isPending || isConfirming}
                  >
                    {isPending || isConfirming ? "CLAIMING..." : "CLAIM"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
