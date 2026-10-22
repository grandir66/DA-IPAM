// Aggiunta corretta degli apparati a LibreNMS (piano 2026-10-22 LibreNMS, task 1; spec §3.A): mai `force_add`, versione
// dalla credenziale vera (v1, v2c, v3 con livello e algoritmi), rifiuto di LibreNMS scritto col motivo e senza riga di
// mappa nuova. LibreNMS finto: uno stub di `fetch` che risponde come l'API v0 (rifiuto = HTTP 500 col messaggio).
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/librenms-aggiunta.test.ts
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import type { SceltaSnmpApparato } from "@/lib/credentials/resolve";
import { setIntegrationConfig } from "../config";
import { LibreNMSApiError, LibreNMSClient } from "../librenms-api";
import { addSingleHostToLibreNMS, campiSnmpDaScelta, esitoDaErroreLibreNms } from "../librenms-sync";

const T = "TESTLIBRENMSAGGIUNTA";
const fetchVero = globalThis.fetch;
after(() => {
  globalThis.fetch = fetchVero;
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

// ── Traduzione della credenziale (pura) ─────────────────────────────────────

const community = (c: string, port = 161): SceltaSnmpApparato => ({ ok: true, cred: { forma: "community", community: c }, port, fonte: "device_binding", credential_id: 1 });
const v3 = (r: { securityLevel: string; authProtocol?: string | null; authKey?: string | null; privProtocol?: string | null; privKey?: string | null }): SceltaSnmpApparato => ({
  ok: true,
  cred: { forma: "v3", record: { username: "monitor", authProtocol: null, authKey: null, privProtocol: null, privKey: null, ...r } },
  port: 1161,
  fonte: "device_binding",
  credential_id: 2,
});

test("community: v1 se l'apparato è snmp_version '1' (airFiber), altrimenti v2c", () => {
  assert.deepEqual(campiSnmpDaScelta(community("c-uno"), "1"), { snmpver: "v1", community: "c-uno", port: 161, snmp_disable: false });
  assert.deepEqual(campiSnmpDaScelta(community("c-due"), "2c"), { snmpver: "v2c", community: "c-due", port: 161, snmp_disable: false });
  assert.deepEqual(campiSnmpDaScelta(community("c-tre", 1161), null), { snmpver: "v2c", community: "c-tre", port: 1161, snmp_disable: false });
});

test("v3: i tre livelli, con gli algoritmi nei valori di LibreNMS", () => {
  assert.deepEqual(campiSnmpDaScelta(v3({ securityLevel: "noAuthNoPriv" }), null), {
    snmpver: "v3", authlevel: "noAuthNoPriv", authname: "monitor", port: 1161, snmp_disable: false,
  });
  assert.deepEqual(campiSnmpDaScelta(v3({ securityLevel: "authNoPriv", authProtocol: "SHA256", authKey: "chiave-a" }), null), {
    snmpver: "v3", authlevel: "authNoPriv", authname: "monitor", authalgo: "SHA-256", authpass: "chiave-a", port: 1161, snmp_disable: false,
  });
  assert.deepEqual(
    campiSnmpDaScelta(v3({ securityLevel: "authPriv", authProtocol: "SHA", authKey: "chiave-a", privProtocol: "AES256", privKey: "chiave-p" }), null),
    {
      snmpver: "v3", authlevel: "authPriv", authname: "monitor", authalgo: "SHA", authpass: "chiave-a",
      cryptoalgo: "AES-256", cryptopass: "chiave-p", port: 1161, snmp_disable: false,
    },
  );
  for (const [da, a] of [["MD5", "MD5"], ["SHA224", "SHA-224"], ["SHA384", "SHA-384"], ["SHA512", "SHA-512"]]) {
    const c = campiSnmpDaScelta(v3({ securityLevel: "authNoPriv", authProtocol: da, authKey: "k" }), null);
    assert.equal("authalgo" in c ? c.authalgo : null, a, da);
  }
  for (const [da, a] of [["DES", "DES"], ["AES", "AES"], ["AES192", "AES-192"]]) {
    const c = campiSnmpDaScelta(v3({ securityLevel: "authPriv", authProtocol: "SHA", authKey: "k", privProtocol: da, privKey: "p" }), null);
    assert.equal("cryptoalgo" in c ? c.cryptoalgo : null, a, da);
  }
});

test("algoritmo che LibreNMS non accetta, livello sconosciuto, chiave mancante: niente invio, motivo scritto", () => {
  const cisco = campiSnmpDaScelta(v3({ securityLevel: "authPriv", authProtocol: "SHA", authKey: "k", privProtocol: "AES256C", privKey: "p" }), null);
  assert.equal(cisco.snmp_disable, true);
  assert.match("motivo" in cisco ? cisco.motivo : "", /AES256C.*non accettato da LibreNMS/);
  const auth = campiSnmpDaScelta(v3({ securityLevel: "authNoPriv", authProtocol: "SHA3", authKey: "k" }), null);
  assert.match("motivo" in auth ? auth.motivo : "", /SHA3.*non accettato/);
  const livello = campiSnmpDaScelta(v3({ securityLevel: "tutto" }), null);
  assert.match("motivo" in livello ? livello.motivo : "", /livello/);
  const senzaChiave = campiSnmpDaScelta(v3({ securityLevel: "authPriv", authProtocol: "SHA", authKey: "k", privProtocol: "AES", privKey: null }), null);
  assert.match("motivo" in senzaChiave ? senzaChiave.motivo : "", /cifratura.*assente/);
});

test("scelta non riuscita o «public» di ripiego: ping-only col motivo", () => {
  assert.deepEqual(campiSnmpDaScelta({ ok: false, motivo: "nessuna voce" }, "2c"), { snmp_disable: true, motivo: "nessuna voce" });
  const ripiego: SceltaSnmpApparato = { ok: true, cred: { forma: "community", community: "public" }, port: 161, fonte: "snmp_ripiego", credential_id: null };
  assert.equal(campiSnmpDaScelta(ripiego, "2c").snmp_disable, true);
});

// ── Client: force_add sempre false ──────────────────────────────────────────

type Chiamata = { metodo: string; percorso: string; corpo: Record<string, unknown> | null };
const chiamate: Chiamata[] = [];
let rispostaPost: () => Response = () => new Response("{}", { status: 500 });

function stub(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const percorso = url.pathname.replace(/^\/api\/v0/, "") + url.search;
    const metodo = init?.method ?? "GET";
    let corpo: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") corpo = JSON.parse(init.body) as Record<string, unknown>;
    chiamate.push({ metodo, percorso, corpo });
    if (metodo === "POST" && percorso === "/devices") return rispostaPost();
    if (metodo === "GET" && percorso.startsWith("/devices?limit=1")) return Response.json({ status: "ok", devices: [] });
    if (metodo === "GET" && percorso.startsWith("/devices/")) return Response.json({ status: "error", message: "Device does not exist" }, { status: 404 });
    return Response.json({ status: "error", message: "rotta non prevista dallo stub" }, { status: 599 });
  }) as typeof fetch;
}

