# TASKS — DA-IPAM

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
- [x] Riccardo (21/10 sera): collector modulari come fonte nuova e principale, famiglie aggiunte nel tempo nello stesso JSON. Lette consegna, pacchetto (identico al codice nel `dev` locale), canvas del modello, ADR 0024-0026, manuale; 79 prove dei collector verdi (exit 0).
- [x] Scoperto: i collector `hp-procurve`/`hp-comware` coprono già M1, M2, M3 ed E02; resta l'aggancio all'app (unico chiamante oggi: la CLI).
- [x] Scoperto: `dev` locale (15 commit: collector e piano) e `origin/dev` (41 commit altrui) sono divergenti; la consegna vieta il push su `dev`.
- [x] Scoperto: tre meccanismi di acquisizione convivono (client storici, `devices/acquisition/registry.ts`, `src/lib/acquisition/`); elenco dei collector ripetuto in tre punti; versione unica `1.0.0`; niente SNMPv3 né WinRM nei trasporti dei collector.
- [x] Piano riscritto in v2 attorno ai collector: blocchi S, C0-C6, decisioni D1-D9 più la domanda su ArubaOS.
- [x] Riccardo (21/10 sera): «accetto le tue proposte» → decisioni D1-D9 scritte nel §7 del piano.
- [x] D1: collector pubblicati sul ramo `collector-modulari` (`6cca5a8a`); `origin/dev` non toccato.
- [x] Riccardo: sviluppo nel cloud finché non serve unire in locale. Prompt nel repo: `docs/handoff/2026-10-21-prompt-cloud-collector-modulari.md` (il cloud non vede `~/.claude`).
- [ ] Aperta: «ArubaOS» della sede nuova è ArubaOS-Switch o AOS-CX? Si vede al collaudo (`sysDescr`).
- [ ] Sessione cloud su `collector-modulari`: merge di `origin/dev`, poi S1 → S2 → C0 → C1 → C2 → C3 (S3 dopo il commit delle tappe 3-5).
- [ ] In locale (Riccardo): misure sul DB dell'hub, collaudo HP nella sede nuova, unione in `dev`.
- [ ] S3 (MAC virtuali) aspetta il commit della sessione delle tappe 3-5, che modifica `topology/identity.ts`.
- [ ] Dopo l'ok: tavola grafica degli oggetti d'interfaccia prima di scrivere schermate.

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
- [x] 9. Export AD (`lib/ad/health/export.ts`), chiesto da DA-VULCAN: (a) `diagnostic: true` esplicito nel raw_json dei diagnostici; (b) DA-A-DomainScore con gravità e CVSS allineati.

## 2026-10-21 — Collector modulari QNAP

Piano: docs/superpowers/plans/2026-10-21-collector-modulari-qnap.md

- [x] Piano e controllo completo approvati; lettura regole e identificazione iniziale.
- [x] Spec e piano registrati; esecuzione locale senza push/deploy.
- [x] Contratto e parser con prove.
- [x] Trasporti limitati, registry e collector QNAP QSS.
- [x] CLI e adapter senza DB.
- [x] Collaudo reale: identità/porte/VLAN/FDB/LLDP/STP/LAG/sensori; IP/ARP errori espliciti e PVID non osservato.
- [x] 32 prove mirate/SNMP verdi, lint senza errori e typecheck/build verdi; manuale e ADR 0024.
- [x] Difetti scoperti e corretti: timeout durante output lungo, STP ruolo/stato scambiati, errore IP escluso dal risultato globale, fonti SNMP attribuite senza credenziali.
- [x] Commit locali selettivi e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: aggancio persistente/UI in DA-IPAM, altri firmware, LLDP esteso, PoE, API e SNMPv3; non approvati in questa tappa.
- [x] Trappola rilevata e gestita: SSH solo shell, SNMP per tabella; timeout di inattività + termine totale per output lungo.

## 2026-10-21 — Collector HP ProCurve / ArubaOS-Switch

Estensione richiesta da Riccardo, stesso contratto e perimetro locale della tappa QNAP.
Piano: docs/superpowers/plans/2026-10-21-collector-procurve.md

