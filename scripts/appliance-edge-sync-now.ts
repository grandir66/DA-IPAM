/**
 * Sync findings edge + popola vault launchpad — eseguire dentro container da-ipam.
 */
import { withTenant } from "../src/lib/db-tenant";
import { runVulnSync } from "../src/lib/vuln/sync-job";
import { syncFromLegacySettings } from "../src/lib/credentials-vault";

async function main() {
  const sync = await withTenant("DEFAULT", () => runVulnSync());
  console.log("[sync]", JSON.stringify(sync));

  const vault = syncFromLegacySettings();
  console.log("[vault]", JSON.stringify(vault));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
