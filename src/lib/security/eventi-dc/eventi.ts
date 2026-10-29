/**
 * Eventi di sicurezza letti dai domain controller via WinRM, senza Wazuh (Riccardo, 29/10/2026).
 *
 * Dove non c'è l'agente Wazuh sui DC, la pagina «Alert sicurezza» resta vuota. L'appliance ha già
 * la credenziale WinRM del DC (sonda di AD Health): con quella legge da sola il registro Sicurezza
 * e, dallo stesso giro, System (servizi installati) e Defender (malware), filtrati sul DC con una
 * XPath (arriva solo ciò che serve) e ripresi ognuno dal suo ultimo EventRecordID.
 *
 * Modulo puro (niente I/O): script PowerShell, lettura della risposta e classificazione, così si
 * provano senza un DC. Le categorie sono quelle della pagina (`wazuh-alerts.ts`), perché la pagina
 * è la stessa: cambia solo da dove arrivano i dati.
 */

import { accountKind, isSelfOrigin, normalizeIp, type NormalizedAlert, type SelfIdentity } from "@/lib/integrations/wazuh-alerts";

/** Cosa si legge e perché. Ogni ID ha la sua categoria della pagina e un livello nella scala di Wazuh. */
export interface DefinizioneEvento {
  id: number;
  descrizione: string;
  /**
   * Le prime tre sono categorie della pagina «Alert sicurezza» e vanno in coda; «accesso» e «uscita»
   * (login e logout riusciti) restano solo nella pagina «Sicurezza del dominio»: non sono allarmi.
   */
  categoria: "auth_failure" | "privileged_change" | "log_tampering" | "domain_attack" | "malware" | "accesso" | "uscita";
  /** Registro del DC da cui si legge; di serie Sicurezza. */
  registro?: RegistroDc;
  /** Livello come quello di Wazuh: 12 notifica subito, sotto va nel riepilogo. */
  livello: number;
  /** Gruppi come quelli di Wazuh: tengono buono il filtro «sistema» dell'elenco. */
  gruppi: string[];
}

const WIN = ["windows", "windows_security", "dc_winrm"];

/**
 * I registri letti. Ognuno ha il suo EventRecordID: in archivio la chiave del record porta l'offset
 * del registro, così (DC, record) resta unica senza rifare la tabella.
 */
export const REGISTRI_DC = {
  Security: { log: "Security", offset: 0 },
  System: { log: "System", offset: 10_000_000_000_000 },
  Defender: { log: "Microsoft-Windows-Windows Defender/Operational", offset: 20_000_000_000_000 },
} as const;
export type RegistroDc = keyof typeof REGISTRI_DC;
export const NOMI_REGISTRI = Object.keys(REGISTRI_DC) as RegistroDc[];

export function chiaveRecord(registro: RegistroDc, record: number): number {
  return REGISTRI_DC[registro].offset + record;
}

