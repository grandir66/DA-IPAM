/**
 * Eventi di sicurezza letti dai domain controller via WinRM, senza Wazuh (Riccardo, 29/10/2026).
 *
 * Dove non c'è l'agente Wazuh sui DC, la pagina «Alert sicurezza» resta vuota. L'appliance ha già
 * la credenziale WinRM del DC (sonda di AD Health): con quella legge da sola il registro Sicurezza,
 * filtrato sul DC con una XPath (arriva solo ciò che serve) e ripreso dall'ultimo EventRecordID.
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
  categoria: "auth_failure" | "privileged_change" | "log_tampering" | "accesso" | "uscita";
  /** Livello come quello di Wazuh: 12 notifica subito, sotto va nel riepilogo. */
  livello: number;
  /** Gruppi come quelli di Wazuh: tengono buono il filtro «sistema» dell'elenco. */
  gruppi: string[];
}

const WIN = ["windows", "windows_security", "dc_winrm"];

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
];

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
] as const;

/** Quanti eventi al massimo per DC e per giro: oltre si riprende al giro dopo. */
export const MASSIMO_PER_GIRO = 2000;
/** Prima lettura di un DC: quanto indietro si guarda. */
export const ORE_PRIMA_LETTURA = 24;

/**
 * La XPath del registro Sicurezza. Gli ID sono pochi e fissi; 4776 riuscito (Status 0x0) è la gran
 * parte del traffico NTLM e si scarta sul DC. Con un cursore si riparte dal record dopo; senza, si
 * guardano le ultime `ORE_PRIMA_LETTURA` ore.
 */
export function xpathEventi(dopoRecord: number | null): string {
  const conFiltro = new Set([4776, 4624, 4634]);
  const ids = EVENTI_DC.filter((e) => !conFiltro.has(e.id))
    .map((e) => `EventID=${e.id}`)
    .join(" or ");
  const quando =
    dopoRecord != null && dopoRecord > 0
      ? `EventRecordID>${Math.floor(dopoRecord)}`
      : `TimeCreated[timediff(@SystemTime) <= ${ORE_PRIMA_LETTURA * 3_600_000}]`;
  return [
    `*[System[(${ids}) and ${quando}]]`,
    `*[System[EventID=4776 and ${quando}] and EventData[Data[@Name='Status']!='0x0']]`,
    `*[System[(EventID=4624 or EventID=4634) and ${quando}] and EventData[Data[@Name='LogonType']='2' or Data[@Name='LogonType']='10']]`,
  ].join(" or ");
}

/**
 * Lo script per il DC. Dice anche il record più vecchio e il più nuovo del registro: se il più
 * vecchio è oltre il cursore, il registro è girato prima che lo leggessimo (eventi persi, si dice);
 * se il più nuovo è sotto il cursore, il registro è stato svuotato e si riparte.
 */
export function scriptEventiDc(dopoRecord: number | null, massimo = MASSIMO_PER_GIRO): string {
  const xpath = xpathEventi(dopoRecord).replace(/'/g, "''");
  const campi = CAMPI_DATI.map((c) => `'${c}'`).join(",");
  return `
$ErrorActionPreference = 'Stop'
$campi = @(${campi})
$nuovo = $null; $vecchio = $null
try { $nuovo = (Get-WinEvent -LogName Security -MaxEvents 1).RecordId } catch {}
try { $vecchio = (Get-WinEvent -LogName Security -MaxEvents 1 -Oldest).RecordId } catch {}
$righe = New-Object System.Collections.Generic.List[object]
$esaminato = $null
$errore = $null
try {
  $ev = Get-WinEvent -LogName Security -FilterXPath '${xpath}' -Oldest -MaxEvents ${Math.max(1, Math.floor(massimo))} -ErrorAction Stop
  foreach ($e in $ev) {
    $esaminato = $e.RecordId
    $x = [xml]$e.ToXml()
    $d = @{}
    foreach ($n in $x.Event.EventData.Data) { if ($campi -contains $n.Name) { $d[$n.Name] = [string]$n.'#text' } }
    # I ticket dei computer (account con $) sono la gran parte dei 4768 e non dicono chi lavora: restano sul DC.
    if (($e.Id -eq 4768 -or $e.Id -eq 4624 -or $e.Id -eq 4634) -and ([string]$d['TargetUserName']).EndsWith('$')) { continue }
    $righe.Add(@{ r = $e.RecordId; t = $e.TimeCreated.ToUniversalTime().ToString('o'); id = $e.Id; d = $d })
  }
} catch {
  if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { $errore = $_.Exception.Message }
}
@{ nuovo = $nuovo; vecchio = $vecchio; esaminato = $esaminato; errore = $errore; eventi = @($righe) } | ConvertTo-Json -Compress -Depth 4
`.trim();
}

export interface EventoGrezzo {
  record: number;
  quando: string;
  eventId: number;
  dati: Record<string, string>;
}

export interface RispostaDc {
  /** EventRecordID più recente del registro Sicurezza (null se non letto). */
  nuovo: number | null;
  /** EventRecordID più vecchio ancora nel registro. */
  vecchio: number | null;
  /** L'ultimo record esaminato, anche se scartato sul DC (ticket dei computer): il cursore riparte da lì. */
  esaminato: number | null;
  /** Errore della lettura sul DC (es. accesso negato al registro). */
  errore: string | null;
  eventi: EventoGrezzo[];
}

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Dalla risposta di PowerShell (con BOM o rumore davanti) agli eventi. Lancia se non è JSON. */
export function leggiRispostaDc(raw: string): RispostaDc {
  const t = raw.trim();
  const inizio = t.indexOf("{");
  if (inizio < 0) throw new Error(`risposta del DC senza JSON: ${t.slice(0, 120)}`);
  const o = JSON.parse(t.slice(inizio)) as { nuovo?: unknown; vecchio?: unknown; esaminato?: unknown; errore?: unknown; eventi?: unknown };
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
    eventi.push({ record, quando: new Date(e.t).toISOString(), eventId, dati });
  }
  eventi.sort((a, b) => a.record - b.record);
  return {
    nuovo: numero(o.nuovo),
    vecchio: numero(o.vecchio),
    esaminato: numero(o.esaminato),
    errore: typeof o.errore === "string" && o.errore.trim() ? o.errore.trim() : null,
    eventi,
  };
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
  const account = gruppo || tolto ? membro : e.eventId === 1102 ? vuoto(d.SubjectUserName) : diritto ? vuoto(d.TargetSid) : vuoto(d.TargetUserName);
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
  // Le nostre sonde (WinRM, inventario) con una credenziale scaduta non sono un attacco.
  if (categoria === "auth_failure" && isSelfOrigin({ sourceIp: ip, targetUser: account }, self)) categoria = "self_probe";
  return {
    dc,
    record: e.record,
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
    autore: def.categoria === "privileged_change" || e.eventId === 1102 ? vuoto(d.SubjectUserName) : null,
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

export function prossimoCursore(cursore: number | null, r: RispostaDc): ProssimoCursore {
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
