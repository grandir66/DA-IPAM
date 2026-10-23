/**
 * da-vault-recover (piano da-vault 2026-10-23, «Recupero»): riapre l'archivio di un'appliance con la chiave Domarc,
 * su richiesta scritta del cliente, con un ticket. Si lancia sull'appliance, nella cartella dell'app.
 *
 * La chiave privata Domarc si passa SOLO sullo stdin (dalla cartella personale in Keeper), alla prima riga:
 *
 *   <chiave da Keeper> | npx tsx scripts/da-vault-recover.ts reset-password --ticket T-123
 *        (seconda riga dello stdin: la passphrase nuova del cliente, almeno 14 caratteri)
 *   <chiave da Keeper> | npx tsx scripts/da-vault-recover.ts export-keyfile --ticket T-123 --uscita /root/cliente.keyx
 *   <chiave da Keeper> | npx tsx scripts/da-vault-recover.ts rotate --ticket T-123 --destinatario age1…
 *
 * `--archivio <cartella>` sposta l'archivio (di serie `<dati>/vault`). Mai la chiave come argomento: il comando la
 * rifiuta. Nessun segreto a schermo; ogni uso lascia una riga (ticket, comando, ora, utente) in `recuperi.jsonl`.
 */
import os from "node:os";
import { existsSync, writeFileSync } from "node:fs";
import { cartellaVault } from "../src/lib/vault/appliance";
import { controllaArgomenti, esportaKeyfileDomarc, leggiIdentitaDaStdin, registraRecupero, resetPassword, ruotaSlotDomarc } from "../src/lib/vault/recupero";
import { ErroreVault } from "../src/lib/vault/tipi";

const USO = "Uso: <chiave Domarc sullo stdin> | npx tsx scripts/da-vault-recover.ts reset-password|export-keyfile|rotate --ticket <id> [--archivio <cartella>] [--uscita <file>] [--destinatario age1…]";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

function opzione(argomenti: string[], nome: string): string | undefined {
  const i = argomenti.indexOf(`--${nome}`);
  if (i >= 0) return argomenti[i + 1];
  const uguale = argomenti.find((a) => a.startsWith(`--${nome}=`));
  return uguale?.slice(nome.length + 3);
}

async function leggiStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    esci("La chiave Domarc va passata sullo stdin da un comando (non scritta alla tastiera, che la mostrerebbe a schermo).");
  }
  const parti: Buffer[] = [];
  for await (const p of process.stdin) parti.push(p as Buffer);
  return Buffer.concat(parti).toString("utf8");
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  try {
    controllaArgomenti(argomenti);
  } catch (e) {
    esci(e instanceof Error ? e.message : String(e));
  }
  const comando = argomenti[0];
  if (!comando || !["reset-password", "export-keyfile", "rotate"].includes(comando)) esci(USO);
  const ticket = opzione(argomenti, "ticket")?.trim();
  if (!ticket) esci("Serve il ticket della richiesta scritta del cliente: --ticket <id>");
  const dir = opzione(argomenti, "archivio") ?? cartellaVault();
  const uscita = opzione(argomenti, "uscita");
  const destinatario = opzione(argomenti, "destinatario");
  if (comando === "export-keyfile" && !uscita) esci("export-keyfile vuole --uscita <file>");
  if (comando === "export-keyfile" && uscita && existsSync(uscita)) esci(`Il file ${uscita} c'è già: non si sovrascrive`);
  if (comando === "rotate" && !destinatario) esci("rotate vuole --destinatario age1… (la chiave pubblica nuova)");

  const { identita, resto } = leggiIdentitaDaStdin(await leggiStdin());
  if (comando === "reset-password") {
    const nuova = resto[0];
    if (!nuova) esci("reset-password: la passphrase nuova va alla seconda riga dello stdin");
    await resetPassword(dir, identita, nuova);
    console.info("Slot del cliente riscritto con la passphrase nuova. Comunicalo al cliente (ticket nel registro).");
  } else if (comando === "export-keyfile" && uscita) {
    writeFileSync(uscita, await esportaKeyfileDomarc(dir, identita), { mode: 0o600, flag: "wx" });
    console.info(`Key file scritto in ${uscita} (0600). Consegnalo al cliente e cancellalo da qui.`);
  } else if (comando === "rotate" && destinatario) {
    await ruotaSlotDomarc(dir, identita, destinatario);
    console.info("Slot Domarc riscritto verso la chiave pubblica nuova; la chiave dei dati non cambia.");
  }
  registraRecupero(dir, { ticket, comando, chi: os.userInfo().username });
}

main().catch((e: unknown) => {
  esci(e instanceof ErroreVault ? `${e.message} (${e.codice})` : `Errore: ${e instanceof Error ? e.message : String(e)}`);
});
