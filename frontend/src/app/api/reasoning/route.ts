export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const dataPath = path.join(process.cwd(), "data", "reasoning.json");
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json([]);
    }
    const data = fs.readFileSync(dataPath, "utf8");
    return NextResponse.json(JSON.parse(data));
  } catch (err) {
    console.error("Failed to read reasoning.json", err);
    return NextResponse.json([]);
  }
}
