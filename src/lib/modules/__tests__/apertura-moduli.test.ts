/**
 * Passo 4b (16/10/2026): da dove vengono gli URL che il browser apre, e la
 * verifica di apertura nel modulo comune di salute.
 *
 * - Un modulo spento resta intoccato: nessuna chiamata, nemmeno con un URL salvato.
 * - Edge: URL dal nodo che serve la 6443, non dall'host di base_url (in full è
 *   l'IP dell'edge, dove la 6443 non c'è).
 * - Wazuh e Graylog: la Launchpad e il viewer leggono la stessa fonte; Graylog
 *   ripiega sulla 9443 di nginx, non sulla 9000.
 * - MeshCentral: riquadro bloccato → le origini da ammettere, non «certificato».
 *
 * Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { setFeatureDisabled, setFeatureEnabled } from "@/lib/patch/feature";
import { createCredential, deleteCredential, listCredentials } from "@/lib/credentials-vault";
import {
  resolveEdgeBrowserUrl,
  resolveIntegrationBrowserUrl,
  resolveWazuhBrowserUrl,
} from "@/lib/integrations/public-url-server";
import { verificaAperturaModulo } from "../health";
import { resolveModules } from "../registry";
import { conOriginiDaAmmettere } from "../apertura-bersagli";
import { verificaApertura } from "../apertura-browser";
import { autoritaFinta, certificatoFinto } from "./certificati-finti";

const T = "TESTAPERTURA";
const LAN = "192.0.2.10";
const EDGE_GUEST = "192.0.2.20";

const ENV = [
  "LIBRENMS_PUBLIC_HOST",
  "DA_INVENT_PUBLIC_HOST",
  "APPLIANCE_PUBLIC_HOST",
  "APPLIANCE_LAN_IP",
  "APPLIANCE_HOST",
  "LIBRENMS_UI_URL",
  "GRAYLOG_UI_URL",
  "NET_SERVICES_API_URL",
  "NET_SERVICES_API_TOKEN",
];

const servers: Server[] = [];

function svuotaVault(): void {
  for (const c of listCredentials()) deleteCredential(c.id);
}

function spegniTutto(): void {
  for (const k of ["integration_librenms_url", "integration_librenms_ui_url", "integration_graylog_url", "integration_graylog_ui_url", "integration_wazuh_url"]) {
    setSetting(k, "");
  }
  setSetting("integration_librenms_mode", "disabled");
  setSetting("integration_graylog_mode", "disabled");
  setSetting("integration_wazuh_enabled", "0");
  for (const f of ["patch_management", "inventory_agent", "meshcentral", "network_services"]) setFeatureDisabled(T, f);
}

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  deleteTenantDatabase(T);
  spegniTutto();
  svuotaVault();
});

after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

async function serverContato(): Promise<{ url: string; colpi: () => number }> {
  let colpi = 0;
  const srv = createServer(certificatoFinto({ cn: "x", nomi: ["127.0.0.1"] }), (_req, res) => {
    colpi++;
    res.end("ok");
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { url: `https://127.0.0.1:${(srv.address() as AddressInfo).port}`, colpi: () => colpi };
}

// ── Spento = intoccato ───────────────────────────────────────────────────────

test("moduli spenti: la verifica di apertura non chiama niente, nemmeno un URL rimasto salvato", async () => {
  const s = await serverContato();
  setSetting("integration_librenms_url", s.url);
  setSetting("integration_librenms_ui_url", s.url);
  setSetting("integration_graylog_url", s.url);
  getTenantDb(T).prepare("INSERT INTO mc_config (id, server_url, mesh_id) VALUES (1, ?, 'mesh//x')").run(s.url);
  for (const key of ["edge", "librenms", "graylog", "wazuh", "meshcentral", "unifi", "network_services"] as const) {
    const a = await verificaAperturaModulo(T, key, "https://appliance.local");
    assert.equal(a.stato, "spento", key);
    assert.equal(a.verdettoApi, "off", key);
    assert.deepEqual(a.verifiche, [], key);
  }
  assert.equal(s.colpi(), 0, "nessuna richiesta al server di un modulo spento");
});

test("modulo acceso senza interfaccia propria: nessuna verifica di apertura", async () => {
  setFeatureEnabled(T, "patch_management", null);
  const a = await verificaAperturaModulo(T, "patch_management", "https://appliance.local");
  assert.equal(a.stato, "senza_interfaccia");
  assert.equal(a.verdettoApi, "unverified");
});

test("URL interno: «nessun indirizzo», senza chiamarlo", async () => {
  const s = await serverContato();
  setSetting("integration_graylog_mode", "external");
  setSetting("integration_graylog_url", s.url); // 127.0.0.1: interno, il browser non lo raggiunge
  const a = await verificaAperturaModulo(T, "graylog", "https://appliance.local");
  assert.equal(a.stato, "verificato");
  assert.equal(a.verifiche[0]?.esito, "senza_url");
  assert.equal(a.verifiche[0]?.certificato, undefined, "nessuna connessione per l'apertura");
  // (La sonda dell'API rifiuta il certificato autofirmato prima di mandare la richiesta.)
  assert.equal(s.colpi(), 0);
});

// ── Edge: il nodo che serve la 6443 ──────────────────────────────────────────

test("edge in full: l'URL non è l'IP dell'edge di base_url ma il nodo DA-IPAM sulla 6443", () => {
  process.env.APPLIANCE_LAN_IP = LAN;
  assert.equal(resolveEdgeBrowserUrl(`http://${EDGE_GUEST}:8080`), `https://${LAN}:6443`);
  assert.equal(resolveEdgeBrowserUrl("http://127.0.0.1:8080"), `https://${LAN}:6443`, "consolidated");
});

test("edge: la voce del vault scritta dall'installatore vince", () => {
  process.env.APPLIANCE_LAN_IP = LAN;
  createCredential({ kind: "edge", label: "Scanner Edge", url: "https://ipam.example:6443/" });
  assert.equal(resolveEdgeBrowserUrl(`http://${EDGE_GUEST}:8080`), "https://ipam.example:6443");
});

test("edge fuori dall'appliance (niente vault, niente host pubblico): ripiego storico su base_url", () => {
  assert.equal(resolveEdgeBrowserUrl("https://edge.example:8443"), "https://edge.example:6443");
  assert.equal(resolveEdgeBrowserUrl("http://127.0.0.1:8080"), null);
});

test("Launchpad: il pulsante dell'edge usa lo stesso URL", async () => {
  process.env.APPLIANCE_LAN_IP = LAN;
  getTenantDb(T)
    .prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('edge', ?, 'x')")
    .run(`http://${EDGE_GUEST}:8080`);
  const edge = (await withTenant(T, () => resolveModules(T, "admin"))).find((m) => m.key === "edge");
  assert.equal(edge?.externalUiUrl, `https://${LAN}:6443`);
});

// ── Wazuh e Graylog: stessa fonte per Launchpad e viewer ─────────────────────

test("Wazuh: l'etichetta dell'installatore («Wazuh SIEM») basta, l'API :55000 no", () => {
  createCredential({ kind: "wazuh", label: "Wazuh Manager API", url: `https://${LAN}:55000` });
  createCredential({ kind: "wazuh", label: "Wazuh SIEM", url: `https://${LAN}:8443/` });
  assert.equal(resolveWazuhBrowserUrl(), `https://${LAN}:8443`);
});

test("Wazuh senza voce nel vault: nginx :8443 dell'appliance, o niente", () => {
  assert.equal(resolveWazuhBrowserUrl(), "");
  process.env.APPLIANCE_LAN_IP = LAN;
  assert.equal(resolveWazuhBrowserUrl(), `https://${LAN}:8443`);
});

test("Graylog: senza URL per il browser si ripiega sulla 9443 di nginx, non sulla 9000", () => {
  process.env.APPLIANCE_LAN_IP = LAN;
  setSetting("integration_graylog_mode", "external");
  setSetting("integration_graylog_url", "http://graylog:9000");
  assert.equal(resolveIntegrationBrowserUrl("graylog"), `https://${LAN}:9443`);
});

test("Launchpad e viewer leggono la stessa fonte per Wazuh e Graylog", async () => {
  process.env.APPLIANCE_LAN_IP = LAN;
  createCredential({ kind: "wazuh", label: "Wazuh SIEM", url: `https://${LAN}:8443/` });
  createCredential({ kind: "graylog", label: "Graylog", url: `https://${LAN}:9443/` });
  setSetting("integration_wazuh_enabled", "1");
  setSetting("integration_graylog_mode", "external");
  setSetting("integration_graylog_url", "http://graylog:9000");
  const moduli = await withTenant(T, () => resolveModules(T, "admin"));
  assert.equal(moduli.find((m) => m.key === "wazuh")?.uiUrl, resolveWazuhBrowserUrl());
  assert.equal(moduli.find((m) => m.key === "graylog")?.uiUrl, resolveIntegrationBrowserUrl("graylog"));
  assert.equal(resolveIntegrationBrowserUrl("graylog"), `https://${LAN}:9443`);

  const viewer = readFileSync(join(process.cwd(), "src/app/api/integrations/active/route.ts"), "utf8");
  assert.match(viewer, /resolveWazuhBrowserUrl\(\)/, "il viewer usa la stessa funzione della Launchpad");
  assert.doesNotMatch(viewer, /\/dashboard\/i\.test/, "niente più ricerca della sola etichetta «dashboard»");
});

// ── MeshCentral: riquadro bloccato ≠ certificato ─────────────────────────────

test("MeshCentral: riquadro bloccato da frame-ancestors → origini da ammettere, non «certificato»", async () => {
  const ca = autoritaFinta();
  const srv = createServer(certificatoFinto({ cn: "mesh", nomi: ["127.0.0.1"], firmatoDa: ca }), (_req, res) => {
    // Come la config dell'installatore: una sola origine, quella per IP.
    res.setHeader("Content-Security-Policy", `frame-ancestors 'self' https://${LAN}`);
    res.setHeader("Content-Type", "text/html");
    res.end("<html>MeshCentral</html>");
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const url = `https://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  const v = await verificaApertura({
    etichetta: "MeshCentral", url, modo: "riquadro", loginProprio: true, ca: [ca.cert], origineDaIpam: "https://appliance.local",
  });
  const conOrigini = conOriginiDaAmmettere(v, [LAN, "appliance.local"]);
  assert.equal(conOrigini.esito, "iframe_bloccato");
  assert.deepEqual(conOrigini.originiDaAmmettere, ["https://appliance.local", `https://${LAN}`]);
  assert.match(conOrigini.spiegazione, /Non è il certificato/);
  assert.match(conOrigini.spiegazione, /allowedFramingOrigins/);

  // Aperto per IP, la stessa configurazione funziona: niente origini da aggiungere.
  const perIp = conOriginiDaAmmettere(
    await verificaApertura({ etichetta: "MeshCentral", url, modo: "riquadro", loginProprio: true, ca: [ca.cert], origineDaIpam: `https://${LAN}` }),
    [LAN],
  );
  assert.equal(perIp.esito, "ok");
  assert.equal(perIp.originiDaAmmettere, undefined);
});
