"use client";

import { useEffect, useState } from "react";
import styles from "./AgentFeed.module.css";

type FeedItem = {
  timestamp: string;
  type: string;
  message: string;
  marketAddress?: string;
};

export default function AgentFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useEffect(() => {
    async function fetchFeed() {
      try {
        const res = await fetch("/api/activity");
        if (res.ok) {
          const data = await res.json();
          setFeed(data.slice(0, 15)); // last 15 actions
        }
      } catch(e) {
        console.error(e);
      }
    }
    fetchFeed();
    const interval = setInterval(fetchFeed, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>ACTIVITY TIMELINE</h2>
      <div className={styles.timeline}>
        {feed.length === 0 && (
          <div className={styles.empty}>NO ACTIVITY YET</div>
        )}
        {feed.map((item, i) => (
          <div key={i} className={styles.feedItem}>
            <div className={styles.time}>{new Date(item.timestamp).toLocaleTimeString()}</div>
            <div className={styles.content}>
              <span className={styles.type}>{item.type}</span>
              <span className={styles.message}>{item.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
