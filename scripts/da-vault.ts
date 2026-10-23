/**
 * da-vault sull'appliance (piano da-vault 2026-10-23, passo 10): l'archivio locale a slot e la ricifra.
 * Si lancia sull'appliance, nella cartella dell'app, con l'ambiente dell'app (per la ricifra serve ENCRYPTION_KEY):
 *
 *   printf '%s\n' "$PASSPHRASE" | node --import tsx --env-file=.env.local scripts/da-vault.ts crea
 *        chiave pubblica Domarc da DA_VAULT_CHIAVE_DOMARC; senza slot Domarc solo con
 *        --senza-domarc --richiesta-cliente <riferimento> (D5: esclusione per iscritto)
 *   printf '%s\n' "$PASSPHRASE" | … scripts/da-vault.ts slot-tpm      # systemd-creds tpm2+host
 *   … scripts/da-vault.ts stato
 *   printf '%s\n' "$PASSPHRASE" | DA_VAULT_LOCALE=1 … scripts/da-vault.ts ricifra [--applica] [--inversa] [--purga-backup]
 *        la chiave degli slot dal TPM ($CREDENTIALS_DIRECTORY/vault-key) se c'è, altrimenti dalla passphrase;
 *        senza --applica è una prova a vuoto. --inversa: dalla chiave degli slot a ENCRYPTION_KEY (per spegnere
 *        DA_VAULT_LOCALE: ferma prima il servizio). Dopo --applica elenca i backup che hanno ancora la chiave vecchia;
 *        --purga-backup li cancella (a vuoto senza --applica)
 *
 * Ogni comando stampa la cartella dati usata (DA_INVENT_DATA_DIR): `crea` e `ricifra` rifiutano una cartella senza hub.db.
 * La passphrase passa solo sullo stdin, mai come argomento. Nessun segreto a schermo.
 * Ordine sull'appliance: crea → slot-tpm → DA_VAULT_LOCALE=1 nel file e riavvio → ricifra (a vuoto) → ricifra --applica.
 */
import os from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getBackupRoot } from "../src/lib/backup/engine";
import { chiaveInstallazione } from "../src/lib/crypto";
import { resolveDataDir } from "../src/lib/data-dir";
import { cartellaVault } from "../src/lib/vault/appliance";
import { apriConPassphrase, apriConTpm, archivioPresente, creaArchivio, leggiArchivio, scriviSlotTpm } from "../src/lib/vault/archivio";
import { elencaBackupConChiave, purgaBackup } from "../src/lib/vault/backup-vecchi";
import { ricifra } from "../src/lib/vault/ricifra";
import { registraRecupero } from "../src/lib/vault/recupero";
import { impostaChiaveDati, vaultLocaleAcceso } from "../src/lib/vault/stato";
import { ErroreVault } from "../src/lib/vault/tipi";

const USO = "Uso: scripts/da-vault.ts crea [--senza-domarc --richiesta-cliente <rif>] | slot-tpm | stato | ricifra [--applica] [--inversa] [--purga-backup]   (passphrase sullo stdin)";
const OPZIONI = new Set(["--senza-domarc", "--richiesta-cliente", "--applica", "--inversa", "--purga-backup"]);

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function passphraseDaStdin(): Promise<string> {
  if (process.stdin.isTTY) esci("La passphrase va passata sullo stdin da un comando (non scritta alla tastiera, che la mostrerebbe).");
  const parti: Buffer[] = [];
  for await (const p of process.stdin) parti.push(p as Buffer);
  const prima = Buffer.concat(parti).toString("utf8").split(/\r?\n/)[0] ?? "";
  if (!prima) esci("Sullo stdin, alla prima riga, serve la passphrase del cliente");
  return prima;
}

