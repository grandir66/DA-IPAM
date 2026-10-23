/**
 * da-vault sull'appliance (piano da-vault 2026-10-23, passo 10): l'archivio locale a slot e la ricifra.
 * Si lancia sull'appliance, nella cartella dell'app, con l'ambiente dell'app (per la ricifra serve ENCRYPTION_KEY):
 *
 *   printf '%s\n' "$PASSPHRASE" | node --import tsx --env-file=.env.local scripts/da-vault.ts crea
 *        chiave pubblica Domarc da DA_VAULT_CHIAVE_DOMARC; senza slot Domarc solo con
 *        --senza-domarc --richiesta-cliente <riferimento> (D5: esclusione per iscritto)
 *   printf '%s\n' "$PASSPHRASE" | … scripts/da-vault.ts slot-tpm      # systemd-creds tpm2+host
 *   … scripts/da-vault.ts stato
 *   printf '%s\n' "$PASSPHRASE" | DA_VAULT_LOCALE=1 … scripts/da-vault.ts ricifra [--applica]
 *        la chiave degli slot dal TPM ($CREDENTIALS_DIRECTORY/vault-key) se c'è, altrimenti dalla passphrase;
 *        senza --applica è una prova a vuoto
 *
 * La passphrase passa solo sullo stdin, mai come argomento. Nessun segreto a schermo.
 * Ordine sull'appliance: crea → slot-tpm → DA_VAULT_LOCALE=1 nel file e riavvio → ricifra (a vuoto) → ricifra --applica.
 */
import { resolveDataDir } from "../src/lib/data-dir";
import { cartellaVault } from "../src/lib/vault/appliance";
import { apriConPassphrase, apriConTpm, archivioPresente, creaArchivio, leggiArchivio, scriviSlotTpm } from "../src/lib/vault/archivio";
import { ricifra } from "../src/lib/vault/ricifra";
import { impostaChiaveDati, vaultLocaleAcceso } from "../src/lib/vault/stato";
import { ErroreVault } from "../src/lib/vault/tipi";

const USO = "Uso: scripts/da-vault.ts crea [--senza-domarc --richiesta-cliente <rif>] | slot-tpm | stato | ricifra [--applica]   (passphrase sullo stdin)";
const OPZIONI = new Set(["--senza-domarc", "--richiesta-cliente", "--applica"]);

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

  if (comando === "crea") {
    const senzaDomarc = resto.includes("--senza-domarc");
    const i = resto.indexOf("--richiesta-cliente");
    if (senzaDomarc && (i < 0 || !resto[i + 1])) esci("Senza slot Domarc serve il riferimento della richiesta scritta del cliente: --richiesta-cliente <rif>");
    const { id } = await creaArchivio(dir, { passphrase: await passphraseDaStdin(), chiaveDomarc: process.env.DA_VAULT_CHIAVE_DOMARC?.trim() || null, senzaDomarc });
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
    console.info(`Interruttore DA_VAULT_LOCALE: ${vaultLocaleAcceso() ? "acceso" : "spento"}`);
    return;
  }
  if (comando === "ricifra") {
    if (!vaultLocaleAcceso()) esci("La ricifra vuole DA_VAULT_LOCALE=1 (lo stesso valore dell'app): spento, l'app non leggerebbe i valori ricifrati.");
    let chiave: Buffer;
    try {
      chiave = apriConTpm(dir);
    } catch {
      chiave = await apriConPassphrase(dir, await passphraseDaStdin());
    }
    impostaChiaveDati(chiave, "passphrase");
    const applica = resto.includes("--applica");
    const e = ricifra({ dataDir: resolveDataDir(), chiaveNuova: chiave, applica });
    console.info(applica ? "Ricifra APPLICATA." : "Prova a vuoto: niente è stato scritto (per scrivere: --applica).");
    for (const f of e.file) {
      console.info(`- ${f.file}: ${f.valori} valori${f.vociVerificate ? `, ${f.vociVerificate} credenziali verificate col lettore unico` : ""}${f.vociIllegibili ? `, ${f.vociIllegibili} già illeggibili prima (non toccate)` : ""}${applica ? (f.vacuum ? ", VACUUM fatto" : "") : ""}`);
      for (const [colonna, n] of Object.entries(f.perColonna)) console.info(`    ${colonna}: ${n}`);
    }
    console.info(`Totale: ${e.totale} valori.`);
    return;
  }
  esci(USO);
}

main().catch((e: unknown) => {
  esci(e instanceof ErroreVault ? `${e.message} (${e.codice})` : `Errore: ${e instanceof Error ? e.message : String(e)}`);
});
