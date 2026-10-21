# TASKS — DA-IPAM

## 2026-10-21 — scheda MikroTik copiata dal Manager

Piano: [`docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md`](docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md) (blocchi P1-P4; P5 fuori). Tavole `Mk*` approvate il 21/10 nel canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Livello: P1-P2 leggero, P3-P4 completo.

- [x] T1 uscite vere del router dell'hub, fixture anonime in `src/lib/devices/__tests__/fixtures/mikrotik-*.txt`. DA-RT-CORE: 1 bridge con `vlan-filtering=yes`; `topologia.lettura.mikrotik` accesa sull'hub (15/10); apparato 1 con `physical_device_id`; pool DHCP: né (a) né (b), 8 server e 8 pool coerenti → causa ancora da trovare (T3). Trovato: i server DHCP disabilitati hanno il flag `X` in testa, il parser legge solo `disabled=` e li dà attivi
- [x] T2 risorse, hardware, firmware aggiornabile, seriale da routerboard (P1) — poi Riccardo preme «Aggiorna» su MK-RTR-CORE sull'hub — v0.9.832; i dati compaiono dopo un «Aggiorna» su MK-RTR-CORE
- [x] T3 interfacce con stato/MTU/commento dal giro ARP, stato ARP, versione dei vicini; migrazione `scheda_mikrotik_v21` v1 (P1) — v0.9.833; pool DHCP: i server spenti (flag X) risultavano accesi, ora corretti; la Panoramica mostra le barre solo dopo aver aperto la tab DHCP (scelta di interfaccia); migrazione misurata sulla copia dell hub: 25 ms, integrity ok; revisione completa fatta (1 importante corretto: commento interfaccia)
- [x] T4 Panoramica MikroTik (P2) — v0.9.834; resa a 1440 entra (dati di risorse/hardware dalla copia, dalle fixture vere)
- [x] T5 Interfacce raggruppate per tipo (P2) — v0.9.835; colonna Dettagli rimandata ai T9/T11 (bond, bridge, VLAN)
- [x] T6 Dispositivi visti dal router + `tabDelTipo(t, OpzioniTab)` (P2) — v0.9.836; GET `/api/devices/[id]/dispositivi`; `tabDelTipo(t, OpzioniTab)`
- [x] T7 Routing e ARP con lo stato, export ripulito (P2) — `ripulisciExport`, `nomeFileExport`, `statoArp`; ARP con Stato e Tipo (nascoste se vuote). Da fare con Riccardo sull'hub: tab Configurazione, «Leggi dal router»; sulla copia il router non risponde, la resa dell'export ripulito (intestazione, nota «tolte») non è vista
- [x] T8 tabelle `mikrotik_bridge`, `mikrotik_bridge_port`, `mikrotik_bond` + ADR 0027, migrazione v2, misura sulle copie (P3) — v0.9.838; migrazione v2 misurata sulla copia dell hub (18 ms, integrity ok; dal router dell hub: 1 bridge, 16 porte, 3 bond); copia del cliente A non misurata (non disponibile da qui); revisione completa: approvato, 0 gravi
- [x] T9 tab Bridge e VLAN (matrice dai PVID), dettagli bond/bridge (P3) — v0.9.839; matrice dai PVID (le T arrivano col T10); tab VLAN e Bridge solo con la lettura topologia accesa e ≥1 bridge; revisione completa: 1 importante + 3 minori corretti
- [x] T10 lettura `mikrotik_scheda` spenta: bridge vlan, vlan, dns, utenti; migrazione v3 (P4) — v0.9.840; lettura `mikrotik_scheda` nata spenta (nessun comando nuovo ai router finché non la accende un admin); migrazione v3 sulla copia dell hub 22 ms, integrity ok, segno v3; copia del cliente A non misurata; revisione completa: approvato
- [x] T11 matrice VLAN completa, VLAN con la madre, DNS e utenti (solo admin) (P4) — v0.9.841; utenti del router solo admin (provato via HTTP: admin 200 senza password, viewer 403); data per sezione; revisione completa: approvato, 1 importante + 3 minori corretti
- [x] T12 documenti (CHANGELOG, CONTEXT §6, scheda-mappa) — documenti fatti; verifica sull'hub: vedi sotto
- [ ] T12 verifica sull'hub (versione, segno `scheda_mikrotik_v21` v3, `/objects/227` con `prova-claude`, tab nell'ordine, VLAN/Bridge solo con topologia accesa e bridge, Utenti assenti per il viewer): la fa il controllore
- [ ] Aperti dopo il piano:
  - [ ] accendere la lettura `mikrotik_scheda` sull'hub (decide Riccardo; nata spenta, nessun comando nuovo ai router finché non la accende un admin)
  - [ ] sesta casella della striscia «pool DHCP più pieno»: la striscia ha già 6 caselle su 6 colonne, va scelta quale casella cede il posto
  - [ ] conteggi nelle etichette delle tab; link «non in IPAM» dei vicini
  - [ ] «Dettagli» della riga del bridge non visto a schermo (nome del bridge dei dati di prova diverso dal reale)
  - [ ] migrazioni v1-v3 misurate solo sulla copia dell'hub: la copia del cliente A non era accessibile, la prima apertura vera lì è anche la prima misura
  - [ ] «Aggiorna» su MK-RTR-CORE sull'hub, altrimenti risorse e hardware non compaiono

