import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function GET() {
  try {
    const activityPath = path.join(process.cwd(), "..", "scripts", "activity.json");
    if (!fs.existsSync(activityPath)) {
      return NextResponse.json([]);
    }
    const data = fs.readFileSync(activityPath, "utf-8");
    const json = JSON.parse(data);
    // Return latest activities first
    return NextResponse.json(json.reverse());
  } catch (err) {
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