export const EVENTI_DC: readonly DefinizioneEvento[] = [
  { id: 4625, descrizione: "Accesso non riuscito", categoria: "auth_failure", livello: 5, gruppi: [...WIN, "authentication_failed"] },
  { id: 4771, descrizione: "Kerberos: preautenticazione non riuscita", categoria: "auth_failure", livello: 5, gruppi: [...WIN, "authentication_failed"] },
  { id: 4776, descrizione: "NTLM: convalida delle credenziali non riuscita", categoria: "auth_failure", livello: 5, gruppi: [...WIN, "authentication_failed"] },
  { id: 4740, descrizione: "Account bloccato", categoria: "auth_failure", livello: 10, gruppi: [...WIN, "authentication_failures"] },
  // 4768: richiesta del ticket Kerberos iniziale, cioè l'accesso al dominio da una postazione. Riuscita = login.
  { id: 4768, descrizione: "Accesso al dominio", categoria: "accesso", livello: 3, gruppi: [...WIN, "authentication_success"] },
  // 4624/4634 solo di tipo 2 (console) e 10 (desktop remoto): chi entra sul DC stesso. Il resto è rumore di rete.
  { id: 4624, descrizione: "Accesso al DC", categoria: "accesso", livello: 3, gruppi: [...WIN, "authentication_success"] },
  { id: 4634, descrizione: "Uscita dal DC", categoria: "uscita", livello: 3, gruppi: [...WIN] },
  { id: 4647, descrizione: "Disconnessione dal DC", categoria: "uscita", livello: 3, gruppi: [...WIN] },
  { id: 4720, descrizione: "Account utente creato", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "adduser"] },
  { id: 4726, descrizione: "Account utente eliminato", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "account_changed"] },
  { id: 4724, descrizione: "Password reimpostata da un altro account", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "account_changed"] },
  { id: 4722, descrizione: "Account abilitato", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "account_changed"] },
  { id: 4725, descrizione: "Account disabilitato", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "account_changed"] },
  { id: 4767, descrizione: "Account sbloccato", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "account_changed"] },
  { id: 4704, descrizione: "Diritto utente assegnato", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "policy_changed"] },
  { id: 4705, descrizione: "Diritto utente tolto", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "policy_changed"] },
  { id: 4728, descrizione: "Membro aggiunto a un gruppo globale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 4732, descrizione: "Membro aggiunto a un gruppo locale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 4756, descrizione: "Membro aggiunto a un gruppo universale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 4729, descrizione: "Membro tolto da un gruppo globale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 4733, descrizione: "Membro tolto da un gruppo locale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 4757, descrizione: "Membro tolto da un gruppo universale", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "windows_security_group_changed"] },
  { id: 1102, descrizione: "Registro di controllo cancellato", categoria: "log_tampering", livello: 12, gruppi: [...WIN, "audit_log_cleared"] },
  // Arricchimento del 29/10/2026 (Riccardo): attacchi al dominio, GPO, servizi, account, trust, malware.
  // 4662 solo con AccessMask 0x100 e i diritti di replica: un account che non è un DC chiede le password (DCSync).
  { id: 4662, descrizione: "Replica delle password chiesta da un account che non è un DC (DCSync)", categoria: "domain_attack", livello: 15, gruppi: [...WIN, "dcsync"] },
  // 4769 solo con cifratura RC4 e riuscito, servizi di utenti: ticket chiesti per rompere offline la password (Kerberoasting).
  { id: 4769, descrizione: "Ticket di servizio con cifratura debole RC4 (possibile Kerberoasting)", categoria: "domain_attack", livello: 8, gruppi: [...WIN, "kerberoasting"] },
  // 5136 solo l'aumento di versione di una GPO (una riga per modifica) o un cambio dei collegamenti (gPLink).
  { id: 5136, descrizione: "GPO modificata", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "policy_changed"] },
  { id: 5137, descrizione: "GPO creata", categoria: "privileged_change", livello: 8, gruppi: [...WIN, "policy_changed"] },
  { id: 5141, descrizione: "GPO eliminata", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "policy_changed"] },
  { id: 4697, descrizione: "Servizio installato sul DC", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "service_installed"] },
  { id: 7045, descrizione: "Servizio installato sul DC", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "service_installed"], registro: "System" },
  // 4738 solo se cambia un'impostazione a rischio (password senza scadenza, delega, SID History): il resto è rumore.
  { id: 4738, descrizione: "Account modificato", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "account_changed"] },
  { id: 4741, descrizione: "Account computer creato", categoria: "privileged_change", livello: 5, gruppi: [...WIN, "account_changed"] },
  { id: 4743, descrizione: "Account computer eliminato", categoria: "privileged_change", livello: 5, gruppi: [...WIN, "account_changed"] },
  { id: 4739, descrizione: "Criteri del dominio cambiati (password, blocco account)", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "policy_changed"] },
  { id: 4706, descrizione: "Trust con un altro dominio creato", categoria: "privileged_change", livello: 12, gruppi: [...WIN, "policy_changed"] },
  { id: 4707, descrizione: "Trust con un altro dominio rimosso", categoria: "privileged_change", livello: 10, gruppi: [...WIN, "policy_changed"] },
  { id: 4794, descrizione: "Password di ripristino del DC (DSRM) cambiata", categoria: "privileged_change", livello: 12, gruppi: [...WIN, "account_changed"] },
  { id: 1116, descrizione: "Defender: malware trovato sul DC", categoria: "malware", livello: 12, gruppi: [...WIN, "defender", "malware"], registro: "Defender" },
  { id: 1117, descrizione: "Defender: azione contro un malware sul DC", categoria: "malware", livello: 12, gruppi: [...WIN, "defender", "malware"], registro: "Defender" },
];

export function registroDi(def: DefinizioneEvento): RegistroDc {
  return def.registro ?? "Security";
}

/** Categorie che sono allarmi (coda e notifiche); login e logout riusciti no. */
export function eAllarme(categoria: string): boolean {
  return categoria !== "accesso" && categoria !== "uscita";
}

export function definizioneEvento(id: number): DefinizioneEvento | undefined {
  return EVENTI_DC.find((e) => e.id === id);
}