- [x] Lettura contesto e stato: working tree pulito; SNMP identifica Aruba 2540 JL357A.
- [x] Campioni read-only acquisiti con operator: porte/VLAN/LLDP dettagliati, STP, LAG, PoE e ventole.
- [x] Parser ProCurve e profilo console con regressioni QNAP; 46 prove verdi.
- [x] Collector hp-procurve, registry e adapter comuni; risorse/ambiente opzionali compatibili con QNAP.
- [x] Collaudo reale con 52 porte fisiche, 48 PoE, 24 VLAN e LLDP dettagliato; nessun segreto nell’output.
- [x] 47 test, lint senza errori e typecheck/build verdi; documentazione aggiornata.
- [x] Commit locali del 2540 e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: singole istanze MST, sensori numerici temperatura/RPM e altri modelli/firmware, non collaudati.

- [x] Difetto scoperto nel pager HP: “next line: Enter” incollato alla riga seguente perdeva una porta PoE e altre righe. Fix e prova vista rossa→verde; controllo dei conteggi per FDB/VLAN/LLDP.

- [x] Secondo apparato identificato HP J9850A 5406R zl2; raccolta modulare riuscita con lo stesso collector.
- [x] Modulare collaudato: 132 entità fisiche, 6 moduli osservati; interfacce/PoE predisposti senza modulo osservato marcati, non cancellati.

## 2026-10-21 — Collector Comware

Seguito richiesto da Riccardo dopo HP modulare: profilo separato, stesso JSON/CLI, sola lettura, niente push/deploy. Credenziali solo nel vault.

- [x] Identificato IRF HPE 5700, Comware 7.1.045 Release 2432P06; campioni display acquisiti.
- [x] Parser/collector hp-comware e profilo SSH exec; risorse per membro, 63 prove verdi (QNAP/HP/Comware/SNMP).
- [x] Collaudo reale completato: 4 membri IRF, 29 VLAN, 94 LLDP, 42 LAG, 12 temperature, 8 ventole/8 PSU; snapshot parziale esplicito per timeout SNMP. Lint/typecheck/build verdi, manuale aggiornato.

- [x] Difetto temperatura: nome «hotspot 1» contiene uno spazio; regressione vista rossa→verde.
- [x] Diagnostica preliminare: timeout 8 s con canali aperti bloccava il batch; una lettura corretta, poi exec separati con chiusura e stop su trasporto guasto.
- [ ] Rinviato: Comware 5/altri firmware, PoE abilitato, ottiche DOM/IPv6 e integrazione persistente; fuori dai casi collaudati.

- [ ] Comware: completare ifTable/ifXTable/ENTITY con strategia SNMP misurata; a 15 s anche blocchi 50 restano parziali (dati preservati, 307 entità osservate). Nessun inventario completo dichiarato.

- [x] Chiusura locale: 63 test, lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; controllo segreti/permessi, compatibilità JSON QNAP/modulare e documentazione. Commit selettivo senza push/deploy.

## 2026-10-21 — Collector VMware ESXi diretto

Piano: `docs/superpowers/plans/2026-10-21-collector-vmware-esxi.md`; estensione richiesta da Riccardo, stesso perimetro locale senza push/deploy.

- [x] Working tree pulito e regole lette; preflight API identifica HostAgent ESXi 8.0.3, impronta TLS e credenziali solo nel vault.
- [x] Trasporto SOAP, contratto e collector con proprietà selezionate, CA/pin TLS, sessione singola e logout.
- [x] 76 prove verdi; CLI reale: 18 VM/8 datastore confrontati con riferimenti host, 30 vNIC/32 dischi/4 snapshot, 4 pNIC/2 vSwitch/12 portgroup/2 VMkernel e 59 sensori.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; manuale e contesto aggiornati, nessun push/deploy. Commit locali selettivi.

- [x] Regressioni viste rosse→verdi: type/xsi:type confusi cancellavano i riferimenti VM/datastore; logout vuoto; route come array diretto, pNIC per key e nome rete guest distinto da MoRef.
- [ ] Rinviato VMware: LLDP/CDP/ARP, ruoli VMkernel, policy vDS/vCenter/cluster, altri ESXi e aggancio UI/DB; questa tappa legge solo il singolo host.

