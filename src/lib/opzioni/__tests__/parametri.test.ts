// Parametri di Opzioni (tavola del 22/10, oggetti 14-19). La prova di completezza legge le chiavi dai SORGENTI delle
// schede vecchie e dalle costanti dei moduli: un numero nuovo in una scheda, che non entra in Opzioni né in
// fuori-catalogo.ts col perché, la fa fallire. Il 23/10 il censimento ha trovato tre numeri della scheda Scansione che
// lo scanner non leggeva: la riga dice il valore vero, quello del file.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeHubDb, deleteSetting, getSetting, setSetting } from "@/lib/db-hub";
import { deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { catalogo } from "@/lib/opzioni/catalogo";
import { cambiaOpzione } from "@/lib/opzioni/cambio";
import { FUORI_CATALOGO } from "@/lib/opzioni/fuori-catalogo";
import { chiaveSegno, normalizzaPorte } from "@/lib/opzioni/parametri";
import { CHIAVI_NOTIFICHE, getNotificationConfig } from "@/lib/notifications/config";
import { getQuickScanTcpPorts, NETWORK_DISCOVERY_QUICK_TCP_PORTS, setGetSettingFn } from "@/lib/scanner/ports";

const T = "TESTOPZIONIPAR";
const ADMIN = { ruolo: "admin", chi: "mario", idUtente: "7" };
const nessunaRicarica = () => null;
const CHIAVI = [
  "quick_scan_tcp_ports", "naabu_bin_path", CHIAVI_NOTIFICHE.immediateMinLevel, CHIAVI_NOTIFICHE.immediateCategories,
  CHIAVI_NOTIFICHE.digestIntervalMinutes, CHIAVI_NOTIFICHE.retentionDays,
];
beforeEach(() => {
  for (const k of CHIAVI) deleteSetting(k);
  for (const o of withTenant(T, () => catalogo())) deleteSetting(chiaveSegno(o.id));
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const presenti = (): Set<string> => new Set(withTenant(T, () => catalogo().map((o) => o.id)));
const fuori = new Set(FUORI_CATALOGO.map((f) => f.chiave));
const sorgente = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

/** Ogni chiave censita → la riga del catalogo che la copre, o «fuori». */
const PARAMETRI_CENSITI: Readonly<Record<string, string>> = {
  quick_scan_tcp_ports: "parametro.quick_scan_tcp_ports",
  naabu_bin_path: "parametro.naabu_bin_path",
  quick_scan_concurrency: "parametro.quick_scan_concurrency",
  quick_scan_host_timeout_s: "parametro.quick_scan_host_timeout_s",
  quick_scan_exec_limit_ms: "parametro.quick_scan_exec_limit_ms",
  port_discovery: "automatismo.naabu",
  [CHIAVI_NOTIFICHE.enabled]: "notifiche.attive",
  [CHIAVI_NOTIFICHE.smtpEnabled]: "notifiche.email",
  [CHIAVI_NOTIFICHE.webhookEnabled]: "notifiche.webhook",
  [CHIAVI_NOTIFICHE.immediateMinLevel]: "parametro.notify_immediate_min_level",
  [CHIAVI_NOTIFICHE.immediateCategories]: "parametro.notify_immediate_categories",
  [CHIAVI_NOTIFICHE.digestIntervalMinutes]: "parametro.notify_digest_interval_minutes",
  [CHIAVI_NOTIFICHE.retentionDays]: "parametro.notify_retention_days",
  GIORNI_ASSENZA_ARCHIVIO: "parametro.pulizia_giorni_assenza",
  GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE: "parametro.pulizia_giorni_archivio",
  MDM_MAX_ERRORI_CONSECUTIVI: "parametro.mdm_max_errori",
};

/** Le chiavi come le scrivono le schede e i moduli: dai sorgenti, non da un elenco a mano. */
function chiaviDaiSorgenti(): string[] {
  // Le chiavi della scansione come le leggono lo scanner e la rotta della scheda (non la scheda, che dal 23/10 rimanda qui).
  const daScanner = ["src/lib/scanner/ports.ts", "src/lib/scanner/discovery.ts", "src/app/api/scan-config/route.ts"].flatMap(
    (p) => [...sorgente(p).matchAll(/etSetting(?:Fn\?\.)?\("([a-z][a-z0-9_]+)"/g)].map((m) => m[1]),
  );
  const costanti = (p: string, prefisso: string) =>
    [...sorgente(p).matchAll(new RegExp(`export const (${prefisso}[A-Z_]+)\\s*=\\s*\\d`, "g"))].map((m) => m[1]);
  const chiaviCost = (p: string) => [...sorgente(p).matchAll(/const KEY_[A-Z_]+\s*=\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  return [
    ...daScanner,
    ...Object.values(CHIAVI_NOTIFICHE),
    ...chiaviCost("src/lib/integrations/self-identity.ts"),
    "integration_wazuh_device_rule_ids",
    ...costanti("src/lib/integrations/mdm-config.ts", "MDM_"),
    ...costanti("src/lib/hosts/pulizia.ts", "GIORNI_"),
    ...costanti("src/lib/hosts/pulizia-archivio.ts", "GIORNI_"),
    ...costanti("src/lib/hosts/registro-pulizia.ts", "GIORNI_"),
  ];
}

test("(a) ogni chiave delle schede Scansione, Notifiche, Alert e delle soglie è in Opzioni, o fuori col motivo", () => {
  const ids = presenti();
  const trovate = chiaviDaiSorgenti();
  assert.ok(trovate.length >= 28, `poche chiavi lette dai sorgenti (${trovate.length}): la ricerca si è rotta`);
  for (const k of new Set(trovate)) {
    const id = PARAMETRI_CENSITI[k];
    assert.ok(id ? ids.has(id) : fuori.has(k), `${k}: né in Opzioni né in fuori-catalogo.ts`);
  }
});

test("(b) un numero fuori dai limiti non si salva, e il valore resta quello di prima", async () => {
  const r = await withTenant(T, () => cambiaOpzione("parametro.notify_immediate_min_level", { valore: "17" }, ADMIN, nessunaRicarica));
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /da 1 a 16/);
  assert.equal(getSetting(CHIAVI_NOTIFICHE.immediateMinLevel), null);
  const t = await withTenant(T, () => cambiaOpzione("parametro.notify_retention_days", { valore: "3x" }, ADMIN, nessunaRicarica));
  assert.equal(t.status, 400);
});

test("(c) un cambio scrive la chiave che legge la notifica e il segno di chi; «Torna a …» li toglie", async () => {
  const r = await withTenant(T, () => cambiaOpzione("parametro.notify_digest_interval_minutes", { valore: "120" }, ADMIN, nessunaRicarica));
  assert.equal(r.status, 200);
  assert.equal(getNotificationConfig().policy.digestIntervalMinutes, 120);
  const stato = r.body.stato as { da: string | null; valore: string; esito: { testo: string } };
  assert.deepEqual([stato.da, stato.valore, stato.esito.testo], ["mario", "120", "cambiato da mario"]);

  const d = await withTenant(T, () => cambiaOpzione("parametro.notify_digest_interval_minutes", { diSerie: true }, ADMIN, nessunaRicarica));
  assert.equal(d.status, 200);
  assert.equal(getSetting(CHIAVI_NOTIFICHE.digestIntervalMinutes), null);
  assert.equal(getSetting(chiaveSegno("parametro.notify_digest_interval_minutes")), null);
  assert.equal(getNotificationConfig().policy.digestIntervalMinutes, 60);
});

test("(c) le porte si normalizzano e le legge lo scanner; una porta sbagliata non passa", async () => {
  setGetSettingFn(getSetting);
  const r = await withTenant(T, () => cambiaOpzione("parametro.quick_scan_tcp_ports", { valore: "22\n80, 8000-8100 22" }, ADMIN, nessunaRicarica));
  assert.equal(r.status, 200);
  assert.equal(getQuickScanTcpPorts(), "22,80,8000-8100");
  assert.throws(() => normalizzaPorte("70000"), /non è una porta/);
  assert.throws(() => normalizzaPorte("90-80"), /non è una porta/);
  await withTenant(T, () => cambiaOpzione("parametro.quick_scan_tcp_ports", { diSerie: true }, ADMIN, nessunaRicarica));
  assert.equal(getQuickScanTcpPorts(), NETWORK_DISCOVERY_QUICK_TCP_PORTS);
});

test("(c) categorie: solo quelle del catalogo, almeno una", async () => {
  const no = await withTenant(T, () => cambiaOpzione("parametro.notify_immediate_categories", { valore: "" }, ADMIN, nessunaRicarica));
  assert.equal(no.status, 400);
  const ignota = await withTenant(T, () => cambiaOpzione("parametro.notify_immediate_categories", { valore: "ransomware,boh" }, ADMIN, nessunaRicarica));
  assert.equal(ignota.status, 400);
  const si = await withTenant(T, () => cambiaOpzione("parametro.notify_immediate_categories", { valore: "ransomware" }, ADMIN, nessunaRicarica));
  assert.equal(si.status, 200);
  assert.deepEqual(getNotificationConfig().policy.immediateCategories, ["ransomware"]);
});

test("(d) un valore scritto dalla scheda di prima si vede come cambiato, senza nome", () => {
  setSetting(CHIAVI_NOTIFICHE.retentionDays, "45");
  const o = withTenant(T, () => catalogo().find((x) => x.id === "parametro.notify_retention_days"));
  const s = o?.leggi() as { valore: string; da: string | null; esito: { testo: string } };
  assert.deepEqual([s.valore, s.da, s.esito.testo], ["45", null, "cambiato dalla scheda di prima"]);
});

test("(e) i fissi non si cambiano (405 col posto) e dicono il valore che vale davvero", async () => {
  const prima = process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY;
  try {
    process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY = "7";
    // La vecchia scheda scriveva questa chiave: lo scanner non la legge, la riga non deve crederci.
    setSetting("quick_scan_concurrency", "3");
    const o = withTenant(T, () => catalogo().find((x) => x.id === "parametro.quick_scan_concurrency"));
    const s = o?.leggi() as { valore: string; esito: { testo: string } };
    assert.deepEqual([o?.forma, s.valore, s.esito.testo], ["fisso", "7", "dal file (DA_INVENT_NMAP_DISCOVERY_CONCURRENCY)"]);
    const r = await withTenant(T, () => cambiaOpzione("parametro.pulizia_giorni_assenza", { valore: "30" }, ADMIN, nessunaRicarica));
    assert.equal(r.status, 405);
    assert.match(String(r.body.error), /^Da qui non si cambia\. Fisso nel codice/);
  } finally {
    if (prima === undefined) delete process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY;
    else process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY = prima;
    deleteSetting("quick_scan_concurrency");
  }
});

test("(f) chi non è admin non cambia un parametro", async () => {
  const r = await withTenant(T, () => cambiaOpzione("parametro.notify_retention_days", { valore: "40" }, { ...ADMIN, ruolo: "viewer" }, nessunaRicarica));
  assert.equal(r.status, 403);
  assert.equal(getSetting(CHIAVI_NOTIFICHE.retentionDays), null);
});
