/**
 * Catalogo unico dei diritti che DA-IPAM chiede a Windows (Task 6, 04/11/2026).
 *
 * Riccardo: «deve essere chiara la definizione dei diritti dell'utente necessari per le scansioni»,
 * «nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa per la sicurezza del dominio».
 * Prima il testo stava in tre guide che si contraddicevano (Administrators sul DC per WinRM, Domain
 * Admins «necessario», una password d'esempio in chiaro). Ora una sola definizione, in due famiglie:
 *
 *  - «utente delle scansioni»: l'account che entra su PC e server (WMI, WinRM, software e patch);
 *  - «sicurezza del dominio»: ciò che serve sui domain controller (AD, eventi, audit, DHCP).
 *
 * Nei comandi i nomi d'esempio sono due, come i due account della regola qui sotto: `svc-ipam` per le scansioni,
 * `svc-ipam-dc` per la sicurezza del dominio.
 *
 * Fonte dei diritti sui DC: docs/MANUALE-EVENTI-DC.md. Le guide (`ad-setup-guide-dialog`,
 * `winrm-setup-guide-dialog`, `guida-audit-dc`, la pagina Sicurezza del dominio) e i manuali leggono
 * di qui; la pagina dei diritti del Task 8 usa lo stesso elenco. Il modulo è puro: niente database,
 * niente import di server, perché lo importano anche i componenti client.
 */

export type FamigliaDiritti = "utente_scansioni" | "sicurezza_dominio";

export interface DirittoRichiesto {
  id: string;
  famiglia: FamigliaDiritti;
  /** Cosa si ottiene. */
  funzione: string;
  /** Cosa fare, una riga. */
  abilitare: string;
  /** PC e server | DC | dominio. */
  dove: string;
  /** Senza questo la funzione non parte. Per WMI e WinRM basta una delle due strade. */
  obbligatorio: boolean;
  /** PowerShell per l'IT del cliente. */
  comandoIt?: string;
}

/** Nomi dei gruppi Windows: scritti qui e basta, le guide li leggono da qui. */
export const GRUPPI = {
  amministratoriLocali: "Administrators",
  lettoriRegistri: "Event Log Readers",
  gestioneRemota: "Remote Management Users",
  dhcpAdmin: "DHCP Administrators",
  domainAdmins: "Domain Admins",
} as const;

export const FAMIGLIE_DIRITTI: Readonly<Record<FamigliaDiritti, { nome: string; conArticolo: string; accountEsempio: string; descrizione: string }>> = {
  utente_scansioni: {
    nome: "Utente delle scansioni",
    conArticolo: "l'utente delle scansioni",
    accountEsempio: "svc-ipam",
    descrizione: "L'account con cui DA-IPAM entra su PC e server per inventario, software e patch.",
  },
  sicurezza_dominio: {
    nome: "Sicurezza del dominio",
    conArticolo: "la sicurezza del dominio",
    accountEsempio: "svc-ipam-dc",
    descrizione: "Ciò che si abilita sui domain controller e nel dominio perché DA-IPAM legga utenti, eventi e DHCP.",
  },
};

export const REGOLA_ACCOUNT_SEPARATI = `L'account delle scansioni (${GRUPPI.amministratoriLocali} locale sui PC e server) è separato da quello di sola lettura sui domain controller: chi legge gli eventi non deve poter amministrare i computer.`;

/** Regole che valgono per tutte le voci. Scritte una volta, qui. */
export const REGOLE_DIRITTI: readonly string[] = [
  `Mai ${GRUPPI.domainAdmins}: nessuna funzione di DA-IPAM lo richiede, e un account con quel potere in giro è un rischio per tutto il dominio.`,
  REGOLA_ACCOUNT_SEPARATI,
  `Sui domain controller ${GRUPPI.amministratoriLocali} non serve: bastano i gruppi dell'elenco, tutti non amministrativi.`,
];

const CREA_ACCOUNT = `# Su un DC o da una macchina con gli strumenti di Active Directory.
# La password si digita al momento: non sta scritta in nessun comando.
Import-Module ActiveDirectory
$password = Read-Host "Password di svc-ipam-dc" -AsSecureString
New-ADUser \`
  -Name "svc-ipam-dc" \`
  -SamAccountName "svc-ipam-dc" \`
  -UserPrincipalName "svc-ipam-dc@dominio.fqdn" \`
  -AccountPassword $password \`
  -PasswordNeverExpires $true \`
  -Enabled $true \`
  -Description "Account di DA-IPAM"`;

const ABILITA_WINRM_E_ADMIN = `# Sul PC o server, PowerShell come amministratore
Enable-PSRemoting -Force
Add-LocalGroupMember -Group "${GRUPPI.amministratoriLocali}" -Member "DOMINIO\\svc-ipam"`;

