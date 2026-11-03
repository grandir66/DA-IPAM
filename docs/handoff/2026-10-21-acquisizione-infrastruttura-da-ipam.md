# Consegna all’agente DA-IPAM — acquisizione e modello dell’infrastruttura

Data: 21/10/2026. Perimetro richiesto da Riccardo: riusare i collector in sviluppo
e progettare il modello dai dati reali osservati. **Non è un’autorizzazione al live.**
Questo file è anche un prompt operativo: consegnalo integralmente all’agente.

## Obiettivo e risultato atteso

Installa i collector nel checkout di sviluppo di DA-IPAM e costruisci il flusso
**acquisizione → osservazioni → identità → relazioni → anteprima → applicazione**.
Il collector non scrive direttamente l’inventario. Non costruire un’unica tabella
che mescola apparato fisico, cluster, VM, SVM e indirizzo IP.

Prima leggi CONTEXT.md, AGENTS.md/CLAUDE.md, TASKS.md, ADR 0024/0025/0026 e
`docs/modules/acquisition.md`. Controlla il lavoro delle altre sessioni e lo stato
di origin. Mantieni controllo completo per dati, credenziali e importazioni.

Lavora in sviluppo, senza avviare lavori automatici o subagent. Non fare push/deploy
senza una nuova istruzione: **in questo progetto un push su dev arriva anche a
un’appliance cliente tramite timer**. Il nome del ramo non prova l’isolamento.

## Cosa esiste già e cosa manca

In `src/lib/acquisition/` esistono collector invocabili manualmente:

- `qnap-switch`: QSS, SSH shell/SNMP, con limiti dichiarati per IP/ARP e PVID.
- `hp-procurve`: ProCurve/ArubaOS-Switch, anche 5406R modulare; ENTITY e moduli,
  porte senza modulo osservato conservate; non ArubaOS-CX.
- `hp-comware`: Comware 7 IRF, exec separati; CPU/RAM per membro. Alcune tabelle
  SNMP sul banco restano parziali entro il limite: non dichiararle complete.
- `vmware-esxi`: API vSphere diretta dell’HostAgent. Hardware, VM, datastore,
  rete virtuale, storage e sensori. Rifiuta un VirtualCenter prima del login.
- `netapp-ontap`: REST GET ONTAP, storage/MetroCluster/IP/Ethernet/FC con stato
  di raccolta per sottosezione. Non avvia check, switchover, heal o failover.

`collectDevice(request)` sceglie un profilo dal registry statico.
`acquireForIpam(request)` restituisce `{snapshot, deviceInfo}` senza DB.
`toDeviceInfo` è un adapter di compatibilità per l’identità, **non un importatore
completo**. Sui cluster NetApp modello/seriale globali restano null: i controller
sono oggetti figli distinti. Non inventare un chassis unico per un cluster.

CLI:

```bash
node --import tsx scripts/acquire-device.ts --list
node --import tsx scripts/acquire-device.ts --schema
node --import tsx scripts/acquire-device.ts --credentials-file /percorso/privato/device.json --output /percorso/privato/nuovo-snapshot.json
```

Input e output della CLI sono fuori repo, privati 0600; output nuovo, mai
sovrascritto. Exit 0=ok, 2=parziale, 1=errore, 64=input invalido. Exit 2 non è
un fallimento di autenticazione e non autorizza a ritentare altre credenziali.

**Non esistono ancora:** aggancio persistente/UI/job di questi profili né collector
vCenter di prodotto. Il vCenter è stato letto con una prova locale per l’analisi.
Il vecchio modulo UI `vmware_vsphere` può ancora dire «non implementato»: non è
stato aggiornato da questo lavoro. Non presentare la CLI come già installata nella UI.

## Installazione del codice in sviluppo

1. Usa Node 22 LTS. Nel progetto sono già presenti `ssh2`, `net-snmp`,
   `fast-xml-parser`, Zod 4 e tsx. Non installare agenti sugli apparati.
2. Riporta **l’intera directory** `src/lib/acquisition/` e la CLI
   `scripts/acquire-device.ts`, con manuale, ADR e test. Lo schema importa anche
   `vmware-schema.ts` e `ontap-schema.ts`: copiare soltanto index.ts non basta.
