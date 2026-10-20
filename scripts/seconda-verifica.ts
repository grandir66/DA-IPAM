/**
 * Verifica in due passaggi dal server (Riccardo, 20/10; ADR 0023): la via di recupero quando
 * l'unico amministratore ha perso il telefono. Si lancia sul server, nella cartella dell'app:
 *
 *   npx tsx scripts/seconda-verifica.ts stato  <utente>
 *   npx tsx scripts/seconda-verifica.ts azzera <utente>   # al prossimo accesso un QR nuovo
 *   npx tsx scripts/seconda-verifica.ts togli  <utente>   # torna alla sola password
 *
 * Usa l'hub della cartella dati di sempre (`DA_INVENT_DATA_DIR`/`DA_IPAM_HUB_DB_PATH` se impostati).
 * Ogni azione va nel registro degli accessi come «riga di comando (<utente del sistema>)».
 * Non stampa mai segreti.
 */
import os from "node:os";
import { getUserByUsername, impostaSecondaVerifica } from "../src/lib/db-hub";
import { scriviRegistroAccessi } from "../src/lib/accesso/registro-accessi";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

const [comando, nome] = process.argv.slice(2);
if (!comando || !nome || !["stato", "azzera", "togli"].includes(comando)) {
  esci("Uso: npx tsx scripts/seconda-verifica.ts stato|azzera|togli <utente>");
}
const utente = getUserByUsername(nome);
if (!utente) esci(`Utente «${nome}» non trovato in questo hub.`);

const stato = (u: NonNullable<ReturnType<typeof getUserByUsername>>) =>
  u.totp_richiesta !== 1 ? "non richiesta (sola password)" : u.totp_segreto ? "attiva" : "richiesta, da attivare al prossimo accesso";

if (comando === "stato") {
  console.log(`${utente.username}: ${stato(utente)}`);
  process.exit(0);
}
const azione = comando as "azzera" | "togli";
if (!impostaSecondaVerifica(utente.id, azione)) esci(`Nessuna riga aggiornata per «${nome}».`);
scriviRegistroAccessi({
  azione: `seconda_verifica_${azione}`,
  utente: utente.username,
  utenteId: utente.id,
  da: `riga di comando (${os.userInfo().username})`,
});
console.log(`${utente.username}: ${stato(getUserByUsername(nome)!)}`);