export const DIRITTI: readonly DirittoRichiesto[] = [
  {
    id: "inventario_wmi",
    famiglia: "utente_scansioni",
    funzione: "Inventario via WMI",
    abilitare: `${GRUPPI.amministratoriLocali} locale + regola firewall WMI`,
    dove: "PC e server",
    obbligatorio: false,
    comandoIt: `# Sul PC o server, PowerShell come amministratore
Add-LocalGroupMember -Group "${GRUPPI.amministratoriLocali}" -Member "DOMINIO\\svc-ipam"
# Regola firewall «Windows Management Instrumentation (WMI)», valida con Windows in qualsiasi lingua
Enable-NetFirewallRule -Group "@FirewallAPI.dll,-34251"`,
  },
  {
    id: "inventario_winrm",
    famiglia: "utente_scansioni",
    funzione: "Inventario via WinRM",
    abilitare: `${GRUPPI.amministratoriLocali} locale + servizio WinRM attivo`,
    dove: "PC e server",
    obbligatorio: false,
    comandoIt: ABILITA_WINRM_E_ADMIN,
  },
  {
    id: "software_patch",
    famiglia: "utente_scansioni",
    funzione: "Software e patch",
    abilitare: `${GRUPPI.amministratoriLocali} locale + WinRM`,
    dove: "PC e server",
    obbligatorio: false,
    comandoIt: ABILITA_WINRM_E_ADMIN,
  },
  {
    id: "account_dominio",
    famiglia: "sicurezza_dominio",
    funzione: "Computer, utenti, gruppi",
    abilitare: "Utente di dominio normale",
    dove: "dominio",
    obbligatorio: true,
    comandoIt: CREA_ACCOUNT,
  },
  {
    id: "eventi_dc",
    famiglia: "sicurezza_dominio",
    funzione: "Eventi di sicurezza dei DC",
    abilitare: `${GRUPPI.lettoriRegistri} + ${GRUPPI.gestioneRemota}`,
    dove: "DC",
    obbligatorio: false,
    comandoIt: `# Sul DC, PowerShell come amministratore del dominio (lo fa l'IT, non l'account di DA-IPAM)
Add-ADGroupMember -Identity "${GRUPPI.lettoriRegistri}" -Members "svc-ipam-dc"
Add-ADGroupMember -Identity "${GRUPPI.gestioneRemota}" -Members "svc-ipam-dc"`,
  },
  {
    id: "audit_gpo",
    famiglia: "sicurezza_dominio",
    funzione: "Registrazione degli eventi",
    abilitare: "GPO di audit (Configura-Audit-DC.ps1)",
    dove: "DC",
    obbligatorio: false,
    comandoIt: `# Sul DC, PowerShell come amministratore del dominio
.\\Configura-Audit-DC.ps1 -Prova                 # dice cosa farebbe
.\\Configura-Audit-DC.ps1 -Account svc-ipam-dc      # applica`,
  },
  {
    id: "dhcp",
    famiglia: "sicurezza_dominio",
    funzione: "DHCP",
    abilitare: `${GRUPPI.dhcpAdmin} + ${GRUPPI.gestioneRemota}`,
    dove: "DC",
    obbligatorio: false,
    comandoIt: `# Sul DC con il ruolo DHCP, PowerShell come amministratore del dominio
# Crea i gruppi DHCP se il server è appena stato promosso
Add-DhcpServerSecurityGroup
Restart-Service DHCPServer
Add-ADGroupMember -Identity "${GRUPPI.dhcpAdmin}" -Members "svc-ipam-dc"
Add-ADGroupMember -Identity "${GRUPPI.gestioneRemota}" -Members "svc-ipam-dc"`,
  },
];

/** Sola lettura, sul DC, per l'IT del cliente: gli accessi falliti delle ultime 24 ore. Gli stessi eventi di «Sicurezza del dominio». */
export const COMANDO_LEGGI_FALLIMENTI = `# Sul DC, PowerShell come amministratore. Sola lettura: non cambia niente.
Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625, 4771, 4776, 4740; StartTime = (Get-Date).AddDays(-1) } -MaxEvents 200 |
  Select-Object TimeCreated, Id, @{ n = 'Evento'; e = { ($_.Message -split [Environment]::NewLine)[0] } } |
  Format-Table -AutoSize -Wrap`;

/** Sola lettura, su ogni DC: dice se le voci di audit degli accessi sono accese. */
export const COMANDO_VERIFICA_AUDIT = `# Sul DC, PowerShell come amministratore. Sola lettura.
auditpol /get /category:*
wevtutil gl Security`;

export function dirittiDi(famiglia: FamigliaDiritti): readonly DirittoRichiesto[] {
  return DIRITTI.filter((d) => d.famiglia === famiglia);
}

/** Una voce per id. Un id sbagliato è un errore di programmazione: si dice, non si ripiega. */
export function dirittoPerId(id: string): DirittoRichiesto {
  const d = DIRITTI.find((x) => x.id === id);
  if (!d) throw new Error(`Diritto sconosciuto: ${id}`);
  return d;
}
