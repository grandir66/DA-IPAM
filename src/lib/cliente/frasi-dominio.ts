/**
 * Frasi semplici per i rilievi del controllo del dominio (Health AD), per identificativo della regola.
 * I titoli delle regole sono tecnici e quasi tutti in inglese («Shadow credentials (KeyCredentialLink)
 * present», «Unexpected DCSync rights on domain»): l'11/11/2026 finivano così in «Cosa richiede
 * attenzione» della vista cliente. L'elenco copre tutte le regole di `src/lib/ad/health/`; una regola
 * nuova che qui manca esce col suo titolo, finché non le si dà una frase.
 */

const FRASI: Record<string, string> = {
  // Account fermi o deboli
  "DA-S-PwdNeverExpires": "Account con la password che non scade mai",
  "DA-S-InactiveUser": "Utenti attivi che non entrano da mesi",
  "DA-S-InactiveComputer": "Computer attivi che non si collegano da mesi",
  "DA-S-ObsoleteOS": "Computer con un sistema operativo non più aggiornato dal produttore",
  "DA-S-PwdNotRequired": "Account che possono avere la password vuota",
  "DA-S-ReversiblePwd": "Account con la password salvata in forma recuperabile",
  "DA-S-NoPreAuth": "Account esposti al furto della password senza bisogno di accedere",
  "DA-S-DesOnly": "Account che usano una cifratura superata",
  "DA-S-DcPwdAge": "Server di dominio con la password interna non rinnovata da tempo",
  "DA-S-PreCreatedComputer": "Computer creati in anticipo e mai usati",
  "DA-S-AzureSsoKeyOld": "Chiave dell'accesso unico a Microsoft 365 non rinnovata da tempo",

  // Account con privilegi
  "DA-P-DomainAdminsCount": "Troppi amministratori del dominio",
  "DA-P-AdminPwdAge": "Amministratori del dominio con la password vecchia",
  "DA-P-DCSyncRights": "Account che possono copiare tutte le password del dominio senza averne motivo",
  "DA-P-DangerousAcl": "Permessi pericolosi su oggetti del dominio",
  "DA-P-OperatorsPopulated": "Gruppi di operatori con privilegi che dovrebbero essere vuoti",
  "DA-P-EnterpriseAdminsPopulated": "Il gruppo degli amministratori dell'intera organizzazione ha membri in più",
  "DA-P-SchemaAdminsPopulated": "Il gruppo che può cambiare la struttura del dominio non è vuoto",
  "DA-P-GpoCreatorsPopulated": "Il gruppo che può creare regole per tutti i computer ha membri",
  "DA-P-DnsAdminsPopulated": "Il gruppo degli amministratori dei nomi di rete ha membri",
  "DA-P-Kerberoastable": "Account di servizio la cui password si può tentare di indovinare da fuori",
  "DA-P-ProtectedUsersGap": "Amministratori non inseriti nel gruppo protetto",
  "DA-P-EmptyProtectedUsers": "Il gruppo protetto per gli amministratori è vuoto",
  "DA-P-PrivilegedSyncedToEntra": "Account con privilegi copiati anche su Microsoft 365",
  "DA-P-EntraSyncAccountPrivileged": "L'account che sincronizza con Microsoft 365 ha troppi privilegi",
  "DA-P-AdminCountOrphan": "Account che erano amministratori e ne conservano le tracce",
  "DA-P-AdminSdExMask": "Protezione degli account con privilegi ridotta da un'impostazione",
  "DA-P-ComputerInPrivilegedGroup": "Computer inseriti in gruppi con privilegi",
  "DA-P-DisabledInPrivilegedGroup": "Account disattivati ancora presenti in gruppi con privilegi",
  "DA-P-NestedIntoDomainAdmins": "Gruppi inseriti dentro gli amministratori del dominio",
  "DA-P-PrimaryGroupHidden": "Account con privilegi assegnati in modo poco visibile",
  "DA-P-UnresolvedPrivilegedMember": "Membri non riconoscibili in gruppi con privilegi",
  "DA-P-UnconstrainedDelegation": "Computer o account che possono agire a nome di chiunque",
  "DA-P-ConstrainedDelegation": "Account che possono agire a nome di altri verso alcuni servizi",
  "DA-P-ProtocolTransition": "Account che possono agire a nome di altri senza la loro password",
  "DA-P-RBCD": "Computer su cui altri account possono agire a nome di chiunque",
  "DA-P-GmsaBroadReaders": "Password di account di servizio leggibili da troppi",
  "DA-P-DmsaSupersedesPrivileged": "Account di servizio che ereditano i privilegi di un amministratore",
  "DA-P-RodcPasswordPolicy": "Server di dominio in sola lettura che conservano password di amministratori",

  // Fiducie tra domini
  "DA-T-SidFilteringOff": "Collegamento con un altro dominio senza il filtro di sicurezza",

  // Anomalie e impostazioni
  "DA-A-ShadowCredentials": "Account con una chiave di accesso aggiunta di nascosto",
  "DA-A-AdminSDHolderAce": "Permessi inattesi sul modello che protegge gli amministratori",
  "DA-A-BruteForceActivity": "Tentativi ripetuti di accesso falliti in corso",
  "DA-A-DnsZoneInsecureUpdate": "I nomi di rete si possono cambiare senza autenticarsi",
  "DA-A-DnsZoneBroadWrite": "Troppi account possono cambiare i nomi di rete",
  "DA-A-DnsWildcardRecord": "Un nome di rete «jolly» risponde per qualsiasi nome",
  "DA-A-KrbtgtAge": "La chiave principale del dominio non è rinnovata da troppo tempo",
  "DA-A-PwdPolicy": "Le regole sulle password del dominio sono deboli",
  "DA-A-NoPso": "Nessuna regola sulle password più severa per gli amministratori",
  "DA-A-PwdAttributePresent": "Password scritta in chiaro in un campo leggibile",
  "DA-A-PwdInDescription": "Password scritta nella descrizione di un account",
  "DA-A-SysvolCpassword": "Password recuperabile in una regola condivisa del dominio",
  "DA-A-LdapSigningOff": "I server di dominio accettano richieste non firmate",
  "DA-A-LdapChannelBindingOff": "I server di dominio non legano le richieste al canale protetto",
  "DA-A-LdapsNotUsed": "Il collegamento protetto ai server di dominio non è configurato",
  "DA-A-SmbSigningOff": "I server di dominio accettano condivisioni non firmate",
  "DA-A-NtlmV1Allowed": "È ancora ammesso un metodo di accesso superato",
  "DA-A-WdigestEnabled": "Le password restano leggibili nella memoria dei computer",
  "DA-A-AnonymousLdapOps": "Il dominio risponde anche a chi non si autentica",
  "DA-A-PreWin2000": "Compatibilità con sistemi vecchissimi ancora attiva",
  "DA-A-GuestEnabled": "L'account ospite è attivo",
  "DA-A-MachineAccountQuota": "Ogni utente può aggiungere computer al dominio",
  "DA-A-SidHistory": "Account che portano con sé privilegi di un altro dominio",
  "DA-A-RecycleBin": "Il cestino del dominio è spento: un oggetto cancellato non si recupera",
  "DA-A-SpoolerOnDc": "Il servizio di stampa è acceso su un server di dominio",
  "DA-A-SysvolFrs": "Le regole del dominio si copiano con un metodo superato",
  "DA-A-GpoOrphanPath": "Regole del dominio che puntano a cartelle inesistenti",
  "DA-A-DcOutsideDcOu": "Server di dominio fuori dalla loro cartella protetta",
  "DA-A-DcPatchStale": "Server di dominio non aggiornati da tempo",
  "DA-A-DcMissingCriticalKb": "Server di dominio senza un aggiornamento di sicurezza importante",
  "DA-A-LapsCoverage": "Computer con la stessa password di amministratore locale",
  "DA-A-LapsDelegationObserved": "Troppi account possono leggere le password di amministratore locale",
  "DA-A-LargePrivilegedSet": "Gli account con privilegi sono troppi",
  "DA-A-AuditPolicyGaps": "Il dominio non registra alcuni eventi importanti",
  "DA-A-NoSitesSubnets": "Le sedi e le reti del dominio non sono dichiarate",
  "DA-A-AdcsEsc1": "Modelli di certificato da verificare: chi li chiede può fingersi un altro",
  "DA-A-AdcsEsc2": "Modelli di certificato da verificare: validi per qualsiasi uso",
  "DA-A-AdcsEsc4": "Modelli di certificato modificabili da troppi account",
};

