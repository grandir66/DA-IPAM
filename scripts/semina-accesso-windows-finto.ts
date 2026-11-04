/**
 * semina-accesso-windows-finto.ts — dati FINTI di forma vera per guardare in locale la pagina Credenziali (diritti
 * dell'account e «Accesso Windows per host») e la scheda Copertura (piano accesso Windows, Task 8-9).
 *
 * Cosa crea, in una cartella dati NUOVA (mai la tua): un hub con un cliente di prova e un utente admin, e nel database del
 * cliente una rete, 60 host, due voci Windows e una SSH, e le righe di `host_credentials` con ogni motivo possibile
 * (riuscito, negato, password, firewall, chiusa, sospeso, errore, senza motivo) su entrambe le strade. Tutto inventato:
 * nomi di PC e indirizzi 10.250.x.x, utenti e password finti. Non apre nessuna connessione.
 *
 * Rifiuta di lavorare se `DA_INVENT_DATA_DIR` non c'è, se è la cartella `data` del repo o se contiene già un hub:
 * una semina su dati veri sarebbe una scrittura nel posto sbagliato. La password dell'utente di prova si genera qui e si
 * scrive nel file `accesso-prova.txt` DENTRO la cartella dati (permessi 600), mai a schermo né in un argomento.
 *
 * Uso: vedi `.superpowers/sdd/2026-11-04-wmi-nella-scansione/rendi-note.md`.
 *   DA_INVENT_DATA_DIR=<cartella nuova> ENCRYPTION_KEY=<chiave finta> npx tsx scripts/semina-accesso-windows-finto.ts
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { encrypt } from "../src/lib/crypto";
import { getHubDb } from "../src/lib/db-hub";
import { createCredential, getTenantDb, withTenant } from "../src/lib/db-tenant";

const CODICE_CLIENTE = "PROVA01";
const NUMERO_HOST = 60;

function esci(codice: number, messaggio: string): never {
  process.stderr.write(`${messaggio}\n`);
  process.exit(codice);
}

const dati = process.env.DA_INVENT_DATA_DIR?.trim();
if (!dati) esci(2, "Manca DA_INVENT_DATA_DIR: serve una cartella dati nuova, non quella vera.");
const cartella = path.resolve(dati);
if (cartella === path.resolve(process.cwd(), "data")) esci(2, "DA_INVENT_DATA_DIR è la cartella data del repo: serve una cartella nuova.");
if (!process.env.ENCRYPTION_KEY?.trim()) esci(2, "Manca ENCRYPTION_KEY (una chiave finta qualsiasi, la stessa con cui si accende l'applicazione).");
if (existsSync(path.join(cartella, "hub.db"))) esci(2, `${cartella} contiene già un hub: la semina vuole una cartella vuota.`);
mkdirSync(cartella, { recursive: true });

/** Un motivo per ogni riga, a rotazione: ogni caso compare più volte, e con 60 host si vede la paginazione. */
const MOTIVI_WINRM = ["ok", "diritti_mancanti", "firewall", "password_errata", "errore", "porte_chiuse", "budget_esaurito", null, "ok", "ok"] as const;
const MOTIVI_WMI = [null, "ok", "diritti_mancanti", "password_errata", "errore", "porte_chiuse", "budget_esaurito", "firewall", "diritti_mancanti", null] as const;

const hub = getHubDb();
const password = randomBytes(18).toString("base64url");
const clienteId = Number(
  hub.prepare("INSERT INTO tenants (codice_cliente, ragione_sociale, active) VALUES (?, ?, 1)").run(CODICE_CLIENTE, "Cliente di prova (dati finti)").lastInsertRowid,
);
const utenteId = Number(
  hub.prepare("INSERT INTO users (username, password_hash, role) VALUES ('prova-diritti', ?, 'admin')").run(bcrypt.hashSync(password, 10)).lastInsertRowid,
);
hub.prepare("INSERT INTO user_tenant_access (user_id, tenant_id, role) VALUES (?, ?, 'admin')").run(utenteId, clienteId);
hub.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_completed', '1')").run();
hub.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(`onboarding_completed:${CODICE_CLIENTE}`);

const d = getTenantDb(CODICE_CLIENTE);
const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.250.0.0/24', 'Sede (dati finti)')").run().lastInsertRowid);
// Le voci passano dal CRUD dell'archivio (come in produzione): un INSERT a mano scriverebbe fuori dalla validazione dei tipi.
const voce = (nome: string, tipo: string, utente: string): number =>
  withTenant(CODICE_CLIENTE, () =>
    createCredential({ name: nome, credential_type: tipo, encrypted_username: encrypt(utente), encrypted_password: encrypt(randomBytes(12).toString("base64url")) }).id,
  );
const scansioni = voce("Scansioni Windows (dominio)", "windows", "FINTO\\svc-scansioni");
const localeAdmin = voce("Amministratore locale", "windows", ".\\admin-finto");
voce("SSH dei Linux", "ssh", "finto-ssh");

const inserisciHost = d.prepare("INSERT INTO hosts (network_id, ip, hostname, status, classification) VALUES (?, ?, ?, 'online', 'workstation')");
const inserisciRiga = d.prepare(
  `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, fail_count, last_error, last_attempt_at, motivo)
   VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
);
const TESTI_ERRORE: Record<string, string> = {
  diritti_mancanti: "Accesso negato: password giusta, mancano i diritti",
  firewall: "Nessuna risposta in tempo, firewall da controllare",
  password_errata: "Password errata",
  errore: "Errore del bridge",
};

d.transaction(() => {
  for (let i = 0; i < NUMERO_HOST; i += 1) {
    const hostId = Number(inserisciHost.run(rete, `10.250.0.${i + 1}`, i % 7 === 3 ? null : `PC-FINTO-${String(i + 1).padStart(2, "0")}`).lastInsertRowid);
    const ora = new Date(Date.UTC(2026, 10, 4, 7, 0, 0) - i * 17 * 60_000).toISOString();
    const righe: Array<[number, "winrm" | "wmi", string | null]> = [
      [scansioni, "winrm", MOTIVI_WINRM[i % MOTIVI_WINRM.length]],
      [scansioni, "wmi", MOTIVI_WMI[i % MOTIVI_WMI.length]],
    ];
    // La seconda voce entra su un host ogni cinque: la copertura prende l'esito migliore fra le voci.
    if (i % 5 === 1) righe.push([localeAdmin, "winrm", "ok"]);
    for (const [credId, strada, motivo] of righe) {
      if (strada === "wmi" && motivo === null && i % 10 === 0) continue; // nessuna riga: «non provato» senza riga
      inserisciRiga.run(
        hostId,
        credId,
        strada,
        strada === "wmi" ? 135 : 5985,
        motivo === "ok" ? 1 : 0,
        motivo === "ok" ? ora : null,
        motivo && motivo in TESTI_ERRORE ? 1 : 0,
        motivo ? (TESTI_ERRORE[motivo] ?? null) : null,
        motivo ? ora : null,
        motivo,
      );
    }
  }
})();

writeFileSync(path.join(cartella, "accesso-prova.txt"), `utente: prova-diritti\npassword: ${password}\n`, { mode: 0o600 });
process.stdout.write(`Semina finta fatta in ${cartella}\nUtente e password in ${path.join(cartella, "accesso-prova.txt")} (permessi 600).\n`);
