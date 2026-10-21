# Collector modulari e recupero da DADude3 / DA-MKNET — piano

**Versione 2, 21/10 sera** (la v1 del mattino è in git, `bcce0b69` + `65568a82`).
**Stato:** proposta parcheggiata da Riccardo («per ora teniamo solo il piano»): niente codice prima dell'ok.
**Checklist:** `TASKS.md`, sezione «2026-10-21 — recupero da DADude3 e DA-MKNET». Bacheca:
`lavori recupero-dadude3-mknet`.

**Fonti.** Analisi del 20/10 (canvas `progetti-fermi-DADude3-DA-MKNET-MKHA`, 50 schede M1-M5, D1-D4,
E01-E41) · consegna dei collector `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`, pacchetto
`~/Documents/DA-IPAM-collector-e-modello-20261021.tar.gz` (identico al codice nel `dev` locale), canvas
`da-ipam-modello-infrastruttura` · ADR 0016-0018, 0021, **0024-0026** · manuale `docs/modules/acquisition.md`
· donatori `~/Progetti/DADude3` (`569b416`) e `~/Progetti/DA-MKNET` (`812b1ad`), invariati dal 20/10.

## 0. Cosa chiede Riccardo e cosa cambia

Richiesta (21/10 sera): **scanner modulari per famiglia di oggetti**, da aggiungere nel tempo, che con le
credenziali giuste producano **un JSON da parsare** e arricchiscano l'inventario **in modo coerente**,
senza stravolgere DA-IPAM. Il sistema dei collector già consegnato è la prima fonte di questo tipo; le
famiglie nuove arriveranno nello stesso formato man mano che si incontrano apparati da supportare.

Conseguenza sul piano del mattino: **il veicolo cambia**. La conoscenza dei donatori non va più dentro
`hp-vendor.ts`, `device-info.ts` e `nas-acquisition.ts`, ma in **collector nuovi** con lo stesso contratto
JSON 1.0. I collector `hp-procurve` e `hp-comware` coprono già quasi tutto ciò che M1-M3 volevano portare da
DA-MKNET. Il lavoro grosso che manca è l'**aggancio**: credenziali dall'archivio, snapshot salvati,
anteprima dell'arricchimento, applicazione esplicita.

## 1. Confini (validi per ogni task)

- DA-IPAM resta com'è nel cuore: identità degli apparati, archivio credenziali (ADR 0017), anti-lockout,
  scheduler, discovery, classificazione, persistenza SQLite con migrazioni inline. **I collector non li
  sostituiscono**: producono osservazioni; un livello separato le confronta e le applica (ADR 0024).
- Il core dei collector non importa DB, NextAuth, cron o route. Registry statico, niente codice caricato a
  runtime, niente comandi liberi dall'input: ogni profilo ha la sua allowlist.
- Ogni sezione dello snapshot ha `status` (`ok` | `partial` | `unsupported` | `error` | `skipped`), fonti,
  avvisi e ora. `null` = ignoto; zero e false sono dati. **Partial non cancella mai**; neanche un `ok`
  cancella da solo: un'assenza diventa «non vista», la rimozione è una regola esplicita con anteprima.
- Nessun segreto in snapshot, audit, log o risposte al browser; le credenziali si risolvono nel backend.
- Nessuna scrittura sugli apparati, nessun lookup esterno con dati dei clienti, nessun automatismo acceso
  per impostazione predefinita, nessuna regola di dominio cambiata senza prova e decisione.
- Il repo è pubblico: fixture solo anonimizzate. Schermate: tavola grafica prima di scriverle.
- **Niente push di `dev` finché non si decide D1** (§7): vedi §2.1.

## 2. Stato verificato il 21/10

### 2.1 I collector consegnati