/**
 * Regole che non sono un difetto del dominio: il punteggio stesso, gli inventari e gli avvisi
 * «non sono riuscito a leggere». Al cliente non si mostrano.
 */
const NON_PER_IL_CLIENTE = new Set([
  "DA-A-DomainScore",
  "DA-A-AclCollectPartial",
  "DA-A-LdapCollectPartial",
  "DA-A-WinrmProbeUnavailable",
  "DA-T-TrustInventory",
]);

/** true se il rilievo non va mostrato nella vista cliente. */
export function rilievoNascosto(ruleId: string | null | undefined): boolean {
  return ruleId != null && NON_PER_IL_CLIENTE.has(ruleId);
}

/** La frase semplice della regola; se la regola non è in elenco, il suo titolo così com'è. */
export function fraseRilievo(ruleId: string | null | undefined, titolo: string): string {
  return (ruleId != null ? FRASI[ruleId] : undefined) ?? titolo;
}

/** «9 · Frase» quando c'è un conto; solo la frase quando gli oggetti sono zero. */
export function conQuanti(quanti: number, testo: string): string {
  return quanti > 0 ? `${quanti} · ${testo}` : testo;
}

/** Serve alla prova: ogni identificativo in elenco. */
export function regoleConFrase(): string[] {
  return Object.keys(FRASI);
}
