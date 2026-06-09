import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET() {
  try {
    // If Supabase is configured, fetch from it
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from('pythia_activity')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);
        
      if (!error && data) {
        const mappedData = data.map(row => ({
          timestamp: row.timestamp,
          type: row.type,
          message: row.message,
          marketAddress: row.market_address
        }));
        return NextResponse.json(mappedData);
      }
    }

    // Fallback to local file for dev
    const activityPath = path.join(process.cwd(), "..", "scripts", "activity.json");
    if (!fs.existsSync(activityPath)) {
      return NextResponse.json([]);
    }
    const data = fs.readFileSync(activityPath, "utf-8");
    const json = JSON.parse(data);
    // Return latest activities first
    return NextResponse.json(json.reverse().slice(0, 100));
  } catch (err) {
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
