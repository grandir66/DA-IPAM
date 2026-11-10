# AD Health di IPAM — piano di implementazione

> Proposta del 10/11/2026. Esecuzione in una sessione, una tappa alla volta. Baseline verificata su `origin/dev` `0cf74c06`. Prima di iniziare, rileggere il ramo remoto e verificare eventuali lavori concorrenti sui file AD Health.

**Obiettivo** — Ridurre gli errori di valutazione LAPS e AD CS, spiegare i percorsi verso i privilegi di dominio e mostrare che cosa è cambiato tra due esecuzioni.

**Architettura** — Riutilizzare la pipeline LDAP, ACL e WinRM già presente, le regole TypeScript, la persistenza per integrazione e la pagina AD Health. Le regole producono evidenze e stato di copertura separati. Usare i campi JSON esistenti con lettura compatibile dei dati storici.

**Spec di riferimento** — `2026-07-26-ad-health-acl-collect-design.md`, `2026-07-26-ad-health-phase5-ldap-winrm-design.md` e `2026-07-26-ad-health-phase6-winrm-adcs-design.md` in `docs/superpowers/specs/`. Le decisioni aggiuntive sono in questo piano.

**Controllo proposto** — Base per sviluppo locale su fixture e laboratorio. Completo prima di qualsiasi prova o rilascio su domini e dati di produzione. L'approvazione di questo piano autorizza le tappe locali. L'eventuale rilascio va concordato separatamente perché `dev` può aggiornare un'appliance cliente.

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