/**
 * Gruppi privilegiati per RID o SID noto: Domain Admins (512), Schema Admins (518), Enterprise
 * Admins (519), Group Policy Creator Owners (520), Administrators (544), Account/Server/Print/
 * Backup Operators (548/549/550/551). Per SID e non per nome: i nomi cambiano con la lingua.
 */
const RID_PRIVILEGIATI = ["-512", "-518", "-519", "-520"];
const SID_PRIVILEGIATI = new Set(["S-1-5-32-544", "S-1-5-32-548", "S-1-5-32-549", "S-1-5-32-550", "S-1-5-32-551"]);

export function gruppoPrivilegiato(sid: string | null | undefined): boolean {
  const s = (sid ?? "").trim().toUpperCase();
  if (!s) return false;
  return SID_PRIVILEGIATI.has(s) || (s.startsWith("S-1-5-21-") && RID_PRIVILEGIATI.some((r) => s.endsWith(r)));
}

/** Codici di stato NT di 4625 e 4776 in italiano: dicono perché l'accesso non è riuscito. */
const STATI_NT: Record<string, string> = {
  "0xc000006a": "password errata",
  "0xc0000064": "utente inesistente",
  "0xc0000234": "account bloccato",
  "0xc0000072": "account disabilitato",
  "0xc000006f": "fuori dall'orario consentito",
  "0xc0000070": "postazione non consentita",
  "0xc0000071": "password scaduta",
  "0xc0000193": "account scaduto",
  "0xc0000224": "password da cambiare",
  "0xc000015b": "tipo di accesso non concesso",
  "0xc0000133": "orologio non allineato col DC",
  "0xc000006d": "nome utente o password errati",
  "0xc0000371": "archivio locale degli account senza il segreto",
};

/** Codici d'errore Kerberos di 4771. */
const ERRORI_KERBEROS: Record<string, string> = {
  "0x6": "utente inesistente",
  "0x12": "account disabilitato, bloccato o scaduto",
  "0x17": "password scaduta",
  "0x18": "password errata",
  "0x25": "orologio non allineato col DC",
};

export function motivoFallimento(eventId: number, dati: Record<string, string>): string | null {
  const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase();
  if (eventId === 4771 || eventId === 4768) {
    const c = norm(eventId === 4768 ? dati.Status : dati.FailureCode);
    if (eventId === 4768 && (c === "0x0" || c === "")) return null;
    return c ? (ERRORI_KERBEROS[c] ?? `codice Kerberos ${c}`) : null;
  }
  if (eventId === 4625 || eventId === 4776) {
    // In 4625 il dettaglio sta in SubStatus; Status vale spesso «nome utente o password errati».
    const sub = norm(dati.SubStatus);
    const st = norm(dati.Status);
    const c = sub && sub !== "0x0" ? sub : st;
    return c ? (STATI_NT[c] ?? `stato ${c}`) : null;
  }
  return null;
}

/**
 * Impostazioni a rischio di 4738 (UserAccountControl), come le scrive Windows (%%20xx). Solo
 * queste fanno passare l'evento dal DC.
 */
export const UAC_A_RISCHIO: Record<string, string> = {
  "%%2082": "password non obbligatoria",
  "%%2089": "password senza scadenza",
  "%%2091": "delega senza vincoli",
  "%%2093": "solo cifratura DES",
  "%%2094": "Kerberos senza preautenticazione",
  "%%2096": "delega vincolata con transizione di protocollo",
};

/** Diritti di replica di 4662 (Properties): quelli che servono a DCSync. */
export const GUID_REPLICA = [
  "1131f6aa-9c07-11d1-f79f-00c04fc2dcd2",
  "1131f6ad-9c07-11d1-f79f-00c04fc2dcd2",
  "89e95b76-444d-4c62-991a-0facbeda640c",
];

/** I campi di EventData che servono: il resto non viaggia (meno byte dal DC). */
export const CAMPI_DATI = [
  "TargetUserName",
  "TargetDomainName",
  "TargetSid",
  "SubjectUserName",
  "MemberName",
  "MemberSid",
  "IpAddress",
  "WorkstationName",
  "Workstation",
  "LogonType",
  "Status",
  "SubStatus",
  "FailureCode",
  "TargetUserSid",
  "PrivilegeList",
  // Arricchimento 29/10: replica, GPO, servizi, Kerberos, account, trust, Defender.
  "Properties",
  "ObjectDN",
  "ObjectClass",
  "AttributeLDAPDisplayName",
  "ServiceName",
  "ServiceFileName",
  "ImagePath",
  "AccountName",
  "ServiceAccount",
  "TicketEncryptionType",
  "UserAccountControl",
  "AllowedToDelegateTo",
  "SidHistory",
  "DomainName",
  "Threat Name",
  "Path",
  "Detection User",
  "Action Name",
] as const;