3. Il codice si appoggia al trasporto SSH condiviso
   `src/lib/devices/ssh-transport.ts` (`withSshClient`) e all’apertura SNMP
   `src/lib/protocols/snmp-sessione.ts` (`apriSessioneCommunity`). Non aggiungere
   createSession fuori dal modulo centrale. Verifica queste firme nel checkout
   di destinazione; risolvi eventuali differenze con wrapper, non riscrivendo il vecchio.
4. Esamina il diff del pacchetto/cherry-pick; non sovrascrivere TASKS/CONTEXT/registry
   dell’altra sessione. Il ramo locale e origin/dev possono essere divergenti.
5. Esegui prima i test mirati indicati sotto. In sviluppo predisponi un adapter
   manuale, inizialmente spento: selezione profilo + target + riferimento credenziale
   → esecuzione backend → salvataggio snapshot → anteprima. Non fare rete dal browser.
6. Per la persistenza usa le convenzioni SQLite del progetto: migrazioni inline
   idempotenti nei file di schema esistenti, contesto tenant obbligatorio, auth
   sulle route, nessun ORM/migration framework nuovo. Proponi prima lo schema fisico
   e la resa UI: il modello descritto qui è logico, non una migrazione approvata.
7. Non applicare snapshot reali al DB live per verificare l’importazione. Usa un
   DB dev isolato e copie private dei campioni autorizzati, mai credenziali nel repo.

Il pacchetto di consegna contiene codice e documentazione pubblicabile; **non**
contiene credenziali, raw SOAP/REST, IP reali, hostname, seriali o inventari del cliente.
I dati del caso stanno esclusivamente nel dossier privato e nel vault già esistente.

## Contratto JSON e regole di significato

Snapshot 1.0 con collector/versione, target, timestamp, durata e stato globale.
Ogni sezione ha `status`, `collected_at`, `sources`, `warnings`, `data`.
Stati: ok, partial, unsupported, error, skipped. Una lista vuota ok è distinta
da una lista vuota negata, fallita, troncata o non raccolta.

Sezioni comuni: identity, interfaces, vlans, forwarding, neighbors, spanning_tree,
aggregation, poe, sensors, network. Estensioni opzionali: hardware/modules,
resources/environment, virtualization, storage. Le estensioni opzionali non
rendono invalidi i JSON delle famiglie precedenti.

- Contatori/capacità interi grandi come stringhe decimali; non passare da Number
  prima della conversione. Il REST ONTAP usa il token originale del reviver Node 22.
- null significa ignoto; zero/false sono dati validi. Down non è shutdown.
- PVID, tagging, VLAN dei port group e dominio di rete restano cose distinte.
  VMware VLAN 0=senza tag, 4095=trunk; non creare una VLAN access 4095.
- `module_observed=false` significa non osservato, non assente fisicamente.
- CPU/RAM di uno stack sono per membro, non max/media/somma implicita.
- IP guest dai Tools dichiarati potenzialmente vecchi; non trattarli come un ping.
- Root aggregati ONTAP e sito remoto non necessariamente censiti dalla stessa API.
- Una parte di inventario non acquisita non autorizza DELETE o «apparato scomparso».

## Logica del modello dati da realizzare

### 1. Fonte e snapshot

`CollectionSource`: ID interno, tipo profilo, endpoint di gestione, instance UUID
quando esiste, scope, credential_ref, capability osservate. Il segreto è risolto
nel backend e non entra in snapshot/audit/risposte al browser.

`AcquisitionSnapshot`: ID, source_id, iniziato/finito, schema/versioni, stato,
completezza per sezione e tipo, limiti e riferimenti alla fotografia privata.
Conserva lo scope: un vCenter intero e un ESXi diretto non hanno la stessa autorità.

### 2. Osservazioni, identità e alias

`Entity` ha ID interno immutabile e tipo canonico. `Observation` collega un’entità
alla fonte, snapshot, tipo esterno, ID esterno e attributi con fonte/tempo.
`IdentityAlias` è scoped: source_instance_uuid/endpoint + external_type + external_id.

Regole:

- MoRef `vm-17` e `ha-host` non sono globali. Endpoint diversi possono riusarli.
- VM instance UUID distinto da BIOS/config UUID; cloni possono condividere valori.
  Un match che ha più candidati diventa conflitto, non unione automatica.
- Host ESXi diretto/vCenter: UUID hardware uguale e univoco è prova di stessa
  macchina; i MoRef diversi restano alias. Nel caso analizzato il confronto è riuscito.
