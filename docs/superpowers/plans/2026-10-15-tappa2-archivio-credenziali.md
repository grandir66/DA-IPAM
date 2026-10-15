# Tappa 2 — archivio unico delle credenziali — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea (una sessione che
> esegue i task in ordine). Le caselle `- [ ]` tengono il conto. Ogni sotto-tappa è un
> rilascio a sé: la successiva parte solo dopo che la precedente è stata verificata.

**Obiettivo:** un archivio solo per tutte le credenziali del cliente, con otto tipi per
esteso e un solo motore che sceglie quale usare. Catene di rete, apparati, controller e
AD puntano all'archivio. Il lavoro esce in sette rilasci, e ognuno lascia l'app
funzionante anche se il successivo non arriva.

**Architettura:** in `src/lib/credentials/` ci sono tre moduli puri, con l'handle del DB
esplicito:
- `tipi.ts`: tipi, metodi, etichette e la regola tipo ↔ protocollo;
- `segreti.ts`: dalla voce al segreto in chiaro, con SNMPv3 completo;
- `resolve.ts` allargato: il motore, che sceglie per host, apparato e rete.

Le gemelle di `db.ts` e `db-tenant.ts` diventano involucri di una riga sopra questi
moduli. Le conversioni dei dati sono funzioni pure e idempotenti in
`src/lib/credentials/`. Le chiamano la fine di `getTenantDb` e la fine di
`importTenant`, e ognuna lascia un segno in `tenant_settings`; con il segno `done:` o
`parziale:` non si richiamano più. La pulizia dei dati vecchi (2g) non sta in
`getTenantDb`: è uno script con `--dry-run` di default.

Il vecchio si legge in doppio finché il nuovo non è provato. Ogni lettura del vecchio si
annota nel registro dei ripieghi. Il vecchio si toglie solo nella 2g, quando quel
registro è a zero per i casi elencati in D9 (tutti tranne `cred_public`).

**Spec:** `docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md` (§2, §3 «Tappa 2», §4).
**Misure:** sola lettura del 15/10 su hub (tenant H1, H2, DEFAULT, hub.db) e cliente A
(tenant A, hub.db). Le etichette sono quelle dei «fatti misurati». Il piano non riporta
mai codici di tenant, nomi o indirizzi.
**Livello di controllo:** **completo**. È zona rossa: ricostruzione di `credentials`,
conversioni di dati dei clienti, segreti. Lo dice la regola di Riccardo del 15/10 (spec
§2): «i passi che toccano una zona rossa passano al completo».
**Stato:** piano scritto il 15/10 e corretto lo stesso giorno coi rilievi di tre
revisori (dati, copertura, eseguibilità), verificati sul codice; quelli non accolti sono
in fondo, con il perché. **Approvato da Riccardo il 15/10**: «le raccomandate e procedi»,
cioè tutte le domande D1-D12 e D1b sulla risposta raccomandata (la prima opzione, (a)),
e l'«Interfaccia proposta» così com'è. Rilasci 2c-2f: **autorizzati senza altra
conferma** quando backup, prova a vuoto sulle copie e conteggi prima/dopo tornano; ci si
ferma e si chiede solo se qualcosa non torna. La 2g resta con la conferma di Riccardo.

## Vincoli globali

- **Worktree per sotto-tappa**, sempre da `origin/dev` con la precedente già fusa:
  `git -C ~/Progetti/Domarc/DA-IPAM fetch origin && git -C ~/Progetti/Domarc/DA-IPAM worktree add .claude/worktrees/credenziali-t2<x> -b credenziali/tappa2<x> origin/dev`,
  con `<x>` = `a` … `g`. Nell'albero principale, condiviso con altre sessioni, mai `git add -A`.
- **`dev` è un rilascio al cliente A entro 15 minuti** (timer `da-ipam-update`: pull,
  build, restart). Su `dev` si arriva solo con la procedura R (sotto).
- **Gemelle (regola 12).** Ogni funzione DB toccata cambia in `src/lib/db-tenant.ts` **e**
  nella gemella di `src/lib/db.ts`. Dove questa tappa le riscrive, tutte e due diventano
  un involucro di una riga della stessa funzione pura `…Db(dbh, …)`:
  - `db.ts` usa `getDb()`, così il ripiego del facade su DEFAULT resta com'è;
  - `db-tenant.ts` usa `db()`;
  - mai riesportare da `db-tenant` una funzione che i chiamanti prendono dal facade:
    senza contesto tenant cambierebbe comportamento (`db()` lancia, `getDb()` va su
    DEFAULT, `db.ts:130`, `db-tenant.ts:1816`).
- **Import di `db-tenant`.** Si importa solo staticamente (prova
  `no-dynamic-db-tenant-import.test.ts`). `resolve.ts` tiene il suo `require`, che è
  lecito. I moduli puri nuovi non importano né `db.ts` né `db-tenant.ts`.
- **Migrazioni.** Nessun framework: sono funzioni idempotenti chiamate in fondo a
  `getTenantDb`, dopo `convertiCommunityInlineSnmp` (`src/lib/db-tenant.ts:1767-1777`) e
  prima di `tenantDbs.set` (`:1778`).
  - Ognuna sta nel suo try/catch: il tenant si apre lo stesso, ma resta `console.error`
    e il segno `errore:<messaggio>`.
  - Segni in `tenant_settings`: `credenziali_t2_tipi`, `credenziali_t2_catene`,
    `credenziali_t2_apparati`, `credenziali_t2_integrazioni` (e `credenziali_t2_pulizia`,
    scritto solo dallo script della 2g). Valori:
    - `done:<data ISO>:<conteggi>`: conversione completa;
    - `parziale:<data ISO>:<conteggi>`: conversione fatta, ma con `lasciati` o `saltate`
      non vuoti (elencati nel journal per id, a terminale per nome);
    - `errore:<messaggio>`: ROLLBACK, niente scritto.
  - **Quando si richiama.** Con `done:` o `parziale:` la conversione **non si richiama
    più**: le sorgenti vecchie restano piene fino alla 2g, quindi rigirarla annullerebbe
    le modifiche fatte nel frattempo dagli utenti (un binding tolto tornerebbe dalla
    colonna, una voce tolta dalla lista tornerebbe dalla catena congelata). Senza segno o
    con `errore:` si riprova all'apertura successiva. Il modello di oggi,
    `convertiCommunityInlineSnmp`, gira invece a ogni apertura: qui non si copia.
  - **Segni letti e scritti con l'handle `newDb`**, con una `SELECT value FROM
    tenant_settings WHERE key = ?` e una `INSERT … ON CONFLICT(key) DO UPDATE` scritte
    lì. Mai `getTenantSetting` / `setTenantSetting` (`db-tenant.ts:7340-7353`): passano
    da `db()` → `getTenantDb(code)` con la cache ancora vuota (si riempie a `:1778`), cioè
    ricorsione, connessioni lasciate aperte e un tenant che non si apre.
  - **Import.** Un import con wipe sostituisce `tenant_settings` col contenuto del bundle
    (`import.ts:52-56`, `table-registry.ts:21`), quindi cancella o riporta indietro i
    segni. Dopo la transazione di `importTenant` (`src/lib/transfer/import.ts:47-73`)
    si chiamano le conversioni **direttamente**, senza guardare i segni (i dati sono
    quelli del bundle), e poi l'import riscrive lui i segni con gli esiti. Oggi un import
    non rilancia nessuna migrazione. Con un import senza wipe (unione) le conversioni
    girano sui dati uniti: quello che aggiungono si elenca nella risposta dell'import
    (`ImportResult`), così non succede in silenzio.
  - **Prova di getTenantDb** (per ogni conversione): conversione fatta, l'utente toglie
    la riga nata dalla conversione, seconda apertura (cache svuotata con
    `closeTenantDb`) → la riga non torna.
- **Ricostruzione di `credentials`.** Parte dalla definizione attuale in `sqlite_master`
  (modello `src/lib/devices/migra-apple-macos.ts:49-100`) e aggiunge sei cose:
  1. dopo `PRAGMA foreign_keys = OFF` si rilegge il valore: se non è 0 (transazione già
     aperta) non si tocca niente e si dà errore;
  2. `sqlite_sequence` si conserva (modello `migrateScheduledJobsV8`, `db-tenant.ts:154-176`);
  3. prima e dopo si contano le righe di `credentials` e i valori non NULL di **ogni**
     colonna figlia. Le figlie si ricavano da `PRAGMA foreign_key_list` di tutte le
     tabelle, non da un elenco fisso: oggi sono 10, ma un tenant aperto per la prima
     volta dopo la 2f (DEFAULT) arriva alla ricostruzione con le 2 del T22 già aggiunte;
  4. `foreign_key_check` dopo non deve essere peggiore di prima (H1 ha già **2** orfani);
  5. indici, trigger e viste si ricreano;
  6. se qualcosa non torna, ROLLBACK.
- **Zona rossa = 2c, 2d, 2e, 2f, 2g**, che scrivono dati dei clienti. Per ognuna:
  - prova a vuoto sulle copie fatte **sul server**, con i conteggi prima e dopo;
  - **conferma di Riccardo prima del push**;
  - backup `.bak-YYYYMMDD-HHMMSS` accanto a ogni DB tenant, fatto con l'API di backup di
    SQLite, con `du`/`df` prima, **subito dopo l'ok e subito prima del push** (procedura
    R, passo 4), con l'ora annotata.

  Anche la 2b passa dalla conferma: non scrive dati, ma cambia le credenziali che le
  scansioni usano sugli apparati dei clienti.
- **Dati dei clienti.** Mai sul Mac e mai nel repo. Le copie stanno in una cartella di
  lavoro sul server, sotto `/var/tmp` (su disco: `/tmp` può essere in memoria e il DB di
  H1 pesa circa 2 GB), creata con `mktemp -d` e permessi 0700, e si tolgono alla fine.
  Nomi di apparati e di voci si leggono a terminale; nel CONTEXT vanno solo conteggi, con
  data e fonte. Un segreto non si stampa mai: al suo posto va un'**impronta**, i primi 8
  caratteri esadecimali di un HMAC-SHA256 dei byte in chiaro, con una chiave derivata da
  `ENCRYPTION_KEY` (`sha256("credenziali-t2-impronta" + ENCRYPTION_KEY)`), calcolata sul
  posto. Uno sha256 senza chiave, con community e password deboli, sarebbe un oracolo per
  un dizionario; l'HMAC resta stabile fra un giro e l'altro.
- **Script sulle copie** (`fotografia-scelte.ts`, `prova-a-vuoto.ts`, `pulizia-t2.ts` a
  vuoto). La cartella dei tenant e il percorso di `hub.db` si fissano quando i moduli si
  caricano (`db-tenant.ts:104`, `db-hub.ts:14-17`, `data-dir.ts:25`), e l'ambiente del
  servizio sulle appliance contiene `DA_INVENT_DATA_DIR` verso i dati veri
  (`appliance-systemd-install.sh:69-70`, collegato come `.env.local`). Quindi:
  1. lo script importa staticamente solo moduli di node e la guardia pura
     `src/lib/credentials/guardia-copia.ts`;
  2. imposta `process.env.DA_INVENT_DATA_DIR = <dati>` e
     `process.env.DA_IPAM_HUB_DB_PATH = <dati>/hub.db` da `--dati`;
  3. solo dopo fa `await import()` di un modulo d'appoggio
     (`scripts/credenziali/appoggio-*.ts`) che importa `db-tenant` **staticamente**. È
     lecito: l'invariante vieta solo l'import dinamico di `db-tenant` stesso
     (`no-dynamic-db-tenant-import.test.ts`, «Importare dinamicamente ALTRI moduli e'
     sano»); modello di ordine `scripts/misura-topologia.ts:59-60`;
  4. prima di aprire qualunque DB, verifica con `controllaCopia()` che `getHubDbPath()` e
     `cartellaTenant()` (nuovo getter di sola lettura di `TENANTS_DIR` in
     `db-tenant.ts`) stiano sotto il percorso reale di `--dati`, e che `--dati` non sia
     né contenga la cartella dati del servizio (letta dall'ambiente prima di
     sovrascriverlo). Altrimenti esce con un errore in italiano, codice 2, senza aprire
     niente.
  5. *(revisione della 2a)* senza `DA_INVENT_DATA_DIR` nell'ambiente (l'hub non ce
     l'ha: dati in `/opt/da-invent/data`) serve `--dati-servizio <cartella>`, e la
     guardia rifiuta i file della copia collegati (simbolici o fisici).
- **Una prova sola:** `DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test <file>`.
  - Si prova sul DB con lo schema vero: `TENANT_SCHEMA_SQL` per i DB nuovi, la
    definizione **vecchia completa**, copiata nella prova, per le migrazioni.
  - Una prova vale solo se è stata vista fallire prima del codice.
  - `credential-chains.test.ts` cade a caso nella suite intera e da sola passa (CONTEXT §6).
- **Cancello.** Si legge dal codice di uscita (`cmd; ESITO=$?`). I log vanno nello
  scratchpad, mai in `/tmp` con un nome fisso.
- **Interfaccia.** Testi visibili in italiano. Date del DB con `parseDbDate`.
  Caricamenti con `fetchJson` + `LoadError`, mai `catch { setX([]) }`. Si scrive solo
  l'interfaccia proposta qui sotto: quello che manca si propone prima di scriverlo.
- **Tipi d'archivio** (`TIPI_CREDENZIALE`, valori esatti):

  | codice | etichetta | metodi (`auth_method`, NULL = il primo) |
  |---|---|---|
  | `ssh` | SSH (password o chiave) | `password`, `chiave` |
  | `snmp` | SNMP v1/v2c | `community` |
  | `snmp_v3` | SNMP v3 | `utente_v3` |
  | `windows` | Windows (WinRM e WMI) | `password` |
  | `api` | API (token o utente) | `utente`, `token` |
  | `unifi` | Controller UniFi | `chiave`, `utente` |
  | `omada` | Controller Omada | `client`, `utente` |
  | `ad` | Active Directory | `password` |

  `linux` resta solo come alias in lettura (`normalizzaTipo("linux") === "ssh"`) e per la
  normalizzazione: dopo la 2c non esistono più voci `linux`.
- **Colonne per metodo.** Nessuna colonna cifrata nuova oltre a due, che contengono
  «encrypt» nel nome: così maschera e ricifratura le prendono da sole.

  | metodo | colonne |
  |---|---|
  | `password` | `encrypted_username` + `encrypted_password` |
  | `chiave` (SSH) | `encrypted_username` + `encrypted_private_key` + `encrypted_key_passphrase` (facoltativa) |
  | `community` | `encrypted_password` |
  | `utente_v3` | `encrypted_username`, `security_level`, `auth_protocol` + `encrypted_auth_key`, `priv_protocol` + `encrypted_priv_key` |
  | `utente` (API, UniFi, Omada) | `encrypted_username` + `encrypted_password` |
  | `token` (API) | `encrypted_username` = id del token (facoltativo), `encrypted_password` = segreto |
  | `chiave` (UniFi) | `encrypted_password` = chiave API |
  | `client` (Omada) | `encrypted_username` = client id, `encrypted_password` = client secret |
- **Regola unica tipo ↔ protocollo** (`tipiPerProtocollo`, valori esatti):

  | protocollo | tipi ammessi |
  |---|---|
  | `ssh` | `["ssh","linux"]` |
  | `winrm` | `["windows"]`, più `"ad"` solo se D7 = (b) |
  | `snmp`, `snmp_v2`, `snmp_v3` | `["snmp","snmp_v3"]` (la versione la decide la credenziale) |
  | `api` | `["api","ssh"]` (Proxmox con root, regola della tappa 1) |
  | `redfish`, `onvif` | `["api"]` |
  | protocollo sconosciuto | `["ssh","windows","api","linux"]` |

  `unifi`, `omada` e `ad` non compaiono mai qui (salvo D7 = (b)).
- **Porte standard:** `DEFAULT_PORTS` di `src/lib/credentials/porte.ts:13-20`, cioè SSH
  22, SNMP 161, WinRM 5985, API 443, Redfish 443, ONVIF 80.
- **Nomi delle voci create dalle conversioni:**
  - binding inline e colonne dell'apparato: `«<nome apparato> · <SSH|SNMP|WinRM|API|Redfish|ONVIF>»`;
  - controller: `«UniFi · <nome>»`, `«Omada · <nome>»`;
  - AD: `«AD · <nome integrazione>»`;
  - parte v3 di una SNMP ibrida: `«<nome> (v3)»`.

  Se il nome c'è già nell'archivio, o due apparati hanno lo stesso nome, si aggiunge
  `« (apparato #<id>)»`.
- **Ripieghi registrati.** I casi nuovi di `CasoRipiego` in
  `src/lib/db-maintenance/ripieghi.ts` sono `cred_colonna_apparato`,
  `cred_binding_inline`, `cred_catena_vecchia`, `cred_chiave_hub`,
  `cred_riga_integrazione`, `cred_public`, `cred_v3_vecchia`. Il registro, un JSONL al
  giorno tenuto 30 giorni, è la misura che apre la 2g, per tutti i casi tranne
  `cred_public` (che con D5 = (a) resta per sempre). Il registro scrive solo caso,
  tenant, firma del chiamante e conteggi a scalini (1, 10, 100…, `ripieghi.ts:168-212`):
  si verifica per firma e conteggio, mai per apparato. Gli apparati si contano dalla
  fotografia.
- **Le verifiche non registrano.** I controlli dentro le conversioni, la fotografia e la
  prova a vuoto chiamano il motore con `registra: false` (o le funzioni non pubbliche
  `credenzialiApparatoDb` + `leggiSegretoDb`): altrimenti il controllo stesso
  scriverebbe ripieghi a ogni apertura e il registro non arriverebbe mai a zero.
- **Per ogni sotto-tappa:** CHANGELOG.md (Keep a Changelog, italiano, **il perché**)
  prima del commit di rilascio, e CONTEXT.md §6 con una voce datata.

## Copertura della spec (§3, tappa 2)

| Requisito | Task |
|---|---|
| Tipi per esteso (SSH, SNMP v1/v2c, SNMP v3, Windows, API, UniFi, Omada, AD) | T2, T11, T13 |
| `linux` confluisce in SSH | T2 (alias), T11 (normalizzazione), T12 (lettori e scrittori) |
| SSH password **o chiave** · API token **o utente** | T14, T20 (token Omada) |
| Windows WinRM e WMI con lo stesso account (WMI passa da WinRM come oggi) | T2 (un tipo solo); il ripiego WMI di `device-info.ts:1473-1494` non cambia |
| Controller e AD prendono la credenziale dall'archivio; le loro credenziali si spostano | T22, T23, T24, T25 |
| Catene di rete unificate su `network_credentials`, catene vecchie convertite | T16, T17, T18, T27 |
| Un solo motore (`resolve.ts`), anche per l'acquisizione, al posto delle funzioni che scelgono | T7, T8, T9, T10, T17 (tabella sotto) |
| Binding inline → voci d'archivio col nome dell'apparato | T19 |
| SNMPv3 completo: chiave da `encrypted_auth_key`, protocolli dalla credenziale, ramo v3 nelle prove | T3, T4 |

## Le funzioni che oggi scelgono una credenziale, e dove vanno

Nella colonna «Dove», la coppia `db.ts / db-tenant.ts` indica le due gemelle.

| # | Funzione | Dove | Chiamanti | Diventa | Task |
|---|---|---|---|---|---|
| 1 | `resolveCredentialsForDb` / `…For` / `resolveCredentialFor` | `credentials/resolve.ts:162`, `:322`, `:338` | `discovery.ts:1484`, `:1601`, `:1915`, `:2415` (solo il fermo); `software-runner.ts:132-133`; gemelle 2-4 | il motore, allargato | T7 |
| 2 | `getOrderedDetectCredentialIds` | `db.ts:3984` / `db-tenant.ts:4098` | `discovery.ts:1440`; `vuln/edge-credentials-bridge.ts:162` | involucro del motore, senza la chiave dell'hub dopo la 2d | T7, T17 |
| 3 | `getOrderedSshLinuxCredentialIds` | `db.ts:4006` / `db-tenant.ts:4121` | `discovery.ts:1563`, `:1888`; `edge-credentials-bridge.ts:159` | come la 2 | T7, T17 |
| 4 | `buildSnmpCommunitiesForNetwork` / `…ForHost` | `db.ts:4027`, `:4060` / `db-tenant.ts:4143`, `:4179` | `edge-credentials-bridge.ts:190`; `discovery.ts:949`, `:1284`, `:1348`, `:1767`, `:1812`, `:2025`, `:2255` | `communitySnmpDb` del motore: solo community, mai v3, ripieghi dichiarati (D5) | T7 |
| 5 | `getDeviceCredentials` | `db.ts:4517` / `db-tenant.ts:4685` | `switch-client.ts:98`, `router-client.ts:124`, `device-info.ts:365`, `:1282`, `:1465`, `nas-acquisition.ts:505`, `winrm-client.ts:19`, `vendor-interface-probes.ts:21`, `acquisition/mikrotik.ts:20`, `run-proxmox-device-scan.ts:125`, `device-connection-test.ts:128` | involucro di `scegliSegretoApparatoDb` | T8 |
| 6 | `getDeviceCommunityString` | `db.ts:4479` / `db-tenant.ts:4651` | `device-info.ts:310`, `:315`, `:1503`, `:1544`; `switch-client.ts:261`; `router-client.ts:300`; `interface-probe.ts:95`, `:213`; `scanner/snmp-query.ts:350`; `api/devices/[id]/query/route.ts:286`; `api/networks/bulk-scan-devices/route.ts:160` | `credenzialeSnmpApparato` | T8 |
| 7 | `getDeviceSnmpV3Credentials` | `db.ts:4452` / `db-tenant.ts:4630` | `snmp-query.ts:346`, `:365`; `router-client.ts:289`; `interface-probe.ts:84`; `device-info.ts:300`, `:1440`; `switch-client.ts:89`, `:250` | lettura completa (T3), poi `credenzialeSnmpApparato` + `apriSessioneSnmp` | T3, T4, T8 |
| 8 | `getBestCredentialBindingForDevice` | `db-tenant.ts:7649` | `software-runner.ts:200` | tolta: la sostituisce il motore | T9 |
| 9 | `resolveTarget` (inventario software) | `probes/software-runner.ts:120-250` | rotte `software-scan` di host e apparato | motore; tipo `ssh` accettato | T9 |
| 10 | `resolveCredentials` (prova di connessione) | `devices/device-connection-test.ts:126-149` | `api/devices/[id]/test`, `api/devices/test-provisional` | motore; l'apparato provvisorio usa la voce scelta | T8 |
| 11 | `loadWinrmCredentialsForHost` / `loadSshCredentialsForHost` | `patch/credentials.ts:49`, `:150` | `patch/executor.ts:328`, `:419`, `:505`, `:622`, `:702`, `:861`, `:985`; `patch/log-tailer.ts:134`; `ssh-terminal/ws-handler.ts:52`; `api/ssh-terminal/token/route.ts:33` | motore per host, con il fermo, sulle stesse fonti di oggi (righe host, poi ripiego AD dichiarato, D4); i binding dell'apparato **no** | T9 |
| 12 | la stessa regola in SQL (CTE `winrm_status` e `ad_winrm_available` dentro query di elenco) | `api/patch/device/route.ts:163-176`, `api/patch/device/[hostId]/route.ts:110-121`, `api/patch/software/[softwareKey]/route.ts:213-224`, `api/patch/cve/[cveId]/hosts/route.ts:78-89` | pagine patch | `hostConCredenzialeWinrmDb(dbh): Set<number>`, una query sola, stesse regole del loader | T9 |
| 13 | `collectEdgeCredentialsForNetwork` | `vuln/edge-credentials-bridge.ts:123-224` | `edge-subnet-bridge.ts:143`, `:293` | stessi slot, fonti dalla lista della rete via motore | T17 |
| 14 | pin a corto circuito della discovery | `discovery.ts:1471-1472`, `:1580-1593`, `:1901-1911` | rilevamento `windows`, `ssh`, `ipam_full` fase 4 | motore per host (D2) | T17 |
| 15 | porta SSH di Proxmox | `proxmox/proxmox-targets.ts:14-23`, `run-proxmox-device-scan.ts:125-158`, `device-connection-test.ts:205` | `hypervisor_sync`, `proxmox-scan`, prova | porta del candidato SSH del motore, mai `device.port` (che è la porta dell'API) | T8 |
| 16 | «ha SNMP?» | `device-acquisition-resolve.ts:176-183`, `device-info.ts:1440-1454`, `switch-client.ts:84-95`, `router-client.ts:113-121`, `interface-probe.ts:209-214`, `api/devices/[id]/query/route.ts:557` | acquisizione | `haSnmpApparato(device)`: vero solo con una fonte **dell'apparato** (livelli 1-5), mai con la catena della rete o il ripiego | T8 |
| 17 | LibreNMS | `integrations/librenms-sync.ts:317-318` (aggiornamento) e `:348-349` (`addDevice`) | aggiunta e aggiornamento apparato | community dal motore, **decifrata** (oggi parte il testo cifrato), solo se `haSnmpApparato`; altrimenti `snmp_disable: true` come oggi | T8 |
| 18 | token API di Omada | `devices/router-client.ts:774-806` | acquisizione dei router Omada | token dal motore (voce `api`, metodo `token`) | T20 |
| 19 | controller | `controllers/service.ts:469-478`, `:496-518` | `unifi_sync`, prova | voce scelta, letta da `segreti.ts` | T23 |
| 20 | AD (LDAP) | `ad/ad-client.ts:70-105`; `api/ad/kerberos/route.ts:195-196`, `:262-263`; `integrations/self-identity.ts:102-107` | `ad_sync`, salute, Kerberos, Wazuh | `credenzialeLdapDi(integrazione)` | T24 |
| 21 | AD (WinRM: DHCP e sonda) | `ad/ad-client.ts:427-442`; `ad/health/winrm-probe.ts:176-195` | `ad_sync`, salute | voce `windows` da `segreti.ts`; porta della voce invece della 5985 fissa | T24 |
| 22 | chiavi globali dell'hub | `db-tenant.ts:4108-4112`, `:4130-4133` (copie in `db.ts:3994`, `:4015`); `getHostWindowsCredentials` / `getHostLinuxCredentials` (`db-tenant.ts:3927-3951`, `db.ts:3813-3837`, senza chiamanti) | catene 2 e 3 | secondo D3, poi tolte | T12, T16, T17, T27 |

Le scelte 19-21 sono esplicite: una voce, scelta da chi configura. Non serve un ordine,
e le legge `segreti.ts`, lo stesso lettore del motore.

## Interfaccia proposta (da approvare insieme al piano)

1. **Pagina Credenziali.**
   - Tendina «Tipo» con le otto etichette per esteso.
   - «Metodo» solo per i tipi che ne hanno due, poi i campi di quel metodo; SNMP v3 è
     una scheda a sé (utente, livello, protocollo e chiave di autenticazione, protocollo
     e chiave privacy).
   - Colonna «Usata da» col numero degli usi.
   - Con D8 = (a), «Elimina» su una voce in uso mostra l'elenco degli usi invece di
     cancellare.
2. **Finestra del controller.** Al posto di utente/password/chiave c'è una tendina
   «Credenziale» filtrata per tipo di controller:
   - console UniFi OS → UniFi con chiave;
   - self-hosted → UniFi con utente.

   Accanto, «Nuova nell'archivio» apre i campi e crea la voce al salvataggio.
3. **Pagina Active Directory.** «Account LDAP» diventa una tendina di voci AD, con
   «Nuova nell'archivio». La tendina WinRM/DHCP resta sulle voci Windows (D7). Con
   D12 = (a), se si cambia l'indirizzo del DC la tendina si svuota e chiede di scegliere
   di nuovo la voce («L'indirizzo del DC è cambiato: scegli di nuovo l'account»).
4. **Impostazioni → Sistema.** La scheda «Credenziali host di default» si toglie (D3).
5. **Scheda dell'apparato.** Il riquadro «Credenziali archivio per protocollo»
   (`devices/[id]/page.tsx:519-576`) legge la scelta del motore e si intitola «Usata
   adesso». Oggi legge le colonne vecchie, mentre la tabella sotto mostra i binding: due
   risposte diverse sulla stessa pagina.
6. **Tendine che mostrano il codice grezzo** («(linux)», «(snmp)»): mostrano l'etichetta
   per esteso.
7. **Tabella credenziali dell'apparato.** Il pulsante «Inline» diventa «Nuova» e la voce
   finisce nell'archivio col nome dell'apparato («Salvata nell'archivio come …»). La
   finestra unica è della tappa 3.
8. **Modifica in blocco e modifica del singolo apparato (dalla 2e).** Scegliere una voce
   per un protocollo la **aggiunge** in testa ai binding di quel protocollo (non
   provata); i binding che ci sono restano, con la loro storia di prova. «Nessuna»
   toglie i binding di quel protocollo, dopo una conferma che ne dice il numero («Togli
   12 binding Windows da 20 apparati, di cui 5 riusciti?»). Un campo lasciato su «Non
   modificare» non si manda. *Fatto da confermare:* con D1 = (a) la voce aggiunta si
   usa prima degli altri binding non provati ma **dopo** quelli riusciti; per sostituire
   una credenziale che funziona la si toglie dalla tabella dell'apparato.
9. **Anteprima edge.** Una voce SSH a chiave nella lista della rete compare con
   «Non inviata allo scanner: chiave SSH» (`selected_for_scan: false`), invece di partire
   con la password vuota o sparire.

## Casi da non dimenticare

1. **Ricostruzione con le chiavi esterne attive.** Cancellerebbe a cascata **154** righe
   in H1 e **62** in A. Il `foreign_key_check` dopo deve tornare **2** in H1 (orfani di
   `host_credentials` già presenti), non 0. Coperto da T11 e T15.
2. **DEFAULT dell'hub ha lo schema vecchio** (`credentials` senza `port`,
   `network_devices` senza `snmp_version`). Quindi:
   - la ricostruzione viene dopo gli ALTER, in fondo a `getTenantDb`;
   - la prova a vuoto include DEFAULT;
   - la prova copre anche le **due** forme che un DEFAULT nato dal vecchio `ipam.db` può
     avere: quella di `db.ts:261-274` (nome senza virgolette, 3 tipi) più gli ALTER
     di `:278-286`, e quella nata dalla ricostruzione di `db.ts:650-662` (RENAME di
     `credentials_host_new`, quindi nome fra virgolette in `sqlite_master`, 5 tipi e 7
     colonne) più gli ALTER.

   Coperto da T11 e T15.
3. **Le colonne vecchie di `network_devices` sono l'unico accesso** per 6 apparati in H1
   e 1 in A, e oggi il PATCH in blocco con «Non modificare» le azzera (T5); lo stesso fa
   il salvataggio delle tre finestre di modifica del singolo apparato, che mandano
   sempre `credential_id: null` se la tendina è vuota (T5). Il motore le legge finché la
   2e non le converte (T7). La 2e le trasforma in binding e, nella stessa transazione,
   svuota le colonne che ha convertito (T19): per i 6 apparati `snmp_v2` di H1 con
   porta 22, il binding SNMP nasce sulla **161**.
4. **La credenziale WinRM dell'AD è condivisa.** In A fa da ripiego per le patch su 161
   host, ed è anche in 6 reti e 7 binding. Il suo id non cambia: nell'archivio entra
   solo l'account LDAP (T22, T24).
5. **Nomi doppi e binding multipli.** In A due apparati hanno lo stesso nome; in H1 ci
   sono 2 gruppi con più binding sulla stessa terna (apparato, protocollo, porta). I nomi
   delle voci si rendono unici con `« (apparato #id)»` e i segreti uguali non si
   raggruppano: così l'UNIQUE dei binding non scatta (T19).
6. **hub.db di A ha ancora 7 chiavi `integration_unifi_*`** e il segno `done`.
   `migrateLegacyUnifiConfig` non deve ripartire. Un tenant aperto per la prima volta
   dopo la 2f (DEFAULT, o uno nuovo) nasce già con la voce in archivio (T23).
7. **`main` arriva ad altre appliance mai misurate.** Le forme che qui valgono 0 hanno
   ognuna una regola esplicita: v3, ibride, v3 «vecchie», `api_token`, Omada, inline
   incompleti. Una forma sconosciuta si lascia com'è, si elenca e mette il segno
   `parziale:`, senza indovinare (T11, T19, T22). Su quelle appliance le conversioni
   2c-2f girano tutte alla prima apertura dopo l'aggiornamento (`update.sh:109-136` fa
   build e riavvio, nessun backup); la pulizia dei dati no, perché è uno script (T27).
8. **Bundle esportati prima della tappa 2.** `importTenant` rilancia le conversioni e
   riscrive i segni. Dopo il DROP della 2g converte in memoria le righe delle tabelle
   tolte (T11, T16, T19, T22, T26).
9. **Le sorgenti vecchie restano piene mentre il nuovo è già scritto** (catene congelate
   fino alla 2g, colonne di controller e AD fino alla 2g). Per questo una conversione col
   segno non si richiama (vincoli, «Migrazioni»), uno spostamento d'indirizzo svuota
   anche le colonne della riga, e il ripiego sulle colonne di controller e AD vale solo
   per le righe mai convertite, cioè col segno diverso da `done:` (T23, T24).

## Fatti da confermare (misurati, non domande)

- **F1.** In A, 2 binding e 3 colonne `api` di Proxmox puntano a una voce di tipo SSH.
  Restano validi: lo dice la regola della tappa 1 (`api` → `api`, `ssh`).
- **F2.** In A, 1 apparato `snmp_v2` ha nella colonna una voce `windows`.
  - Oggi `getDeviceCredentials` la usa come login, perché ripiega sulla colonna senza
    guardare il tipo.
  - Dalla 2b il filtro di tipo non la propone più per SSH.
  - La 2e la trasforma in un binding WinRM sulla 5985, e lo elenca per nome.
- **F3.** In H1, 6 apparati `snmp_v2` hanno porta 22. Il codice SNMP la ignora già e usa
  la 161. Non si corregge nessun dato: i binding SNMP nascono sulla 161.
- **F4.** La misura #31 (dove puntano le chiavi globali dell'hub in ogni tenant) è
  fallita il 15/10. Si rifà nel T1, e il suo esito serve a D3 e fissa i conteggi della
  2d (N in A, reti di H1 che perdono la chiave). La raccomandazione di D3 vale qualunque
  sia l'esito; cambia solo quante righe si toccano.
- **F5.** Oggi l'acquisizione di un apparato non arriva mai a host, rete o hub:
  `getDeviceCredentials` legge binding → colonne → niente, `getDeviceCommunityString`
  binding → colonne → `community_string` → «public» (`db-tenant.ts:4651-4722`); le patch
  leggono righe host → account AD, mai i binding (`patch/credentials.ts:54-87`). Gli
  apparati senza nessun binding sono 16 in H1 (api 11, snmp_v2 5) e 74 in A (api); quelli
  senza `host_id` 2 in H1 e 4 in A. È la base di D1b.

## Domande per Riccardo, tutte insieme

La prima opzione è quella raccomandata. Le decisioni della spec §2-§3 non si rimettono
in discussione: qui c'è solo ciò che codice e misure non decidono.

**In breve.** Per accettarle tutte basta rispondere «le raccomandate»; per cambiarne una,
il suo numero e la lettera.

| # | La domanda | Raccomandata |
|---|---|---|
| D1 | Per un apparato vince la credenziale scelta sull'apparato o quella validata sull'host? | quella dell'apparato: prima i binding riusciti, poi i non provati |
| D1b | L'acquisizione degli apparati usa anche host, rete e hub? | no: solo le fonti dell'apparato, come oggi |
| D2 | Nella discovery, se la credenziale che funzionava fallisce? | la si mette in fermo e si prova il resto della catena, entro il tetto |
| D3 | Le due credenziali «di default» dell'hub | copiate nelle reti del cliente A, poi tolte; sull'hub no (due tenant) |
| D4 | L'account WinRM dell'AD come ripiego per patch e terminale | resta, dentro il motore e col fermo |
| D5 | I «public» e le community di ripiego SNMP | restano, ma dichiarati e registrati |
| D6 | Fin dove arrivano chiave SSH e token API | trasporto SSH principale e Omada; paramiko e terminale rifiutano con un messaggio |
| D7 | L'account dell'Active Directory | un tipo a sé, mai nelle tendine WinRM |
| D8 | Eliminare o cambiare tipo a una voce in uso | rifiutato, con l'elenco degli usi |
| D9 | Quando si toglie il vecchio | 14 giorni dopo la 2f, coi ripieghi a zero, con uno script e la tua conferma |
| D10 | Un binding che ha fallito la prova | saltato finché una prova non riesce |
| D11 | Quale porta usa l'acquisizione | quella dell'apparato, come oggi (salvo SNMP e SSH di Proxmox) |
| D12 | Si cambia l'indirizzo del DC dell'AD | la credenziale si scollega e va scelta di nuovo |

**D1 — Per un apparato, quale credenziale vince?**
- **(a)** La scelta fatta sull'apparato: prima i binding riusciti, poi quelli non
  provati, poi le colonne vecchie; poi le validate sull'host; poi la rete (per
  l'acquisizione, gli ultimi due solo se D1b = (b)). Cosa fare di un binding fallito lo
  decide D10.
- (b) Prima le validate sull'host, poi i binding (l'ordine attuale di `resolve.ts`).
- (c) Come fa oggi l'acquisizione: il primo binding in ordine, anche se fallito.

