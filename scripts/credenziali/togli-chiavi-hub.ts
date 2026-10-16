// scripts/credenziali/togli-chiavi-hub.ts
/**
 * Toglie da hub.db le chiavi rese inutili dalla tappa 2 credenziali (2g, T27
 * del piano 2026-10-15-tappa2-archivio-credenziali): le due chiavi «di
 * default» di D3 (`host_windows_credential_id`, `host_linux_credential_id`) e
 * le `integration_unifi_*` (portate nel controller del tenant). Le regole, con
 * le condizioni per cui una chiave resta, in `src/lib/credentials/chiavi-hub.ts`.
 *
 * A vuoto (di base) stampa i NOMI delle chiavi, mai i valori, e non scrive.
 * `--applica`: conferma scritta («togli <n>»), backup `hub.db.bak-…` accanto
 * (spazio controllato prima), poi le chiavi in una transazione.
 *
 * Non carica db-hub né db-tenant (hub.db e i DB dei tenant si aprono
 * direttamente; quelli dei tenant in sola lettura, per i segni), quindi
 * l'ambiente del servizio non sposta niente. I due modi sono quelli della
 * pulizia: `--copia` (guardia delle copie) o `--servizio <unità>` (dati veri,
 * servizio, timer e servizio dell'aggiornamento fermi).
 *
 * Uso:  npx tsx scripts/credenziali/togli-chiavi-hub.ts --dati <cartella dati> (--copia | --servizio <unità>)
 *         [--dati-servizio <cartella>] [--applica]
 *   Uscita: 0 fatto o a vuoto, 1 chiavi trattenute o conferma non data, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cartelleServizio, controllaCopia } from "../../src/lib/credentials/guardia-copia";
import { controllaDatiVeri, lettoreConferme, valoreOpzione } from "../../src/lib/credentials/guardia-scrittura";
import { backupAccanto, oraItaliana } from "../../src/lib/credentials/backup-accanto";
import { chiaviPresentiDb, pianoChiaviHub, SEGNO_UNIFI_PORTATA, togliChiaviHubDb, type TenantHub } from "../../src/lib/credentials/chiavi-hub";
import { SEGNO_CATENE } from "../../src/lib/credentials/segni-t2";

const USO = "Uso: npx tsx scripts/credenziali/togli-chiavi-hub.ts --dati <cartella dati> (--copia | --servizio <unità>) [--dati-servizio <cartella>] [--applica]\n";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(USO);
  return 2;
}

const scrivi = (s: string) => process.stdout.write(`${s}\n`);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** I segni che servono di un tenant, dal suo DB in sola lettura; undefined se il DB non c'è. */
function segniTenant(file: string): { catene: string | null; unifi: string | null } | undefined {
  if (!fs.existsSync(file)) return undefined;
  const d = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenant_settings'").get()) return { catene: null, unifi: null };
    const leggi = (k: string) => (d.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? null;
    return { catene: leggi(SEGNO_CATENE), unifi: leggi(SEGNO_UNIFI_PORTATA) };
  } finally {
    d.close();
  }
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const datiArg = valoreOpzione(a, "--dati");
  if (!datiArg) return uso();
  const copia = a.includes("--copia");
  const unita = valoreOpzione(a, "--servizio");
  if (copia === (unita !== undefined)) {
    return uso("Dichiara i dati: --copia (la cartella è una copia) oppure --servizio <unità> (i dati veri di quell'unità, a servizio fermo).");
  }
  const servizio = cartelleServizio(process.env, valoreOpzione(a, "--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const hubDb = path.join(dati, "hub.db");
  const tenants = path.join(dati, "tenants");
  const veri = copia ? null : controllaDatiVeri({ dati, unita: unita ?? "", cartelle: servizio.cartelle });
  const errori = veri ? veri.errori : controllaCopia({ dati, hubDb, cartellaTenant: tenants, datiServizio: servizio.cartelle });
  const guardate = veri && veri.controllate.length > 0 ? `\nunità guardate: ${veri.controllate.join("; ")}` : "";
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}${guardate}`);

  const hub = new Database(hubDb, { fileMustExist: true });
  try {
    const righe = hub.prepare("SELECT codice_cliente AS codice, active FROM tenants ORDER BY codice_cliente").all() as Array<{ codice: string; active: number }>;
    const tenant: TenantHub[] = righe.map((r) => {
      const s = /^[A-Za-z0-9_-]{1,64}$/.test(r.codice) ? segniTenant(path.join(tenants, `${r.codice}.db`)) : undefined;
      return { codice: r.codice, attivo: r.active === 1, segnoCatene: s === undefined ? undefined : s.catene, segnoUnifi: s === undefined ? undefined : s.unifi };
    });
    const attivi = tenant.filter((t) => t.attivo).map((t) => t.codice);
    scrivi(veri ? `dati: quelli veri, in ${fs.realpathSync(dati)}; unità guardate: ${veri.controllate.join("; ")}` : `dati: copia in ${fs.realpathSync(dati)}`);
    scrivi(`tenant attivi nell'hub: ${attivi.length}${attivi.length > 0 ? ` (${attivi.join(", ")})` : ""}`);

    const piano = pianoChiaviHub(chiaviPresentiDb(hub), tenant);
    scrivi(`chiavi da togliere (${piano.daTogliere.length}): ${piano.daTogliere.join(", ") || "nessuna"}`);
    if (piano.trattenute.length > 0) {
      scrivi(`chiavi che restano (${piano.trattenute.length}):\n${piano.trattenute.map((t) => `  ${t.chiave}: ${t.motivo}`).join("\n")}`);
    }
    if (!a.includes("--applica")) {
      scrivi("a vuoto: niente scritto (con --applica: conferma scritta, backup di hub.db, chiavi tolte)");
      return 0;
    }
    if (piano.daTogliere.length === 0) {
      scrivi("niente da togliere");
      return piano.trattenute.length > 0 ? 1 : 0;
    }
    const atteso = `togli ${piano.daTogliere.length}`;
    const conferme = lettoreConferme();
    let risposta: string | null;
    try {
      risposta = await conferme.chiedi(`Per togliere le ${piano.daTogliere.length} chiavi qui sopra scrivi «${atteso}» e Invio (altro = non toccare): `);
    } finally {
      conferme.chiudi();
    }
    if (risposta !== atteso) {
      scrivi("conferma non data: hub.db non toccato");
      return 1;
    }
    const b = await backupAccanto(hub, hubDb);
    scrivi(`backup: ${b.percorso} (${mb(b.byte)}) alle ${oraItaliana(b.quando)} ora italiana (${b.quando.toISOString()})`);
    const n = togliChiaviHubDb(hub, piano);
    scrivi(`tolte ${n} chiavi da hub.db`);
    return piano.trattenute.length > 0 ? 1 : 0;
  } finally {
    hub.close();
  }
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