- NetApp: cluster UUID, node UUID, SVM UUID, volume UUID, LUN UUID e LIF UUID distinti.
  Un IP di LIF che cambia controller non cambia l’identità della LIF/SVM.
- Nome, IP, modello, MAC o capacità da soli non provano identità. Alias/asset manuali
  hanno precedenza esplicita: non sovrascriverli con discovery.
- Non fondere VM, host fisico, hypervisor, cluster di calcolo e cluster storage.

### 3. Entità e relazioni

Tipi minimi: management source, compute cluster, hypervisor/host fisico, VM/template,
vNIC/disco virtuale, datastore/mount/extent, switch virtuale/port group/VMkernel,
interfaccia fisica, cluster storage/controller, MetroCluster, SVM/LIF, aggregato,
volume, LUN, igroup/mapping, disco/shelf, sito e dominio di rete quando noti.

Relazioni: manages, member_of, runs_on, mounts, uses_datastore, belongs_to,
backed_by, served_by, allocated_from, mapped_to, home_on/current_on,
ha_partner, dr_partner, mirrored_to. La posizione runtime non è proprietà immutabile.

Ogni relazione porta source_snapshot_id, percorso della proprietà, metodo/prova,
observed_at, first_seen/last_seen e intervallo di validità. Distingui:

- `api_reference`: relazione esplicita nella stessa fonte.
- `correlated_unique`: join fra fonti su più identificativi verificati.
- `reference_only`: oggetto partner nominato dalla fonte ma non acquisito direttamente.
- `candidate`: collegamento non dimostrato, non pubblicato come fatto.

Per i siti fisici non usare nomi/IP come prova della collocazione. La coppia
local/remote è relativa alla fonte, non l’anagrafica globale dei siti.

### 4. Correlazioni storage realmente verificate

Ordine del join NFS:

1. Datastore.info.nas fornisce server e remotePath; NFS4.1 può avere più remote_hosts.
2. L’IP deve corrispondere a LIF di una sola SVM nello scope acquisito.
3. Nella stessa SVM deve esistere un solo volume con junction_path uguale al
   remotePath (normalizza solo slash finale, non maiuscole/minuscole arbitrariamente).
4. Conserva entrambe le prove e la regola di match. Due candidati → conflitto.

Nel campione: 8 correlazioni univoche su 25 datastore NFS/NFS4.1; 17 restano
non correlati nello scope. **Non** cercare di portare il risultato a 25 inventando
legami dal nome. Un mount di sottodirectory/qtree richiede una regola separata,
verificata sul dato, non un prefisso generico applicato in silenzio.

VMFS→LUN: servono extent, NAA/WWID e seriali/identificativi verificati. Al momento
nessun legame dedotto dalla sola dimensione o somiglianza del nome.

### 5. Capacità, disponibilità e cancellazioni

Nel caso: 38 datastore e 246 mount host. I mount sono relazioni, non 246 risorse
con capacità da sommare. Spazio datastore/volume/aggregato/disco e capacità logica,
fisica, thin, snapshot, replica e mirror sono dimensioni diverse.

Separare stato della raccolta, stato operativo del device, stato HA/DR e data
osservata. MetroCluster normal/configured non è un test di switchover.

Un oggetto non visto in una raccolta parziale resta sconosciuto. Anche una raccolta
completa prima produce un’assenza osservata/stale: rimozioni distruttive solo con
regola esplicita, anteprima e conferma. Un guasto di trasporto non è una risposta.

## Portare il prototipo vCenter a collector di prodotto

Crea **un profilo separato** `vmware-vcenter`; non allentare il guard HostAgent del
collector ESXi per caso. Il prototipo ha letto 1 datacenter, 5 cluster, 13 host,
431 VM, 38 datastore, 2 DVS e 21 DV port group, senza proprietà negate.

Riusa il SOAP/TLS/parser del modulo, evitando una copia permanente del trasporto.
Usa ContainerView ricorsiva con tipi selezionati, leggi i MoRef e poi proprietà a
blocchi di 100. DestroyView e Logout anche su errore; i view sono stato di sessione,
non configurazione dell’infrastruttura. View e token non devono restare pendenti.

Proprietà selezionate: HostSystem come il collector diretto più parent;
VirtualMachine come il diretto più parent; Datastore summary/info/host;
Datacenter name/parent/folder; ClusterComputeResource name/parent/host/resourcePool/
configurationEx; DistributedVirtualSwitch name/uuid/summary/config.host/
config.uplinkPortgroup; DistributedVirtualPortgroup name/key/config.distributedVirtualSwitch/
config.defaultPortConfig/config.type/config.numPorts.