/** Quanti eventi al massimo per DC e per giro: oltre si riprende al giro dopo. */
export const MASSIMO_PER_GIRO = 2000;
/** Prima lettura di un DC: quanto indietro si guarda. */
export const ORE_PRIMA_LETTURA = 24;

/**
 * Le XPath di un registro, una per `<Select>`: il registro degli eventi rifiuta una XPath con troppi
 * «or» (oltre una ventina di ID), e più Select dello stesso registro tornano comunque in ordine di
 * record. Gli ID semplici vanno a gruppi di 10; quelli con un filtro sui dati hanno la loro.
 * Con un cursore si riparte dal record dopo; senza, si guardano le ultime `ORE_PRIMA_LETTURA` ore.
 */
export function xpathRegistro(registro: RegistroDc, dopoRecord: number | null): string[] {
  const quando =
    dopoRecord != null && dopoRecord > 0
      ? `EventRecordID>${Math.floor(dopoRecord)}`
      : `TimeCreated[timediff(@SystemTime) <= ${ORE_PRIMA_LETTURA * 3_600_000}]`;
  const conFiltro = new Set([4776, 4624, 4634, 4662, 4769, 5136, 5137, 5141]);
  const semplici = EVENTI_DC.filter((e) => registroDi(e) === registro && !conFiltro.has(e.id)).map((e) => e.id);
  const out: string[] = [];
  for (let i = 0; i < semplici.length; i += 10) {
    const ids = semplici.slice(i, i + 10).map((id) => `EventID=${id}`).join(" or ");
    out.push(`*[System[(${ids}) and ${quando}]]`);
  }
  if (registro !== "Security") return out;
  const dato = (nome: string, op: string, v: string) => `Data[@Name='${nome}']${op}'${v}'`;
  out.push(
    // 4776 riuscito (Status 0x0) è la gran parte del traffico NTLM: si scarta sul DC.
    `*[System[EventID=4776 and ${quando}] and EventData[${dato("Status", "!=", "0x0")}]]`,
    `*[System[(EventID=4624 or EventID=4634) and ${quando}] and EventData[${dato("LogonType", "=", "2")} or ${dato("LogonType", "=", "10")}]]`,
    `*[System[EventID=4662 and ${quando}] and EventData[${dato("AccessMask", "=", "0x100")}]]`,
    `*[System[EventID=4769 and ${quando}] and EventData[${dato("TicketEncryptionType", "=", "0x17")} and ${dato("Status", "=", "0x0")}]]`,
    `*[System[EventID=5136 and ${quando}] and EventData[${dato("OperationType", "=", "%%14674")} and (${dato("AttributeLDAPDisplayName", "=", "versionNumber")} and ${dato("ObjectClass", "=", "groupPolicyContainer")} or ${dato("AttributeLDAPDisplayName", "=", "gPLink")})]]`,
    `*[System[(EventID=5137 or EventID=5141) and ${quando}] and EventData[${dato("ObjectClass", "=", "groupPolicyContainer")}]]`,
  );
  return out;
}

/** Le XPath del registro Sicurezza in una sola stringa (prove e lettura umana). */
export function xpathEventi(dopoRecord: number | null): string {
  return xpathRegistro("Security", dopoRecord).join(" or ");
}

// In XML basta proteggere & e <: «EventRecordID>N» resta leggibile.
const xmlEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** La QueryList di un registro per `Get-WinEvent -FilterXml`. */
export function queryListRegistro(registro: RegistroDc, dopoRecord: number | null): string {
  const log = REGISTRI_DC[registro].log;
  const sel = xpathRegistro(registro, dopoRecord).map((x) => `<Select Path="${log}">${xmlEsc(x)}</Select>`).join("");
  return `<QueryList><Query Id="0" Path="${log}">${sel}</Query></QueryList>`;
}

/**
 * Lo script per il DC: legge ogni registro dal suo cursore. Per ognuno dice anche il record più
 * vecchio e il più nuovo: se il più vecchio è oltre il cursore, il registro è girato prima che lo
 * leggessimo (eventi persi, si dice); se il più nuovo è sotto il cursore, il registro è stato
 * svuotato e si riparte. Un registro che sul DC non c'è (Defender spento) risulta «assente».
 */
