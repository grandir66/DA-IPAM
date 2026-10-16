// scripts/misura-mac-porta.ts
/**
 * misura-mac-porta.ts — numeri dei MAC per porta (topologia fase 2) su una COPIA
 * del DB di un tenant (piano 2026-10-13-topologia-fase2-mappa, Task 5; i numeri
 * servono al Task 14 prima del push su dev).
 *
 * Gemello di `misura-topologia.ts`: copia della copia in una cartella di lavoro
 * dentro `--cartella`, percorsi controllati prima di partire, console dirottata
 * su un registro (col segreto mascherato). Passi:
 *   1. integrity_check e conteggi della tabella dei MAC per porta sulla copia,
 *      PRIMA di aprirla con l'app;
 *   2. apertura del tenant = pulizia a 30 giorni + migrazione fase 2 (durata e
 *      cose aggiunte);
 *   3. integrity_check dopo, righe per fonte, apparati con righe, MAC distinti,
 *      tempo di `getAllHostsEnriched` (MAX(timestamp) del Task 2) e di
 *      `getTopologyModelInput` sui dati veri;
 *   4. con `--unifi <id> --segreto-stdin`: lettura dei client del controller in
 *      SOLA LETTURA (stat/sta, lista bianca di unifi-api) con le righe scritte
 *      solo sulla copia; l'impronta del certificato è quella della copia e resta
 *      in memoria.
 * Stampa solo conteggi e durate: niente nomi, IP, MAC, indirizzi del controller.
 *
 * Uso:  npx tsx scripts/misura-mac-porta.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]
 *   Il segreto (chiave API o password del controller) arriva come PRIMA RIGA di
 *   stdin, mai in un argomento. Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const USO = "Uso: npx tsx scripts/misura-mac-porta.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]\n";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(USO);
  return 2;
}

async function primaRiga(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

type Righe = { prepare(s: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown } };

/** Conteggi della tabella dei MAC per porta: solo numeri. */
function contaMacPorta(d: Righe): Record<string, unknown> {
  const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  const conFonte = (d.prepare("PRAGMA table_info(mac_port_entries)").all() as Array<{ name: string }>).some((c) => c.name === "source");
  return {
    righe: n("SELECT COUNT(*) AS n FROM mac_port_entries"),
    per_fonte: conFonte
      ? Object.fromEntries((d.prepare("SELECT source, COUNT(*) AS n FROM mac_port_entries GROUP BY source ORDER BY source").all() as Array<{ source: string; n: number }>).map((r) => [r.source, r.n]))
      : "colonna source assente",
    apparati_con_righe: n("SELECT COUNT(DISTINCT device_id) AS n FROM mac_port_entries"),
    mac_distinti: n("SELECT COUNT(DISTINCT mac) AS n FROM mac_port_entries"),
  };
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const unifi = val("--unifi");
  const json = a.includes("--json");
  const conSegreto = a.includes("--segreto-stdin");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella", "--unifi"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) return uso();
  if (unifi !== undefined && (!/^\d+$/.test(unifi) || !conSegreto)) return uso("--unifi vuole l'id del controller e --segreto-stdin.");

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-mac-porta-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  const segreto = conSegreto ? await primaRiga() : "";
  if (conSegreto && !segreto) return uso("Nessun segreto sulla prima riga di stdin.");
  const maschera = (s: string) => (segreto ? s.split(segreto).join("***") : s);

  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  // Il registro cattura anche l'esito della migrazione fase 2: la riga
  // «aggiunto …» porta solo nomi di colonne e tabelle, mai dati.
  let aggiunteFase2: string[] = [];
  let fase2Fallita = false;
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => {
      const riga = maschera(p.map(String).join(" "));
      const m = /topologia fase 2, aggiunto (.+)$/.exec(riga);
      if (m) aggiunteFase2 = m[1].split(", ");
      if (/migrazione topologia fase 2 fallita/.test(riga)) fase2Fallita = true;
      fs.appendFileSync(registro, `[${k}] ${riga}\n`);
    };
  }

  const Database = (await import("better-sqlite3")).default;
  // «Pagina mai usata» è un avviso di spazio non referenziato, non un danno ai dati: si conta a parte.
  const sintesi = (righe: string[]): string => {
    const avvisi = righe.filter((r) => /^Page \d+: never used$/.test(r)).length;
    const gravi = righe.filter((r) => r !== "ok" && r !== "*** in database main ***" && !/^Page \d+: never used$/.test(r)).length;
    if (gravi > 0) return `ROVINATA (${gravi} errori)`;
    return avvisi > 0 ? `ok (${avvisi} pagine mai usate)` : "ok";
  };
  const controllo = (d: Righe): string =>
    sintesi((d.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).flatMap((r) => r.integrity_check.split("\n")));

  const out: Record<string, unknown> = { tenant };
  // 1. Prima dell'app: la copia aperta in sola lettura.
  {
    const d = new Database(dest, { readonly: true });
    try {
      out.integrita_prima = controllo(d);
      const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
      out.prima = {
        ...contaMacPorta(d),
        // La pulizia all'apertura toglie queste; la migrazione riduce poi le restanti a una per chiave.
        oltre_30_giorni: n("SELECT COUNT(*) AS n FROM mac_port_entries WHERE timestamp < datetime('now', '-30 days')"),
        chiavi_entro_30_giorni: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM mac_port_entries
                                     WHERE timestamp >= datetime('now', '-30 days') GROUP BY device_id, mac, port_name)`),
        indice_unico: d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_mac_port_entries_key'").get() ? "c'era già" : "assente",
      };
    } finally {
      d.close();
    }
  }

  // 2. Apertura del tenant = pulizia + migrazioni (fase 1, fase 2).
  const t0 = Date.now();
  // Import dinamico voluto e sicuro qui: l'ambiente (cartella dati, copia del
  // DB) va impostato prima che db-tenant venga caricato, e questo script è un
  // processo solo, fuori dall'app. ADR 0002 riguarda il runtime tsx dell'app,
  // dove una seconda istanza del modulo perde il contesto tenant.
  const tenantDb = await import("../src/lib/db-tenant");
  const db = tenantDb.getTenantDb(tenant);
  out.migrazione_ms = Date.now() - t0;
  out.migrazione_fase2 = fase2Fallita ? "FALLITA (vedi registro)" : aggiunteFase2.length > 0 ? aggiunteFase2 : "niente da aggiungere";
  out.integrita_dopo = controllo(db);
  out.dopo = {
    ...contaMacPorta(db),
    indice_unico: db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_mac_port_entries_key'").get() ? "presente" : "ASSENTE",
  };

  // 3. Le letture che la fase 2 ha toccato, sui dati veri.
  const th = Date.now();
  const hosts = tenantDb.withTenant(tenant, () => tenantDb.getAllHostsEnriched());
  out.host_arricchiti = { righe: hosts.length, ms: Date.now() - th };
  const th2 = Date.now();
  tenantDb.withTenant(tenant, () => tenantDb.getAllHostsEnriched());
  (out.host_arricchiti as Record<string, number>).ms_secondo_giro = Date.now() - th2;
  const tm = Date.now();
  const ingresso = tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(2));
  out.modello_ingresso = { mac_porta: ingresso.macPorts.length, ms: Date.now() - tm };

  // 4. Lettura dei client dal controller, in sola lettura, scritta solo sulla copia.
  if (unifi !== undefined) {
    const { createUnifiClient } = await import("../src/lib/integrations/unifi-api");
    const { syncUnifiClientsForController } = await import("../src/lib/integrations/unifi-clients-sync");
    const row = db.prepare("SELECT kind, url, site, credential_id, cert_pin, enabled FROM network_controllers WHERE id = ?").get(Number(unifi)) as
      | { kind: string; url: string; site: string; credential_id: number | null; cert_pin: string | null; enabled: number }
      | undefined;
    if (!row) return uso(`Controller ${unifi} assente nella copia.`);
    // Dalla 2g (T27) la colonna username della riga è vuota: l'utente viene dalla voce dell'archivio.
    let utente = "";
    if (row.kind !== "udm") {
      const { utenteVoceControllerDb } = await import("../src/lib/controllers/credenziale");
      const u = utenteVoceControllerDb(db, row.credential_id);
      if (!u.ok) return uso(u.motivo);
      utente = u.username;
    }
    // Il segreto cifrato della copia non si decifra qui (altra ENCRYPTION_KEY):
    // si usa quello di stdin. L'impronta parte da quella della copia e resta in memoria.
    let pin = row.cert_pin;
    const store = { get: () => pin, set: (p: string) => { pin = p; }, clear: () => { pin = null; } };
    const cfg = row.kind === "udm"
      ? { url: row.url, kind: "udm" as const, site: row.site, apiToken: segreto }
      : { url: row.url, kind: "self_hosted" as const, site: row.site, username: utente, password: segreto };
    const ts = Date.now();
    const r = await tenantDb.withTenant(tenant, () =>
      syncUnifiClientsForController(Number(unifi), "manual", { triggeredBy: "misura-mac-porta", source: createUnifiClient(cfg, store) }));
    if (r.failure) {
      // Il motivo può citare l'indirizzo: va nel registro (senza segreto), a schermo solo l'esito.
      fs.appendFileSync(registro, `[error] lettura client UniFi: ${maschera(r.failure)}\n`);
    }
    out.lettura_client = {
      esito: r.ok ? "ok" : row.enabled !== 1 ? "non letto: controller spento nella copia" : "fallita (motivo nel registro)",
      client_letti: r.clients,
      righe_scritte: r.saved,
      non_abbinati: r.unmatched,
      ms: Date.now() - ts,
    };
    out.dopo_lettura = contaMacPorta(db);
  }
  out.integrita_finale = controllo(db);
  out.registro = registro;

  process.stdout.write(json ? `${JSON.stringify(out, null, 1)}\n` : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`);
  return !String(out.integrita_finale).startsWith("ROVINATA") && !String(out.integrita_dopo).startsWith("ROVINATA") ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