Trappole verificate:

- Proprietà derivate: `configurationEx.drsConfig` e
  `config.defaultPortConfig.vlan` sono state rifiutate come InvalidProperty.
  Leggi il rispettivo oggetto di configurazione e seleziona i campi nel parser.
- `type` del MoRef e `xsi:type` sono attributi diversi. Non eliminare i namespace
  degli attributi facendo collidere i due nomi.
- Risposte grandi: il limite del parser contava oltre 1000 sostituzioni di entità
  XML. Ora DTD/ENTITY sono rifiutati, l’espansione automatica è spenta e soltanto
  entità standard/numeriche sono decodificate una volta, con test dedicato.
- Salva le sezioni riuscite e segnala quelle fallite; il prototipo locale ha usato
  checkpoint per non rileggere tutto dopo un campo invalido. Il collector di
  prodotto deve avere risultati parziali strutturati, non un dump ad hoc.
- vCenter e host diretto sono osservazioni complementari; non sommarne VM/host
  prima di risolvere identità e scope. La raccolta non è atomicamente simultanea.

## Prove e criterio di consegna

```bash
node --import tsx --test src/lib/acquisition/__tests__/*.test.ts src/lib/protocols/__tests__/snmp-sessione.test.ts
npm run lint
npx tsc --noEmit
# Usa DA_INVENT_DATA_DIR su una cartella privata temporanea per la build/prove.
npm run build
```

Per la nuova integrazione prova anche: autenticazione/contesto tenant, nessuna
query di scrittura durante anteprima, retry credenziali assenti, match ambiguo,
IP spostato, VM migrata, datastore montato su molti host, partial/403/404/timeout,
nuovo certificato, paginazione esterna rifiutata, crash con logout/cleanup,
byte >2^53, zero/false, VLAN 4095 e sorgente con ID esterni uguali a un’altra.

Accettazione in dev: collector caricabili, JSON validato, snapshot consultabile,
nessun segreto nel repo/audit/risposta, anteprima ripetibile senza mutazioni,
correlazioni spiegabili e conteggi coerenti con lo scope. Non dichiarare «integrato»
finché non si vede il risultato nell’interfaccia dev con dati autorizzati.

Consegna finale: file cambiati, commit/pacchetto installato, prove con exit code,
limiti ancora aperti, cosa è acceso/spento. Non eseguire push/deploy live o timer
per concludere questa consegna.

## Aggiornamento collector multivendor — 2026-10-22

Sono aggiunti i profili `unifi-controller`, `synology-dsm`, `qnap-nas`, `mikrotik-routeros`, `ubiquiti-device`, `proxmox-ve` alla CLI comune. Vedere `docs/modules/acquisition.md` per input, copertura reale e limiti: questi ultimi cinque sono una prima acquisizione parziale, non copertura completa del prodotto. I file nuovi sono `device-profiles.ts`, `inventory-parsers.ts`, `inventory-collector.ts` e relativi test; aggiornati schema, registry, allowlist/trasporto e classificazione comando SSH unsupported.

L'adapter deve trattare `inventory.tables` come osservazioni con stato e fonte; mai trasformare una tabella fallita in cancellazione. Le tabelle cluster Proxmox non appartengono tutte al solo chassis di target: `scope=proxmox-cluster-visible`, ogni risorsa mantiene node/id/type. Le porte virtuali Linux non sono cavi; le righe VLAN RouterOS hanno il bridge come contesto. `*_vendor_units` non sono byte. Il profilo dichiarato dal chiamante non dimostra da solo il produttore. Il controller UniFi resta distinto dai device diretti: correlare MAC e seriale, mantenendo fonte e sito. Token/password/chiavi restano nel vault; local_ssh è solo per CLI e ambienti con OpenSSH configurato.

Letture SSH Ubiquiti non ancora validate per rifiuto autenticazione; usare SNMP/API disponibili e chiedere conferma dell'accesso device senza tentativi ripetuti. Synology irraggiungibile resta non collaudato. Persistenza, interfaccia, radio avanzate e completa copertura per famiglia restano passi successivi: niente importazione automatica dai nuovi campioni.

## Integrazione Infoblox in DA-IPAM — contesto aggiornato 03/11/2026

