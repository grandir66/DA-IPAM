/**
 * Gli account visti negli accessi ai PC (piano 2026-10-23-assegnatari-da-ad, passi 3-4): come si scrivono una volta sola
 * (minuscolo, senza dominio) e quali non sono una persona. Funzioni pure, provate in `__tests__/account.test.ts`.
 *
 * Tre famiglie, con regole diverse:
 * - **di sistema**: account di macchina (`PC01$`), sessioni del gestore delle finestre (`DWM-3`, `UMFD-2`), SYSTEM,
 *   ANONYMOUS LOGON… Non si raccolgono nemmeno: sono la gran parte dei 4624 e non dicono chi usa il PC.
 * - **di servizio**: `svc_backup`, `sql_agent`, `healthmailbox…`: si raccolgono, ma non entrano nel calcolo né nelle
 *   proposte d'importazione (misura del 23/10: una postazione aveva 406.643 accessi di rete di un solo account).
 * - **amministrativi**: dal nome (`admin.domarc`, `adm-rossi`) o dai gruppi privilegiati di AD (`ad/health`).
 */
import { PRIVILEGED_GROUPS } from "@/lib/ad/health/privileged-catalog";

/** «DOMINIO\Utente», «utente@dominio.local», « Utente » → «utente»; vuoto o «-» → null. */
export function normalizzaAccount(grezzo: string | null | undefined): string | null {
  if (!grezzo) return null;
  let a = grezzo.trim();
  const barra = a.lastIndexOf("\\");
  if (barra >= 0) a = a.slice(barra + 1);
  const chiocciola = a.indexOf("@");
  if (chiocciola > 0) a = a.slice(0, chiocciola);
  a = a.trim().toLowerCase();
  if (!a || a === "-") return null;
  return a;
}

const SISTEMA_ESATTI = new Set([
  "system", "anonymous logon", "local service", "network service", "defaultaccount", "wdagutilityaccount",
  "guest", "ospite", "krbtgt",
]);

/** Account che non sono mai una persona: macchine, sessioni di Windows, identità incorporate. */
export function eAccountDiSistema(account: string): boolean {
  const a = account.toLowerCase();
  if (a.endsWith("$")) return true;
  if (/^(dwm|umfd)-\d+$/.test(a)) return true;
  if (/^font driver host/.test(a) || /^window manager/.test(a)) return true;
  return SISTEMA_ESATTI.has(a);
}

/** Account di servizio dal nome. Volutamente stretto: un falso positivo toglie una persona dalle proposte. */
export function eAccountDiServizio(account: string): boolean {
  const a = account.toLowerCase();
  if (/^(svc|srv|service|servizio|sa)[._-]/.test(a)) return true;
  if (/[._-](svc|service|servizio)$/.test(a)) return true;
  if (/^(healthmailbox|msol_|aad_|sync_|iusr|iwam|sql|mssql|backup|veeam|scan|scanner|printer|stampante|noreply|no-reply)/.test(a)) return true;
  return false;
}

/** Amministrativo dal nome: `admin`, `administrator`, `amministratore`, `adm-…`, `…-admin`, `admin.…`. */
export function eNomeAmministrativo(account: string): boolean {
  const a = account.toLowerCase();
  if (/^(admin|administrator|amministratore|adm)([._-]|\d|$)/.test(a)) return true;
  if (/[._-](admin|adm)$/.test(a)) return true;
  return false;
}

const GRUPPI_PRIVILEGIATI = new Set(
  PRIVILEGED_GROUPS.filter((g) => g.countsAsPrivilege).flatMap((g) => g.names.map((n) => n.toLowerCase())),
);

/** Dai `memberOf` di AD (DN completi «CN=Domain Admins,CN=Users,DC=…» o nomi semplici): è in un gruppo privilegiato? */
export function inGruppoPrivilegiato(memberOf: unknown): boolean {
  const voci = Array.isArray(memberOf) ? memberOf : typeof memberOf === "string" ? [memberOf] : [];
  return voci.some((v) => {
    if (typeof v !== "string") return false;
    const m = /^CN=([^,]+)/i.exec(v.trim());
    const cn = (m ? m[1] : v).trim().toLowerCase();
    return GRUPPI_PRIVILEGIATI.has(cn);
  });
}
