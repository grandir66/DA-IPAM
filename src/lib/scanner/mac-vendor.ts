import path from "path";
import fs from "fs";

// Use oui-data directly — the 'oui' package is a CLI tool, not a library
let ouiData: Record<string, string> | null = null;
let customOuiCache: Record<string, string> | null = null;
let customOuiMtime = 0;

function getCustomOui(): Record<string, string> {
  const dataDir = path.join(process.cwd(), "data");
  const customPath = path.join(dataDir, "custom_oui.txt");
  try {
    if (!fs.existsSync(customPath)) return {};
    const stat = fs.statSync(customPath);
    if (stat.mtimeMs === customOuiMtime && customOuiCache) return customOuiCache;
    customOuiMtime = stat.mtimeMs;
    const content = fs.readFileSync(customPath, "utf-8");
    const map: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const spaceIdx = trimmed.search(/\s/);
      if (spaceIdx < 0) continue;
      const prefix = trimmed.slice(0, spaceIdx).replace(/[^0-9a-fA-F]/g, "").toUpperCase().substring(0, 6);
      const vendor = trimmed.slice(spaceIdx).trim();
      if (prefix.length === 6) map[prefix] = vendor;
    }
    customOuiCache = map;
    return map;
  } catch {
    return {};
  }
}

function getOuiData(): Record<string, string> {
  if (ouiData) return ouiData;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ouiData = require("oui-data") as Record<string, string>;
    return ouiData;
  } catch {
    console.warn("oui-data package not available — MAC vendor lookup disabled");
    ouiData = {};
    return ouiData;
  }
}

export async function lookupVendor(mac: string): Promise<string | null> {
  if (!mac) return null;

  try {
    const prefix = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase().substring(0, 6);
    const custom = getCustomOui();
    const customResult = custom[prefix];
    if (customResult) return customResult;

    const data = getOuiData();
    const result = data[prefix];
    if (!result) return null;
    const firstLine = result.split("\n")[0].trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

export function invalidateCustomOuiCache(): void {
  customOuiCache = null;
  customOuiMtime = 0;
}