Questa sezione aggiorna la consegna storica sopra per **Infoblox**. Riccardo ha
chiesto di scrivere il contesto per l'integrazione: **non è un incarico a eseguire
ora importazioni, migrazioni o pubblicazioni**. Il collector è implementato e
collaudato; manca il flusso di prodotto che utilizzi i dati DDI. Le parti della
fotografia del 21/10 che dicono genericamente «nessun aggancio UI» non descrivono
lo stato attuale di tutti gli altri collector: per quello leggere CONTEXT e codice
correnti, senza rimettere mano a flussi già decisi.

### Fonte del codice, ramo e verifiche

Sul **Mac**, il lavoro Infoblox è nel worktree:
`/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox`, ramo locale
`codex/infoblox`, ultima release locale **0.9.954**. Non è pubblicato su origin/dev.
Non tentare di recuperare quel ramo da origin come se fosse già remoto.

Commit utili: `ed181f9d` implementazione e release locale 0.9.953;
`f264d704` aggiornamento del collaudo e release locale 0.9.954;
`235db5aa` e `8e83dfa6` consuntivi; la documentazione di consegna viene aggiornata
successivamente. Per verificare il commit corrente usare git nel worktree.

File da integrare, confrontandoli con origin/dev aggiornato:

- `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/src/lib/acquisition/infoblox.ts`: collector e costruzione dello snapshot.
- `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/src/lib/acquisition/infoblox-transport.ts`: GET HTTPS, schema WAPI, versioni, paginazione e limiti.
- `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/src/lib/acquisition/infoblox-schema.ts`: contratto DDI, allowlist e parser.
- `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/src/lib/acquisition/__tests__/infoblox.test.ts`: prove specifiche.
- Modifiche comuni nello stesso worktree: `src/lib/acquisition/{catalogo,index,schema}.ts` e `src/lib/acquisition/__tests__/contratto-fixture.ts`.
- Manuale e piano: `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/docs/modules/acquisition.md` e `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox/docs/superpowers/plans/2026-11-03-infoblox.md`.

Riportare codice, test e integrazioni del registro, **non** sovrascrivere interi
file comuni con la loro versione del worktree e **non** riportare indietro
VERSION/package.json/lock alla release locale. Il versionamento finale segue la
versione di origin/dev al momento dell'integrazione. Non includere nel trasferimento
i campioni reali o le credenziali. Un agente cloud non vede automaticamente questi
file locali: prima occorre rendere disponibili i soli sorgenti revisionati.

Verifiche del 03/11: Node 22, lint senza errori (72 avvisi storici), **6.335 prove
passate**, zero fallite, 2 saltate e 1 TODO; build e tsc exit 0. Dopo l'aggiornamento
della sola nota di collaudo: lint/tsc/build nuovamente exit 0. Prima di pubblicare
un'integrazione su una base più recente, eseguire il cancello su quella base.

### Cosa è stato letto realmente

Apparato **Infoblox vNIOS**, WAPI massima esposta **2.12.3**. La versione WAPI **non
è** il firmware NIOS. Primo giro interrotto da timeout; Riccardo ha confermato la
raggiungibilità e chiesto di riprovare. Il giro successivo ha completato in **37 s**
23 tabelle e **6.853 record**, senza errori di accesso o limiti di paging:

- IPAM: una network view, **18 reti IPv4**; reti/contenitori IPv6 e contenitori IPv4 vuoti.
- DHCP: **28 range**, **633 prenotazioni**, **3.953 lease**; corrispondenti tabelle IPv6 vuote.
- DNS: una vista, **66 zone autoritative**, **11 zone forward**, **380 record host**, **505 A**, **4 CNAME**, **755 PTR**, **1 MX**, **495 TXT**; AAAA e SRV vuoti.
- Grid e membri: un oggetto grid e un membro osservati. Sono contesti/oggetti distinti dal singolo indirizzo di gestione interrogato.

Sono conteggi di **record sorgente alla data del collaudo**, non un numero di
host unici. Record host, A, PTR e lease possono descrivere la stessa risorsa e
non vanno sommati per creare nuovi apparati.

Sul **Mac**, campione completo autorizzato (privato, fuori repo):
`/Users/riccardo/Progetti-Clienti/Acquisizioni-DA-IPAM/2026-11-03-infoblox/snapshot-completo.json`.
Nella stessa cartella ci sono `discovery.json` (schemi/primi campioni),
`preflight.json` (schema e fingerprint TLS) e il primo `snapshot.json` parziale:
**per il collaudo completo usare snapshot-completo.json**. Non copiare dati reali
nel repo, in fixture pubbliche o in servizi/modelli esterni.