*Perché (a):* è l'unica in cui una correzione fatta sull'apparato (il problema 3 della
spec) ha effetto subito. Sul dato del 15/10 l'ordine cambia la scelta solo per i 4
apparati di H1 il cui primo binding è fallito, che oggi usano una credenziale che non
funziona, e per 0 apparati in A (il filtro di tipo cambia in più l'apparato di F2, con
qualunque opzione). Con (b) ne cambierebbero 6 in H1: ai 4 si aggiungono 2 apparati SSH
in cui la validata dell'host prenderebbe il posto della credenziale usata oggi. Questi
conteggi valgono con D1b = (a). Cosa succede a un binding fallito lo decide D10.
*Ne dipendono:* T7, T8, T9 e le differenze attese al T10.

**D1b — L'acquisizione degli apparati arriva anche a host, rete e hub?** (livelli 6-11
del motore, vedi F5)
- **(a)** No. Per acquisizione, «ha SNMP?», LibreNMS e Omada il motore usa solo le fonti
  dell'apparato (livelli 1-5) e, per SNMP v1/v2c, il «public» di oggi (D5). I livelli
  6-11 servono alla discovery, alla validazione e alle prove (tappa 3), cioè dove si
  cerca una credenziale, non dove la si usa.
- (b) Sì, per tutti gli apparati che non hanno una scelta propria: righe host validate,
  catena della rete, catene vecchie, chiave dell'hub.

*Perché (a):* lascia l'acquisizione com'è. Con (b), sul dato del 15/10 (la catena di ogni
rete ha una voce SNMP, e per `api` la regola tipo ↔ protocollo ammette `ssh`):
- i 74 apparati `api` senza binding di A e gli 11 di H1 riceverebbero come login API una
  voce SSH della catena;
- gli apparati che oggi interrogano con «public» passerebbero alla community della
  catena, `haSnmp` diventerebbe vero quasi ovunque e il piano di acquisizione di access
  point, firewall e stampanti passerebbe a `snmp_peripheral`
  (`device-acquisition-resolve.ts:176-183`).

Il T1 conta, tenant per tenant e livello per livello, quanti apparati cambierebbero con
(b): se la risposta è (b), quei conteggi diventano le differenze attese della 2b.
*Ne dipendono:* T7, T8, T10.

**D2 — Nella discovery, se la credenziale che ha già funzionato su un host fallisce?**
- **(a)** Si prova per prima. Se fallisce va in fermo e si passa al resto della catena
  della rete, entro il tetto di tentativi per credenziale che la discovery ha già
  (`CredentialRunBudget`). Il pin diventa una riga validata dell'host e sparisce: sul
  dato del 15/10 non nasce nessuna riga, perché i 16 pin di H1 l'hanno già.
- (b) Come oggi: con un pin si prova solo quello.
- (c) (a) per SSH e SNMP, (b) per Windows.

*Perché (a):* oggi un host la cui password è cambiata non riprova mai la catena, e resta
non rilevato per sempre. Il rischio vero sono gli accessi falliti sugli account di
dominio, e lo limitano il tetto per credenziale e il fermo.
*Ne dipendono:* T17, T18.

**D3 — Le credenziali «di default» dell'hub** (`host_windows_credential_id`, `host_linux_credential_id`).
- **(a)** Si copiano in coda alla lista di ogni rete dove l'id esiste nel tenant, è del
  tipo giusto e manca. Solo con un tenant attivo, cioè sul cliente A; sull'hub (due
  tenant attivi) non si copiano e il log lo dice. Poi le chiavi e la scheda in
  Impostazioni si tolgono.
- (b) Diventano un'impostazione del tenant, cioè una catena predefinita che il motore
  mette in coda.
- (c) Si tolgono senza copiarle.