- Cinque profili in `src/lib/acquisition/`: `qnap-switch`, `hp-procurve` (collaudato su Aruba 2540 e
  5406R zl2), `hp-comware` (FlexFabric 5700 IRF a quattro membri; alcune tabelle SNMP restano parziali),
  `vmware-esxi` (API diretta dell'host), `netapp-ontap` (REST GET). CLI `scripts/acquire-device.ts`.
- **79 prove verdi oggi** (`node --import tsx --test src/lib/acquisition/__tests__/*.test.ts`, exit 0).
- Nessun aggancio all'app: l'unico chiamante è la CLI. Niente route, tabelle, job o schermate.
- **Git:** i commit dei collector stanno solo nel `dev` locale. Il `dev` locale ha 41 commit che
  `origin/dev` non ha, e `origin/dev` ne ha 14 che il locale non ha (tra cui la «scheda MikroTik» della
  sessione nel worktree `da-ipam-mk`). La consegna chiede di non pubblicare: un push su `dev` arriva
  all'appliance del cliente A col timer. Il piano v1 è già su origin (commit del mattino).

### 2.2 Oggi convivono tre meccanismi di acquisizione

1. I client storici: `devices/switch-client.ts`, `router-client.ts`, `device-info.ts`,
   `nas-acquisition.ts`, `hp-vendor.ts`. È quello che gira davvero nei giri pianificati.
2. `devices/acquisition/registry.ts`: un registry di handler più vecchio, con la stessa ambizione di
   modularità. Va censito: chi lo usa e se si ritira o si tiene come facciata.
3. `src/lib/acquisition/`: i collector JSON 1.0.

Il piano non ne aggiunge un quarto: **i collector sono il meccanismo nuovo**; i client storici restano finché
il collector di una famiglia non ha dimostrato la parità (C5).

### 2.3 Cosa serve al framework per «aggiungere famiglie nel tempo»

Letto il codice di `index.ts`, `schema.ts`, `adapter.ts`, `transports.ts`:

- L'elenco dei collector è ripetuto in **tre punti** (enum dell'input, enum dello snapshot, `COLLECTORS`):
  una famiglia nuova li tocca tutti. Serve un elenco solo da cui derivare gli altri due.
- `collector_version` è il letterale `"1.0.0"` per tutti: una famiglia non può cambiare versione senza
  toccare lo schema. Serve la versione per collector.
- Le sezioni da switch (`interfaces`, `vlans`, `forwarding`, `neighbors`, `spanning_tree`, `aggregation`,
  `poe`, `sensors`, `network`) sono **obbligatorie per tutti**: un NAS o un server Windows deve dichiararle
  `unsupported`/`skipped`. Va bene, ma mancano le estensioni per i sistemi: sistema operativo, storage
  dell'host, software, servizi, sicurezza. Si aggiungono come sezioni **opzionali** (come `storage` e
  `virtualization`), senza invalidare gli snapshot già prodotti.
- Trasporti: SSH (console ed exec), SNMP **solo v1/v2c a community**, HTTPS per vSphere e ONTAP. Mancano
  **SNMPv3** (che l'archivio credenziali gestisce già, ADR 0016) e **WinRM** (che l'app ha in `winrm-run`).
- Credenziali: l'input porta i segreti in chiaro. Per la CLI è voluto; nell'app la richiesta va costruita
  nel backend da `credentials/resolve.ts`, col budget anti-lockout. Exit 2 (parziale) non autorizza a
  provare altre credenziali.
- Ogni collector deve dichiarare un **descrittore**: famiglie e prodotti riconosciuti, credenziali e
  protocolli richiesti, sezioni prodotte, allowlist dei comandi, modelli e firmware collaudati.

### 2.4 Scoperte del mattino (restano valide)

1. Due elenchi di MAC virtuali diversi (`devices/physical-device-db.ts:21` conosce HSRPv2 e HSRP IPv6,
   `topology/identity.ts:9` no). `identity.ts` lo sta modificando ora la sessione delle tappe 3-5.
2. Firmware QNAP: nel percorso storico `getDeviceInfo` stende l'SSH sopra l'SNMP, e l'`uname` cancella il
   firmware letto via SNMP.
3. Gli HP letti via SSH dal percorso storico non scrivono vicini; il loro LLDP finisce solo in
   `switch_ports.trunk_neighbor_*`.
4. ProCurve nel percorso storico scrive in `speed` il tipo di porta, non la velocità negoziata.
5. `upsertSwitchPorts` riscrive la riga intera: un campo non letto diventerebbe null.
6. La GET `/api/devices/[id]/mikrotik?action=config|all` (export completo) non controlla il ruolo.