Credenziale di collaudo: riferimento alla voce `infoblox-manager.md` dell'archivio
locale, usata tramite `/Users/riccardo/.claude/bin/vault-a-stdin` con
`VAULT_FONTE=file`. Il contenuto è un input JSON codificato base64: **base64 non è
cifratura**; il valore resta un segreto e va solo allo stdin del processo autorizzato.
Non mostrarlo, non inserirlo in argv/log e non usarlo dal browser. L'integrazione
di prodotto deve seguire la fonte credenziali corrente dichiarata in AGENTS
(DA-Link → Vault / API autorizzata): non hardcodare questo riferimento locale nel
codice distribuito. Target, utente e pin restano nei riferimenti privati; non
ricercare credenziali ulteriori di propria iniziativa.

### Contratto già pronto e limiti effettivi

Profilo `infoblox-nios`, famiglia `ddi`, credenziale `api`, registro statico
`collectDevice`. Lo schema snapshot **1.0** contiene una sezione opzionale `ddi`:

- `ddi.data.scope = grid-visible-to-account`: dati visibili all'account, non attestazione di inventario globale del grid.
- `ddi.data.wapi_version`: versione API rilevata.
- `ddi.data.tables[]`: `object`, `status`, `sources`, `warnings`, `fields_requested`, `records`.
- I record conservano `_ref`, `network_view`/`view` e i campi esplicitamente ammessi. `fields_requested` indica campi leggibili richiesti, non garantisce che ogni record abbia ogni campo.

Gli oggetti sono grid/member, viste/reti/contenitori IPv4/IPv6, range,
fixedaddress, lease, viste/zone DNS e record host/A/AAAA/CNAME/PTR/MX/TXT/SRV.
Si usano soltanto GET di endpoint statici; niente chiamate funzione WAPI o
configurazioni complete. CA attendibile oppure pin SHA256 verificato **prima**
di inviare Basic auth; nessun redirect con credenziali. La versione è scelta
numericamente dallo schema (2.12 > 2.9), campi e oggetti sono verificati sul server.

Paging: 250 record per pagina, massimo 1.000 pagine, limite righe per tabella,
budget byte complessivo e deadline. Nel collaudo: 20.000 righe per tabella,
4 MiB totali, 15 s per richiesta e 300 s totali. I lease sono in coda per non
anteporre la lettura più pesante a reti/DNS. 401 ferma il lotto; 403 non diventa
lista vuota; paging incompleto conserva i record già letti come `partial`.

Lo stato globale dell'ultimo snapshot resta `partial` **senza letture interrotte**:
firmware/seriale NIOS non raccolti e `options` non esposto per `ipv6range`.
Valutare gli stati delle **singole tabelle**, non scartare tutto per il solo stato
globale. Le tabelle vuote correttamente lette sono `ok`; `error`, `skipped` e
`unsupported` non provano assenza di oggetti. Opzioni DHCP e TTL sono i valori
restituiti, senza risoluzione completa dell'eredità. Non presenti gestione
failover, DNSSEC/TSIG, RPZ, ogni tipo di record DNS o prefix delegation DHCPv6.

### Dove si aggancia e cosa non basta fare

Il collector non è un importatore. `src/lib/acquisition/adapter.ts` traduce solo
l'identità in DeviceInfo. Le proiezioni attuali in
`src/lib/acquisition/proiezioni/index.ts` e l'applicazione in
`src/lib/acquisizione-modulare/applica.ts` non contengono un mapping DDI:
aggiungere il profilo al riconoscimento o premere «Aggiorna» non basta a popolare
reti, DHCP e DNS. Non riversare gli indirizzi del grid nelle interfacce/IP del
singolo Infoblox e non creare porte switch per la famiglia `ddi`.

Riusare, dopo averne verificato le firme sul ramo corrente, il flusso già presente:
`acquisizione-modulare/{richiesta,esegui,archivio,fonte,scheda,applica}.ts` e
`acquisition/proiezioni/`. Conservare lo snapshot con fonte/versione/stati; costruire
proiezioni pure DDI e una anteprima delle differenze prima di applicarle in
transazione. Non cambiare per simmetria la regola di «Aggiorna» già decisa per i
collector esistenti. Il flusso DDI che modifica inventario, reti o relazioni va
proposto esplicitamente; fino ad allora niente applicazione implicita.