*Perché (a):* sono id del DB del tenant salvati nell'hub, quindi lo stesso numero indica
voci diverse nei due tenant dell'hub, e si accodano senza controllo di tipo. (a) conserva
quello che fanno oggi dove si sa a chi appartengono. Se la misura #31 dice che in A l'id
è già in ogni lista, (a) e (c) coincidono.
*Cosa vuol dire sull'hub:* oggi le due chiavi si accodano alle catene SSH e Windows di
**ogni** rete di H1 (`db-tenant.ts:4108-4112`, `:4130-4133`) e da lì vanno
all'anteprima edge, cioè a GVM (`edge-credentials-bridge.ts:159-163`). Con (a) sull'hub
non si copiano, quindi nelle reti di H1 dove l'id non è già nella lista quella voce
**sparisce** dalla validazione, dalla discovery e dalle scansioni autenticate. Il T1
(misura #31) dice in quante reti; il T18 le elenca per nome e servono il tuo ok. In H2 e
DEFAULT le chiavi non puntano a nessuna voce, e spariscono già con la 2b (filtro di
tipo). La raccomandazione vale qualunque sia l'esito della #31.
*Ne dipendono:* T16, T17, T18, T27.

**D4 — Patch e terminale: l'account WinRM dell'AD come ripiego per ogni host Windows.**
- **(a)** Resta, come ultimo livello WinRM del motore e solo per patch e terminale. Si
  rispetta il fermo dopo i fallimenti e la fonte «ripiego AD» è visibile.
- (b) Si toglie.

(L'opzione «resta com'è, fuori dal motore» non c'è: la spec §3 vuole un solo motore al
posto delle funzioni che scelgono, e la scelta delle patch è una di quelle.)

*Perché (a):* oggi lo usano 40 host in H1 e 161 in A, e toglierlo fermerebbe le patch su
quegli host. Nel motore smette di partire verso un host in fermo, cosa che oggi succede.
*Ne dipendono:* T7, T9.

**D5 — I ripieghi SNMP impliciti** (community della rete, public/private in coda, «public» sugli apparati senza community).
- **(a)** Per v1/v2c restano come oggi, ma il motore li dichiara come fonte «ripiego» e
  li registra. Mai verso un apparato con credenziale v3.
- (b) «public» solo sugli apparati che hanno SNMP come protocollo o una credenziale SNMP;
  gli altri non si interrogano in SNMP.
- (c) Diventano voci d'archivio esplicite nella lista di ogni rete, e il ripiego
  implicito sparisce.

*Perché (a):* togliere «public» cambia i dati raccolti sugli apparati che oggi rispondono
solo così. In A ci sono 74 apparati Ubiquiti senza binding, e il T1 conta quanti
ricevono «public». (a) non cambia la raccolta ma la rende visibile; (b) e (c) si decidono
dopo, con quella misura.
*Ne dipendono:* T7, T8.

**D6 — Fin dove arrivano la chiave SSH e il token API?** Oggi nessuna voce li usa.
- **(a)** Archivio e pagina, più:
  - la chiave SSH nel trasporto ssh2 (prove, discovery, acquisizione);
  - il token letto dal client API di Omada;
  - il ponte paramiko (patch e inventario Linux) e il terminale web rifiutano una voce a
    chiave con un messaggio chiaro.

  Formati OpenSSH e PEM (RSA, ECDSA, ed25519), passphrase facoltativa, fino a 16 KB.
- (b) Ovunque, compresi paramiko, terminale e token di Proxmox (`PVEAPIToken`).
- (c) Solo archivio e pagina, inutilizzabili finché non serve.

*Perché (a):* copre la spec («SSH password o chiave», «API token o utente») dove passa
quasi tutto il traffico SSH, senza toccare i due percorsi Python per un bisogno che oggi
è a zero.
*Ne dipendono:* T14, T20.

**D7 — L'account dell'Active Directory.**
- **(a)** Una voce di tipo «Active Directory», usata solo dall'integrazione: LDAP, kinit
  e prova WinRM di Kerberos, come oggi. WinRM/DHCP e le catene accettano solo voci
  Windows. Se lo stesso account di dominio serve nei due modi, le voci sono due.
- (b) Una voce sola per l'account di dominio: l'AD accetta anche voci Windows, e le
  tendine WinRM anche voci AD.

*Perché (a):* un account AD nelle tendine WinRM finisce nelle catene e nelle prove in
sequenza della tappa 3, cioè in accessi falliti proprio con l'account più delicato.
*Ne dipendono:* T2 (regola WinRM), T22, T24.

**D8 — Eliminare una voce in uso, o cambiarle tipo.**
- **(a)** L'eliminazione si rifiuta con l'elenco degli usi (apparati, reti, host,
  controller, AD), e anche il cambio di tipo di una voce in uso si rifiuta.
- (b) L'eliminazione chiede conferma mostrando l'elenco. Poi binding e catene spariscono,
  e controller e AD si fermano con un messaggio.
- (c) Come oggi: cancellazione a cascata, in silenzio.

*Perché (a):* oggi cancellare una voce toglie in silenzio i binding e spegne il DHCP
dell'AD, e dopo la tappa 2 toccherebbe anche controller e AD.
*Ne dipendono:* T13, T23, T24.

**D9 — Quando si toglie il vecchio (2g)?**
- **(a)** Almeno 14 giorni dopo la 2f (data scritta nel segno `credenziali_t2_integrazioni`),
  con a zero su hub e cliente A i ripieghi `cred_colonna_apparato`,
  `cred_binding_inline`, `cred_catena_vecchia`, `cred_chiave_hub`,
  `cred_riga_integrazione` e `cred_v3_vecchia` (non `cred_public`, che con D5 = (a)
  resta). A quel punto lo script di pulizia, a vuoto e poi con `--applica` e la tua
  conferma per il live, fa un backup, svuota i segreti rimasti nelle colonne vecchie e
  toglie le tabelle delle catene vecchie e le chiavi dell'hub.
- (b) Come (a) per i segreti (colonne svuotate, che restano vuote), ma le tabelle delle
  catene vecchie e le chiavi dell'hub, che non contengono segreti, restano dove sono,
  non più lette; la pulizia del codice si fa lo stesso.
- (c) Subito, nello stesso rilascio di ogni conversione.

(L'opzione «colonne e tabelle vecchie congelate per sempre» non c'è: lascerebbe per
sempre copie dei segreti in `network_devices`, `network_controllers` e
`ad_integrations`, contro l'archivio unico della spec §2 e lo spostamento delle
credenziali di controller e AD della spec §3.)

*Perché (a):* fino alla 2g si può tornare alla versione precedente coi dati vecchi. In 14
giorni passano decine di giri di `ad_sync` (ogni 6 ore) e delle letture UniFi (ogni ora),
e il registro dei ripieghi dura 30 giorni.
*Ne dipendono:* T26, T27.

**D10 — Un binding che ha fallito la prova.**
- **(a)** Si salta finché una prova non riesce, come fa già oggi il motore per la
  discovery (`resolve.ts:215-224`, «failed esclusi a monte»). La scheda dell'apparato lo
  dice («Binding fallito il <data>: escluso finché la prova non riesce»), e «Usata
  adesso» mostra quale voce lo sostituisce, o «nessuna».
- (b) Fermo come per le righe host: si salta per lo stesso tempo di fermo, contato da
  `tested_at` (nessuna colonna nuova), poi torna candidato dopo gli altri.
- (c) Come fa oggi l'acquisizione: il primo binding in ordine, anche se fallito.

*Perché (a):* un tentativo WinRM sbagliato è un accesso fallito vero su un account di
dominio, e (a) non ne aggiunge. Il prezzo: dei 4 apparati di H1 col primo binding
fallito (3 WinRM, coi messaggi nascosti dalla maschera, forse timeout) nessuno ha un
binding riuscito, quindi con (a) restano senza quella credenziale finché qualcuno non
ripete la prova dalla scheda; con (b) la riprovano da soli dopo il fermo.
*Ne dipendono:* T7, T8, T10.

**D11 — Quale porta usa l'acquisizione?**
- **(a)** Per il protocollo principale la porta dell'apparato (`device.port`), come oggi.
  La porta del candidato vale per SNMP (161, o la porta della voce o del binding) e per
  l'SSH di Proxmox (riga 15 della tabella), dove `device.port` è la porta dell'API.
- (b) Sempre la porta del candidato (voce o binding), anche per il protocollo principale.

*Perché (a):* sul dato del 15/10 nessun binding del protocollo principale ha una porta
diversa da quella dell'apparato, salvo i 6 `snmp_v2` di H1 a porta 22, che (a) già
tratta (SNMP sulla 161). (b) diventa utile solo con D1b = (b), quando arrivano voci di
host e rete con una porta propria (SSH su 2022). Con (a), `getDeviceCredentials` resta
utente e password più, con D6, la chiave.
*Ne dipendono:* T7, T8.

**D12 — Si cambia l'indirizzo del DC dell'Active Directory.**
- **(a)** Come per i controller: la voce si scollega (`credential_id` NULL) e le colonne
  della riga si svuotano, a meno che la stessa richiesta non scelga di nuovo una voce.
  Finché non la si sceglie, l'AD dice «Credenziale mancante».
- (b) Come oggi per l'AD (`api/ad/[id]/route.ts:62-66`): cambiare `dc_host` non tocca la
  credenziale.

*Perché (a):* impedisce di mandare l'account di dominio, col bind LDAP, a un indirizzo
nuovo senza che nessuno l'abbia scelto (un errore di battitura, o una sessione rubata).
Il prezzo è un clic in più quando il DC cambia davvero. Con (b) lo scollegamento non si
introduce affatto, e T24 non lo scrive.
*Ne dipendono:* T24, interfaccia punto 3.

## Procedura R — rilascio di una sotto-tappa

0. **Ramo pubblicato**, prima di tutto il resto:
   `git -C <worktree> fetch origin && git -C <worktree> rebase origin/dev` (si rilegge
   `origin/dev`: altre sessioni) e poi `git -C <worktree> push -u origin credenziali/tappa2<x>`
   (se il ramo era già pubblicato e il rebase l'ha cambiato, `--force-with-lease` sul solo
   ramo della sotto-tappa, mai su `dev`). Il passo 2 prende il codice da lì.
1. **Cancello**, una volta, nel worktree:
   ```bash
   S=<scratchpad>; npm run lint > "$S/lint.log" 2>&1; L=$?; npx tsc --noEmit > "$S/tsc.log" 2>&1; T=$?
   DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" npm test > "$S/test.log" 2>&1; P=$?
   npm run build > "$S/build.log" 2>&1; B=$?; echo "lint=$L tsc=$T test=$P build=$B"
   ```
   Si va avanti solo con tutti e quattro a 0.
2. **Prova a vuoto e fotografia sul server, sullo stesso istante del dato**, un solo
   comando ssh per macchina (hub e cliente A; accessi in `ACCESSI.md` e vault, skill
   `deploy-prod`):
   - cartella di lavoro `L=$(mktemp -d /var/tmp/credenziali-t2.XXXXXX)` (0700); `df -h`
     di `/var/tmp` e `du -h` dei DB: servono **due** copie, e il DB di H1 pesa circa 2 GB;
   - **una** copia di `hub.db` e di tutti i DB tenant in `$L/x` con
     `scripts/credenziali/copia-dati.ts` (API di backup di SQLite; mai `cp` di un DB in
     WAL), e da quella due copie identiche, `$L/prima` e `$L/dopo`: sono lo stesso
     istante, quindi ogni differenza fra le due fotografie viene dal codice e non dal dato
     cambiato nel frattempo;
   - due alberi di codice: `git archive origin/dev | tar -x -C $L/codice-prima` (per la 2a
     il commit del T1, cioè `origin/dev` più il solo script della fotografia) e
     `git archive origin/credenziali/tappa2<x> | tar -x -C $L/codice-dopo`, ognuno con
     `node_modules` collegato a quello dell'app. Il ramo della sotto-tappa sul server non
     c'è: gli archivi si fanno sul Mac dai riferimenti di `origin` e si copiano in `$L`,
     oppure sul server dopo `git -C <cartella app> fetch origin dev credenziali/tappa2<x>`
     (tocca solo i riferimenti, non l'albero che il servizio usa);
   - ambiente del servizio caricato senza stamparlo (serve `ENCRYPTION_KEY`); gli script
     sovrascrivono loro `DA_INVENT_DATA_DIR` e `DA_IPAM_HUB_DB_PATH` da `--dati` e si
     fermano se un percorso cade fuori (vincoli, «Script sulle copie»);
   - da `codice-prima`: `fotografia-scelte.ts --dati $L/prima --out $L/prima.jsonl`;
   - da `codice-dopo`: `prova-a-vuoto.ts --dati $L/dopo` (dalla 2c). Per ogni tenant:
     1. conta in sola lettura **prima**;
     2. apre la copia con `getTenantDb` del ramo, quindi con tutte le migrazioni, come al
        riavvio vero;
     3. conta **dopo** e stampa gli esiti, coi nomi a terminale;
     4. chiude e riapre: la seconda apertura non deve cambiare niente;
   - da `codice-dopo`: `fotografia-scelte.ts --dati $L/dopo --out $L/dopo.jsonl`, poi
     `--confronta $L/prima.jsonl $L/dopo.jsonl` (campi confrontati: vedi T1);
   - le fotografie si conservano come storico in `/var/tmp/credenziali-t2/fotografie/`
     (cartella 0700 dell'utente del servizio, file 0600) fino alla 2g; le copie si tolgono
     (`rm -rf "$L"`) e lo si verifica con `test ! -e "$L"`.
3. **Conferma di Riccardo** (2b-2g): un messaggio con i conteggi della prova a vuoto e le
   differenze della fotografia. Si aspetta l'ok.
4. **Backup** (solo zona rossa), **subito dopo l'ok e subito prima del push**:
   `.bak-YYYYMMDD-HHMMSS` accanto a ogni DB tenant, con l'API di backup, dopo `du`/`df`.
   Prima sul cliente A (si aggiorna da solo entro 15 minuti dal push), poi sull'hub subito
   prima del riavvio. Si annotano nome e **ora** (italiana) di ogni backup: in un ripristino
   si perde quello che è stato scritto dopo.
5. **Rilascio**, dal worktree, mai dall'albero principale (condiviso con altre sessioni):
   - `git -C <worktree> fetch origin`; se `origin/dev` è andato avanti, `rebase origin/dev`
     e di nuovo il cancello se è cambiato del codice;
   - CHANGELOG (commit `docs:`), poi `npm run version:release` nel worktree;
   - `git -C <worktree> push origin HEAD:dev`: è un fast-forward; se viene rifiutato non si
     forza, si torna al primo punto;
   - hub con la skill `deploy-prod` (pull, `npm run build`, riavvio subito dopo il backup);
   - il cliente A si aggiorna da solo, entro 15 minuti.
6. **Verifica:**
   - «gira davvero» si legge da `ActiveEnterTimestamp` o dalla riga d'avvio nel journal,
     non da `/api/version`; sul server, `git log -1` della cartella dell'app dà il commit
     del rilascio;
   - le righe `[db-tenant] …` della migrazione scrivono il loro **prima/dopo sullo stesso
     DB** (righe, figli per colonna, violazioni, segno): si controlla che tornino con le
     regole della sotto-tappa (figli uguali, righe attese). Non si confrontano coi numeri
     della prova a vuoto, che è fatta su una copia di qualche ora prima;
   - conteggi in sola lettura sui DB vivi, letti subito dopo l'avvio, coerenti col «dopo»
     del journal: uguali per le tabelle che i giri non scrivono (`credentials`, catene,
     controller, AD), e per le altre senza righe perse;
   - le verifiche proprie della sotto-tappa. Gli orari si scrivono in ora italiana.
7. **Criterio di arresto.** Ci si ferma, e la sotto-tappa successiva non parte, se:
   - il cancello non è tutto a 0;
   - un conteggio della prova a vuoto è diverso da quello atteso;
   - la seconda apertura cambia qualcosa;
   - la fotografia «dopo» ha una differenza da «prima» (stesso istante) fuori dall'elenco
     atteso;
   - il prima/dopo del journal non torna con le regole, o i conteggi vivi non tornano col
     «dopo» del journal;
   - c'è un segno `errore:`, o un `parziale:` non previsto;
   - ci sono errori nuovi nel journal.

   **Ritorno indietro.** Prima `git revert` del rilascio su `dev`, pubblicato. Se ci sono
   dati scritti male, si ripristina, con conferma, in quest'ordine:
   1. il revert è arrivato sul server (`git log -1` nella cartella dell'app; sull'hub con
      `deploy-prod`), altrimenti al riavvio la migrazione rigira sul DB ripristinato;
   2. servizio fermo (`systemctl stop`), e `systemctl is-active` lo conferma;
   3. `<db>-wal` e `<db>-shm` spostati da parte (non cancellati): `server.ts` non
      intercetta SIGTERM (`app-service.ts:183-185`) e quei file, rigiocati sopra il `.bak`,
      corromperebbero il DB (come fa `restore-local-db.sh:4`, `:31`);
   4. `.bak` copiato sul `.db`;
   5. `PRAGMA integrity_check` = `ok` sul file ripristinato;
   6. conteggi in sola lettura uguali a quelli del momento del backup;
   7. avvio, e la riga d'avvio nel journal.

   Si perde quello che è stato scritto dopo l'ora del backup (ARP, scansioni, modifiche):
   lo si dice a Riccardo con l'ora.
8. **CONTEXT.md §6:** una voce datata con conteggi e fonte, senza nomi.

---

## Sotto-tappa 2a — fondamenta e SNMPv3 completo (solo codice, nessun dato toccato)

**Perché.** Prima di spostare una scelta servono tre cose:
- sapere com'è oggi, apparato per apparato (la fotografia);
- un posto solo per i tipi e uno per leggere i segreti, così le sotto-tappe dopo
  cambiano una funzione e non sette;
- SNMPv3 letto bene. Oggi la chiave si prende da `encrypted_password` (`db.ts:4462`) e
  cinque sessioni hanno MD5/authNoPriv fissi.

Le voci v3 sono 0 ovunque, quindi nessun apparato cambia credenziale. *(Revisione della
2a: questo conta le voci, non gli apparati col protocollo `snmp_v3`. Quelli senza una v3
oggi leggono la community; dal T4 danno «Credenziale SNMPv3 assente o illeggibile». La
misura `[snmp_v3]` di `misure-2a.ts` li conta per tenant, e la fotografia della 2a li
scrive senza scelta: se in A o H1 sono più di 0, ci si ferma e il numero va a Riccardo
prima della procedura R.)* Nella 2a va anche
il bug del PATCH in blocco, che azzera le credenziali (spec §2: prima i bug confermati).
**Migrazione:** nessuna. **Rilascio:** procedura R senza i passi 3-4. **Arresto:**
fotografia con anche una sola differenza.

### Task 1 — Misure mancanti e fotografia delle scelte

- [ ] **File**
  - crea `scripts/credenziali/copia-dati.ts`: copia online (`db.backup()` di
    better-sqlite3) di `hub.db` e `tenants/*.db` da `--da <data dir>` a `--a <dir>`, con
    lo spazio libero controllato prima;
  - crea `src/lib/credentials/guardia-copia.ts`, pura (solo `node:path` e `node:fs`):
    `controllaCopia({ dati, hubDb, cartellaTenant, datiServizio }): string[]`, vuoto = si
    parte (vincoli, «Script sulle copie»);
  - modifica `src/lib/db-tenant.ts`: esporta `cartellaTenant(): string` (restituisce
    `TENANTS_DIR`, sola lettura);
  - crea `src/lib/credentials/fotografia.ts`, pura: il formato `RigaFotografia`,
    l'impronta HMAC, `confrontaFotografie(prima, dopo, campi)`. La logica sta sotto
    `src/` perché il cancello la provi: `npm test` prende solo `src/**/*.test.ts`
    (`package.json:23`);
  - crea `src/lib/credentials/__tests__/fotografia.test.ts` e
    `src/lib/credentials/__tests__/guardia-copia.test.ts`;
  - crea `scripts/credenziali/fotografia-scelte.ts`, solo la riga di comando: importa
    staticamente la guardia e `fotografia.ts`, imposta l'ambiente da `--dati`, poi
    `await import("./appoggio-fotografia")`, che importa staticamente `db-tenant` e i
    lettori. Lo script cambia lettori nel T8 e nel T26, con lo stesso formato.
- [ ] **Interfacce prodotte** (formato fisso, usato da tutte le sotto-tappe):
  ```ts
  interface RigaFotografia {
    tenant: string;
    oggetto: "apparato" | "host" | "rete" | "edge" | "patch";
    chiave: string;            // "<id>:<protocollo>"
    nome: string;              // solo a terminale, mai nel repo
    scelta: { credential_id: number | null; port: number | null; fonte: string; impronta: string } | null;
    piano?: string;            // piano di acquisizione dell'apparato
    haSnmp?: boolean;
  }
  export function impronta(chiaro: Buffer, encryptionKey: string): string; // 8 hex di HMAC-SHA256
  export function confrontaFotografie(prima: RigaFotografia[], dopo: RigaFotografia[], opz: { conFonte: boolean }): Differenza[];
  ```
  Uso: `fotografia-scelte.ts --dati <dir> --out <file.jsonl>` (dentro
  `withTenant(code, …)` per ogni tenant, con le funzioni della versione in cui gira) e
  `--confronta <prima.jsonl> <dopo.jsonl> [--con-fonte]`. Il confronto stampa le
  differenze per oggetto e per nome; codice di uscita 0 se non ce ne sono, 1 altrimenti.
  - Sugli apparati prende il protocollo principale e `snmp`.
  - Sugli host prende `ssh`, `winrm` e `snmp`.
  - Sulle reti prende le catene 2-4.
  - Prende poi l'anteprima edge e le credenziali patch degli host Windows.
  - **Fonte.** I lettori di oggi non dicono da dove viene la scelta: con loro `fonte`
    vale `"lettore_vecchio"`. `--confronta` confronta di default `credential_id`, `port`,
    `impronta`, `piano`, `haSnmp` e l'assenza di scelta; con `--con-fonte` anche `fonte`,
    e si usa solo quando i due lati girano col motore (dalla 2b in poi).
  - Il motore si chiama con `registra: false`: la fotografia non scrive ripieghi.
  - **Permessi.** La cartella delle fotografie si crea 0700 e i file 0600; lo script si
    rifiuta di scrivere in una cartella con permessi più larghi.
- [ ] **Prova prima del codice:**
  - su un DB temporaneo, un apparato con un binding e una colonna dà una riga con
    l'impronta, e l'uscita non contiene mai il segreto in chiaro né il testo cifrato;
  - la stessa community dà la stessa impronta con la stessa chiave, e un'altra con
    un'altra chiave (non è uno sha256 senza chiave);
  - `confrontaFotografie` senza `conFonte` ignora la fonte, con `conFonte` la vede;
  - **guardia, vista fallire:** lo script lanciato come processo figlio con
    `DA_INVENT_DATA_DIR` (ambiente «del servizio») verso una cartella Y e `--dati` X
    lavora su X e lascia Y intatta (nessun file creato, `mtime` uguali). Prima della
    sovrascrittura dell'ambiente la prova fallisce, perché lo script apre Y;
  - `controllaCopia` con `hub.db` o la cartella dei tenant fuori da `--dati`, o con
    `--dati` uguale alla cartella del servizio, dà un errore; lo script esce con 2 senza
    aprire DB.
- [ ] **Commit della fotografia, da solo e subito sopra `origin/dev`.** È la «prima» della
  2a: gira con i lettori di oggi.
- [ ] **Sul server** (procedura R, passo 2, senza `prova-a-vuoto.ts` e con una copia sola):
  - fotografia di base `base-2a.jsonl` per H1, H2, DEFAULT e A, come storico;
  - nello stesso comando, la misura #31 rifatta: legge le due chiavi globali dall'hub e
    per ogni tenant stampa se l'id esiste, il tipo, e in quante reti su quante sta già.
    Da qui: **N** (reti di A dove la chiave Windows esiste, è del tipo giusto e manca
    dalla lista) e il numero di reti di H1 che con D3 = (a) la perdono;
  - quanti apparati oggi ricevono «public» come ripiego (fonte dalla fotografia), per D5;
  - quanti usi hanno, in binding, colonne, catene e AD, le 4 voci di H1 «senza uso», per D8;
  - **per D1b**, tenant per tenant e protocollo per protocollo, quanti apparati senza
    nessuna fonte propria (binding, inline, colonne) riceverebbero un candidato dai
    livelli 6-11 (righe host validate, catena della rete via `host_id` →
    `hosts.network_id`, catene vecchie, chiave dell'hub), e di che tipo;
  - **per la 2e**, per ogni apparato con utente e password in colonna e un binding ssh,
    il confronto in memoria fra i due (stampa solo «uguale» / «diverso»): fissa quante
    voci nascono dalle colonne in H1, H2 e A;
  - per ogni apparato con `snmp_credential_id` o `credential_id` SNMP, se ha già un
    binding `snmp` verso la stessa voce (fissa i binding SNMP nati dalle colonne).
- [ ] **Verifica:** le quattro fotografie esistono, coi conteggi delle righe per oggetto;
  gli esiti delle misure si scrivono in chat per D1b, D3, D5 e D8 e per i conteggi della
  2d e della 2e, senza id né nomi nel repo.
- [ ] **Commit:** `chore(credenziali): fotografia delle scelte delle credenziali (sola lettura, per la tappa 2)`.

### Task 2 — `tipi.ts` e la regola unica tipo ↔ protocollo

- [ ] **File**
  - crea `src/lib/credentials/tipi.ts`, puro e importabile dal client come `porte.ts`;
  - crea `src/lib/credentials/__tests__/tipi.test.ts`;
  - modifica `src/lib/credential-protocol-map.ts:20-38`: `tipiCredenzialePerProtocollo`
    restituisce `tipiPerProtocollo`. `CRED_TYPE_OPTIONS` (`:62-68`) resta sui **cinque**
    tipi che `CredentialSchema` (`validators.ts:136`) e il CHECK del DB
    (`db-tenant-schema.ts:133`) accettano fino alla 2c, con le etichette di
    `ETICHETTE_TIPO`: alimenta la creazione rapida (`network-detail-client.tsx:1607`,
    `discovery/page.tsx:2838`), e un tipo nuovo lì darebbe 400 o 500. Passa agli otto
    tipi nel T13;
  - modifica `src/lib/credentials/resolve.ts:59-73`: `credentialTypesForProtocol` è
    tolta, il livello 5 usa `tipiPerProtocollo`;
  - modifica `src/lib/__tests__/credential-protocol-map.test.ts` e
    `src/lib/credentials/__tests__/resolve.test.ts`.
- [ ] **Interfacce prodotte:**
  ```ts
  export const TIPI_CREDENZIALE = ["ssh","snmp","snmp_v3","windows","api","unifi","omada","ad"] as const;
  export type TipoCredenziale = (typeof TIPI_CREDENZIALE)[number];
  export type MetodoAccesso = "password" | "chiave" | "community" | "utente_v3" | "utente" | "token" | "client";
  export const METODI_PER_TIPO: Record<TipoCredenziale, readonly MetodoAccesso[]>;     // tabella dei vincoli
  export const ETICHETTE_TIPO: Record<TipoCredenziale, string>;                       // tabella dei vincoli
  export function normalizzaTipo(t: string | null | undefined): TipoCredenziale | null; // "linux" → "ssh"
  export function etichettaTipo(t: string | null | undefined): string;                // sconosciuto → il codice
  export function tipiPerProtocollo(protocollo: string | null | undefined): string[];  // tabella dei vincoli
  export type CampoCredenziale = "username" | "password" | "private_key" | "auth_key" | "priv_key";
  export function campiRichiesti(tipo: TipoCredenziale, metodo: MetodoAccesso, livelloV3?: string | null): CampoCredenziale[];
  ```
- [ ] **Prova prima del codice:**
  - la tabella dei valori esatti;
  - `unifi`, `omada` e `ad` non compaiono per nessun protocollo;
  - `normalizzaTipo("linux") === "ssh"` e `normalizzaTipo("boh") === null`;
  - il livello 5 del motore per `api` propone una voce `ssh` della catena (la regola
    della tappa 1; oggi `resolve.ts:68-71` ammette solo `api`).
- [ ] **Verifica:** prove verdi, `npx tsc --noEmit`.
- [ ] **Commit:** `feat(credenziali): tipi d'archivio per esteso e una regola sola tipo ↔ protocollo`.

### Task 3 — `segreti.ts`: un lettore solo dei segreti, SNMPv3 completo

- [ ] **File**
  - crea `src/lib/credentials/segreti.ts` e `src/lib/credentials/__tests__/segreti.test.ts`;
  - modifica in `db-tenant.ts` `getCredentialLoginPair` (`:3959`),
    `getSshLinuxCredentialPair` (`:3973`), `getCredentialCommunityString` (`:4617`) e
    `getDeviceSnmpV3Credentials` (`:4630`), e le gemelle `db.ts:3846`, `:3876`, `:4438`,
    `:4452`: tutte diventano involucri;
  - modifica `src/lib/protocols/snmpv3.ts:187-215`: `snmpValidateV3` legge la voce con
    `leggiSegretoDb` e accetta `snmp_v3`, oppure `snmp` con `security_level`.
- [ ] **Interfacce prodotte:**
  ```ts
  export type Segreto =
    | { forma: "utente"; username: string; password: string }
    | { forma: "chiave_ssh"; username: string; privateKey: string; passphrase: string | null }
    | { forma: "community"; community: string }
    | { forma: "v3"; record: SnmpV3CredentialRecord }
    | { forma: "token"; tokenId: string | null; token: string }
    | { forma: "chiave_api"; chiave: string }
    | { forma: "client"; clientId: string; clientSecret: string };
  export type UsoSegreto = "ssh" | "winrm" | "snmp" | "api" | "ldap" | "controller_unifi" | "controller_omada";
  export type EsitoSegreto =
    | { ok: true; credentialId: number; nome: string; tipo: string; segreto: Segreto; port: number | null; formatoVecchio?: true }
    | { ok: false; motivo: string };                       // italiano, col nome della voce, mai il segreto
  export function leggiSegretoDb(dbh: Database.Database, credentialId: number, uso: UsoSegreto): EsitoSegreto;
  export function leggiSegretoInline(b: { protocol_type: string; inline_username: string | null; inline_encrypted_password: string | null }): EsitoSegreto;
  export function opzioniSsh(s: Segreto): { username: string; password?: string; privateKey?: string; passphrase?: string } | null;
  ```
  **Regole:**
  - il tipo deve essere in `tipiPerProtocollo(uso)` (per `ldap` vale `ad`; per i
    controller `unifi` / `omada`), altrimenti `ok: false` con «La credenziale «X» è di
    tipo <etichetta>, non vale per <uso>»;
  - `snmp` senza `security_level` → `community` (prima `encrypted_password`, poi
    `encrypted_username` come oggi);
  - `snmp_v3`, o `snmp` con `security_level` → `v3`, con la chiave da
    `encrypted_auth_key`, protocolli e livello della voce, e la chiave privacy;
  - formato v3 «vecchio», cioè `snmp` senza livello con utente e password chiesto per un
    apparato `snmp_v3`: `v3` authNoPriv/MD5 con la chiave da `encrypted_password`, come
    oggi, con `formatoVecchio: true`. Il chiamante registra `cred_v3_vecchia`. Il 15/10
    valeva 0 ovunque.

  `getDeviceSnmpV3Credentials` restituisce `SnmpV3CredentialRecord | null`, non più
  `{ username, authKey }`; i chiamanti si adeguano nel T4.

  **Schema di partenza.** `segreti.ts` esce nella 2a, quando `auth_method`,
  `encrypted_private_key` ed `encrypted_key_passphrase` non esistono ancora (nascono nel
  T11), e in un DEFAULT mai riaperto manca anche `port`. Quindi legge la riga con
  `SELECT *` (o `getCredentialById`) e tratta come assente ogni colonna che non c'è:
  `auth_method` assente = il primo metodo del tipo, chiave assente = forma `utente`. Una
  `SELECT` con le colonne nuove per nome fermerebbe ogni lettura di segreti (discovery e
  acquisizione su hub e A) dal rilascio 2a.
- [ ] **Prova prima del codice:**
  - **sullo schema della 2a** (`TENANT_SCHEMA_SQL` di oggi, senza le colonne del T11) e
    **sullo schema di DEFAULT** (senza `port`): una voce SSH e una SNMP si leggono;
  - una v3 scritta come la scrive la pagina (authPriv, SHA, AES, chiavi in
    `encrypted_auth_key` / `encrypted_priv_key`) dà il record completo, mentre oggi
    `getDeviceSnmpV3Credentials` dà `null`;
  - la stessa voce non diventa mai una community;
  - una voce `windows` chiesta per `ssh` dà `ok: false` col messaggio;
  - le due gemelle danno lo stesso esito sullo stesso DB (`withTenant` sul facade e su
    `db-tenant`).
- [ ] **Verifica:** prove verdi; `community-snmpv3.test.ts` e
  `aggiornamenti-credenziale.test.ts` restano verdi.
- [ ] **Commit:** `feat(credenziali): un lettore solo dei segreti, SNMPv3 letto per intero`.

### Task 4 — Una sessione SNMP sola, ramo v3 nelle prove

- [ ] **File**
  - modifica `src/lib/protocols/snmp-sessione.ts`: aggiunge `apriSessioneSnmp`, unico
    posto in cui si chiama `createV3Session(`;
  - modifica `src/lib/protocols/snmpv3.ts`:
    - `:80-89`: AES256 resta Blumenthal (`aes256b`); si aggiunge `AES256C` = Reeder
      (`aes256r`, etichetta «AES-256 (Cisco)»);
    - DES si rifiuta con «DES non è supportato da Node 22: usa AES»;
    - `:241`: la sessione passa da `apriSessioneSnmp`;
  - modifica le cinque sessioni v3 con MD5 fisso: `scanner/snmp-query.ts:338-413`,
    `devices/router-client.ts:283-301`, `devices/interface-probe.ts:80-97`,
    `devices/device-info.ts:289-318`, `devices/switch-client.ts:239-262`. Le opzioni
    vengono dal record. Una v3 assente o illeggibile su un apparato `snmp_v3` è un errore
    visibile («Credenziale SNMPv3 assente o illeggibile»), non un ripiego sulla community
    e su «public» (`db.ts:4513`);
  - modifica `src/lib/devices/prova-binding.ts:66-99`: ramo v3;
  - modifica `src/app/api/credentials/[id]/test/route.ts`:
    - `:57-83`: ramo v3;
    - `:64`, `:95`, `:127`: la porta è `body.port ?? credentials.port ?? standard`;
  - modifica `src/lib/scanner/discovery.ts:2510-2537`: la v3 riuscita registra
    sysDescr/sysObjectID come il ramo community;
    *Nota di esecuzione (revisione della 2a): rinviato, il file non cambia.* In
    quel blocco (`credential_validate`) il ramo community non registra
    sysDescr/sysObjectID: registra solo la versione SNMP sull'apparato, e il blocco
    esce prima del salvataggio degli host. I due valori arrivano dalle fasi SNMP
    della discovery, che sono solo a community (`querySnmpInfoMultiCommunity`). Per
    un host che risponde solo in v3 servirebbe una scrittura nuova sull'host (o la
    v3 in quelle fasi), che cambia fingerprint e classificazione: va proposta a
    parte, non dentro la 2a;
  - **il ramo v3 si decide dalla forma del segreto**, cioè da `leggiSegretoDb(…, "snmp")`
    che dà `forma: "v3"` oppure `"community"`, mai dal confronto `credential_type ===
    "snmp"`. Nella 2a il tipo `snmp_v3` non esiste ancora; dalla 2c sì, e i confronti col
    codice grezzo li sistema il T12 (`discovery.ts:2497`, `test/route.ts:57`);
  - togli `src/app/api/credentials/[id]/test-snmp/route.ts` (nessuna pagina la chiama) e
    la sua riga in `api-auth-guards.test.ts:39`. `src/lib/permessi/rotte.ts` non ha una
    voce per questa rotta: `rotte-censite.test.ts` si rilancia soltanto, dopo averla
    tolta;
  - crea `src/lib/protocols/__tests__/support/agente-snmp-v3.ts`, l'agente di net-snmp
    (`createAgent` + `authorizer.addUser`) su una porta locale;
  - modifica `src/types/modules.d.ts:1-77`: net-snmp è tipizzato a mano e la
    dichiarazione non ha l'agente. Si aggiungono le dichiarazioni minime che servono alla
    prova (`createAgent`, `Agent.getAuthorizer().addUser`, `Agent.getMib()` e il
    provider per `sysDescr`), verificate su `node_modules/net-snmp/index.js` della
    versione in uso (`^3.26.1`). Senza, `npx tsc --noEmit` del cancello fallisce sul file
    di supporto, e `any` è vietato (regola 13);
  - estendi `snmp-sessione.test.ts` con l'invariante su `createV3Session(`, sul modello
    di `:97-122`.
- [ ] **Interfacce prodotte:**
  ```ts
  export type CredenzialeSnmp = { forma: "community"; community: string } | { forma: "v3"; record: SnmpV3CredentialRecord };
  export function apriSessioneSnmp(
    snmp: typeof NetSnmp, host: string, cred: CredenzialeSnmp,
    opts: { port: number; timeout: number; versione: VersioneSnmp | null },
  ): { ok: true; session: NetSnmp.Session } | { ok: false; motivo: string };
  ```
- [ ] **Prova prima del codice:**
  - con l'agente v3 finto (utente authPriv SHA/AES), `provaBinding` e la prova della
    credenziale riescono; oggi rispondono «Community mancante»;
  - una chiave sbagliata dà un fallimento col motivo;
  - l'invariante: nessun `createV3Session(` fuori da `snmp-sessione.ts` (oggi 5 file più
    `snmpv3.ts:241`);
  - `snmp-versione-lettura-dati` resta verde: v1 e v2c non cambiano.
- [ ] **Commit:** `feat(snmp): SNMPv3 completo sugli apparati e nelle prove, niente «public» al posto di una v3`.

### Task 5 — La modifica in blocco non azzera più le credenziali

- [ ] **File**
  - crea `src/app/(dashboard)/devices/modifica-in-blocco.ts`, pura:
    `corpoModificaInBlocco(stato)`. «Non modificare» significa campo assente, «Nessuna»
    significa `null`;
  - modifica `src/app/(dashboard)/devices/device-list-by-classification.tsx:176-177`,
    `:282-290`: lo usa. Oggi lo stato iniziale `null` manda `credential_id: null` e
    `snmp_credential_id: null`;
  - controlla `src/app/api/devices/bulk/route.ts:303-313`: campo assente = non si tocca;
  - **le tre finestre di modifica del singolo apparato** mandano sempre i due campi, con
    `null` quando la tendina è vuota, e la tendina parte dalla colonna vecchia:
    `src/components/devices/edit-device-dialog.tsx:60-61`, `:79-80`, `:108-109`;
    `src/app/(dashboard)/devices/[id]/page.tsx:628-629`, `:846-847`;
    `device-list-by-classification.tsx:208-209`, `:722-723`. Usano
    `corpoModificaApparato(statoIniziale, stato)` (stesso modulo puro): un campo non
    toccato non si manda. Oggi è innocuo solo perché il PUT scrive una colonna già NULL;
    dalla 2e (T20) `null` toglie i binding.
- [ ] **Prova prima del codice:**
  - modifica in blocco: con lo stato iniziale e solo la classificazione cambiata, il
    corpo non ha né `credential_id` né `snmp_credential_id`. Oggi ha `null` per tutti e
    due, e il PATCH azzera colonne e utente/password di ogni apparato selezionato. Per i
    6 apparati di H1 e l'1 di A quelle colonne sono l'unico accesso;
  - modifica del singolo: con lo stato iniziale e solo il nome cambiato, il corpo non ha
    né `credential_id` né `snmp_credential_id` (oggi li ha, a `null`).
- [ ] **Commit:** `fix(apparati): la modifica in blocco e quella del singolo non toccano più le credenziali con «Non modificare»`.

### Task 6 — Rilascio 2a

- [ ] Procedura R, passi 0, 1, 2, 5, 6, 7 e 8. Fotografia «dopo» (codice della 2a)
  confrontata con «prima» (commit del T1) sullo stesso istante, senza `--con-fonte`:
  **0 differenze** su H1, H2, DEFAULT e A.
- [ ] Verifica dopo il rilascio: il «Test» di un binding SNMP sull'hub risponde come prima;
  nel journal non c'è nessun errore SNMP nuovo nell'ora dopo il riavvio.
- [ ] CHANGELOG: SNMPv3 letto per intero e il perché; la modifica in blocco che azzerava le
  credenziali; la rotta `test-snmp` tolta. *(Revisione della 2a)* La regola «niente
  community al posto di una v3» vale per le cinque sessioni v3 (più quella degli switch
  e della topologia, `apriSessioneSnmpApparato`); il profilo vendor di `getDeviceInfo`
  apre ancora una v2c con la community (anche «public») prima della v3, e passa al
  motore nel T8. La validazione v3 della discovery non salva sysDescr/sysObjectID
  (rinviata, nota nel T4).

---

## Sotto-tappa 2b — un motore solo (scelte spostate, dati non toccati)

**Perché.** La spec chiede «un solo motore … usato anche dall'acquisizione». Il motore
continua a leggere anche le fonti vecchie: binding inline, colonne di `network_devices`,
catene vecchie, chiave dell'hub, ripieghi SNMP. Le legge come fonti **dichiarate e
registrate**, così se le conversioni dopo non arrivano nessun apparato perde l'accesso.
L'ordine cambia solo dove lo decidono D1, D1b, D4, D5, D10 e D11.
**Migrazione:** nessuna. **Rilascio:** procedura R con conferma e senza il passo 4,
mostrando la fotografia per nome.
**Differenze attese, con le risposte raccomandate** (D1b = (a): l'acquisizione resta
sulle fonti dell'apparato; le patch restano su righe host e ripiego AD):
- H1: 4 apparati, quelli col primo binding fallito (1 SSH, 3 WinRM), passano al candidato
  successivo **fra le fonti dell'apparato**, o a «nessuna credenziale» se non ne hanno
  (D10; elenco per nome con l'esito);
- A: l'apparato di F2;
- gli apparati con l'SNMP solo nei binding diventano «ha SNMP» (elenco per nome dalla
  fotografia);
- H2 e DEFAULT: le chiavi globali dell'hub, che lì non puntano a nessuna voce, spariscono
  dalle catene delle reti (filtro di tipo; oggi si accodano senza controllo). In H1 e A
  lo stesso succede solo se la misura #31 del T1 dice che la chiave punta a un id che non
  esiste o a una voce di tipo diverso dal ruolo: quelle reti si elencano;
- patch (oggetto `patch` della fotografia): gli host Windows la cui riga WinRM è **in
  fermo** nell'istante della copia passano alla riga successiva o al ripiego AD (D4),
  perché oggi `loadWinrmCredentialsForHost` non guarda il fermo
  (`patch/credentials.ts:54-68`). Il 15/10 erano 0 su hub e A (misura #88); si elencano
  per nome;
- in ogni tenant, `fonte` passa da `lettore_vecchio` ai nomi del motore: per questo il
  confronto 2a → 2b si fa **senza** `--con-fonte`;
- fuori dalla fotografia (revisione 2b, 16/10): le letture SNMP della topologia degli
  switch (`switch-client.ts`, `apriSessioneSnmpApparato`) erano le sole a usare
  `device.port` (salvo la 22) invece della 161. Con D11 = (a) passano alla porta del
  binding o della voce, altrimenti 161, come gli altri sette lettori. Cambia solo per
  gli apparati `snmp_v2`/`snmp_v3` con `port` diversa da 161 e da 22 e senza un binding
  SNMP o una voce SNMP con una porta propria: si elencano per nome dalle copie prima
  del rilascio (query nel resoconto della revisione).

Se la risposta a D1b è (b), si aggiungono i conteggi per livello misurati nel T1, con
l'elenco per nome. Ogni altra differenza fa scattare l'arresto.

### Task 7 — Il motore allargato

- [ ] **File**
  - modifica `src/lib/credentials/resolve.ts` (tutto) e `src/lib/credentials/__tests__/resolve.test.ts`;
  - modifica `src/lib/db-maintenance/ripieghi.ts`, aggiungendo i casi nuovi di `CasoRipiego`;
  - modifica in `db-tenant.ts` `getOrderedDetectCredentialIds`,
    `getOrderedSshLinuxCredentialIds` e `buildSnmpCommunities*` (`:4098-4207`), e le
    gemelle `db.ts:3984-4088`: tutte involucri del motore.
- [ ] **Interfacce prodotte:**
  ```ts
  export type ResolvedCredentialSource =
    | "device_binding" | "device_inline" | "device_column" | "device_column_inline"
    | "host_validated" | "host_unvalidated" | "network_chain" | "legacy_chain"
    | "hub_default" | "ad_fallback" | "snmp_ripiego";
  export interface ResolvedCredential {
    credential_id: number | null; binding_id: number | null; device_id: number | null;
    protocol: CredProtocol; port: number; source: ResolvedCredentialSource; tipo: string | null;
    validated: boolean; fail_count: number; backoff_until: string | null;
  }
  export interface OpzioniMotore extends ResolveOptions {
    fonti?: ResolvedCredentialSource[];     // limita le fonti (patch: niente catena di rete)
    conAdFallback?: boolean;                // D4
    globaliHub?: { windows: number | null; linux: number | null } | null; // fino alla 2d
    registra?: boolean;                     // default true; false per controlli, fotografia, prova a vuoto
  }
  export const FONTI_APPARATO: readonly ResolvedCredentialSource[];   // livelli 1-5
  export const FONTI_ACQUISIZIONE: readonly ResolvedCredentialSource[]; // D1b = (a): FONTI_APPARATO + snmp_ripiego («public»)
  export function credenzialiApparatoDb(dbh: Database.Database, deviceId: number, protocol: CredProtocol, opts?: OpzioniMotore): ResolvedCredential[];
  export function scegliSegretoApparatoDb(dbh: Database.Database, deviceId: number, protocol: CredProtocol, opts?: OpzioniMotore):
    | { ok: true; candidato: ResolvedCredential; segreto: Segreto } | { ok: false; motivo: string };
  export function scegliSegretoHostDb(dbh: Database.Database, target: ResolveTarget, protocol: CredProtocol, opts?: OpzioniMotore): /* come sopra */;
  export function communitySnmpDb(dbh: Database.Database, target: ResolveTarget, override: string | null): Array<{ community: string; fonte: ResolvedCredentialSource }>;
  ```
  **Ordine per un apparato** (D1 = (a)):
  1. binding d'archivio riusciti;
  2. binding d'archivio non provati;
  3. binding inline non falliti (`device_inline`);
  4. colonne `credential_id` / `snmp_credential_id` (`device_column`);
  5. colonne `username` / `encrypted_password` / `community_string` (`device_column_inline`);
  6. host validate;
  7. host non validate fuori fermo;
  8. catena della rete;
  9. catene vecchie (`legacy_chain`);
  10. chiave dell'hub (`hub_default`, solo windows/ssh);
  11. ripiego AD (`ad_fallback`, solo `winrm` e solo con `conAdFallback`);
  12. per SNMP, community della rete e public/private (`snmp_ripiego`, D5).

  **Quali livelli valgono dove** (D1b = (a)): acquisizione, «ha SNMP?», LibreNMS e Omada
  chiamano il motore con `fonti: FONTI_ACQUISIZIONE`, cioè i livelli 1-5 e, per SNMP
  v1/v2c senza nessuna fonte dell'apparato, il solo «public» di oggi (non la community
  della rete, che oggi l'acquisizione non usa: `db-tenant.ts:4651-4683`). I livelli
  6-11 li usano discovery, validazione e prove. Con D1b = (b) l'acquisizione usa tutti i
  livelli.

  **La rete di un apparato** viene da `network_devices.host_id` → `hosts.network_id`
  (`network_devices` non ha `network_id`). Un apparato senza `host_id` (2 in H1, 4 in A)
  non ha i livelli 6-10: solo le fonti dell'apparato e, per SNMP, il ripiego.

  **Regole comuni:**
  - ogni livello con una voce passa dal filtro `tipiPerProtocollo`;
  - un binding `failed` si salta finché una prova non riesce (D10 = (a); con (b) si
    salta per il tempo di fermo contato da `tested_at`);
  - si deduplica per (voce o binding, porta);
  - la porta: secondo D11 (con (a), la porta dell'apparato per il protocollo principale,
    quella del candidato per SNMP e per l'SSH di Proxmox);
  - le funzioni pubbliche, con `registra` diverso da `false`, registrano il ripiego
    quando il candidato **scelto** viene da 3, 4, 5, 9, 10 o 12;
  - le nuove funzioni pubbliche restituiscono `{ ok: false, motivo }`, mai una lista
    vuota muta come `resolveCredentialsFor` (`resolve.ts:322-335`).

  **Per un host** l'ordine di oggi non cambia (`resolve.ts:210-235`), con in più il
  filtro di tipo su ogni livello e i livelli 9-11.
- [ ] **Prova prima del codice** (DB in memoria dallo schema vero, dati con la forma
  delle misure):
  - primo binding fallito e secondo riuscito → il secondo;
  - binding non provato contro una validata sull'host → il binding (D1);
  - binding inline → fonte `device_inline`;
  - apparato `snmp_v2` con porta 22, voce SNMP nella colonna e nessun binding → candidato
    sulla **161**, fonte `device_column`;
  - voce `windows` nella colonna di un apparato `snmp_v2` → non proposta per `ssh` (F2);
  - `api` con una voce `ssh` → ammessa (F1);
  - ripiego AD solo per `winrm`, solo con l'opzione, e mai con l'host in fermo (D4);
  - «public» con fonte `snmp_ripiego` e registrato (D5);
  - con `FONTI_ACQUISIZIONE`, un apparato `api` senza binding né colonne, in una rete la
    cui catena ha una voce SSH → nessun candidato (non la voce SSH della catena);
  - un apparato SNMP senza fonti proprie, in una rete con una voce SNMP in catena → con
    `FONTI_ACQUISIZIONE` «public» (`snmp_ripiego`), non la community della catena;
  - apparato senza `host_id` → nessun livello di host o di rete, nessun errore;
  - con `registra: false` il registro dei ripieghi non riceve niente.
- [ ] **Commit:** `feat(credenziali): un motore solo per host, apparati e reti, con le fonti vecchie dichiarate`.

### Task 8 — L'acquisizione degli apparati sul motore

- [ ] **File**
  - modifica `db-tenant.ts:4646-4720` e `db.ts:4471-4558`:
    - `getDeviceCredentials` diventa involucro di `scegliSegretoApparatoDb` (forma
      `utente`);
    - `getDeviceCommunityString`, `getDeviceSnmpV3Credentials` e `getEffectiveSnmpPort`
      sono tolte;
    - nascono `credenzialeSnmpApparato(device)` e `haSnmpApparato(device)`, involucri dei
      puri `credenzialeSnmpApparatoDb` / `haSnmpApparatoDb`;
    - tutti con `fonti: FONTI_ACQUISIZIONE` (D1b = (a));
  - modifica i chiamanti delle righe 5, 6, 7, 10, 15, 16 e 17 della tabella iniziale. Per
    LibreNMS tutti e due i rami, `librenms-sync.ts:317-318` (aggiornamento) e `:348-349`
    (`addDevice`): la community decifrata parte solo se `haSnmpApparato` è vero e la
    fonte non è `snmp_ripiego`; altrimenti `snmp_disable: true`, come oggi per un
    apparato senza `community_string`;
  - modifica `scripts/credenziali/fotografia-scelte.ts` (e il suo modulo d'appoggio):
    passa ai lettori nuovi (motore con `registra: false`), con lo stesso formato e le
    fonti del motore. `getDeviceCommunityString` e `getDeviceSnmpV3Credentials` non
    esistono più, e `tsconfig.json` include `**/*.ts`, quindi anche `scripts/`;
  - modifica `device-acquisition-resolve.ts:176-183`: `haSnmp` lo passa il chiamante, così
    il modulo resta puro;
  - modifica `device-connection-test.ts`:
    - `:126-149`: motore; l'apparato provvisorio usa la voce scelta nella finestra
      (`leggiSegretoDb`) e poi le validate dell'host;
    - `:205`: la porta SSH di Proxmox viene dal candidato SSH, o 22.
- [ ] **Interfacce prodotte:**
  ```ts
  export function credenzialeSnmpApparato(device: NetworkDevice):
    | { ok: true; cred: CredenzialeSnmp; port: number; fonte: ResolvedCredentialSource } | { ok: false; motivo: string };
  export function haSnmpApparato(device: NetworkDevice): boolean;   // vero solo con una fonte dell'apparato (livelli 1-5)
  ```
- [ ] **Prova prima del codice:**
  - `getDeviceCredentials` su un apparato col primo binding fallito → il secondo (oggi il
    primo);
  - una stampante con l'SNMP solo in un binding → `haSnmpApparato` vero e piano
    `snmp_peripheral` (oggi no);
  - una stampante senza SNMP proprio, in una rete con una voce SNMP in catena →
    `haSnmpApparato` falso, piano invariato;
  - i campi SNMP per LibreNMS contengono la community decifrata (oggi
    `device.community_string` cifrato, `librenms-sync.ts:317-318`), in tutti e due i
    rami; un apparato senza SNMP proprio arriva con `snmp_disable: true`, non con
    «public»;
  - prova di connessione di un Proxmox con `port = 8006` e binding SSH sulla 22 → SSH
    sulla 22 (oggi 8006);
  - un apparato v3 apre la sessione con i protocolli della voce.
- [ ] **Commit:** `feat(apparati): l'acquisizione sceglie le credenziali col motore unico (binding falliti saltati, porta SSH di Proxmox, LibreNMS)`.

### Task 9 — Inventario software, patch e terminale sul motore

- [ ] **File**
  - modifica `src/lib/probes/software-runner.ts:120-250`:
    - host: `scegliSegretoHostDb` su `winrm` e poi `ssh`; il tipo si controlla con
      `tipiPerProtocollo`, quindi `ssh` è accettato; la porta è quella del candidato;
    - apparato: `scegliSegretoApparatoDb`, invece di «colonna prima» (`:194-206`);
  - togli `getBestCredentialBindingForDevice` (`db-tenant.ts:7649-7672`);
  - modifica `src/lib/patch/credentials.ts:49-176`: `scegliSegretoHostDb` con
    `fonti: ["host_validated","host_unvalidated","ad_fallback"]`: le stesse fonti di
    oggi (righe host, poi account AD, `:54-87`), niente catena di rete e **niente binding
    dell'apparato**, che le patch oggi non leggono; aggiungerli cambierebbe la credenziale
    di patch degli host Windows con un binding WinRM. `conAdFallback` secondo D4. Le
    firme di `loadWinrmCredentialsForHost` e `loadSshCredentialsForHost` non cambiano;
  - crea in `patch/credentials.ts` `hostConCredenzialeWinrmDb(dbh): Set<number>`: una
    query sola, con le stesse regole di `scegliSegretoHostDb` per le patch (fonti, fermo,
    filtro di tipo, ripiego AD). Le quattro rotte della riga 12 la usano al posto delle
    CTE `winrm_status` / `ad_winrm_available` dentro le loro query di elenco
    (`patch/device/route.ts:163-176`, `software/[softwareKey]/route.ts:213-224`,
    `cve/[cveId]/hosts/route.ts:78-89`, `device/[hostId]/route.ts:110-121`). Una
    funzione per host chiamata riga per riga sarebbe un N+1 (regola 6).
- [ ] **Prova prima del codice:**
  - host con una voce `ssh` → inventario accettato (oggi «Usa una credenziale 'windows' o
    'linux'», `software-runner.ts:150-153`);
  - host la cui unica riga è in fermo → non usata dalle patch (oggi sì,
    `patch/credentials.ts:54-87`);
  - il ripiego AD arriva per ultimo, con la fonte dichiarata;
  - un host Windows con una sola riga host e un binding WinRM sul suo apparato → le patch
    usano la riga host (come oggi);
  - su un DB di prova con host in tutti i casi (riga validata, riga in fermo, solo AD,
    niente), `hostConCredenzialeWinrmDb` contiene esattamente gli host per cui
    `loadWinrmCredentialsForHost` dà una credenziale.
- [ ] **Commit:** `feat(credenziali): inventario, patch e terminale scelgono col motore e rispettano il fermo`.

### Task 10 — Rilascio 2b

- [ ] Procedura R con conferma, senza il passo 4. La fotografia «dopo» (codice della 2b)
  contro «prima» (`origin/dev`, cioè la 2a) sullo stesso istante, senza `--con-fonte`,
  deve dare **solo** le differenze attese della sotto-tappa, elencate per nome.
- [ ] Verifica:
  - i primi giri di `arp_poll` e `hypervisor_sync` dopo il riavvio, su hub e A, senza
    errori nuovi di credenziale nel journal;
  - nessun «775»/«52e» nuovo (account bloccato / rifiutato);
  - il registro dei ripieghi mostra il caso `cred_colonna_apparato` con le firme attese
    (i lettori dell'acquisizione) e un conteggio d'ora coerente coi giri; quanti
    apparati e protocolli lo usano si conta dalla fotografia («dopo», fonte
    `device_column` / `device_column_inline`), perché il registro non scrive gli
    apparati. Fra questi ci devono essere i 6 apparati di H1 e l'1 di A che hanno
    l'accesso solo nelle colonne; il totale per tenant si scrive nel CONTEXT.
- [ ] CHANGELOG: quale credenziale vince ora e perché (D1), «public» dichiarato, il fermo
  rispettato dalle patch.

---

## Sotto-tappa 2c — archivio coi tipi per esteso (migrazione: ricostruzione di `credentials`)

**Perché.** Il CHECK su `credential_type` ammette 5 tipi (`db-tenant-schema.ts:133`), e
SQLite non lo cambia senza ricostruire la tabella. Si toglie il CHECK (ADR 0017): la
validazione sta solo in `tipi.ts` e nel CRUD, come per `network_controllers` (ADR 0007).
Così un tipo futuro non richiede un'altra ricostruzione della tabella più referenziata
(10 chiavi esterne, 5 in CASCADE).

Insieme alla ricostruzione vanno le colonne nuove, `linux` → `ssh` e `snmp` con livello →
`snmp_v3`. Nello **stesso rilascio** vanno anche tutti quelli che scrivono o filtrano
`linux`. In particolare la pagina della rete che rimanda le catene vecchie: senza questa
correzione `replaceNetworkHostCredentials` rifiuterebbe il ruolo linux con una voce ssh,
e risponderebbe 400 dopo aver già salvato la rete.

**Conteggi attesi:**
- `credentials`: H1 10 → 10 (1 `linux` → `ssh`); A 5 → 5 (0 cambi); H2 e DEFAULT 0 → 0;
- figli CASCADE: H1 154, A 62, uguali prima e dopo;
- figli SET NULL:
  - H1: 18 apparati, 0 SNMP, 1 AD, 37 scansioni software, 0 Proxmox;
  - A: 18, 2, 1, 3, 0;
  - uguali prima e dopo;
- `foreign_key_check`: H1 2 → 2, gli altri 0 → 0;
- v3, ibride e v3 «vecchie»: 0 ovunque.

### Task 11 — Ricostruzione di `credentials` e normalizzazione dei tipi

- [ ] **File**
  - crea `src/lib/credentials/migra-credenziali-tipi.ts` e
    `src/lib/__tests__/migrazione-credenziali-tipi.test.ts`;
  - crea `src/lib/credentials/normalizza-tipi.ts` e la sua prova;
  - crea `scripts/credenziali/prova-a-vuoto.ts` (solo la riga di comando, con la guardia
    e l'ambiente impostato da `--dati` prima dell'`await import()` del suo modulo
    d'appoggio: vincoli, «Script sulle copie»), che stampa per tenant: righe, figli per
    colonna, violazioni, `seq` prima/dopo, segni ed esiti; si estende nei T16, T19, T22
    e T27;
  - la migrazione scrive nel journal il suo **prima/dopo sullo stesso DB** (righe, figli
    per colonna, violazioni, `seq`): è quello che il passo 6 della procedura R controlla;
  - modifica `src/lib/db-tenant-schema.ts:130-149`: `credential_type TEXT NOT NULL` senza
    CHECK, più `auth_method TEXT`, `encrypted_private_key TEXT` ed
    `encrypted_key_passphrase TEXT`;
  - modifica `src/lib/db-tenant.ts`:
    - `:1347-1354`: le tre colonne aggiunte a `credColsNuove`;
    - dopo `:1777`: le due chiamate col segno `credenziali_t2_tipi`;
  - modifica `src/lib/transfer/import.ts`: dopo `tenantTx()` chiama
    `normalizzaTipiCredenziali(tenantDb)` direttamente e riscrive il segno
    `credenziali_t2_tipi` (vincoli, «Migrazioni»);
  - modifica `src/lib/permessi/__tests__/letture-mascherate.test.ts:87-94` e
    `src/lib/transfer/__tests__/introspect.test.ts:35-40`: sei colonne cifrate;
  - modifica `src/types/index.ts:201-217` (`Credential`) e `:855-868`
    (`CredentialInput`): il tipo da `TipoCredenziale`, più `auth_method`;
  - `src/lib/db-schema.ts` (vecchio `ipam.db`) non si tocca: la migrazione deve saper
    partire anche dalla sua definizione.
- [ ] **Interfacce prodotte:**
  ```ts
  export interface EsitoMigraCredenziali { eseguita: boolean; righe: number; figli: Record<string, number>; violazioniPrima: number; violazioniDopo: number; seq: number | null }
  export function migraCredenzialiTipi(db: Database.Database): EsitoMigraCredenziali;
  export interface EsitoNormalizza {
    linuxInSsh: number; snmpInV3: number; ibrideDivise: Array<{ id: number; nuova: number }>; v3Vecchie: number;
    lasciate: Array<{ id: number; motivo: string }>;
  }
  export function normalizzaTipiCredenziali(db: Database.Database): EsitoNormalizza;
  ```
  **Regole della normalizzazione** (una transazione, idempotente):
  - `linux` → `ssh`;
  - `snmp` con `security_level` e `encrypted_password` NULL → `snmp_v3`;
  - **ibrida** (`snmp` con livello **e** community): si **divide**.
    - L'originale resta `snmp` con lo stesso id, perché binding e catene oggi la usano
      come community (`getCredentialCommunityString`, `db-tenant.ts:4617-4628`, la legge
      da `encrypted_password`). I campi v3 si azzerano, e anche `encrypted_username`
      (l'utente v3) diventa NULL.
    - Nasce `«<nome> (v3)»`, di tipo `snmp_v3`, coi campi v3 **e** `encrypted_username`
      copiati cifrati come sono.
    - Nella stessa transazione, le colonne (`credential_id`, `snmp_credential_id`) e i
      binding `snmp` degli apparati `snmp_v3` che puntavano all'originale passano alla
      voce nuova: dalla 2a (T3) quegli apparati la leggevano come v3, e devono continuare;
  - **v3 vecchia** (`snmp` senza livello, con utente e password, usata da un apparato
    `snmp_v3`):
    - se **tutti** i suoi usi (colonne, binding, catene, righe host) sono apparati
      `snmp_v3` → conversione sul posto: `snmp_v3`, `security_level='authNoPriv'`,
      `auth_protocol='MD5'`, `encrypted_auth_key = encrypted_password` (testo cifrato
      copiato, senza decifrare), `encrypted_password = NULL`; `encrypted_username` resta
      (è l'utente v3);
    - se ha anche altri usi (apparati v2c, catene, righe host), dove fa da community v2c
      → si divide come l'ibrida: l'originale resta `snmp` con `encrypted_password` (la
      community) ed `encrypted_username` NULL; la voce `«<nome> (v3)»` riceve
      `encrypted_username`, `encrypted_auth_key = encrypted_password`, authNoPriv/MD5; gli
      usi degli apparati `snmp_v3` passano alla voce nuova;
  - tipo sconosciuto → lasciato com'è ed elencato in `lasciate`; il segno diventa
    `parziale:`.
- [ ] **Prova prima del codice:**
  - DB costruito con la definizione **vecchia completa** (13 colonne con `port` in fondo,
    CHECK a 5 tipi), una riga figlia in ognuna delle 10 colonne con chiave esterna, 1
    orfano in `host_credentials` e `seq` più alto di `max(id)`. Dopo la migrazione:
    stessi id, stessi 10 conteggi, `seq` conservato, `foreign_key_check` = 1, un INSERT
    di tipo `unifi` riesce, indici e trigger ci sono;
  - lo stesso DB con in più le due colonne del T22 (`network_controllers.credential_id`,
    `ad_integrations.credential_id`), una riga figlia ciascuna: la migrazione conta 12
    figlie (ricavate da `PRAGMA foreign_key_list`) e le ritrova tutte;
  - chiamata dentro una transazione aperta → rifiuta senza toccare niente;
  - le due definizioni del vecchio `ipam.db` (senza virgolette con 3 tipi più gli ALTER
    di `db.ts:278-286`; fra virgolette, 5 tipi e 7 colonne, nata da `db.ts:650-662`, più
    gli ALTER) e la definizione di DEFAULT (senza `port`, ALTER prima) → riesce;
  - seconda chiamata → nessun effetto;
  - un caso per ogni regola della normalizzazione, e in più:
    - v3 vecchia usata da un apparato `snmp_v3` **e** da un apparato `snmp_v2` → divisa:
      l'apparato v2c legge ancora la stessa community, quello v3 legge la voce nuova
      col suo utente;
    - ibrida usata da un apparato `snmp_v3` → dopo la divisione l'apparato apre la
      sessione v3 con la voce nuova;
    - l'utente v3 (`encrypted_username`) è sulla voce nuova e NULL sull'originale;
  - **guardia di `prova-a-vuoto.ts`, vista fallire** come quella del T1 (questo script
    scrive, perché fa girare le migrazioni): lanciato come processo figlio con
    `DA_INVENT_DATA_DIR` verso una cartella Y con un DB tenant e `--dati` X, lavora su X e
    lascia Y intatta (mtime, `credentials` e segni uguali).
- [ ] **Commit:** `feat(credenziali): archivio senza CHECK sui tipi, colonne per chiave SSH, linux in SSH, SNMP v3 come tipo`.

### Task 12 — Chi scrive o filtra `linux` o `snmp`, nello stesso rilascio

- [ ] **File**
  - modifica `src/app/(dashboard)/networks/[id]/network-detail-client.tsx`
    (`:234-239`, `:352-366`, `:715-775`): via le quattro catene dallo stato e dal PUT, e
    via il salvataggio parallelo che ingoia gli errori (`.catch(() => null)`). Resta un
    PUT solo, con l'esito controllato;
  - modifica `src/app/api/networks/[id]/route.ts:58-121`: il PUT applica `credential_ids`
    (lo schema lo accetta già, `validators.ts:40-46`) e lo restituisce;
  - modifica `credentialMatchesNetworkRole` (`db-tenant.ts:3986-3996`, `db.ts:3863-3872`):
    il ruolo `linux` accetta la famiglia SSH, via `tipiPerProtocollo("ssh")`;
  - modifica `src/app/onboarding/onboarding-wizard.tsx:196-197`: la scheda Linux crea
    `ssh`;
  - modifica `src/app/(dashboard)/settings/page.tsx:1269`: il filtro accetta la famiglia
    SSH (la scheda si toglie nella 2d, secondo D3);
  - modifica `src/lib/vuln/edge-credentials-bridge.ts:56-62`: `slotForType` passa da
    `normalizzaTipo`;
  - modifica `src/lib/integrations/self-identity.ts:108-109`:
    `credential_type IN ('windows','ad')`;
  - modifica `src/lib/encryption-key-health.ts:52-75`: il campione legge anche
    `encrypted_username`;
  - togli `getHostWindowsCredentials` / `getHostLinuxCredentials` (`db-tenant.ts:3927-3951`,
    `db.ts:3813-3837`, senza chiamanti) e `NetworkCredentialsTableLegacy`
    (`network-credentials-table.tsx:444-767`, senza chiamanti);
  - **ogni confronto col tipo grezzo `snmp`** passa da `tipiPerProtocollo("snmp")` o da
    `normalizzaTipo`, perché dalla 2c esiste `snmp_v3`:
    - `src/lib/scanner/discovery.ts:2497` (la `credential_validate` entra nel ramo SNMP,
      e quindi nel ramo v3 di `:2510`, solo con `credType === "snmp"`);
    - `src/app/api/credentials/[id]/test/route.ts:57` (il ramo v3 si decide dalla forma
      del segreto, T4);
    - le tendine «SNMP aggiuntivo»: `credential-assignment-fields.tsx:134`, `:142`;
      `networks/[id]/network-detail-client.tsx:1584`; `discovery/page.tsx:2822`;
    - `network-credentials-table.tsx:471-472`, `:567-572` e
      `edge-credentials-bridge.ts:75` (lo slot SNMP verso lo scanner resta solo
      community: una voce `snmp_v3` si salta con `selected_for_scan: false` e il motivo);
  - **i filtri, non solo le etichette**, di `src/components/hosts/host-software-card.tsx`:
    - `:279-281` tiene solo `windows` o `linux`: diventa `tipiPerProtocollo("winrm")` più
      `tipiPerProtocollo("ssh")`;
    - `:422-423` tiene il tipo uguale a `osHint`, che è `device.vendor` (`"linux"`,
      passato da `devices/[id]/page.tsx:2646` e `objects/[id]/page.tsx:2472`): diventa
      una mappa da piattaforma a protocollo (`linux`/`macos` → `ssh`, `windows` →
      `winrm`) e poi `tipiPerProtocollo`;
    - il badge «Windows/Linux» (`:725-737`) si ricava dal tipo normalizzato.

    Dopo la 2c l'unica voce `linux` di H1 (usata da 5 scansioni software) diventa `ssh`:
    senza questo, sparirebbe dalla tendina dell'inventario software;
  - le tendine col codice grezzo mostrano `etichettaTipo`:
    `network-credentials-table.tsx:173-187`, `:567-586`;
    `credential-assignment-fields.tsx:131-142`; `discovery/page.tsx:2821-2855`;
    `device-credentials-table.tsx:453`, `:532` (oggi «(snmp_v3)», «(ssh)»).
- [ ] **Prova prima del codice:**
  - PUT `/api/networks/[id]` con `credential_ids` → lista applicata e restituita (oggi
    ignorata);
  - POST `/api/networks` con `linux_credential_ids` che contiene una voce `ssh` → **201**
    (`networks/route.ts:101`) e la lista applicata. Oggi risponde 400 dopo aver creato
    la rete (`networks/route.ts:76-101`);
  - una voce `snmp_v3` compare nelle tre tendine «SNMP aggiuntivo», e la
    `credential_validate` la prova (ramo v3);
  - resa in locale coi dati finti: una voce `ssh` compare nella scheda software di un
    host Linux e di un apparato con `vendor = "linux"`.
- [ ] **Commit:** `fix(credenziali): Linux confluisce in SSH ovunque, la pagina della rete non rimanda più le catene nascoste`.

### Task 13 — Pagina Credenziali e API sui tipi per esteso; voci in uso

- [ ] **File**
  - modifica `src/lib/validators.ts:134-151`, `CredentialSchema` da `tipi.ts`:
    - `credential_type: z.enum(TIPI_CREDENZIALE)` più `linux` normalizzato;
    - `auth_method`;
    - limiti: username 256, password 4096, `private_key` 16384, `passphrase` 1024;
    - nella PUT ogni campo è facoltativo, e i campi richiesti si verificano sulla voce
      risultante (salvata più modifiche) con `campiRichiesti`;
  - modifica `src/app/api/credentials/route.ts:35-88`: i campi richiesti vengono da
    `tipi.ts` (via le regole scritte a mano di `:47-61`); risposta con
    `mascheraCredenziale`;
  - modifica `src/app/api/credentials/[id]/route.ts`:
    - GET, PUT e DELETE con `mascheraCredenziale`;
    - la PUT rifiuta con 409 il cambio di tipo di una voce in uso (D8);
    - la DELETE (`:81-97`) risponde 409 con gli usi (D8 = (a));
  - modifica `src/lib/credentials/aggiornamenti.ts:18-34`: campi nuovi; un segreto vuoto
    vuol dire «non modificare»;
  - crea `src/lib/credentials/maschera.ts` e `src/lib/credentials/usi.ts`;
  - modifica `createCredential` / `updateCredential` (`db-tenant.ts:3848-3921`,
    `db.ts:3737-3810`): colonne nuove; il tipo si controlla con `normalizzaTipo`;
  - modifica `replaceNetworkCredentials` e le aggiunte alla lista (`db-tenant.ts:4235`,
    gemelle in `db.ts:4120`): rifiutano i tipi che non valgono per nessun protocollo
    d'accesso (`unifi`, `omada`, `ad`) con un messaggio italiano;
  - **ogni scrittore che lega una voce a un protocollo** controlla il tipo con
    `tipiPerProtocollo` e risponde 400 con «La credenziale «X» è di tipo <etichetta>, non
    vale per <protocollo>». Oggi il controllo c'è solo sulla lista della rete, e il
    motore scarterebbe dopo, in silenzio:
    - `api/devices/[id]/credentials/route.ts`: POST (`AddBindingSchema`, `:56-62`) e
      azione `update` (`:142-148`);
    - `api/hosts/[id]/credentials` (POST) e `api/hosts/bulk-update/route.ts:121-133`
      (`addHostCredential`);
    - `winrm_credential_id` dell'AD: `api/ad/route.ts:55` e `api/ad/[id]/route.ts:25`
      (solo voci ammesse per `winrm`, D7);
  - modifica `src/lib/credential-protocol-map.ts:62-68`: `CRED_TYPE_OPTIONS` passa agli
    otto tipi, e la creazione rapida della credenziale principale
    (`network-detail-client.tsx:1607`, `discovery/page.tsx:2838`) le filtra con
    `tipiPerProtocollo(protocollo)`: niente UniFi, Omada o AD legati a un apparato;
  - modifica `src/app/(dashboard)/credentials/page.tsx` (`:51`, `:109-164`, `:319-470`,
    `:557-575`): l'interfaccia proposta, punto 1;
  - nuova prova d'invariante: nessun `INSERT INTO credentials` fuori dal CRUD e dai
    moduli `src/lib/credentials/{normalizza,converti}-*.ts`.
- [ ] **Interfacce prodotte:**
  ```ts
  export interface CredenzialeVista {
    id: number; name: string; credential_type: string; etichetta: string; auth_method: string | null; port: number | null;
    security_level: string | null; auth_protocol: string | null; priv_protocol: string | null;
    ha_password: boolean; ha_chiave_privata: boolean; ha_auth_key: boolean; ha_priv_key: boolean;
    usi_totale: number; created_at: string; updated_at: string;
  }
  export function mascheraCredenziale(c: Credential, usiTotale: number): CredenzialeVista;
  export interface UsiCredenziale {
    apparati: Array<{ id: number; nome: string; come: "binding" | "colonna" }>;
    reti: Array<{ id: number; nome: string }>; host: number;
    controller: Array<{ id: number; nome: string }>; ad: Array<{ id: number; nome: string; come: "ldap" | "winrm" }>;
    proxmox: number; scansioniSoftware: number;
  }
  export function usiCredenzialeDb(dbh: Database.Database, id: number): UsiCredenziale;
  export function usiTotaliDb(dbh: Database.Database): Map<number, number>;   // una query, niente N+1
  ```
  **Nella 2c** `controller` è sempre `[]` e `ad` ha solo `come: "winrm"`
  (`ad_integrations.winrm_credential_id`): le colonne `network_controllers.credential_id`
  e `ad_integrations.credential_id` nascono nel T22, e una query che le nomina darebbe
  «no such column», cioè 500 su «Usata da», DELETE e PUT. Le aggiunge il T22.
- [ ] **Prova prima del codice:**
  - POST col tipo `linux` → la voce si crea come `ssh`;
  - DELETE di una voce in uso → 409 con gli usi (oggi 200 e cascata);
  - PUT che cambia il tipo di una voce in uso → 409;
  - nessuna risposta di GET, POST o PUT contiene una colonna `encrypted_*` o un segreto
    in chiaro (le colonne si leggono dallo schema);
  - UniFi col metodo `chiave` senza chiave → 400 col messaggio;
  - una voce `ad` nella lista di una rete → 400;
  - una voce `ad` come binding WinRM, come riga host WinRM e come `winrm_credential_id`
    dell'AD → 400 col messaggio (una prova per ciascuno);
  - la creazione rapida per un apparato `ssh` non offre UniFi, Omada né AD;
  - l'invariante.
- [ ] **Commit:** `feat(credenziali): pagina e API sui tipi per esteso, voci in uso protette`.

### Task 14 — Forme nuove: chiave SSH e token API (D6)

- [ ] **File** (con D6 = (a))
  - modifica `src/lib/devices/ssh-transport.ts`:
    - `:51-62`: `password?: string`, `privateKey?: string`, `passphrase?: string`;
    - `:147-193`: `authHandler` prova prima `publickey` se c'è la chiave, poi `password`,
      poi `keyboard-interactive`;
    - `:313`: il messaggio quando la chiave è rifiutata;
  - `getDeviceCredentials` restituisce anche `privateKey` / `passphrase`, e i chiamanti
    SSH passano `...opzioniSsh(…)` invece di `{ username, password }`:
    `switch-client.ts`, `router-client.ts`, `vendor-interface-probes.ts`,
    `acquisition/mikrotik.ts`, `nas-acquisition.ts`, `device-info.ts`, `discovery.ts`
    (`:1605`, `:1919`, `:2468`), `prova-binding.ts:33-42`,
    `api/credentials/[id]/test/route.ts:85-113`;
  - modifica i due consumatori SSH con la password obbligatoria:
    - `src/lib/proxmox/proxmox-ssh.ts` (`ProxmoxSshConfig.password: string` a `:32`,
      usata a `:49`, `:182`, `:201`: è l'acquisizione di `hypervisor_sync`): `opzioniSsh`;
    - `src/lib/devices/device-connection-test.ts:164-167` (rifiuta senza
      `creds.password`) e `:190-207` (prova SSH di Proxmox): accetta una voce a chiave per
      la parte SSH; la parte API di Proxmox resta con la password e, senza, lo dice;
  - modifica `src/lib/vuln/edge-credentials-bridge.ts:88-100` (slot `ssh` verso lo
    scanner): una voce a chiave si salta con `selected_for_scan: false` e il motivo
    «Non inviata allo scanner: chiave SSH», visibile nell'anteprima (interfaccia, punto
    9), invece di partire con la password vuota;
  - modifica `src/lib/devices/ssh-run.ts` (ponte paramiko) e
    `src/lib/ssh-terminal/ws-handler.ts`: una voce a chiave dà «Credenziale a chiave non
    supportata da <percorso>: usa una credenziale con password», senza ripiego;
  - il token API si legge da `segreti.ts` (forma `token`); il primo consumatore è Omada,
    nel T20.
- [ ] **Prova prima del codice:**
  - un server `ssh2` in locale (classe `Server` di ssh2) che accetta solo `publickey`:
    `connectSsh` con una chiave ed25519 riesce (oggi il tipo esige la password);
  - con una voce a chiave il ponte paramiko dà il messaggio esplicito;
  - `extractProxmoxViaSsh` con una voce a chiave passa la chiave al trasporto (oggi il
    tipo esige la password);
  - la prova di connessione di un Proxmox con una voce a chiave non risponde più
    «Configura le credenziali…» per la parte SSH;
  - l'anteprima edge con una voce a chiave nella lista della rete la mostra con
    `selected_for_scan: false` e il motivo.
- [ ] **Commit:** `feat(ssh): credenziali SSH con chiave privata nel trasporto principale`.

### Task 15 — Rilascio 2c (zona rossa)

- [ ] Procedura R completa. La prova a vuoto dà i conteggi attesi della sotto-tappa e la
  seconda apertura 0 cambi. La fotografia «dopo» è uguale a «prima» (stesso istante,
  con `--con-fonte`): la voce convertita in H1 cambia tipo ma non id né segreto, e la
  fotografia non registra il tipo.
- [ ] Verifica sui DB vivi, in sola lettura:
  - `PRAGMA table_info(credentials)` dà 16 colonne;
  - in `sqlite_master` non c'è più il CHECK;
  - il segno è `done:`;
  - stessi conteggi della prova a vuoto.

  Nella pagina Credenziali, resa in locale coi dati finti a 1280 e 1920, gli otto tipi e
  la colonna «Usata da».
- [ ] **ADR 0017** «Archivio unico delle credenziali: tipi senza CHECK, validazione in
  `tipi.ts`», con «cosa diventa difficile» (sezione finale); CHANGELOG.

---

## Sotto-tappa 2d — catene di rete su una lista sola

**Perché.** La spec unifica le catene. Oggi le catene vecchie le scrive solo la pagina
della rete, che le rimanda senza mostrarle; le legge il motore, ma non la validazione.
Il pin fa da corto circuito nella discovery, e la chiave dell'hub si accoda in ogni
tenant senza controllare il tipo.

**Conteggi attesi:**
- lista nuova:
  - H1 28 → **29** (1 riga dalle catene vecchie; le chiavi dell'hub non si copiano, due
    tenant attivi);
  - A 19 → **20 + N**: 1 riga dalle catene vecchie, più N righe dalla chiave Windows
    dell'hub, con N = reti di A dove l'id esiste, è di tipo `windows` e manca dalla
    lista (al più 7). N viene dalla misura #31 rifatta nel T1 e **si fissa qui prima del
    T16**;
  - H2 0 → 0;
- righe host dai pin: **0** nuove (i 16 equivalenti esistono);
- `saltate`: le chiavi dell'hub su H1, H2 e DEFAULT (motivo «due tenant attivi»);
  nessun'altra;
- righe con tipo diverso dal ruolo: 0.

### Task 16 — Conversione delle catene vecchie

- [ ] **File**
  - crea `src/lib/credentials/converti-catene.ts` e la sua prova;
  - modifica `db-tenant.ts`: la chiamata dopo la 2c, con le globali lette dall'hub
    (`getSetting` e `getActiveTenants`, già importate a `:30`) e il segno
    `credenziali_t2_catene`;
  - modifica `import.ts`: la chiamata con `globali = null`;
  - estendi `prova-a-vuoto.ts`.
- [ ] **Interfacce prodotte:**
  ```ts
  export interface GlobaliHub { windows: number | null; linux: number | null; tenantAttivi: number }
  export interface EsitoCatene {
    aggiunteLista: Array<{ network_id: number; credential_id: number; da: "windows" | "ssh" | "linux" | "snmp" | "globale" }>;
    righeHostDaPin: number; pinGiaPresenti: number;
    saltate: Array<{ network_id?: number; host_id?: number; credential_id: number; motivo: string }>;
  }
  export function convertiCateneVecchie(db: Database.Database, globali: GlobaliHub | null, opzioni: { aVuoto: boolean }): EsitoCatene;
  ```
  **Regole:**
  - per ogni rete, dopo `MAX(sort_order)` della lista nuova si accodano le righe vecchie
    che mancano, nei ruoli windows, ssh, linux, snmp (dentro il ruolo per `sort_order`,
    poi id). La posizione già presente vince. Il tipo deve combaciare col ruolo secondo
    `tipiPerProtocollo`, altrimenti la riga si salta;
  - **si deduplica per `credential_id` su tutti i ruoli** prima di accodare, tenendo la
    prima posizione: `network_host_credentials` ammette la stessa voce in più ruoli
    (UNIQUE con `role`, `db-tenant-schema.ts:348-355`) e dalla 2c il ruolo linux accetta
    voci ssh, mentre `network_credentials` ha UNIQUE(network_id, credential_id)
    (`:367-374`): una voce in due ruoli farebbe scattare l'UNIQUE, ROLLBACK, e la 2d
    resterebbe ferma su quel tenant;
  - pin → `host_credentials`, se non c'è già una riga per (host, voce, protocollo) su
    qualunque porta:
    - protocollo dal ruolo (windows → winrm, linux e ssh → ssh, snmp → snmp);
    - porta da `portaCredenziale`;
    - `validated=1`, `validated_at = pin.updated_at`, `auto_detected=1`;
  - chiavi dell'hub secondo D3: con D3 = (a), solo se `tenantAttivi === 1`, l'id esiste e
    il tipo combacia; vanno dopo le vecchie;
  - le tabelle vecchie non si svuotano: restano congelate fino alla 2g. Per questo la
    conversione, col segno `done:` o `parziale:`, non si richiama più (vincoli,
    «Migrazioni»): una voce tolta dalla lista tornerebbe dalla catena congelata;
  - una transazione; ROLLBACK se i conteggi non tornano; `parziale:` se `saltate` ha
    motivi diversi da «due tenant attivi».
- [ ] **Prova prima del codice:**
  - lista [A,B], vecchie windows [C], ssh [B], linux [D] → lista [A,B,C,D];
  - **per ssh, winrm e snmp il motore dà la stessa sequenza di voci prima e dopo la
    conversione** (è la proprietà della sotto-tappa);
  - pin con equivalente → 0 righe; pin senza → una riga validata;
  - chiave globale con due tenant attivi → saltata, col motivo;
  - voce B nel ruolo ssh e nel ruolo linux della stessa rete, assente dalla lista → B
    una volta sola;
  - seconda chiamata → nessun effetto;
  - in `getTenantDb`: conversione fatta, l'utente toglie dalla lista la voce arrivata da
    una catena vecchia, seconda apertura → la voce non torna.
- [ ] **Commit:** `feat(credenziali): catene vecchie e pin convertiti nella lista della rete`.

### Task 17 — Le catene vecchie non si scrivono e non si leggono più

- [ ] **File**
  - modifica `src/app/api/networks/route.ts:54-101` e `src/app/api/networks/[id]/route.ts:58-121`:
    - i quattro campi vecchi si traducono nell'accodamento alla lista nuova;
    - la risposta porta `avvisi: ["windows/linux/ssh/snmp_credential_ids sono superati: usare credential_ids"]`,
      con una riga nel log;
    - si valida prima di `createNetwork`, quindi niente più scrittura a metà;
    - la GET non restituisce più le catene vecchie;
  - modifica `src/app/(dashboard)/networks/[id]/page.tsx:33-43`: via
    `getNetworkHostCredentialIds`;
  - modifica `onboarding-wizard.tsx:203-208`: niente `putSetting` delle chiavi globali;
  - modifica `settings/page.tsx:276-277`, `:359-366`, `:386-405`, `:1238-1278`: via la
    scheda (D3);
  - modifica `src/lib/scanner/discovery.ts`:
    - rilevamento windows (`:1440-1520`), ssh (`:1563-1660`) e `ipam_full` fase 4
      (`:1888-1965`): catena per host = `resolveCredentialsFor({ hostId, ip, networkId }, proto, { includeBackoff: true })`,
      col comportamento di D2;
    - via `setHostDetectCredential` (`:1510`, `:1648`, `:1654`, `:1955`, `:1959`);
    - corretto il salto di `:1891`, che con la catena di rete vuota salta anche gli host
      con una credenziale propria;
  - modifica `resolve.ts`: il livello `legacy_chain` e `hub_default` si leggono solo se il
    segno `credenziali_t2_catene` non è `done:` né `parziale:` (le righe `saltate` hanno
    un tipo che il filtro scarterebbe comunque); il motore lo legge da `tenant_settings`
    con l'handle, una volta per chiamata pubblica;
  - modifica `edge-credentials-bridge.ts:152-210`: slot dalla lista della rete via motore;
    via `getNetworkHostCredentialIds("snmp")`;
  - modifica `api/hosts/[id]/route.ts:30-62` e `validators.ts:73-79`: `detect_credentials`
    → 400 «campo superato»;
  - modifica `getHostById` (`db.ts:2800`, `db-tenant.ts:2529`) e
    `src/types/index.ts:735-736`: senza `detect_credentials`.
- [ ] **Prova prima del codice:**
  - rilevamento Windows con la credenziale validata che ora fallisce: con D2 = (a) si
    passa alla successiva entro il tetto (oggi ci si ferma);
  - `ipam_full` con catena di rete vuota e host con una credenziale propria → l'host si
    prova (oggi no);
  - motore senza `legacy_chain` col segno `done:`;
  - POST `/api/networks` coi campi vecchi → lista nuova più `avvisi`;
  - anteprima edge uguale prima e dopo la conversione.
- [ ] **Commit:** `feat(reti): una lista sola di credenziali per rete, discovery sul motore`.

### Task 18 — Rilascio 2d

- [ ] Procedura R completa. Conteggi attesi della sotto-tappa. Fotografia «dopo» contro
  «prima» (stesso istante, con `--con-fonte`):
  - stesse catene di rete, tranne quanto sotto;
  - anteprima edge identica, tranne quanto sotto;
  - le sole differenze sono:
    - la fonte `network_chain` al posto di `legacy_chain`;
    - con D2 = (a), le catene per host che continuano dopo la validata;
    - in A, la chiave Windows dell'hub che da `hub_default` diventa `network_chain` nelle
      N reti (stessa voce, stessa posizione in coda);
    - **sull'hub, con D3 = (a)**: nelle reti di H1 dove l'id globale non era già nella
      lista, quella voce sparisce dalle catene SSH/Windows e dall'anteprima edge, cioè
      da validazione, discovery e scansioni autenticate di GVM. Si elencano per nome e
      **servono l'ok di Riccardo** (passo 3), anche se il numero è quello misurato nel T1.

    Si elencano per nome.
- [ ] Verifica dopo il rilascio:
  - primo giro di discovery e di `credential_validate` su hub e A: nessun «Nessuna
    credenziale configurata» nuovo e nessun «775»/«52e» nuovo;
  - la pagina della rete mostra la voce convertita (+1 in H1 e +1 in A);
  - `cred_catena_vecchia` e `cred_chiave_hub` a 0 dopo l'apertura.
- [ ] CHANGELOG: una lista sola; la validazione prova anche le voci arrivate dalle catene
  vecchie (+1 per tenant) e perché.

---

## Sotto-tappa 2e — credenziali degli apparati nell'archivio

**Perché.** La spec chiede che i binding inline diventino voci col nome dell'apparato.
In più ci sono le colonne vecchie, unico accesso per 6 apparati in H1 e 1 in A: devono
diventare binding prima che la 2g smetta di leggerle. E chi scrive deve smettere di
scrivere colonne e inline.

**Definizioni usate nei conteggi e nel T19:**
- **binding equivalente** a una colonna `credential_id` / `snmp_credential_id`: un
  binding dello stesso apparato, dello stesso protocollo, verso la stessa voce;
- **binding equivalente** a utente e password in colonna: un binding dello stesso
  apparato e protocollo con lo stesso utente e lo stesso segreto, confrontati
  **decifrati in memoria** (si stampa solo «uguale» / «diverso»);
- **fonte SNMP dell'apparato**: un binding `snmp`, o una colonna verso una voce SNMP. La
  catena della rete non conta.

**Conteggi attesi** (quelli segnati «T1» si fissano con le misure del T1 prima del T19):
- binding inline: H1 3 (su 2 apparati), H2 2 (1), A 3 (2) → **voci nuove 3 / 2 / 3**,
  inline rimasti **0**;
- binding nati dalle colonne:
  - H1: 5 SNMP sulla 161; più 1 SSH, con voce nuova, dall'utente/password in colonna
    senza binding equivalente (T1: il secondo apparato con utente e password in colonna
    deve risultare «uguale» al suo binding);
  - H2: 0 o 1 voce più binding dall'utente/password in colonna, secondo il confronto in
    memoria col binding inline ssh (T1); la community in colonna no, perché c'è il
    binding inline SNMP;
  - A: **3**: 1 SSH (l'apparato in cui colonna e primo binding divergono), 1 API sulla
    porta dell'apparato per il Proxmox `api` che ha solo un binding ssh (voce di tipo
    ssh, F1), 1 WinRM sulla 5985 per l'apparato di F2; più i binding SNMP delle colonne
    `snmp_credential_id` / `credential_id` SNMP senza un binding equivalente (T1);
- `community_string` diventa una voce solo dove l'apparato non ha nessuna fonte SNMP
  (T1, elenco per nome dalla prova a vuoto);
- colonne svuotate: tutte quelle degli apparati convertiti; `lasciati`: **0** su hub e A;
- `api_token`: 0.

### Task 19 — Conversione delle credenziali degli apparati

- [ ] **File:** crea `src/lib/credentials/converti-apparati.ts` e la sua prova; chiamata in
  `db-tenant.ts` col segno `credenziali_t2_apparati`; `import.ts`; `prova-a-vuoto.ts`.
- [ ] **Interfacce prodotte:**
  ```ts
  export interface EsitoApparati {
    bindingDaColonne: Array<{ device_id: number; protocollo: CredProtocol; credential_id: number; porta: number }>;
    vociNuove: Array<{ id: number; nome: string; tipo: TipoCredenziale; device_id: number }>;
    colonneSvuotate: Array<{ device_id: number; colonne: string[] }>;
    inlineRimasti: number; lasciati: Array<{ device_id: number; motivo: string }>;
  }
  export function convertiCredenzialiApparati(db: Database.Database, opzioni: { aVuoto: boolean }): EsitoApparati;
  ```
  **(a) Colonne senza un binding equivalente:**
  - `credential_id` → binding sul protocollo principale:
    - `snmp_v2` / `snmp_v3` → `snmp` sulla `portaCredenziale(voce,"snmp")`, **mai**
      `device.port`;
    - `ssh` / `winrm` / `api` → `device.port` (per `api` anche con una voce `ssh`, F1);
    - se la voce non è compatibile, binding sul protocollo del suo tipo (`windows` →
      `winrm` sulla 5985, F2), ed elencato;
  - `snmp_credential_id` → binding `snmp`;
  - `username` + `encrypted_password` senza un binding equivalente → voce più binding;
  - `community_string` solo se non c'è nessuna fonte SNMP dell'apparato → voce `snmp` più
    binding;
  - `api_token` → voce `api` con metodo `token`, più binding `api`;
  - binding nuovi: `untested`, `sort_order = MAX+1`.

  **(b) Ogni binding inline → una voce:**
  - il tipo segue il protocollo: ssh → ssh, snmp → snmp, winrm → windows, api / redfish /
    onvif → api;
  - lo username si cifra; il segreto cifrato si copia com'è (in chiaro → `encrypt`);
  - `port` NULL se è quella standard;
  - poi l'UPDATE del binding (voce nuova, campi inline a NULL), che conserva
    `test_status`, `tested_at`, `sort_order`, `port` e `auto_detected`;
  - un inline incompleto (utente senza segreto, o vuoto) si lascia ed elenca (0 il 15/10).

  **(c) Le colonne si svuotano nella stessa transazione.** Per ogni apparato convertito,
  le colonne che sono diventate binding, o che avevano già un binding equivalente,
  vanno a NULL (`credential_id`, `snmp_credential_id`, `username`, `encrypted_password`,
  `community_string`, `api_token`). Così dopo la 2e il motore non può ripiegare su una
  colonna che la pagina non mostra più: un «Nessuna» scelto dall'utente vale davvero, e la
  voce non resta «in uso» (D8) per una colonna invisibile. Un ritorno al codice di prima
  resta possibile: anche quello legge prima i binding (`db-tenant.ts:4651-4722`). Le
  colonne degli apparati in `lasciati` non si toccano.

  **Controlli nella transazione** (un SAVEPOINT per apparato):
  - per ogni apparato e protocollo (principale e `snmp`), la scelta **prima** si calcola
    con tutte le fonti e la scelta **dopo** con le fonti della 2g, cioè
    `FONTI_ACQUISIZIONE` senza `device_inline` né `device_column*`: così si dimostra che
    togliere le colonne non cambia la scelta. Tutte e due con `registra: false`. Impronta
    e porta devono essere uguali; altrimenti ROLLBACK al SAVEPOINT dell'apparato, che va
    in `lasciati` col motivo;
  - alla fine: 0 inline rimasti (fuori dai `lasciati`) e `foreign_key_check` non peggiore
    di prima, altrimenti ROLLBACK di tutto;
  - segno `done:` se `lasciati` è vuoto, `parziale:` altrimenti. Con l'uno o con l'altro la
    conversione non si richiama (vincoli, «Migrazioni»).
- [ ] **Prova prima del codice** (forma vera):
  - `snmp_v2` con porta 22 e voce SNMP in colonna senza binding → binding `snmp:161` e
    colonna a NULL;
  - Proxmox `api` con voce `ssh` in colonna e solo un binding `ssh:22` → binding `api`
    sulla porta dell'apparato;
  - inline SSH completo → `«<nome> · SSH»` e il binding la punta con lo stesso
    `test_status`;
  - due apparati con lo stesso nome → il secondo ha `« (apparato #id)»`;
  - community inline → voce con lo stesso testo cifrato;
  - impronte uguali prima e dopo, calcolate con le fonti della 2g;
  - un apparato con una forma che la conversione non tratta (colonna con un segreto che
    non diventa binding) → in `lasciati`, colonne intatte, segno `parziale:`, e il
    controllo lo vede proprio perché il «dopo» non legge le colonne;
  - il controllo non scrive nel registro dei ripieghi;
  - inline incompleto lasciato;
  - seconda chiamata → nessun effetto;
  - in `getTenantDb`: conversione fatta, l'utente toglie il binding nato da una colonna,
    seconda apertura → il binding non torna.
- [ ] **Commit:** `feat(apparati): binding inline e colonne vecchie diventano voci e binding d'archivio`.

### Task 20 — Chi scrive le credenziali degli apparati scrive solo binding d'archivio

- [ ] **File**
  - modifica `src/lib/devices/crea-apparato.ts:59-108`: utente/password o community
    diventano una voce più il binding. Niente più `username`, `encrypted_password`,
    `community_string`, `api_token` in colonna;
  - modifica `src/app/api/devices/bulk/route.ts`:
    - POST `:102-232`: niente copia della community (`:108-115`, `:188`);
    - PATCH `:280-322`, semantica (interfaccia, punto 8): una voce scelta per un
      protocollo **si aggiunge** in testa ai binding di quel protocollo
      (`sort_order` = minimo − 1, `untested`) e i binding che ci sono restano; `null`
      toglie i binding di quel protocollo (la finestra chiede conferma col numero) e
      svuota la colonna corrispondente; un campo assente non tocca niente. Oggi il PATCH
      scrive solo colonne (`:303-313`) e i binding vincono (`db-tenant.ts:4687-4705`),
      quindi oggi una scelta in blocco non distrugge niente: deve restare così per i
      binding riusciti, con la loro storia di prova (18 in H1);
  - modifica `src/app/api/devices/[id]/route.ts:148-158`: stessa semantica del PATCH, e
    nessuna scrittura delle colonne (`username`, `password`, `community_string`,
    `api_token` nel corpo diventano voce più binding);
  - modifica le tre finestre di modifica del singolo apparato (T5): la tendina parte
    dalla scelta del motore («Usata adesso») o dai binding, non dalla colonna, e manda
    solo i campi toccati;
  - modifica `src/app/api/networks/bulk-assign-credential/route.ts:39-56` (chiamata da
    `networks-list-client.tsx:253`): oggi scrive le colonne del router di ogni rete
    (`credential_id`, `snmp_credential_id`, utente e password a NULL, `community_string`
    cifrata). Diventa: binding d'archivio sul router, con la regola tipo ↔ protocollo e
    la stessa semantica del PATCH, e nessuna colonna. Senza, dopo la 2e riscriverebbe le
    colonne (e dopo la 2g risponderebbe «Credenziali assegnate a N router» senza effetto);
  - modifica `src/lib/ad/ad-client.ts:452-468`: l'apparato «Windows DHCP» nasce col
    binding `winrm`, non con la colonna;
  - modifica `src/app/api/devices/[id]/credentials/route.ts`:
    - i campi inline del POST: è il server a creare la voce col nome dell'apparato;
    - l'azione `update` (`:142-148`) con utente e password nuovi: se la voce del binding
      è dell'apparato (usata solo da quel binding, `usiCredenzialeDb`) la aggiorna,
      altrimenti crea `«<nome apparato> · <protocollo>»` e ci punta il binding;
    - `delete` / `update` (`:134-151`) controllano che il binding sia dell'apparato
      dell'URL, altrimenti 404;
  - modifica `src/lib/devices/aggiornamenti-binding.ts:42-53`: non scrive più
    `inline_username` / `inline_encrypted_password`; i segreti nuovi li passa alla rotta,
    che crea o aggiorna la voce. La tabella dell'apparato la usa nella modifica
    (`device-credentials-table.tsx:236-258`);
  - modifica `src/components/shared/device-credentials-table.tsx:135-280` (interfaccia,
    punto 7) e `src/app/(dashboard)/devices/[id]/page.tsx:519-576`, `:1055-1070`
    (interfaccia, punto 5);
  - modifica `src/lib/devices/router-client.ts:774-806`: il token di Omada viene da
    `scegliSegretoApparatoDb(…, "api")`, forma `token`;
  - modifica `scripts/smoke-ssh-credentials.ts:70-120`: legge l'archivio.

  `api/hosts/bulk-update/route.ts:121-133` resta con `validated=1` (scelta voluta, commento
  a `:120-122`): una correzione manuale deve stare in cima all'ordine per host
  (`resolve.ts:210-235`), sopra le validate vecchie.
- [ ] **Prova prima del codice:**
  - POST `/api/devices` con utente e password → 0 colonne scritte, 1 voce, 1 binding;
  - PATCH in blocco con una voce su un apparato con un binding riuscito → binding nuovo
    in testa, `untested`; quello riuscito c'è ancora, con `test_status` e `tested_at`;
  - PATCH in blocco con `null` → tolti i binding di quel protocollo e svuotata la colonna;
    gli altri protocolli intatti;
  - PUT singolo con solo il nome cambiato → nessun binding toccato;
  - `bulk-assign-credential` con una voce SSH e una SNMP → 2 binding sul router, nessuna
    colonna scritta;
  - `update` con utente e password su un binding d'archivio → 0 inline, e una voce
    condivisa con altri apparati non cambia;
  - `delete` di un binding di un altro apparato → 404 (oggi lo cancella);
  - DC dell'AD → binding `winrm`;
  - token di Omada dall'archivio.
- [ ] **Commit:** `feat(apparati): le credenziali degli apparati si scrivono solo nell'archivio`.

### Task 21 — Rilascio 2e

- [ ] Procedura R completa. Conteggi attesi della sotto-tappa. Fotografia «dopo» contro
  «prima» (stesso istante, con `--con-fonte`): **stesse impronte e porte** per ogni
  apparato e protocollo; cambia solo la fonte (`device_binding` al posto di
  `device_inline` / `device_column` / `device_column_inline`).
- [ ] Verifica:
  - la scheda di un apparato convertito mostra il binding sulla voce
    `«<nome> · SSH»`;
  - il primo `arp_poll` sugli apparati convertiti (MikroTik e firewall) va a buon fine;
  - segno `done:` (non `parziale:`) su H1, H2 e A;
  - nessuna firma nuova di `cred_binding_inline` e `cred_colonna_apparato` nel registro
    dopo l'apertura.

---

## Sotto-tappa 2f — controller e AD dall'archivio

**Conteggi attesi:**
- voci nuove: H1 **2** (UniFi con chiave, AD), A **2** (UniFi con utente, AD), H2 e
  DEFAULT 0;
- `winrm_credential_id` invariato;
- job invariati (`unifi_sync` giornaliero e orario, `ad_sync` ogni 360 minuti).

### Task 22 — Schema e conversione di controller e AD

- [ ] **File**
  - modifica `src/lib/db-tenant-schema.ts:631-652` (`ad_integrations`) e `:1370-1391`
    (`network_controllers`): `credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL`;
  - modifica `db-tenant.ts`: ALTER idempotenti accanto agli altri (un ADD COLUMN con
    REFERENCES e default NULL è ammesso con le chiavi esterne attive), poi la chiamata
    col segno `credenziali_t2_integrazioni`;
  - crea `src/lib/credentials/converti-integrazioni.ts` e la sua prova; `import.ts`;
    `prova-a-vuoto.ts`;
  - modifica `src/lib/credentials/usi.ts`: da qui `usiCredenzialeDb` e `usiTotaliDb`
    contano anche `network_controllers.credential_id` (`controller`) e
    `ad_integrations.credential_id` (`ad`, `come: "ldap"`). Senza, la voce
    «UniFi · <nome>» o «AD · <nome>» risulterebbe senza usi e si potrebbe eliminare (ON
    DELETE SET NULL), e dopo la 2g, con le colonne della riga vuote, il segreto sarebbe
    perso e `unifi_sync` / `ad_sync` si fermerebbero;
  - `resetConfiguration` (`db-tenant.ts:7149-7189`, `db.ts:6213`) resta com'è nella 2f:
    cancella le voci ma non i controller, che con SET NULL restano e, col segno `done:`,
    mostrano «Credenziale mancante» senza ripiegare sulle colonne (T23). Le due DELETE
    delle catene vecchie le sistema il T26.
- [ ] **Interfacce prodotte:**
  ```ts
  export interface EsitoIntegrazioni {
    controller: Array<{ id: number; voce: number; metodo: "chiave" | "utente" | "client" }>;
    ad: Array<{ id: number; voce: number }>;
    lasciati: Array<{ tabella: "network_controllers" | "ad_integrations"; id: number; motivo: string }>;
  }
  export function convertiControllerEAd(db: Database.Database, opzioni: { aVuoto: boolean }): EsitoIntegrazioni;
  ```
  **Regole.** Riguardano le righe con `credential_id` NULL e un segreto presente, e la
  conversione gira **solo se il suo segno manca o vale `errore:`** (vincoli,
  «Migrazioni»): con le colonne ancora piene, rigirarla ricreerebbe voci doppie, o
  ricollegherebbe una voce a un controller spostato senza che nessuno l'abbia scelta.
  - `udm` → `unifi`/`chiave`, con `encrypted_password = api_key_enc`;
  - `self_hosted` → `unifi`/`utente`, con `encrypted_username = encrypt(username)` ed
    `encrypted_password = password_enc`;
  - `omada` → `omada`, col metodo dai campi presenti;
  - AD → `ad`, con utente e password cifrati copiati byte per byte;
  - un valore in chiaro si cifra.

  **Nella transazione:** per ogni riga si decifra in memoria il vecchio e il nuovo, e
  devono essere **uguali** (si stampa solo «uguale» / «diverso»); altrimenti ROLLBACK.
  Le colonne vecchie restano piene fino alla 2g (servono a un ritorno al codice di
  prima). Una forma non riconosciuta va in `lasciati` e il segno è `parziale:`.
- [ ] **Prova prima del codice:**
  - forma vera, idempotente;
  - un segreto in chiaro viene cifrato;
  - un confronto «diverso» simulato porta al ROLLBACK;
  - DELETE della voce di un controller → 409 con l'uso elencato (`usi.ts`), e lo stesso
    per la voce LDAP di un AD;
  - in `getTenantDb`: conversione fatta, il controller si sposta su un altro indirizzo
    senza segreto (T23), seconda apertura → nessuna voce ricreata dalle colonne.
- [ ] **Commit:** `feat(integrazioni): le credenziali di controller e AD entrano nell'archivio`.

### Task 23 — Controller: lettura e scrittura dall'archivio

- [ ] **File**
  - modifica `src/lib/controllers/service.ts`:
    - `:292-348`: `credential_id` oppure segreti nuovi; tipo ↔ metodo (`udm` ↔ unifi /
      chiave, `self_hosted` ↔ unifi / utente), altrimenti 400;
    - `:352-407`: i segreti nuovi creano `«UniFi · <nome>»`. Un cambio d'indirizzo mette
      `credential_id` a NULL **e** svuota `password_enc` e `api_key_enc` della riga, come
      oggi (`:388-392`), a meno che la stessa richiesta non scelga di nuovo una voce o
      porti segreti nuovi. È la difesa che impedisce di mandare il segreto a un host
      nuovo: se le colonne restassero piene, il ripiego le leggerebbe e `unifi_sync`
      manderebbe chiave o password al nuovo indirizzo;
    - `clientConfigOf` `:469-478` e `probeControllerInput` `:496-518`: la voce da
      `leggiSegretoDb`. Con `credential_id` NULL il ripiego sulle colonne della riga
      vale **solo per le righe mai convertite**, cioè se il segno
      `credenziali_t2_integrazioni` non è `done:` (vale `parziale:`, con quella riga fra
      i lasciati, o `errore:`):
      - segno diverso da `done:` e colonne piene → si leggono, si registra
        `cred_riga_integrazione` e `last_message` dice «Credenziale ancora nella forma
        vecchia»;
      - segno `done:`, oppure colonne vuote → «Credenziale mancante», senza nessuna
        connessione. Con `done:` ogni riga col segreto ha ricevuto la sua voce, quindi un
        `credential_id` NULL è uno scollegamento voluto (voce eliminata con D8 = (b),
        `resetConfiguration`), non una riga da convertire;
    - `migrateLegacyUnifiConfig` `:629-679`: crea la voce e poi il controller;
  - modifica `db-tenant.ts:8884-8929`: insert / update e `CONTROLLER_PATCH_COLUMNS` con
    `credential_id`;
  - modifica `src/lib/controllers/types.ts`: la vista porta `credentialId` e `credentialName`;
  - modifica le rotte `src/app/api/controllers/**`;
  - modifica `src/components/controllers/controller-dialog.tsx:220-262` e
    `controllers-model.ts:141-157`, `:200-223` (interfaccia, punto 2);
  - modifica le prove: `service.test.ts` (`:239`, `:251`, `:266`, `:394`, `:536`, `:560`),
    `unifi-sync-job.test.ts`, `transfer/roundtrip.test.ts`.
- [ ] **Prova prima del codice:**
  - un controller con `credential_id` costruisce la stessa `UnifiClientConfig` di quella
    nata dalle colonne;
  - un cambio d'indirizzo senza voce né segreto nuovi → `credential_id` NULL,
    `password_enc` e `api_key_enc` vuoti, e `clientConfigOf` dà «Credenziale mancante»
    (nessuna richiesta parte verso il nuovo indirizzo);
  - `udm` con una voce a utente → 400;
  - il porting vecchio scrive la voce;
  - `credential_id` NULL, colonne piene e segno `parziale:` → il ripiego funziona e il
    messaggio c'è;
  - `credential_id` NULL, colonne piene e segno `done:` (voce cancellata) →
    «Credenziale mancante», nessuna richiesta parte.
- [ ] **Commit:** `feat(controller): il controller usa una voce dell'archivio`.

### Task 24 — AD: lettura e scrittura dall'archivio

- [ ] **File**
  - crea `src/lib/ad/credenziale-ldap.ts` con `credenzialeLdapDi(integrazione)`: la voce
    `ad` da `leggiSegretoDb`; con `credential_id` NULL, colonne della riga piene e segno
    `credenziali_t2_integrazioni` diverso da `done:` (righe mai convertite) le colonne,
    più il ripiego registrato; con segno `done:` o colonne vuote «Credenziale mancante»
    (stessa regola del T23);
  - modifica `src/lib/ad/ad-client.ts`:
    - `:70-105` (`connectLdap`);
    - `:427-442`: WinRM del DHCP con la voce `windows` da `segreti.ts` e la porta
      `portaCredenziale(voce,"winrm")` al posto della 5985 di `:441`;
  - modifica `src/app/api/ad/kerberos/route.ts:195-196`, `:262-263`;
  - modifica `src/lib/integrations/self-identity.ts:102-113`: l'account LDAP da
    `credenzialeLdapDi`; un errore si registra una volta con `console.warn` invece di
    sparire;
  - modifica `src/lib/ad/health/winrm-probe.ts:176-195`: `segreti.ts` (niente più
    `decrypt` nudo) e la porta della voce;
  - modifica le funzioni AD in tutte e due le copie, `db.ts:6565-6640` e
    `db-tenant.ts:6636-6676`, con `credential_id`;
  - modifica `src/app/api/ad/route.ts:13-121` e `src/app/api/ad/[id]/route.ts:15-100`:
    `credential_id` oppure un account nuovo, che crea `«AD · <nome>»`. Con D12 = (a), un
    cambio di `dc_host` mette `credential_id` a NULL **e** svuota `encrypted_username` ed
    `encrypted_password` della riga (`''`, sono NOT NULL), a meno che la stessa richiesta
    non scelga di nuovo la voce o porti un account nuovo. Oggi il cambio di `dc_host` non
    tocca la credenziale (`:62-66`). Con D12 = (b) questo punto non si scrive;
  - modifica `src/lib/credentials/usi.ts` se il T22 non l'ha già fatto per `ad`;
  - modifica `src/app/(dashboard)/active-directory/page.tsx` (interfaccia, punto 3; la
    tendina WinRM di `:324-327` secondo D7);
  - modifica `onboarding-wizard.tsx:214-243`: crea la voce `ad`, poi l'integrazione.
- [ ] **Prova prima del codice:**
  - `connectLdap` riceve dalla voce lo stesso utente e la stessa password che dalle
    colonne;
  - `self-identity` include l'account della voce;
  - la sonda WinRM usa la 5986 se la voce la porta (oggi 5985 fissa);
  - con D12 = (a), un cambio di `dc_host` senza voce né account nuovi → `credential_id`
    NULL, colonne vuote, `credenzialeLdapDi` dà «Credenziale mancante» e nessun bind
    parte verso il DC nuovo; `cred_riga_integrazione` non scatta;
  - `credential_id` NULL con colonne piene: col segno `parziale:` si leggono le colonne
    (ripiego registrato), col segno `done:` «Credenziale mancante» e nessun bind;
  - il wizard crea la voce `ad`.
- [ ] **Commit:** `feat(ad): l'account LDAP dell'AD è una voce dell'archivio`.

### Task 25 — Rilascio 2f

- [ ] Procedura R completa: voci +2 / +2, tutti e 4 i confronti «uguale», segno
  `done:` su H1 e A.
- [ ] Verifica sui DB vivi, in sola lettura:
  - il primo `unifi_sync` orario (fra le 7 e le 20) dà `last_ok = 1`;
  - il primo `ad_sync` dà lo stato ok, su hub e A;
  - `cred_riga_integrazione` a 0;
  - nel journal nessun 429, «775» o «52e».

  **Arresto immediato** al primo accesso rifiutato: si torna indietro col revert. Le
  colonne vecchie sono ancora piene.
- [ ] CHANGELOG: controller e AD dall'archivio; un cambio d'indirizzo scollega la voce, e
  perché.

---

## Sotto-tappa 2g — togliere il vecchio (D9)

### Task 26 — Misura di convivenza e pulizia del codice

- [ ] **Si comincia solo se:**
  - sono passati i giorni di D9 dalla data scritta nel segno `credenziali_t2_integrazioni`
    di hub e A;
  - nel registro (`<DATA_DIR>/logs/ripieghi/`) di hub e A sono a 0, negli ultimi 14
    giorni, i casi `cred_colonna_apparato`, `cred_binding_inline`,
    `cred_catena_vecchia`, `cred_chiave_hub`, `cred_riga_integrazione` e
    `cred_v3_vecchia`. `cred_public` non conta: con D5 = (a) resta per sempre. Si legge
    per caso e firma, col conteggio;
  - i quattro segni valgono `done:` (non `parziale:` né `errore:`) in ogni tenant con dati
    (H1, H2, A). Un tenant mai aperto dopo la 2c, come il DEFAULT dell'hub (si apre solo
    quando qualcuno ripiega sul facade), non ha segni: si dichiara per nome nel messaggio
    a Riccardo e si esclude. Quando si aprirà farà tutte le conversioni in fila; la
    pulizia dei dati lì non partirà mai da sola, perché è uno script (T27).
- [ ] **File**
  - modifica `resolve.ts`: via le fonti `device_inline`, `device_column*`, `legacy_chain`
    e `hub_default` (`snmp_ripiego` resta secondo D5);
  - via il ripiego sulle colonne di controller e AD: con `credential_id` NULL l'errore
    è visibile («Credenziale mancante»);
  - via `getHostDetectCredentialId`, `setHostDetectCredential`,
    `getNetworkHostCredentialIds` e `replaceNetworkHostCredentials` (tutte e due le copie);
  - `resetConfiguration` (`db-tenant.ts:7155-7156` e la gemella `db.ts:6219-6220`): via
    le due `DELETE FROM host_detect_credential` / `network_host_credentials`. Dove le
    tabelle ci sono ancora, le loro righe se ne vanno con la cascata di
    `DELETE FROM credentials`, `hosts` e `networks`; dove non ci sono più, la DELETE
    darebbe «no such table» e, essendo in una transazione, farebbe fallire tutto il reset
    (`api/reset/route.ts:12`, `lab-config-reset.ts:57`);
  - le conversioni (T16, T19, T22) trattano l'assenza delle tabelle e delle colonne
    vecchie (tenant nato dopo la 2g) come «niente da convertire», segno `done:`;
  - via i campi vecchi di `NetworkDevice` (`src/types/index.ts:228-239`) e dai loro
    scrittori;
  - `ProvisionalDevice` diventa voce più protocollo;
  - modifica `src/lib/transfer/import.ts`: le righe di `network_host_credentials` e
    `host_detect_credential` di un bundle vecchio si convertono in memoria con le regole
    del T16, perché la tabella non esisterà più e oggi verrebbero saltate in silenzio
    (`:61`); `table-registry.ts:11-12` le toglie dall'export;
  - modifica `scripts/credenziali/fotografia-scelte.ts` (e il suo modulo d'appoggio): via
    `getNetworkHostCredentialIds` e le catene vecchie, stesso formato.
- [ ] **Prova prima del codice:**
  - un bundle vecchio con catene vecchie si importa in un DB senza quelle tabelle e la
    lista della rete le contiene;
  - il motore non ha più le fonti tolte;
  - `resetConfiguration`, tutte e due le gemelle, su un DB **senza** le due tabelle
    riesce, e su un DB **con** le due tabelle piene le svuota (cascata).
- [ ] **Commit:** `refactor(credenziali): via le letture del vecchio`.

### Task 27 — Svuotamento dei dati vecchi e rilascio 2g

La pulizia dei dati **non sta in `getTenantDb`**: su un'appliance che riceve `main` dopo
la 2g, conversioni e pulizia girerebbero nella stessa apertura, senza i 14 giorni di D9,
senza prova a vuoto e senza backup (`update.sh:109-136` fa build e riavvio). Diventa uno
script, come `togli-chiavi-hub.ts`.

- [ ] **File**
  - crea `src/lib/credentials/pulizia-t2.ts` (pura, con l'handle) e la sua prova, e
    `scripts/credenziali/pulizia-t2.ts` (riga di comando: guardia e ambiente come negli
    altri script quando gira su una copia). `--dry-run` di default: stampa per tenant
    cosa farebbe, coi nomi a terminale. `--applica` chiede la conferma scritta (si digita
    il codice del tenant) e lavora un tenant alla volta, a servizio fermo. Prima di
    scrivere:
    - controlla le condizioni: i quattro segni `done:` (un `parziale:` o un `errore:`
      blocca), e il segno della 2f vecchio di almeno i giorni di D9 (data nel segno);
    - fa il backup `.bak-YYYYMMDD-HHMMSS` del DB con `db.backup()`, dopo aver controllato
      lo spazio con `statfs`, e stampa nome e ora;

    poi, in una transazione, col segno `credenziali_t2_pulizia`:
    - `network_devices`: `username`, `encrypted_password`, `community_string`,
      `api_token`, `credential_id` e `snmp_credential_id` a NULL **solo per gli apparati
      la cui voce e il cui segreto hanno già un binding equivalente** (definizione della
      2e). Dopo la 2e dovrebbero essere già vuote: ogni apparato con una colonna ancora
      piena e senza binding equivalente si elenca e blocca la pulizia di quel tenant. Le
      colonne restano: toglierle vorrebbe dire ricostruire `network_devices`;
    - `network_controllers`: `username`, `password_enc` e `api_key_enc` a `''` (sono NOT
      NULL), dove `credential_id` non è NULL;
    - `ad_integrations`: `encrypted_username` ed `encrypted_password` a `''`, dove
      `credential_id` non è NULL;
    - `DROP TABLE IF EXISTS network_host_credentials;` e
      `DROP TABLE IF EXISTS host_detect_credential;`, **due istruzioni**: SQLite toglie
      una tabella per istruzione;
  - modifica `src/lib/db-tenant-schema.ts`: via le due tabelle da `TENANT_SCHEMA_SQL`
    (`:347-364`) e i loro indici (`:1476-1477`);
  - crea `scripts/credenziali/togli-chiavi-hub.ts`: `--dry-run` di default, `--applica`
    con conferma. Toglie `host_windows_credential_id` e `host_linux_credential_id` (D3) e
    le 7 `integration_unifi_*` di hub.db di A, perché il segno `done` le ha rese inutili;
  - modifica `scripts/misura-topologia.ts:119` e `scripts/misura-mac-porta.ts:173`:
    l'utente del controller viene dalla voce.
- [ ] **Prova prima del codice:**
  - con un segno `parziale:` o `errore:`, o col segno della 2f troppo recente → nessun
    effetto, motivo stampato;
  - `--dry-run` non scrive niente (mtime e conteggi uguali);
  - con `--applica` e tutte le condizioni: il `.bak` esiste prima della prima scrittura,
    colonne vuote e tabelle tolte; la seconda chiamata non ha effetti;
  - un apparato con una colonna piena e nessun binding equivalente → elencato, e il
    tenant non si pulisce;
  - le due DROP in una transazione: se la seconda fallisce, la prima torna indietro;
  - lo script dell'hub a vuoto stampa solo i nomi delle chiavi.
- [ ] Procedura R completa per il codice (T26 e T27). Poi, a parte e con la conferma di
  Riccardo per ciascuno: `pulizia-t2.ts` a vuoto e con `--applica` su hub e A, e lo
  script dell'hub.
- [ ] CONTEXT §6 (tappa 2 chiusa, trappole), CHANGELOG, ADR 0017 aggiornato.
- [ ] Fotografie sul server tolte (`rm -rf /var/tmp/credenziali-t2`) e **verificato**
  (`test ! -e /var/tmp/credenziali-t2` su hub e A).
- [ ] **Commit:** `feat(credenziali): via colonne e tabelle vecchie, archivio unico completo`.

---

## Rischi

- **Cascata nella ricostruzione.** Con le chiavi esterne attive, il DROP di
  `credentials` cancella 154 righe in H1 e 62 in A. Difese:
  - `foreign_keys` rilette dopo il PRAGMA;
  - conteggi per figlio;
  - la prova vista fallire su un DB con un figlio per colonna;
  - la prova a vuoto sulle copie.
- **Account di dominio bloccati.** Ogni tentativo WinRM sbagliato è un accesso fallito
  vero (allarmi XDR). Le scelte che li moltiplicano sono D2 (la catena dopo la
  validata), D4 (il ripiego AD), D10 (con (b) un binding fallito si riprova dopo il
  fermo) e la 2d (la validazione prova +1 voce per tenant).
  Difese: il fermo, il tetto per credenziale, e la verifica di «775»/«52e» dopo 2b, 2d e
  2f.
- **UniFi 429.** Una voce sbagliata dà login rifiutati ogni ora, dalle 7 alle 20, e poi
  la sospensione. Difese: il confronto «uguale» nella prova a vuoto, la verifica del
  primo giro orario, l'arresto immediato.
- **Segreti verso GVM.** L'anteprima edge si confronta prima e dopo la 2d, sullo stesso
  istante; le sole differenze ammesse sono quelle di D3 (sull'hub la chiave globale che
  sparisce dalle reti di H1, con l'ok di Riccardo). v3 e chiavi SSH non escono in questa
  tappa: si saltano con il motivo visibile nell'anteprima.
- **Il cron cambia credenziale in silenzio.** Lo rendono visibile la fotografia per nome
  e la conferma della 2b.
- **`dev` arriva al cliente A ogni 15 minuti**, e `main` va alle altre appliance quando
  Riccardo lo promuove. Ogni sotto-tappa regge da sola, ma le prove a vuoto sono fatte
  solo su hub e A. Si raccomanda di promuovere `main` dopo la 2g, e prima, per ogni altra
  appliance, una prova a vuoto sulla copia del suo DB fatta **su quella appliance**:
  - lì le conversioni 2c-2f girano tutte nella prima apertura dopo l'aggiornamento, senza
    backup (`update.sh` fa build e riavvio), quindi la prova a vuoto deve dare `lasciati`
    e `saltate` vuoti (segni `done:`), oppure noti e accettati da Riccardo;
  - con il codice della 2g il motore non legge più colonne, inline e catene vecchie: un
    apparato in `lasciati` lì perderebbe l'accesso. Con `lasciati` non vuoti non si
    promuove;
  - la pulizia dei dati non parte da sola (è uno script, T27): su quelle appliance i
    segreti vecchi restano nelle colonne finché qualcuno non la lancia.

  Una promozione a metà tappa porta alle altre appliance le sotto-tappe già su `dev`.
- **Gemelle che si separano.** Difese: involucri di una riga sopra funzioni pure, e una
  prova che esegue le due copie sullo stesso DB.
- **Ritorno indietro.** Dopo la 2f, una password cambiata nell'archivio non la vede il
  codice di prima, che fa il bind con quella vecchia (rischio blocco). Un ritorno oltre
  la 2f si fa solo col `.bak`, con la procedura del passo 7 (revert arrivato, servizio
  fermo, `-wal`/`-shm` spostati, `integrity_check`), e si perde quello che è stato
  scritto dopo l'ora del backup. Dopo la 2e le colonne convertite degli apparati sono
  vuote, ma il codice di prima legge comunque prima i binding. Dopo la pulizia della 2g
  non si torna a prima della 2e senza i backup.
- **Una conversione che rigira.** Le sorgenti vecchie restano piene fino alla 2g: una
  conversione che ripartisse a ogni apertura (cioè a ogni rilascio su `dev`) annullerebbe
  in silenzio le modifiche degli utenti. Difese: il segno `done:`/`parziale:` ferma la
  conversione, e la prova in `getTenantDb` «riga tolta, seconda apertura, non torna».
- **Prova a vuoto sul DB vero.** Un ambiente del servizio caricato fa puntare i moduli ai
  dati veri. Difese: lo script imposta i percorsi da `--dati` prima di caricare i moduli
  e si ferma se un percorso cade fuori, con la prova vista fallire (T1).
- **Fotografie sul server.** Contengono nomi di apparati e impronte. Difese: cartella 0700
  e file 0600, impronta HMAC con una chiave derivata da `ENCRYPTION_KEY` (non un
  oracolo per un dizionario), cancellazione verificata alla fine della 2g.
- **Bundle di una versione nuova importato in un'installazione vecchia.** Il CHECK
  vecchio rifiuta `unifi`, `ad` eccetera, e l'import intero torna indietro. Lo si scrive
  nel CHANGELOG e nella pagina di trasferimento.
- **DB grandi.** Il tenant di H1 pesa circa 2 GB: copie e backup chiedono spazio e tempo,
  e `df` si controlla prima. La ricostruzione tocca solo `credentials`, che è piccola.

## Cosa diventa difficile dopo

- **Il DB accetta qualunque tipo.** L'unico freno sono `tipi.ts`, il CRUD e la prova
  d'invariante sugli `INSERT INTO credentials`; uno script che scrive in SQL a mano la
  scavalca. Per contro, un tipo nuovo costa una riga in `tipi.ts` e il suo lettore in
  `segreti.ts`, senza migrazione.
- **L'ordine del motore diventa una decisione di prodotto** (D1). Cambiarlo cambia la
  credenziale che il cron usa su tutti gli apparati, quindi va rifatta la fotografia.
- **Le colonne `credential_id` e `snmp_credential_id`** restano in `network_devices`,
  vuote. Toglierle chiede un'altra ricostruzione della tabella più collegata.
- **Due insiemi di fonti nel motore** (D1b): l'acquisizione usa solo le fonti
  dell'apparato, discovery e prove anche host e rete. Portare l'acquisizione su tutte le
  fonti è un cambio di comportamento sugli apparati veri, da misurare con la fotografia.
- **La modifica in blocco aggiunge, non sostituisce** (interfaccia, punto 8): per
  cambiare una credenziale che funziona bisogna toglierla dall'apparato.
- **Senza le tabelle vecchie**, i bundle vecchi passano dalla conversione in memoria
  dell'import, che va tenuta finché possono esistere bundle di prima della tappa 2.
- **Una voce condivisa da più oggetti** (archivio unico) non si cancella finché è in uso
  (D8): ripulire l'archivio vuol dire prima scollegare.

## Rilievi della revisione non accolti

La revisione del 15/10 (tre revisori: dati, copertura, eseguibilità) ha dato 49 rilievi,
alcuni doppi fra un revisore e l'altro. Sono stati verificati tutti sul codice di
`origin/dev` v0.3.296, e reggono tutti nei fatti. Qui sotto ci sono solo i punti accolti in una forma diversa da quella proposta, e
il perché.

- **«Il backup del passo 3 si sposta prima della prova a vuoto»** (dati, alta: prova a
  vuoto che apre il DB vero; «passo 3» nella numerazione di prima, oggi è il passo 4). Accolto il resto del rilievo (ambiente impostato da
  `--dati` prima di caricare i moduli, guardia, prova vista fallire); non lo spostamento
  del backup. Due altri rilievi chiedono il contrario, cioè il backup subito dopo l'ok e
  subito prima del push, e hanno ragione: è il backup da cui si ripristina, e più è
  vecchio più dati si perdono. La difesa contro una prova a vuoto che tocca il DB vero è
  la guardia, che si ferma prima di aprire qualunque DB; un backup fatto prima non
  impedirebbe la scrittura, la renderebbe solo recuperabile, a prezzo di un ripristino
  da ore prima.
- **«Nel T1 la fotografia calcola anche la scelta del futuro motore, simulata sulla
  copia»** (copertura, alta). Il motore nasce nel T7, quindi nel T1 non si può
  eseguire. Al suo posto il T1 conta in SQL, tenant per tenant e livello per livello,
  gli apparati che riceverebbero un candidato dai livelli 6-11: sono i numeri che servono
  a decidere D1b. L'effetto vero del motore si misura poi nella procedura R della 2b,
  con la fotografia «prima» e «dopo» sullo stesso istante, prima della conferma e del
  push.
- **Alternative fra cui i revisori lasciavano scegliere**, e la scelta fatta:
  - *colonne degli apparati dopo la 2e* (dati, media): il T19 le svuota nella stessa
    transazione invece di far saltare al motore le fonti vecchie col segno. È più
    semplice, rende definitivo un «Nessuna» scelto dall'utente, toglie gli usi invisibili
    per D8, e non impedisce un ritorno indietro (anche il codice di prima legge prima i
    binding);
  - *pulizia della 2g* (dati, alta): script con `--dry-run` e `--applica`, non la
    variante automatica con i 14 giorni scritti nel segno, perché una pulizia automatica
    girerebbe anche sulle appliance che ricevono `main`, senza prova a vuoto e senza
    conferma;
  - *usi di controller e AD nella 2c* (dati e eseguibilità, media): `controller = []` e
    `ad` solo WinRM nel T13, e il T22 aggiunge le colonne nuove a `usi.ts`, invece di un
    `PRAGMA table_info` a ogni lettura: dopo la 2f le colonne ci sono sempre, perché
    gli ALTER girano a ogni apertura;
  - *`validated=0` in `hosts/bulk-update`* (copertura, media): tolto dal T20 invece di
    farne una domanda; la scelta manuale resta in cima all'ordine per host, come oggi e
    come vuole il perché di D1;
  - *scollegamento dell'AD al cambio di `dc_host`* (dati e copertura): portato come
    domanda (D12), con lo svuotamento delle colonne se la risposta è (a).
