# AD Health di IPAM — piano di implementazione

> Proposta del 10/11/2026. Esecuzione in una sessione, una tappa alla volta. Baseline verificata su `origin/dev` `0cf74c06`. Prima di iniziare, rileggere il ramo remoto e verificare eventuali lavori concorrenti sui file AD Health.

**Obiettivo** — Ridurre gli errori di valutazione LAPS e AD CS, spiegare i percorsi verso i privilegi di dominio e mostrare che cosa è cambiato tra due esecuzioni.

**Architettura** — Riutilizzare la pipeline LDAP, ACL e WinRM già presente, le regole TypeScript, la persistenza per integrazione e la pagina AD Health. Le regole producono evidenze e stato di copertura separati. Usare i campi JSON esistenti con lettura compatibile dei dati storici.

**Spec di riferimento** — `2026-07-26-ad-health-acl-collect-design.md`, `2026-07-26-ad-health-phase5-ldap-winrm-design.md` e `2026-07-26-ad-health-phase6-winrm-adcs-design.md` in `docs/superpowers/specs/`. Le decisioni aggiuntive sono in questo piano.

**Controllo proposto** — Base per sviluppo locale su fixture e laboratorio. Completo prima di qualsiasi prova o rilascio su domini e dati di produzione. L'approvazione di questo piano autorizza le tappe locali. L'eventuale rilascio va concordato separatamente perché `dev` può aggiornare un'appliance cliente.

## Stato della prima consegna

- [x] Copertura LAPS da metadati, lettura dello schema e conteggi salvati. Attributi password rimossi dal collector.
- [x] Pubblicazione dei template AD CS verificata nel contesto Configuration. I candidati ESC1/ESC2 senza verifica dei permessi restano visibili come diagnostica a zero punti.
- [x] Motore 0.9.1. Rilevate ACE Enroll e modifica AD CS, proprietari ampi per ESC4 e concessioni estese LAPS. Esiti diagnostici con SID ed evidenza. Verifica locale con 139 test.
- [ ] Diritti di lettura LAPS, permessi effettivi Enroll e controlli ESC4/ESC8 da completare. Collaudo su dominio di laboratorio ancora da eseguire.

## Vincoli comuni

- Verifiche in sola lettura con i permessi minimi già disponibili. Nessuna richiesta di certificati, modifica di ACL o GPO, prova di relay o lettura di password LAPS/gMSA.
- Separare **rilievo confermato**, **da verificare** e **raccolta incompleta**. Solo i rilievi confermati entrano nel punteggio. Per una regola esistente, conservare ID e compatibilità dei report storici e marcare il cambio di criteri con una revisione.
- Estendere `RuleContext` e `stats_json` con campi opzionali. Riutilizzare `HealthFinding.diagnostic` per informazioni senza punteggio. Evitare dati sensibili in log, prove e payload. Verificare che l'export verso Vulcan mantenga il contratto esistente prima di includere nuovi dettagli.
- Node 22. Una prova mirata per tappa, test dell'integrazione locale a fine lavoro e un solo controllo completo prima del rilascio. Per variazioni di layout, una verifica a 1920. Nessun subagent previsto.

## Tappe

### 1. Correggere Windows LAPS e distinguere i diritti di lettura