## 3. Il sistema proposto: dal JSON all'inventario

```text
fonte (apparato + profilo + credential_ref)
  → collector (JSON 1.0 validato, nessun DB)
  → archivio degli snapshot (immutabili, senza segreti)
  → proiezioni per sezione (pure: snapshot → osservazioni)
  → anteprima (cosa cambierebbe, conflitti; nessuna scrittura)
  → applicazione esplicita (admin, transazione, traccia della fonte)
```

Regole dell'**arricchimento coerente**:

- Un valore entra solo da una sezione `ok` o `partial` e solo se non è `null`; non sostituisce mai un
  valore scritto a mano né un'unione/separazione manuale.
- Precedenza per campo dichiarata in una tabella sola (fonte, data, completezza), non sparsa nel codice.
- Una lista (porte, VLAN, vicini) si sostituisce solo da una sezione `ok`; da `partial` si aggiunge o si
  aggiorna, mai si toglie.
- Ogni riga scritta porta fonte (`collector:<profilo>@<versione>`), snapshot e ora.

Dove va ciascuna sezione (da confermare nello schema fisico, D4):

| Sezione dello snapshot | Destinazione in DA-IPAM | Nota |
| --- | --- | --- |
| `identity` | `network_devices` (modello, firmware, seriale, part number) | come `toDeviceInfo`, senza sovrascrivere il manuale |
| `interfaces`, `vlans` (PVID), `poe` | `switch_ports` | richiede la scrittura per campo (scoperta 5) |
| `vlans` tagged/untagged complete | restano nello snapshot | in tabella solo se una schermata le usa |
| `neighbors` | `device_neighbors` con fonte nuova `collector` | letta solo dal modello per cavo, come `ssh`: T1 resta bit per bit |
| `spanning_tree`, `aggregation` | `topology_port_facts` (solo istanza 0/CIST) | fonte nuova nell'elenco chiuso `FonteFatti` |
| `forwarding`, `network.arp` | nessuna in prima tappa | i giri esistenti scrivono già MAC per porta e ARP: niente doppi scrittori |
| `hardware`, `modules`, `resources`, `environment`, `sensors` | scheda dell'apparato, letta dallo snapshot | niente colonne finché nessuna query le chiede |
| `virtualization`, `storage` (ESXi, ONTAP) | modello entità/alias/relazioni (C4) | mai una tabella unica che mescola host, VM, SVM e IP |

## 4. Le 50 schede alla luce dei collector

Veicolo: **col** = collector JSON (esistente o nuovo) · **app** = codice dell'app fuori dai collector ·
**—** = nessun porting.

