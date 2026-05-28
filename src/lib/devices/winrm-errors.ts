/**
 * Classificazione errori WinRM/WMI e formattazione messaggi italiani.
 *
 * Obiettivo: distinguere a colpo d'occhio "porta chiusa" da "auth fallita" da
 * "Kerberos rotto" da "timeout vero". I messaggi generici tipo "Timeout: il
 * dispositivo non ha risposto" nascondono root cause diverse che richiedono
 * azioni diverse sul target.
 */

export type WinrmErrorCode =
  | "TCP_CLOSED"             // RST / no listener su 5985 e 5986
  | "TCP_TIMEOUT"             // nessuna risposta TCP (host irraggiungibile o firewall drop)
  | "AUTH_REJECTED"           // 401 / credentials were rejected / logon failure
  | "KERBEROS_FAILED"         // kinit fallito o ticket non accettato
  | "KERBEROS_ONLY"           // server accetta solo Kerberos, gli altri trasporti non vanno
  | "BASIC_DISABLED"          // Basic auth rifiutata (AllowUnencrypted=false)
  | "WSMAN_FAULT"             // 500 / WSManFault con payload strutturato
  | "PYWINRM_MISSING"         // venv senza pywinrm
  | "BRIDGE_TIMEOUT"          // bridge Python superato il timeout TS
  | "UNKNOWN";

export interface WinrmErrorInfo {
  code: WinrmErrorCode;
  message: string;     // messaggio italiano user-facing
  hint?: string;       // azione consigliata (opzionale)
  transport?: string;  // ultimo trasporto tentato (se noto)
  original?: string;   // testo originale per debug/log
}

/**
 * Classifica un messaggio d'errore (qualunque sia la sorgente) in una classe
 * stabile + messaggio italiano.
 *
 * Il bridge Python già produce messaggi parlanti; questa funzione li riconosce
 * via fingerprint e li mappa su codici. Per errori non riconosciuti restituisce
 * UNKNOWN preservando il testo originale.
 */
export function classifyWinrmError(raw: string): WinrmErrorInfo {
  const msg = (raw || "").trim();
  const lower = msg.toLowerCase();

  if (!msg) {
    return { code: "UNKNOWN", message: "Errore WinRM senza dettagli.", original: msg };
  }

  if (lower.includes("modulo python pywinrm") || lower.includes("pywinrm")) {
    return {
      code: "PYWINRM_MISSING",
      message: "Modulo Python pywinrm assente sul server DA-IPAM.",
      hint: "Esegui scripts/install.sh oppure: ~/.da-invent-venv/bin/pip install pywinrm requests-ntlm requests-credssp",
      original: msg,
    };
  }

  if (lower.includes("kerberos fallito") || lower.includes("kinit")) {
    return {
      code: "KERBEROS_FAILED",
      message: "Kerberos non riuscito (kinit/ticket).",
      hint: "Verifica username nel formato user@DOMAIN.FQDN, password, DC raggiungibile sulla porta 88.",
      original: msg,
    };
  }

  if (lower.includes("accetta solo kerberos") || lower.includes("metodi: negotiate, kerberos")) {
    return {
      code: "KERBEROS_ONLY",
      message: "Il target WinRM accetta solo Kerberos.",
      hint: "Configura un realm AD valido e credenziali user@DOMAIN.FQDN oppure abilita NTLM/Basic sul target.",
      original: msg,
    };
  }

  if (
    lower.includes("credenziali rifiutate") ||
    lower.includes("401") ||
    lower.includes("credentials were rejected") ||
    lower.includes("authorization failed") ||
    lower.includes("access is denied") ||
    lower.includes("logon failure")
  ) {
    return {
      code: "AUTH_REJECTED",
      message: "Credenziali rifiutate da WinRM (401).",
      hint: "Verifica formato utente (user@dominio.fqdn per AD, DOMINIO\\\\utente per NTLM, .\\\\utente per account locale) e appartenenza al gruppo 'Utenti gestione remota' o Administrators.",
      original: msg,
    };
  }

  if (lower.includes("basic auth rifiutata") || (lower.includes("basic") && lower.includes("allowunencrypted"))) {
    return {
      code: "BASIC_DISABLED",
      message: "Basic auth non abilitata sul target.",
      hint: "Sul target: Set-Item WSMan:\\\\localhost\\\\Service\\\\Auth\\\\Basic $true ; Set-Item WSMan:\\\\localhost\\\\Service\\\\AllowUnencrypted $true ; Restart-Service WinRM",
      original: msg,
    };
  }

  if (lower.includes("connessione rifiutata") || lower.includes("econnrefused") || lower.includes("connection refused")) {
    return {
      code: "TCP_CLOSED",
      message: "Porte WinRM 5985/5986 chiuse sul target.",
      hint: "Sul target Windows (PowerShell admin): winrm quickconfig -force ; verifica firewall regola 'Windows Remote Management (HTTP-In)' attiva su tutti i profili.",
      original: msg,
    };
  }

  if (lower.includes("bridge_timeout") || lower.includes("etimedout") || lower.includes("timeout")) {
    return {
      code: "TCP_TIMEOUT",
      message: "Nessuna risposta dal target sulle porte WinRM (firewall drop o host irraggiungibile).",
      hint: "Conferma che il target risponda al ping, che 5985/5986 siano aperte (test: nc -vz IP 5985), e che il firewall Windows includa il profilo Public se la LAN è classificata come tale.",
      original: msg,
    };
  }

  if (lower.includes("wsmanfault") || lower.includes("wsman fault") || lower.includes("500") && lower.includes("wsman")) {
    return {
      code: "WSMAN_FAULT",
      message: "WinRM raggiunto ma configurazione del servizio errata (WSManFault).",
      hint: "Sul target: winrm quickconfig -force ; winrm enumerate winrm/config/Listener (verifica listener su tutti gli IP).",
      original: msg,
    };
  }

  return {
    code: "UNKNOWN",
    message: msg.length > 240 ? msg.slice(0, 240) + "…" : msg,
    original: msg,
  };
}

/**
 * Formatta WinrmErrorInfo in stringa user-facing (per UI/log).
 * Esempio: "[TCP_CLOSED] Porte WinRM 5985/5986 chiuse sul target. → Sul target Windows ..."
 */
export function formatWinrmError(info: WinrmErrorInfo): string {
  const head = `[${info.code}] ${info.message}`;
  return info.hint ? `${head} → ${info.hint}` : head;
}