export function scriptEventiDc(cursori: number | null | Partial<Record<RegistroDc, number | null>>, massimo = MASSIMO_PER_GIRO): string {
  const c: Partial<Record<RegistroDc, number | null>> = cursori != null && typeof cursori === "object" ? cursori : { Security: cursori };
  const campi = CAMPI_DATI.map((k) => `'${k}'`).join(",");
  const max = Math.max(1, Math.floor(massimo));
  const ps = (t: string) => t.replace(/'/g, "''");
  const chiamate = NOMI_REGISTRI.map(
    (r) => `$out += Leggi '${r}' '${ps(REGISTRI_DC[r].log)}' '${ps(queryListRegistro(r, c[r] ?? null))}'`,
  ).join("\n");
  return `
$ErrorActionPreference = 'Stop'
$campi = @(${campi})
$replica = @(${GUID_REPLICA.map((g) => `'${g}'`).join(",")})
$uac = @(${Object.keys(UAC_A_RISCHIO).map((k) => `'${k}'`).join(",")})
# Solo pscustomobject e tipi semplici: ConvertTo-Json di PowerShell 5.1 sui DC si rompe sulle liste generiche
# e hashtable annidate («Argument types do not match», DA-DC01 29/10/2026).
function Tieni($id, $d) {
  $u = [string]$d['TargetUserName']
  # I ticket dei computer (account con $) sono la gran parte dei 4768 e non dicono chi lavora: restano sul DC.
  if (($id -eq 4768 -or $id -eq 4624 -or $id -eq 4634) -and $u.EndsWith('$')) { return $false }
  if ($id -eq 4662) {
    $s = [string]$d['SubjectUserName']
    # I DC si replicano fra loro; Azure AD Connect (MSOL_) replica le password per mestiere.
    if ($s.EndsWith('$') -or $s.StartsWith('MSOL_')) { return $false }
    $p = ([string]$d['Properties']).ToLower()
    foreach ($g in $replica) { if ($p.Contains($g)) { return $true } }
    return $false
  }
  if ($id -eq 4769) {
    $n = [string]$d['ServiceName']
    return -not ($n.EndsWith('$') -or $n -like 'krbtgt*')
  }
  if ($id -eq 4738) {
    $f = [string]$d['UserAccountControl']
    foreach ($k in $uac) { if ($f.Contains($k)) { return $true } }
    $h = [string]$d['SidHistory']; $a = [string]$d['AllowedToDelegateTo']
    return (($h -ne '' -and $h -ne '-') -or ($a -ne '' -and $a -ne '-'))
  }
  return $true
}
function Leggi($nome, $log, $query) {
  $nuovo = $null; $vecchio = $null; $esaminato = $null; $errore = $null; $assente = $false
  $righe = @()
  # Il registro Sicurezza c'è sempre: se non si legge è un errore da dire, mai «assente».
  if ($nome -ne 'Security' -and -not (Get-WinEvent -ListLog $log -ErrorAction SilentlyContinue)) { $assente = $true }
  else {
    try { $nuovo = [long](Get-WinEvent -LogName $log -MaxEvents 1).RecordId } catch {}
    try { $vecchio = [long](Get-WinEvent -LogName $log -MaxEvents 1 -Oldest).RecordId } catch {}
    try {
      $ev = Get-WinEvent -FilterXml ([xml]$query) -Oldest -MaxEvents ${max} -ErrorAction Stop
      $righe = @(foreach ($e in $ev) {
        $esaminato = [long]$e.RecordId
        $x = [xml]$e.ToXml()
        $d = [ordered]@{}
        foreach ($n in $x.Event.EventData.Data) { if ($campi -contains [string]$n.Name) { $d[[string]$n.Name] = [string]$n.'#text' } }
        if (-not (Tieni $e.Id $d)) { continue }
        [pscustomobject]@{ r = [long]$e.RecordId; t = [string]$e.TimeCreated.ToUniversalTime().ToString('o'); id = [int]$e.Id; d = [pscustomobject]$d }
      })
    } catch {
      if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { $errore = [string]$_.Exception.Message }
    }
  }
  [pscustomobject]@{ registro = [string]$nome; nuovo = $nuovo; vecchio = $vecchio; esaminato = $esaminato; errore = $errore; assente = $assente; eventi = $righe }
}
$out = @()
${chiamate}
[pscustomobject]@{ registri = $out } | ConvertTo-Json -Compress -Depth 5
`.trim();
}

export interface EventoGrezzo {
  /** Registro da cui viene; di serie Sicurezza. */
  registro?: RegistroDc;
  record: number;
  quando: string;
  eventId: number;
  dati: Record<string, string>;
}

export interface RispostaRegistro {
  registro: RegistroDc;
  /** EventRecordID più recente del registro (null se non letto). */
  nuovo: number | null;
  /** EventRecordID più vecchio ancora nel registro. */
  vecchio: number | null;
  /** L'ultimo record esaminato, anche se scartato sul DC (ticket dei computer): il cursore riparte da lì. */
  esaminato: number | null;
  /** Errore della lettura sul DC (es. accesso negato al registro). */
  errore: string | null;
  /** Il registro sul DC non c'è (Defender disinstallato o spento). */
  assente: boolean;
  eventi: EventoGrezzo[];
}

/** La risposta del DC: il registro Sicurezza in testa (il suo errore ferma il DC), gli altri a parte. */
export interface RispostaDc extends RispostaRegistro {
  altri: RispostaRegistro[];
}

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function leggiRegistro(registro: RegistroDc, o: { nuovo?: unknown; vecchio?: unknown; esaminato?: unknown; errore?: unknown; assente?: unknown; eventi?: unknown }): RispostaRegistro {
  // PowerShell 5 scrive un elenco di un solo elemento come oggetto nudo.
  const lista = Array.isArray(o.eventi) ? o.eventi : o.eventi && typeof o.eventi === "object" ? [o.eventi] : [];
  const eventi: EventoGrezzo[] = [];
  for (const e of lista as Array<{ r?: unknown; t?: unknown; id?: unknown; d?: unknown }>) {
    const record = numero(e.r);
    const eventId = numero(e.id);
    if (record == null || eventId == null || typeof e.t !== "string") continue;
    const dati: Record<string, string> = {};
    if (e.d && typeof e.d === "object") {
      for (const [k, v] of Object.entries(e.d as Record<string, unknown>)) {
        if (typeof v === "string") dati[k] = v;
      }
    }
    eventi.push({ registro, record, quando: new Date(e.t).toISOString(), eventId, dati });
  }
  eventi.sort((a, b) => a.record - b.record);
  return {
    registro,
    nuovo: numero(o.nuovo),
    vecchio: numero(o.vecchio),
    esaminato: numero(o.esaminato),
    errore: typeof o.errore === "string" && o.errore.trim() ? o.errore.trim() : null,
    assente: o.assente === true,
    eventi,
  };
}

/** Dalla risposta di PowerShell (con BOM o rumore davanti) agli eventi. Lancia se non è JSON. */
export function leggiRispostaDc(raw: string): RispostaDc {
  const t = raw.trim();
  const inizio = t.indexOf("{");
  if (inizio < 0) throw new Error(`risposta del DC senza JSON: ${t.slice(0, 120)}`);
  const o = JSON.parse(t.slice(inizio)) as { registri?: unknown };
  // Risposta di un solo registro (script fino alla 0.9.933): è il registro Sicurezza.
  if (o.registri === undefined) return { ...leggiRegistro("Security", o as Record<string, unknown>), altri: [] };
  const voci = (Array.isArray(o.registri) ? o.registri : o.registri && typeof o.registri === "object" ? [o.registri] : []) as Array<Record<string, unknown>>;
  const registri = voci
    .filter((v) => typeof v.registro === "string" && (NOMI_REGISTRI as string[]).includes(v.registro))
    .map((v) => leggiRegistro(v.registro as RegistroDc, v));
  const sicurezza = registri.find((r) => r.registro === "Security");
  if (!sicurezza) throw new Error("risposta del DC senza il registro Sicurezza");
  return { ...sicurezza, altri: registri.filter((r) => r.registro !== "Security") };
}

/** Un evento pronto per l'archivio dei DC e per la coda della pagina. */
export interface EventoDc {
  dc: string;
  record: number;
  quando: string;
  eventId: number;
  categoria: string;
  livello: number;
  descrizione: string;
  /** Chi subisce: l'account che prova ad entrare, o quello modificato. */
  account: string | null;
  dominio: string | null;
  ip: string | null;
  postazione: string | null;
  motivo: string | null;
  /** Chi ha fatto la modifica (eventi di gestione degli account). */
  autore: string | null;
  gruppi: string[];
}

const vuoto = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t === "-" ? null : t;
};

