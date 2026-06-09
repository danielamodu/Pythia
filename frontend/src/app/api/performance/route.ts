import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const dataPath = path.join(process.cwd(), 'data', 'performance.json');
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ categoryStats: {}, resolvedMarkets: [] });
    }
    const data = fs.readFileSync(dataPath, 'utf8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    console.error("Error reading performance data:", error);
    return NextResponse.json({ categoryStats: {}, resolvedMarkets: [] }, { status: 500 });
  }
}
