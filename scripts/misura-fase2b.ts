// scripts/misura-fase2b.ts
/**
 * misura-fase2b.ts — numeri della topologia fase 2b su una COPIA del DB di un
 * tenant (piano 2026-10-14-topologia-fase2b, Task 5; i numeri servono alla
 * conferma di Riccardo prima del rilascio, Task 13).
 *
 * Gemello di `misura-mac-porta.ts`: copia della copia in una cartella di lavoro
 * dentro `--cartella`, percorsi controllati prima di partire, console dirottata
 * su un registro (col segreto mascherato). Passi:
 *   1. sulla copia, PRIMA dell'app: integrity_check, cosa della fase 2b c'è già,
 *      fotografia dei job e delle correzioni dei collegamenti;
 *   2. le due migrazioni nuove (v9 dei job, fase 2b) con la loro durata, se il DB
 *      è già alla v0.3.279 (v8 e fase 2 fatte); poi l'apertura vera del tenant
 *      con getTenantDb, che non deve aggiungere più niente (idempotenza);
 *   3. integrity_check dopo; job identici colonna per colonna; correzioni dei
 *      collegamenti identiche con `medium` NULL; nessun job hypervisor_sync;
 *   4. conteggi della fase 2b: VM, schede vive con MAC, schede viste su uno
 *      switch o AP, collegamenti proposti (stima: coppie switch/porta), VM
 *      riconosciute fra host e apparati (per MAC e per nome);
 *   5. con `--hypervisor <id> --segreto-stdin`: una scansione Proxmox in SOLA
 *      LETTURA del server del cliente (API, pvesh, schede vive) scritta SOLO sulla
 *      copia, poi di nuovo i conteggi del passo 4.
 * Stampa solo conteggi e durate: niente nomi, IP, MAC, indirizzi dei server.
 *
 * Uso:  npx tsx scripts/misura-fase2b.ts <copia.db> --cartella <scratchpad>
 *         [--hypervisor <id> --segreto-stdin [--utente <utente ssh/api>]] [--json]
 *   Il segreto (password dell'utente, di default root) arriva come PRIMA RIGA di
 *   stdin, mai in un argomento. Uscita: 0 fatto, 1 integrità rovinata o dati
 *   cambiati, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const USO =
  "Uso: npx tsx scripts/misura-fase2b.ts <copia.db> --cartella <scratchpad> [--hypervisor <id> --segreto-stdin [--utente <nome>]] [--json]\n";

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

const hash = (v: unknown): string => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function colonne(d: Righe, tabella: string): string[] {
  return (d.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** Cosa della fase 2b c'è nel DB. */
function stato2b(d: Righe): Record<string, unknown> {
  const jobs = (d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined)?.sql ?? "";
  return {
    medium: colonne(d, "topology_link_overrides").includes("medium"),
    uplink_type: colonne(d, "network_devices").includes("uplink_type"),
    topology_link_primary: !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='topology_link_primary'").get(),
    check_hypervisor_sync: jobs.includes("'hypervisor_sync'"),
  };
}

/** Fotografia dei job e delle correzioni: solo impronte e conteggi, per dire «identici». */
function fotografia(d: Righe): { jobs: unknown[]; overrides: Array<Record<string, unknown>> } {
  return {
    jobs: d.prepare("SELECT id, network_id, job_type, interval_minutes, last_run, next_run, enabled, config, created_at, updated_at FROM scheduled_jobs ORDER BY id").all(),
    overrides: d.prepare("SELECT * FROM topology_link_overrides ORDER BY id").all() as Array<Record<string, unknown>>,
  };
}

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
const macNorm = (x: unknown): string | null => {
  if (typeof x !== "string") return null;
  const hex = x.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12 || hex === "000000000000") return null;
  const m = hex.match(/.{2}/g)?.join(":") ?? "";
  return MAC.test(m) ? m : null;
};
const nomeChiave = (x: unknown): string | null => {
  if (typeof x !== "string") return null;
  const n = x.trim().toLowerCase().split(".")[0];
  return n.length >= 4 ? n : null;
};