async function main(): Promise<void> {
  const [comando, ...resto] = process.argv.slice(2);
  // Solo le opzioni conosciute (e il valore di --richiesta-cliente): una passphrase passata come argomento si rifiuta.
  for (let i = 0; i < resto.length; i++) {
    if (resto[i] === "--richiesta-cliente") {
      i++;
      continue;
    }
    if (!OPZIONI.has(resto[i])) esci("Argomento non previsto: la passphrase si passa solo sullo stdin, mai come argomento.");
  }
  const dir = cartellaVault();
  const dati = resolveDataDir();
  // La cartella dati usata si dice sempre: una DA_INVENT_DATA_DIR mancante o sbagliata non deve passare per buona.
  if (["crea", "slot-tpm", "stato", "ricifra"].includes(comando ?? "")) console.info(`Cartella dati: ${dati}`);

  if (comando === "crea") {
    if (!existsSync(join(dati, "hub.db"))) {
      esci(`Nessun hub.db in ${dati}: cartella dati sbagliata? Controlla DA_INVENT_DATA_DIR (lo stesso valore dell'app). Archivio non creato.`);
    }
    const senzaDomarc = resto.includes("--senza-domarc");
    const i = resto.indexOf("--richiesta-cliente");
    const richiesta = i >= 0 ? resto[i + 1]?.trim() : undefined;
    if (senzaDomarc && !richiesta) esci("Senza slot Domarc serve il riferimento della richiesta scritta del cliente: --richiesta-cliente <rif>");
    const passphrase = await passphraseDaStdin();
    const chi = os.userInfo().username;
    // D5: l'esclusione di Domarc è per iscritto e lascia traccia, prima (intento) e dopo (esito), in recuperi.jsonl.
    const registra = senzaDomarc && richiesta;
    if (registra) registraRecupero(dir, { ticket: richiesta, comando: "crea --senza-domarc", chi, stato: "intento" });
    let id: string;
    try {
      ({ id } = await creaArchivio(dir, {
        passphrase,
        chiaveDomarc: process.env.DA_VAULT_CHIAVE_DOMARC?.trim() || null,
        senzaDomarc,
        richiestaCliente: richiesta,
      }));
    } catch (e) {
      if (registra) registraRecupero(dir, { ticket: richiesta, comando: "crea --senza-domarc", chi, stato: "fallito", errore: e instanceof ErroreVault ? e.codice : "errore" });
      throw e;
    }
    if (registra) registraRecupero(dir, { ticket: richiesta, comando: "crea --senza-domarc", chi, stato: "ok" });
    console.info(`Archivio creato in ${dir} (id ${id}). Prossimo passo: slot-tpm, poi DA_VAULT_LOCALE=1 e riavvio.`);
    return;
  }
  if (comando === "slot-tpm") {
    const chiave = await apriConPassphrase(dir, await passphraseDaStdin());
    await scriviSlotTpm(dir, chiave);
    console.info("Slot TPM scritto (slot-tpm.cred). L'unità deve caricarlo con LoadCredentialEncrypted=vault-key:<cartella>/slot-tpm.cred");
    return;
  }
  if (comando === "stato") {
    if (!archivioPresente(dir)) {
      console.info(`Nessun archivio in ${dir}. Interruttore DA_VAULT_LOCALE: ${vaultLocaleAcceso() ? "acceso" : "spento"}.`);
      return;
    }
    const a = leggiArchivio(dir);
    const si = (b: boolean) => (b ? "sì" : "no");
    console.info(`Archivio ${a.id} (creato ${a.creato}) in ${dir}`);
    console.info(`slot cliente: ${si(a.slot.cliente)} · slot Domarc: ${si(a.slot.domarc)} · slot TPM: ${si(a.slot.tpm)}`);
    if (a.domarcEscluso) console.info(`Slot Domarc escluso su richiesta scritta del cliente ${a.domarcEscluso.richiesta} (${a.domarcEscluso.il})`);
    console.info(`Interruttore DA_VAULT_LOCALE: ${vaultLocaleAcceso() ? "acceso" : "spento"}`);
    return;
  }
  if (comando === "ricifra") {
    if (!vaultLocaleAcceso()) esci("La ricifra vuole DA_VAULT_LOCALE=1 (lo stesso valore dell'app): spento, l'app non leggerebbe i valori ricifrati.");
    const applica = resto.includes("--applica");
    const inversa = resto.includes("--inversa");
    const purga = resto.includes("--purga-backup");
    let chiave: Buffer;
    try {
      chiave = apriConTpm(dir);
    } catch {
      chiave = await apriConPassphrase(dir, await passphraseDaStdin());
    }
    impostaChiaveDati(chiave, "passphrase");
    if (inversa) {
      console.info("Ricifra INVERSA: dalla chiave degli slot a ENCRYPTION_KEY. Il servizio deve essere FERMO mentre gira: un valore scritto nel frattempo dall'app sarebbe ancora della chiave degli slot.");
    }
    const e = ricifra({ dataDir: dati, chiaveNuova: chiave, applica, inversa });
    console.info(applica ? "Ricifra APPLICATA." : "Prova a vuoto: niente è stato scritto (per scrivere: --applica).");
    for (const f of e.file) {
      console.info(`- ${f.file}: ${f.valori} valori${f.vociVerificate ? `, ${f.vociVerificate} credenziali verificate col lettore unico` : ""}${f.vociIllegibili ? `, ${f.vociIllegibili} già illeggibili prima (non toccate)` : ""}${applica ? (f.vacuum ? ", VACUUM fatto" : "") : ""}`);
      for (const [colonna, n] of Object.entries(f.perColonna)) console.info(`    ${colonna}: ${n}`);
    }
    console.info(`Totale: ${e.totale} valori.`);
    if (applica && inversa) {
      console.info("Ora: ferma il servizio se non lo è, togli DA_VAULT_LOCALE dal file dell'appliance e riavvia. L'archivio resta dov'è (si può riaccendere e rifare la ricifra).");
    }
    if (applica || purga) await backupConChiaveVecchia({ chiave, inversa, applica, purga, dati });
    return;
  }
  esci(USO);
}

