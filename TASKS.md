# TASKS — DA-IPAM

## 2026-10-21 — scheda apparato per tipo (proposta grafica)

Tavola: https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (oggi, scheletro comune, tab Gestione, switch, router/firewall, storage, hypervisor, Windows, Linux, application server). Riguarda `objects/[id]/page.tsx` (la scheda unica: `/devices/[id]` e `/hosts/[id]` ci rimandano).

- [x] Censita la scheda di oggi: 7 tab uguali per ogni tipo; credenziali in 5 punti, uptime in 4, classificazione con due editor (host in Generale, apparato in Asset); porte switch a 4 colonne su 9; MikroTik dal vivo, contatori firewall e utenti Windows persi col rimando da `/devices`; Zabbix, Wazuh (oltre alle vulnerabilità), AD, patch, `device_interfaces` e dipendenze nel DB ma non in scheda.
- [x] Scoperto sull'hub (tenant 70791): i server Windows e Linux hanno `network_devices.device_type = switch` con classificazione `server`; l'API decide le query su `device_type` (`api/devices/[id]/route.ts:67-73`). Da sistemare prima della scheda per tipo.
- [x] Tavola grafica: intestazione in una riga, striscia di 6 numeri per tipo, tab del tipo + Sicurezza · Gestione · Storico, Panoramica senza scorrimento, riga delle fonti al posto delle card vuote. Riccardo (21/10): **impostazione approvata**, le singole voci si rifiniscono dopo.
- [ ] Rifinire le voci con Riccardo, tavola per tavola (anche durante l'esecuzione).
- [x] Causa del `device_type = switch` sui server: lo schema vecchio non ammetteva `server` (workaround citato in `db-tenant.ts:6338`); le creazioni nuove passano da `resolveDeviceTypeForCreate` e sono giuste, restano le righe vecchie.
- [x] Riccardo (21/10): livello **leggero per tutto**. Piano: [`docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md`](docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md), 8 task. Le modifiche delle tappe 3-5 alla pagina sono già in `dev` (v0.9.821): niente da aspettare.
- [ ] Eseguire il piano (T1-T8).
  - [x] T1 tipo di scheda e conversione di `device_type`: v0.9.822; SNS EVA2 diventa `device_type=server` (scheda `firewall` dal vendor); righe senza classificazione non toccate
  - [x] T2 mattoni comuni, scheletro, tab Gestione/Sicurezza/Storico: pagina da 2889 a 482 righe, innesto dei tipi in `components/scheda/tab-scheda.tsx`
  - [x] T3 switch: pannello frontale, porte da guardare (`lib/scheda/porte-da-guardare.ts`), VLAN, vicini e MAC. Il dato non ha errori CRC né storico della velocità: quelle due regole aspettano la raccolta (B2); vicini senza host id = testo senza link; conteggi nelle etichette delle tab non fatti
  - [x] T4 router e firewall: GET `/api/devices/[id]/interfacce`, export `mikrotik?action=config` ora solo admin (prima no). In locale il router non risponde (credenziali cifrate con la chiave dell hub): barre DHCP, lease dal vivo ed export da guardare sull hub
  - [x] T5 storage e NAS: verificato su un FIXTURE (forma di `nas-acquisition.ts`, `src/lib/scheda/__tests__/fixture-nas.ts`), nessun NAS sull hub. Da guardare su un NAS vero: codici Synology di stato disco/RAID/SMART scritti dalla MIB e mai visti dal vivo; riallocati e ore non raccolti
  - [x] T6 hypervisor: GET in sola lettura su `proxmox-match` (il POST resta admin) e `/api/hosts/[id]/proxmox-vm` per «VM n su <nodo>». CPU del cluster, quorum e CPU per nodo non raccolti; tab Rete lunga (scorre)
  - [x] T7 server Windows, Linux e ruoli: GET `/api/hosts/[id]/ad` e `/dipendenze`; tab Dipendenze non vista a schermo (la copia dell hub non ha dipendenze), coperta dalle prove. Mancano nel dato: CPU %, KB per nome, pacchetti di sicurezza Linux; i nomi delle sessioni Windows perdono il backslash (difetto del collettore)
  - [ ] T8 chiusura
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
