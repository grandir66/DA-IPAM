/**
 * Human-facing catalog for AD Health findings: Italian title, why, remediation.
 * Fallback used when a rule id is missing (forward-compatible).
 */

import type { HealthAxis, HealthFinding } from "./types";

export interface RuleGuide {
  /** Short Italian title for UI (overrides English engine title when present). */
  titleIt: string;
  /** Why this matters (1–2 sentences). */
  why: string;
  /** Concrete remediation hint. */
  fix: string;
}

const CATALOG: Record<string, RuleGuide> = {
  "DA-S-InactiveUser": {
    titleIt: "Utenti abilitati inattivi",
    why: "Account abilitati che non accedono da tempo restano vettori di accesso non monitorati.",
    fix: "Disabilita o elimina gli account non più usati; verifica se sono service account legittimi.",
  },
  "DA-S-InactiveComputer": {
    titleIt: "Computer abilitati inattivi",
    why: "Macchine stale in dominio possono essere riprese o riusate senza controllo.",
    fix: "Disabilita i computer non più in uso e rimuovili dal dominio dopo conferma inventario.",
  },
  "DA-S-ObsoleteOS": {
    titleIt: "Sistemi operativi obsoleti",
    why: "OS fuori supporto non ricevono patch e ampliano la superficie di attacco.",
    fix: "Pianifica upgrade o isolamento di rete; rimuovi dal dominio se dismessi.",
  },
  "DA-S-PwdNeverExpires": {
    titleIt: "Password che non scadono",
    why: "Password eterne su utenti umani aumentano il rischio di credential stuffing / riuso.",
    fix: "Rimuovi DONT_EXPIRE_PASSWORD salvo service account documentati; usa gMSA dove possibile.",
  },
  "DA-S-PwdNotRequired": {
    titleIt: "Password non obbligatoria",
    why: "Account con PASSWD_NOTREQD possono avere password vuota o debolissima.",
    fix: "Rimuovi il flag e imposta una password forte; indaga come è stato impostato.",
  },
  "DA-S-NoPreAuth": {
    titleIt: "Pre-autenticazione Kerberos disabilitata",
    why: "Senza pre-auth l’account è esposto ad AS-REP roasting.",
    fix: "Rimuovi DONT_REQ_PREAUTH da tutti gli utenti non strettamente necessari.",
  },
  "DA-S-ReversiblePwd": {
    titleIt: "Crittografia password reversibile",
    why: "Le password possono essere recuperate in chiaro dal dominio.",
    fix: "Disabilita ENCRYPTED_TEXT_PWD_ALLOWED e forza cambio password.",
  },
  "DA-S-DcPwdAge": {
    titleIt: "Password macchina DC troppo vecchia",
    why: "Il secret del computer account DC dovrebbe ruotare; età eccessiva indica problemi di sync/secure channel.",
    fix: "Verifica secure channel e salute replica; lascia che la password macchina ruoti normalmente.",
  },
  "DA-P-DomainAdminsCount": {
    titleIt: "Troppi Domain Admins",
    why: "Ogni DA aggiuntivo aumenta l’impatto di un account compromesso.",
    fix: "Riduci i membri (diretti e nested) al minimo operativo; usa gruppi meno privilegiati per i task quotidiani.",
  },
  "DA-P-AdminPwdAge": {
    titleIt: "Password Domain Admin vecchie",
    why: "Password admin non ruotate restano utili a lungo dopo un leak.",
    fix: "Ruota le password DA; preferisci PAM / tiering e account just-in-time.",
  },
  "DA-P-UnconstrainedDelegation": {
    titleIt: "Delega non vincolata",
    why: "Un host con unconstrained delegation può impersonare utenti (incluso admin) verso altri servizi.",
    fix: "Rimuovi TRUSTED_FOR_DELEGATION; passa a constrained o RBCD mirata.",
  },
  "DA-P-Kerberoastable": {
    titleIt: "Utenti Kerberoastable",
    why: "Utenti con SPN espongono ticket TGS che possono essere crackati offline.",
    fix: "Password lunghe/random o gMSA; rimuovi SPN non necessari; metti account sensibili in Protected Users.",
  },
  "DA-P-ConstrainedDelegation": {
    titleIt: "Delega vincolata (constrained)",
    why: "AllowedToDelegateTo consente impersonazione verso servizi specifici — utile ma abusabile.",
    fix: "Rivedi i target SPN; limita agli host/servizi strettamente necessari.",
  },
  "DA-P-ProtocolTransition": {
    titleIt: "Protocol transition (S4U2Self)",
    why: "TRUSTED_TO_AUTH_FOR_DELEGATION permette di ottenere ticket senza password utente.",
    fix: "Disabilita protocol transition se non indispensabile; preferisci RBCD controllata.",
  },
  "DA-P-RBCD": {
    titleIt: "RBCD (resource-based constrained delegation)",
    why: "Chi controlla msDS-AllowedToActOnBehalfOf può farsi impersonare verso quella risorsa.",
    fix: "Rimuovi ACL/attributi non attesi; verifica chi ha scritto la configurazione.",
  },
  "DA-P-AdminCountOrphan": {
    titleIt: "adminCount=1 orfani",
    why: "Utenti con adminCount senza essere più in gruppi privilegiati restano protetti da SDProp ma indicano ex-admin.",
    fix: "Verifica se devono restare protetti; ripulisci adminCount/ACL AdminSDHolder se non più admin.",
  },
  "DA-P-ProtectedUsersGap": {
    titleIt: "Domain Admins fuori da Protected Users",
    why: "Protected Users mitiga NTLM/cred caching per account sensibili.",
    fix: "Aggiungi i DA (e account tier-0) a Protected Users dopo test di compatibilità.",
  },
  "DA-P-NestedIntoDomainAdmins": {
    titleIt: "Membership nested in Domain Admins",
    why: "Gruppi intermedi nascondono chi è davvero DA e complicano l’audit.",
    fix: "Rimuovi nesting non necessari; preferisci membership diretta e documentata.",
  },
  "DA-P-OperatorsPopulated": {
    titleIt: "Gruppi Operators popolati",
    why: "Account Operators / Server Operators / Backup Operators hanno privilegi elevati storici.",
    fix: "Svuota i gruppi Operators se non usati; assegna diritti mirati via GPO/ACL.",
  },
  "DA-P-DnsAdminsPopulated": {
    titleIt: "DnsAdmins popolato",
    why: "DnsAdmins può portare a privilege escalation sul DNS/DC in scenari noti.",
    fix: "Limita i membri; evita account quotidiani in DnsAdmins.",
  },
  "DA-P-GpoCreatorsPopulated": {
    titleIt: "Group Policy Creator Owners popolato",
    why: "Chi crea GPO può introdurre policy persistenti nel dominio.",
    fix: "Riduci i membri; gestisci GPO via processi controllati.",
  },
  "DA-P-EmptyProtectedUsers": {
    titleIt: "Protected Users vuoto",
    why: "Esistono Domain Admins ma nessuno è in Protected Users: protezione Kerberos non usata.",
    fix: "Popola Protected Users con account tier-0 dopo validazione applicazioni.",
  },
  "DA-P-DCSyncRights": {
    titleIt: "Diritti DCSync non attesi",
    why: "Replica directory (Get-Changes/All) consente di estrarre hash come un DC.",
    fix: "Rimuovi i diritti di replica da account/servizi non Domain Controllers / non ufficiali.",
  },
  "DA-P-DangerousAcl": {
    titleIt: "ACL pericolose su oggetti AD",
    why: "Controllo totale / WriteDacl / reset password su oggetti consente takeover laterale.",
    fix: "Rivedi la sezione Analisi ACL; rimuovi ACE non necessarie soprattutto su OU/utenti/gruppi.",
  },
  "DA-T-TrustInventory": {
    titleIt: "Trust di dominio presenti",
    why: "I trust ampliano il perimetro di autenticazione verso altri domini/foreste.",
    fix: "Verifica che ogni trust sia ancora necessario e con direzione/attributi corretti.",
  },
  "DA-T-SidFilteringOff": {
    titleIt: "SID filtering disabilitato su trust esterno",
    why: "Senza quarantena, SID History da forest esterne può elevare privilegi nel dominio.",
    fix: "Abilita SID filtering (QUARANTINED_DOMAIN) sui trust esterni dove possibile.",
  },
  "DA-A-KrbtgtAge": {
    titleIt: "Password krbtgt vecchia",
    why: "krbtgt firma i TGT; se compromessa e non ruotata, i golden ticket restano validi a lungo.",
    fix: "Ruota krbtgt due volte (procedura Microsoft) e documenta la data.",
  },
  "DA-A-GuestEnabled": {
    titleIt: "Account Guest abilitato",
    why: "Guest è un account noto e spesso mal controllato.",
    fix: "Disabilita Guest e verifica GPO locali che non lo riabilitino.",
  },
  "DA-A-RecycleBin": {
    titleIt: "Cestino AD disabilitato",
    why: "Senza Recycle Bin, oggetti eliminati sono più difficili da recuperare dopo errori o attacchi.",
    fix: "Abilita Active Directory Recycle Bin a livello forest.",
  },
  "DA-A-PwdPolicy": {
    titleIt: "Policy password di dominio debole",
    why: "Lunghezza minima bassa o lockout assente facilitano brute-force e password deboli.",
    fix: "Alza minPwdLength e configura lockout; usa PSO per account privilegiati.",
  },
  "DA-A-LapsCoverage": {
    titleIt: "Copertura LAPS insufficiente",
    why: "Senza LAPS le password admin locali sono spesso condivise e statiche.",
    fix: "Distribuisci LAPS (legacy o Windows LAPS) su tutti i computer gestiti.",
  },
  "DA-A-SidHistory": {
    titleIt: "Account con SID History",
    why: "SID History può portare privilegi da altri domini dopo migrazioni incomplete.",
    fix: "Rimuovi SID History non necessari dopo migrazione; indaga origini sospette.",
  },
  "DA-A-PwdInDescription": {
    titleIt: "Testo tipo password in description",
    why: "Le description sono leggibili da molti utenti del dominio.",
    fix: "Pulisci i campi description; sposta i secret in un vault.",
  },
  "DA-A-PreWin2000": {
    titleIt: "Pre-Windows 2000 Compatible Access rischioso",
    why: "Membership di Everyone/Anonymous in quel gruppo espone enumerazioni eccessive.",
    fix: "Rimuovi Everyone/Anonymous da Pre-Windows 2000 Compatible Access.",
  },
  "DA-A-MachineAccountQuota": {
    titleIt: "Machine account quota > 0",
    why: "Utenti autenticati possono creare computer account (utile per certi attacchi).",
    fix: "Imposta ms-DS-MachineAccountQuota a 0 se non serve join self-service.",
  },
  "DA-A-LdapsNotUsed": {
    titleIt: "LDAPS non configurato sull’integrazione",
    why: "LDAP in chiaro espone credenziali e query sulla rete.",
    fix: "Abilita SSL/LDAPS sull’integrazione Domarc verso il DC.",
  },
  "DA-A-LargePrivilegedSet": {
    titleIt: "Troppi utenti privilegiati",
    why: "Un insieme ampio di account elevati rende difficile il controllo e la risposta agli incidenti.",
    fix: "Riduci membership privilegiate; applica least privilege e review periodiche.",
  },
  "DA-A-AclCollectPartial": {
    titleIt: "Collect ACL incompleto",
    why: "Senza lettura completa dei security descriptor alcune escalation restano invisibili.",
    fix: "Verifica permessi LDAP dell’account sync e riprova l’healthcheck.",
  },
  "DA-A-AuditPolicyGaps": {
    titleIt: "Audit policy del DC incompleta",
    why: "Se una sottocategoria di audit è spenta, gli eventi corrispondenti non vengono mai scritti: nessun SIEM potrà rilevarli, e l'assenza di allarmi verrà scambiata per assenza di problemi. È il caso tipico della DCSync, invisibile senza «Accesso ai servizi di directory».",
    fix: "Attiva le sottocategorie mancanti via GPO (Configurazione computer → Criteri → Impostazioni di sicurezza → Configurazione avanzata dei criteri di controllo), quindi verifica con «auditpol /get /category:*».",
  },
  "DA-A-BruteForceActivity": {
    titleIt: "Tentativi di autenticazione falliti in corso",
    why: "Un volume elevato e continuo di autenticazioni fallite indica un attacco a forza bruta o password spraying in corso, oppure credenziali salvate ormai scadute che stanno bloccando utenti reali.",
    fix: "Identifica l'origine dai dettagli dell'alert (IP e account bersaglio), blocca la sorgente e verifica che la soglia di lockout del dominio sia attiva.",
  },
  "DA-A-LdapCollectPartial": {
    titleIt: "Raccolta LDAP incompleta",
    why: "Una query LDAP fallita svuota gli attributi corrispondenti: le regole che li usano non trovano nulla e il dominio appare più pulito di quanto sia. Non è un rischio del dominio, ma rende il report inaffidabile.",
    fix: "Controlla timeout e permessi dell’account LDAP, poi ripeti l’healthcheck; su domini grandi valuta di aumentare il timeLimit della query.",
  },
  "DA-A-DcMissingCriticalKb": {
    titleIt: "KB di sicurezza critica assente sul DC",
    why: "MS14-068 consente a un utente qualsiasi di farsi rilasciare un ticket da Domain Admin; MS17-010 espone il DC a esecuzione di codice remoto via SMBv1.",
    fix: "Verifica con Get-HotFix e Windows Update se la KB o un rollup cumulativo che la include è installato; se manca davvero, applicala con priorità massima.",
  },
  "DA-A-AdminSDHolderAce": {
    titleIt: "ACE non attese su AdminSDHolder",
    why: "Le ACE qui si propagano agli account protetti (admin) via SDProp.",
    fix: "Rimuovi trustee non standard da AdminSDHolder; confronta con un baseline noto.",
  },
  "DA-A-NoSitesSubnets": {
    titleIt: "Sites o Subnets mancanti",
    why: "Senza topologia corretta la replica e l’autenticazione possono essere inefficienti o errate.",
    fix: "Definisci Sites e Subnets IP che riflettano la rete reale.",
  },
  "DA-A-GpoOrphanPath": {
    titleIt: "GPO senza path SYSVOL",
    why: "GPO incomplete o orfane possono indicare oggetti corrotti o residuali.",
    fix: "Ripara o elimina le GPO senza gPCFileSysPath valido.",
  },
  "DA-A-WinrmProbeUnavailable": {
    titleIt: "Probe WinRM non disponibile",
    why: "Senza WinRM non si verificano hardening DC, patch e SYSVOL cpassword.",
    fix: "Configura credenziale WinRM sull’integrazione e verifica accesso 5985/5986.",
  },
  "DA-A-DcPatchStale": {
    titleIt: "Patch DC non recenti",
    why: "Un Domain Controller non aggiornato è un bersaglio ad alto impatto.",
    fix: "Applica gli aggiornamenti di sicurezza sul DC e verifica la frequenza di patch.",
  },
  "DA-A-SysvolCpassword": {
    titleIt: "cpassword in SYSVOL (GPP)",
    why: "Le password GPP in SYSVOL sono decifrabili da qualsiasi utente autenticato.",
    fix: "Rimuovi i file XML con cpassword e ruota le password esposte.",
  },
  "DA-A-LdapSigningOff": {
    titleIt: "LDAP signing non obbligatorio",
    why: "Senza signing, le sessioni LDAP sono vulnerabili a relay/modifica.",
    fix: "Imposta LDAPServerIntegrity=2 (Require) sui DC e aggiorna i client.",
  },
  "DA-A-LdapChannelBindingOff": {
    titleIt: "LDAP channel binding non attivo",
    why: "Senza channel binding, LDAPS resta esposto a certi attacchi di relay.",
    fix: "Imposta LDAPEnforceChannelBinding (quando supportato / Always) sui DC.",
  },
  "DA-A-SmbSigningOff": {
    titleIt: "SMB signing non obbligatorio sul DC",
    why: "SMB senza signing facilita relay e man-in-the-middle verso il DC.",
    fix: "Abilita RequireSecuritySignature sul servizio LanmanServer del DC.",
  },
  "DA-A-NtlmV1Allowed": {
    titleIt: "NTLMv1 / LM ancora consentiti",
    why: "Protocolli di autenticazione deboli sono crackabili e relay-friendly.",
    fix: "Alza LmCompatibilityLevel (≥3, ideale 5) dopo test applicativi.",
  },
  "DA-A-WdigestEnabled": {
    titleIt: "WDigest abilitato",
    why: "UseLogonCredential=1 mantiene password in chiaro in memoria.",
    fix: "Imposta WDigest UseLogonCredential=0 e riavvia dove richiesto.",
  },
  "DA-A-SpoolerOnDc": {
    titleIt: "Print Spooler attivo sul DC",
    why: "Lo Spooler sul DC amplia la superficie (es. PrintNightmare / abusi di stampa).",
    fix: "Disabilita il servizio Spooler sui Domain Controller se non serve la stampa.",
  },
  "DA-A-LapsDelegationObserved": {
    titleIt: "Deleghe LAPS da verificare",
    why: "Diritti estesi sui computer possono ampliare la visibilità degli attributi LAPS.",
    fix: "Verifica l'accesso effettivo per gruppo e la delega di decrittazione separatamente.",
  },
  "DA-A-AdcsEsc4": {
    titleIt: "Template AD CS da verificare per ESC4",
    why: "Proprietà o scrittura concesse a gruppi ampi possono consentire modifiche al template.",
    fix: "Verifica i permessi effettivi e limita la modifica ai gestori della PKI.",
  },
  "DA-A-AdcsEsc1": {
    titleIt: "Template AD CS da verificare per ESC1",
    why: "Il template consente di scegliere il soggetto. Verifica chi può richiedere il certificato.",
    fix: "Rimuovi ENROLLEE_SUPPLIES_SUBJECT o richiedi approval/RA signature; limita enrollment.",
  },
  "DA-A-AdcsEsc2": {
    titleIt: "Template AD CS da verificare per ESC2",
    why: "Template con Any Purpose / EKU vuoto possono essere abusati per autenticazione.",
    fix: "Restringi le EKU ai soli usi necessari; rivedi chi può fare enrollment.",
  },
  "DA-P-PrimaryGroupHidden": {
    titleIt: "Privilegio nascosto nel gruppo primario",
    why: "Chi ha un gruppo privilegiato come gruppo primario non compare fra i membri del gruppo: una revisione dell'elenco non lo vede.",
    fix: "Riporta il gruppo primario a Domain Users e, se il privilegio serve davvero, aggiungi l'account fra i membri in chiaro.",
  },
  "DA-P-DisabledInPrivilegedGroup": {
    titleIt: "Account disabilitati nei gruppi privilegiati",
    why: "Un account disabilitato che resta in un gruppo privilegiato riprende il privilegio appena qualcuno lo riabilita, senza toccare il gruppo.",
    fix: "Togli gli account disabilitati dai gruppi privilegiati.",
  },
  "DA-P-ComputerInPrivilegedGroup": {
    titleIt: "Computer nei gruppi privilegiati",
    why: "Chi controlla quella macchina (amministratore locale, relay, autenticazione forzata) agisce col privilegio del gruppo.",
    fix: "Togli gli account computer dai gruppi privilegiati; se serve una delega a un servizio, dalla a un gMSA con i soli diritti necessari.",
  },
  "DA-P-SchemaAdminsPopulated": {
    titleIt: "Schema Admins non è vuoto",
    why: "Schema Admins serve solo mentre si estende lo schema: un membro fisso è un privilegio di foresta sempre acceso.",
    fix: "Svuota Schema Admins e aggiungi un account solo per il tempo dell'estensione dello schema.",
  },
  "DA-P-EnterpriseAdminsPopulated": {
    titleIt: "Enterprise Admins ha membri oltre ad Administrator",
    why: "Enterprise Admins comanda tutta la foresta e serve solo per modifiche di foresta. L'Administrator predefinito è riconosciuto dal nome: se è stato rinominato compare qui.",
    fix: "Togli i membri che non servono; aggiungili solo per il tempo dell'intervento.",
  },
  "DA-P-UnresolvedPrivilegedMember": {
    titleIt: "Membri privilegiati non identificati",
    why: "Nei gruppi privilegiati ci sono membri che non sono utenti, computer o gruppi letti da questo controllo (altri domini, gMSA, contatti): hanno il privilegio ma non sono contati altrove.",
    fix: "Controlla a mano chi sono e togli quelli che non servono. È un rilievo da verificare, non entra nel punteggio.",
  },
  "DA-S-DesOnly": {
    titleIt: "Account limitati a Kerberos DES",
    why: "Con «Usa solo crittografia DES» i ticket Kerberos dell'account usano DES, che si rompe in poche ore.",
    fix: "Togli il flag dall'account, cambia la password e verifica che il servizio che lo usa accetti AES.",
  },
  "DA-A-PwdAttributePresent": {
    titleIt: "Password in un attributo leggibile",
    why: "userPassword, unixUserPassword e msSFU30Password contengono spesso una password in chiaro o con hash debole, leggibile da ogni utente del dominio. Si è controllata solo la presenza, mai il valore.",
    fix: "Svuota l'attributo, cambia la password dell'account e ferma lo strumento che lo scrive.",
  },
  "DA-S-PreCreatedComputer": {
    titleIt: "Computer pre-creati e mai usati",
    why: "Un account computer abilitato, senza obbligo di password e senza mai un accesso, può avere ancora la password di serie (il nome del computer). È un indizio: non è stato tentato nessun accesso.",
    fix: "Elimina o disabilita gli account computer mai usati. È un rilievo da verificare, non entra nel punteggio.",
  },
  "DA-P-GmsaBroadReaders": {
    titleIt: "Password di un gMSA leggibile da un gruppo ampio",
    why: "La delega del gMSA lascia leggere la sua password a Everyone, Authenticated Users, Users, Domain Users o Domain Computers. Si è letta solo la delega, mai la password.",
    fix: "Restringi PrincipalsAllowedToRetrieveManagedPassword ai soli server che usano il gMSA.",
  },
  "DA-A-DnsZoneInsecureUpdate": {
    titleIt: "Zona DNS con aggiornamenti dinamici non sicuri",
    why: "La zona accetta aggiornamenti dinamici anche senza autenticazione: chiunque sia in rete può creare o sovrascrivere un nome e deviare il traffico verso di sé.",
    fix: "Imposta la zona su «Solo aggiornamenti sicuri» (proprietà della zona nel DNS Manager).",
  },
  "DA-A-DnsZoneBroadWrite": {
    titleIt: "Zona DNS scrivibile da un gruppo ampio",
    why: "La delega della zona lascia a Everyone, Authenticated Users, Users, Domain Users o Domain Computers il diritto di modificare i record, la delega o il proprietario. Creare record nuovi è il diritto di serie e non è contato.",
    fix: "Togli dalla sicurezza della zona i diritti di scrittura e di controllo dati ai gruppi ampi.",
  },
  "DA-A-DnsWildcardRecord": {
    titleIt: "Record DNS jolly (*) presente",
    why: "Un record * risponde a ogni nome che non esiste. Può essere una difesa voluta contro chi registra nomi come wpad, oppure il segno di chi li ha già dirottati: da solo non dimostra niente.",
    fix: "Controlla chi l'ha creato e dove punta; se non è voluto, toglilo.",
  },
  "DA-A-AnonymousLdapOps": {
    titleIt: "Operazioni LDAP anonime consentite",
    why: "Il settimo carattere di dSHeuristics vale 2: la directory risponde alle ricerche LDAP anche a chi non si è autenticato.",
    fix: "Riporta a 0 il settimo carattere di dSHeuristics, dopo aver verificato che nessuna applicazione usi il bind anonimo.",
  },
  "DA-P-AdminSdExMask": {
    titleIt: "Protezione AdminSDHolder ridotta",
    why: "Il sedicesimo carattere di dSHeuristics esclude alcuni gruppi di operatori (Account, Server, Print, Backup Operators) dalla protezione AdminSDHolder: le loro deleghe non vengono più riportate a quelle di riferimento.",
    fix: "Riporta a 0 il sedicesimo carattere di dSHeuristics, se l'esclusione non è una scelta documentata.",
  },
  "DA-A-SysvolFrs": {
    titleIt: "SYSVOL ancora replicato con FRS",
    why: "FRS è dismesso da Windows Server 2008 R2 e non è più supportato dai domain controller recenti: la replica di GPO e script può fermarsi senza avvisi, e non si può aggiungere un DC nuovo.",
    fix: "Porta a termine la migrazione a DFSR con dfsrmig (stati 1, 2, 3), verificando la replica a ogni passo.",
  },
  "DA-A-DcOutsideDcOu": {
    titleIt: "Domain controller fuori dalla OU Domain Controllers",
    why: "Un DC spostato in un'altra OU non riceve la Default Domain Controllers Policy e prende le GPO pensate per server normali.",
    fix: "Riporta l'account del DC nella OU Domain Controllers.",
  },
  "DA-P-RodcPasswordPolicy": {
    titleIt: "RODC: replica delle password troppo larga",
    why: "La politica di replica delle password del RODC consente di tenere in copia le password di account privilegiati o di gruppi ampi, oppure non ha nessun gruppo negato. Chi prende il RODC le ottiene. Si sono letti solo i gruppi della politica, mai le password.",
    fix: "Togli privilegiati e gruppi ampi dall'elenco «Consentiti» e rimetti nei «Negati» il gruppo Denied RODC Password Replication Group.",
  },
  "DA-P-DmsaSupersedesPrivileged": {
    titleIt: "dMSA che succede a un account privilegiato",
    why: "Un account di servizio gestito delegato (Windows Server 2025) è collegato come successore di un account privilegiato e ne eredita i diritti: è la tecnica nota come BadSuccessor.",
    fix: "Verifica che la migrazione sia voluta; se non lo è, togli il collegamento msDS-ManagedAccountPrecededByLink e controlla chi può creare dMSA nelle OU.",
  },
  "DA-S-AzureSsoKeyOld": {
    titleIt: "Chiave del Seamless SSO di Entra non ruotata",
    why: "L'account AZUREADSSOACC$ firma i ticket del Seamless SSO verso Entra ID. Microsoft chiede di ruotarne la chiave ogni 30 giorni: una chiave vecchia rubata vale finché non cambia.",
    fix: "Ruota la chiave con Update-AzureADSSOForest dal server Entra Connect e mettila in calendario.",
  },
  "DA-P-EntraSyncAccountPrivileged": {
    titleIt: "Account di sincronizzazione Entra in un gruppo privilegiato",
    why: "L'account che Entra Connect usa per leggere il dominio (MSOL_, AAD_, Sync_) è membro di un gruppo privilegiato: chi prende il server di sincronizzazione prende il dominio.",
    fix: "Togli l'account dai gruppi privilegiati e lasciagli solo le deleghe che chiede Entra Connect.",
  },
  "DA-P-PrivilegedSyncedToEntra": {
    titleIt: "Account privilegiati sincronizzati con Entra ID",
    why: "Gli account amministrativi del dominio portano l'ancora di Entra Connect, quindi esistono anche nel cloud: una compromissione da una parte passa dall'altra.",
    fix: "Escludi gli account privilegiati dalla sincronizzazione e usa account solo cloud per amministrare Entra.",
  },
  "DA-A-ShadowCredentials": {
    titleIt: "Shadow credentials presenti",
    why: "msDS-KeyCredentialLink consente login con chiave (utile a Entra ID, abusabile se scritto da attaccanti).",
    fix: "Verifica che i valori siano legittimi (hybrid join); rimuovi link sospetti.",
  },
  "DA-A-NoPso": {
    titleIt: "Nessuna Password Settings Object",
    why: "Senza PSO, anche gli admin condividono la policy password del dominio.",
    fix: "Crea PSO più severe per gruppi privilegiati (DA, EA, service tier-0).",
  },
  "DA-A-DomainScore": {
    titleIt: "Punteggio complessivo dominio",
    why: "Sintesi del rischio aggregato dagli altri finding (non è una vulnerabilità autonoma).",
    fix: "Lavora sui finding con severity più alta per abbassare lo score.",
  },
};