- [ ] **File** — `ldap-extras.ts`, `types.ts`, `engine.ts`, `rules/phase2.ts`, `rule-catalog.ts` e prove `rules-phase2.test.ts` e `ldap-utils.test.ts` in `src/lib/ad/health/`. Riutilizzare `acl/acl-collect.ts` per i diritti e le OU, se la copertura e il budget del collector lo permettono.
- [ ] **Contratto** — `LapsComputerState = "valido" | "scaduto" | "nessun_metadato" | "non_verificabile"`. Leggere RootDSE e schema per distinguere Windows LAPS e LAPS legacy. Usare `msLAPS-PasswordExpirationTime` e `ms-Mcs-AdmPwdExpirationTime` come metadati e rimuovere dalla ricerca gli attributi password. Un metadato di scadenza attesta la presenza del metadato, senza attestare la leggibilità del segreto. Se schema, permessi o ricerca lasciano incerta l'assenza, segnare non verificabile.
- [ ] **Diritti** — Risolvere i gruppi noti che possono leggere gli attributi riservati per OU e riportare il gruppo e la delega osservata. Separare lettura dell'attributo e possibilità di decrittare le password cifrate. Se ACL, ereditarietà o appartenenza sono parziali, esporre il limite.
- [ ] **Accettazione** — Le fixture distinguono Windows LAPS, legacy, metadato scaduto e lettura negata. Nessun attributo password compare nella richiesta. Un accesso negato non peggiora il punteggio di copertura.
- [ ] **Prova e commit** — `node --import tsx --test src/lib/ad/health/__tests__/{rules-phase2,ldap-utils}.test.ts`. Commit «Correggi la copertura LAPS e mostra i diritti di lettura».

### 2. Verificare ESC1 ed ESC2 e aggiungere ESC4

- [ ] **File** — `adcs.ts`, `ldap-extras.ts`, `acl/acl-collect.ts`, `rules/phase6.ts`, `rule-catalog.ts`, `engine.ts` e `__tests__/rules-phase6.test.ts`.
- [ ] **Contratto** — Estendere `AdcsTemplateRow` con nome LDAP `cn`, `publishedBy: string[] | null` e risultato della valutazione di enroll `"privilegio_basso" | "ristretto" | "non_verificabile"`. Usare `configurationNamingContext` da RootDSE anche nei domini figli. Incrociare il CN con `certificateTemplates` delle CA. Verificare diritti Enroll e vincoli già letti, inclusi approvazione e firme. Distinguere configurazione sospetta da esposizione confermata. Un template non pubblicato può restare informativo.
- [ ] **ESC4** — Valutare owner e ACL dei template. Mostrare soggetto, diritto effettivo e template. Includere negazioni, ambito del diritto e gruppi annidati quando risolvibili. Con dati incompleti, riportare la delega osservata senza concludere che esista un percorso sfruttabile. Conservare gli ID ESC1/ESC2. Aggiungere `DA-A-AdcsEsc4`.
- [ ] **Accettazione** — Template in dominio figlio, template pubblicato con enroll ampio, template pubblicato riservato, template non pubblicato e ACL illeggibile producono esiti distinti. Una delega che consente di cambiare la DACL produce evidenza ESC4. Una ACE non applicabile non la produce.
- [ ] **Prova e commit** — `node --import tsx --test src/lib/ad/health/__tests__/{rules-phase6,acl-parser}.test.ts`. Commit «Verifica la pubblicazione e i diritti dei template AD CS».

### 3. Aggiungere ESC8 verificato sulla configurazione IIS

- [ ] **File** — `adcs.ts`, `winrm-probe.ts`, `types.ts`, `engine.ts`, `rules/phase6.ts`, `rule-catalog.ts` e `__tests__/rules-phase6.test.ts`. Usare i server di enrollment autorizzati per l'integrazione e il trasporto WinRM esistente.
- [ ] **Contratto** — Per ciascun endpoint Web Enrollment o CES raccogliere host, percorso, stato NTLM, obbligo TLS e modalità EPA. Nessuna autenticazione HTTP di prova verso l'endpoint. `DA-A-AdcsEsc8` è confermato quando la configurazione effettiva consente NTLM e manca almeno uno dei due requisiti, HTTPS obbligatorio ed EPA obbligatoria. Un HTTP 401 o la sola presenza del percorso restano indizi. Se IIS o i suoi dati non sono leggibili, indicare la copertura mancante.
- [ ] **Accettazione** — NTLM con HTTPS ed EPA imposti, NTLM senza EPA, NTLM senza HTTPS, configurazione illeggibile e sola osservazione HTTP restano distinguibili.
- [ ] **Prova e commit** — `node --import tsx --test src/lib/ad/health/__tests__/rules-phase6.test.ts` con fixture del collector IIS. Commit «Valuta ESC8 dalla configurazione IIS».

