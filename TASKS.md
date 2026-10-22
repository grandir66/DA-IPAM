# TASKS — DA-IPAM

## 2026-10-22 — LibreNMS come fonte di dati degli apparati SNMP

Spec [`docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md`](docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md), piano [`docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md`](docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md) (10 task; completo per aggiunta, migrazione, giro e mappa, leggero per rotte e interfaccia; stato: bozza da approvare). Prova in sola lettura sull'hub il 22/10: LibreNMS ha 3-4 volte porte, vicini e MAC dei nostri motori, più 1160 sensori.

- [x] Prova in sola lettura sull'API di LibreNMS dell'hub e confronto con il DB 70791 (spec §2)
- [x] Spec e piano scritti
- [x] Riccardo (22/10): leggero; vicini aggiunti in automatico se l'SNMP risponde; i 5 server mai interrogati quasi certamente senza SNMP (si verifica nel task 4, poi si propone di toglierli); container LibreNMS già aggiornato. Registro del piano. In coda dietro i collector modulari.
- [ ] Piano approvato da Riccardo (livelli compresi)
- [ ] T1 aggiunta senza force_add, v1/v2c/v3
- [ ] T2 migrazione librenms_fonte_v21
- [x] T3 client e lettori con uscite vere anonimizzate — una query per 50 apparati; regola SNMP in SQL confrontata con quella vera da una prova
- [ ] T4 scrittura e giro nel job librenms_sync (prova a vuoto sulla copia dell'hub)
- [ ] T5 rotte API
- [ ] T6 tavola grafica approvata
- [ ] T7 scheda: Sensori, Porte e Vicini con fonte
- [ ] T8 pagina del modulo: non interrogati, rifiutati, candidati
- [ ] T9 vicini nella mappa (zona rossa, misura prima/dopo)
- [ ] T10 accensione sull'hub, ADR, documenti

## 2026-10-22 — scansione automatica dei device scelti

Piano: [`docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md`](docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md) (10 task; giro e migrazione livello completo, interfaccia leggero; stato: bozza da approvare). Tavola approvata il 22/10: artboard `ScansioneAutomatica` (J1-J4) del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Risponde anche al punto (a) qui sotto (job `arp_poll` sull'hub).

- [x] Piano approvato da Riccardo (22/10: tavola «si va benissimo», piano «ok»)
- [x] T1 tipo `apparati_scelti`, CHECK v11 di `scheduled_jobs`, tabella `job_apparati_esiti` (misura sulla copia dell'hub) — v0.9.861; v11 sulla copia 3-4 ms, 23 job identici, integrity ok; revisione completa: approvato (una colonna sconosciuta ora blocca la ricostruzione)
- [x] T2 regole pure: config, frequenze (ogni ora · ogni 4 ore · ogni giorno alle HH:MM), idoneità, letture valide — regole pure; il job segue l ora italiana (fuso esplicito); revisione completa: 1 importante (fuso) corretto
- [ ] T3 funzioni DB: stato degli apparati in una query, esiti per apparato
- [ ] T4 letture estratte da «Interroga» e dal giro ARP, lucchetto per apparato, log senza nomi né IP
- [ ] T5 il giro `apparati_scelti` nello scheduler (prova a vuoto sulla copia dell'hub)
- [ ] T6 rotte API (anteprima, creazione, modifica, esiti, testata)
- [ ] T7 Discovery: pulsante e finestra (J1, J2), resa 1440 e 1920
- [ ] T8 pagina dei job: riga ed esiti per apparato (J3), resa 1440 e 1920
- [ ] T9 testata della scheda: pastiglia (J4), resa 1440 e 1920
- [ ] T10 accensione sull'hub (con l'ok di Riccardo per creare il job), ADR 0030, CHANGELOG, CONTEXT, scheda-mappa

## 2026-10-22 — accorpamento IP e matrice VLAN degli switch

Piano: [`docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md`](docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md) (12 task + 1 rimandato; A leggero, B leggero con misura sulla copia dell'hub, C completo; stato: eseguito e acceso sull'hub il 22/10, aperti (a)-(f)). Grafica: artboard `Discovery` e `SwitchVlan` del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv.

- [x] Piano approvato da Riccardo (22/10: tavole «ok», «eseguilo qui», «non fare altre domande, procedi fino al live»): i dubbi in fondo al piano si risolvono col consiglio del piano
- [x] T1 blocco di «Rendi apparato» sul server (`apparatoGiaPresente`, 409, anche `/api/devices/bulk`)
- [x] T2 blocco nella finestra, singolo e in blocco, con link all'apparato
- [x] T3 principale del cluster (`physical_devices.primary_host_id`, segno `cluster_principale_v21`) + elenco per nome delle righe nascoste sulla copia dell'hub — v0.9.849; sull hub: 7 cluster, 17 righe da nascondere, tutti i principali sono IP di apparati; cluster 10 e 11 (iLO HPE + schede dello stesso server?) da confermare con Riccardo; migrazione 2 ms, integrity ok; revisione: approvato
- [x] T4 API di Discovery con il cluster, tempo misurato sulla copia (soglia +10 % o +50 ms) — v0.9.850; tempo invariato sulla copia (36-43 ms prima, 39-41 dopo), risposta +0,4 %; principale offline resta principale (la riga non balla a ogni scansione)
- [x] T5 Discovery: secondari nascosti, «+N IP», ricerca sugli IP secondari, contatori spiegati — v0.9.851; resa a 1440 vista (+6 IP sul router, ricerca 192.168.16.254, subnet 16 con l IP ancora dentro)
- [x] T6 «Scegli come principale» e scelta nel «Collega altro IP» — v0.9.852; con un apparato nel gruppo il principale è il suo IP e il pulsante non c'è; senza apparato: «Scegli come principale» (solo admin); il pulsante non visto a schermo (sull hub ogni cluster ha un apparato), coperto dalle prove
- [x] T7 lettore Q-BRIDGE con le uscite vere di SW-CED-48POE-242, SW-CED-16XG-241, SW-ING-ProMax-239 — v0.9.853; esposto dai tre switch: 48POE e 16XG tabelle complete (13 VLAN), ProMax senza nomi né mappa del bridge e porte in ordine inverso; porte da Current (il 16XG mente nella Static); U della ProMax dedotta dal PVID; revisione completa: 1 importante (lettura parziale data per buona) + 3 minori corretti
- [x] T8 tabelle `switch_vlan*` (segno `switch_vlan_v21`), ADR 0029, prova a vuoto su copia hub e cliente A — v0.9.854; ADR 0029; migrazione sulla copia dell hub 41 ms, integrity ok; copia del cliente A non disponibile (decisione del controllore nel registro); revisione completa: 1 medio corretto (righe doppie ora con avviso)
- [x] T9 lettura `switch_vlan` spenta di default, nel giro ARP (una volta l'ora) e in «Interroga» — v0.9.855; spenta = nessuna walk nuova; accesa sull hub: 6 switch Ubiquiti, 42 walk/ora; «Interroga» da admin legge subito se accesa; revisione completa: approvato (3 minori passati al T11)
- [x] T10 matrice VLAN condivisa estratta dalla scheda MikroTik (aspetto invariato) — v0.9.856; matrice in `components/scheda/matrice-vlan.tsx` + `lib/scheda/matrice-vlan.ts`; la tab VLAN del MikroTik è identica byte per byte prima e dopo
- [x] T11 tab VLAN dello switch: striscia VLAN/trunk/access/senza VLAN + matrice — v0.9.857; striscia e matrice viste a 1440 e 1920 sulla copia (48POE 13·45·7·0, ProMax 13·31·1·20 «dedotta»); revisione completa: approvato + 4 minori corretti
- [x] T12 accensione sull'hub e verifica sul dato vero — hub v0.9.858 (22/10, 04:05): migrazioni `cluster_principale_v21` e `switch_vlan_v21` fatte (righe nel journal); lettura `switch_vlan` ACCESA («procedi fino al live»); lettura fatta una volta da script: 5 switch letti, 13 VLAN ciascuno, SW-UFLEX-RG-10GB (apparato 9) TEMPO_SCADUTO; tab VLAN di SW-CED-48POE-242 vista con i nomi veri; la Panoramica ora conta 13 come la tab (831c88d5); Discovery: 7 cluster, 17 righe nascoste; correzioni della revisione finale 4cf651d8 (filtri e ricerca anche sui secondari, CSV «Altri IP», blocco anche su PUT host e DHCP AD) e ratchet di `db.ts` (df2e7dc3); CONTEXT, CHANGELOG, scheda-mappa aggiornati
- [ ] (a) decidere se creare sull'hub il job `arp_poll` o accettare solo «Aggiorna»/«Interroga»: oggi l'hub NON ha il job, quindi gli switch si leggono solo a mano; con il job si leggerebbero ogni ora anche le tabelle MAC di tutti gli switch (decide Riccardo)
- [ ] (b) cluster 10 e 11 (iLO HPE + schede di rete dello stesso server?) da confermare con Riccardo
- [ ] (c) SW-UFLEX-RG-10GB (apparato 9) non risponde a SNMP (TEMPO_SCADUTO): community, ACL o SNMP spento sullo switch
- [x] (d) T13 completamento dal controller UniFi (ok di Riccardo 22/10): lista bianca + `GET rest/networkconf`, native in `switch_vlan_nativa` dalla sync UniFi (solo con `switch_vlan` accesa); ProMax 14 porte completate, resta «dedotta» (18 porte senza nativa dal controller); prove `unifi-vlan-native`, `vlan-switch`, `unifi-api`; resa a 1440 vista sulla copia
- [ ] (e) il blocco «un IP, un apparato» va aggiunto anche in `unifi-sync` prima di accenderlo (oggi spento)
- [ ] (f) le migrazioni sulla copia del cliente A (MikroTik v1-v3, cluster, `switch_vlan`) non sono mai state misurate: la copia non era disponibile
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 confrontabili, e l'SNMP non dà le porte 33-52 (sugli altri 4 switch 99/99 uguali): la lettura Q-BRIDGE della ProMax (bit «inversi», ifIndex) è da rivedere
- [ ] Native del controller senza scadenza: se uno switch esce dal controller o la lettura `switch_vlan` si spegne e riaccende, le righe di `switch_vlan_nativa` restano (l'età si vede da `nativa_letta_il` nella riga delle fonti); da decidere se farle scadere
- [ ] Sull'hub la nativa si scrive al primo giro di `unifi_sync` #22 (03:00) dopo il rilascio: verificare `switch_vlan_nativa` il giorno dopo
- [x] Panoramica dello switch sull hub (SW-CED-48POE-242): scorreva di ~190 px a 1440×900. Il riquadro mostrava già 5 VLAN: a far scorrere era la colonna destra (dettaglio + vicini + VLAN). Ora VLAN a 8 voci (due colonne da 4) sotto «Porte da guardare», «tutte (N) ›» verso la tab: a 1440×900 entra (scrollHeight 900, vista sulla copia).
- [ ] Con un filtro a chip che riempie la tabella (Trunk 7, Tutte) la pagina scorre ancora di ~150 px: la tabella arriva a 230 px e il riquadro VLAN sta sotto. Da decidere se accettarlo (vista di lavoro scelta dall'utente) o accorciare la tabella.

## 2026-10-22 — invio AD e inventario a DA-Vul-can (A-IPAM)

Piano: [`docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md`](docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md) (9 task, livello completo, stato: bozza da approvare). Oggi l'AD arriva all'hub solo a mano (download qui, «Carica» là): il piano aggiunge l'invio automatico, inventario e battito; spento senza `VULCAN_TOKEN`.

- [ ] Piano approvato da Riccardo
- [ ] T1 chiavi `VULCAN_URL`/`VULCAN_TOKEN` da `oggetto.env` e cliente dell'invio
- [ ] T2 coda `vulcan_coda` nel DB del cliente (segno `vulcan_coda_v21`), misura sulla copia 70791
- [ ] T3 invio automatico AD Health a fine esecuzione (riusa `toHubExport`, il download resta)
- [ ] T4 inventario a lista bianca (prova dei campi «Mai»), misura dei byte sulla copia 70791
- [ ] T5 trasporto HTTPS gzip verso l'hub (TLS normale)
- [ ] T6 giro: coda, ping, battito, audit JSONL
- [ ] T7 timer in `server.ts` (nessuna chiamata senza gettone)
- [ ] T8 riquadro in «Cosa esce», «Invia ora», riga nella pagina AD
- [ ] T9 collaudo contro DA-Vul-can di sviluppo (ping/battito/AD; inventario solo hub finto), documenti, rilascio spento, copie 70791 cancellate
- [ ] Fuori piano, da seguire: A-Link (`tipo:"ipam"`, chiavi in `oggetto.env`, policy P9 con conferma), A3 sull'hub (rotta inventario, nessun piano su origin al 22/10), nome `da-vulcan.domarc.it` fissato sull'appliance

## 2026-10-22 — topologia: spazio in basso, cavi a mano, server non agganciati

Livello leggero. Worktree `.worktrees/da-ipam-topologia` da `origin/dev` (il `dev` locale ha 18 commit dei collector non pubblicati).

- [x] altezza della mappa: 4rem da scrivania, 6,5rem sul telefono (era 9rem, della barra tolta il 20/10)
- [x] partenza finale (hypervisor trascinato prima di collegarlo) che restava sola: radice solo se nessuno la raggiunge — prova vista rossa 2/4, poi verde
- [x] il cavo a mano vince sempre (decisione di Riccardo, 22/10): chiave del Prim e principale forzato degli oggetti finali; aggiornate 2 prove di `cavi-albero` che fissavano la regola vecchia
- [ ] server/hypervisor non agganciati dalla tabella MAC: da misurare sull'appliance 192.168.99.51 (l'impronta ssh è cambiata e il vault non la riporta: serve la conferma di Riccardo prima di fidarsi); la copia locale dei dati è di luglio
- [x] rilascio v0.9.845 su dev, hub aggiornato (01:59 ora italiana, salute ok); resa a 1920×1080 con `prova-claude`: la mappa finisce a 12 px dal fondo
- [ ] `db-facade-ratchet` rosso già su origin/dev (265 funzioni in db.ts, soglia 262): non è di questo lavoro, l'ha lasciato la scheda MikroTik

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
- [x] T12 verifica sull'hub (22/10 01:00 ora italiana, v0.9.842): segno `scheda_mikrotik_v21` = v3, riga nel journal; `mikrotik_scheda` assente = spenta, tabelle VLAN/DNS/utenti vuote; interfacce del router con tipo (33/33). `/objects/227` con `prova-claude` (viewer): Panoramica entra in 1440×900, tab Panoramica · Interfacce · Routing e ARP · DHCP · Dispositivi · Configurazione (VLAN e Bridge ancora assenti: tabelle bridge vuote fino al prossimo giro della topologia, al più 1/ora), Interfacce raggruppate per tipo con commenti e versione dei vicini, niente Utenti per il viewer. SNS EVA2 e switch invariati. Da guardare dopo il giro: le tab VLAN e Bridge
- [ ] Aperti dopo il piano:
  - [x] accendere la lettura `mikrotik_scheda` sull'hub (decide Riccardo; nata spenta, nessun comando nuovo ai router finché non la accende un admin) → Riccardo (22/10): sì; accesa sull hub il 22/10 alle 01:43 ora italiana.
  - [x] sesta casella «pool DHCP più pieno» (v0.9.844): la casella Firmware c'è sempre col valore installato (Riccardo 22/10: «il firmware installato è importante»), in attenzione con «▲ aggiornabile a X» quando c'è un aggiornamento; il pool ≥85% (dalla cache della tab DHCP) prende il posto di «Acceso da», l uptime resta nel riquadro Risorse
  - [x] conteggi nelle etichette delle tab (dove il dato è già in pagina; mancano Interfacce, DHCP, Dispositivi, VLAN MikroTik) e vicini «non in IPAM» / link all host (v0.9.843, rotta `/api/devices/[id]/vicini-ipam`)
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
  - [x] Router DA-RT-CORE, tab DHCP: «il router non ha restituito server DHCP attivi con un pool leggibile», ma i lease (320, server DHCP_DEF) ci sono: capire perché `dhcp-pool` non legge i pool. → risolto (v0.9.833): i server spenti hanno il flag `X` e il parser li dava accesi.
  - [ ] DA-DC01: la casella «Active Directory» sta su una riga a sé sopra la striscia (la striscia va in due righe); «VM 401 s…» troncato in intestazione.
  - [x] VLAN degli switch UniFi cancellate ogni notte: la sincronizzazione del controller (03:00) riscriveva le porte con `vlan` vuota; ora conserva `vlan` e `stp_state` letti via SNMP (v0.9.830, hub aggiornato il 21/10 alle 19:18). Anche il ProMax senza `dot1dBasePortIfIndex` ora lega la VLAN alla porta.
  - [ ] Verificare il 22/10: dopo un «Aggiorna» di SW-CED-48POE-242 le porte hanno la VLAN, e dopo il giro UniFi delle 03:00 ce l hanno ancora (`select count(*) from switch_ports where device_id=7 and vlan is not null`). Se i nomi SNMP e quelli del controller non combaciano e gli indici sono sfalsati, la VLAN non si conserva (mai su una porta sbagliata).
  - [ ] Switch sull hub: un `ERR_TOO_MANY_RETRIES` + eccezione `Event` in console (probabile flusso SSE che si riconnette): da capire.
  - [x] Da guardare sull hub, a schermo: router MK-RTR-CORE (barre DHCP: compaiono in Panoramica solo dopo aver aperto la tab DHCP, niente SSH a ogni apertura), export solo admin, una pagina per tipo. → fatto il 22/10 con `prova-claude` (pagine per tipo, Panoramica e Interfacce del router).
  - [x] Conversione `device_type`: i 14 server non sono più «switch» → non hanno più la riga SNMP forzata in «credenziali usate» né l attribuzione della porta switch per MAC (`db.ts:2802`); la lettura SNMP extra del cron (`jobs.ts:1013`, spenta di default) non parte più per loro. Decidere se serve. → Riccardo (22/10): va bene così.
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
- [x] Cloud (22/10), passo 0: i due donatori (`dadude-native`, `DA-MKNET`) sono leggibili come repository della sessione; nessuna password dei vecchi `OLDSCRIPT` copiata.
- [x] Cloud, merge di `origin/dev` in `collector-modulari` (`d41537e9`): conflitti solo in CHANGELOG, CONTEXT e TASKS, tenute le sezioni di entrambi i rami; 79 prove del modulo e `tsc` verdi (exit 0).
- [x] S1: l'export MikroTik solo admin **era già in `dev`** (sessione della scheda router, `9232b22d`: `mikrotik-guardia.ts`, contratto in `api-auth-guards`). Riletto come revisore: il 403 arrivava dopo la ricerca dell'apparato (un non admin poteva distinguere 404 da 403) e la lista degli admin era duplicata. Corretto (prova vista rossa, poi verde): guardia prima della ricerca, `eAdmin` unico.
- [ ] S1, in locale: GET `?action=config` con un viewer → 403, con un admin → 200 su un router vero; `scripts/verifica-permessi.sh` (serve l'app accesa e il DB hub).
- [ ] S1, nota: per un non admin `action=all` esegue comunque `getConfig` (l'export viene letto sul router e scartato). Non cambiato: serve `systemInfo` alla scheda; da separare in C3 (`mikrotik-routeros`).
- [x] S2: firmware QNAP nel percorso storico. Prova vista rossa (3 casi su codice di oggi: firmware = uname, SSH nullo che cancella l'SNMP), poi `devices/nas/qnap-versione.ts` (`getsysinfo firmver`, `/etc/version`, build), `identitaNasDaShell` ed `unisciInfoSsh` estratti puri. `kernel` resta in `nas_inventory.ssh.kernel`.
- [ ] S2, in locale: su un QNAP QTS vero leggere `getsysinfo firmver`, `/etc/version` e la build, e confrontare col firmware mostrato (formato `X.Y.Z build AAAAMMGG` ipotizzato dal donatore `qnap.py:193`, non visto su apparato).
- [x] C0.1-2: `acquisition/catalogo.ts` è l'elenco unico (id, versione, descrittore con credenziali, sezioni, allowlist, modelli collaudati); enum dell'input, enum dello snapshot, `COLLECTORS` e allowlist dei trasporti ne derivano; `collector_version` ora per collector (semver). `comandi.ts` foglia con le tre allowlist. 85 prove del modulo verdi (79 + 6 nuove, una vista rossa).
- [x] C0.3: sezioni opzionali `system`, `host_storage`, `software`, `services`, `security` (`sistema-schema.ts`); capacità e conteggi come stringhe decimali; snapshot 1.0 già prodotti restano validi; redazione che non tocca i conteggi.
- [x] C0.4: trasporti. SNMPv3 (`input.snmp` con `version: "3"`) aperto solo da `apriSessioneSnmp`; opzioni incoerenti = errore prima della rete (`SNMP_V3_OPTIONS_INVALID`), chiavi v3 redatte. WinRM: `input.winrm` + `createWinrmReader` su `devices/winrm-run.ts`, solo script a id fisso del descrittore (`script_winrm`, vuoto finché non c'è il collector `windows`), solo codici d'errore, lotto fermato dopo errore di rete/auth. Nessun collector li usa ancora.
- [ ] C0.4, in locale: SNMPv3 authPriv contro un apparato vero e WinRM contro un server di prova (nel cloud solo con moduli finti). Nota: `runWinrmCommand` ha un suo timeout di 120 s; lo scadere del totale non ferma il processo Python, ne smette di aspettare l'esito.
- [x] C0.5: prova di contratto comune `__tests__/contratto.test.ts` + `contratto-fixture.ts` (una fixture per collector, `Record<CollectorId,…>`: la voce mancante rompe `tsc` e la suite): snapshot valido con versione del catalogo, formato ignoto mai `ok`, senza SSH nessuna shell e sezioni solo-SSH `skipped`, trasporto guasto = `error` senza segreti e senza secondo tentativo, credenziali di altro tipo respinte per i collector API. Viste rosse: redazione spenta (4 prove cadono), fixture tolta (suite e `tsc` cadono).
- [x] C0.5, osservato (non cambiato): con uscite di formato ignoto `hp-procurve` e `hp-comware` danno `interfaces: error`, mentre `qnap-switch` dà `partial`; entrambi non sono `ok`, ma la regola del piano («partial») non è uniforme. Da decidere se allineare.
- [x] C0.6: guida «Aggiungere una famiglia» in `docs/modules/acquisition.md` (file da creare, descrittore, fixture anonimizzate, prove, modelli/firmware collaudati, trasporti).
- [x] C0.7: censimento di `devices/acquisition/registry.ts` in `docs/proposte/2026-10-22-censimento-registry-acquisizione.md`: nessun chiamante, `mikrotik.ts` mai caricato, codice morto di 282 righe; proposta di ritirarlo. **Nessun cambio**: aspetta la decisione di Riccardo.
- [ ] Decisione di Riccardo: ritirare `src/lib/devices/acquisition/` (C0.7)? Allineare `interfaces` a `partial` sui formati ignoti HP?
- [x] C1, solo proposta: tavola grafica `docs/proposte/2026-10-22-collector-interfaccia.html` (15 oggetti numerati, 5 stati distinti per segno e luminanza, resa verificata con Chromium a 1280 e 390 px, senza scroll orizzontale) e schema fisico `docs/proposte/2026-10-22-collector-snapshot-schema.md` (`acquisition_sources`, `acquisition_snapshots`, chiave `acquisizione_modulare.attiva`, rotte e prove previste). Nessuna rotta, tabella o schermata scritta.
- [x] Riccardo (22/10): tavola C1 approvata con correzioni (piano §7): acquisizione normale con un altro formato, i dati popolano l'apparato (C1+C2 insieme, niente «Applica»), fonte automatica, 5 righe, «anteprima» finché C2 non è chiuso. Tavola pubblicata: https://claude.ai/artifact/RNgNG1UYmXfk1WfXFTSwZE
- [x] Cancello di fine perimetro (22/10, cloud): `npm run lint` exit 0, `npx tsc --noEmit` exit 0, `npm run build` exit 0, prove del modulo 117/117. `npm test` exit 1 con 4956 pass e **1 fallita non nostra**: `db-facade-ratchet.test.ts` («db.ts definisce 265 funzioni, la soglia è 262»); `src/lib/db.ts` è identico a `origin/dev`, quindi la fallita arriva da `dev` (sessione MikroTik/scheda): serve alzare la soglia o spostare le funzioni in `db-tenant.ts`.
- [ ] Da fare in locale (Riccardo): decisioni sulla tavola C1 e sul censimento C0.7; prova S1 con viewer/admin su un router; prova S2 su un QNAP QTS; SNMPv3 e WinRM veri; la fallita del ratchet `db.ts`; unione in `dev` e rilascio (qui non c'è stato `version:release`: lo bumpa chi unisce).
- [x] Giro cloud 2 (22/10): C1 + C2 insieme. Merge di `origin/dev` (`ddaf7710`; conflitti in CONTEXT e `mikrotik-guardia.ts`, tenuti entrambi). `db-facade-ratchet` ancora rosso per funzioni di `dev` (265 contro 262): non nostro, le funzioni nuove stanno in `db-tenant.ts`.
- [x] C1.3 schema (`987a6531`): `acquisition_snapshots`, `acquisition_source_choices` (solo la scelta del caso dubbio), `acquisition_changes`; CREATE idempotenti in `TENANT_SCHEMA_SQL`; retention D5; interruttore spento di default.
- [x] C1.1-2 aggancio (`8c59c6ef`): il pulsante di sempre (`POST /api/devices/[id]/query`) legge col collector se l'interruttore è acceso e il prodotto ne ha uno; fonte ricavata, una credenziale per protocollo dai binding, un tentativo solo, lucchetto; spento = percorso di sempre (prova sul sorgente e sulle dipendenze).
- [x] C2.1-2.5 proiezioni e applicazione (`e1bf0437`): `switch_ports` per campo, vicini e fatti con fonte `collector`, manuale che vince sull'host, una transazione, T1 identica (prova con controprova).
- [x] Revisione indipendente del diff C1/C2: un bloccante (porte abbinate per indice prima del nome → dati sulla porta sbagliata) e due da correggere (snapshot rifiutato senza traccia; password di sole cifre trovata in `speed_bps`), corretti in `95c1e89e` con prove viste rosse.
- [x] C1.4 rotte (`274a70ca`): riquadro (sessione), scelta della fonte (admin), scarico JSON (admin, in ATTESI), interruttore.
- [x] C1.5 schermata (`7868442b`): riquadro in Gestione sotto «Credenziali», finestra del caso dubbio, interruttore in Impostazioni → Sistema; resa con dati finti a 1280 e 1920 (8 varianti, nessuno scroll orizzontale).
- [x] Cancello di fine C2 (22/10, cloud): `npm run lint` exit 0 (0 errori), `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npm test` exit 1 con 5167 pass e **1 fallita non nostra**: `db-facade-ratchet` («265 funzioni, soglia 262»; `src/lib/db.ts` identico a `origin/dev`). Al primo giro cadeva anche «I33 fuori dal giro» (guardia sul sorgente: le chiamate a `upsertNeighbors` devono dichiarare la fonte): aggiunto `collector` all'elenco delle fonti dichiarate della prova.
- [ ] **Da provare in locale (Riccardo):** acceso l'interruttore, «Aggiorna» su un HP della sede nuova (ProCurve, Comware, e l'«ArubaOS»: se il sysDescr dice AOS-CX non c'è collector e resta l'acquisizione di sempre); guardare nel riquadro cosa è cambiato e controllare porte, vicini e firmware nella scheda. Poi spegnerlo e verificare che «Aggiorna» torni come prima.
- [ ] **Da misurare in locale:** su una copia del DB dell'hub, applicare uno snapshot vero a uno switch già letto dal percorso di sempre e spiegare ogni riga di `acquisition_changes` (soprattutto porte «tolte» e «aggiunte»: i nomi SSH e SNMP delle porte possono differire).
- [x] Riccardo (22/10): decisioni (a)-(f) di fine giro 2 come proposte (piano §7, «Fine giro 2»): (a) giri pianificati non riscrivono le colonne del collector, (c) `collector` prova di ruolo, (e) bulk-scan salta i dubbi, (b)(d)(f) nessun cambio.
- [x] Ratchet `db.ts` rosso: già sistemato su `dev` da un'altra sessione (`df2e7dc3`), verde il 22/10.
- [x] Giro cloud 3 (22/10): merge di `origin/dev` (`7b97fc1f`, conflitto solo in CONTEXT §6, tenute le voci di entrambi).
- [x] (a) giri pianificati (`cba44003`): `cron/jobs.ts` passa da `scriviPorteDelGiro` (`acquisizione-modulare/giri.ts`). Acceso + collector + snapshot non in errore che ha scritto le porte: i campi che la proiezione scrive da quello snapshot (per porta) restano del collector, il giro scrive MAC per porta e il resto; le porte che solo il collector conosce restano. Spento, «classica», nessuno snapshot: `upsertSwitchPorts` come oggi. Prova vista rossa (il giro rimetteva «100/1000T» sopra «1000 Mbps»).
- [ ] (a), nota: `POST /api/networks/bulk-scan-devices` (ARP dei router dalla pagina Reti) scrive ancora con `upsertSwitchPorts`: non è un giro pianificato, lasciato com'è. Da decidere se allinearlo.
- [x] (c) `collector` in `leggeViciniDiRete` (`551c7da9`): prova vista rossa, topologia 916/916, T1 non lo legge.
- [x] (e) scansione in blocco (`acfb6fb8`): i dubbi si saltano prima del test delle credenziali, vanno in `skipped_devices` e nel nuovo elenco `dubbi`, con una frase nel messaggio. Spento = nessun salto.
- [x] C3 `qnap-nas` (`8d9e4c93`), con l'infrastruttura comune: `ssh_modo` nel descrittore (`console`/`exec`/`exec_per_comando`; Comware lo dichiara), uscita 127 = non supportato, `costruzione.ts`, `linux-parsers.ts`, sezione opzionale `shares`.
- [x] C3 `mikrotik-routeros` (`6eb216fe`): riusa i parser della scheda MikroTik; PoE solo da `poe-out-power` (mutante «tensione come potenza» visto rosso), `vlan-ids` con intervalli, monitor per colonne, errori di RouterOS su stdout. `parseRouterOsDurationSeconds` spostata in `devices/routeros-durata.ts` (router-client la riesporta) perché il core dei collector non importi il DB: prova nuova sugli import.
- [x] C3 `windows` (`64552015`): otto script PowerShell nell'allowlist WinRM, busta JSON, mai `Win32_Product`, Hyper-V col GUID (sezione opzionale `guests`), Defender/firewall senza riassunti. Prova di contratto generalizzata alle credenziali non SSH.
- [x] C3 `linux` (`7e3c493e`) e `synology-nas` (`8f91c919`).
- [x] Tutti e cinque **non collaudati** (versione `0.1.0`, `collaudo: non_collaudato`), fixture con la forma documentata e dati inventati, **non agganciati al riconoscimento del prodotto** (`riconosci.ts`): si usano dalla CLI. Motivo: le proiezioni scrivono `switch_ports` da `interfaces` per qualunque apparato; un NAS o un server non deve avere porte da switch. Da decidere prima dell'aggancio: proiezione delle porte solo per le famiglie switch/router.
- [x] Cancello di fine giro 3 (22/10, cloud): `npm run lint` exit 0 (0 errori, 65 avvisi), `npx tsc --noEmit` exit 0, `npm test` exit 0 (5336 prove, 5333 pass, 0 fail, 2 saltate, 1 TODO), `npm run build` exit 0. Prove del modulo dei collector 176/176.
- [ ] **Da provare in locale (Riccardo), collector nuovi dalla CLI** (`scripts/acquire-device.ts`, sola lettura), uno per famiglia:
  - `qnap-nas` su un QNAP QTS (e uno QuTS hero se c'è): firmware e build, `smb.conf`/`qpkg.conf` nei percorsi attesi, `ip`/`df -i` di BusyBox;
  - `mikrotik-routeros` su un CRS con PoE e su un CCR: monitor ethernet e PoE, tempi con molte interfacce, più canali exec sulla stessa connessione;
  - `windows` su un Windows Server 2016/2019/2022 con Hyper-V e su un client: gli otto script su PowerShell 5.1, forma vera degli array, tempi;
  - `linux` su un Debian/Ubuntu e su un RHEL: `systemctl show '*.service'`, LVM senza root;
  - `synology-nas` su una DSM 7: quale forma di `synoshare` risponde, `smb.share.conf`, `/var/packages/*/INFO`.
  Dopo il collaudo: modello e firmware in `collaudati`, `collaudo: "collaudato"`, versione `1.0.0`.
- [ ] **Da provare in locale, (a) ed (e):** interruttore acceso, uno switch HP acquisito col collector, poi un giro ARP pianificato (o «Esegui ora»): velocità, duplex, VLAN e stato STP devono restare quelli del collector, i MAC per porta aggiornati. Spento: il giro torna a scrivere tutto. Scansione in blocco con uno switch HP senza indizi (due collector possibili): saltato ed elencato, gli altri acquisiti.
- [ ] Etichetta «anteprima» nel titolo: si toglie a fine C2, dopo le prove in locale (Riccardo).

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

## 2026-10-22 — giro 4 dei collector

- [x] Trovati nel `dev` locale di Riccardo due commit non pubblicati (`6395bfa9`, `6bf94155`): profili collaudati `unifi-controller`, `synology-dsm`, `qnap-nas`, `mikrotik-routeros`, `ubiquiti-device`, `proxmox-ve`, su base di prima di C0. Pubblicati sul ramo `collector-locali`.
- [ ] Giro cloud 4 (leggero): merge, un collector per famiglia (base collaudata), porte solo per switch/router, aggancio al riconoscimento, scansione da Reti allineata (prompt, «Giro 4»).