beforeEach(() => {
  chiamate.length = 0;
  globalThis.fetch = stub();
});

test("addDevice manda force_add: false anche se chi chiama prova a forzarlo", async () => {
  rispostaPost = () => Response.json({ status: "ok", id: [42] });
  const c = new LibreNMSClient("http://192.0.2.200:8090", "token-finto");
  const id = await c.addDevice({ hostname: "192.0.2.10", snmp_disable: true, ...({ force_add: true } as object) });
  assert.equal(id, 42);
  const post = chiamate.find((x) => x.metodo === "POST");
  assert.equal(post?.corpo?.force_add, false);
});

test("rifiuto di LibreNMS (HTTP 500 «Could not connect … snmp»): LibreNMSApiError con status e messaggio → snmp_non_risponde", async () => {
  rispostaPost = () => Response.json({ status: "error", message: "Could not connect to 192.0.2.10, please check the snmp details and snmp reachability" }, { status: 500 });
  const c = new LibreNMSClient("http://192.0.2.200:8090", "token-finto");
  const err = await c.addDevice({ hostname: "192.0.2.10", snmpver: "v2c", community: "c" }).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof LibreNMSApiError);
  assert.equal(err.status, 500);
  assert.equal(esitoDaErroreLibreNms(err).codice, "snmp_non_risponde");
  assert.equal(esitoDaErroreLibreNms(new LibreNMSApiError("x", 500, "Already have device 192.0.2.10")).codice, "gia_presente");
  assert.equal(esitoDaErroreLibreNms(new LibreNMSApiError("x", 500, "Could not ping 192.0.2.10")).codice, "rifiutato");
  assert.equal(esitoDaErroreLibreNms(new Error("fetch failed")).codice, "rete");
});

