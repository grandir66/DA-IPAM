// scripts/controllo-classificazione-cli.ts
// Controllo della classificazione: la classe scritta contro la migliore possibile (src/lib/classification/controllo.ts).
// Sola lettura per il cliente: lavora su una COPIA del DB, perché il ricalcolo del motore scrive le evidenze.
//
// Uso (sull'appliance):
//   sqlite3 /opt/da-ipam/data/tenants/<codice>.db ".backup /root/controllo-<codice>.db"
//   npx tsx scripts/controllo-classificazione-cli.ts /root/controllo-<codice>.db [--tutto] [--senza-ricalcolo]
//   rm /root/controllo-<codice>.db*
//
// --tutto            stampa ogni riga (di serie 40 per famiglia)
// --senza-ricalcolo  salta il ricalcolo del motore: solo le regole indipendenti
import path from "path";
import Database from "better-sqlite3";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";
import { macPrivato } from "@/lib/hosts/cambio-inquilino";
import { controlla, ETICHETTA_FAMIGLIA, type Famiglia, type Rilievo, type RigaControllo } from "@/lib/classification/controllo";

const argomenti = process.argv.slice(2);
const file = argomenti.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Uso: npx tsx scripts/controllo-classificazione-cli.ts <copia-del-db> [--tutto] [--senza-ricalcolo]");
  process.exit(1);
}
const assoluto = path.resolve(file);
if (/[\\/]data[\\/]tenants[\\/]/.test(assoluto)) {
  console.error(`Rifiutato: ${assoluto} è il DB vivo. Il controllo gira solo su una copia (sqlite3 <db> ".backup <copia>").`);
  process.exit(1);
}
const tutto = argomenti.includes("--tutto");
const ricalcola = !argomenti.includes("--senza-ricalcolo");

interface RigaDb {
  id: number; ip: string; nome: string | null; mac: string | null; vendor: string | null; os_info: string | null;
  open_ports: string | null; classification: string | null; classification_manual: number | null;
}
const LEGGI = `SELECT id, ip, COALESCE(NULLIF(custom_name,''), NULLIF(hostname,''), NULLIF(dns_reverse,'')) AS nome,
                      mac, vendor, os_info, open_ports, classification, classification_manual
               FROM hosts ORDER BY id`;

function porte(json: string | null): number[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((p) => Number((p as { port?: unknown }).port)).filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

const db = new Database(assoluto);
db.pragma("busy_timeout = 30000");
const prima = db.prepare(LEGGI).all() as RigaDb[];

const dopo = new Map<number, string | null>();
if (ricalcola) {
  let falliti = 0;
  for (const r of prima) {
    if (recomputeAttributionForDb(db, r.id, "backfill") === null) falliti++;
  }
  for (const r of db.prepare("SELECT id, classification FROM hosts").all() as Array<{ id: number; classification: string | null }>) {
    dopo.set(r.id, r.classification);
  }
  if (falliti > 0) console.log(`Attenzione: ${falliti} righe non ricalcolate (errore del motore, vedi sopra).`);
}

const perNome = new Map<string, number>();
const macVeri = new Map<string, Set<string>>();
const chiaveNome = (n: string | null) => (n ?? "").trim().toLowerCase().split(".")[0];
for (const r of prima) {
  const k = chiaveNome(r.nome);
  if (!k) continue;
  perNome.set(k, (perNome.get(k) ?? 0) + 1);
  if (r.mac && !macPrivato(r.mac)) macVeri.set(k, (macVeri.get(k) ?? new Set<string>()).add(r.mac.toUpperCase()));
}

interface Voce { riga: RigaControllo; rilievo: Rilievo }
const perFamiglia = new Map<Famiglia, Voce[]>();
let conRilievi = 0;
for (const r of prima) {
  const riga: RigaControllo = {
    id: r.id, ip: r.ip, nome: r.nome, mac: r.mac, vendor: r.vendor, os: r.os_info, porte: porte(r.open_ports),
    classeAdesso: r.classification, aMano: (r.classification_manual ?? 0) === 1,
    classeRicalcolata: ricalcola ? dopo.get(r.id) ?? null : undefined,
    righeStessoNome: perNome.get(chiaveNome(r.nome)) ?? 1,
    macVeriStessoNome: macVeri.get(chiaveNome(r.nome))?.size ?? 0,
  };
  const rilievi = controlla(riga);
  if (rilievi.length > 0) conRilievi++;
  for (const rilievo of rilievi) {
    const elenco = perFamiglia.get(rilievo.famiglia) ?? [];
    elenco.push({ riga, rilievo });
    perFamiglia.set(rilievo.famiglia, elenco);
  }
}
db.close();

const ORDINE: Famiglia[] = ["ricalcolo", "nome_contro_classe", "forma_non_funzione", "sistema_non_credibile", "senza_classe", "stesso_apparato"];
const TETTO = 40;
for (const f of ORDINE) {
  const elenco = perFamiglia.get(f) ?? [];
  if (elenco.length === 0) continue;
  const conProposta = elenco.filter((v) => v.rilievo.proposta !== null).length;
  console.log(`\n== ${ETICHETTA_FAMIGLIA[f]}: ${elenco.length} (${conProposta} con una proposta)`);
  // Prima quelle con una proposta, poi per sicurezza.
  const peso = { alta: 0, media: 1, bassa: 2 } as const;
  elenco.sort((a, b) => Number(a.rilievo.proposta === null) - Number(b.rilievo.proposta === null) || peso[a.rilievo.sicurezza] - peso[b.rilievo.sicurezza]);
  for (const { riga, rilievo } of tutto ? elenco : elenco.slice(0, TETTO)) {
    const adesso = riga.classeAdesso && riga.classeAdesso !== "unknown" ? riga.classeAdesso : "—";
    const mano = riga.aMano ? " [a mano]" : "";
    console.log(`  ${riga.ip.padEnd(15)} ${(riga.nome ?? "-").slice(0, 28).padEnd(28)} ${adesso}${mano} → ${rilievo.proposta ?? "?"}  (${rilievo.sicurezza})  ${rilievo.motivo}`);
  }
  if (!tutto && elenco.length > TETTO) console.log(`  … altre ${elenco.length - TETTO} (--tutto le stampa)`);
}
console.log(`\n${prima.length} righe, ${conRilievi} con almeno un rilievo${ricalcola ? "" : " (ricalcolo del motore saltato)"}. Niente scritto sul DB del cliente.`);