export function getRuleGuide(ruleId: string): RuleGuide {
  const found = CATALOG[ruleId];
  if (found) return found;
  return {
    titleIt: ruleId,
    why: "Finding rilevato dall’engine Domarc AD Health.",
    fix: "Apri il dettaglio oggetti e valuta se la configurazione è intenzionale.",
  };
}

export const AXIS_LABEL_IT: Record<HealthAxis, string> = {
  stale: "Account e igiene",
  privileged: "Privilegi e deleghe",
  trust: "Trust",
  anomaly: "Configurazione e anomalie",
  score: "Punteggio",
};

export const AXIS_ORDER: HealthAxis[] = [
  "privileged",
  "anomaly",
  "stale",
  "trust",
  "score",
];

const SEV_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export interface FindingAxisGroup {
  axis: HealthAxis;
  label: string;
  findings: HealthFinding[];
}

/** Group findings for human UI: by axis, severity then points. */
export function groupFindingsForUi(findings: HealthFinding[]): FindingAxisGroup[] {
  const byAxis = new Map<HealthAxis, HealthFinding[]>();
  for (const f of findings) {
    const list = byAxis.get(f.axis) ?? [];
    list.push(f);
    byAxis.set(f.axis, list);
  }
  const groups: FindingAxisGroup[] = [];
  for (const axis of AXIS_ORDER) {
    const list = byAxis.get(axis);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => {
      const sa = SEV_RANK[a.severity] ?? 9;
      const sb = SEV_RANK[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return b.points - a.points;
    });
    groups.push({ axis, label: AXIS_LABEL_IT[axis], findings: list });
  }
  // any unexpected axis
  for (const [axis, list] of byAxis) {
    if (AXIS_ORDER.includes(axis)) continue;
    groups.push({ axis, label: axis, findings: list });
  }
  return groups;
}

/** Severity summary counts for header chips. */
export function countBySeverity(findings: HealthFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    // DomainScore is meta — exclude from actionable counts
    if (f.ruleId === "DA-A-DomainScore") continue;
    out[f.severity] = (out[f.severity] ?? 0) + 1;
  }
  return out;
}

export function actionableFindings(findings: HealthFinding[]): HealthFinding[] {
  return findings.filter((f) => f.ruleId !== "DA-A-DomainScore");
}
