/**
 * I dettagli veri di un alert di Wazuh (Riccardo, 13/11/2026: «non hanno sufficienti dettagli per capire se possono
 * essere un reale problema», «non vengono visualizzati i dettagli reali»). Su DTS «User account changed» compariva
 * mille volte per server con «Event ID 4738 · Utente: Administrator» e basta: dell'evento originale si teneva solo
 * `rule.groups`, e si buttava via chi aveva fatto la modifica, che cosa era cambiato, il codice d'errore di un accesso.
 *
 * Qui si sceglie che cosa tenere: i campi dell'evento, coi nomi che una persona capisce, senza i valori vuoti.
 * Modulo puro. I dati restano nel database dell'installazione, come il resto dell'alert.
 */
export interface DettaglioAlert { nome: string; valore: string }

const TETTO_CAMPI = 32;
const TETTO_VALORE = 240;
const TETTO_TESTO_LUNGO = 600;

/** Nomi leggibili dei campi più usati; gli altri restano col nome dell'evento. */
const NOME_WINDOWS: Record<string, string> = {
  subjectUserName: "Fatto da",
  subjectDomainName: "Dominio di chi l'ha fatto",
  subjectLogonId: "Sessione di chi l'ha fatto",
  targetUserName: "Account toccato",
  targetDomainName: "Dominio dell'account",
  workstationName: "Postazione",
  ipAddress: "Indirizzo di provenienza",
  ipPort: "Porta di provenienza",
  logonType: "Tipo di accesso",
  logonProcessName: "Processo di accesso",
  authenticationPackageName: "Pacchetto di autenticazione",
  status: "Codice di stato",
  subStatus: "Codice di dettaglio",
  failureReason: "Motivo del rifiuto",
  processName: "Programma",
  privilegeList: "Privilegi",
  samAccountName: "Nome account (SAM)",
  displayName: "Nome visualizzato",
  userPrincipalName: "UPN",
  passwordLastSet: "Password impostata il",
  accountExpires: "Scadenza account",
  oldUacValue: "Opzioni account prima",
  newUacValue: "Opzioni account dopo",
  userAccountControl: "Opzioni account cambiate",
  memberName: "Membro",
  memberSid: "SID del membro",
  serviceName: "Servizio",
  ticketEncryptionType: "Cifratura del ticket",
};
const NOME_365: Record<string, string> = {
  Operation: "Operazione",
  ResultStatus: "Esito",
  UserId: "Utente",
  ClientIP: "Indirizzo di provenienza",
  ErrorNumber: "Codice d'errore",
  LogonError: "Errore di accesso",
  ApplicationId: "Applicazione (id)",
  Workload: "Servizio",
  UserAgent: "Programma del client",
  RequestType: "Tipo di richiesta",
  ResultStatusDetail: "Dettaglio dell'esito",
  OS: "Sistema del client",
  BrowserType: "Browser",
  CreationTime: "Ora dell'evento",
};
/** Identificativi interni di Microsoft 365: non aiutano a capire, allungano solo l'elenco (visto su DTS il 13/11/2026). */
const INUTILI_365 = new Set([
  "UserKey", "OrganizationId", "IntraSystemId", "InterSystemsId", "RecordType", "Version", "Subscription", "ActorContextId",
  "TargetContextId", "ObjectId", "Id", "UserType", "AzureActiveDirectoryEventType", "ActorIpAddress", "ExtendedProperties",
  "DeviceProperties", "Actor", "Target", "ModifiedProperties", "SupportTicketId", "ErrorNumber",
]);
/** I codici d'errore di accesso più comuni di Entra ID, detti in chiaro. */
const SIGNIFICATO_ERRORE_365: Record<string, string> = {
  "50053": "account bloccato per troppi tentativi sbagliati (blocco automatico di Microsoft)",
  "50126": "nome utente o password sbagliati",
  "50055": "password scaduta",
  "50056": "password non valida o assente",
  "50057": "account disabilitato",
  "50034": "l'account non esiste in questo tenant",
  "50074": "serve l'autenticazione a più fattori",
  "50076": "serve l'autenticazione a più fattori",
  "50079": "l'utente deve registrare l'autenticazione a più fattori",
  "50158": "richiesta una verifica di sicurezza esterna",
  "53003": "accesso bloccato da una regola di accesso condizionale",
  "53004": "l'utente deve completare la registrazione della sicurezza",
  "700016": "applicazione non trovata nel tenant",
};
/** Valori che in un evento Windows vogliono dire «niente»: non si mostrano. */
const VUOTI = new Set(["", "-", "%%1793", "%%1794", "0x0", "(null)", "null", "NULL SID", "S-1-0-0"]);

function testo(v: unknown, tetto = TETTO_VALORE): string | null {
  if (v == null) return null;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (VUOTI.has(t)) return null;
  return t.length > tetto ? `${t.slice(0, tetto)}…` : t;
}

function oggetto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** I dettagli da tenere e mostrare, nell'ordine in cui servono a capire. Mai più di `TETTO_CAMPI`. */
export function dettagliAlert(doc: unknown): DettaglioAlert[] {
  const out: DettaglioAlert[] = [];
  const visti = new Set<string>();
  const metti = (nome: string, v: unknown, tetto?: number): void => {
    const t = testo(v, tetto);
    if (t == null || visti.has(nome) || out.length >= TETTO_CAMPI) return;
    visti.add(nome);
    out.push({ nome, valore: t });
  };
  const d = oggetto(oggetto(doc)?.data) ?? {};

  // Windows: prima chi e che cosa, poi tutto il resto dell'evento che ha un valore.
  const win = oggetto(d.win);
  const ed = oggetto(win?.eventdata);
  if (ed) {
    for (const k of Object.keys(NOME_WINDOWS)) if (k in ed) metti(NOME_WINDOWS[k], ed[k]);
    for (const [k, v] of Object.entries(ed)) if (!(k in NOME_WINDOWS)) metti(k, v);
  }
  const sys = oggetto(win?.system);
  if (sys) {
    metti("Computer", sys.computer);
    metti("Messaggio", sys.message, TETTO_TESTO_LUNGO);
  }

  // Microsoft 365: i campi semplici, poi le proprietà estese (programma del client, dettaglio dell'esito).
  const o = oggetto(d.office365);
  if (o) {
    const codice = testo(o.ErrorNumber);
    if (codice) metti("Codice d'errore", SIGNIFICATO_ERRORE_365[codice] ? `${codice}: ${SIGNIFICATO_ERRORE_365[codice]}` : codice);
    for (const k of Object.keys(NOME_365)) if (k in o && k !== "ErrorNumber") metti(NOME_365[k], o[k]);
    for (const lista of [o.ExtendedProperties, o.DeviceProperties]) {
      if (!Array.isArray(lista)) continue;
      for (const voce of lista) {
        const p = oggetto(voce);
        if (p && typeof p.Name === "string") metti(NOME_365[p.Name] ?? p.Name, p.Value);
      }
    }
    for (const [k, v] of Object.entries(o)) if (!(k in NOME_365) && !INUTILI_365.has(k)) metti(k, v);
  }

  // Decoder generici (sshd, sudo, apparati).
  metti("Indirizzo di provenienza", d.srcip);
  metti("Porta di provenienza", d.srcport);
  metti("Utente usato", d.srcuser);
  metti("Utente di destinazione", d.dstuser);
  metti("Utente", d.username);
  const radice = oggetto(doc) ?? {};
  metti("Riga del registro", radice.full_log, TETTO_TESTO_LUNGO);
  metti("Registro", radice.location);
  return out;
}