### Vincoli del modello da risolvere prima di scrivere dati

Verificati nel checkout DA-IPAM locale il 03/11, da ricontrollare su origin/dev
prima della migrazione; questa è un'indicazione del problema, non uno schema già approvato.

1. **Reti:** `networks.cidr` è `UNIQUE`. Due network view Infoblox possono contenere
   lo stesso CIDR. Non fondere le viste o lasciar scegliere al vincolo quale rete
   tenere: mantenere inizialmente osservazioni separate, poi definire una mappatura
   esplicita della vista o introdurre la dimensione di vista nel modello approvato.
2. **Lease:** `dhcp_leases` richiede MAC non nullo, ha unicità
   `(source_device_id, ip_address)` e `source_type` limitato a
   `mikrotik|windows|cisco|other`. Non scrivere `infoblox` violando il CHECK, non
   usare `other` come ripiego muto, non inventare un MAC per dati che hanno solo
   un DUID. Decidere esplicitamente la provenienza e preservare la vista nel modello.
3. **DNS:** definire la destinazione canonica e i suoi writer prima del mapping;
   non è stato ancora progettato uno storage DDI nel collector. I campi riassuntivi
   DNS di un host non sostituiscono l'inventario di zone/viste/record multipli.
4. **Identità:** chiave di osservazione almeno fonte Infoblox + tipo oggetto +
   riferimento WAPI, conservando vista e riferimento originali. Non correlare
   automaticamente tra viste per il solo IP, nome o MAC. Non trattare `_ref` come
   garanzia di UUID eterno senza verificare cosa accade nelle rinomine.
5. **Semantica:** range ≠ rete; fixedaddress ≠ lease attivo; record host può avere
   più IP/alias e configurazione DHCP per indirizzo. Preservare stati dei lease,
   `never_starts`/`never_ends` e tempi originali; non inventare `last_seen` dalla
   scadenza del lease. Normalizzare date UTC al confine e rispettare i confronti SQLite.

Regole di arricchimento: il manuale vince, niente sovrascritture mute;
`null`/campo assente non cancella un valore noto. Da una tabella parziale si
aggiunge/aggiorna solo ciò che è osservato; **mai bonifiche per assenza**. Anche una
tabella `ok` è limitata all'account: la scomparsa di un record non autorizza
immediatamente un DELETE. Persistenza/audit devono conservare fonte e istante.

### Sequenza raccomandata per l'integrazione, quando incaricata

1. Ripartire da origin/dev aggiornato e isolato, integrare collector/test/contratto;
   non abbassare la versione dell'app. Mantenere inizialmente inattivi i giri automatici.
2. Preparare il mapping per viste, reti, range, prenotazioni, lease e DNS; proporre
   schema e interfaccia oggetto per oggetto. **Controllo Completo** per migrazioni,
   credenziali e applicazione dei dati; nessun nuovo agente o orchestrazione implicita.
3. Conservare snapshot e osservazioni nel flusso esistente; implementare proiezioni
   pure e anteprima in sola lettura su DB dev isolato. Non applicare i 6.853 record al
   DB live per vedere cosa succede.
4. Prove nella forma vera con fixture anonime: IP/CIDR duplicati tra viste,
   DNS multipli sullo stesso nome/IP, host con più indirizzi, lease senza MAC,
   scadenze/never_*, pagina troncata, 401/403, pin errato, ripetizione idempotente e
   conflitto con dati manuali. Verificare persistenza/provenienza e assenza di segreti.
5. Applicazione esplicita secondo il flusso approvato, in transazione e con audit;
   nessuna cancellazione automatica da letture incomplete. Verifica UI resa a
   larghezza d'uso e ingresso reale senza scritture; cancello del progetto Node 22.
6. Release/push/deploy seguono autorizzazione e regole correnti: non dedurli da
   questo documento. Prima di interventi live lo snapshot della VM richiesto da
   AGENTS; per `main` e sistemi dei clienti restano le conferme previste.

**Accettazione:** ogni valore importato è riconducibile al record Infoblox e alla
vista; la stessa acquisizione ripetuta non crea duplicati; nessuna collisione tra
viste o cancellazione da dati parziali; conflitti manuali visibili; i numeri delle
osservazioni corrispondono alle tabelle dello snapshot, senza scambiarli per host unici.