test("token scaduto: probe dice auth (prima cercava «HTTP 401» in un testo che non lo conteneva)", async () => {
  globalThis.fetch = (async () => Response.json({ message: "Unauthenticated." }, { status: 401 })) as typeof fetch;
  const p = await new LibreNMSClient("http://192.0.2.200:8090", "token-finto").probe();
  assert.deepEqual(p, { ok: false, reason: "auth", message: "Token API non valido o scaduto" });
});

// ── Host: rifiuto scritto, nessuna riga di mappa; poi aggiunta riuscita ──────

function preparaHost(): number {
  const d = getTenantDb(T);
  d.prepare("INSERT OR IGNORE INTO networks (id, cidr, name, snmp_community) VALUES (1, '192.0.2.0/24', 'rete-a', 'comm-rete')").run();
  const snmp = JSON.stringify({ community: "comm-host", port: 161 });
  const r = d.prepare("INSERT INTO hosts (network_id, ip, status, snmp_data) VALUES (1, ?, 'online', ?)").run("192.0.2.10", snmp);
  return Number(r.lastInsertRowid);
}

test("host: 500 di LibreNMS → esito snmp_non_risponde, rifiuto in librenms_rifiuto, nessuna riga di mappa", async () => {
  setIntegrationConfig("librenms", { mode: "external", url: "http://192.0.2.200:8090", apiToken: "token-finto" });
  rispostaPost = () => Response.json({ status: "error", message: "Could not connect to 192.0.2.10, please check the snmp details and snmp reachability" }, { status: 500 });
  const id = withTenant(T, () => preparaHost());
  const esito = await withTenant(T, () => addSingleHostToLibreNMS(id));
  assert.deepEqual(esito, { ok: false, codice: "snmp_non_risponde", messaggio: "Could not connect to 192.0.2.10, please check the snmp details and snmp reachability" });
  const post = chiamate.find((x) => x.metodo === "POST");
  assert.equal(post?.corpo?.force_add, false);
  assert.equal(post?.corpo?.snmpver, "v2c");
  assert.equal(post?.corpo?.community, "comm-host");
  assert.equal("motivo" in (post?.corpo ?? {}), false);
  const d = getTenantDb(T);
  assert.deepEqual(d.prepare("SELECT COUNT(*) AS n FROM librenms_host_map").get(), { n: 0 }, "nessuna riga di mappa per un rifiuto");
  const r = d.prepare("SELECT host_id, codice, motivo FROM librenms_rifiuto").all();
  assert.deepEqual(r, [{ host_id: id, codice: "snmp_non_risponde", motivo: "Could not connect to 192.0.2.10, please check the snmp details and snmp reachability" }]);

  // Il giro dopo LibreNMS accetta: mappa scritta, rifiuto tolto.
  rispostaPost = () => Response.json({ status: "ok", id: [77] });
  const ok = await withTenant(T, () => addSingleHostToLibreNMS(id));
  assert.deepEqual(ok, { ok: true, librenms_device_id: 77, aggiunto: true });
  assert.deepEqual(d.prepare("SELECT librenms_device_id FROM librenms_host_map").all(), [{ librenms_device_id: 77 }]);
  assert.deepEqual(d.prepare("SELECT COUNT(*) AS n FROM librenms_rifiuto").get(), { n: 0 });
});

test("host senza SNMP: niente aggiunta «solo ping», nessuna chiamata a LibreNMS, rifiuto senza_snmp col motivo", async () => {
  // 22/10 sull'hub: col «solo ping» LibreNMS accettava qualunque oggetto che risponde al ping (client, nodi Proxmox), sia dal
  // pulsante sia dal giro automatico. Regola di Riccardo: in LibreNMS entra solo chi ha l'SNMP.
  setIntegrationConfig("librenms", { mode: "external", url: "http://192.0.2.200:8090", apiToken: "token-finto" });
  rispostaPost = () => Response.json({ status: "ok", id: [91] });
  const id = withTenant(T, () => {
    const r = getTenantDb(T).prepare("INSERT INTO hosts (network_id, ip, status) VALUES (1, '192.0.2.99', 'online')").run();
    return Number(r.lastInsertRowid);
  });
  const esito = await withTenant(T, () => addSingleHostToLibreNMS(id));
  assert.equal(esito.ok, false);
  assert.equal(!esito.ok && esito.codice, "senza_snmp");
  assert.equal(chiamate.some((x) => x.metodo === "POST"), false, "nessuna aggiunta mandata a LibreNMS");
  const r = getTenantDb(T).prepare("SELECT codice FROM librenms_rifiuto WHERE ip = '192.0.2.99'").get();
  assert.deepEqual(r, { codice: "senza_snmp" });
});
