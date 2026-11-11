/**
 * Frasi semplici per i titoli degli avvisi più frequenti.
 * Misura sul cliente 70791, 11/11/2026, solo diagnostic = 0 (210 righe su 248):
 * i venti titoli qui sotto, dal più frequente.
 */

const FRASI: Record<string, string> = {
  "sshd: brute force trying to get access to the system. Non existent user.": "Tentativi ripetuti di accesso con un utente inesistente",
  "sshd: authentication failed.": "Accesso da remoto non riuscito",
  "PAM: User login failed.": "Accesso non riuscito",
  "sshd: Attempt to login using a non-existent user": "Tentativo di accesso con un utente inesistente",
  "Logon Failure - Unknown user or bad password": "Accesso non riuscito: utente sconosciuto o password errata",
  "syslog: User authentication failure.": "Accesso non riuscito",
  "New user added to the system.": "Nuovo utente sul sistema",
  "New group added to the system.": "Nuovo gruppo sul sistema",
  "PAM: Multiple failed logins in a small period of time.": "Troppi accessi falliti in poco tempo",
  "Multiple Windows Logon Failures": "Troppi accessi Windows falliti",
  "User account locked out (multiple login errors)": "Account bloccato dopo troppi tentativi",
  "unix_chkpwd: Password check failed.": "Password non corretta",
  "Windows Audit Policy changed": "Cambiata la politica di controllo di Windows",
  "User account changed": "Account modificato",
  "Proxmox VE authentication failed.": "Accesso a Proxmox non riuscito",
  "sshd: brute force trying to get access to the system. Authentication failed.": "Tentativi ripetuti di accesso da remoto",
  "Windows DC Logon Failure": "Accesso al dominio non riuscito",
  "User account enabled or created": "Account creato o riattivato",
  "Maximum authentication attempts exceeded.": "Troppi tentativi di accesso",
  "NTLM: convalida delle credenziali non riuscita (utente inesistente)": "Accesso non riuscito: utente inesistente",
};

/** Frase semplice per i titoli più frequenti; se il titolo non è in tabella restituisce il titolo così com'è. */
export function fraseAvviso(titoloOriginale: string): string {
  return FRASI[titoloOriginale] ?? titoloOriginale;
}