/** «CN={GUID},CN=Policies,...» → «{GUID}»; «OU=Uffici,DC=...» → «OU=Uffici». */
function primoPezzoDn(dn: string | null): string | null {
  if (!dn) return null;
  const p = dn.split(/,(?=(?:CN|OU|DC)=)/i)[0] ?? dn;
  return p.replace(/^CN=/i, "");
}

/** Che cosa dire in più nella descrizione dei tipi aggiunti il 29/10. */
function dettaglioEvento(id: number, d: Record<string, string>): string | null {
  switch (id) {
    case 4769:
      return vuoto(d.ServiceName) ? `servizio ${vuoto(d.ServiceName)}` : null;
    case 5136:
      return vuoto(d.AttributeLDAPDisplayName)?.toLowerCase() === "gplink"
        ? `collegamenti cambiati su ${primoPezzoDn(vuoto(d.ObjectDN)) ?? "?"}`
        : primoPezzoDn(vuoto(d.ObjectDN));
    case 5137:
    case 5141:
      return primoPezzoDn(vuoto(d.ObjectDN));
    case 4697: {
      const n = vuoto(d.ServiceName);
      const f = vuoto(d.ServiceFileName);
      return n ? `${n}${f ? ` (${f.slice(0, 200)})` : ""}` : null;
    }
    case 7045: {
      const n = vuoto(d.ServiceName);
      const f = vuoto(d.ImagePath);
      return n ? `${n}${f ? ` (${f.slice(0, 200)})` : ""}` : null;
    }
    case 4738: {
      const uac = vuoto(d.UserAccountControl) ?? "";
      const parti = Object.entries(UAC_A_RISCHIO).filter(([k]) => uac.includes(k)).map(([, v]) => v);
      if (vuoto(d.SidHistory)) parti.push("SID History");
      if (vuoto(d.AllowedToDelegateTo)) parti.push(`delega verso ${vuoto(d.AllowedToDelegateTo)}`);
      return parti.length ? parti.join(", ") : null;
    }
    case 4706:
    case 4707:
      return vuoto(d.DomainName);
    case 1116:
    case 1117: {
      const minaccia = vuoto(d["Threat Name"]);
      const azione = id === 1117 ? vuoto(d["Action Name"]) : null;
      const percorso = vuoto(d.Path);
      return [minaccia, azione, percorso?.slice(0, 200)].filter(Boolean).join(" · ") || null;
    }
    default:
      return null;
  }
}

