/**
 * Bootstrap integrazioni appliance — eseguito dentro container da-ipam.
 * Env: EDGE_TOKEN, LIBRENMS_TOKEN, NET_URL, NET_TOKEN
 */
import { getTenantDb } from "../src/lib/db-tenant";
import { deriveDefaultIntegrationUiUrl } from "../src/lib/integrations/public-url";
import { encrypt } from "../src/lib/crypto";
import { setIntegrationConfig } from "../src/lib/integrations/config";
import { installNetServices } from "../src/lib/network-services/feature";

const edgeToken = process.env.EDGE_TOKEN?.trim();
const librenmsToken = process.env.LIBRENMS_TOKEN?.trim();
const librenmsAdminPassword = process.env.LIBRENMS_ADMIN_PASSWORD?.trim();
const netUrl = process.env.NET_URL?.trim();
const netToken = process.env.NET_TOKEN?.trim();

if (!edgeToken || !librenmsToken) {
  console.error("EDGE_TOKEN e LIBRENMS_TOKEN obbligatori");
  process.exit(1);
}

// URL API/UI edge: porta 6443 (nginx TLS) se host LAN, altrimenti loopback 8080.
const applianceHost = process.env.APPLIANCE_HOST?.trim() || "127.0.0.1";
const librenmsUi =
  deriveDefaultIntegrationUiUrl("librenms") ??
  (applianceHost !== "127.0.0.1" ? `https://${applianceHost}:7443` : null);

setIntegrationConfig("librenms", {
  mode: "external",
  url: "http://127.0.0.1:8000",
  apiToken: librenmsToken,
  containerName: "appliance-librenms",
  ...(librenmsUi ? { uiUrl: librenmsUi } : {}),
  ...(librenmsAdminPassword ? { adminPassword: librenmsAdminPassword } : {}),
});
console.log("[bootstrap] librenms → API http://127.0.0.1:8000", librenmsUi ? `UI ${librenmsUi}` : "");

const tenantCode = "DEFAULT";
const db = getTenantDb(tenantCode);
const baseUrl =
  applianceHost === "127.0.0.1"
    ? "http://127.0.0.1:8080"
    : `https://${applianceHost}:6443`;
const enc = encrypt(edgeToken);
const existing = db.prepare("SELECT id FROM vuln_scanners LIMIT 1").get() as { id: number } | undefined;
if (existing) {
  db.prepare(
    `UPDATE vuln_scanners SET name=?, base_url=?, token_encrypted=?, enabled=1, last_error=NULL, consecutive_errors=0, auto_disabled_at=NULL WHERE id=?`,
  ).run("Scanner-Edge PX-NAS", baseUrl, enc, existing.id);
  console.log("[bootstrap] vuln_scanners aggiornato id=", existing.id);
} else {
  db.prepare(
    `INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES (?, ?, ?, 1)`,
  ).run("Scanner-Edge PX-NAS", baseUrl, enc);
  console.log("[bootstrap] vuln_scanners creato");
}

// Cron vuln_sync: il bootstrap appliance registra lo scanner ma senza questo
// job i findings restano solo sull'edge (stesso pattern di POST /api/integrations/scanner-edge).
const vulnJob = db
  .prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'vuln_sync' AND network_id IS NULL")
  .get() as { id: number } | undefined;
if (!vulnJob) {
  db.prepare(
    `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config)
     VALUES (NULL, 'vuln_sync', 30, 1, '{}')`,
  ).run();
  console.log("[bootstrap] scheduled_jobs vuln_sync creato (30 min)");
}

if (netUrl && netToken) {
  installNetServices(tenantCode, null, { apiUrl: netUrl, apiToken: netToken });
  console.log("[bootstrap] network_services →", netUrl);
}

console.log("[bootstrap] completato");