| ID | Tema | Esito 21/10 sera | Veicolo | Blocco |
| --- | --- | --- | --- | --- |
| M1 | LLDP HP | **Coperto** da `hp-procurve`/`hp-comware` (chassis non MAC, capacità, indirizzi, più vicini per porta). Resta l'aggancio | col esistente | C2 |
| M2 | Porte HP: VLAN, duplex, PoE | **Coperto** (PVID esplicito, tagged/untagged, PoE come PD draw, velocità in bit/s). Resta l'aggancio | col esistente | C2 |
| M3 | STP per porta e LAG HP | **Coperto** per il CIST e i LAG; le istanze MST non sono lette (dichiarato). Resta l'aggancio ai fatti T3 | col esistente | C2 |
| M4 | Storico configurazioni | Da fare; profili `*-config` separati: i collector HP escludono di proposito la running-config | col nuovo + app | C6 |
| M5 | Vicini da completare | Da fare, dopo le tappe 3-5; si nutre anche dei vicini dei collector | app | C2 dopo |
| D1 | Firmware QNAP | Correzione nel percorso storico (gira oggi) **e** lettura giusta nel collector `qnap-nas` | app + col nuovo | S, C3 |
| D2 | ZFS QuTS hero | Fuori (niente in uso) | — | — |
| D3 | Share e pacchetti NAS | Nei collector `qnap-nas` e `synology-nas` | col nuovo | C3 |
| D4 | Configurazioni host Proxmox | Condizionato, dopo C6 | col nuovo | dopo C6 |
| E01 | Aruba 6100 / AOS-CX | Collector `aruba-cx` se la sede nuova ha AOS-CX | col nuovo | C3 |
| E02 | VLAN chassis modulari HP | **Coperto** (`show vlans ports all detail`, 5406R modulare) | col esistente | — |
| E03 | MikroTik velocità/duplex | Nel collector `mikrotik-routeros`, coordinato con la scheda MikroTik | col nuovo | C3 |
| E04 | MikroTik PoE | Idem; mapping delle unità riscritto | col nuovo | C3 |
| E05 | MikroTik VLAN bridge | Idem; parser riscritto per `vlan-ids` | col nuovo | C3 |
| E06 | MAC virtuali | Un elenco solo, nell'app (serve anche alle proiezioni) | app | S |
| E07 | Hyper-V | Collector `windows` (trasporto WinRM), sezione `virtualization` | col nuovo | C3 |
| E08 | Defender, profili firewall | Collector `windows`, sezione opzionale di sicurezza | col nuovo | C3 |
| E09 | Ruoli server | Collector `windows` (WinRM); il ripiego DCOM solo se serve | col nuovo | C3 |
| E10, E13, E38 | SCCM, Docker, questionario | Fuori (niente in uso) | — | — |
| E11 | Software Windows | Già coperto: il collector `windows` riusa l'approccio del registro, mai `Win32_Product` | — | — |
| E12 | Storage Linux | Collector `linux`, sezione storage dell'host | col nuovo | C3 |
| E14 | Fuso, NTP, SELinux | Collector `linux` | col nuovo | C3 |
| E15, E19, E20, E33, E34, E37 | Fixture e regole puntuali | E34 ed E37 diventano il contratto del framework (C0) | — | C0 |
| E16-E18, E21-E24, E28 | Già coperti | Invariato | — | — |
| E25, E29 | Coda persistente, webhook | Condizionati senza task | — | — |
| E31, E36 | Import storico, The Dude | **Esclusi** (niente in uso) | — | — |
| E32 | Procedura di modifica | Fuori iniziativa (scrive sugli apparati) | — | — |
| E26, E27, E30, E35, E39, E40, E41 | | Esclusi | — | — |

Il prompt di consegna aggiunge un collector che non viene dai donatori: **`vmware-vcenter`** (C3).

## 5. Blocchi

| Blocco | Contenuto | Livello | Dipende da | Stima |
| --- | --- | --- | --- | --- |
| S | Piccoli e indipendenti: export MikroTik solo admin, firmware QNAP nel percorso storico, MAC virtuali | Completo (export, MAC), leggero (QNAP) | MAC: commit della sessione tappe 3-5 | ~5 h |
| C0 | Framework pronto a crescere | Leggero, schema come contratto pubblico | D1 | ~6 h |
| C1 | Aggancio manuale in sviluppo: fonte, credenziali, snapshot salvati, consultazione | **Completo** | C0 | ~10 h |
| C2 | Proiezioni, anteprima, applicazione | **Completo** | C1 | ~12 h |
| C3 | Collector nuovi, uno alla volta | Leggero per collector | C0; collaudo su apparato | ~5 h l'uno, 7 previsti |
| C4 | Modello infrastrutturale (ESXi, vCenter, ONTAP) | **Completo** | C2 | ~12 h |
| C5 | Sostituzione dei percorsi storici, famiglia per famiglia | **Completo** | C2 e un collector collaudato | ~3 h a famiglia |
| C6 | Storico configurazioni | **Completo** | C1 | ~10 h |

Totale realistico con revisioni: **circa 90-110 ore di lavoro agente**, di cui ~35 per i sette collector
nuovi. Il primo risultato visibile (un HP della sede nuova acquisito dal collector e mostrato nella scheda,
senza applicare nulla) arriva dopo S, C0 e C1: ~20 ore.

### S — Piccoli e indipendenti