### 4. Spiegare i percorsi di controllo verso i privilegi di dominio

- [ ] **File** — Creare `control-paths.ts` e `__tests__/control-paths.test.ts` in `src/lib/ad/health/`. Estendere `membership.ts`, `acl/acl-collect.ts`, `ldap-extras.ts`, `engine.ts`, la rotta `src/app/api/ad/healthcheck/route.ts` e `src/components/ad/health-active-directory.tsx`.
- [ ] **Contratto** — `ControlEdge` contiene SID o GUID di partenza e arrivo, relazione, origine dell'evidenza e qualità. `ControlPath` contiene la sequenza ordinata degli archi e il bersaglio. Prima copertura per gruppi annidati, modifica membership, diritti di controllo del dominio e GPO modificabili collegate ai controller. Per GPO, verificare link attivi, ACL e applicabilità. Filtri o scope non risolti producono un percorso da verificare.
- [ ] **Ricerca** — Percorsi più brevi con deduplicazione e gestione dei cicli. Tetto iniziale di sei passaggi e 50 percorsi restituiti per dominio. Rendere espliciti troncamento e dati mancanti. Mostrare inizialmente i percorsi senza aggiungere punti, per evitare di contare due volte gli stessi rilievi ACL.
- [ ] **UI** — Aggiungere il riquadro «Percorsi di controllo» nella pagina AD Health. Righe con soggetto, bersaglio e stato. Espansione con passaggi, diritti ed evidenze. Riepilogo di percorsi confermati, da verificare e copertura parziale.
- [ ] **Accettazione** — Un gruppo annidato o una delega completa spiega il percorso. Un ciclo termina, una ACE negata non crea un arco effettivo e una GPO non applicabile non porta ai controller. Verificare autenticazione e isolamento per integrazione sulla rotta esistente.
- [ ] **Prova e commit** — `node --import tsx --test src/lib/ad/health/__tests__/{control-paths,membership,acl-parser}.test.ts`. Una schermata a 1920 su fixture di laboratorio. Commit «Mostra i percorsi di controllo in AD Health».

### 5. Confrontare due esecuzioni con copertura compatibile

- [ ] **File** — Creare `compare-runs.ts` e `__tests__/compare-runs.test.ts` in `src/lib/ad/health/`. Estendere `engine.ts`, `persist.ts`, `types.ts`, la rotta Healthcheck e la pagina AD Health.
- [ ] **Contratto** — `CoverageByRule` associa ogni ID di regola a `"completa" | "parziale" | "non_eseguita"` e alla revisione dei criteri. Registrarlo in `stats_json` insieme a un riepilogo dei rilievi per chiave stabile di regola e oggetto, dove disponibile. Una lista di esempi troncata non dimostra la scomparsa di un oggetto. Confrontare l'esecuzione mostrata con la precedente conclusa e salvata per la stessa integrazione, tramite query limitata. Nessuna baseline implica confronto indisponibile.
- [ ] **Esiti** — Nuovo, persistente, risolto e non verificabile. «Risolto» richiede stessa revisione e perimetro comparabile, copertura sufficiente e assenza del rilievo. Esecuzioni storiche senza metadati, errori dei collector e cambi di criterio non possono far apparire una risoluzione.
- [ ] **UI** — Riquadro «Rispetto al controllo precedente» con date, copertura e conteggi. Mostrare le variazioni per regola e, quando disponibile e completa, per oggetto. Usare la risposta GET autenticata della stessa integrazione.
- [ ] **Accettazione** — Due tenant e due integrazioni restano isolati. Un LDAP/WinRM parziale non chiude il rilievo. Un oggetto rinominato con ID stabile non diventa un nuovo rilievo. Un'esecuzione precedente senza copertura genera un confronto indisponibile o non verificabile.
- [ ] **Prova e commit** — `node --import tsx --test src/lib/ad/health/__tests__/{compare-runs,persist,engine}.test.ts`. Una schermata a 1920 su fixture di laboratorio. Commit «Confronta i rilievi AD Health con la copertura verificata».