## 2026-10-21 — Collector NetApp ONTAP / MetroCluster

Piano: `docs/superpowers/plans/2026-10-21-collector-netapp-ontap.md`; stesso perimetro locale dei collector, nessun push/deploy.

- [x] Working tree pulito; preflight e login REST riusciti su ONTAP 9.16.1P11, credenziali e pin nel vault.
- [x] Trasporto GET limitato e collector/schema storage/MetroCluster, stato per sottocollezione, byte esatti.
- [x] 87 prove verdi e CLI reale: storage ok, nodi/DR distinti, 36 dischi locali e 36 remoti, nessun segreto nel JSON.
- [x] Lint senza errori, typecheck/build verdi; manuale/ADR/consegna e contesto aggiornati, commit locali senza push/deploy.

- [x] Richiesta successiva: analisi vCenter per costruire il modello. Prova locale riuscita con 13 host/431 VM/38 datastore/5 cluster/2 DVS/21 DV portgroup, snapshot nel vault/dossier privato.
- [x] Consegna richiesta per l’agente DA-IPAM in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`; modello e criteri di correlazione, separazione da installazione/persistenza ancora da eseguire.
- [x] Difetti scoperti: XML grande oltre limite entity parser; test rosso→verde con DTD sempre rifiutati. Proprietà derivate vCenter InvalidProperty: prototipo legge configurationEx e defaultPortConfig, selezione nel parser.
- [x] Analisi privata: 8 correlazioni NFS univoche su 25, 17 non correlate; dati identificativi restano nel dossier clienti, vista aggregata separata.
- [ ] Rinviato: profilo vCenter di prodotto, schema/anteprima/UI/importazioni dev, cluster ONTAP remoto diretto, mapping VMFS→LUN e rete fisica. Nessuna attivazione implicita.

- [x] Pacchetto `~/Documents/DA-IPAM-collector-e-modello-20261021.tar.gz`: 35 file, manifest con hash/commit, codice/test/manuale/consegna; nessun inventario o credenziale. Verificati hash e contenuto. Vista aggregata Canvas con typecheck verde.

## 2026-10-21 — Collector dedicati NAS e Proxmox (seguito multivendor)

Livello Base, sola lettura e sviluppo locale; accessi NAS confermati da Riccardo, Proxmox da vault locale. Niente push/deploy o DB.

- [ ] Identificare i quattro NAS e un target Proxmox documentato, salvando gli accessi solo nel vault.
- [ ] Estrarre letture/parser riusabili da nas-acquisition e Proxreporter/Proxmox, senza DB, cron o installazioni remote.
- [ ] Aggiungere collector Synology DSM, QNAP NAS e Proxmox VE nello stesso contratto/CLI; aggiornare manuale e consegna.
- [ ] Una verifica finale: prove disponibili, lint/typecheck/build, campioni reali e controllo segreti; commit locali.
- [ ] MikroTik: router e switch RouterOS indicati da Riccardo, accessi SSH/SNMP confermati uguali ai NAS; acquisizione dedicata da eseguire. Riferimenti e credenziali solo nel vault.
- [ ] Ubiquiti: controller UniFi indicato da Riccardo gestito tramite cloud, API key dei due controller verificate; apparati singoli disponibili via SSH admin e password NAS, SNMP confermata da Riccardo; accessi solo nel vault. Correlare viste controller/device senza duplicati; offline non equivale a rimosso.

## 2026-10-22 — UniFi controller, prima tappa multivendor

- [x] Collector `unifi-controller` integrato nel contratto/registry/CLI; riuso del client read-only e parser senza DB.
- [x] 90 prove verdi, typecheck verde; CLI su entrambi i controller, 17 e 11 apparati, pin conservati negli input del vault e segreti assenti dai JSON.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck, build e 24 regressioni del client UniFi verdi; commit selettivo locale, nessun push/deploy.
- [ ] Proseguire NAS/Proxmox/MikroTik e Ubiquiti diretti già autorizzati: questa tappa copre solo il controller, radio/client da estendere.
