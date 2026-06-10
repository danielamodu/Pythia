const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const ws = require("ws");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables not found!");
  process.exit(1);
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    realtime: { transport: ws }
  });
  
  console.log("Querying last 15 activity rows from Supabase...");
  const { data, error } = await supabase
    .from("pythia_activity")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(15);
    
  if (error) {
    console.error("Supabase query error:", error.message);
    return;
  }
  
  if (!data || data.length === 0) {
    console.log("No activity logs found in Supabase.");
    return;
  }
  
  console.log("-".repeat(80));
  data.forEach(x => {
    const timestamp = x.timestamp || "";
    const type = x.type || "";
    const message = x.message || "";
    console.log(`${timestamp} | ${type.padEnd(15)} | ${message.substring(0, 85)}`);
  });
  console.log("-".repeat(80));
}

main().catch(console.error);