/**
 * Dopo una ricifra applicata: i backup fatti PRIMA hanno ancora la chiave vecchia (chi ha `.env.local` li apre senza
 * passphrase né TPM). Si elencano e si propone `--purga-backup`; si cancellano solo con `--purga-backup --applica`.
 */
async function backupConChiaveVecchia(op: { chiave: Buffer; inversa: boolean; applica: boolean; purga: boolean; dati: string }): Promise<void> {
  const vecchia = op.inversa ? op.chiave : chiaveInstallazione();
  const r = await elencaBackupConChiave({ dataDir: op.dati, radiceBackup: getBackupRoot(), chiave: vecchia });
  console.info(`Backup con ancora la chiave ${op.inversa ? "degli slot" : "vecchia (ENCRYPTION_KEY)"}: ${r.conChiaveVecchia.length} su ${r.controllati} controllati.`);
  for (const b of r.conChiaveVecchia) console.info(`  ${b.tipo === "bak" ? ".bak" : "notturno"} ${b.percorso} (${b.valori} valori, ${Math.round(b.byte / 1024)} KiB)`);
  for (const n of r.nonVerificabili) console.warn(`  NON controllabile ${n.percorso}: ${n.motivo}`);
  if (r.conChiaveVecchia.length === 0) return;
  console.info("Le copie fuori da qui (snapshot di Proxmox, backup fuori sede) non si toccano da qui: restano con la chiave vecchia.");
  if (!op.purga) {
    console.info("Per cancellarli: ripeti con --purga-backup (a vuoto: li elenca soltanto) e poi con --purga-backup --applica.");
    return;
  }
  if (!op.applica) {
    console.info("Prova a vuoto: nessun backup cancellato (per cancellarli: --purga-backup --applica).");
    return;
  }
  const p = purgaBackup(r.conChiaveVecchia);
  console.info(`Backup cancellati: ${p.cancellati.length}.`);
  for (const x of p.errori) console.error(`  NON cancellato ${x.percorso}: ${x.motivo}`);
  if (p.errori.length > 0) esci(`${p.errori.length} backup non cancellati`, 2);
}

main().catch((e: unknown) => {
  esci(e instanceof ErroreVault ? `${e.message} (${e.codice})` : `Errore: ${e instanceof Error ? e.message : String(e)}`);
});