- **S1 Export MikroTik solo admin** (scoperta 6). `app/api/devices/[id]/mikrotik/route.ts`: `requireAdmin`
  per `config` e `all`; guardie censite in `permessi/rotte.ts`. Prove: non admin 403, admin 200,
  `scripts/verifica-permessi.sh` verde, scheda apparato resa con utente non admin.
- **S2 Firmware QNAP nel percorso storico** (D1, scoperta 2). Da `qnap.py:193` `_get_qts_version`:
  `getsysinfo firmver`, `/etc/version`, build; parser puro `devices/nas/qnap-versione.ts`; `firmware` mai
  dall'`uname`; un firmware SSH nullo non cancella quello SNMP. Prova vista rossa sul codice di oggi.
- **S3 MAC virtuali, un elenco solo** (E06, scoperta 1). `devices/mac-virtuali.ts` puro (VRRP v4/v6, HSRP
  v1/v2/IPv6, GLBP; normalizzazione colon/trattini/punti; multicast in una funzione a parte), usato da
  `identity.ts` e `physical-device-db.ts`. Misura con `misura-unioni` su copia del DB dell'hub prima e dopo.

### C0 — Framework pronto a crescere

1. **Elenco unico dei collector** in `acquisition/catalogo.ts`: id, versione, descrittore; enum dell'input,
   enum dello snapshot e `COLLECTORS` derivati da lì. Prova: un collector registrato senza descrittore o
   senza fixture fa fallire la suite.
2. **Versione per collector** nello snapshot (`collector_version` dal catalogo); `schema_version` resta
   `1.0` finché le aggiunte sono opzionali. Prova: gli snapshot 1.0 già prodotti (fixture QNAP, ProCurve,
   Comware, ESXi, ONTAP) restano validi.
3. **Sezioni opzionali per i sistemi**: `system` (sistema operativo, versione, kernel, fuso, NTP, stato
   SELinux/AppArmor), `host_storage` (dischi, PV/VG/LV, filesystem con byte e inode, mount), `software`,
   `services`, `security` (antivirus/Defender, profili firewall per nome). Ogni campo con unità; capacità
   come stringhe decimali dove serve.
4. **Trasporti mancanti** come adattatori sui moduli dell'app, non copie: SNMPv3 via
   `protocols/snmp-sessione.ts`; WinRM via `devices/winrm-run.ts`, con script in allowlist.
5. **Prova di contratto comune** (`__tests__/contratto.test.ts`): per ogni collector, fixture → snapshot
   valido; uscita di formato ignoto → `partial`, mai `ok` con righe perse; trasporto assente → `skipped`;
   nessun segreto nello snapshot.
6. **Guida «aggiungere una famiglia»** nel manuale: file da creare, descrittore, fixture anonimizzate,
   prove minime, cosa dichiarare (modelli e firmware collaudati). È il percorso per le famiglie future.
7. Censimento di `devices/acquisition/registry.ts`: chi lo usa, e proposta (tenerlo come facciata o
   ritirarlo). Nessun cambio senza decisione.

### C1 — Aggancio manuale in sviluppo

1. **Fonte di raccolta**: per un apparato, il profilo scelto (dal descrittore e dal prodotto riconosciuto)
   più il riferimento alla credenziale dell'archivio. Nessuna credenziale nuova, nessuna ricerca a tappeto.
2. **Costruzione della richiesta nel backend** da `credentials/resolve.ts`, col budget di
   `scanner/credential-anti-lockout.ts`; esito registrato come per gli altri giri; exit 2 non fa provare
   altre credenziali.
3. **Archivio degli snapshot**: tabella additiva nel DB del tenant (`acquisition_snapshots`: id,
   device_id, profilo, versione, iniziato/finito, stato, stati per sezione, hash, dimensione) e JSON
   compresso; retention secondo D5; mai segreti.
4. **Rotte**: «Acquisisci con collector» (POST, admin, `withTenantFromSession`), elenco e lettura degli
   snapshot (GET, auth). Interruttore per tenant spento.
5. **Schermata** (dopo la tavola grafica): nella scheda dell'apparato, ultimo snapshot con stato per
   sezione, avvisi e dati letti; nessuna applicazione in questa tappa.
