/**
 * «Mostra password» (piano da-vault 2026-10-23, D2): nel DA-IPAM dei clienti entrano i tecnici Domarc e il cliente.
 *
 * - Non si chiede la passphrase del cliente (i tecnici non la devono conoscere): si chiede **la verifica in due
 *   passaggi dell'utente collegato** (ADR 0023). Un codice già usato non vale (lo stesso passo TOTP dell'accesso),
 *   cinque codici sbagliati in 15 minuti bloccano (429).
 * - La conferma dura **5 minuti**, per utente, in memoria (un riavvio la toglie). Solo admin e superadmin; l'utenza
 *   di servizio (id 0) non ha la 2FA e non vede.
 * - **Ogni visualizzazione va nel registro** (`vault_visualizzazioni`, nel database del cliente): utente, voce, ora.
 *   Il cliente vede chi ha guardato cosa (Impostazioni › Vault).
 * - Sull'hub con OpenBao (`DA_VAULT_OPENBAO=1`) una voce con `credential_ref` si legge da OpenBao per conto della
 *   persona: il nome va in `X-Domarc-Utente` e finisce anche nel registro di OpenBao.
 *
 * Con gli interruttori spenti la funzione non c'è (404): l'app è quella di oggi.
 */
import type Database from "better-sqlite3";
import { safeDecifraAccesso } from "@/lib/crypto";
import { getUserById, usaPassoTotp } from "@/lib/db-hub";
import { schemaVaultPresente } from "@/lib/db-tenant";
import { campiVoceDb, COLONNA_DEL_CAMPO, type CampoSegreto } from "@/lib/credentials/segreti";
import { verificaTotp } from "@/lib/accesso/totp";
import { clearRateLimit, isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { statoVaultProcesso, vaultLocaleAcceso, vaultOpenBaoAcceso } from "./stato";
import { ErroreVault } from "./tipi";

export const DURATA_CONFERMA_MS = 5 * 60_000;
const TENTATIVI = 5;
const FINESTRA_TENTATIVI_MS = 15 * 60_000;

export interface UtenteSessione {
  /** id della riga in hub.users; "0" = utenza di servizio. */
  id: string;
  nome: string;
  ruolo: string;
}

type Rifiuto = { ok: false; stato: number; errore: string };
const rifiuto = (stato: number, errore: string): Rifiuto => ({ ok: false, stato, errore });

/** La «mostra password» c'è solo con un interruttore del vault acceso. */
export function mostraPasswordAttiva(): boolean {
  return vaultLocaleAcceso() || vaultOpenBaoAcceso();
}

function eAdmin(u: UtenteSessione): boolean {
  return u.ruolo === "admin" || u.ruolo === "superadmin";
}

/** Conferma con la 2FA dell'utente collegato: 5 minuti per vedere le password. */
export function confermaConSecondaVerifica(op: { utente: UtenteSessione; codice: string; ora?: number }): { ok: true; scade: number } | Rifiuto {
  const ora = op.ora ?? Date.now();
  if (!mostraPasswordAttiva()) return rifiuto(404, "Funzione non attiva su questa installazione");
  if (!eAdmin(op.utente)) return rifiuto(403, "Solo un amministratore può vedere le password");
  const id = Number(op.utente.id);
  if (!Number.isInteger(id) || id <= 0) return rifiuto(403, "L'utenza di servizio non ha la verifica in due passaggi: entra col tuo utente");
  const chiave = `vault-conferma:${id}`;
  if (isRateLimited(chiave, TENTATIVI, FINESTRA_TENTATIVI_MS)) return rifiuto(429, "Troppi codici sbagliati: riprova fra qualche minuto");
  const u = getUserById(id);
  if (!u || u.totp_richiesta !== 1 || !u.totp_segreto) {
    return rifiuto(403, "Per vedere le password serve la verifica in due passaggi attiva sul tuo utente (Impostazioni › Utenti)");
  }
  const segreto = safeDecifraAccesso(u.totp_segreto);
  const passo = segreto ? verificaTotp(segreto, op.codice ?? "", ora, u.totp_ultimo_passo ?? null) : null;
  if (passo === null || !usaPassoTotp(id, passo)) {
    recordFailedAttempt(chiave);
    return rifiuto(403, "Codice non valido");
  }
  clearRateLimit(chiave);
  const scade = ora + DURATA_CONFERMA_MS;
  statoVaultProcesso().conferme.set(String(id), scade);
  return { ok: true, scade };
}

/** La scadenza della conferma dell'utente, se vale ancora; null altrimenti. */
export function confermaValida(utenteId: string, ora: number = Date.now()): number | null {
  const conferme = statoVaultProcesso().conferme;
  const scade = conferme.get(utenteId);
  if (scade === undefined) return null;
  if (ora >= scade) {
    conferme.delete(utenteId);
    return null;
  }
  return scade;
}

type Campi = Partial<Record<CampoSegreto, string>>;

/** I campi di una voce: da OpenBao per conto della persona se la voce ha il riferimento, altrimenti dal lettore unico. */
async function campiPerMostrare(dbh: Database.Database, credentialId: number, utente: UtenteSessione): Promise<{ ok: true; nome: string; campi: Campi } | Rifiuto> {
  const riga = dbh.prepare("SELECT * FROM credentials WHERE id = ?").get(credentialId) as Record<string, unknown> | undefined;
  if (!riga) return rifiuto(404, "Credenziale non trovata");
  const ref = typeof riga.credential_ref === "string" ? riga.credential_ref.trim() : "";
  if (vaultOpenBaoAcceso() && ref) {
    const store = statoVaultProcesso().openbao;
    if (!store) return rifiuto(503, "OpenBao acceso ma non configurato");
    try {
      const v = await store.get(ref, { perConto: utente.nome });
      const campi: Campi = {};
      for (const c of Object.keys(COLONNA_DEL_CAMPO) as CampoSegreto[]) if (v[c]) campi[c] = v[c];
      return { ok: true, nome: String(riga.name ?? `#${credentialId}`), campi };
    } catch (e) {
      return rifiuto(503, e instanceof ErroreVault ? e.message : "OpenBao non ha risposto");
    }
  }
  const e = campiVoceDb(dbh, credentialId);
  if (!e.ok) return rifiuto(500, e.motivo);
  return { ok: true, nome: e.nome, campi: e.campi };
}

export function registraVisualizzazione(
  dbh: Database.Database,
  r: { utente: UtenteSessione; azione: "mostra" | "esporta_keepass" | "keyfile"; credentialId: number | null; credenziale: string | null },
): void {
  dbh
    .prepare("INSERT INTO vault_visualizzazioni (utente_id, utente, azione, credential_id, credenziale) VALUES (?, ?, ?, ?, ?)")
    .run(r.utente.id, r.utente.nome, r.azione, r.credentialId, r.credenziale);
}

/** Mostra i campi segreti di una voce a un admin con la conferma valida; scrive la riga nel registro. */
export async function mostraVoce(op: {
  dbh: Database.Database;
  utente: UtenteSessione;
  credentialId: number;
  ora?: number;
}): Promise<{ ok: true; nome: string; campi: Campi; scade: number } | Rifiuto> {
  const ora = op.ora ?? Date.now();
  if (!mostraPasswordAttiva()) return rifiuto(404, "Funzione non attiva su questa installazione");
  if (!eAdmin(op.utente)) return rifiuto(403, "Solo un amministratore può vedere le password");
  const scade = confermaValida(op.utente.id, ora);
  if (scade === null) return rifiuto(403, "Conferma con la verifica in due passaggi per vedere le password");
  if (vaultLocaleAcceso() && !statoVaultProcesso().chiaveDati) return rifiuto(423, "Vault bloccato: va sbloccato prima (Impostazioni › Vault)");
  if (!schemaVaultPresente(op.dbh)) return rifiuto(503, "Lo schema del vault di questo cliente non è aggiornato: vedi il journal del servizio");
  const c = await campiPerMostrare(op.dbh, op.credentialId, op.utente);
  if (!c.ok) return c;
  registraVisualizzazione(op.dbh, { utente: op.utente, azione: "mostra", credentialId: op.credentialId, credenziale: c.nome });
  return { ok: true, nome: c.nome, campi: c.campi, scade };
}

export interface RigaRegistro {
  id: number;
  utente: string;
  azione: string;
  credential_id: number | null;
  credenziale: string | null;
  created_at: string;
}

/** Il registro, dal più recente, a pagine. Non contiene valori. */
export function registroVisualizzazioni(dbh: Database.Database, op: { pagina?: number; perPagina?: number } = {}): { totale: number; righe: RigaRegistro[] } {
  if (!schemaVaultPresente(dbh)) return { totale: 0, righe: [] };
  const perPagina = Math.min(Math.max(op.perPagina ?? 50, 1), 200);
  const pagina = Math.max(op.pagina ?? 1, 1);
  const totale = (dbh.prepare("SELECT COUNT(*) AS n FROM vault_visualizzazioni").get() as { n: number }).n;
  const righe = dbh
    .prepare("SELECT id, utente, azione, credential_id, credenziale, created_at FROM vault_visualizzazioni ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(perPagina, (pagina - 1) * perPagina) as RigaRegistro[];
  return { totale, righe };
}
