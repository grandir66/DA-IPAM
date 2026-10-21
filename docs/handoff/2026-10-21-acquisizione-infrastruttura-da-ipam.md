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
