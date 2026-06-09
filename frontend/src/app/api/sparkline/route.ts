import { NextResponse } from "next/server";

// Cache in memory: { [id]: { data: [number, number][], expires: number } }
const cache: Record<string, { data: [number, number][]; expires: number }> = {};
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const now = Date.now();

  // Return cached data if valid
  if (cache[id] && cache[id].expires > now) {
    return NextResponse.json({ prices: cache[id].data });
  }

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      if (res.status === 429) {
        // If rate limited, use stale cache if available, otherwise return error
        if (cache[id]) {
          return NextResponse.json({ prices: cache[id].data, stale: true });
        }
      }
      return NextResponse.json({ error: `CoinGecko API returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const prices = data.prices;

    if (prices && Array.isArray(prices)) {
      cache[id] = {
        data: prices,
        expires: now + CACHE_DURATION_MS,
      };
      return NextResponse.json({ prices });
    }

    return NextResponse.json({ error: "Invalid data format from CoinGecko" }, { status: 500 });
  } catch (error) {
    console.error(`Failed to fetch sparkline for ${id}:`, error);
    
    if (cache[id]) {
      return NextResponse.json({ prices: cache[id].data, stale: true });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
