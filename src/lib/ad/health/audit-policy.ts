/**
 * Lettura della audit policy avanzata del Domain Controller.
 *
 * Perche' serve: sul campo diversi Event ID fondamentali (4662 DCSync, 5136
 * modifiche directory, 4740 lockout) risultano assenti dal SIEM. Un'assenza pero'
 * e' ambigua — puo' voler dire "non e' successo nulla" oppure "non lo stiamo
 * registrando" — e le due cose hanno conseguenze opposte. Invece di indovinare,
 * si chiede al DC.
 *
 * Due trappole di localizzazione, entrambe gestite qui:
 *  - i NOMI delle sottocategorie sono tradotti → ci si ancora al GUID, che non lo e';
 *  - i VALORI ("No Auditing" / "Nessun controllo") sono tradotti → tabella di
 *    valori noti, e qualunque stringa non riconosciuta diventa `unknown`, mai
 *    un gap. Meglio tacere che accusare un DC configurato bene.
 */

export type AuditSetting = "none" | "success" | "failure" | "success+failure" | "unknown";

/** Valori di "Inclusion Setting" noti, per lingua. Chiavi in minuscolo. */
const SETTING_VALUES: Record<string, AuditSetting> = {
  // inglese
  "no auditing": "none",
  success: "success",
  failure: "failure",
  "success and failure": "success+failure",
  // italiano
  "nessun controllo": "none",
  riuscito: "success",
  "non riuscito": "failure",
  errore: "failure",
  "riuscito e non riuscito": "success+failure",
};

export interface AuditSubcategory {
  /** GUID senza parentesi graffe, maiuscolo. Indipendente dalla lingua. */
  guid: string;
  labelIt: string;
  /** Cosa serve registrare perche' il perimetro di sicurezza sia coperto. */
  needs: "success" | "failure" | "both";
  /** Event ID che si perdono se la sottocategoria e' spenta. */
  eventIds: string[];
  why: string;
}

export const AUDIT_SUBCATEGORIES: AuditSubcategory[] = [
  {
    guid: "0CCE9235-69AE-11D9-BED3-505054503030",
    labelIt: "Gestione account utente",
    needs: "success",
    eventIds: ["4720", "4726", "4738", "4740"],
    why: "Senza questa non si vedono creazione, modifica ed eliminazione di utenti, ne' i blocchi account.",
  },
  {
    guid: "0CCE9237-69AE-11D9-BED3-505054503030",
    labelIt: "Gestione gruppi di sicurezza",
    needs: "success",
    eventIds: ["4728", "4732", "4756"],
    why: "E' l'unico modo per accorgersi che qualcuno e' stato aggiunto a Domain Admins.",
  },
  {
    guid: "0CCE923B-69AE-11D9-BED3-505054503030",
    labelIt: "Accesso ai servizi di directory",
    needs: "both",
    eventIds: ["4662"],
    why: "Senza questa una DCSync (estrazione delle password di dominio) non lascia alcuna traccia.",
  },
  {
    guid: "0CCE923C-69AE-11D9-BED3-505054503030",
    labelIt: "Modifiche ai servizi di directory",
    needs: "success",
    eventIds: ["5136"],
    why: "Registra chi ha modificato oggetti di Active Directory e come.",
  },
  {
    guid: "0CCE9215-69AE-11D9-BED3-505054503030",
    labelIt: "Accesso (logon)",
    needs: "failure",
    eventIds: ["4625"],
    why: "I tentativi di accesso falliti sono il primo segnale di un attacco a forza bruta.",
  },
  {
    guid: "0CCE923F-69AE-11D9-BED3-505054503030",
    labelIt: "Convalida credenziali",
    needs: "failure",
    eventIds: ["4776"],
    why: "Intercetta i fallimenti di autenticazione NTLM sul domain controller.",
  },
  {
    guid: "0CCE9242-69AE-11D9-BED3-505054503030",
    labelIt: "Servizio di autenticazione Kerberos",
    needs: "failure",
    eventIds: ["4768", "4771"],
    why: "Copre i fallimenti Kerberos, inclusi i tentativi di pre-autenticazione anomali.",
  },
];

function normalizeGuid(raw: string): string {
  return raw.trim().replace(/^\{|\}$/g, "").toUpperCase();
}

/** Split CSV elementare: i campi di auditpol non contengono virgole quotate. */
function splitRow(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

/**
 * Ritorna GUID (senza graffe, maiuscolo) → impostazione.
 * Input non riconoscibile ⇒ mappa vuota, mai eccezione.
 */
export function parseAuditpolCsv(raw: string): Map<string, AuditSetting> {
  const out = new Map<string, AuditSetting>();
  if (!raw || raw.trim() === "") return out;

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const line of lines) {
    const cols = splitRow(line);
    // Machine,Target,Subcategory,GUID,Inclusion,Exclusion
    if (cols.length < 5) continue;
    const guidRaw = cols[3] ?? "";
    if (!/^\{?[0-9A-Fa-f]{8}-/.test(guidRaw)) continue; // header o riga spuria
    const setting = SETTING_VALUES[(cols[4] ?? "").toLowerCase()] ?? "unknown";
    out.set(normalizeGuid(guidRaw), setting);
  }
  return out;
}

export interface AuditGap extends AuditSubcategory {
  current: AuditSetting;
}

function covers(current: AuditSetting, needs: AuditSubcategory["needs"]): boolean {
  if (current === "success+failure") return true;
  if (needs === "success") return current === "success";
  if (needs === "failure") return current === "failure";
  return false; // needs === "both"
}

/**
 * Sottocategorie presenti nell'output ma non configurate come servirebbe.
 * Un GUID assente dalla mappa non viene mai segnalato: non sappiamo nulla di lui.
 */
export function auditGaps(parsed: Map<string, AuditSetting>): AuditGap[] {
  const gaps: AuditGap[] = [];
  for (const sub of AUDIT_SUBCATEGORIES) {
    const current = parsed.get(sub.guid);
    if (current === undefined || current === "unknown") continue;
    if (!covers(current, sub.needs)) gaps.push({ ...sub, current });
  }
  return gaps;
}