## Ordine e collaudo finale

Tappe 1 e 2 come prima consegna. La 3 riusa il perimetro AD CS della 2. La 4 riusa gruppi e ACL, la 5 usa le informazioni di copertura prodotte nelle tappe precedenti. Verificare su un dominio di laboratorio che i rilievi confermati e i dati mancanti restino distinguibili, che il modulo funzioni senza leggere password e che l'export di un'esecuzione storica resti valido. Aggiornare `TASKS.md`, `CONTEXT.md` e `CHANGELOG.md` a ogni consegna pertinente.

## Strumenti di confronto per il laboratorio

- **ad-doctor** (`54b006a`, MIT, Python ≥3.12). Usarlo come secondo parere a versione bloccata per le tappe AD CS, LAPS e percorsi. Confrontare a parità di perimetro i rilievi, l'evidenza e i controlli non valutati. Prendere come riferimento anche identificatori stabili, diff e report SARIF. Per ESC8 distinguere l'indizio da rete dalla conferma della configurazione IIS. Verifica del sorgente e 24 test di `tests/test_checks.py` passati in ambiente isolato, senza accesso a un dominio. [Sorgente](https://github.com/brkozer/ad-doctor/tree/54b006a) · [PyPI](https://pypi.org/project/ad-doctor/)
- **ADcheck** (`f03fcb8`, GPL-3.0, Python ≥3.10). Consultare la checklist per controlli puntuali su registro, audit, GPO e permessi. Qualsiasi futura prova va limitata a moduli selezionati e a un account senza privilegi elevati. In modalità privilegiata, i controlli di password uguali o vuote chiamano DCSync. Per IPAM riusare le idee attraverso i collector esistenti, evitando di incorporare codice o acquisire hash. Verifica statica. [Sorgente](https://github.com/CobblePot59/ADcheck/tree/f03fcb8)

## Lacune rispetto ad ad-doctor

Riccardo, 10/11/2026: confronto fra le 61 regole di AD Health e il catalogo di ad-doctor `54b006a` (152 controlli e 5 invarianti, letto per intero) più la checklist di ADcheck. Nessuno dei due entra in IPAM: il catalogo di ad-doctor fa da metro, ADcheck da lista. Qui sotto quello che AD Health oggi non guarda, in blocchi. Ogni blocco diventa una tappa solo quando Riccardo la approva. Valgono i vincoli del piano: sola lettura, permessi minimi, esito «confermato / da verificare / raccolta incompleta», nessuna lettura di password o hash.

Punto di forza da non perdere: AD Health legge lo stato effettivo dei controller via WinRM, ad-doctor solo le GPO. Dove i due divergono, fa fede lo stato effettivo.

- [x] **A. Appartenenze nascoste e gruppi privilegiati** — Appartenenza per `primaryGroupID`, gruppi coi membri illeggibili, account disabilitati o computer nei gruppi privilegiati, Schema Admins ed Enterprise Admins popolati senza necessità. Solo LDAP, riusa `membership.ts`.
- [x] **B. Account** — Account col solo DES, attributi che contengono password (`userPassword`, `unixUserPassword`, descrizioni), computer pre-creati con password prevedibile (solo l'indizio dagli attributi, nessun tentativo di logon), chi può leggere la password delle gMSA (solo la delega, mai il valore).
  - Fatti il 10/11 sul ramo `claude/ad-health-lacune-ab` (`src/lib/ad/health/rules/lacune-ab.ts`), verifica: `node --import tsx --test src/lib/ad/health/__tests__/rules-lacune-ab.test.ts src/lib/ad/health/__tests__/rule-catalog.test.ts`, 11 prove verdi. Regole: `DA-P-PrimaryGroupHidden`, `DA-P-DisabledInPrivilegedGroup`, `DA-P-ComputerInPrivilegedGroup`, `DA-P-SchemaAdminsPopulated`, `DA-P-EnterpriseAdminsPopulated`, `DA-S-DesOnly`, `DA-A-PwdAttributePresent`, `DA-P-GmsaBroadReaders`; diagnostiche (da verificare, fuori dal punteggio) `DA-P-UnresolvedPrivilegedMember` e `DA-S-PreCreatedComputer`. Le password nelle descrizioni c'erano già (`DA-A-PwdInDescription`). Degli attributi con password si legge solo la presenza (filtro `(attr=*)`, risposta col solo DN); dei gMSA solo `msDS-GroupMSAMembership`.
  - Non fatto: nessuna prova su un dominio vero (raccolta LDAP nuova mai eseguita contro un controller); i «membri illeggibili» sono coperti solo come membri non identificati, non si distingue ancora il gruppo che l'utenza non riesce a leggere; Enterprise Admins riconosce l'Administrator predefinito dal nome, non dal RID 500.
- [ ] **C. GPO** — GPO modificabili o collegabili ai controller da chi non è amministratore, amministratori locali dati a gruppi larghi, password negli script di SYSVOL e NETLOGON, autologon, WSUS in HTTP, LLMNR e NBT-NS attivi. Si aggancia alla tappa 4 (GPO modificabili collegate ai controller).
- [ ] **D. DNS** — Oggi niente. Zone con aggiornamenti non sicuri, zone e record scrivibili da utenti autenticati, record jolly, `wpad` e `isatap` non bloccati (Global Query Block List).
- [ ] **E. AD CS, il resto** — ESC3, 5, 6, 7, 9, 10, 11 e 13-17, chiavi sotto 2048 bit, algoritmi deboli della CA. Dopo le tappe 2 e 3: serve la configurazione della CA (flag `EDITF_ATTRIBUTESUBJECTALTNAME2`, `IF_ENFORCEENCRYPTICERTREQUEST`, diritti di gestione), in parte leggibile solo via WinRM sul server della CA.
- [ ] **F. Infrastruttura** — `dSHeuristics` (accesso anonimo, AdminSDHolder ridotto), delega di dMSA sulle OU (BadSuccessor), RODC e la loro politica di replica delle password, SYSVOL ancora in FRS, età dell'ultimo backup (`dSASignature`/metadati di replica), SMBv1, TLS 1.0, oggetti che si spacciano per controller (`userAccountControl` di DC fuori dall'OU).
- [ ] **G. Ibrido con Entra** — `AZUREADSSOACC$` con password vecchia, account di Entra Connect (`MSOL_`) coi suoi diritti di replica e dove sta il server, account sincronizzati nei gruppi privilegiati.
- [ ] **H. Catene** — Le catene di ad-doctor (CHAIN, PATH-001) sono le tappe 4 e 5 di questo piano: nessuna tappa nuova, ma usare i suoi casi come elenco di accettazione.
- [ ] **I. Da ADcheck, voci di registro sui controller** — LSASS protetto (`RunAsPPL`), Credential Guard, hash LM conservati, `AlwaysInstallElevated`, RDP senza NLA, diritti utente pericolosi (`SeDebugPrivilege`, `SeBackupPrivilege` a gruppi larghi). Si leggono col trasporto WinRM esistente, accanto a WDigest e NTLMv1.

**Ordine proposto**: chiudere la tappa 2, poi A e B (solo LDAP, costo basso), C, D; I quando si tocca `winrm-probe.ts` per la tappa 3; E dopo la 3; F e G per ultimi.