6. Prove: contesto tenant, guardie, nessuna scrittura fuori dalla tabella degli snapshot, credenziale
   assente, partial/timeout/403, crash a metà con chiusura delle sessioni.
7. **Collaudo**: gli HP della sede nuova (Comware, ProCurve, ArubaOS) acquisiti dall'appliance di quella
   sede, in sola lettura.

### C2 — Proiezioni, anteprima, applicazione

1. **Proiezioni pure** in `acquisition/proiezioni/`, una per destinazione della tabella in §3. Prove con
   gli snapshot di fixture.
2. **Scrittura per campo di `switch_ports`** (scoperta 5): campo assente = resta, `null` = letto e vuoto,
   porta tolta solo da una sezione `ok`. Percorsi UniFi e SNMP invariati.
3. **Fonte `collector`** per vicini e fatti T3, letta solo dal modello per cavo (ADR 0018). Prova: con la
   proiezione spenta T1 resta bit per bit (`misura-cavi`).
4. **Anteprima**: per apparato, cosa cambierebbe (campi, porte, vicini), conflitti col manuale, sezioni
   ignorate perché parziali. Nessuna scrittura (prova con DB in sola lettura).
5. **Applicazione** esplicita (admin), in transazione, con traccia; ripetibile senza effetti doppi.
6. **M5 Vicini da completare** dopo le tappe 3-5 (`discovery/vicini-da-completare.ts`; donatori
   `topology.service.ts:341` e `:563`, solo forma e sequenza dei controlli).
7. Misura su copia del DB dell'hub: ogni differenza dell'anteprima spiegata prima di applicare.

### C3 — Collector nuovi (uno alla volta, stesso contratto)

Per ognuno: descrittore, allowlist, parser puri, fixture anonimizzate, prove di contratto, collaudo su un
apparato vero prima di dichiararlo supportato. Ordine proposto:

1. **`aruba-cx`** se la sede nuova ha AOS-CX (E01). Donatore `DA-MKNET/OLDSCRIPT/info_complete_6100.py:95`,
   `:153`, `:187`, `:229`. Se è ArubaOS-Switch, basta `hp-procurve`.
2. **`qnap-nas`** (D1, D3): `getsysinfo firmver`/`/etc/version`/build, modello e piattaforma
   (`qnap.py:176,193`), share SMB/NFS (`qnap.py:779`), pacchetti. Distinto da `qnap-switch`.
3. **`mikrotik-routeros`** (E03-E05) più le letture MikroTik che l'app fa già (risorse, firmware, porte del
   bridge), **coordinato con la sessione della scheda MikroTik** (`origin/dev`, `188a1dae`). Donatori
   `mikrotik.service.ts:1946,2135` (ethernet e monitor, con `tabellaMonitor` di DA-IPAM), `:1862` (PoE: la
   tensione non va mai in `power_watts`), `:1738` (VLAN: `vlan-ids` con intervalli).
4. **`windows`** (E07-E09) su WinRM: identità e sistema, Hyper-V da `root/virtualization/v2` con GUID delle
   VM (`hyperv.py:58,94,112`), Defender e profili firewall (`windows_server.py:453`, senza i suoi
   riassunti), ruoli (`:372`), software dal registro (mai `Win32_Product`).
5. **`linux`** (E12, E14): `lsblk -J -b`, `df -P -i`, `lvs`/`vgs` in JSON senza sudo, `timedatectl show`,
   `getenforce`, AppArmor (`linux.py:432,794` come repertorio dei comandi).
6. **`synology-nas`** (D3): `synoshare` (verificare `-enum`/`--enum` sulla DSM vera), pacchetti senza
   limiti silenziosi (`synology.py:798,810`).
7. **`vmware-vcenter`** (dalla consegna): profilo separato da `vmware-esxi`, ContainerView, proprietà a
   blocchi da 100, DestroyView e Logout anche su errore, risultati parziali strutturati.

### C4 — Modello infrastrutturale

