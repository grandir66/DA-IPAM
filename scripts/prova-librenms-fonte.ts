/**
 * Prova a vuoto della lettura di LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 4): su una COPIA del DB di
 * un tenant, accende l'interruttore `librenms` SOLO nella copia, chiama l'API vera di LibreNMS (sola lettura: GET) e scrive
 * le fotografie nella copia. Non aggiunge niente a LibreNMS (`aggiungiCandidati: false`) e non tocca il DB vero.
 *
 * Il token si passa da stdin, mai in argomento (resta fuori da `ps` e dalla storia della shell):
 *   printf '%s' "$TOKEN" | npx tsx scripts/prova-librenms-fonte.ts <dati>/tenants/<codice>.db --cartella <scratchpad> --url http://127.0.0.1:8090
 * La copia deve stare in `<dati>/tenants/<codice>.db` dentro la cartella di lavoro (temporanea, fuori dal repo), come
 * `scripts/prova-scheda-mikrotik.ts`. Stampa solo conteggi, codici e tempi (nessun IP, nome o MAC).
 * Atteso sull'hub (spec §2, 22/10): ~51 apparati, ~1088 porte, ~109 vicini, ~76 VLAN, ~3483 MAC, ~3069 ARP, ~1160 sensori,
 * inventario su ~15 apparati; tempo totale < 10 s.
 *   Uscita: 0 fatto, 1 lettura non riuscita o contesto perso, 2 non partito.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: printf '%s' \"$TOKEN\" | npx tsx scripts/prova-librenms-fonte.ts <copia.db> --cartella <scratchpad> --url <url di LibreNMS>\n");
  return 2;
}

const dentro = (figlio: string, padre: string): boolean => {
  const rel = path.relative(padre, figlio);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

function controlla(cartella: string, copia: string, hub: string): string[] {
  const e: string[] = [];
  const scratch = percorsoReale(cartella);
  const repo = percorsoReale(path.resolve(__dirname, ".."));
  if (!fs.existsSync(scratch) || !fs.statSync(scratch).isDirectory()) e.push("la cartella di lavoro non esiste");
  if (![os.tmpdir(), "/tmp", "/private/tmp"].map(percorsoReale).some((r) => dentro(scratch, r))) e.push("la cartella di lavoro non sta in una cartella temporanea");
  if (scratch === repo || dentro(scratch, repo)) e.push("la cartella di lavoro sta dentro il repo");
  if (!dentro(percorsoReale(copia), scratch)) e.push("la copia è fuori dalla cartella di lavoro");
  if (!dentro(percorsoReale(hub), scratch)) e.push("l'hub è fuori dalla cartella di lavoro");
  if (!fs.existsSync(copia) || !fs.statSync(copia).isFile()) e.push("la copia non esiste");
  else if (fs.statSync(copia).nlink > 1) e.push("la copia ha altri collegamenti fisici (potrebbe essere il DB vero)");
  if (path.basename(path.dirname(copia)) !== "tenants") e.push("la copia deve stare in <dati>/tenants/<codice>.db");
  return e;
}

async function leggiStdin(): Promise<string> {
  const parti: Buffer[] = [];
  for await (const c of process.stdin) parti.push(c as Buffer);
  return Buffer.concat(parti).toString("utf8").trim();
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const conValore = ["--cartella", "--url"];
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const liberi = a.filter((x, i) => !x.startsWith("--") && !conValore.includes(a[i - 1]));
  const cartella = val("--cartella");
  const url = val("--url");
  if (!cartella || !url || liberi.length !== 1) return uso();
  if (!/^https?:\/\/[^\s]+$/.test(url)) return uso("URL non valido.");

  const copia = path.resolve(liberi[0]);
  const tenant = path.basename(copia).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const dati = path.dirname(path.dirname(copia));
  const hub = path.join(dati, "hub.db");
  const errori = controlla(cartella, copia, hub);
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);
  const token = await leggiStdin();
  if (!token) return uso("Token assente su stdin.");

  process.env.DA_INVENT_DATA_DIR = dati;
  process.env.DA_IPAM_HUB_DB_PATH = hub;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const scrivi = process.stdout.write.bind(process.stdout);
  for (const k of ["log", "info", "warn", "debug"] as const) console[k] = () => {};

  // Import dopo aver fissato l'ambiente; db-tenant una volta sola (ADR 0002: niente seconda istanza).
  const { withTenant, getTenantDb } = await import("../src/lib/db-tenant");
  const { scriviInterruttore } = await import("../src/lib/topology/letture/interruttori");
  const { giroLibrenms, candidatiLibrenms, PARTI } = await import("../src/lib/integrations/librenms-fonte");
  const { createLibreNMSClient } = await import("../src/lib/integrations/librenms-api");

  const client = createLibreNMSClient(url, token);
  const sistema = await client.getRisorsa("/system").catch(() => null);
  const versione = sistema && typeof sistema.corpo === "object" && sistema.corpo !== null
    ? JSON.stringify((sistema.corpo as { system?: Array<{ local_ver?: unknown }> }).system?.[0]?.local_ver ?? null)
    : "illeggibile";
  scrivi(`LibreNMS: versione ${versione}\n`);

  const t0 = Date.now();
  const esito = await withTenant(tenant, async () => {
    scriviInterruttore("librenms", true, "prova-librenms-fonte (solo nella copia)");
    return giroLibrenms({ ignoraCadenza: true, aggiungiCandidati: false, dip: { client } });
  });
  if (!("parti" in esito)) {
    scrivi(`Giro saltato: ${esito.saltato}\n`);
    return 1;
  }
  for (const p of PARTI) {
    const e = esito.parti[p];
    scrivi(`${p.padEnd(11)} ${e.esito === "letto" ? `${e.righe} righe` : `${e.esito} (${e.codice})`}\n`);
  }
  scrivi(`inventario: ${esito.inventario.letti} apparati letti su ${esito.inventario.apparati} di rete, ${esito.inventario.non_so} non so\n`);
  const d = getTenantDb(tenant);
  const conta = (sql: string): number => (d.prepare(sql).get() as { n: number }).n;
  scrivi(`apparati con vicini: ${conta("SELECT COUNT(DISTINCT librenms_device_id) AS n FROM librenms_vicino")}; apparati con inventario: ${conta("SELECT COUNT(DISTINCT librenms_device_id) AS n FROM librenms_inventario")}\n`);
  const c = withTenant(tenant, () => candidatiLibrenms());
  scrivi(`non interrogati: ${c.non_interrogati.length}; rifiutati: ${c.rifiutati.length}; vicini da aggiungere: ${c.dai_vicini.length}\n`);
  scrivi(`tempo: ${esito.ms} ms (totale ${Date.now() - t0} ms)\n`);
  // Una seconda istanza di db-tenant scriverebbe altrove: la copia deve avere le righe del giro.
  if (conta("SELECT COUNT(*) AS n FROM librenms_lettura") === 0) {
    scrivi("Contesto del tenant perso: la copia non ha la lettura.\n");
    return 1;
  }
  return PARTI.every((p) => esito.parti[p].esito === "letto") ? 0 : 1;
}

main().then((code) => process.exit(code), (e: unknown) => {
  process.stderr.write(`Errore: ${e instanceof Error ? e.name : "sconosciuto"}\n`);
  process.exit(2);
});