interface Iface { name?: unknown; type?: unknown; mac_address?: unknown; master?: unknown }
interface Scan {
  hosts?: Array<{ network_interfaces?: Iface[]; live_read_at?: unknown }>;
  vms?: Array<{ node?: unknown; vmid?: unknown; type?: unknown; name?: unknown; status?: unknown; networks_details?: Array<{ mac?: unknown }> }>;
}

/** I conteggi della fase 2b sui dati della copia: solo numeri. */
function conteggi2b(d: Righe): Record<string, unknown> {
  const devs = d.prepare("SELECT id, name, last_proxmox_scan_result AS r FROM network_devices WHERE last_proxmox_scan_result IS NOT NULL").all() as Array<{ id: number; name: string; r: string }>;
  // Più apparati possono puntare allo stesso cluster, anche con scansioni di epoche
  // diverse (nodi rinominati, VM migrate): una VM si conta una volta per (vmid, tipo, nome).
  const vmViste = new Set<string>();
  let accese = 0;
  let jsonRovinati = 0;
  let hostConSchedeVive = 0;
  const vmMac = new Map<string, string>(); // MAC → chiave VM
  const vmNome = new Map<string, string>(); // nome → chiave VM
  const vive = new Set<string>(); // MAC delle schede vive fisiche (eth/bond)
  let schedeVive = 0;
  let schedeViveConMac = 0;
  for (const dev of devs) {
    let s: Scan;
    try {
      s = JSON.parse(dev.r) as Scan;
    } catch {
      jsonRovinati++;
      continue;
    }
    for (const h of s.hosts ?? []) {
      if (typeof h.live_read_at === "string") hostConSchedeVive++;
      for (const i of h.network_interfaces ?? []) {
        if (!i || !("master" in i)) continue;
        schedeVive++;
        const m = macNorm(i.mac_address);
        if (m) {
          schedeViveConMac++;
          if (i.type === "eth" || i.type === "bond") vive.add(m);
        }
      }
    }
    for (const v of s.vms ?? []) {
      const chiave = `${String(v.vmid)}:${String(v.type)}:${String(v.name)}`;
      if (vmViste.has(chiave)) continue;
      vmViste.add(chiave);
      if (v.status === "running") accese++;
      for (const n of v.networks_details ?? []) {
        const m = macNorm(n.mac);
        if (m) vmMac.set(m, chiave);
      }
      const nk = nomeChiave(v.name);
      if (nk) vmNome.set(nk, chiave);
    }
  }
  // Dove si vedono le schede vive: porte di switch e AP, ultimi 30 giorni.
  const porte = d.prepare(`
    SELECT m.mac, m.device_id, m.port_name FROM mac_port_entries m JOIN network_devices nd ON nd.id = m.device_id
     WHERE nd.device_type IN ('switch', 'access_point') AND m.timestamp >= datetime('now', '-30 days')`).all() as Array<{ mac: string; device_id: number; port_name: string }>;
  const viste = new Set<string>();
  const coppie = new Set<string>();
  let vmSuPorte = 0;
  for (const p of porte) {
    const m = macNorm(p.mac);
    if (!m) continue;
    if (vive.has(m)) {
      viste.add(m);
      coppie.add(`${p.device_id}|${p.port_name}`);
    }
    if (vmMac.has(m)) vmSuPorte++;
  }
  // VM riconosciute fra host e apparati.
  const hosts = d.prepare("SELECT mac, hostname, custom_name FROM hosts").all() as Array<{ mac: string | null; hostname: string | null; custom_name: string | null }>;
  const apparati = d.prepare("SELECT name FROM network_devices").all() as Array<{ name: string }>;
  const perMac = new Set<string>();
  const perNome = new Set<string>();
  for (const h of hosts) {
    const m = macNorm(h.mac);
    if (m && vmMac.has(m)) perMac.add(vmMac.get(m) as string);
    for (const n of [h.hostname, h.custom_name]) {
      const k = nomeChiave(n);
      if (k && vmNome.has(k)) perNome.add(vmNome.get(k) as string);
    }
  }
  for (const a of apparati) {
    const k = nomeChiave(a.name);
    if (k && vmNome.has(k)) perNome.add(vmNome.get(k) as string);
  }
  const riconosciute = new Set([...perMac, ...perNome]);
  return {
    apparati_con_scansione_proxmox: devs.length,
    scansioni_illeggibili: jsonRovinati,
    vm: vmViste.size,
    vm_accese: accese,
    vm_con_mac: new Set(vmMac.values()).size,
    righe_mac_porta_di_vm: vmSuPorte,
    host_con_schede_vive: hostConSchedeVive,
    schede_vive: schedeVive,
    schede_vive_con_mac: schedeViveConMac,
    schede_fisiche_viste_su_switch_o_ap: viste.size,
    collegamenti_proposti_stima: coppie.size,
    vm_riconosciute: { totale: riconosciute.size, per_mac: perMac.size, per_nome: perNome.size },
  };
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const hypervisor = val("--hypervisor");
  const utente = val("--utente") ?? "root";
  const json = a.includes("--json");
  const conSegreto = a.includes("--segreto-stdin");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella", "--hypervisor", "--utente"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) return uso();
  if (hypervisor !== undefined && (!/^\d+$/.test(hypervisor) || !conSegreto)) return uso("--hypervisor vuole l'id dell'apparato e --segreto-stdin.");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(utente)) return uso("--utente non valido.");

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-fase2b-${new Date().toISOString().replace(/[:.]/g, "-")}`);
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
  // Il registro cattura l'esito delle migrazioni: le righe «aggiunto …» portano
  // solo nomi di colonne e tabelle, mai dati.
  const aggiunte: string[] = [];
  const fallite: string[] = [];
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => {
      const riga = maschera(p.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
      if (/topologia fase 2b, aggiunto|'hypervisor_sync' \(v9\)/.test(riga)) aggiunte.push(riga.replace(/^\[db-tenant\] [^:]+: /, ""));
      if (/migrazione (topologia fase 2b|hypervisor_sync) fallita/.test(riga)) fallite.push(riga.replace(/^\[db-tenant\] [^:]+: /, ""));
      fs.appendFileSync(registro, `[${k}] ${riga}\n`);
    };
  }

  const Database = (await import("better-sqlite3")).default;
  const sintesi = (righe: string[]): string => {
    const avvisi = righe.filter((r) => /^Page \d+: never used$/.test(r)).length;
    const gravi = righe.filter((r) => r !== "ok" && r !== "*** in database main ***" && !/^Page \d+: never used$/.test(r)).length;
    if (gravi > 0) return `ROVINATA (${gravi} errori)`;
    return avvisi > 0 ? `ok (${avvisi} pagine mai usate)` : "ok";
  };
  const controllo = (d: Righe): string =>
    sintesi((d.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).flatMap((r) => r.integrity_check.split("\n")));

  const out: Record<string, unknown> = { tenant: "copia", dimensione_mb: Math.round(fs.statSync(dest).size / 1048576) };
  let primaFoto: ReturnType<typeof fotografia> = { jobs: [], overrides: [] };
  let pronto = false;
  // 1. Prima dell'app: la copia aperta in sola lettura.
  {
    const d = new Database(dest, { readonly: true });
    try {
      const t = Date.now();
      out.integrita_prima = controllo(d);
      out.integrita_prima_ms = Date.now() - t;
      out.fase2b_prima = stato2b(d);
      primaFoto = fotografia(d);
      out.job_prima = { righe: primaFoto.jobs.length, impronta: hash(primaFoto.jobs) };
      out.correzioni_collegamenti_prima = primaFoto.overrides.length;
      const jobsSql = (d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'").get() as { sql?: string } | undefined)?.sql ?? "";
      pronto = jobsSql.includes("'unifi_sync'") && !!d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_mac_port_entries_key'").get();
      out.conteggi_prima = conteggi2b(d);
    } finally {
      d.close();
    }
  }

  // Import dinamico voluto e sicuro qui: l'ambiente (cartella dati, copia del
  // DB) va impostato prima che db-tenant venga caricato, e questo script è un
  // processo solo, fuori dall'app (ADR 0002 riguarda il runtime tsx dell'app).
  const tenantDb = await import("../src/lib/db-tenant");

  // 2. Le due migrazioni nuove, misurate da sole su un DB già alla v0.3.279.
  if (pronto) {
    const d = new Database(dest);
    try {
      d.pragma("foreign_keys = ON");
      const t9 = Date.now();
      const v9 = tenantDb.migrateScheduledJobsV9(d);
      out.migrazione_v9 = { ricostruita: v9, ms: Date.now() - t9 };
      const t2b = Date.now();
      const added = tenantDb.migrateTopologyPhase2b(d);
      out.migrazione_2b = { aggiunto: added, ms: Date.now() - t2b };
    } finally {
      d.close();
    }
  } else {
    out.migrazione_v9 = "non misurata da sola: il DB non è alla v0.3.279, la fa l'apertura";
  }
  // Apertura vera: le altre migrazioni e, se servono ancora, le due nuove.
  const t0 = Date.now();
  tenantDb.getTenantDb(tenant);
  out.apertura_ms = Date.now() - t0;
  out.apertura_aggiunge = fallite.length > 0 ? { FALLITE: fallite } : aggiunte.length > 0 ? aggiunte : "niente (idempotente)";
  tenantDb.closeTenantDb(tenant);
  aggiunte.length = 0;
  const t1 = Date.now();
  const db2 = tenantDb.getTenantDb(tenant);
  out.seconda_apertura = { ms: Date.now() - t1, aggiunge: aggiunte.length > 0 ? aggiunte : "niente" };

  // 3. Dopo: integrità, job e correzioni intatti, job spento.
  const ti = Date.now();
  out.integrita_dopo = controllo(db2);
  out.integrita_dopo_ms = Date.now() - ti;
  out.fase2b_dopo = stato2b(db2);
  const dopoFoto = fotografia(db2);
  const jobUguali = hash(dopoFoto.jobs) === hash(primaFoto.jobs);
  out.job_dopo = { righe: dopoFoto.jobs.length, identici_colonna_per_colonna: jobUguali };
  const overrideUguali =
    dopoFoto.overrides.length === primaFoto.overrides.length &&
    dopoFoto.overrides.every((r, i) => r.medium === null && hash({ ...r, medium: undefined }) === hash({ ...primaFoto.overrides[i], medium: undefined }));
  out.correzioni_collegamenti_dopo = { righe: dopoFoto.overrides.length, identiche_con_medium_null: overrideUguali };
  out.job_hypervisor_sync = (db2.prepare("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE job_type = 'hypervisor_sync'").get() as { n: number }).n;
  out.hypervisor_configurati = tenantDb.withTenant(tenant, () => tenantDb.listHypervisorScanDevices().length);

  // 5. Scansione Proxmox in sola lettura, scritta solo sulla copia.
  if (hypervisor !== undefined) {
    const { runProxmoxDeviceScan } = await import("../src/lib/proxmox/run-proxmox-device-scan");
    const ts = Date.now();
    try {
      const r = await tenantDb.withTenant(tenant, () =>
        runProxmoxDeviceScan(Number(hypervisor), { credentials: () => ({ username: utente, password: segreto }) }),
      );
      out.scansione = {
        esito: "ok",
        host: r.hosts.length,
        host_con_schede_vive: r.hosts.filter((h) => h.live_read_at).length,
        vm: r.vms.length,
        avvisi: r.avvisi?.length ?? 0,
        ms: Date.now() - ts,
      };
      if (r.avvisi?.length) fs.appendFileSync(registro, `[warn] avvisi della scansione: ${maschera(r.avvisi.join(" | "))}\n`);
    } catch (e) {
      // Il motivo può citare l'indirizzo: va nel registro (senza segreto), a schermo solo l'esito.
      fs.appendFileSync(registro, `[error] scansione: ${maschera(e instanceof Error ? e.message : String(e))}\n`);
      out.scansione = { esito: "fallita (motivo nel registro), la copia resta com'era", ms: Date.now() - ts };
    }
  }
  out.conteggi_dopo = conteggi2b(db2);
  out.integrita_finale = controllo(db2);
  out.registro = registro;

  process.stdout.write(
    json
      ? `${JSON.stringify(out, null, 1)}\n`
      : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`,
  );
  const integro = !String(out.integrita_finale).startsWith("ROVINATA") && !String(out.integrita_dopo).startsWith("ROVINATA");
  return integro && jobUguali && overrideUguali && fallite.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