Dalla consegna §3-5 e dal canvas: fonte e snapshot; entità con ID interno; osservazioni; alias con scope
(endpoint o instance UUID + tipo + ID esterno); relazioni con prova (`api_reference`,
`correlated_unique`, `reference_only`, `candidate`) e intervallo di validità. Correlazione NFS → volume
solo con IP della LIF + SVM unica + percorso esatto (8 su 25 nel campione, gli altri restano non
correlati); niente VMFS → LUN senza NAA/WWID. **Schema fisico e resa proposti prima**, DB di sviluppo
isolato, mai snapshot reali sul DB live.

### C5 — Sostituzione dei percorsi storici

Per famiglia, quando il collector è collaudato: interruttore per tenant che fa leggere quella famiglia dal
collector invece che dal client storico; misura di parità sulla copia del DB; mai due scrittori sullo stesso
campo. Prima candidata: HP (i difetti delle scoperte 3 e 4 spariscono senza toccare `hp-vendor.ts`).

### C6 — Storico configurazioni

Come M4 nel piano v1, ma la lettura passa da profili `mikrotik-config`, `hp-procurve-config`,
`hp-comware-config` con allowlist propria (`/export` senza `show-sensitive`; `show running-config`;
`display current-configuration`): leggere la configurazione è un'autorizzazione diversa dall'inventario.
Archivio cifrato, tentativi distinti dalle versioni, confronto senza ordinare le righe, retention che non
tocca mai l'ultima valida, job spento. Richiede S1.

## 6. Prove e collaudi

- Ogni task: prova vista fallire, lint, tsc, prove mirate; cancello completo una volta per blocco (`npm test`
  con `DA_INVENT_DATA_DIR` temporanea, `npm run build`), esito dal codice di uscita, log nello scratchpad.
- **Collaudi HP** nella sede con Comware, ProCurve e ArubaOS, all'installazione di IPAM (nei prossimi
  giorni): CLI prima, poi C1. Il collaudo dice modello e firmware: entrano nel descrittore.
- MikroTik, QNAP, Synology, Windows/Hyper-V, Linux: nessun apparato di collaudo dichiarato. I collector si
  scrivono su uscite di documentazione ma restano «non collaudati» finché non si provano su un apparato.
- Requisiti di regressione dai difetti dei donatori: tensione PoE mai come potenza; `vlan-ids` letto; MAC
  con trattini e punti; versioni mai troncate, EdgeOS mai «UniFi OS»; colonne lette per nome, non per
  posizione; niente `Win32_Product`; nessun campo SFP senza lettura; nessun «inviato» senza ricevuta.

## 7. Decisioni (una domanda sola)

1. **D1 Pubblicazione dei collector.** Il `dev` locale (collector, 41 commit) e `origin/dev` (14 commit
   altrui) sono divergenti, e la consegna vieta il push. Proposta: pubblicarli su un **ramo a parte**
   (`collector-modulari`), che il timer dell'appliance non segue; il riallineamento di `dev` col rebase
   lo fa la sessione che apre C0, con l'albero libero dalle altre sessioni.
2. **D2** Il piano v2 (S → C0 → C1 → C2, poi C3 a richiesta, C4-C6 dopo) e i livelli di controllo: ok?
3. **D3** Export MikroTik solo admin subito (S1)?
4. **D4** Destinazioni della tabella in §3: in particolare la fonte nuova `collector` per vicini e fatti T3,
   e le VLAN tagged che restano nello snapshot finché una schermata non le usa.
5. **D5** Archivio degli snapshot: nel DB del tenant come JSON compresso; retention proposta di 20 snapshot
   per apparato più il primo e l'ultimo `ok`.
6. **D6** Ordine dei collector nuovi in C3 e se `vmware-vcenter` sale prima degli altri.
7. **D7** Storico configurazioni: retention (ultime 30 versioni diverse, l'ultima valida sempre), HP nella
   prima tappa insieme al MikroTik, evento «configurazione cambiata» negli eventi esistenti.
8. **D8** MAC virtuali unificati con GLBP, misurati prima (S3)?
9. **D9** Esecuzione: sessione nuova col prompt pronto, con o senza subagent.
10. Sulla sede nuova: «ArubaOS» è ArubaOS-Switch (basta `hp-procurve`) o AOS-CX (serve `aruba-cx`)?