/** Da evento grezzo a evento della pagina; null per un ID fuori elenco. */
export function classificaEvento(dc: string, e: EventoGrezzo, self?: SelfIdentity): EventoDc | null {
  const def = definizioneEvento(e.eventId);
  if (!def) return null;
  const d = e.dati;
  const gruppo = e.eventId === 4728 || e.eventId === 4732 || e.eventId === 4756;
  const tolto = e.eventId === 4729 || e.eventId === 4733 || e.eventId === 4757;
  // Nelle modifiche ai gruppi TargetUserName è il gruppo e il membro sta in MemberName (DN) o MemberSid.
  const membro = vuoto(d.MemberName)?.match(/^CN=([^,]+)/i)?.[1] ?? vuoto(d.MemberName) ?? vuoto(d.MemberSid);
  const diritto = e.eventId === 4704 || e.eventId === 4705;
  const senzaAccount = new Set([5136, 5137, 5141, 4697, 7045, 4739, 4706, 4707, 4794]);
  const account = gruppo || tolto
    ? membro
    : e.eventId === 1102 || e.eventId === 4662
      ? vuoto(d.SubjectUserName)
      : diritto
        ? vuoto(d.TargetSid)
        : e.eventId === 1116 || e.eventId === 1117
          ? vuoto(d["Detection User"])
          : senzaAccount.has(e.eventId)
            ? null
            : vuoto(d.TargetUserName);
  const ip = normalizeIp(vuoto(d.IpAddress));
  // 4740: il «chiamante» (TargetDomainName) è la postazione da cui arrivano i tentativi.
  const postazione = vuoto(d.WorkstationName) ?? vuoto(d.Workstation) ?? (e.eventId === 4740 ? vuoto(d.TargetDomainName) : null);
  let livello = def.livello;
  let descrizione = def.descrizione;
  if (gruppo || tolto) {
    const nomeGruppo = vuoto(d.TargetUserName);
    if (nomeGruppo) descrizione = `${def.descrizione}: ${nomeGruppo}`;
    // Un'aggiunta a Domain Admins & co. si deve sapere subito.
    if (gruppo && gruppoPrivilegiato(d.TargetSid)) livello = 12;
  }
  let categoria: string = def.categoria;
  // 4768 non riuscito (utente inesistente, disabilitato, scaduto) è un accesso fallito.
  const stato4768 = (d.Status ?? "").trim().toLowerCase();
  if (e.eventId === 4768 && stato4768 && stato4768 !== "0x0") {
    categoria = "auth_failure";
    livello = 5;
    descrizione = "Kerberos: accesso al dominio rifiutato";
  }
  if (e.eventId === 4624 || e.eventId === 4634) {
    const tipo = (d.LogonType ?? "").trim();
    if (tipo === "2") descrizione = `${descrizione} (console)`;
    if (tipo === "10") descrizione = `${descrizione} (desktop remoto)`;
  }
  if ((e.eventId === 4704 || e.eventId === 4705) && vuoto(d.PrivilegeList)) descrizione = `${descrizione}: ${vuoto(d.PrivilegeList)}`;
  const dettaglio = dettaglioEvento(e.eventId, d);
  if (dettaglio) descrizione = `${descrizione}: ${dettaglio}`;
  // Le nostre sonde (WinRM, inventario) con una credenziale scaduta non sono un attacco.
  if (categoria === "auth_failure" && isSelfOrigin({ sourceIp: ip, targetUser: account }, self)) categoria = "self_probe";
  return {
    dc,
    record: chiaveRecord(e.registro ?? "Security", e.record),
    quando: e.quando,
    eventId: e.eventId,
    categoria,
    livello,
    descrizione,
    account,
    dominio: e.eventId === 4740 ? null : vuoto(d.TargetDomainName),
    ip,
    postazione,
    motivo: motivoFallimento(e.eventId, d),
    autore: def.categoria === "privileged_change" || e.eventId === 1102 || e.eventId === 4662 ? vuoto(d.SubjectUserName) : null,
    gruppi: def.gruppi,
  };
}

