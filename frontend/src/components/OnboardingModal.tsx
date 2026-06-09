"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import styles from "./OnboardingModal.module.css";

export default function OnboardingModal() {
  const { address, isConnected } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && isConnected && address) {
      const key = `pythia_onboarded_${address}`;
      const onboarded = localStorage.getItem(key);
      if (!onboarded) {
        setIsOpen(true);
      }
    }
  }, [isMounted, isConnected, address]);

  const handleClose = () => {
    if (address) {
      localStorage.setItem(`pythia_onboarded_${address}`, "true");
    }
    setIsOpen(false);
  };

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  if (!isMounted || !isOpen) return null;

  return (
    <div className={styles.overlay}>
      {step === 1 && (
        <div key="step1" className={styles.content}>
          <div className={styles.icon}>👁️</div>
          <h2 className={styles.heading}>WELCOME TO PYTHIA</h2>
          <p className={styles.bodyText}>
            The first autonomous prediction market agent on Somnia. No human resolvers. No manual creation. Just onchain intelligence.
          </p>
        </div>
      )}

      {step === 2 && (
        <div key="step2" className={styles.content}>
          <h2 className={styles.heading}>HOW IT WORKS</h2>
          <div className={styles.rowList}>
            <div className={styles.rowItem}>
              <span className={styles.rowIcon}>🔮</span>
              <span><strong>Pythia scans real-world data</strong> across APIs and chain state.</span>
            </div>
            <div className={styles.rowItem}>
              <span className={styles.rowIcon}>🏛️</span>
              <span><strong>Deploys markets autonomously</strong> when triggers are met.</span>
            </div>
            <div className={styles.rowItem}>
              <span className={styles.rowIcon}>✅</span>
              <span><strong>Resolves outcomes onchain</strong> using deterministic data.</span>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div key="step3" className={styles.content}>
          <h2 className={styles.heading}>PLACE YOUR FIRST BET</h2>
          <p className={styles.bodyText} style={{ marginBottom: "24px" }}>
            You'll need STT to bet. Get testnet STT from the Somnia faucet at{" "}
            <a href="https://faucet.somnia.network" target="_blank" rel="noreferrer" className={styles.link}>
              faucet.somnia.network
            </a>
          </p>
          <p className={styles.bodyText}>
            Markets are created by Pythia — just pick a side and bet.
          </p>
        </div>
      )}

      <div className={styles.nav}>
        <div className={styles.dots}>
          <div className={`${styles.dot} ${step >= 1 ? styles.dotActive : ""}`} />
          <div className={`${styles.dot} ${step >= 2 ? styles.dotActive : ""}`} />
          <div className={`${styles.dot} ${step >= 3 ? styles.dotActive : ""}`} />
        </div>
        <div className={styles.buttons}>
          {step < 3 && <button className={styles.skipBtn} onClick={handleClose}>SKIP</button>}
          <button className={styles.nextBtn} onClick={handleNext}>
            {step === 3 ? "START EXPLORING" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}