## 2026-10-21 — scheda apparato per tipo (proposta grafica)

Tavola: https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (oggi, scheletro comune, tab Gestione, switch, router/firewall, storage, hypervisor, Windows, Linux, application server). Riguarda `objects/[id]/page.tsx` (la scheda unica: `/devices/[id]` e `/hosts/[id]` ci rimandano).

- [x] Censita la scheda di oggi: 7 tab uguali per ogni tipo; credenziali in 5 punti, uptime in 4, classificazione con due editor (host in Generale, apparato in Asset); porte switch a 4 colonne su 9; MikroTik dal vivo, contatori firewall e utenti Windows persi col rimando da `/devices`; Zabbix, Wazuh (oltre alle vulnerabilità), AD, patch, `device_interfaces` e dipendenze nel DB ma non in scheda.
- [x] Scoperto sull'hub (tenant 70791): i server Windows e Linux hanno `network_devices.device_type = switch` con classificazione `server`; l'API decide le query su `device_type` (`api/devices/[id]/route.ts:67-73`). Da sistemare prima della scheda per tipo.
- [x] Tavola grafica: intestazione in una riga, striscia di 6 numeri per tipo, tab del tipo + Sicurezza · Gestione · Storico, Panoramica senza scorrimento, riga delle fonti al posto delle card vuote. Riccardo (21/10): **impostazione approvata**, le singole voci si rifiniscono dopo.
- [ ] Rifinire le voci con Riccardo, tavola per tavola (anche durante l'esecuzione).
- [x] Causa del `device_type = switch` sui server: lo schema vecchio non ammetteva `server` (workaround citato in `db-tenant.ts:6338`); le creazioni nuove passano da `resolveDeviceTypeForCreate` e sono giuste, restano le righe vecchie.
- [x] Riccardo (21/10): livello **leggero per tutto**. Piano: [`docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md`](docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md), 8 task. Le modifiche delle tappe 3-5 alla pagina sono già in `dev` (v0.9.821): niente da aspettare.
- [x] Eseguire il piano (T1-T8): v0.9.822-829 su dev, hub aggiornato a v0.9.829 il 21/10 alle 18:38 (codice servito verificato con grep sui chunk, journal senza errori). Pagine sull hub non aperte a schermo: manca un utente di prova sull hub, si guardano da Riccardo.
  - [x] T1 tipo di scheda e conversione di `device_type`: v0.9.822; SNS EVA2 diventa `device_type=server` (scheda `firewall` dal vendor); righe senza classificazione non toccate
  - [x] T2 mattoni comuni, scheletro, tab Gestione/Sicurezza/Storico: pagina da 2889 a 482 righe, innesto dei tipi in `components/scheda/tab-scheda.tsx`
  - [x] T3 switch: pannello frontale, porte da guardare (`lib/scheda/porte-da-guardare.ts`), VLAN, vicini e MAC. Il dato non ha errori CRC né storico della velocità: quelle due regole aspettano la raccolta (B2); vicini senza host id = testo senza link; conteggi nelle etichette delle tab non fatti
  - [x] T4 router e firewall: GET `/api/devices/[id]/interfacce`, export `mikrotik?action=config` ora solo admin (prima no). In locale il router non risponde (credenziali cifrate con la chiave dell hub): barre DHCP, lease dal vivo ed export da guardare sull hub
  - [x] T5 storage e NAS: verificato su un FIXTURE (forma di `nas-acquisition.ts`, `src/lib/scheda/__tests__/fixture-nas.ts`), nessun NAS sull hub. Da guardare su un NAS vero: codici Synology di stato disco/RAID/SMART scritti dalla MIB e mai visti dal vivo; riallocati e ore non raccolti
  - [x] T6 hypervisor: GET in sola lettura su `proxmox-match` (il POST resta admin) e `/api/hosts/[id]/proxmox-vm` per «VM n su <nodo>». CPU del cluster, quorum e CPU per nodo non raccolti; tab Rete lunga (scorre)
  - [x] T7 server Windows, Linux e ruoli: GET `/api/hosts/[id]/ad` e `/dipendenze`; tab Dipendenze non vista a schermo (la copia dell hub non ha dipendenze), coperta dalle prove. Mancano nel dato: CPU %, KB per nome, pacchetti di sicurezza Linux; i nomi delle sessioni Windows perdono il backslash (difetto del collettore)
  - [x] Utente di prova in sola lettura sull hub: `prova-claude` (viewer, tenant 70791), creato il 21/10 con ok di Riccardo; password in `~/.config/da-ipam/hub-utenza-prova.txt` (fuori da git, da spostare nel vault). Backup `data/hub.db.bak-20261021-164749-prima-utenza-prova`.
  - [x] Pagine viste sull hub il 21/10 sera (switch, router, SNS, hypervisor, DC01, wazuh): tutte entrano in 1440×900.
  - [ ] Router DA-RT-CORE, tab DHCP: «il router non ha restituito server DHCP attivi con un pool leggibile», ma i lease (320, server DHCP_DEF) ci sono: capire perché `dhcp-pool` non legge i pool.
  - [ ] DA-DC01: la casella «Active Directory» sta su una riga a sé sopra la striscia (la striscia va in due righe); «VM 401 s…» troncato in intestazione.
  - [x] VLAN degli switch UniFi cancellate ogni notte: la sincronizzazione del controller (03:00) riscriveva le porte con `vlan` vuota; ora conserva `vlan` e `stp_state` letti via SNMP (v0.9.830, hub aggiornato il 21/10 alle 19:18). Anche il ProMax senza `dot1dBasePortIfIndex` ora lega la VLAN alla porta.
  - [ ] Verificare il 22/10: dopo un «Aggiorna» di SW-CED-48POE-242 le porte hanno la VLAN, e dopo il giro UniFi delle 03:00 ce l hanno ancora (`select count(*) from switch_ports where device_id=7 and vlan is not null`). Se i nomi SNMP e quelli del controller non combaciano e gli indici sono sfalsati, la VLAN non si conserva (mai su una porta sbagliata).
  - [ ] Switch sull hub: un `ERR_TOO_MANY_RETRIES` + eccezione `Event` in console (probabile flusso SSE che si riconnette): da capire.
  - [ ] Da guardare sull hub, a schermo: router MK-RTR-CORE (barre DHCP: compaiono in Panoramica solo dopo aver aperto la tab DHCP, niente SSH a ogni apertura), export solo admin, una pagina per tipo.
  - [ ] Conversione `device_type`: i 14 server non sono più «switch» → non hanno più la riga SNMP forzata in «credenziali usate» né l attribuzione della porta switch per MAC (`db.ts:2802`); la lettura SNMP extra del cron (`jobs.ts:1013`, spenta di default) non parte più per loro. Decidere se serve.
  - [ ] Minori lasciati: SNS EVA2 resta `device_type=server` nel dato; `text-[10px]` nel codice spostato com era; costo di `proxmox-vm`; prove della migrazione su DB vero.
  - [x] T8 chiusura + revisione finale (0 gravi, 3 importanti corretti in v0.9.829: DA-VEEAM con classificazione `windows` ora server Windows; host non gestito con tab Gestione; riquadro «Rete e SNMP» in Gestione)
    - Chiusura, controllo «niente vive solo in `/devices/[id]`» (21/10). Lista dell'artboard «Oggi» (perso / c'è ma non si vede) e blocchi della pagina `/devices/[id]`; la pagina non è toccata:
      - Porte switch a 4 colonne su 9 → switch › Porte (PoE, STP, trunk, vicino, duplex) e Panoramica (porte da guardare)
      - MikroTik dal vivo (sistema, config, server DHCP, pool, lease) → router › Interfacce, DHCP, Configurazione; export `.rsc` in Configurazione (solo admin)
      - Contatori del firewall (filter/NAT/mangle, stato firewall Linux) → router/firewall › Configurazione «Regole del firewall»; firewall dei server → server › Sistema «Sicurezza e licenza»
      - Utenti Windows (ultimo utente, sessioni, profili) → server › Utenti
      - Zabbix → Gestione (collegamenti esterni); Wazuh e vulnerabilità → Sicurezza; Active Directory → server Windows DC › Active Directory; patch → server › Aggiornamenti
      - Interfacce dei router (`device_interfaces`) → router › Interfacce; abbinamento VM ↔ host → hypervisor › VM e container, «VM n su <nodo>» in intestazione
      - Etichette a 10 px e stati col solo colore pastello → riquadri nuovi: testo ≥13 px, stato con segno e parola; qualche 10-11 px resta solo in `components/scheda/dettagli/*` (spostati com'erano, ora solo `generico`)
      - Tabelle con scorrimento in pagina che scorre, nodi Proxmox uno sotto l'altro → tabelle che scorrono da sole nella tab, nodi in griglia a due colonne (hypervisor › Nodi)
      - `/devices` · Informazioni dispositivo (nome, host:porta, protocollo, badge «host #n») → intestazione e Gestione (Come ci arrivo, Identità e inventario)
      - `/devices` · Inventario asset (DeviceInventoryCard) → Gestione › Asset NIS2 (link a `/inventory/[id]`)
      - `/devices` · Dati tecnici acquisiti: sistema operativo, hardware → server › Sistema; NAS/dischi/volumi → storage › Dischi, Volumi, Servizi; rete, licenza, servizi e ruoli, sicurezza, cron, aggiornamenti, utenti, software/pacchetti → server › Sistema, Servizi, Aggiornamenti, Utenti, Software; porte in ascolto → Panoramica e Servizi; campi base di un SNMP generico → `generico` › Dettagli
      - `/devices` · Dati Proxmox (Host, VM e CT, Hardware e licenza) → hypervisor › Nodi (abbonamento), VM e container, Storage, Rete
      - `/devices` · STP e sue porte → switch › Porte (colonna STP) e Panoramica
      - `/devices` · Tab ARP, Schema porte, MAC table, Neighbors, Routing, DHCP leases → router › Routing e ARP, DHCP; switch › Porte, Vicini e MAC; neighbor di router › Interfacce
      - `/devices` · Neighbor LLDP/CDP in fondo e inventario software remoto → switch › Vicini e MAC; server › Software (scansione remota)
      - Non portato: contatore «Neighbor LLDP/CDP (n gruppi)» raggruppato per porta con badge `STP: …` (la tab Vicini li mostra in tabella, non raggruppati) — duplicato del dato, non serve
      - Non portato: un host non gestito (tipo `host`) non ha più «Dettagli» (LibreNMS, IP collegati, Sulla mappa, SNMP): ha Panoramica generica, Sicurezza e Storico — decisione del piano; si riapre solo se Riccardo lo chiede
      - Non portato: raccolta di VPN, regole firewall in elenco, database SQL, siti, posta, backup, inode/LVM, NTP/AppArmor, archivio delle configurazioni — fuori dal piano (B2/B4/B5 del piano `recupero-dadude3-mknet`)
    - T8 verificato: `TabDettagli` resta solo per `generico` (stampanti, AP, UPS, postazioni: inventario base, informazioni SNMP, IP collegati e software non stanno nella Panoramica generica); per gli altri tipi tolto. «Aggiungi a dispositivi da Discovery» tolto da `dettagli/software.tsx`; bug di precedenza `_total_vm_rows` già sparito in T6 (`numeroVm`, 3 prove).
- [ ] Coordinare col piano DADude3/MKNET: B2 (porte HP/MikroTik), B4 (Hyper-V, Windows, Linux), B5 (archivio configurazioni) riempiono i riquadri «dato da raccogliere» della tavola.

## 2026-10-21 — recupero da DADude3 e DA-MKNET (fase di piano)

Analisi del 20/10: canvas Cursor `progetti-fermi-DADude3-DA-MKNET-MKHA` (50 schede). Piano: [`docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md`](docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md). Niente codice finché Riccardo non approva.

- [x] Letti README dell'ecosistema, CONTEXT/AGENTS/CLAUDE di DA-IPAM, ADR 0018, le 50 schede e le prove comparative.
- [x] Donatori invariati dal 20/10 (DADude3 `569b416`, DA-MKNET `812b1ad`); funzioni donatrici alle righe citate.
- [x] Schede verificate sul codice di `dev`: HP, MikroTik, NAS, Windows, Linux, configurazioni, identità MAC, vicini, file «già coperti».
- [x] Scoperto: due elenchi di MAC virtuali diversi (`devices/physical-device-db.ts` conosce HSRPv2/HSRP IPv6, `topology/identity.ts` no).
- [x] Scoperto: il firmware QNAP via SSH (`uname`) **sovrascrive** quello letto via SNMP (`getDeviceInfo`, `{ ...result, ...sshInfo }`).
- [x] Scoperto: gli HP letti via SSH non scrivono vicini (`device_neighbors`); il loro LLDP finisce solo in `switch_ports.trunk_neighbor_*`.
- [x] Scoperto: ProCurve scrive in `speed` il tipo fisico («100/1000T»), non la velocità negoziata; nessuna prova sui lettori HP.
- [x] Scoperto: `upsertSwitchPorts` riscrive tutta la riga: una sotto-lettura fallita metterebbe null sopra un valore buono.
- [x] Scoperto: la GET `/api/devices/[id]/mikrotik?action=config` (export completo) non chiama `requireAuth`/`requireAdmin`: basta la sessione.
- [x] Scoperto: `DA-MKNET/backend/database.sqlite` è vuoto (0 byte): nei cloni non c'è storico da importare.
- [x] Piano scritto: classificazione delle 50 schede, blocchi B1-B6, task con donatori e destinatari, prove, livelli di controllo, decisioni.
- [x] Riccardo (21/10): niente in uso (DADude3, The Dude, QuTS hero, Docker, SCCM, DATIA: fuori); collaudi HP su una sede con Comware, ProCurve e ArubaOS, all'installazione di IPAM nei prossimi giorni. Piano aggiornato (§6).
- [ ] Riccardo: approvare piano e livelli; rispondere a D1, D2, D4-D7, D9; dire se «ArubaOS» è ArubaOS-Switch o AOS-CX; dove collaudare MikroTik, QNAP, Hyper-V/Windows/Linux.
- [ ] T1.1 (MAC virtuali) aspetta il commit della sessione delle tappe 3-5, che modifica `topology/identity.ts`.
- [ ] Dopo l'ok: tavola grafica degli oggetti d'interfaccia (B2-B5) prima di scrivere schermate.

## 2026-10-21 — cose aperte dopo la notte del 20→21/10

Prompt: `~/.claude/prompts/da-ipam-sonde-e-aperti-2026-10-21.md`.

- [x] 0b. Riccardo: committarle. agentation 3.1.2 (devDependency, montato solo con `NODE_ENV=development`); tutti i percorsi d'installazione usano `--include=dev`. `agent/` tolto (solo un egg-info dell'agente rimosso). lint + build + tsc verdi.
- [x] 0. Albero: ci sono ancora le righe non committate di `agentation` (`package.json`, `package-lock.json`, `src/app/layout.tsx`) più `agent/` (solo `da_invent_agent.egg-info`, residuo dell'agente tolto). Non si mettono in stage; chiesto a Riccardo di chi sono.
- [x] 1. VM 103 `79993-ipam-2` (PVE di casa), letta: accesa, `onboot: 1`, tag `da-appliance`; **manca la tabella nft `inet dalink`** e **UFW non è installato** → R5 rosso. In ascolto su tutte le interfacce: 53 (solo IP NetBird), 80, 443, 3001, 4443, 5355, 8080, 8443, 10050, 10051, 1514/1515, 514, 6443, 51820.
- [x] 1b. Riccardo: togliere, dischi compresi (21/10). Revocata in DA-Link (oggetto 12: nodo NetBird, bridge 18, chiave Zabbix, token; prova a vuoto poi `--applica`, uscita 0), `qm destroy 103 --purge --destroy-unreferenced-disks` (0 dischi `vm-103-` rimasti su ZFS-LARGE). `dalink verifica` dopo: **verde**. Nota: alle 09:41 una sessione dell'immagine (worktree `deploy-appliance-immagine`) la stava ancora usando; Riccardo ha deciso di procedere.
- [x] 1c. Perché aveva le porte aperte: `dalink-firewall.service` saltato (`ConditionPathExists=/etc/dalink/firewall.env`). Il primo avvio dell'immagine (`primo-avvio/fasi/netbird.sh`, ramo `claude/appliance-immagine` di Deploy-Appliance) fa solo `netbird up` e **non chiama `scripts/dalink/prepara-netbird.sh`**, che scrive `firewall.env` e accende il servizio; l'installatore classico (`Deploy-Appliance/lib/netbird.sh`) invece lo chiama. In più l'immagine non ha UFW. Vale per ogni appliance nata dall'immagine.
- [x] 1d. Corretto dalla sessione dell'immagine in Deploy-Appliance `15bc3bb` (ramo `claude/appliance-immagine`): la fase netbird lancia `prepara-netbird.sh --applica --edge si|no` prima di `netbird up` e anche a macchina già in NetBird; script assente o uscita ≠ 0 = fase ferma; prova `tests/test_fase_netbird_firewall.sh` vista rossa prima. La stessa sessione si occupa di DALINK_TOKEN perso alla riconfigura e del firewall nell'esito. Nessun'altra appliance da immagine in esercizio.
- [x] 2. Stato rifotografato il 21/10: la **150 è di nuovo accesa** (al momento del prompt era spenta), 151 spenta, 152 non esiste più.
- [x] 2b. Riccardo: riaccendere anche la 151. Accesa alle 09:46, agente QEMU risponde su 150 e 151; in DA-Link `70175-ipam` (oggetto 1) è connesso, segnale delle 09:44. DA-Link non le associa una sonda dell'hub: il bridge 7 di DA-Vul-can resta da guardare.
- [x] 3. Annotato: da-invent (192.168.4.8) scarica male da internet (dettaglio in `DA-Vul-can/TASKS.md`).
- [x] 4. Ramo `sonde-integrate-20261020`: **già in `dev`** (merge `8c00134e`, il ramo non ha commit fuori da `origin/dev`); il quadro di «Cosa esce» ha `altri_flussi.edge`. Resta da guardarlo reso a schermo.
- [x] 5. Proposta d'interfaccia delle tappe 3-5 scritta: `docs/proposte/2026-10-21-tappe-3-5-interfaccia.md` (10 oggetti per la finestra, 4 per il wizard, 3 per la classificazione, 3 domande).
- [x] 5a. Riccardo (21/10): tetto 3 tentativi Windows/AD; credenziale già fallita esclusa e detta; creazione ammessa senza credenziale provata, con avviso. Scritto nella proposta.
- [x] 5b. Tavola grafica https://claude.ai/artifact/Bau7xtUrykchk2EsNQLPXZ, impostazione approvata (21/10); voci dei menu controllate sul codice (doppioni V1-V6 nella proposta).
- [x] 5c. Riccardo (21/10): V3 tre unioni, V4 ruoli dei server, V5 stampanti/storage/modem unite; conversioni senza cautele (hub e DTS sono di prova); esecuzione qui, un agente per tappa, livello leggero.
- [x] 5d. Piano `docs/superpowers/plans/2026-10-21-tappe-3-5-rendi-apparato.md`: T1 catalogo+ruoli+migrazione · T2 classificazione unica · T3 ricerca credenziali · T4 finestra · T5 scheda/liste/wizard · T6 chiusura.
- [x] 6. `CONTEXT.md` da 19 617 a ~10,5k caratteri; il testo integrale del 21/10 mattina in `docs/storia/CONTEXT-diario-ottobre-2026.md`. Il vecchio §9 è confluito nel §8 e nel diario (nessun file lo citava).
- [x] 7. Etichetta DTS: sull'appliance DTS (`ssh dts`, tenant 71734) la rete 1 è **già** «LAN BASE 172.16.0.0/17», aggiornata il 20/10 alle 20:13 italiane. Niente da scrivere in DA-IPAM. Il /18 sta nei **report storici di DA-Vul-can** (`reports.edge_scan_label` fissato all'upload, luglio-ottobre; `edge_scan_cidr` è sempre /17).
- [ ] 7b. Riccardo (21/10): strada A, i documenti di DA-Vul-can mostrano il CIDR vero (`edge_scan_cidr`), lo storico non si tocca. Passata alla sessione DA-VULCAN 21-10.
- [x] 8. Valutazione scritta: `docs/proposte/2026-10-21-dati-ad-verso-vulcan.md`. L'export `domarc-ad-health` esiste già in DA-IPAM, manca il lettore in DA-Vul-can; il ramo `feat/ad-health-ingest` non esiste in nessuno dei due repo. Consiglio: prima caricamento a mano + lettore, poi consegna via edge.
- [ ] 8b. Riccardo (21/10): **invio diretto da DA-IPAM all'hub, come fa la sonda edge**, più un **report dell'inventario degli oggetti rilevati** per un'analisi completa. DA-Vul-can sta già facendo un'integrazione in una sessione separata: chiesto a DA-VULCAN 21-10 il contratto (endpoint, autenticazione, formato). Risposta: lo scrive lei in DA-Vul-can `docs/superpowers/specs/2026-10-21-ad-sicurezza-e-documento-direzione-design.md`, sezione «Contratto per DA-IPAM»; **niente codice in DA-IPAM finché Riccardo non approva la specifica** (DA-VULCAN manda percorso e commit).
- [x] 5e. Eseguito il 21/10 con un agente per task: T1-T5 + correzioni della revisione finale + tendina «SNMP aggiuntivo» (persa in T4, ritrovata da una prova). v0.9.815-820 su dev; hub aggiornato alla v0.9.820 (16:27), conversione `classificazioni_v21` fatta (47 host, 13 apparati). Visto a schermo a 1440 su copia del DB dell'hub.
- [x] 5f. DTS: segno `classificazioni_v21` done (29 host, 2 apparati), alla v0.9.819 alle 16:11, la 820 arriva col timer.
- [x] 9. Export AD (`lib/ad/health/export.ts`), chiesto da DA-VULCAN: (a) `diagnostic: true` esplicito nel raw_json dei diagnostici; (b) DA-A-DomainScore con gravità e CVSS allineati. Collaudo sull'hub DA-Vul-can (21/10, esecuzione 9): (b) verificata, Critical/CVSS 10; (a) non visibile, perché l'esecuzione non ha diagnostici (la copre la prova). File di collaudo cancellato.
- [ ] 10. Invio diretto AD + inventario all'hub DA-Vul-can: il contratto delle rotte `/api/ipam/*` arriva dopo l'approvazione del piano A2 di DA-Vul-can (Riccardo). Fino ad allora niente codice qui.