/**
 * Lo stesso evento nella forma della coda della pagina: un evento aperto per (DC, ID evento), come
 * Wazuh fa per (agent, regola). La regola si chiama «dc-<ID>», il nome dell'agent è il DC.
 */
export function comeAlert(e: EventoDc): NormalizedAlert {
  const dettaglio = e.motivo ? ` (${e.motivo})` : "";
  return {
    id: `${e.dc}#${e.record}`,
    timestamp: e.quando,
    agentId: `dc:${e.dc.toLowerCase()}`,
    agentName: e.dc,
    ruleId: `dc-${e.eventId}`,
    ruleLevel: e.livello,
    ruleDescription: `${e.descrizione}${e.categoria === "auth_failure" || e.categoria === "self_probe" ? dettaglio : ""}`,
    groups: e.gruppi,
    category: e.categoria,
    eventId: String(e.eventId),
    targetUser: e.account,
    sourceIp: e.ip,
    workstation: e.postazione,
    sourceSystem: "windows",
    accountKind: accountKind(e.account),
  };
}

/** Che cosa fare del cursore dopo una risposta del DC. */
export interface ProssimoCursore {
  record: number | null;
  /** Il registro è girato prima della lettura: quanti record non si sono potuti leggere (stima). */
  persi: number;
  /** Il registro è stato svuotato o ricreato: si è ripartiti dall'inizio. */
  ripartito: boolean;
}

export function prossimoCursore(cursore: number | null, r: Pick<RispostaRegistro, "nuovo" | "vecchio" | "esaminato" | "errore" | "eventi">): ProssimoCursore {
  const ultimoEvento = r.eventi.length ? r.eventi[r.eventi.length - 1]!.record : null;
  const ultimoLetto = ultimoEvento != null || r.esaminato != null ? Math.max(ultimoEvento ?? 0, r.esaminato ?? 0) : null;
  // Registro svuotato (1102) o DC rifatto: il più nuovo sta sotto il cursore.
  if (cursore != null && r.nuovo != null && r.nuovo < cursore) {
    return { record: ultimoLetto, persi: 0, ripartito: true };
  }
  const persi = cursore != null && r.vecchio != null && r.vecchio > cursore + 1 ? r.vecchio - cursore - 1 : 0;
  if (ultimoLetto != null) return { record: ultimoLetto, persi, ripartito: false };
  // Nessun evento che ci interessa: si avanza al più nuovo, così il giro dopo non rilegge lo stesso tratto.
  if (r.nuovo != null && (cursore == null || r.nuovo > cursore)) return { record: r.nuovo, persi, ripartito: false };
  return { record: cursore, persi, ripartito: false };
}
