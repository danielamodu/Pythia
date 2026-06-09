"use client";

import { useState, Suspense } from "react";
import Header from "../components/Header";
import PriceTicker from "../components/PriceTicker";
import MarketsBrowser from "../components/MarketsBrowser";

export default function Home() {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  return (
    <Suspense fallback={<div style={{color: '#888', padding: '2rem'}}>Loading...</div>}>
      <main style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "#000", color: "#fff" }}>
        <Header />
        <PriceTicker selectedAsset={selectedAsset} onSelectAsset={setSelectedAsset} />
        
        <div style={{ padding: "40px" }}>
          <h2 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "30px", paddingLeft: "20px" }}>Active Markets</h2>
          <MarketsBrowser selectedAsset={selectedAsset} />
        </div>
      </main>
    </Suspense>
  );
}
