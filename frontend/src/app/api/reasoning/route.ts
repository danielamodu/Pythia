export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET() {
  try {
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from('pythia_activity')
        .select('message')
        .eq('type', 'SYSTEM_REASONING')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data?.message) {
        try {
          return NextResponse.json(JSON.parse(data.message));
        } catch (e) {
          console.error("Failed to parse reasoning message JSON", e);
        }
      }
    }

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
