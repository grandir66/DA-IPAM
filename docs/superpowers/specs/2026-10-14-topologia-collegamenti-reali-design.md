# Topologia §13 — Collegamenti come la rete reale (spec)

Stato: approvata da Riccardo il 14/10/2026 — decisioni del §13.15 prese. Aggiornata nella notte del 15/10 col passaggio
«universale» (vincolo 9) e con la rete dell'hub letta dai suoi router: le regole entrate così nelle tappe e le scelte
che restano a Riccardo sono nel 13.16.

È il capitolo 13 della spec della topologia,
[`2026-10-12-topology-map-design.md`](2026-10-12-topology-map-design.md), che al suo §13 ne tiene il riassunto e
rimanda qui. Sta in un file a sé per la lunghezza: la numerazione 13.x resta, e i «§» senza 13 (§3, §8, §11.1…)
sono sezioni di quella spec.

Nasce dal caso del 14/10 sulla sede 1 del cliente A. La mappa appendeva core 1 a uno switch di accesso, e
quello switch al router; il router ha invece un solo cavo diretto, a 10G, proprio verso core 1. Riccardo ha
chiesto di bilanciare LLDP, CDP, MNDP, spanning tree e controller «in forma di infrastruttura reale di
networking», con una logica che valga **a prescindere dal prodotto**. Il capitolo viene da un'indagine in
sola lettura sulle copie del 14/10 (cliente A e hub), fatta col modello vero dell'app, da tre progetti messi
a confronto, da tre giudizi (correttezza di rete, fattibilità nel codice, chiarezza a schermo) e da tre
verifiche della bozza (sui dati, sul codice, sulla completezza).

Il 14/10 sera Riccardo ha aggiunto un vincolo: **la logica vale per qualunque rete e qualunque marca**; il cliente A e
l'hub sono due casi di misura fra gli altri, non il bersaglio (vincolo 9). Per questo il capitolo ha criteri generali
(13.3.0), misurati su reti-campione inventate di cinque famiglie (13.12.2), e a parte i criteri sui due casi reali,
misurati sulle loro fixture e sulle copie;
nessuna regola dipende dal nome di un cliente o da un valore tarato su un cliente (prove I37 e I58). La seconda rete
vera è quella dell'hub: la notte del 14/10 i suoi quattro router MikroTik sono stati letti in sola lettura coi comandi
di questo capitolo, e la sua mappa di oggi è stata confrontata con la rete vera e coi suoi documenti (13.1, punto 18).
Le due verifiche di quell'analisi, sui dati e sul codice, valgono dove la correggono.

Le decisioni D1-D7 sono di Riccardo e **non si riaprono senza chiedere**; lo stesso vale per le sette scelte che
la bozza lasciava aperte e per le proposte che toccavano D1-D7, prese e confermate da Riccardo il 14/10 sera
(13.15): il capitolo le applica. Il capitolo prevale sui §3, §4, §8, §10, §11 e §12 dove li contraddice, e ogni
punto che sostituisce una regola lo scrive («sostituisce §…»). Le regole nate da incidenti restano tutte, ognuna
con la sua prova (13.12.3).

**Fuori dal repo.** I documenti del cliente (schemi, export dei router), la **mappa attesa** del cliente A coi
suoi 30 controlli M1-M30 e il prototipo di lavoro che ha misurato le regole di questo capitolo stanno nel dossier
del cliente A e nella cartella di lavoro dell'indagine, fuori dal repo. Lo stesso per l'hub: le uscite vere dei suoi
router (14/10 sera) e la sua mappa attesa dai documenti, coi controlli DM1-DM28. Qui sono riportati senza nomi,
indirizzi, MAC né seriali, e ogni controllo M o DM citato è scritto anche in parole.

**Nomi usati.** Router 1 (il principale della sede 1); router di riserva (la seconda unità della coppia VRRP,
censita solo come host); router 2 e router 3 (sedi 2 e 3); core 1 e core 2 (i due switch centrali a 10G);
accesso A, B e C (switch da 48 porte appesi alle porte 9, 11 e 12 di core 1); accesso D (24 porte, sotto
accesso B); hypervisor 1 e 2 (il cluster della sede 1). Sull'hub: il router (la testa), lo switch di aggregazione
(il suo nome di apparato; come ruolo si dice «core»), lo switch di gestione, il gateway del controller (un UDM, router
e controller insieme); il router di frontiera (il secondo router MikroTik, verso l'operatore, censito solo come host),
il router virtuale e il firewall virtuale (due VM dello stesso hypervisor), il router nel cloud (un router virtuale
fuori sede, raggiunto da un tunnel), lo switch di storage e il NAS (raggiunti dal router con due fasci), due switch
senza spanning tree (Flex Mini). La rete dell'hub è quella che le note di lavoro chiamano «rete B». I nomi di porta
dei prodotti (`sfp-sfpplus1`, `ether8`, «Port 47», «SFP+ 9») non identificano nessuno e restano; le porte
rinominate dal cliente si scrivono per numero («porta 10 di core 1»), e i nomi scelti dal cliente per bridge, VLAN e
tunnel solo come forma («BR_…», «VL_…»). Gli orari sono in ora italiana; nel DB sono UTC.

**Parole, una per concetto.**

- **Linea**: quello che la mappa disegna.
- **Collegamento**: l'oggetto del modello dietro una linea. Ha un **genere**: cavo, fascio, tunnel, ponte radio,
  senza fili, appartenenza a un segmento.
- **Cavo**: il filo fra due porte. Un fascio ha più cavi; un tunnel e un ponte radio non sono cavi.
- **Core**: il ruolo che il §3 chiama «aggregazione» (testa · aggregazione · accesso · AP · attaccato). D2 dice
  «core»: da qui in poi si usa «core».
- **Anomalia**: un fatto della rete che la mappa segnala («core che esce da uno switch di accesso»). Non si dice
  «avviso», che a schermo è già lo stato del monitoraggio («◆ avviso»).

**Tappe.** T1 = correzione rapida; T1b = ruolo dalle prove, un rilascio a parte subito dopo T1; T2 = letture in
più, spente, con la traccia; T3 = una linea per cavo e albero dallo spanning tree (13.11). Le uscite vere da
incollare prima del codice si chiamano T1-a, T2-a e T2-b (13.11, tabella «Uscite vere»).

## 13.1 Cosa ha mostrato il dato vero (copie del 14/10)

1. **La mappa sbagliata nasce da un clic su una linea cucita.** Alle 12:07 un admin ha scelto «Ignora» sulla
   linea «core 1, porta 10 ↔ router 1, `ether8`». Una linea è una **coppia di apparati** (`links.ts:186-199`),
   con porte prese da prove diverse: la fonte migliore impone le sue, le altre riempiono quelle vuote
   nell'ordine di arrivo (`mergeInto`, `links.ts:89-106`), e i vicini arrivano in ordine di porta e di nome
   (`:143-145`). L'uplink del controller di core 1 non sa la porta del padre, perché il router non è del
   controller (`:137`): l'ha riempita la prima riga del router in ordine, `ether8`. «Ignora» toglie la coppia
   (`:121`, `:189`), e la coppia ignorata conta come già collegata per tabella MAC, ripiego e VM
   (`attach.ts:57-58`, `vm-ports.ts:111`): è sparito anche il cavo vero a 10G.
   `SELECT action, a_port, b_port, created_at FROM topology_link_overrides;` → cliente A: questa riga sola;
   hub: nessuna. `topology_link_primary` è vuota su tutte e due.
2. **Dopo il clic l'albero sbaglia per alfabeto e contro il verso.** Prim parte dalla testa con costo = rango
   della fonte + 100 se vecchio (`link-attrs.ts:37-41`; ranghi `model-types.ts:13-21`). A pari costo vince la
   stringa «da|a» più piccola (`tree.ts:53-54`), e chi è il figlio secondo il controller (`uplinkFrom`) non
   conta. Il router ha preso accesso A via `ether1-2.5` (2,5G), e core 1 è finito sotto accesso A, percorrendo
   il suo uplink al contrario. Senza controller succede **senza nessun clic** (scenario S3 qui sotto).
3. **Misure col modello vero** (`getTenantDb` → `getTopologyModelInput` → `buildTopologyModel` →
   `computeMapView`, su copie migrate a parte; script di lavoro fuori dal repo):

   | Scenario sul cliente A | Linea router 1 – core 1 | Padri che cambiano |
   | --- | --- | --- |
   | S0 dato vero, con l'«Ignora» | nessuna | core 1 sotto accesso A, contro il verso |
   | S1 senza l'«Ignora» | porta 10 ↔ `ether8`, 1G | core 1 sotto router 1, con la porta sbagliata |
   | S2 porte di una prova sola | porta 10 ↔ `sfp-sfpplus1`, 10G | core 1 sotto router 1; accesso A sotto core 1 |
   | S2b come S2, più «niente cavi da una porta che sente due apparati» | come S2 | i due sopra, più il router di riserva sotto accesso B (porta 16) invece che sotto la porta 15 di core 1 |
   | S3 senza l'uplink di core 1 | — | oggi core 1 sotto accesso A; con le porte di S2b e il pareggio per velocità (10G contro 2,5G), sotto router 1 |

   Ordine dei pareggi, a parità di collegamenti: «rango, verso, velocità» e «rango, velocità, verso» cambiano
   0 padri su tutte e due le copie; **«verso, rango, velocità» ne cambia 4 sul cliente A**, fra cui core 1
   sotto il router di riserva attraverso la porta della WAN. Cliente A: 130 collegamenti, 1 ramo contro il
   verso, una mappa passo passo con 7 ritocchi orizzontali. Hub: 58 collegamenti, 0 rami contro il verso,
   0 padri cambiati dai pareggi. La prova di ritorno fatta finora (il codice di oggi con le righe che scriverà il
   lettore corretto) ha portato a `lldp` solo quattro righe di router 1, verso accesso A, core 1 e il router di
   riserva: non copre le righe fra router, e va rifatta nel caso peggiore (R6).
4. **I vicini del router sono tutti «mndp» e troncati.** Il protocollo è scritto fisso (`router-client.ts:1095`)
   e i valori si leggono fino al primo spazio (`:1081-1086`): «Port 47» diventa «Port». Il campo
   `discovered-by` (RouterOS 7.7 e dopo) non si legge.
   `SELECT protocol, source, COUNT(*) FROM device_neighbors GROUP BY 1, 2;` → cliente A: lldp/unifi 172,
   lldp/device 23, mndp/device 144; hub: lldp/unifi 55, mndp/device 33. I quattro router del cliente A non
   impostano il protocollo di scoperta (export del cliente): vale `cdp,lldp,mndp`. Il CDP passa gli switch che
   non sono Cisco come un pacchetto qualsiasi, e il codice lo accetta come conferma di un cavo
   (`links.ts:162-167` esclude solo `mndp`). Righe troncate di router 1:
   `SELECT COUNT(*) FROM device_neighbors WHERE device_id = <router 1> AND remote_port IN ('Port', 'Mikrotik');` → 3.
5. **Fra router 1 e core 1 c'è un cavo solo**, `sfp-sfpplus1` ↔ porta 10, a 10G, dentro il bridge. Lo dicono
   quattro prove: l'uplink del controller, l'LLDP di core 1 sulla porta 10 (porta remota `sfp-sfpplus1`), la riga
   del router su `sfp-sfpplus1`, la tabella del bridge del router. `ether8` non è un cavo verso core 1: la
   **porta 15** di core 1 sente via LLDP due apparati (router 1 e router di riserva, tutti e due dalla loro
   `ether8`) più un terzo MAC, probabilmente il modem. In mezzo c'è un apparato che ripete l'LLDP: è un
   **segmento**.
   `SELECT device_id, local_port, COUNT(DISTINCT upper(remote_mac)) FROM device_neighbors WHERE protocol = 'lldp'
   AND timestamp >= <ultima lettura − 2 giorni> GROUP BY 1, 2 HAVING COUNT(DISTINCT upper(remote_mac)) >= 2;` →
   cliente A: la porta 15 di core 1 e 7 porte «eth0»; hub: la porta 5 dello switch 48 PoE (4 apparati) e 2 «eth0».
   La finestra di 2 giorni conta: senza, col tempo, un vicino vecchio e uno nuovo sulla stessa porta farebbero
   un segmento falso (13.7.1, passo 2). Oggi le porte sono le stesse con e senza finestra, perché i vicini hanno
   un solo giorno di storia.
6. **`ether1-2.5` di router 1 è un cavo vero (2,5G verso accesso A) ma fuori dal bridge**: le sue righe non hanno
   «,bridge», e l'export del cliente la dà senza indirizzo. **Fra router 1 e core 2 non c'è nessuna prova**, in
   nessuna fonte (D7: confermato da Riccardo, che il 14/10 sera ha precisato: router 1 ha una sola SFP+,
   `sfp-sfpplus1`, e va solo a core 1).
7. **Lo spanning tree non entra nella mappa.** Il modello non lo legge (`grep -rn stp src/lib/topology/` trova solo
   «sstp» a `links.ts:68`). `SELECT COUNT(*), SUM(stp_info <> '') FROM network_devices;` → cliente A 88 | 0,
   hub 43 | 3. Il controller dà lo stato per porta: core 2 esce dalla sua porta 11 verso accesso C e tiene ferme
   (`discarding`) le porte 9 e 12, che vanno ad accesso A e accesso B. Del router non si legge niente di utile:
   - il lettore SSH dello spanning tree gira solo per i MikroTik censiti come switch (`switch-client.ts:443`), e
     solo quando una persona interroga l'apparato o lancia la scansione in blocco
     (`devices/[id]/query/route.ts:416-417`, `networks/bulk-scan-devices/route.ts:255-258`); trasforma MSTP in
     `null` (`stp-ssh.ts:48`, `:107-108`);
   - la lettura SNMP chiude la sessione comune alla fine del primo dei nove walk (`query/route.ts:286-296` con
     `snmp-stp-info.ts:58-69`) e deduce «rstp» da un valore che vuol dire «802.1D» (`snmp-stp-info.ts:97`);
   - lo stato del router via SNMP finisce su `bridge`, VLAN e porte fuori dal bridge, per il ripiego «porta del
     bridge = ifIndex» (`snmp-port-schema.ts:186-188`).
   Il giro periodico degli switch (`cron/jobs.ts:903-1000`) legge solo tabella MAC e porte: niente vicini, niente
   spanning tree.
8. **MSTP e le sedi** (documento del cliente, non verificato sul dato). Router 1 e router 2 stanno nella stessa
   regione; router 1 è la radice dell'albero comune, router 2 quella dell'istanza 1. Router 3 e router di
   riserva sono in RSTP, fuori dalla regione. Core 2 ha priorità 12288, gli altri switch del controller quella
   di fabbrica (la porta radice di core 2 non cambia). Fra sede 1 e sede 2 ci sono tre vie, tutte sul router 1:
   un ponte radio a 5 GHz di livello 2 (attivo nell'albero comune), un ponte radio a 60 GHz instradato, un
   tunnel EoIP dentro un tunnel cifrato (bloccato nell'albero comune, attivo per la VLAN dell'istanza 1). Verso
   la sede 3 c'è un ponte a 5 GHz; il tunnel verso la sede 3 è spento. Il documento del cliente dice RouterOS 7.23 e
   che lì manca il comando che dà lo stato per porta e per istanza; l'uscita vera del 14/10 dice che il router 1 è
   sulla 7.24.4 (verifica del 15/10): il comando si riverifica in T2-a.
9. **La stessa porta ha tre nomi.** «SFP_ 9» nell'LLDP del controller (`unifi-map.ts:151`), «SFP+ 9» nell'elenco
   delle porte, «Port 9» nell'uplink (`links.ts:137`); il confronto toglie solo spazi e maiuscole
   (`utils.ts:100-102`). Il lettore del controller ha l'indice della porta (`unifi-map.ts:208`) e lo butta
   (`:218`). E «SFP_ 1» **non** è «SFP 1»: su accesso B «SFP+ 1» è l'indice 49, «SFP 1» il 51, «Port 1» l'1, e
   «Port 1» e «SFP_ 1» hanno vicini LLDP diversi (`SELECT port_index, port_name, speed FROM
   switch_ports WHERE device_id = <accesso B> AND port_index IN (1, 2, 49, 50, 51);`). Sull'hub lo switch di
   aggregazione ha due porte «SFP+ 15», agli indici 15 e 16 (`SELECT device_id, port_name, COUNT(*) FROM
   switch_ports GROUP BY 1, 2 HAVING COUNT(*) > 1;`).
10. **Interfacce logiche.** Il router annuncia LLDP anche dalle VLAN e dalle VRRP: sulla porta 10 di core 1 ci
    sono 7 righe dello stesso apparato, una `sfp-sfpplus1` e sei logiche, e una riga VRRP porta un IP che si
    abbina a un altro nodo (l'abbinamento prova l'IP per primo, `node-index.ts:275-292`). Router 1 sente
    router 2 su `ether1-2.5`, `ether2`, `ether3` e su dieci interfacce logiche, e oggi una riga del router su
    un'interfaccia logica passa appena la coppia è confermata (`links.ts:178-181`). Sull'hub le VLAN del router
    hanno nomi scelti a mano («VL_…»): l'espressione delle interfacce logiche non li conosce (`links.ts:68`) e
    `physicalPortName` le prende per porte fisiche (`:75-83`). La stessa espressione mette fra le logiche anche
    le interfacce senza fili (`wlan`, `wifi`): sull'hub l'unico collegamento di un oggetto è la riga LLDP di un
    access point sulla sua interfaccia senza fili.
11. **Fasci.** Sull'hub router e switch di aggregazione hanno due cavi da 25G in un fascio; la linea dice
    «porta 31 ↔ `sfp28-1`», porte di due cavi diversi, mentre la porta 31 sente il router con porta remota
    `sfp28-2` (e con una seconda riga «VL_…» dello stesso apparato).
12. **Ruoli e dato sporco.** Sull'hub 19 PC e server (16 Windows letti via WinRM, 3 Linux via SSH) e il firewall
    virtuale sono registrati come «switch» per l'inventario: nell'elenco della mappa 12 stanno fra gli switch (6
    nell'albero e 6 VM censite come apparati), gli altri in «Da sistemare» (conteggio rifatto dalla verifica del
    15/10). Alcuni host sono classificati «router» su prove deboli (un telefono, un notebook, due host con
    «Insufficient evidence»), e gli switch MikroTik e Cisco dell'hub sono classificati «router». La mappa crede al tipo
    e alla classificazione (`identity.ts:52-60`), e la promessa della spec §8 («la mappa li mette in Da sistemare») non
    è mantenuta.
13. **Disegno.** Le maniglie sono fisse (`map-screen.ts:16-25`, `map-node.tsx:66-75`); una ridondanza va dal
    riquadro più a sinistra a quello più a destra (`map-screen.ts:34-39`, `map-canvas.tsx:200-207`) e fa il
    giro; la stampa ripete i gradini dello schermo (`print-draw.ts:30-42`). L'elenco di sinistra è largo 300 px
    fissi (`object-list.tsx:81`).
14. **Quando si leggono i router.** La lettura dei router (`runArpPoll`, `cron/jobs.ts:646`) non la chiama solo il
    job `arp_poll`: la chiamano anche le scansioni veloci di ogni rete, per il router di quella rete
    (`scanner/discovery.ts:1121` → `:469-480`).
    `SELECT network_id, job_type, enabled, interval_minutes FROM scheduled_jobs WHERE job_type IN ('arp_poll',
    'fast_scan');` più `network_router` → hub: nessun job `arp_poll`, 7 scansioni veloci ogni 15 minuti, 6 sulle
    reti dello stesso router (partono nello stesso secondo); cliente A: `arp_poll` ogni 6 ore, router 1 letto ogni
    ora dalla scansione veloce di una rete. Ogni comando di oggi apre una connessione SSH sua
    (`router-client.ts:246-252`, `mikrotik-porte.ts:115`).
15. **La velocità cercata per nome sbaglia anche sull'hub.** Lo switch di aggregazione vede via LLDP le schede di
    tre hypervisor con nomi di porta «SFP_ N - ‹nome›», e nell'elenco le porte si chiamano «SFP+ N - ‹nome›»: la
    velocità non si trova (`link-attrs.ts:116-118`), e il principale di quegli hypervisor, scelto per velocità
    (§12.5, `tree.ts:95-116`), è lo switch di gestione a 2,5G (porte 1, 3, 6) invece dell'aggregazione a 10G (porte
    17, 19, 23). Col modello vero e la sola velocità per chiave, quei 3 padri cambiano (sul cliente A nessuno).
    Quei cavi si vedono solo grazie all'LLDP del firmware delle schede.
16. **Linee cucite oggi** (due porte piene che nessuna prova sola ha, contate col modello vero): cliente A 1 con la
    correzione del 14/10 (router 2 – il suo switch degli uffici: la porta dello switch viene dall'uplink, quella
    del router dalla riga del router, che ha la porta remota troncata in «Port»; col lettore corretto la stessa
    riga dà tutte e due le porte), 2 senza; hub 1 (router – aggregazione, porta 31 ↔ `sfp28-1`).
17. **Lo stato dei tunnel c'è già.** `SELECT device_id, port_name, status, timestamp FROM switch_ports WHERE
    port_name LIKE 'eoip%';` → il tunnel fra sede 1 e sede 2 è acceso ai due capi (router 1 letto il 14/10,
    router 2 il 13/10); quello verso la sede 3 è spento su router 1 e acceso solo nella lettura di router 3, che
    è di maggio.
18. **La rete dell'hub letta dai suoi router** (14/10, 22:12-22:15: quattro MikroTik su RouterOS 7.24.2 e 7.24.5, in
    sola lettura, una connessione per router; uscite fuori dal repo). La copia del DB è delle 13:50 dello stesso
    giorno: le righe dei vicini del router sono le stesse nelle due fonti. Che cosa mostra, oltre ai punti 9-12, 15
    e 16:
    - **Uno spanning tree solo, RSTP**, con radice il router (priorità 0). Nessuna regione MSTP fra i MikroTik, nessun
      cavo bloccato: l'unico «blocking» sta su una porta senza modulo, cioè giù.
    - **Fasci.** Il router porta lo switch di aggregazione su un fascio LACP di 2 cavi a 25G: il partner LACP è
      l'aggregazione, e l'LLDP c'è sui due membri. Per lo spanning tree il fascio è una porta sola (l'aggregazione
      dichiara il costo di 50G). Un secondo fascio, di 2 cavi a 5G verso il NAS, che non manda LLDP, è provato **solo**
      dal partner LACP: oggi il NAS è tre nodi, appesi al ripiego.
    - **Il router di frontiera** ha la porta radice verso la porta 10 dell'aggregazione (costo 2400 = 2000 del suo cavo
      a 10G + 400 del fascio). Ha anche due cavi diretti verso il router, provati dall'LLDP dei due capi e dallo stesso
      seriale del cavo DAC ai due capi, che dal suo lato sono **fuori dal bridge, in due VRF**. È censito solo come
      host: le sue porte e il suo spanning tree non entrano nel modello.
    - **Nomi scelti e MAC d'interfaccia.** Il bridge del router ha un nome scelto («BR_…»), le VLAN anche («VL_…»), e il
      router annuncia da ogni interfaccia (`discover-interface-list` = `all`). Il router sente il router di frontiera
      su 15 righe e 14 interfacce, 10 delle quali VLAN, con 4 MAC diversi: nelle righe di RouterOS il MAC è quello
      dell'interfaccia che ha mandato l'annuncio, non il telaio. Oggi la mappa lega i due router da una VLAN («VL_… ↔
      VL_…»): `physicalPortName` prende per porta fisica un nome che non conosce (`links.ts:82`), e su quella VLAN il
      router di frontiera è l'unico vicino (`links.ts:170-180`).
    - **Protocolli veri.** Delle 33 righe del router, tutte `mndp` nel DB, 8 sono LLDP (tutte su porte fisiche) e 25 CDP
      o MNDP. Su un membro del fascio verso l'aggregazione ci sono 1 riga LLDP (l'aggregazione) e 3 CDP di apparati che
      stanno dietro l'aggregazione, che le inoltra; sull'altro membro le stesse tre arrivano via MNDP.
    - **Il gateway del controller.** Il controller ne segna come uplink la porta a 10G e la accoppia a una porta a 25G
      dell'aggregazione. Il gateway, via LLDP, si dice collegato a due porte dell'aggregazione: quella a 25G e un'altra,
      etichettata come sua uscita; il suo MAC sta nella VLAN della WAN. Che la porta a 10G sia la WAN, verso la porta
      etichettata, e la LAN a 25G vada all'altra, è dedotto (dai nomi `ethN` del gateway, dalle velocità e da quegli
      indizi), non letto.
    - **Switch senza spanning tree** (due Flex Mini): porta di uplink accesa, stato `disabled`, 141 e 144 MAC dietro.
      Tre porte giù hanno stato `forwarding` (una del router, due di switch del controller).
    - **Apparati virtuali.** Il router virtuale e il firewall virtuale sono VM dello stesso hypervisor. Il firewall è
      registrato come switch, e la sua «tabella MAC» (la sua tabella ARP per interfaccia) contiene i MAC delle sue
      stesse schede: da lì la mappa di oggi appende l'hypervisor alla sua VM, con un collegamento «dalle VM» su una
      scheda che l'ultima lettura (23/05) dice spenta. `vm-ports.ts:109` esclude solo l'hypervisor che è l'apparato
      stesso, e il giro della tabella MAC (`vm-ports.ts:72-87`) non salta i MAC dell'apparato che osserva, mentre
      `attach.ts:106` sì. Le VM vengono da due scansioni a mano del 27/04 fatte da due nodi del cluster; tre nodi non
      sono mai stati letti da soli; il job `hypervisor_sync` dell'hub è stato acceso il 14/10 alle 10:50 e fa il primo
      giro il 15/10 alle 5:00 (un job giornaliero parte alle 03:00 UTC, `scheduler.ts:151`).
    - **Un tunnel di livello 3 attraversato.** Il router virtuale sente il router nel cloud via MNDP su un tunnel
      WireGuard, in un verso solo.
    - **La VLAN della WAN dentro il bridge del router**: sette porte d'accesso con la stessa VLAN, una senza modulo,
      quindi sei cavi con un apparato ciascuno. Non è un segmento; la stessa forma c'è sul cliente A.
    - **Radici e testa.** Cinque oggetti di rete senza collegamenti (due switch di laboratorio che si annunciano via
      MNDP, uno switch che non risponde da maggio, un notebook e un telefono classificati router) sono radici sole
      della mappa automatica: «Da sistemare» prende solo apparati, attaccati e hypervisor (`model.ts:60-63`). La testa
      la decide l'id: `proposeHead` prova i router in ordine di id e tiene il primo che raggiunge più nodi
      (`tree.ts:141`, `:145`), e il router e il gateway del controller stanno nella stessa componente.
    - **Il resto della mappa di oggi** ha giusto lo scheletro del controller: aggregazione sotto il router, switch e AP
      sotto l'aggregazione, gli switch senza spanning tree sotto il loro switch.

## 13.2 Le decisioni di Riccardo, e dove si applicano

| | Decisione (14/10 pomeriggio) | Dove |
| --- | --- | --- |
| D1 | Prima la correzione rapida, livello leggero: «Ignora» per cavo, porte prese dalla stessa prova, pareggi per velocità e verso (non alfabeto), protocollo vero dei vicini del router; nella stessa consegna linee sul lato più vicino ed elenco di sinistra comprimibile. Poi, livello completo: una linea per cavo con prove neutre per porta, e albero dallo spanning tree | 13.11 |
| D2 | L'albero lo decide lo spanning tree: il padre di un bridge è il vicino sulla sua porta radice; cavi bloccati con la scritta «bloccato dallo spanning tree»; in MSTP l'albero comune; core 2 resta sotto il suo accesso con l'avviso «core che esce da uno switch di accesso»; dove lo spanning tree manca, l'affidabilità della fonte; «★ Rendi principale» vince sempre | 13.8 |
| D3 | «Ignora» toglie solo quel cavo (le due porte scritte sulla linea); l'«Ignora» del 14/10 si riguarda a mano | 13.9 |
| D4 | Letture in più in sola lettura, spente di default, accese cliente per cliente dopo la misura | 13.5; la sovrapposizione con D1 sul lettore dei vicini del router: 13.5.1 e 13.15, «Confermato il 14/10» |
| D5 | Porte del router fuori dal bridge: «instradato, fuori dal bridge», non battono mai un percorso nel bridge ma restano principali di ciò che si raggiunge solo da lì; un segmento con più apparati diventa l'oggetto «segmento: modem o switch non gestito» a cui si attaccano gli apparati | 13.7.3, 13.7.4; per i segmenti un'eccezione decisa il 14/10 sera (13.15, punto 1) |
| D6 | Apparato di rete solo con prove (LLDP/CDP, spanning tree, tabella MAC con apparati dietro, VM ospitate); senza prove «Da sistemare»; i tipi sbagliati dell'hub si correggono dopo, a parte | 13.8.2, con le sei prove in più e il ruolo a mano confermati il 14/10 sera (13.15, «Confermato il 14/10») |
| D7 | Il cavo diretto del router va solo a core 1 (router 1 ha una sola SFP+: precisato il 14/10 sera); fra sede 1 e sede 2 ponte radio multiplo e tunnel, disegnabili a mano | 13.3.1, 13.7.5, 13.7.6 |

Il 14/10 sera Riccardo ha preso le sette scelte che la bozza lasciava aperte e confermato le proposte che toccavano
D1-D7: sono in 13.15, e il capitolo le cita come «13.15, punto N».

I vincoli di Riccardo: (1) le fonti si pesano per quello che provano (13.4); (2) il caso guida è la sede 1
(13.3); (3) router 1 è in MSTP (13.8.3); (4) a prescindere dal prodotto: i lettori e i loro **traduttori** parlano
il loro prodotto, la logica dei collegamenti no, e una prova lo controlla (13.5.1, 13.6.1, 13.12); (5) linee sul
lato più vicino (13.10.1); (6) elenco comprimibile (13.10.2); (7) i client nella mappa dell'hub: D6, per le due
cause (13.8.2, H4 e H4b); (8) l'LLDP degli host è una fonte come le altre, più la lettura dal lato dell'host
(13.5.5); (9) la logica, le prove e i criteri valgono per qualunque rete e marca, e i due casi reali sono misure
(13.3.0, 13.12.2, 13.16); (10) le uscite vere del router 1 del cliente A (T1-a) danno la forma del lettore, insieme a
quelle dei router dell'hub (13.5.2).

## 13.3 Obiettivo e criteri di successo

La mappa disegna la rete come la disegnerebbe un sistemista davanti agli apparati. Un cavo è un cavo, con le
sue due porte; un segmento non gestito è un oggetto; un tunnel è un tunnel e un ponte radio un ponte radio.
L'albero segue il percorso del traffico, cioè lo spanning tree, e dove lo spanning tree manca la prova più
affidabile. Ogni linea si spiega in parole, nei dettagli e al passaggio del mouse, e lì dice quando sta
indovinando. La logica è una sola per tutte le reti e tutte le marche, e i suoi criteri sono scritti per ogni rete
(13.3.0); il cliente A e l'hub sono le due reti vere su cui si misura (13.3.1-13.3.6). Ci si arriva senza che il
cliente A e l'hub, che ricevono `dev` da soli, vedano peggiorare la mappa **senza averlo saputo prima**: ogni oggetto
che cambia padre o esce dall'albero è contato nella misura della tappa ed elencato per nome a Riccardo prima del
rilascio. Due cambiamenti sono già noti: con la regola del segmento, che entra nella correzione rapida (13.15, punto
2), sull'hub tre switch di laboratorio, che esistono solo come host, escono dall'albero e vanno in «Da sistemare»;
con la velocità trovata per chiave, sull'hub tre hypervisor passano dallo switch di gestione allo switch di
aggregazione (H9). Il passaggio universale del 15/10 ne aggiunge altri, contati allo stesso modo: sull'hub, in T1,
sparisce la linea fra il router e il router di frontiera tracciata da una VLAN (H7) e l'hypervisor appeso alla sua VM
cambia padre (H15); in T1b i cinque oggetti di rete senza collegamenti vanno in «Da sistemare» (H14), e sul cliente
A ci va la radio lontana a 60 GHz, oggi radice sola, finché il salto radio di T3 non la rimette nell'albero (C16).

### 13.3.0 Criteri generali, per ogni rete

Valgono per qualunque rete e qualunque marca (vincolo 9). Ognuno nomina gli schemi di rete che lo mettono alla prova, e
si misura sulle reti-campione inventate del 13.12.2, una per famiglia, con le prove-invariante del 13.12.3; il
cliente A e l'hub sono due misure in più, mai il bersaglio. Nel resoconto di ogni tappa c'è una riga per criterio
(passa, non passa o non applicabile, con la prova che lo misura). Se una regola fa passare un caso reale e fa sbagliare
una rete-campione, si corregge la regola.

| # | Criterio | Schemi di rete che lo mettono alla prova | Famiglie (13.12.2) | Prove | Tappa |
| --- | --- | --- | --- | --- | --- |
| G1 | Le due porte di una linea vengono da una prova sola: nessuna linea «cucita» | uplink del controller che non sa la porta del padre; più righe dello stesso apparato sulla stessa coppia | 1, 2, 3, 4, 5 | I6, I8 | T1 |
| G2 | Da un'interfaccia logica locale (VLAN, VRRP, bridge, tunnel) non nasce un cavo, e nemmeno da un nome scelto dall'utente che il lettore non sa essere una porta fisica: la porta fisica si decide dalla forma della riga o dal tipo dell'interfaccia letto, **mai dal nome** | router che annuncia da ogni interfaccia; bridge e VLAN coi nomi scelti | 1, 3, 5 | I5, I41, I58 | T1 per un router letto col traduttore del suo prodotto (MikroTik via SSH); T3 per tutti, col tipo letto |
| G3 | «Nel bridge» o «fuori dal bridge» viene da un fatto (la forma della riga del router, le porte del bridge lette), con qualunque nome del bridge; mai dalla tabella MAC | bridge col nome scelto; porte in una VRF | 1, 5 | I27, I59 | il fatto in T1, l'effetto («instradato») in T3 |
| G4 | Gli apparati di una porta si contano **per apparato** (lo stesso apparato con più MAC o da più interfacce è uno), coi soli annunci di collegamento e nella finestra «non visto»: due o più fanno un segmento, uno è il cavo | router che annuncia con un MAC per interfaccia; CDP inoltrato su un membro di un fascio; modem o switch muto; cavo spostato | 1, 2, 5 | I7, I13, I43, I60 | T1 la regola, T3 l'oggetto |
| G5 | Una VLAN su più porte d'accesso di un bridge gestito non è un segmento: ogni porta ha il suo cavo | la WAN dentro il bridge del router | 1 | I61 | T1, T3 |
| G6 | Gli annunci che attraversano gli apparati (MNDP, CDP inoltrato, annunci da VLAN e VRRP) non fanno cavi e non confermano; fra router danno un collegamento solo come unico vicino su una porta fisica, «probabile» | router dietro un ponte radio, uno switch o un tunnel | 1, 3, 5 | I2, I3, I4, I51 | T1 |
| G7 | La stessa porta scritta in modi diversi dalle fonti è una porta sola; un nome doppio non si risolve per nome; la velocità si trova per chiave | «SFP_ N», «SFP+ N», «Port N», etichette scritte a mano, un nome annunciato che l'elenco non ha, due porte con lo stesso nome | 2, 4 | I12, I14, I46, I70 | T1; per indice da T3 |
| G8 | Nessun padre e nessuna testa si decidono per ordine alfabetico o di id prima delle prove: i pareggi per stato, fiducia, verso e velocità; la testa per nodi raggiunti e reti di cui è gateway | due router nella stessa componente; due cavi di pari rango | 1, 2, 3, 4, 5 | I10, I11, I63 | T1; con lo spanning tree, T3 |
| G9 | Un apparato non è vicino né client di sé stesso; una VM non fa da padre al suo hypervisor | firewall o router virtuale con le sue schede nella tabella MAC | 4 | I62 | T1 |
| G10 | Ogni oggetto di rete sta nell'albero con un collegamento, oppure in «Da sistemare» col motivo: nessuna radice sola, nessun ruolo di rete senza una prova (il tipo dichiarato e la classificazione non bastano, nemmeno per «hypervisor»; `disabled` non è una prova di spanning tree) | PC registrati come switch; host classificati router; switch che si annunciano e che nessuna lettura lega; un telefono IP che si annuncia via CDP | 2, 4, 5 | I28, I64, I65 | T1 per chi resta senza collegamenti su un segmento; T1b per gli altri |
| G11 | Un fascio è una linea sola, coi membri e la velocità somma, provato da LACP, dalla forma della riga o dal controller; senza prova è «dedotto» solo fra due bridge che si parlano con lo spanning tree | fascio con LLDP; fascio provato solo dal partner; due cavi che non sono un fascio (WAN e LAN di un gateway, porte instradate) | 1, 2, 3 | I66 | T3 |
| G12 | Dove lo spanning tree è letto, il padre di un bridge è il vicino sulla porta radice; «bloccato» solo con un blocco su una porta accesa; `disabled` su una porta accesa vuol dire senza spanning tree, e la porta inoltra; ogni stato su una porta giù vale «giù» | MSTP con radice regionale; switch senza spanning tree; porte giù con uno stato | 2, 3, 5 | I22, I24, I25, I67 | T3 |
| G13 | Un collegamento instradato (porta fuori dal bridge, anche in una VRF) non batte un percorso nel bridge; l'uplink del controller di un gateway è la sua WAN, non il suo padre | secondo router con cavi diretti in VRF; gateway con WAN e LAN verso lo stesso switch o verso due | 1, 2, 5 | I23, I68 | T3 |
| G14 | Tunnel, ponti radio e collegamenti senza fili non sono cavi: un annuncio su un tunnel, di livello 2 o 3 e anche da un capo solo, dà un tunnel; due radio sentite sulla stessa porta sono un salto radio; un uplink senza fili (mesh) è senza fili | EoIP nel bridge, WireGuard, ponte radio che si annuncia, AP in mesh | 1, 2, 5 | I29, I47, I69 | T3; il senza fili da T1 |
| G15 | Un router o un firewall che è una VM sta dentro il suo hypervisor, e i suoi annunci sono «stessa rete» | router e firewall virtuali | 1, 4 | I62 | T3 (G9 già in T1) |
| G16 | La stessa rete letta con lettori diversi dà gli stessi collegamenti, stati, fiducia e padri | la rete-campione in quattro letture | tutte | I38 | T3 |
| G17 | Nessuna regola conosce un nome scelto da un cliente o un valore tarato su un cliente: nomi inventati a caso danno gli stessi fatti, e ogni soglia ha il suo perché nel capitolo | — | 1, 2, 4 (le famiglie con nomi scelti) | I37, I58 | ogni tappa |

Anche i criteri «di non rompere» (13.3.4) valgono per ogni rete.

### 13.3.1 Caso reale: la sede 1 del cliente A, cavo per cavo

Da qui al 13.3.6 i criteri sono sui due casi reali: dicono che cosa le regole generali (13.3.0) devono dare su due
reti vere, non che cosa le regole devono imitare.

T1 = dopo la correzione rapida (una linea per coppia). T3 = alla fine (una linea per cavo, letture di T2
accese). «Misurato» = col modello vero sulla copia, scenario S2b; il resto è dedotto dalle regole sulle righe
del DB. Le righe 12-17 vengono in parte dal documento del cliente e da letture che le copie del 14/10 non hanno
(tipo delle interfacce, porte radice per istanza): **prima di T3 si riscrivono con le uscite vere di T2-a**, e
solo allora valgono come cancello (C13).

| # | Cavo | Vel. | Dopo T1 | Dopo T3: stato, fiducia, posto nell'albero |
| --- | --- | --- | --- | --- |
| 1 | router 1 `sfp-sfpplus1` ↔ core 1 porta 10 | 10G | la linea ha queste porte; core 1 figlio di router 1 (misurato) | inoltra, **certo** (lo vedono tutti e due gli apparati, con le righe del lettore della correzione rapida); principale: è la porta radice di core 1 |
| 2 | router 1 `ether1-2.5` ↔ accesso A «Port 47» | 2,5G | ridondanza, senza scritta (misurato) | **instradato, fuori dal bridge**; certo quando il router si abbina dai due capi (con S8), altrimenti probabile; ridondanza, mai principale |
| 3 | segmento della WAN: core 1 porta 15, `ether8` di router 1, `ether8` del router di riserva, più un apparato non gestito | 1G | nessuna linea da queste porte (porta 15 misurata; `ether8` dedotto: sente due apparati e nessuno lo conferma) | oggetto **«segmento: modem o switch non gestito»**; sotto `ether8` di router 1, il membro più vicino alla testa (13.15, punto 1); la porta 15 di core 1 e `ether8` del router di riserva restano membri, come ridondanze; nessuna linea router 1 – core 1, router 1 – router di riserva, core 1 – router di riserva |
| 4 | core 1 porta 9 ↔ accesso A SFP+ 2 | 10G | principale di accesso A (misurato) | certo; principale |
| 5 | core 1 porta 11 ↔ accesso B SFP+ 1 | 10G | principale (misurato) | certo; principale |
| 6 | core 1 porta 12 ↔ accesso C SFP+ 2 | 10G | principale (misurato) | certo; principale |
| 7 | accesso C SFP+ 1 ↔ core 2 porta 11 | 10G | principale di core 2 (misurato) | certo; principale (porta radice di core 2); su core 2 l'anomalia **«core che esce da uno switch di accesso»** (sul riquadro «⚠ core sotto accesso») |
| 8 | accesso A SFP+ 1 ↔ core 2 porta 9 | 10G | ridondanza, ora con la velocità (oggi non trovata) | **bloccato dallo spanning tree** (lato core 2); certo |
| 9 | accesso B SFP+ 2 ↔ core 2 porta 12 | 10G | come 8 | come 8 |
| 10 | accesso B SFP 1 ↔ accesso D SFP 1 | 1G | principale (misurato) | certo; principale |
| 11 | accesso B «Port 16» ↔ router di riserva (porta non nota: annuncia solo da una VLAN) | 1G | principale del router di riserva (misurato; oggi pende dalla porta 15 di core 1): la regola del segmento entra nella correzione rapida (13.15, punto 2) | probabile (LLDP da un capo); principale: a pari fiducia un cavo vero batte il collegamento verso il segmento |
| 12 | router 1 `ether3` ↔ radio vicina a 5 GHz ≋ radio lontana ↔ router 2 `ether3` | 1G | router 2 sotto router 1 via `ether3`, «tabella MAC» (come oggi) | radio sulla linea; salto **≋ radio** se si legge o si disegna a mano (D7); senza, router 2 «oltre ‹radio vicina›, salto non letto», dedotto (13.7.6, punto 5: oltre la radio vicina router 1 sente un solo apparato di rete, router 2) |
| 13 | router 1 ⇢ router 2, tunnel EoIP | — | assente | **tunnel**, acceso ai due capi (stato già salvato); bloccato nell'albero comune, attivo per la VLAN dell'istanza 1; probabile; ridondanza |
| 14 | router 1 `ether2` ↔ radio a 60 GHz ≋ radio ↔ router 2 `ether2` | 1G | radio vicina sotto router 1; radio lontana **seconda radice** (come oggi) | **instradato** ai due capi; salto dedotto dagli annunci; principale delle due radio, mai di router 2 |
| 15 | router 1 `ether4` ↔ (ponte a 5 GHz) ↔ router 3 `ether4` | 1G | come oggi: MNDP unico vicino su `ether4`, probabile; la riga di router 1 è del 14/10, quindi la linea è vista | «probabile, attraverso apparati non letti»; vista, perché si regge sulla riga fresca di router 1. Le righe di router 3 sono di maggio: i suoi dettagli dicono «router 3 non si legge dal 18/05». Quando router 3 si rilegge col lettore nuovo, le due radio che sente su `ether4` sono un salto radio, non un segmento (13.7.6, punto 3) |
| 16 | router 1 `ether6`, `ether7` ↔ porte di gestione delle radio a 5 GHz | 100M | attaccati (ripiego del router) | uguale |
| 17 | hypervisor 1 e 2 ↔ core 2, porte delle VM | 10G | principali (§12.5, come oggi) | uguale; gli altri membri dei bond **«riserva del bond»** se la lettura delle schede lo dice (13.5.5). I cavi verso core 1 (8 schede che i core sentono via LLDP del firmware, senza nome) compaiono solo con `lldpd` sugli host o col MAC permanente dei membri dei bond (13.5.5, da verificare) |
| 18 | router 1 ↔ core 2 | — | nessuna linea | nessuna linea: il cavo non c'è (D7; router 1 ha una sola SFP+, verso core 1, precisato il 14/10 sera) |
| 19 | core 1 ↔ core 2 | — | nessuna linea | nessuna linea; l'anomalia su core 2 lo ricorda |
| — | l'«Ignora» del 14/10 (porta 10 ↔ `ether8`) | — | non nasconde niente: «non corrisponde a nessun cavo visto» | uguale, finché Riccardo non la toglie |

L'albero atteso dopo T3, mappa automatica (⇄ = ridondanza, ⊘ = bloccato). Le parole fra parentesi e dopo «·»
sono quelle dei dettagli: sulla linea restano velocità e stato (13.10.3).

```text
router 1  (testa; radice dell'albero comune secondo il documento del cliente)
├─ sfp-sfpplus1 ═10G═ core 1 porta 10                   certo · porta radice di core 1
│   ├─ porta 9  ═10G═ accesso A    ⇄ Port 47 ← router 1 ether1-2.5 (instradato) · ⇄ SFP+ 1 ⊘ core 2
│   ├─ porta 11 ═10G═ accesso B    ⇄ SFP+ 2 ⊘ core 2
│   │   ├─ SFP 1 ─1G─ accesso D
│   │   └─ Port 16 ─1G─ router di riserva (probabile)
│   └─ porta 12 ═10G═ accesso C
│       └─ SFP+ 1 ═10G═ core 2   ⚠ core sotto accesso
│           └─ hypervisor 1, hypervisor 2 (porte delle VM)   ⇄ accesso D (riserva del bond, gestione)
├─ ether8 ─1G─ segmento della WAN «instradato»   ⇄ core 1 porta 15 · router di riserva ether8
├─ ether3 ─1G─ radio 5 GHz ≋ radio 5 GHz ─1G─ router 2       ⇄ tunnel (⊘ albero comune · VLAN dell'istanza 1 attiva)
│                     (salto letto o a mano; senza: router 2 «oltre radio 5 GHz, salto non letto»)
├─ ether2 ─1G─ radio 60 GHz ≋ radio 60 GHz  (instradato)     ⇄ radio 60 GHz ─ router 2 ether2 (instradato)
├─ ether4 ─1G─ router 3   (probabile, attraverso apparati non letti)
└─ ether6, ether7: radio di gestione (attaccati)
```

### 13.3.2 Caso reale: criteri misurabili sul cliente A

`misura-cavi` è lo script del 13.12.1, scritto per primo in T1 (pezzo T1.0). «Prima» è misurato sulle copie del
14/10 col modello vero; «dopo» è il valore che la misura della tappa deve dare, altrimenti il rilascio non parte.
I valori seguono le decisioni del 14/10 sera (13.15).

| # | Criterio | Come si misura | Prima | Dopo T1 | Dopo T3 |
| --- | --- | --- | --- | --- | --- |
| C1 | cavo 1 con le sue porte, a 10G; core 1 figlio di router 1 | `misura-cavi`, padri | nessuna linea; core 1 sotto accesso A | sì | sì, certo |
| C2 | rami che percorrono un uplink del controller al contrario, quando c'è un'altra via di pari rango | idem, «contro verso» | 1 | 0 | 0 |
| C3 | senza controller (uplink di core 1 tolto in memoria) core 1 resta sotto router 1 | scenario S3 | no | sì | sì |
| C4 | linee «cucite»: due porte piene che nessuna prova sola ha, compresa la porta riempita dalle VM | `misura-cavi`, «cucite» | 1 (2 senza la correzione del 14/10); hub 1 | 0 | 0 |
| C5 | correzioni che non corrispondono a nessun cavo, mostrate come tali | «Collegamenti ignorati» | concetto assente | 1, poi 0 quando Riccardo la toglie | 0 |
| C6 | righe del router 1 col protocollo vero e porte remote intere | Q-T1 (13.11.1): la query e il confronto con l'uscita vera salvata | 0 `lldp` su 52; 3 righe con la porta remota troncata (il confronto dà 3) | `lldp` > 0 dalla prima lettura oraria; fra le righe nuove 0 porte remote diverse da quelle che il lettore legge dall'uscita vera | uguale |
| C7 | il falso cavo fra router (revisione M-5) non torna | collegamenti fra router | router 2 via `ether3` (tabella MAC), router 3 via `ether4` (MNDP unico vicino) | uguali | nessun cavo fra router da MNDP, salvo l'unico vicino su una porta fisica, che resta «probabile, attraverso apparati non letti» e mai «certo»; mai da CDP inoltrato; ponti radio e tunnel con le loro parole (prova I51) |
| C8 | padre del router di riserva | padri | porta 15 di core 1 (la WAN) | accesso B, porta 16: la regola del segmento è in T1 (13.15, punto 2) | accesso B, porta 16 |
| C9 | velocità dei cavi 8 e 9 | `speedMbps` | non trovata | 10G | 10G |
| C10 | linee che fanno il giro (escono dal lato opposto, entrano nel proprio riquadro) | `misura-cavi`, con la funzione di 13.10.1 sulla disposizione | misurato da T1.0 sul codice di oggi | 0 | 0 |
| C11 | linee che attraversano un riquadro quando uno dei quattro candidati di 13.10.1 non lo fa | idem | misurato da T1.0 | 0 | 0 |
| C12 | elenco chiuso: spazio guadagnato dalla mappa | larghezza dell'elenco | 0 | +300 px, ricordato per chi guarda | uguale |
| C13 | una linea per cavo | sezione cavi | — | — | la tabella 13.3.1 riga per riga, con le righe 12-17 riscritte dalle uscite di T2-a; core 2 con 3 cavi, 1 attivo e 2 bloccati |
| C14 | padri di un bridge diversi dal vicino sulla sua porta radice (★ escluse) | sezione albero | — | — | 0 |
| C15 | anomalie | elenco «Anomalie della rete» | — | — | 1 (core 2); un'anomalia in più si spiega, o la regola si corregge prima del rilascio |
| C16 | radici della mappa automatica | radici | 2 (la radio lontana a 60 GHz) | 2; dopo T1b 1: la radio lontana, classificata router e senza collegamenti, va in «Da sistemare», «nessun collegamento» (G10), elencata per nome | 1: la radio torna nell'albero col salto radio |
| C17 | tempo del modello sulla copia | `misura-cavi` | circa 10 ms | ≤ 20 ms | ≤ 50 ms |
| C18 | host che cambiano categoria per i valori interi del lettore (attribuzione, 13.5.2) | classificazioni degli host toccati, sulla copia, prima e dopo | — | nessuno, oppure ognuno elencato e accettato da Riccardo | uguale |
| C19 | regole del passaggio universale entrate in T1 (13.16): testa, porte dai nomi scelti, gruppo per apparato, VM e MAC propri, velocità dei nomi doppi | `misura-cavi`, padri e testa, prima e dopo ognuna | — | la testa di ogni sede e della mappa automatica uguale a oggi; nessun altro padre cambiato, oppure ognuno spiegato (sui router del cliente A nessuna porta è «non nota»: nomi di fabbrica, VLAN e VRRP che il traduttore legge logiche, e `ether1-2.5`, fisica per la velocità in coda; dalle regole sui nomi non è atteso nessun cambio); un cambio non spiegato tiene quella regola fuori da T1, e si dice | uguale |

### 13.3.3 Caso reale: criteri sull'hub

Oggi l'albero dell'hub è giusto nella parte del controller: il criterio è non toccarlo, salvo ciò che le
decisioni chiedono e ciò che la tappa dichiara. Da H14 in poi i criteri vengono dalla lettura dei router dell'hub
(13.1, punto 18).

| # | Criterio | Tappa |
| --- | --- | --- |
| H1 | padri degli apparati del controller identici a oggi (i pareggi nuovi: 0 cambiati, misurato) | T1, T3 |
| H2 | linea router – aggregazione con le porte di un cavo solo: porta 31 ↔ `sfp28-2` | T1 |
| H3 | router – aggregazione = «fascio di 2 cavi · 2 × 25G» | T3 |
| H4 | PC e server registrati come switch: in «Da sistemare» col motivo, nessuno nell'albero | T1b, rilascio a parte subito dopo T1 (13.15, punto 3) |
| H4b | host che la classificazione automatica dice router, switch o AP e senza prove (sull'hub un telefono, un notebook e due host con «Insufficient evidence»; sul cliente A i 2 host «router»): fuori dall'albero, in «Da sistemare» col motivo; elenco per nome a Riccardo | come H4 |
| H5 | la porta 5 dello switch 48 PoE (4 apparati) non dà cavi già in T1 (la regola del segmento, 13.15, punto 2). In T3 è un segmento. Gli switch di laboratorio, che esistono solo come host e non hanno prove loro, stanno in «Da sistemare» (prima perché senza collegamenti, poi per D6) finché qualcuno non li promuove con «Ruolo nella mappa → Apparato di rete»; promossi, stanno sotto il segmento. Elenco per nome a Riccardo, solo in chat, prima del rilascio di T1 | T1, T3 |
| H6 | nessun segmento da una porta «eth0» | T1, T3 |
| H7 | nessun cavo del router da un'interfaccia logica col nome scelto a mano («VL_…»): oggi la linea fra il router e il router di frontiera viene da una VLAN («VL_… ↔ VL_…»); con la regola di T1 restano solo i due cavi veri fra loro, una linea e l'altro fra gli «Altri cavi visti» | T1 per il router dell'hub, un MikroTik letto via SSH: il suo traduttore non riconosce quel nome come porta fisica, e per le regole del router un nome non noto non è una porta fisica (13.7.1); T3 per ogni marca, col tipo dell'interfaccia letto in T2 |
| H8 | anomalie contate, ognuna spiegata; atteso 0 | T3 |
| H9 | i tre hypervisor oggi sotto lo switch di gestione (porte 1, 3, 6 a 2,5G) passano sotto l'aggregazione (porte 17, 19, 23 a 10G): la velocità trovata per chiave fa vedere a §12.5 il cavo più veloce (misurato col modello vero) | T1 |
| H10 | l'oggetto il cui unico collegamento è un access point, via LLDP sulla sua interfaccia senza fili, resta nell'albero con «≋ Wi-Fi» | T1, T3 |
| H11 | gateway del controller: l'uplink che il controller gli dà è la sua WAN (13.8.3, punto 1), quindi il collegamento è «instradato (WAN)», senza verso; accoppia porte di due cavi (10G da un capo, 25G dall'altro) e dice «porte da verificare». Il padre viene dal cavo della LAN (25G). Il cavo della WAN lo vede solo il gateway, con un nome di porta che il suo elenco non ha («ethN»): compare solo se il controller dà l'indice della porta anche per le righe del gateway (da verificare in T2.3: la fixture del repo non ha un gateway) | T3 |
| H12 | nessun access point con due linee verso lo stesso switch (porta annunciata come pezzo di MAC da un lato, «eth0» dall'altro) | T3 |
| H13 | l'hypervisor che oggi sta sotto una scheda del firewall virtuale, una sua VM, passa sotto il suo cavo dati acceso verso l'aggregazione, a 10G | T1, se entra la velocità dei nomi doppi (13.6.1: quel cavo sta su una porta che ha il nome di due porte, tutte e due a 10G); senza, in T1 va sotto la sua porta di gestione (switch 48 PoE, porta 47, 1G), e H13 arriva in T3 |
| H14 | radici della mappa automatica: 1, il router (oggi 6: il router e i cinque oggetti di rete senza collegamenti del 13.1, punto 18); i cinque in «Da sistemare» col motivo, elenco per nome a Riccardo | T1b (G10) |
| H15 | nessun oggetto sotto una sua VM: l'hypervisor oggi appeso alla scheda del firewall virtuale cambia padre (G9) | T1 |
| H16 | dopo la prima lettura del router col lettore di T1: righe `lldp` più di 0, tutte su porte fisiche; porte remote intere, con lo spazio; nessuna porta remota diversa da quella che il lettore legge dall'uscita vera salvata del router (Q-T1 neutro, 13.11.1: il lettore di prima troncava sull'hub altri nomi che sul cliente A, e il confronto coi nomi del cliente A non li vedeva). I conti esatti della lettura del 14/10 (8 righe `lldp`, 25 no) cambiano appena si spegne un apparato di laboratorio: non fanno da cancello | T1 |
| H17 | la testa resta il router, scelta perché raggiunge più nodi e fa da gateway di più reti, non perché ha l'id più basso (oggi router e gateway del controller sono pari, e vince l'id) | T1 (G8) |
| H18 | il fascio router – NAS, provato solo dal partner LACP: «fascio di 2 cavi · 2 × 5G». Che il NAS sia oggi tre nodi è un problema d'identità, fuori dal §13 | T3 |
| H19 | gli switch senza spanning tree: nessuna anomalia «uplink del controller su una porta ferma»; il loro uplink, `disabled` su una porta accesa, inoltra | T3 (G12) |
| H20 | nessun fascio dedotto fra il router e il router di frontiera (porte di bordo senza BPDU, e dal lato del router di frontiera fuori dal bridge) né fra l'aggregazione e il gateway del controller (WAN e LAN); resta dedotto il fascio fra l'aggregazione e uno switch di accesso, porte 5 e 6, tutte e due in inoltro | T3 (G11) |
| H21 | se il router di frontiera viene censito come apparato (scelta di Riccardo, 13.16): sotto l'aggregazione, porta 10, cioè sulla sua porta radice; i due cavi diretti verso il router «instradato, fuori dal bridge», ridondanze. Finché non è censito resta un host, sotto il router su un cavo vero (H7) | T3 (G13) |

### 13.3.4 Criteri di «non rompere», in ogni tappa

- **R1 — Hub.** Nessun padre cambia se non per una regola scritta nella tappa; il resoconto della misura elenca
  ogni cambio con il suo perché. La base può cambiare da sola: dal 15/10 il job `hypervisor_sync` dell'hub rilegge le
  VM ogni notte (13.1, punto 18), e una VM spenta o spostata cambia i collegamenti «dalle VM». Vale per ogni cliente
  con un job che rilegge: il resoconto dice su quale lettura delle VM è fatta la misura (la data dell'ultima
  scansione di ogni hypervisor), e «prima» e «dopo» si misurano sulla stessa copia.
- **R2 — Mappe salvate.** Nessun oggetto si perde; i ritocchi che scadono si contano e si mostrano prima del
  rilascio. Cliente A: 7 ritocchi orizzontali nella mappa passo passo della sede 1 (in verticale non contano);
  con T1, che comprende la regola del segmento, ne restano validi 4 su 7 come oggi, ma non gli stessi: tornano
  validi core 1 e la radio a 60 GHz, scadono accesso A, accesso D e il router di riserva (misurato, S2b).
- **R3 — Regole nate dagli incidenti.** Restano vere: ognuna ha la sua prova (13.12.3), e le prove girano in ogni
  tappa.
- **R4 — Integrità.** `quick_check` di tutti i tenant uguale prima e dopo (l'hub ha 4 pagine «never used» già
  note, CONTEXT §6: restano 4); prima della promozione a `main` della tappa con lo schema, su ogni appliance.
- **R5 — Letture.** L'errore di una lettura nuova non ferma il giro dell'apparato (come `[MacPorta]`, ADR 0008
  punto 12), e nemmeno un comando che non risponde: ogni comando ha un tempo massimo (13.5.1).
- **R6 — Ritorno.** Il codice della tappa prima, con i dati scritti dalla tappa nuova, dà la stessa mappa di prima.
  Per T1 si prova con le righe vecchie e nuove del router **insieme**, come staranno nel DB per 90 giorni, e nel
  **caso peggiore**: `lldp` su tutte le righe fra router, dai due lati, come succederebbe se un ponte radio o il
  tunnel lasciano passare l'LLDP. Se non regge, «Tornare indietro» (13.11.1) dice come si torna davvero.
- **R7 — Letture accese, mappa di T1 identica.** Fino all'accensione di T3 per quel cliente, la mappa a schermo non
  legge niente di ciò che scrivono le letture in più, e nemmeno l'attribuzione degli host, la cui classificazione la
  mappa legge (13.5.7, «Chi legge che cosa»): accenderle non cambia la mappa. Lo controlla la prova I33.

### 13.3.5 Rispetto alla mappa attesa del cliente A

Dei 30 controlli della mappa attesa (nel dossier del cliente A, fuori dal repo), oggi **11 sono sbagliati**, **9
sono giusti nella sostanza ma incompleti**, e uno, la testa, è giusto ma con una seconda radice. Gli altri 9 sono
giusti.

**La correzione rapida sistema:**

- core 1 sotto router 1, sul cavo a 10G fra `sfp-sfpplus1` e la porta 10 (M2);
- un solo cavo fra router 1 e core 1, nessuna linea sulla porta della WAN (M3);
- accesso A sotto core 1 (M4);
- il router di riserva sotto accesso B, porta 16 (M12), con la regola del segmento, che entra nella correzione
  rapida (13.15, punto 2);
- l'«Ignora» del 14/10 che non toglie più il cavo a 10G (M30).

Avvicina il cavo a 2,5G di router 1 verso accesso A, «secondario e mai principale» (M11): diventa una ridondanza, e
la parola «instradato» arriva alla fine.

**Il ruolo dalle prove, rilasciato a parte subito dopo, sistema:** i server Windows registrati come switch, in «Da
sistemare» e non nell'albero (M28). Con la regola «nessuna radice sola» (G10) la radio lontana a 60 GHz smette di
essere una seconda radice: sta in «Da sistemare» finché il salto radio di T3 non la mette sotto la sua radio (M1, in
parte).

**Alla fine, con una linea per cavo, si sistemano:**

- una radice sola: la radio lontana a 60 GHz non resta isolata (M1);
- core 2 con l'anomalia «core che esce da uno switch di accesso» (M7);
- i due cavi di core 2 verso accesso A e accesso B, «bloccati dallo spanning tree» (M8, M9);
- «instradato, fuori dal bridge» sul cavo a 2,5G (M11);
- il segmento della WAN sotto la porta della WAN di router 1, con la porta 15 di core 1 e la WAN del router di
  riserva come membri (M13; 13.15, punto 1);
- il ponte a 60 GHz con le due radio sulla linea (M14);
- le radio a 5 GHz sulla linea verso la sede 2 (M15), lette o disegnate a mano; senza, router 2 «oltre» la radio
  vicina;
- il tunnel fra le sedi 1 e 2, dallo stato già salvato (M17);
- i fasci di cavi della sede 3 e della sede 2 (M24, M27);
- in parte i cavi dei server verso core 1 e il cavo diretto fra i due hypervisor (M25): servono `lldpd` sugli host
  o i MAC permanenti delle schede;
- i tre cavi «dalle VM» inventati verso l'hypervisor 2 (M26): non si disegnano più, nemmeno a richiesta, se la
  misura conferma che nessun'altra lettura li vede (13.15, punto 4).

**Restano aperti**, e sono nel «Lavoro aperto» più avanti:

- la radio di gestione dal lato della sede 2, fuori dall'albero per dati vecchi (M16);
- le radio fra router 1 e router 3, che non si leggono da maggio (M18).

### 13.3.6 Rispetto alla mappa attesa dell'hub

La mappa attesa dell'hub viene dai suoi documenti e ha 28 controlli (DM1-DM28, fuori dal repo). La mappa di oggi ha
giusto lo scheletro del controller (la testa, l'aggregazione sotto la testa, switch e AP sotto l'aggregazione: DM1,
DM3-DM6) e sbaglia nei punti del 13.1, punto 18.

**La correzione rapida sistema:** le porte della linea router – aggregazione, da un cavo solo (DM2, H2); i tre
hypervisor sul cavo a 10G (DM8, H9); la linea del router da una VLAN (DM25, H7); l'hypervisor appeso alla sua VM (DM10,
H15, e H13 se entra la velocità dei nomi doppi); la testa scelta dalle prove e non dall'id (DM1, H17).

**Il ruolo dalle prove sistema:** i PC e i server registrati come switch e il firewall virtuale registrato come switch,
fuori dall'albero (DM14, DM17, H4); il telefono e il notebook classificati router (DM19, H4b); le radici sole (H14).

**Alla fine si sistemano:** i fasci (DM2, H3, H18); il gateway del controller attaccato all'aggregazione e mai padre per
la sua WAN (DM7, H11); il segmento del laboratorio (H5); gli switch senza spanning tree senza anomalie (H19).

**Restano fuori**, perché sono dati o scelte di Riccardo (13.16):

- il router di frontiera e il router virtuale sono censiti solo come host: nessuna regola può mettere il router di
  frontiera dove lo mette lo spanning tree, né scrivere «instradato» sui suoi cavi diretti verso il router (DM11,
  DM15, H21); il router nel cloud non è nel DB;
- i documenti disegnano il perimetro **per instradamento** (Internet, router di frontiera, firewall, router): è una
  vista di livello 3, che un albero di spanning tree non disegna. Nella mappa il router di frontiera sta sotto
  l'aggregazione, dove arriva la sua porta radice, e il firewall dentro il suo hypervisor (DM11);
- i due «segmenti» dei documenti (la VLAN della WAN e quella della DMZ) per la mappa sono VLAN dentro il bridge del
  router, con un cavo per membro: non sono segmenti (DM12, DM13; 13.7.3, G5);
- il laboratorio dentro o fuori dall'albero di produzione (DM18).

## 13.4 Tre domande e prove neutre per porta

### 13.4.1 Tre domande, tenute separate

| Domanda | Chi risponde davvero | Chi sembra rispondere e non lo fa |
| --- | --- | --- |
| C'è un filo fra queste due porte? | LLDP con un solo apparato sulla porta; CDP fra due apparati che lo consumano; uplink del controller; partner di un fascio; LLDP letto dall'host; il bridge designato, solo come conferma | MNDP, CDP inoltrato, tabella MAC, ARP, vicini sentiti su una VLAN |
| Il cavo porta traffico? | stato e ruolo dello spanning tree letti dall'apparato; appartenenza al bridge (fuori dal bridge = instradato); stato della porta (giù) | lo stato del router via SNMP; «blocking» su una porta giù |
| Da che parte sta la radice? | porta radice dell'albero comune; uplink del controller | l'ordine degli id, il rango della fonte, la tabella MAC |

Nessuna fonte risponde a tutte e tre, e nessuna si somma alle altre in un punteggio. Ogni parola sulla mappa
risponde a una delle tre domande.

### 13.4.2 Che cosa prova ogni fonte

| Fonte | Prova | Non prova | Trappole viste nei dati |
| --- | --- | --- | --- |
| LLDP | un cavo, se sulla porta si sente **un solo apparato** (raggruppate le righe dello stesso apparato, contati solo quelli visti di recente) | il verso; se il cavo porta traffico | un modem, uno switch muto o un ponte radio lo ripetono (porta 15 di core 1); il MikroTik annuncia anche da VLAN e VRRP; il telaio può non essere il MAC che conosciamo (controller: il «MAC + 1», che `ethernet_table` contiene su 7 switch su 12 dell'hub, 13.5.3); nelle righe lette da RouterOS il MAC è quello dell'interfaccia che ha mandato l'annuncio, non il telaio: lo stesso router compare con più MAC (sull'hub il router di frontiera con quattro); una porta ha tre nomi; una riga vecchia accanto a una nuova sembra un secondo apparato; se l'LLDP manca il cavo può esserci |
| CDP | un cavo fra due apparati che lo consumano (Cisco con Cisco: elenco chiuso nel lettore, 13.5.4) | un cavo, se uno switch in mezzo lo inoltra | RouterOS lo manda di base e gli switch non Cisco lo inoltrano: sull'hub, su un membro del fascio fra router e aggregazione, il router sente così tre apparati che stanno dietro l'aggregazione |
| MNDP | stessa rete e identità (nome, versione, scheda) | il cavo | attraversa switch, ponti radio e tunnel, anche di livello 3 (sull'hub un tunnel WireGuard, in un verso solo); vale come collegamento solo «unico vicino su una porta fisica» di un router, contando tutte le righe della porta (§11.1), «probabile» |
| Spanning tree, stato per porta | inoltra o bloccata; una porta bloccata ha comunque il cavo. BPDU ricevuti sulla porta: il vicino parla spanning tree (prova di ruolo, 13.8.2) | chi c'è dall'altra parte | «blocking», e anche «forwarding», su porte giù o spente (tre porte giù dell'hub dicono «forwarding»): ogni stato su una porta giù vale «giù»; `disabled` su una porta accesa vuol dire spanning tree spento (gli switch Flex Mini dell'hub), e la porta inoltra; dal router via SNMP stati su interfacce che non sono porte del bridge |
| Spanning tree, ruolo e bridge designato | il verso: la porta radice punta al padre | su una porta designata il bridge designato è il bridge stesso | in MSTP, visto da fuori della regione, il «bridge designato» è la **radice regionale**, non il vicino |
| MSTP | albero comune, uguale per tutte le VLAN; per istanza, quali VLAN passano dove | — | fuori dalla regione la regione è un bridge solo; dentro, una porta può bloccare in un'istanza e inoltrare in un'altra |
| Uplink del controller | cavo e verso (figlio → padre), calcolati dal controller **dall'LLDP dello stesso switch** (`uplink_source = lldp_uplink`): non è una seconda prova indipendente dall'LLDP di quello switch | che sia la porta radice | verso un padre non del controller la porta remota è vuota; un poll SNMP riscrive `is_uplink = 0` (ADR 0008 punto 4); può accoppiare porte di due cavi diversi (gateway dell'hub: 10G da un capo, 25G dall'altro); per un gateway, un apparato del controller che fa da router, è la WAN e non il cavo verso il padre: sull'hub WAN e LAN vanno allo stesso switch, e il padre torna giusto per caso |
| Partner LACP | i membri di un fascio e l'apparato dall'altra parte, abbinato coi suoi MAC; anche senza LLDP (il NAS dell'hub) | il verso | un fascio senza LACP (il bond `balance-rr` di un host verso uno switch) non ha partner: dal lato dello switch non si prova |
| Tabella MAC | la porta di bordo di un oggetto | il cavo fra apparati di rete; il verso | MAC che si spostano (VRRP, bond, migrazioni); le porte bloccate non imparano; righe vecchie dell'ARP |
| VM sulla porta | il cavo di un hypervisor (§12.5) | i cavi di riserva dei bond | migrazioni (finestra di 6 ore) |
| A mano | il voluto, non l'osservato | — | una correzione su una linea cucita toglie anche cavi giusti |

### 13.4.3 I tipi di prova

| Tipo | Che cosa dice | Chi la può dare |
| --- | --- | --- |
| **cavo** | un filo fra la porta X di A e la porta Y di B | LLDP con un solo apparato sulla porta; CDP scritto dal lettore come annuncio di collegamento (13.5.4); uplink del controller; partner di un fascio; LLDP letto dall'host |
| **senza fili** | un collegamento radio fra due apparati: un client su un access point, le due radio di un ponte | LLDP ricevuto su un'interfaccia senza fili; salto radio dedotto dagli annunci (13.7.6); a mano |
| **tunnel** | un collegamento logico fra due apparati attraverso un'altra rete: non è un filo | annuncio ricevuto su un'interfaccia tunnel da un apparato che annuncia dalla sua interfaccia tunnel; a mano |
| **segmento** | sulla porta X di A si sentono due o più apparati: in mezzo c'è un apparato che non si vede | LLDP e CDP |
| **stessa rete** | A e B si sentono, ma fra loro può esserci di tutto | MNDP, CDP inoltrato, annunci su VLAN e VRRP, ARP |
| **verso** | B sta sopra A | porta radice dello spanning tree; uplink del controller |
| **stato** | il collegamento inoltra, è bloccato (nell'albero comune o in un'istanza), è instradato, è di riserva in un bond, è giù | stato e ruolo della porta, appartenenza al bridge, stato del membro di un bond, stato della porta (`switch_ports.status`) |
| **bordo** | su questa porta di bordo c'è quell'oggetto | tabella MAC, VM sulla porta, ripiego del router (regole di `attach.ts` e `vm-ports.ts`) |
| **a mano** | aggiungi, ignora, ★, ruolo | la pagina |

### 13.4.4 I campi

T1 applica le regole dentro `links.ts`, senza il tipo, sui fatti neutri dei traduttori (13.6.1). Il tipo nasce in
T2, nella cartella `cavi/` (il «modello per cavo»), che non nomina prodotti né forme di porta di un prodotto (prova
I37): le parole di un prodotto restano nei traduttori di `src/lib/topology/lettori/`.

```ts
// src/lib/topology/cavi/prove.ts — logica pura (T2 in ombra, T3 a schermo)
export type TipoProva = "cavo" | "senza_fili" | "tunnel" | "segmento" | "stessa_rete" | "verso" | "stato" | "bordo" | "a_mano";
export type Lettore = "apparato" | "controller" | "snmp" | "host" | "persona";   // chi ha letto, mai la marca
/** Che cosa vale l'annuncio per la logica: «collegamento» non attraversa un apparato gestito, «segmento» sì. */
export type Classe = "annuncio_collegamento" | "annuncio_segmento" | "uplink" | "spanning_tree" | "fascio" | "tabella_mac" | "vm" | "a_mano";
export interface Porta {
  nodo: string; chiave: string | null; nome: string; certa: boolean;
  fisica: boolean | null; senzaFili: boolean | null; nelBridge: boolean | null;   // fatti del traduttore (13.6.1)
}
export interface Prova {
  tipo: TipoProva;
  da: Porta;                     // chi osserva, sulla sua porta
  altro: Porta | null;           // l'altro capo, se la prova lo dice
  telaio: string | null;         // l'apparato annunciato, anche se non si abbina a un nodo
  classe: Classe;
  detto: string;                 // il protocollo in parole, scritto dal traduttore («LLDP», «annuncio di rete (MNDP o CDP)»): solo per le frasi, mai per le regole
  lettore: Lettore;
  stato?: "inoltra" | "bloccata" | "instradata" | "riserva_bond" | "giu" | "spenta";
  ruolo?: "root" | "designated" | "alternate" | "backup" | "disabled";   // le parole dello standard, come le scrivono i lettori
  albero?: number;               // 0 = albero comune; n = istanza MSTP
  vlan?: number[];               // VLAN dell'istanza, se lette
  appartiene?: { bridge?: string; fascio?: string };
  visto: string | null;          // ultima lettura (UTC, come nel DB)
  frase: string;                 // in italiano: «Perché questo collegamento»
}
export function proveDaInput(input: IngressoCavi, idx: NodeIndex): Prova[];
```

`IngressoCavi` è l'ingresso del modello di T1 più ciò che solo il modello per cavo legge (13.5.7, «Chi legge che
cosa»). A schermo il ruolo `backup` diventa «bloccato», come `alternate`.

### 13.4.5 La fiducia, in parole

La fiducia è del **collegamento**: la migliore fra le sue prove; le altre restano elencate. Sta solo nei dettagli e
al passaggio del mouse, mai sulla linea: lo spessore resta la velocità e la forma resta genere e stato (§11.4).

| Fiducia | Quando | A schermo |
| --- | --- | --- |
| certo | prove dai **due capi**, concordi sulle due porte: LLDP o CDP dai due capi; LLDP dello switch più LLDP letto dall'host; partner del fascio dai due capi | «certo: lo vedono tutti e due gli apparati» |
| certo | LLDP da un capo più il bridge designato della porta radice dell'altro capo che indica lo stesso apparato, dove la trappola della radice regionale non c'è (13.8.3, punto 2) | «certo: LLDP e spanning tree indicano lo stesso vicino» |
| probabile | una prova sola: LLDP da un capo; uplink da solo; LLDP più uplink dello stesso apparato (il controller calcola l'uplink da quell'LLDP: è la stessa osservazione); MNDP «unico vicino su una porta fisica» (§11.1); tunnel annunciato dal capo remoto e acceso | «probabile: lo vede solo ‹apparato›»; «probabile, confermato dal controller» (LLDP più uplink dello stesso apparato); **solo** per MNDP unico vicino su una porta fisica: «probabile, attraverso apparati non letti» |
| dedotto | tabella MAC su una porta di bordo; VM sulla porta; ripiego del router; «oltre ‹radio›» (13.7.6) | «dedotto: ‹MAC o VM› visto sulla porta ‹porta›»; «dedotto: oltre ‹radio›, salto non letto» |
| a mano | «Collega a…»: in T1 con la verifica di oggi (`link-attrs.ts:78`, §11.3); da T3 con la verifica per cavo di 13.9, che **sostituisce §11.3, «Verifica»** | «✎ ✓» confermato dai dati, «✎ ?» non visto (§11.4) |
| stessa rete | MNDP, CDP inoltrato, annunci da VLAN e VRRP | non si disegna; nei dettagli dell'apparato, «sentiti nella stessa rete» |

Un fascio senza la prova del fascio è un **fascio dedotto** (13.6.3): «dedotto» dice l'appartenenza al fascio, non
il cavo; la fiducia del collegamento resta quella dei suoi cavi.

### 13.4.6 La frase «Perché questo collegamento»

Ogni prova produce una frase, con l'ora italiana; il dettaglio della linea le mette in fila, poi la fiducia e
«Perché è (o non è) il principale». Il titolo usa la parola del genere: «Perché questo cavo», «Perché questo
tunnel», «Perché questo ponte radio», «Perché questo fascio»; prima di T3, dove una linea è una coppia, «Perché
questo collegamento». Frasi esatte, fra «‹ ›» le parti che si riempiono:

- LLDP: «‹A› vede ‹B› via LLDP sulla porta ‹pA› (porta remota ‹pB›), letto alle ‹ora›.»
- Righe dello stesso apparato: «… e altre ‹n› righe di ‹B› dalle sue VLAN o VRRP: contate una volta sola.»
- Due capi: «‹B› vede ‹A› sulla porta ‹pB›: il cavo è confermato dai due capi.»
- Uplink: «Il controller dice che ‹A› esce dalla porta ‹pA› verso ‹B›.» Con l'LLDP dello stesso apparato: «… lo
  calcola dall'LLDP di ‹A›: è la stessa osservazione, non una seconda prova.»
- Porta dalla stessa prova: «La porta di ‹B› viene dalla stessa prova LLDP sulla porta ‹pA›.»
- Porta radice: «È la porta radice di ‹A› nell'albero comune: il suo traffico verso la radice passa di qui.»
- Bloccato: «La porta ‹pB› di ‹B› è bloccata dallo spanning tree: il cavo c'è, il traffico di ‹B› passa da ‹padre›.»
- Istanza: «Bloccato nell'albero comune, attivo per la VLAN ‹n› (istanza ‹k›).» Istanze non lette: «… può portare
  altre VLAN: le istanze non sono lette.»
- Instradato: «La porta ‹pA› di ‹A› è fuori dal bridge: cavo vero, ma instradato. ‹B› si raggiunge da ‹padre›.»
- Giù: «La porta ‹pA› di ‹A› è giù: il cavo c'era (visto l'ultima volta il ‹data›), ora non porta traffico.»
- Segmento: «Sulla porta ‹pA› ‹A› sente ‹n› apparati (‹elenco›): in mezzo c'è un apparato che non si legge (un modem,
  uno switch non gestito o un ponte radio).»
- Annuncio di rete: «‹A› sente ‹B› con ‹detto› sulla porta ‹pA›: sono nella stessa rete, ma questo non prova un
  cavo.» (‹detto› = «MNDP», «CDP inoltrato», oppure «un annuncio di rete (MNDP o CDP)» quando il lettore non sa
  quale.)
- Oltre un ponte radio: «‹B› si sente dalla porta ‹pA› oltre ‹radio›: sta oltre il ponte radio, il salto non è
  letto.» Con più apparati: «Oltre ‹radio› ci sono ‹n› apparati di rete: il salto non è letto, nessun collegamento
  dedotto.»
- Spanning tree e LLDP in disaccordo: «Lo spanning tree indica come vicino ‹X›, LLDP indica ‹Y›: in mezzo c'è
  probabilmente un apparato trasparente (ponte radio, convertitore, switch non gestito); con MSTP può anche essere
  la radice regionale.»
- Porte da verificare: «Il controller accoppia la porta ‹pA› (‹velA›) di ‹A› con la porta ‹pB› (‹velB›) di ‹B›: le
  velocità non coincidono, le porte sono di due cavi diversi.»
- Nome scelto (riga scartata, da T1b): «‹A› sente ‹B› su ‹pA›, un nome scelto a mano: non si sa se è una porta
  fisica, e una riga del router su di lei non prova un cavo.» Più nomi scelti fra gli stessi due oggetti fanno una
  frase sola: «‹A› sente ‹B› su ‹p1› e ‹p2›, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router
  su di loro non provano un cavo.», con tre o più «… su ‹p1›, ‹p2› e altre ‹n› interfacce, …» («e un'altra
  interfaccia» con tre). Verifica del 15/10: sull'hub il router sente il router di frontiera su dieci VLAN, e dieci
  frasi quasi uguali coprivano le altre (13 frasi sulla linea; con la frase unita 4).
- Uplink di un gateway (T3): «Il controller dice che ‹A› esce dalla porta ‹pA› verso ‹B›: per un gateway è la WAN,
  non la strada verso il padre. ‹A› si raggiunge da ‹padre›.»
- Tunnel sentito da un capo solo (T3): «‹A› sente ‹B› sul tunnel ‹t›, ma ‹B› non sente ‹A›: il tunnel c'è, e gli
  annunci passano in un verso solo.»
- Ripiego: «Lo spanning tree di ‹A› non è letto: scelto il cavo ‹fiducia› più veloce.» Oppure: «Scelto fra ‹n› cavi
  uguali: nessuna prova dice quale porta il traffico.»
- A mano: «Collegato a mano da ‹utente› il ‹data›; ‹confermato dai dati | non visto dai dati›.»
- Conclusione: «→ certo, principale» · «→ certo, ridondanza: bloccato» · «→ probabile, ridondanza: instradato».

In T1 i dettagli della linea hanno l'elenco **«Altri cavi visti fra questi due oggetti»**: serve all'«Ignora» per
cavo (sapere che cosa resta) e a «Scegli il cavo da ignorare…» (13.9). La frase corta «Perché questo collegamento»,
fatta con le fonti di oggi («uplink del controller», «LLDP da ‹A›», «tabella MAC»), col motivo delle righe scartate
sulla coppia («la porta 15 di core 1 sente 2 apparati: non è un cavo»), entra col ruolo dalle prove (T1b), subito
dopo la correzione rapida (13.15, punto 6). Da T3 i dettagli di un apparato hanno **«Candidati per porta»**: una
riga per porta con le prove (chi, con quale protocollo, quando), il collegamento scelto e gli apparati scartati col
motivo («sentito solo con un annuncio di rete: stessa rete»). Risponde alla domanda del 14/10: perché quella porta
e non il 10G.

A schermo non si scrive «telaio» (è la parola di LLDP): si scrive «apparato».

## 13.5 Lettori per prodotto, e dove si salva

### 13.5.1 Regole comuni a tutti i lettori

- **Sola lettura**: comandi `print` e `monitor … once`, GET sul controller, `get` e `walk` SNMP, `lldpcli show`.
- **Spenti di default (D4)** e accesi **cliente per cliente**, dopo la misura (13.5.6). Fa eccezione la parte di T1
  del lettore dei vicini del router (protocollo e valori interi, stesso comando di oggi), che D1 mette nella
  correzione rapida. D1 e D4 qui si sovrappongono, e Riccardo ha confermato il 14/10 sera: la sola correzione è
  sempre accesa, il resto è spento con le altre letture in più (13.15, «Confermato il 14/10»).
- **Un lettore legge, un traduttore traduce, la logica non sa di marche.** Il lettore scrive i fatti con le parole
  dello standard (ruoli `root`, `designated`, `alternate`, `backup`, `disabled`; stati `forwarding`, `discarding`,
  `learning`, `disabled`; tipi di interfaccia `physical`, `lag`, `vlan`, `vrrp`, `bridge`, `tunnel`, `wireless`,
  `other`). Le forme dei nomi di un prodotto (la virgola di `ether3,bridge`, la barra di `bridge/ether3`, «SFP_ 9»,
  l'espressione delle porte MikroTik) le conosce solo il **traduttore** di quel prodotto, in
  `src/lib/topology/lettori/`, che le porta in fatti neutri quando si carica l'ingresso del modello (13.6.1). La
  logica dei collegamenti (`links.ts` in T1, `cavi/` da T2) legge solo quei fatti: un prodotto nuovo aggiunge un
  traduttore, non regole nella logica. Anche la scelta di quale traduttore legge una porta sta nei traduttori
  (`haTraduttore`, `haTraduttoreRemoto` in `lettori/traduci.ts`): la logica la chiede, non la ricopia. Lo controlla la
  prova I37, su `cavi/` e sul codice di `links.ts` (verifica del 15/10: `links.ts` ricopiava la scelta del lato remoto
  con un'espressione sulla marca).
- **Un errore non ferma il giro, e nemmeno un comando che non risponde** (R5). Ogni comando ha il suo `try` e un
  **tempo massimo**: oggi il `timeout` del trasporto SSH vale solo per aprire la connessione (`readyTimeout`,
  `ssh-transport.ts:166`), e `sshExec` aspetta che il canale si chiuda (`:240-264`), quindi un `monitor` senza
  `once`, una domanda interattiva o un apparato bloccato fermano il giro per sempre, e con lui gli apparati che
  vengono dopo, perché si leggono uno alla volta (`cron/jobs.ts:675`). Il trasporto riceve un tempo massimo per
  comando, come parametro facoltativo (T2.2): allo scadere chiude il canale e dà un errore col suo codice. Lo usano i
  comandi nuovi; quelli di oggi restano senza finché non si misura la durata vera dei loro giri, perché un tempo
  troppo corto taglierebbe una lettura lunga che oggi riesce. Il resoconto del job nomina l'errore col solo codice
  (`codiceErrore`, come `mikrotik-porte.ts`), senza MAC né IP.
- **Un errore si riconosce dal testo, non dal codice d'uscita.** Sui router dell'hub un comando fallito non catturato
  scrive l'errore su stdout (`no such item (…; line 1)`), con stderr vuoto, e `ssh` esce con 0 (con 1 su uno dei
  quattro, un router virtuale). `sshExec` risolve col codice (`ssh-transport.ts:240-264`): ogni lettore nuovo
  riconosce il testo dell'errore («no such item», «bad command name», «syntax error», «expected end of command») e
  non conta sul codice (T2.2). Vale anche per i comandi di oggi, che scambiano un errore per un'uscita vuota.
- **Una cadenza propria.** Le letture in più partono al più **una volta l'ora per apparato**, qualunque job chiami
  il giro: prima di partire si guarda l'ultima lettura di quell'apparato (l'esito, 13.5.6), e un lucchetto per
  apparato, nel processo, impedisce che due giri paralleli dello stesso apparato le ripetano. Serve perché il giro
  dei router lo chiamano anche le scansioni veloci (13.1, punto 14): sull'hub, senza cadenza propria, i comandi di
  T2 partirebbero fino a 24 volte l'ora sullo stesso router, più volte nello stesso secondo.
- **I dati invecchiano, non si cancellano** (ADR 0008): ultima e prima volta vista. La potatura a 90 giorni toglie
  le righe vecchie di un apparato, **di tutte le fonti**, quando quell'apparato si riscrive (`db-tenant.ts:5047`):
  resta così, e le tabelle nuove si potano allo stesso modo (13.5.7).
- **Una connessione per i comandi nuovi.** I comandi nuovi di un apparato usano una connessione sola
  (`withSshClient`, `ssh-transport.ts:270`). Quelli di oggi restano come sono, una connessione ciascuno
  (`router-client.ts:246-252`, `mikrotik-porte.ts:115`): il router del cliente registra ogni accesso. Provato
  sull'hub il 14/10: una connessione per router, una trentina di comandi in sola lettura, circa un secondo.
- **Solo valori ammessi.** Nessun lettore scrive in `device_neighbors.protocol` un valore fuori dal vincolo (`lldp`,
  `cdp`, `mndp`, `unknown`, `db-tenant-schema.ts:785`): una riga fuori vincolo fa fallire tutto il giro di
  quell'apparato (ADR 0008, punto 9). Nessun lettore nuovo scrive `unknown`, che oggi vale come LLDP
  (`links.ts:42-46`).
- **Regole del repo**: `db-tenant` importato solo staticamente (ADR 0002), `JSON.parse` sempre in `try`, niente
  `any` né `console.log`, ogni rotta con `withTenantFromSession` e `requireAuth` o `requireAdmin` come prima
  istruzione, corpi validati con Zod.

### 13.5.2 MikroTik via SSH (ramo dei router e ramo degli switch)

| # | Comando (sola lettura) | Campi | Prova | Tappa | Dove si salva |
| --- | --- | --- | --- | --- | --- |
| MK1 | `/ip neighbor print terse`, il comando di oggi (`router-client.ts:673`) | `interface`, `discovered-by`, `identity`, `mac-address`, `address`, `interface-name` intero, `platform`; in T2 anche `system-caps-enabled` | collegamento se `lldp`; stessa rete se no | T1 per protocollo e valori interi; T2 per l'elenco intero e le capacità | `device_neighbors.protocol` (T1); `.discovered_by`, `.remote_caps` (T2) |
| MK2 | `/interface print terse`, già letto a ogni giro per la tabella del bridge (`router-client.ts:684`, `mikrotik-porte.ts:59-69`) | `name`, `type`, `mac-address`, il segno R (acceso; i segni li legge già `mikrotik-porte.ts:30-33`) | tipo dell'interfaccia, acceso o spento, tutti i MAC dell'apparato | T2, **nessun comando nuovo** | `topology_port_facts.if_kind`, `.running`; `topology_device_macs` |
| MK3 | `/interface bridge print terse without-paging` | `name`, `protocol-mode`, `priority`, `region-name`, `region-revision`, `vlan-filtering`, `mac-address` | modo dello spanning tree (stp, rstp, mstp), regione | T2 | `topology_bridge_facts` |
| MK4 | `/interface bridge port print terse without-paging` | `interface`, `bridge`, `pvid`, il segno I (porta inattiva) | porta nel bridge oppure instradata | T2 | `topology_port_facts.in_bridge`, `.bridge` |
| MK5 | `/interface bridge monitor [find] once` | `bridge-id`, `root-bridge`, `root-bridge-id`, `regional-root-bridge-id`, `root-port`, `root-path-cost`, `mst-config-digest` | verso (porta radice), radice dell'albero comune | T2 | `topology_bridge_facts`, istanza 0 |
| MK6 | `/interface bridge port monitor [find] once` | `interface`, `status`, `role`, `forwarding`, `learning`, `designated-bridge-id`, `designated-port-id`, `sending-rstp`, `edge-port`, `point-to-point-port`, `tx-rx-bpdu` | stato e ruolo per porta nell'albero comune; il vicino che manda BPDU | T2 | `topology_port_facts` |
| MK7 | solo se MK3 dice `protocol-mode=mstp` (lo decide il codice fra un comando e l'altro): `/interface bridge msti print terse without-paging` e `/interface bridge msti monitor [find] once` | `identifier`, `vlan-mapping`, `priority`; per istanza radice regionale e `root-port` | porta radice di ogni istanza | T2 | `topology_bridge_facts`, istanza n |
| MK8 | `/interface bonding print terse without-paging` e `/interface bonding monitor [find] once` | `slaves`, `mode`, `active-ports`, `lacp-partner-system-id` | fascio e partner | T2 | `topology_port_facts.lag_group`, `.lag_partner` |

**Le forme vere.** Le uscite di due reti, rese anonime, sono la forma su cui si scrivono i lettori: il router 1 del
cliente A (RouterOS 7.24.4; `/ip neighbor` in terse e in detail, incollati da Riccardo dal terminale, T1-a) e i quattro
router MikroTik dell'hub (RouterOS 7.24.2 e 7.24.5; tutti i comandi di questa tabella, letti via `ssh` senza terminale
come li legge l'app, in sola lettura, il 14/10 sera). Che cosa si è visto:

| Comando | Forma | Attenzioni |
| --- | --- | --- |
| MK1 | una riga per vicino, `chiave=valore`, chiusa da `\r\n`; i valori con spazi **senza virgolette**; un campo vuoto è `chiave=` seguito da uno spazio | il taglio sul confine « chiave=» ricostruisce i valori: sulle 65 righe dell'hub dà gli stessi valori del detail, salvo `platform` su 2 righe, dove la terse scrive un carattere di controllo come cifre, senza `\`. `interface=` ha tre forme: `porta,‹bridge›` (porta del bridge), `porta,‹fascio›,‹bridge›` (membro di un fascio nel bridge), `‹interfaccia›` (fuori dal bridge, o logica); il bridge può avere qualunque nome (`bridge`, di fabbrica, sul cliente A; uno scelto sull'hub). Incollata da un terminale, la riga va a capo alla larghezza del terminale (159 colonne sul cliente A), anche a metà parola e senza rientro: la fixture la ricompone in una riga |
| MK2 | una riga per interfaccia, con `type` e `mac-address` | è l'unico comando che dà tutti i MAC di un MikroTik; tipi visti: `ether`, `bridge`, `vlan`, `bond`, `vrf`, `loopback`, `wg`, `ovpn-out`, `l2tp-out`, `pppoe-out` |
| MK3 | una riga per bridge | priorità in esadecimale (`0x8000`; `0x0000` sulla radice dell'hub); `port-cost-mode`; senza MSTP mancano `region-name` e `region-revision`; un router senza bridge (i router virtuali) dà un'uscita vuota |
| MK4 | una riga per porta del bridge | un fascio compare come porta (`bondN`), i suoi membri no (stanno in MK8); segno `I` = porta inattiva; `pvid` |
| MK5 | **tabella a colonne**, una colonna per bridge, righe `etichetta: valore` | il bridge-id ha due forme: `0x8000.‹MAC›` e, con priorità 0, `0.‹MAC›`; senza MSTP mancano `regional-root-bridge-id` e `mst-config-digest`; `root-path-cost` c'è solo sui bridge che non sono la radice |
| MK6 | tabella a colonne, una colonna per porta | ruoli `root-port` e `designated-port`, da tradurre in `root` e `designated`; lo stato viene da `forwarding` e `learning` (`status` dice solo `in-bridge` o `inactive`); una porta inattiva ha le altre celle vuote; `tx-rx-bpdu` conta i BPDU mandati e ricevuti |
| MK7 | — | i due comandi esistono su 7.24 ed escono vuoti senza MSTP (una riga vuota, nessun errore): la forma con MSTP non è vista, e si vede in T2-a sul cliente A |
| MK8 | print: una riga per fascio; monitor: tabella a colonne | `active-ports` su più righe, senza etichetta; `lacp-partner-system-id` c'è solo se c'è un partner |
| `print detail` | `chiave="valore"`, coi valori fra virgolette | **va a capo**: via `ssh` senza terminale a 79 colonne, anche dentro un valore fra virgolette (la riga che continua un valore rientra di 7 spazi, quella che apre un campo nuovo di 4 o 5); incollato da un terminale, alla larghezza del terminale (fino a 158 colonne sul cliente A), fra un campo e l'altro. È un'impaginazione, non un formato: non regge un lettore, e serve solo a confrontare (C18, R6) dopo averne ricomposto le righe |

Note.

- **Il lettore di T1** tiene il comando di oggi, nella forma `terse`: nessun comando nuovo sui router dei clienti in
  un rilascio leggero. Un formato solo: la riga si divide sul confine « chiave=» (una chiave è `[a-z][a-z0-9-]*`), e un
  valore va dalla sua chiave alla chiave dopo, con le virgolette tolte se ci sono; il lettore di oggi si ferma
  invece al primo spazio (`router-client.ts:1081-1086`; quello delle porte, `mikrotik-porte.ts:21-27`, ha lo
  stesso limite sui valori senza virgolette). La terse è provata sulle due reti e sulle versioni viste
  (dalla 7.24.2 alla 7.24.5; prima non è provata): è il formato del lettore.
- **Il JSON.** `:put [:serialize to=json options=json.no-string-conversion [/ip/neighbor/print detail as-value]]`,
  provato sull'hub (7.24.2 e 7.24.5), dà tutti i campi, con `discovered-by` e `interface` come elenchi, il carattere
  di controllo come `\u0012` e nessun troncamento (14.075 caratteri sul router); le durate hanno un'altra forma (`age`
  vale «00:00:07»). Senza `detail` (`print as-value`) dà solo 8 chiavi, senza `discovered-by`, `interface-name`,
  `platform` né capacità: così non serve. Prima della 7.24.2 non è provato, e sul cliente A (7.24.4) non è stato
  provato: non entra in T1, e resta un'alternativa per T2, da provare in T2-a sulla RouterOS più vecchia dei clienti. L'API REST resta
  fuori (13.13.1).
- **T1-a è fatto, sul router 1, il 14/10 sera** (13.11, «Uscite vere»). Riccardo ha incollato, in sola lettura,
  `/ip neighbor print terse` (un estratto, 6 vicini) e `/ip neighbor print detail without-paging` (completo, 52
  vicini): stanno nel dossier del cliente, fuori dal repo. Lo stesso giorno sull'hub sono stati letti tutti i comandi
  della tabella (13.1, punto 18): le uscite stanno nella cartella di lavoro, fuori dal repo. Che cosa dicono, sulle
  due reti: `discovered-by` c'è **anche nel terse**, quindi il protocollo vero e lo «stesso comando di oggi»,
  confermati insieme il 14/10 sera (13.15), stanno insieme; nel terse i valori con spazi **non** hanno le virgolette
  (è la causa delle porte troncate), nel detail sì; `interface=X,‹bridge›` è una porta del bridge; un MikroTik remoto
  annuncia la porta col percorso del bridge (`‹bridge›/sfp-sfpplus1`, `‹bridge›/bond1/wlan60-1`). Le uscite diventano
  le fixture con la forma vera, rese anonime: quella del cliente A ha nomi di fabbrica e nomi scelti con un prefisso
  che il traduttore legge (VLAN e VRRP logiche, `ether1-2.5`); quella dell'hub è l'unica con un bridge e delle VLAN
  dai nomi scelti, coi membri di un fascio nel bridge (`porta,bondN,‹bridge›`) e con lo
  stesso apparato sentito con più MAC (13.12.2). Il detail del cliente A dà le righe nuove del router per C18 e per la
  prova di ritorno (R6). Le uscite di router 2 e del router di riserva sono **facoltative**: se arrivano, entrano nella
  fixture con la stessa forma.
- **Il protocollo da `discovered-by`** (`mikrotikProtocol`): se l'elenco contiene `lldp` → `lldp`; altrimenti
  `mndp`, **anche se contiene `cdp`**. Il CDP di un MikroTik passa gli switch non Cisco; scritto `cdp`
  confermerebbe un cavo (`links.ts:165`) e riporterebbe il falso cavo fra router (M-5). Valori visti: `lldp`, `cdp`,
  `mndp`, `cdp,mndp`, `cdp,lldp,mndp` (router 1 del cliente A: 5 `lldp`, 2 `cdp,lldp,mndp`, 45 `cdp,mndp`; router
  dell'hub: 8 `lldp`, 4 `cdp`, 3 `mndp`, 18 `cdp,mndp`). **La scelta «se `discovered-by` manca» è chiusa**: il
  campo c'è sulle due reti, dalla 7.24.2 alla 7.24.5. Il ripiego resta solo per RouterOS prima della 7.7, dove il campo non
  esiste: la riga resta `mndp`, come oggi, e la frase dice «protocollo non leggibile su questa versione». La colonna
  `protocol` dice quindi la **classe** della prova per il modello (`lldp`/`cdp` = annuncio che non attraversa un
  apparato gestito, `mndp` = annuncio di segmento); l'elenco vero va in `discovered_by` (T2). Sull'hub lo stesso
  vicino arriva con `cdp` su un membro di un fascio e con `mndp` sull'altro (il fascio smista gli annunci): per
  classe sono tutti e due annunci di segmento, e non contano fra gli apparati di una porta (13.7.2, passo 5). Per
  questo, da T1, a schermo una riga `mndp` scritta da un router o da SNMP non si chiama più «MNDP» ma **«annuncio
  di rete (MNDP o CDP)»** (`SOURCE_WORDS`, `edge-look.ts:115-116`, usata anche da `linked-panel.tsx:25`), finché
  `discovered_by` non dice quale.
- **Le righe vecchie restano.** Righe uguali tranne il protocollo restano una riga sola (la chiave unica non ha il
  protocollo, `db-tenant-schema.ts:792`; `ON CONFLICT` aggiorna `protocol`, `db-tenant.ts:5039-5040`). Una riga
  troncata ha un'altra porta remota, quindi un'altra chiave: resta accanto alla nuova e invecchia, e il modello
  la scarta con la regola R-superata (13.7.1).
- **Effetto fuori dalla mappa**: `upsertNeighbors` ricalcola l'attribuzione degli host toccati
  (`db-tenant.ts:5055-5064`), che usa `remote_platform` (`attribution/emitters.ts:317-324`). Con i valori interi la
  classificazione di qualche host del cliente può cambiare a ogni giro: è una scrittura indiretta su dati di
  produzione. Nella misura di T1 si contano sulla copia gli host che cambiano categoria; criterio C18: nessuno,
  oppure ognuno elencato e accettato da Riccardo prima del rilascio. Lo stesso conto si fa sulla copia dell'hub.
- **Più comandi, una connessione (T2).** Sull'hub è provata la forma dello script unico: una connessione per router,
  una trentina di comandi in circa un secondo, in una riga sola dove ogni comando sta in `:do {:local f [:parse
  "‹comando›"]; $f} on-error={:put "@@X nn"}` e le uscite sono separate da `:put "@@B nn"`. Così un comando che non
  esiste dà un errore catturato e quello prima gira, e un `[find]` vuoto non dà errore: ogni comando ha il suo
  «try». Non sono provate la riga di `exec` senza `:parse` con un comando che non esiste e le versioni prima della
  7.24. Di base MK3-MK8 restano in più `exec` sulla stessa connessione (`withSshClient`), ognuno col suo tempo
  massimo e il suo errore; MK7 parte solo se MK3 dice `mstp`. Lo script unico, nella forma con `:parse` e
  `on-error`, si usa se T2-a lo regge sulla RouterOS più vecchia fra i router dei clienti.
- **Le tabelle di `monitor`** (MK5, MK6 e il monitor di MK8) si leggono **per colonne**, dalle posizioni della riga
  dei nomi: divise sugli spazi si spostano appena una cella è vuota, come per una porta inattiva. Le righe senza
  etichetta continuano il campo sopra; una riga che manca vale «non letto». Il bridge-id si porta in una forma sola,
  priorità e MAC minuscolo, dalle due che RouterOS scrive, prima di confrontare due apparati.
- **Dove gira.** Nel ramo dei router di `runArpPoll` (`cron/jobs.ts:646`), che però lo chiamano anche le scansioni
  veloci (13.1, punto 14): da qui la cadenza propria e il lucchetto (13.5.1). Nel ramo degli switch MikroTik:
  `getMikrotikStpInfo` (`stp-ssh.ts:113-152`, chiamato da `switch-client.ts:443`) oggi parte solo
  dall'interrogazione a mano e dalla scansione in blocco (13.1, punto 7), e il giro degli switch
  (`cron/jobs.ts:903-1000`) non lo chiama: in T2 la lettura entra nel ramo degli switch MikroTik di `runArpPoll`,
  con la stessa cadenza. `stp-ssh.ts` smette di trasformare MSTP in `null` (`stp-ssh.ts:48`, `:107-108`; il tipo
  `StpInfo.protocol` riceve `"mstp"`, `snmp-stp-info.ts:18`), e passa a MK3 e MK5 coi lettori di sopra: oggi legge
  `/interface bridge print` (`:115`), che è il detail e va a capo, prende la riga sbagliata (`:35`: la priorità sta
  due righe sotto, e sui router dell'hub esce nulla) e accetta il bridge-id solo nella forma `0x…` (`:59`). I vicini
  degli switch MikroTik letti in questo ramo si scrivono con `source = 'ssh'`, una fonte nuova (13.5.7).
- **Istanze MSTP.** Lo stato per porta e per istanza non c'è secondo il documento del cliente, che parla di RouterOS 7.23;
  il router 1 è sulla 7.24.4 (uscita vera del 14/10): si riverifica in T2-a. Il ripiego
  è la porta radice di ogni istanza (MK7): quella porta è attiva nell'istanza anche se è bloccata nell'albero
  comune. Una porta di cui non si sa lo stato per istanza si scrive «stato per istanza non letto», mai «inoltra».

### 13.5.3 Controller UniFi (nessuna chiamata nuova)

Sono campi della risposta di `stat/device`. Tre si leggono già e si buttano: `local_port_idx`
(`unifi-device.ts:149`, tenuto da `unifi-map.ts:208`, buttato a `:218`), `uplink.port_idx` e `uplink_source`. Gli
altri il parser non li legge proprio (`unifi-device.ts:141-223` legge `stp_state` e `aggregated_by`, non
`stp_version`, `stp_priority`, `root_switch`, `ethernet_table`, `lag_idx`, `stp_pathcost`): T2.3 tocca anche
`unifi-device.ts`. La fixture vera del repo (`unifi-stat-device.json`) li ha. Li scrive la lettura notturna degli
apparati del controller (03:00 UTC nel DB: le 5:00 italiane fino al 25/10, poi le 4:00), dietro
`topologia.lettura.controller`.

| Campo | Prova | Dove si salva |
| --- | --- | --- |
| `lldp_table[].local_port_idx` | la porta locale per indice: «SFP_ 9» è l'indice 9 | `device_neighbors.local_port_index` |
| `lldp_table[].port_id` «Port N», quando il vicino è un apparato della stessa risposta | la porta remota per indice | `device_neighbors.remote_port_index` |
| `uplink.port_idx`, `uplink.uplink_source` | la porta di uscita senza dipendere da `is_uplink`, che un poll SNMP riscrive a 0; da dove il controller ricava l'uplink. Per un gateway del controller (un apparato che fa da router) è la porta della WAN, non quella verso il padre (13.8.3, punto 1) | `network_devices.uplink_local_port_idx`, `.uplink_source` |
| `port_table[].stp_state`, `stp_pathcost`, `lag_idx`, `aggregated_by` | stato nell'albero comune (gli switch del controller parlano RSTP); fasci. `disabled` su una porta accesa vuol dire spanning tree spento, e la porta inoltra (gli switch Flex Mini dell'hub: porta di uplink accesa, `disabled`, più di cento MAC dietro); su una porta giù lo stato non conta | `topology_port_facts` (fonte `controller`). `switch_ports.stp_state` resta com'è |
| `stp_version`, `stp_priority`, `root_switch` | modo e priorità dello spanning tree, radice vista dallo switch | `topology_bridge_facts` (fonte `controller`) |
| `ethernet_table[].mac` | tutti i MAC dell'apparato. **Misurato sul controller dell'hub (15/10):** `ethernet_table` c'è su 17 apparati su 17, e su 7 switch su 12 contiene il «MAC del controller + 1» con cui lo switch si annuncia in LLDP (S8). Per quei 7 il «+ 1» arriva come MAC letto; per gli altri 5 no, e nessuna regola lo indovina | `topology_device_macs` |

`downlink_table` (i figli visti dal padre) non si salva: l'uplink dà già i due capi con le porte.

**Verificato su un controller con un gateway (rete B, 15/10, T2.3).** La fixture del repo ha tre switch e un access
point, nessun gateway (`unifi-stat-device.json`), e il suo Flex Mini non ha `stp_state`. Sulla risposta vera di
`stat/device` del controller dell'hub (un UDM, che è anche gateway), resa anonima nella fixture nuova
`unifi-stat-device-gateway.json`:

- le righe `lldp_table` del gateway hanno `local_port_idx` (**2 su 2**). Il gateway scrive le sue porte come «ethN», un
  nome che il suo elenco non ha: il cavo si abbina per indice (H11);
- nel `port_table` ci sono i campi del partner LACP, `partner_system_id` e `lacp_state`. Il gateway non ha fasci, quindi
  la loro forma su un fascio vero non è vista: T2.3 **non li legge** (`lag_partner` manca dalle righe del controller,
  piano di T2, «Scelte» punto 8). Leggerli è un passo a parte, da fare su un controller con un fascio;
- `ethernet_table` e il «MAC + 1»: vedi la tabella sopra;
- le porte del gateway non hanno `stp_state`, `stp_pathcost` né `lag_idx`, e l'apparato ha `stp_version`,
  `stp_priority` e `root_switch` nulli: per il gateway il controller non scrive nessun bridge;
- l'uplink del gateway (`uplink_source` = `lldp_downlink`) mette insieme due cavi: `uplink.port_idx` è la porta della
  WAN (10G, `is_uplink`), `uplink_remote_port` è la porta remota del cavo della LAN (25G), che l'LLDP vede su un'altra
  porta locale. Sul cliente A (`lldp_uplink`) uplink e LLDP coincidono su tutti gli apparati. Per un gateway, quindi,
  `uplink_local_port_idx` e `uplink_remote_port` non sono i due capi di un cavo: il cavo si prende dall'LLDP per indice;
- il Flex Mini dell'hub ha `model` **`USF5P`**, non `USMINI` come nella fixture del cliente A. Lo script di P5 cercava
  `USMINI`, e la fixture nuova ha il solo gateway: il Flex Mini nella forma dell'hub manca ancora.

La corrispondenza «`ethN` = indice − 1», che sull'hub torna con le velocità, resta una deduzione e non diventa una regola
(13.13.1).

### 13.5.4 SNMP per le altre marche (Cisco, HP/Aruba, Linux e le altre)

È la via che rende vero il vincolo 4. Ma le letture Cisco e HP/Aruba della rete-campione (13.12.2) sono **dedotte
dalle MIB, non osservate**: nessuna uscita vera di quelle marche è stata vista. Prima di scrivere in un ADR che la
logica è indipendente dal prodotto serve una lettura SNMP vera, da un apparato di laboratorio o da un cliente con
altre marche.

**Dove gira.** Oggi lo spanning tree degli switch si legge solo su richiesta (13.1, punto 7), e il ramo degli switch
del giro legge solo tabella MAC e porte. SN2-SN9 sono quindi **letture nuove nel giro di ogni switch SNMP**,
otto-dieci letture in più per switch: vanno nel ramo degli switch di `runArpPoll` (`cron/jobs.ts:903-1000`), con
la cadenza propria (al più una volta l'ora per apparato) e il lucchetto, dietro `topologia.lettura.snmp`. Prima di
accenderle sull'hub si misurano la durata del giro degli switch e il numero di letture SNMP per switch, prima e
dopo. Nelle prove c'è una spia sulle richieste SNMP, come quella sui comandi SSH (I33).

| # | Che cosa | OID o correzione | Prova |
| --- | --- | --- | --- |
| SN1 | una sessione per lettura: oggi la sessione comune si chiude alla fine del primo walk e annulla gli altri otto | `query/route.ts:286-296` con `snmp-stp-info.ts:58-69`; gli altri chiamanti (`networks/bulk-scan-devices/route.ts:163-168`, `switch-client.ts:386`) si controllano con la stessa prova | — |
| SN2 | versione vera dello spanning tree | `dot1dStpVersion` 1.3.6.1.2.1.17.2.16.0, invece di dedurre «rstp» da `ieee8021d(3)` (`snmp-stp-info.ts:97`) | stato del bridge |
| SN3 | stato, bridge designato e porta designata per porta | 1.3.6.1.2.1.17.2.15.1.{3,8,9}, con la porta del bridge tradotta da 1.3.6.1.2.1.17.1.4.1.2 | stato, verso |
| SN4 | niente stato se la porta del bridge non si traduce: nella lettura nuova, niente ripiego «porta del bridge = ifIndex» | — | meglio nessuno stato che uno su `bridge` o su una VLAN |
| SN5 | LLDP completo | `lldpRemChassisId` 1.0.8802.1.1.2.1.4.1.1.5 (in `remote_mac` quando è un MAC), `PortId` …1.7, `SysName` …1.9, `SysCapEnabled` …1.12; `lldpLocPortTable` 1.0.8802.1.1.2.1.3.7.1.{3,4}; `lldpRemManAddrTable` 1.0.8802.1.1.2.1.4.2.1. La porta locale dal **secondo** pezzo dell'indice (oggi dal primo, `router-client.ts:420`); per un bridge è il numero di porta del bridge, non l'ifIndex | cavo, identità, capacità |
| SN6 | il ramo degli switch scrive i vicini: oggi `runSwitchQuery` (`query/route.ts:345`) e il ramo switch del giro non chiamano `upsertNeighbors`, e uno switch non del controller resta muto | `upsertNeighbors` anche lì, con `source = 'snmp'` (fonte nuova), `local_port_index` e `remote_caps`; **solo per gli switch senza controller**: quelli del controller hanno già i vicini dalla fonte `unifi`, e la chiave unica dei vicini non contiene la fonte (`db-tenant-schema.ts:792`), quindi due lettori della stessa riga si scambierebbero la fonte (`source = excluded.source`, `db-tenant.ts:5044`) | cavo |
| SN7 | tipo dell'interfaccia e fasci | IF-MIB `ifType` 1.3.6.1.2.1.2.2.1.3 (6 fisica, 161 fascio, 135 e 136 VLAN, 131 tunnel, 209 bridge, 71 radio), `ifPhysAddress` …2.2.1.6; membri dei fasci da `dot3adAggPortAttachedAggID` 1.2.840.10006.300.43.1.2.1.1.13 e partner LACP da `dot3adAggPortPartnerOperSystemID`, nella stessa tabella, dove risponde | fisica, logica o senza fili, dal tipo e mai dal nome; fascio e partner; MAC |
| SN8 | MSTP dove c'è (RouterOS non la elenca) | IEEE8021-MSTP-MIB: ruolo nell'albero comune 1.3.111.2.802.1.1.6.1.3.1.14; porta per istanza …6.1.4.1.{5,10,11,12} | stato per istanza |
| SN9 | CDP, come oggi (`router-client.ts:434-472`) | il lettore scrive `cdp` (annuncio di collegamento) solo se l'apparato che legge e la piattaforma annunciata sono **tutti e due Cisco** (elenco chiuso nel lettore: «cisco» nella piattaforma, senza distinguere maiuscole); in ogni altro caso `mndp` (annuncio di segmento), che a schermo è «annuncio di rete (MNDP o CDP)» | collegamento o stessa rete |

**Che cosa cambia accendendo.** SN1 corregge un difetto della lettura a mano e si corregge per tutti: il dato che
salva (`network_devices.stp_info`) la mappa non lo legge (13.1, punto 7). SN4 vale solo per la lettura nuova: il
percorso di oggi (`snmp-port-schema.ts:186-188`, che scrive `switch_ports.stp_state`, letto dalla prova di ruolo di
T1b) resta com'è finché esiste il modello di T1 (13.13.3, punto 1). Tutto il resto scrive solo nelle tabelle e
colonne nuove e nella fonte `snmp`: spento di default (D4), e acceso non cambia la mappa di T1 (13.5.7).

### 13.5.5 Hypervisor (Proxmox; VMware dopo, stesso schema)

- **VM sulla porta**: c'è già (§12.5, `vm-ports.ts`) e resta com'è, salvo «stesso cavo» (13.7.1, passo 5) e, nella
  mappa nuova, le regole decise il 14/10 sera per i collegamenti «dalle VM» (13.15, punto 4; 13.7.2, passo 10):
  uno che non è il principale del suo hypervisor e che nessun'altra lettura vede sta solo nei dettagli
  dell'hypervisor, e dove c'è `lldpd` uno su una porta che l'host non conferma si scarta.
- **`lldpd` sugli host** è la voce aperta della spec §8, decisa da Riccardo («se dovesse servire possiamo
  installarlo»). Con `lldpd` lo switch vede la scheda dell'host col suo nome, e il suo lettore (controller, SNMP,
  MikroTik) la scrive come ogni altro vicino: nessun codice in più per l'hypervisor. Supera l'alternativa scartata
  dall'ADR 0012, «Trovare i cavi dei server con l'LLDP»: era scartata perché l'LLDP della scheda manda solo un MAC
  senza nome; con `lldpd` il nome c'è, ed è la decisione di Riccardo in §8.
- **Il nodo di prova.** Lo prepara chi gestisce i nodi Proxmox dell'hub, con l'ok di Riccardo, prima di accendere
  `topologia.lettura.host` (T2): DA-IPAM non installa niente. Si misura che cosa vede lo switch su quelle porte
  (vicini LLDP della porta, dal controller) e i padri della mappa, prima e dopo. Sugli host dei clienti con
  conferma; se si generalizza, in Deploy-Appliance.
- **L'ordine col firmware delle schede.** §8 dice di spegnere l'LLDP del firmware delle Intel X710, che altrimenti
  si mangia i pacchetti di `lldpd`. **Si spegne nello stesso intervento in cui parte `lldpd`**, e lo switch deve
  vedere `lldpd` subito dopo; se non lo vede, si riaccende. Spento prima, sull'hub tre hypervisor tornano sotto lo
  switch di gestione a 2,5G: oggi il loro cavo verso l'aggregazione esiste solo grazie a quell'LLDP (13.1, punto 15;
  H9). Completa §8.
- **La lettura dal lato dell'host** (T2, dietro `topologia.lettura.host`), in `hypervisor_sync`, con **un comando a
  parte**, mai accodato a `LIVE_INTERFACES_COMMAND`: `readLiveInterfaces` dà errore se l'uscita non è 0
  (`proxmox-ssh.ts:185`), e accodato «`command -v lldpcli && …`» uscirebbe con 1 su ogni host senza `lldpcli`
  (oggi tutti), facendo perdere le schede vive; in più `parseLiveOutput` prende tutto ciò che segue il primo «---»
  come righe di velocità (`live-interfaces.ts:116-128`). Si fa così: un primo `exec` `command -v lldpcli` (uscita 1 =
  «`lldpd` non installato», non un errore), poi, in un `exec` suo, `lldpcli -f json0 show neighbors details`. Il
  suo errore va nel resoconto col codice e non tocca le schede. Prova: su un host senza `lldpcli` le schede si
  leggono come prima (I54).
- **Perché `-f json0` e `details`.** Riccardo ha scritto `lldpcli -f json show neighbors`. `json0` è lo stesso JSON
  con una struttura fissa (ogni campo è un elenco anche quando c'è un vicino solo), mentre `json` cambia forma fra
  uno e più vicini: con `json0` il parser è uno. `details` aggiunge capacità e indirizzi di gestione. Resta sola
  lettura.
- **Che cosa si scrive.** Righe in `device_neighbors` con `device_id` = l'hypervisor, porta locale = la scheda,
  `source = 'host'` (il tipo `NeighborSource`, `db-tenant.ts:4993`, riceve `"host"`; la vista «ultimo giro» vale
  per fonte, `db-tenant.ts:5012-5013`). `lldpd` riporta anche CDP, EDP, FDP e SONMP (campo «via»): **solo `LLDP`
  diventa `lldp`**, gli altri non si scrivono (il vincolo di `protocol` li rifiuterebbe, 13.5.1). Il parser si scrive
  sull'uscita vera presa dal nodo di prova (T2-b). Con lo switch che vede l'host e l'host che vede lo switch il cavo
  è **certo**, anche per i cavi di riserva dei bond che non portano VM (ADR 0012, M-2) e per il cavo diretto fra due
  hypervisor senza switch.
- **Riserva del bond.** `ip -d -j link` si legge già; in T2 si prende anche lo stato del membro
  (`linkinfo.info_slave_data.state`: attivo o di riserva) e il suo MAC permanente (`info_slave_data.perm_hwaddr`,
  da verificare sull'uscita vera), che va in `topology_device_macs`: è il MAC con cui il firmware delle schede si
  annuncia agli switch, e così i cavi verso core 1 del cliente A (8 schede che i core sentono senza nome) si
  abbinano anche senza `lldpd`. Il cavo del membro di riserva si scrive **«riserva del bond»**: non è lo spanning
  tree a fermarlo, e «bloccato» farebbe pensare a un guasto di rete che non c'è.
- **Un bond senza LACP** (`balance-rr`, come i bond di gestione degli hypervisor dell'hub secondo i loro documenti)
  non ha partner: dal lato dello switch nessuna prova del fascio lo vede. Lo dicono solo le schede dell'host (`master`
  da `ip -d -j link`): senza la lettura dell'host i suoi cavi restano cavi separati dello stesso hypervisor.
- **La posizione delle VM e la sua età.** La posizione di una VM viene dall'ultima scansione che la riporta, senza
  limite d'età (`vms.ts:217-226`). Sull'hub, fino al 15/10, le VM venivano da due scansioni a mano del 27/04 fatte da
  due nodi del cluster, e tre nodi non erano mai stati letti da soli: il job `hypervisor_sync` è nato il 14/10 (lo
  accende un amministratore da «Dati della mappa», `db-tenant.ts:9015-9019`; il primo giro di un job giornaliero è
  alle 03:00 UTC, `scheduler.ts:151`). Vale per ogni cliente: la misura di una tappa dice su quale lettura delle VM è
  fatta (R1). Se una posizione più vecchia di una soglia debba ancora creare collegamenti «dalle VM» è una scelta
  aperta (13.16): riapre il punto M-3 dell'ADR 0012, parcheggiato apposta, e la soglia può essere quella «non visto»
  (2 giorni) o quella del nome dalla scansione Proxmox (30 giorni, `model.ts:100-110`). Una VM che fa da padre al suo
  hypervisor, invece, si toglie già in T1, senza soglie (13.7.8).
- **Eccezione**: un hypervisor e le sue VM sentiti sulla stessa porta non fanno un segmento: è il cavo
  dell'hypervisor.

### 13.5.6 Gli interruttori per cliente

- In `tenant_settings` del DB del cliente (`db-tenant-schema.ts:1094-1098`; `getTenantSetting` e `setTenantSetting`,
  `db-tenant.ts:7243`, `:7250`). Valore JSON `{"acceso": true, "da": "<utente>", "il": "<UTC>"}`; chiave assente =
  **spento**.

  | Chiave | Che cosa accende | Tappa |
  | --- | --- | --- |
  | `topologia.lettura.mikrotik` | MK2-MK8 nel giro dei MikroTik (router e switch), e la parte di MK1 di T2 | T2 |
  | `topologia.lettura.controller` | il salvataggio dei campi del 13.5.3 | T2 |
  | `topologia.lettura.snmp` | SN2-SN9 (SN1 è la correzione della lettura a mano, 13.5.4) | T2 |
  | `topologia.lettura.host` | `lldpcli` e lo stato e il MAC permanente dei membri dei bond dentro `hypervisor_sync` | T2 |
  | `topologia.mappa.cavi` | il modello per cavo (13.7.2, 13.8.3) al posto di quello di T1 | T3 |

- **L'esito di ogni lettura.** A fine giro ogni lettura scrive, per apparato, la chiave
  `topologia.lettura.<x>.esito` in `tenant_settings`: JSON `{ "<id apparato>": { "il": "<UTC>", "comandi": n,
  "riusciti": m, "codice": "<codice d'errore, o null>" } }`. Serve alla cadenza propria (13.5.1) e alla riga
  «ultima lettura ed esito». I fatti salvati hanno in più il loro `seen_at`.
- In «Dati della mappa» (`src/app/(dashboard)/topology/dati/`, una scheda nuova accanto a
  `hypervisor-sync-card.tsx`) la sezione **«Letture in più per la mappa»**: una riga per lettura con che cosa legge
  (in parole e coi comandi), «spenta» oppure «accesa da ‹utente› il ‹data›», l'ultima lettura e il suo esito
  dall'esito salvato («letta in parte: 6 comandi su 8»), e il pulsante «Accendi» o «Spegni». Solo un amministratore
  la cambia: `PUT /api/topology/settings/letture` (`src/app/api/topology/settings/letture/route.ts`) con
  `requireAdmin` come prima istruzione e Zod; il censimento delle guardie (`src/lib/permessi/rotte.ts`) la vede da
  solo, perché una scrittura con `requireAdmin` è al livello atteso. Il dialogo dice che cosa succede con la
  **cadenza vera di quel cliente**. Per l'hub: «Accendere la lettura dello spanning tree sui MikroTik di questo
  cliente? Il router si legge ogni 15 minuti dalle scansioni veloci: le letture in più partono al più una volta
  l'ora, sei comandi in sola lettura su una connessione sola. La mappa non cambia finché non si accende la mappa
  nuova. Si spegne da qui.» Per il cliente A: «… Il router si legge ogni ora …».

### 13.5.7 Dove si salva: solo schema additivo

**Che cosa non si tocca.**

- `device_neighbors` **non si ricostruisce**: il CHECK su `protocol` ammette solo `lldp`, `cdp`, `mndp` e `unknown`
  (`db-tenant-schema.ts:785`), la chiave unica non contiene il protocollo (`:792`), e ricostruire una tabella con
  chiavi esterne è vietato (ADR 0008, «Alternative scartate»; CLAUDE.md del repo, regola 10). La colonna `source`
  non ha vincoli (`db-tenant-schema.ts:790`): le fonti nuove `snmp`, `host` e `ssh` si scrivono senza schema.
- `switch_ports` **non riceve colonne di spanning tree**: `upsertSwitchPorts` cancella e riscrive tutte le porte a
  ogni giro (`db-tenant.ts:4958-4964`), e due lettori si cancellerebbero a vicenda, come già succede a `is_uplink`
  (ADR 0008 punto 4).
- `getNetworkDeviceKnownMacs` (`db-tenant.ts:5091-5105`) **non cambia**: la usa anche la sincronizzazione del
  controller per decidere a quale apparato del DB corrisponde ogni apparato del controller, e quando rifiutare
  («ha MAC noti e nessuno è il nostro: non lo sovrascrivo», `unifi-sync.ts:153`, `:195-232`). Metterci i MAC dei
  lettori nuovi cambierebbe una sincronizzazione che scrive `network_devices`.

**La migrazione** (T2), gemella di `migrateTopologyOrientation` (`db-tenant.ts:410-424`) e chiamata subito dopo di
lei in fondo a `getTenantDb` (`:1703-1714`), dopo le ricostruzioni di `network_devices` (ADR 0008 punto 6). Additiva,
idempotente, in transazione, restituisce l'elenco di ciò che aggiunge. Le stesse `CREATE TABLE IF NOT EXISTS` vanno
in `db-tenant-schema.ts`; gli indici solo nella migrazione (come `migrateTopologyPhase1`, `db-tenant.ts:244-251`).
Nessun CHECK sulle colonne nuove: i valori li valida TypeScript, come `medium` (un valore nuovo non deve chiedere
una ricostruzione vietata).

```sql
-- migrateTopologyCavi(db): string[]  (T2)
ALTER TABLE device_neighbors ADD COLUMN discovered_by TEXT;        -- l'elenco letto: 'cdp,lldp,mndp'
ALTER TABLE device_neighbors ADD COLUMN local_port_index INTEGER;  -- indice della porta locale, se il lettore lo sa
ALTER TABLE device_neighbors ADD COLUMN remote_port_index INTEGER; -- indice della porta remota, se il lettore lo sa
ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT;          -- capacità annunciate attive: 'bridge,router'
ALTER TABLE network_devices  ADD COLUMN uplink_local_port_idx INTEGER;
ALTER TABLE network_devices  ADD COLUMN uplink_source TEXT;

CREATE TABLE IF NOT EXISTS topology_port_facts (       -- fatti di una porta, uno per lettore
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                  -- 'device' | 'controller' | 'snmp' | 'host'
  port_key TEXT NOT NULL,                -- 'i:<indice>' se l'indice è noto, altrimenti 'n:<nome normalizzato>'
  port_name TEXT NOT NULL,               -- com'è scritto dall'apparato
  port_index INTEGER,
  if_kind TEXT,                          -- 'physical' | 'lag' | 'vlan' | 'vrrp' | 'bridge' | 'tunnel' | 'wireless' | 'other'
  running INTEGER,                       -- 1 acceso, 0 spento, NULL non noto
  in_bridge INTEGER,                     -- 1 porta di un bridge, 0 fuori (instradata), NULL non noto
  bridge TEXT,
  lag_group TEXT, lag_partner TEXT,      -- fascio di cui è membro; partner LACP
  stp_role TEXT,                         -- albero comune: 'root' | 'designated' | 'alternate' | 'backup' | 'disabled'
  stp_state TEXT,                        -- 'forwarding' | 'discarding' | 'learning' | 'disabled'
  designated_bridge TEXT, designated_port TEXT, path_cost INTEGER,
  edge INTEGER, point_to_point INTEGER, sending_rstp INTEGER,
  bpdu_rx INTEGER,                       -- BPDU ricevuti sulla porta (MK6 tx-rx-bpdu); NULL non letto
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, port_key)
);
CREATE TABLE IF NOT EXISTS topology_bridge_facts (     -- un bridge, per istanza
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  bridge_name TEXT NOT NULL DEFAULT '',
  instance INTEGER NOT NULL DEFAULT 0,   -- 0 = albero comune; n = istanza MSTP
  protocol TEXT,                         -- 'stp' | 'rstp' | 'mstp' | 'none'
  priority INTEGER, bridge_id TEXT, root_id TEXT, regional_root_id TEXT,
  region_name TEXT, region_revision INTEGER, config_digest TEXT, vlans TEXT,
  root_port TEXT,                        -- NULL = questo bridge è la radice
  root_path_cost INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, bridge_name, instance)
);
CREATE TABLE IF NOT EXISTS topology_device_macs (      -- tutti i MAC veri di un apparato (identità)
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'device' (MK2) | 'controller' (ethernet_table) | 'snmp' (ifPhysAddress) | 'host' (perm_hwaddr)
  port_key TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, mac)
);
CREATE INDEX IF NOT EXISTS idx_topology_device_macs_mac ON topology_device_macs(mac);
```

La chiave per porta è `(device_id, source, port_key)` e non il nome: sull'hub due porte dello stesso apparato si
chiamano uguali. La fonte sta nella chiave, così due lettori dello stesso apparato non si sovrascrivono (ADR 0009
punto 4).

**Come si scrive.** `INSERT … ON CONFLICT DO UPDATE`: `seen_at` si sposta, `first_seen` resta, e le colonne che un
lettore non conosce si tengono con `COALESCE(excluded.x, x)` (come la VLAN in `mac_port_entries`, ADR 0009). Niente
`DELETE` del giro; una transazione per apparato e per lettore, e nella stessa transazione la potatura delle righe di
quell'apparato non viste da 90 giorni, come `upsertNeighbors` (`db-tenant.ts:5047`). In `upsertNeighbors`
(`db-tenant.ts:5018-5053`) le colonne nuove si scrivono con **un'istruzione a parte**, dopo quella di oggi e solo se
lo schema le ha: una migrazione non riuscita non ferma mai la scrittura dei vicini (prova I34). Le righe delle fonti
nuove **non entrano nell'attribuzione degli host**: la sua lettura dei vicini (`attribution/recompute.ts:85-93`), che
oggi prende tutte le fonti, riceve lo stesso filtro del modello di T1. L'attribuzione cambia la classificazione degli
host, e la mappa di T1 la legge (`identity.ts:52-60`): senza filtro, accendere una lettura cambierebbe la mappa, e
cambierebbe dati di produzione. Farle entrare è una scelta a parte, da misurare come C18.

**Chi legge che cosa.** È la regola che rende vero «spento vuol dire spento» e «acceso non cambia la mappa di T1»
(R7):

| Dato | Modello di T1 (a schermo finché il cliente non accende T3) | Modello per cavo (T2 in ombra, T3 a schermo) |
| --- | --- | --- |
| `device_neighbors`, colonne di oggi | sì, solo le fonti `device` e `unifi`: la query di `getTopologyModelInput` (`db-tenant.ts:9142-9144`) riceve `WHERE source IN ('device', 'unifi')` già in T1 (oggi le fonti sono solo queste due, quindi non cambia niente), così anche tornare indietro da T2 lascia la mappa com'era | sì, tutte le fonti |
| `device_neighbors.discovered_by`, `.local_port_index`, `.remote_port_index`, `.remote_caps` | no | sì |
| fonti nuove `snmp`, `host`, `ssh` | no | sì |
| `network_devices.uplink_local_port_idx`, `.uplink_source` | no | sì |
| `topology_port_facts`, `topology_bridge_facts` | no | sì, solo l'ultimo giro: `seen_at` almeno pari all'ultima lettura dello stesso apparato e della stessa fonte, meno 5 minuti, come `NEIGHBORS_LATEST_ROUND_SQL` (`db-tenant.ts:5012-5013`) |
| `topology_device_macs` | no | sì, con una query a parte nel suo ingresso (`macApparati`), mai attraverso `getNetworkDeviceKnownMacs` |
| `device_interfaces` (le schede lette dall'inventario, con i loro MAC) | no | sì, nella stessa query di `macApparati`, solo per l'identità e mai per lo stato: sull'hub sono del 23/05. Abbinano già due cavi veri che oggi restano senza nome, le schede di due hypervisor sentite dal router via l'LLDP del firmware |
| elenco delle porte | `switch_ports` (sezione nuova di T1: tutte le porte, con indice) | per un apparato del controller l'elenco del controller (fatti della fonte `controller`); per gli altri quello del loro lettore; `switch_ports` solo dove non ce n'è un altro (un'interrogazione SNMP a mano riscrive `switch_ports` di un apparato del controller fino alla lettura notturna del controller, ADR 0008 punto 4) |
| stato delle porte (`switch_ports.status`) e stato dei tunnel | non usato | sì (13.7.2 passo 8, 13.7.5) |
| vicini letti dall'attribuzione degli host (`attribution/recompute.ts:85-93`) | solo le fonti `device` e `unifi`, filtro aggiunto già in T1 (oggi non cambia niente) | — (l'attribuzione non è del modello per cavo) |

`db.ts` espone le stesse firme, se espone queste funzioni (regola 12).

**Se la migrazione non riesce.** Il tenant si apre lo stesso (ADR 0008 punti 10 e 12). All'apertura si annota se lo
schema nuovo c'è; senza, le letture in più non scrivono, il modello per cavo riceve elenchi vuoti e la mappa resta
quella di T1. Non è un ripiego muto: il resoconto del job lo dice, e «Letture in più per la mappa» scrive «non
disponibili: lo schema di questo cliente non è aggiornato».

## 13.6 Identità

### 13.6.1 Traduttori per prodotto e chiave della porta (T1, logica pura)

**Prima il traduttore, poi la chiave.** I nomi di porta arrivano nella forma del prodotto che li ha scritti. Un
**traduttore per prodotto**, in `src/lib/topology/lettori/` (logica pura, fuori da `cavi/`), li porta in fatti
neutri quando si carica l'ingresso del modello. Si calcola alla lettura, quindi in T1 non serve schema.

```ts
// src/lib/topology/lettori/traduci.ts — il solo posto dove stanno le forme dei nomi dei prodotti
export interface PortaLetta {
  nome: string;                  // il nome pulito, com'è (o come sarebbe) nell'elenco delle porte dell'apparato
  fisica: boolean | null;        // null = non noto
  senzaFili: boolean | null;
  nelBridge: boolean | null;
  fascio: string | null;         // il fascio nominato insieme alla porta
}
export interface ComeLetto {
  vendor: string | null;         // network_devices.vendor di chi osserva (lato locale)
  via: string | null;            // network_devices.protocol: la via di lettura (ssh, snmp_v2, api…)
  fonte: string;                 // device_neighbors.source
  piattaforma: string | null;    // device_neighbors.remote_platform (lato remoto)
}
export function traduciPorta(nome: string, lato: "locale" | "remoto", come: ComeLetto): PortaLetta;
```

Chi traduce: la riga della fonte `unifi` il traduttore del controller; la riga di un MikroTik letto via SSH (fonte
`device` con `vendor` mikrotik e via `ssh`, oppure fonte `ssh`) il traduttore MikroTik; le righe SNMP quello SNMP;
quelle della fonte `host` quello dell'host. Il lato remoto lo traduce il traduttore della piattaforma annunciata
(un MikroTik annuncia «bridge/ether3»). Un prodotto sconosciuto dà il nome com'è e tutti i fatti «non noto». Le
regole, elenco chiuso:

| Traduttore | Regole |
| --- | --- |
| MikroTik (`lettori/mikrotik.ts`) | Lato locale, righe di `/ip neighbor`: **il contenitore si legge dalla forma, mai dal suo nome**. `porta,‹X›` → nome `porta`, dentro X: un bridge, salvo che X sia il nome di fabbrica di un fascio (`bondN`), e allora membro di quel fascio, fuori dal bridge; `porta,‹F›,‹X›` → membro del fascio F, nel bridge X; una porta senza contenitore → fuori dal bridge. Il bridge può chiamarsi `bridge`, «BR_…» o in qualunque altro modo: sull'hub ogni riga del router finisce col nome scelto del bridge, e letta come «solo `,bridge` è nel bridge» ogni sua porta, fascio compreso, sarebbe instradata. Lato remoto annunciato da un MikroTik: `‹bridge›/ether3`, `‹bridge›/bond1/wlan60-1` → l'ultimo pezzo dopo l'ultima «/», con qualunque nome del bridge (un nome come «Gi1/0/24», annunciato da un'altra marca, resta intero). Fisica: l'espressione delle porte di oggi (`links.ts:64`, `MIKROTIK_FISICA`), spostata qui con la regola M-7 (`ether1-vlan20` non è fisica, `links.ts:57-66`; prova `links.test.ts:208`) e ristretta (verifica del 15/10, vincolo 9): dopo il nome di fabbrica solo una velocità che non si confonde con un numero di VLAN («-10g», «-2.5g», «-2.5»); un intero nudo o un numero col punto («ether1-20», «ether5-1.20») è un nome scelto, non fisico. Prima, su un'altra rete, una VLAN chiamata «ether1-20» sarebbe passata per una porta fisica e le righe del router su di lei avrebbero dato cavi (H7). `-2.5` è l'abitudine di nome del cliente A (`ether1-2.5`, la porta a 2,5G rinominata), accettata solo nella forma di una velocità; toglierla è la scelta 9 del 13.16. Sulle due copie del 14/10 la restrizione non cambia nessun nome. Logica: l'espressione di `links.ts:68` **senza** `wlan` e `wifi`, che sono senza fili. Un nome scelto dal cliente («VL_…», «BR_…») resta **non noto** finché non si legge il tipo (MK2), e per le regole del router un non noto non è una porta fisica (13.7.1). Il MAC delle righe è quello dell'interfaccia che ha mandato l'annuncio, non il telaio (13.6.4) |
| Controller UniFi (`lettori/unifi.ts`) | lato locale: «SFP_ N» → «SFP+ N» (il controller chiama così le porte SFP nella sua tabella LLDP; da T3 vale l'indice `local_port_idx`); ogni porta del `port_table` è fisica; le interfacce radio di un AP («wifi…», «ra…», «ath…», «wlan…») sono senza fili; il «local » davanti lo toglie già il lettore (`unifi-map.ts:159-163`) |
| SNMP (`lettori/snmp.ts`) | niente dal nome: fisica, logica o senza fili da `ifType` (SN7), nel bridge da `dot1dBasePortIfIndex` (SN3), solo nel modello per cavo |
| Host (`lettori/host.ts`) | da `ip -d -j link` (`linkinfo.info_kind`: bond, bridge, vlan; altrimenti fisica), solo nel modello per cavo |
| Generico (`lettori/generico.ts`) | per chi non ha un traduttore suo (un router letto via SNMP in T1, un prodotto sconosciuto): niente dal nome, tutti i fatti «non noto». Per le regole del router un non noto vale qui «non logica», come oggi (`physicalPortName`, `links.ts:75-83`): così un router di un'altra marca non perde i cavi che ha oggi. Nel modello per cavo decide il tipo letto (SNMP `ifType`) |

L'ingresso del modello di T1 riceve ciò che serve ai traduttori: la via di lettura degli apparati
(`network_devices.protocol`) e la piattaforma remota dei vicini (`device_neighbors.remote_platform`) (13.11.1, T1.3).

**La chiave.** Su `PortaLetta.nome`:

```ts
// src/lib/topology/cavi/porte.ts — logica pura, senza nomi né forme di prodotto
export interface ElencoPorte { perNome: ReadonlyMap<string, number[]>; perIndice: ReadonlyMap<number, string> }
export function chiavePorta(nodo: string, letta: PortaLetta, lato: "locale" | "remoto",
  elenco: ElencoPorte | undefined, indice?: number | null, nomiVisti?: ReadonlySet<string>): Porta;
export function stessaPorta(x: Porta, y: Porta): boolean;
```

L'elenco viene da `switch_ports` (in T1 una sezione nuova dell'ingresso con tutte le porte di ogni apparato, con
indice, nome, velocità e stato: oggi l'ingresso ha solo le porte di uplink e quelle con velocità o PoE, senza
indice, `db-tenant.ts:9145-9146`, `:9157-9159`, e una porta giù manca); nel modello per cavo con la precedenza di
13.5.7. Vince il primo passo che dà un risultato unico:

1. **Indice dato dal lettore** (`local_port_index`, `remote_port_index`, `uplink_local_port_idx`, porta SNMP
   tradotta) → `i:<indice>`. **Solo nel modello per cavo**: il modello di T1 non legge gli indici (13.5.7).
2. **Nome esatto** fra le porte dell'apparato, se una sola porta ha quel nome → `i:<indice>`. Copre le porte
   rinominate (la porta 10 e la porta 15 di core 1 hanno lo stesso nome nell'elenco e nell'LLDP).
3. **Nome uguale dopo la normalizzazione neutra**: minuscole, senza spazi. Mai togliendo «_» o «+» («SFP 1» è
   un'altra porta: la forma «SFP_» la traduce il traduttore del controller); mai l'indice ricavato dal numero del
   nome, tranne il passo 4.
4. **Solo per la porta remota**: «Port N» o «N» (l'identificativo LLDP «assegnato localmente») quando l'apparato
   remoto ha una porta d'indice N e nessuna porta con quel nome → `i:N`: 27 righe sul cliente A, 13 sull'hub.
5. **Apparato senza elenco di porte** (un router letto solo via SSH, un host, un access point) → `n:<nome
   normalizzato>`, **solo se è l'unico nome visto verso quell'apparato** fra le righe dell'ultimo giro
   (`nomiVisti`). Se ne arrivano due diversi (sull'hub due access point visti come «eth0» da una parte e con un
   pezzo di MAC dall'altra), la porta è da completare (passo 6) e i cavi si fondono: altrimenti nascerebbero due
   cavi, uno dei quali una ridondanza «⇄» che non esiste.
6. **Altrimenti, porta non nota** (`certa = false`): il nome che l'apparato non ha («eth0» dei Flex Mini e di alcuni
   AP, «ethN» del gateway del controller sull'hub) e il nome che corrisponde a più porte dello stesso apparato
   («SFP+ 15» sull'hub), finché il lettore non dà l'indice. Su una porta non nota non si contano gli apparati; la
   riga vale per l'identità e per un cavo con la porta da completare dall'altro capo.

**Fisica, logica o senza fili** lo dice il traduttore (`PortaLetta.fisica`, `.senzaFili`); nel modello per cavo,
dove la lettura c'è, il tipo letto (`if_kind`, `ifType`). Fra le righe dello stesso apparato sulla stessa porta vince
la certamente fisica: `sfp28-2` e non «VL_…» sull'hub. Nessuna regola sui nomi scelti dal cliente: un nome che il
traduttore del prodotto non riconosce resta «non noto», e per le regole del router non è una porta fisica (13.7.1;
così H7 arriva in T1 per i MikroTik); il tipo letto arriva con T2.

**La velocità** di una linea è la minima delle due porte trovate **per chiave** (oggi per nome normalizzato,
`link-attrs.ts:116-118`). Effetto misurato col modello vero: sul cliente A i cavi 8 e 9 tornano a 10G e nessun padre
cambia; **sull'hub tre hypervisor passano dallo switch di gestione (2,5G) allo switch di aggregazione (10G)**, perché
la regola del principale dell'hypervisor (§12.5) vede finalmente la velocità della porta «SFP_ N - ‹nome›» (H9).
Tre precisazioni, che valgono per ogni rete:

- **Un nome doppio con una velocità sola** (T1). Se il nome corrisponde a più porte dello stesso apparato, la porta
  resta non nota (passo 6), ma se quelle porte hanno tutte la stessa velocità la velocità si sa. Sull'hub il cavo dati
  di un hypervisor sta su una porta che ha il nome di due porte, tutte e due a 10G: senza questa regola, tolto il
  collegamento «dalle VM» (13.7.8), l'hypervisor va sotto la sua porta di gestione a 1G (H13). Ragionato e non
  misurato: entra in T1 se la misura sulle due copie non cambia altri padri, o se ogni cambio si spiega (C19).
- **In T1 un fascio ha la velocità di un membro** (25G per il fascio router – aggregazione dell'hub): una linea è
  una coppia, con le porte di un cavo. La somma dei membri arriva col fascio, in T3 (13.6.3).
- **Le etichette scritte a mano sulle porte** («SFP+ 10 - ‹etichetta›») passano per nome solo perché il controller le
  ripete uguali nel suo LLDP, anche quando sono scritte male (sull'hub una ha due spazi): il nome resta un ripiego, e
  l'indice (`local_port_idx`, T2) è la via sicura.

**Velocità diverse ai due capi** (T3). Se i due capi di una prova, tutti e due accesi, hanno velocità diverse, la
prova accoppia porte di due cavi diversi: non dà le porte, e il collegamento resta con «porte da verificare». Sull'hub
è 1 caso su 74 cavi con le due velocità note: l'uplink del gateway del controller accoppia una sua porta a 10G con
una porta a 25G dell'aggregazione (H11).

### 13.6.2 Interfacce logiche, senza fili, e porta fisica

- **Dal lato di chi osserva: da un'interfaccia logica locale non nasce mai un cavo** (VLAN, VRRP, bridge, tunnel).
  Completa §11.1: la regola chiede già una porta fisica per il vicino «diretto», ma oggi una riga su
  un'interfaccia logica passa lo stesso appena la coppia è confermata (`links.ts:178-181`). Il tunnel è un
  collegamento di genere tunnel, non un cavo (13.7.5). Lo stesso vale per un nome che il traduttore del prodotto non
  sa essere una porta fisica, cioè un nome scelto dal cliente (13.6.1, 13.7.1): la porta fisica si decide dalla forma
  della riga o dal tipo dell'interfaccia letto, mai dal nome. Un RouterOS che annuncia da ogni interfaccia
  (`discover-interface-list` = `all`) si fa sentire anche dalle VLAN: sull'hub il router sente il router di frontiera
  su dieci VLAN.
- **Un'interfaccia senza fili non è logica.** Una riga LLDP su un'interfaccia senza fili, con un solo apparato, dà
  un collegamento **senza fili** («≋ Wi-Fi», 13.10.3), con le regole di una porta fisica (un apparato solo; per un
  router, la conferma). Sull'hub è l'unico collegamento di un oggetto, un client di un access point (H10): con
  l'espressione di oggi (`links.ts:68`, che comprende `wlan` e `wifi`) uscirebbe dall'albero già in T1.
- **Dal lato remoto**, le righe dello stesso apparato sulla stessa porta locale sono una prova sola. La porta remota
  è quella fisica fra le righe; se nessuna è fisica, «porta non nota (annuncia da una VLAN)», come il router di
  riserva sulla porta 16 di accesso B. Il gruppo si abbina col telaio, poi col nome; **per IP solo con la riga che
  ha la porta remota fisica**: le righe VLAN e VRRP non si abbinano per IP, perché il loro IP è quello
  dell'interfaccia virtuale, ma per telaio e per nome sì. Presa alla lettera «le righe VLAN non si abbinano», si
  perderebbero il salto a 60 GHz (la radio lontana annuncia da `bridge/bond1/wlan60-1`) e la prova LLDP del router
  di riserva. T1 lo fa per i gruppi; l'ordine generale dell'abbinamento cambia in T3 (13.6.4).
- **Il router che si sente da sé** (router 1 su `ether1-2.5` e su `sfp-sfpplus1`) non è un apparato in più sulla
  porta: è una diagnosi, scritta nei dettagli della porta («due porte di router 1 stanno nello stesso dominio di
  livello 2»). Succede anche sull'hub (il router di frontiera si sente attraverso la VLAN della WAN, il router nel
  cloud fra due sue porte). Lo si riconosce coi MAC propri dell'apparato (tutti, da MK2, in T2) o col nome annunciato
  quando identifica (13.6.4); il nome in inventario può essere diverso dall'identità che l'apparato annuncia.

### 13.6.3 Fasci di cavi

- **Prove di appartenenza**: MikroTik `/interface bonding` (MK8) e l'interfaccia dei vicini che nomina il fascio
  (`sfp28-1,bond1,…`, letta dal traduttore dalla forma della riga); controller `lag_idx` e `aggregated_by`; IF-MIB
  `ifType` 161 e LAG-MIB; Linux `master` da `ip -d -j link`. Il **partner LACP** (MK8 `lacp-partner-system-id`,
  LAG-MIB `dot3adAggPortPartnerOperSystemID`, `ad_info` di un bond Linux) prova anche l'apparato dall'altra parte,
  abbinato coi suoi MAC: sull'hub è l'unica prova del fascio verso un NAS che non manda LLDP (H18). Un fascio senza
  LACP (`balance-rr`) non ha partner (13.5.5).
- **Un fascio è una linea sola**, «fascio di N cavi · N × velocità», con i membri elencati porta per porta nei
  dettagli. La velocità è la somma dei membri accesi; lo stato è quello del fascio, perché lo spanning tree lo vede
  come una porta sola (in MK4 il fascio compare come porta, `bondN`, e i membri no); un membro giù: «fascio di 2 cavi,
  1 giù». In T1, dove una linea è una coppia, la linea ha le porte di un cavo e la velocità di un membro (H2); la
  somma arriva qui. Lo stesso vicino può arrivare con CDP su un membro e con MNDP sull'altro (sull'hub il fascio
  smista così gli annunci): le righe si uniscono per apparato e per fascio.
- **Senza la prova del fascio** (letture spente): due cavi in parallelo fra gli stessi due switch, tutti e due in
  inoltro e **con lo spanning tree attivo fra loro** (porte che non sono di bordo e ricevono BPDU; per il controller,
  uno stato diverso da `disabled` ai due capi), sono un **fascio dedotto** («fascio dedotto: due cavi in inoltro fra
  gli stessi apparati»), non due ridondanze: se non fossero un fascio lo spanning tree ne bloccherebbe uno. Senza lo
  spanning tree fra i due la deduzione non regge, e sono due linee: porte di bordo, una porta instradata, WAN e LAN di
  un gateway. Sull'hub non sono fasci i due cavi diretti fra il router e il router di frontiera (porte di bordo senza
  BPDU dal lato del router, fuori dal bridge dall'altro) né i due cavi fra l'aggregazione e il gateway del controller;
  resta dedotto il fascio fra l'aggregazione e uno switch di accesso, porte 5 e 6 (H20). «Dedotto» dice
  l'appartenenza; la fiducia del collegamento resta quella dei suoi cavi. La deduzione vale per ogni marca.
- Due cavi verso lo stesso apparato fuori da un fascio (dati e gestione di una radio) sono due linee.

### 13.6.4 Apparati

- **Telaio** = il MAC del telaio LLDP (`remote_mac`; via SNMP `lldpRemChassisId` quando è un MAC, SN5), **solo per le
  fonti che danno il telaio**: il controller e SNMP. Nelle righe lette da RouterOS (`/ip neighbor`) il MAC è quello
  dell'interfaccia che ha mandato l'annuncio: sull'hub, nelle righe del router, il router di frontiera compare con
  quattro MAC; nelle righe del router di frontiera il router compare con due MAC sulla stessa porta (uno dalla porta,
  uno da una VLAN); il controller vede il router con un solo telaio. Lo dice il traduttore (13.6.1).
- **Apparati di una porta, contati per apparato** (T1; 13.7.1, passo 2). Si conta il nodo abbinato; una riga che non
  si abbina conta col suo telaio, ma per le righe di RouterOS col **nome annunciato**, quando identifica: le regole dei
  nomi che ci sono già (`identifiesByName`, `identity.ts:29-32`: niente nomi di fabbrica come «MikroTik», niente nomi
  corti o solo esadecimali), i MAC virtuali che non identificano (`identity.ts:9-13`), e due gruppi con MAC veri di
  OUI diversi che restano due (`node-index.ts:171-177`). Se il nome non identifica, conta il MAC, come prima. Contato
  per MAC, lo stesso router sentito con due MAC sulla stessa porta fa un segmento falso e toglie un cavo provato:
  sull'hub succederebbe su uno dei due cavi diretti fra il router e il router di frontiera, appena questo fosse censito
  e letto.
  Sul cliente A non cambia niente: su ogni porta fisica di router 1 i nomi distinti sono tanti quanti i MAC (verifica
  del 15/10). In T2 tutti i MAC di un MikroTik (MK2) abbinano le sue righe senza bisogno del nome.
- **MAC noti di un apparato**: oggi quelli dell'host collegato, dell'host con lo stesso IP e dell'identità fisica
  (`getNetworkDeviceKnownMacs`, `db-tenant.ts:5091-5105`). Nel modello per cavo anche `topology_device_macs`
  (MikroTik MK2, controller `ethernet_table`, SNMP `ifPhysAddress`, MAC permanenti dei membri dei bond) e le schede
  di `device_interfaces`, lette con una query a parte nel suo ingresso: `getNetworkDeviceKnownMacs` non cambia
  (13.5.7). Coi MAC noti si abbina anche il partner LACP di un fascio. Così si riconoscono le porte del
  router con un MAC loro e, dove `ethernet_table` lo contiene (sull'hub 7 switch su 12, 13.5.3), gli switch del controller che si
  annunciano col «MAC del controller + 1». Nessuna regola «MAC + 1» indovinata: un MAC vicino può essere di un altro
  apparato.
- **Nome LLDP diverso da quello in inventario** (accesso A si annuncia senza spazi): si abbina per MAC del telaio.
  Nessuna regola sui nomi «compattati».
- I MAC virtuali (VRRP, HSRP) non identificano nessuno (`identity.ts:9-13`): resta.
- **Sostituisce §3** («abbinati per IP, poi per MAC del vicino, poi per nome»): da T3, per una riga LLDP prima il
  telaio, poi il nome, poi l'IP, e l'IP solo dalle righe con una porta remota fisica. Oggi `node-index.ts:275-292`
  prova l'IP per primo, e una riga VRRP finisce sul nodo sbagliato. È un cambio d'identità per tutte le righe: si
  misura sulle due copie prima del rilascio (collegamenti fra apparati, vicini non abbinati, attaccati), e i numeri
  di `model-fixtures.test.ts:69-72` e `:150-153` si riscrivono col perché.

## 13.7 Costruzione dei collegamenti

### 13.7.1 T1: una linea per coppia, con le porte di una prova sola

In `links.ts`, sui fatti dei traduttori (13.6.1). La firma di `buildLinks` resta (ingresso del modello, indice dei
nodi); cambiano l'ingresso, che riceve l'elenco intero delle porte e i campi per i traduttori (T1.3), e `ignored`,
che diventa un insieme di regole per cavo (13.9) e cambia tipo anche dove lo usano `attach.ts:48` e `vm-ports.ts:52`.
Passi, in ordine:

0. **R-superata.** Per (apparato, fonte, porta locale, apparato remoto) contano solo le righe dell'ultimo giro di quel
   gruppo: dal `timestamp` più recente del gruppo meno 5 minuti, la misura di `NEIGHBORS_LATEST_ROUND_SQL`
   (`db-tenant.ts:5012-5013`, che è per apparato e fonte). La fonte sta nel gruppo: la riga della lettura notturna del
   controller non è superata da quella di un altro lettore dello stesso switch con un altro nome di porta remota.
   L'apparato remoto è il telaio; per le righe senza MAC del telaio (l'LLDP via SNMP di oggi,
   `router-client.ts:424-429`) è il nome remoto. Una riga troncata («Port») è superata dalla riga nuova («Port 47»)
   dello stesso apparato sulla stessa porta. Un vicino sparito del tutto **non** è superato: invecchia e diventa
   «non visto» (ADR 0008).
1. **Porta locale**: la chiave (13.6.1), sul nome tradotto. Da una porta locale logica nessun cavo (13.6.2);
   un'interfaccia senza fili non è logica. **Per un router letto col traduttore del suo prodotto** (oggi un MikroTik
   via SSH) una porta di cui il traduttore non sa dire se è fisica (`fisica: null`: un nome scelto dal cliente,
   «VL_…») non è una porta fisica: non dà cavi dalle righe del router, né come unico vicino né confermata (3c), e
   non si conta al passo 2. Col traduttore generico vale «non logica», come oggi, così un router di un'altra marca non
   perde i cavi che ha. È H7 anticipato per i MikroTik: sul cliente A non cambia niente, perché le porte dei suoi
   router non hanno porte «non note»: nomi di fabbrica, VLAN e VRRP logiche, `ether1-2.5` fisica per la velocità in
   coda (verifica del 15/10).
2. **Apparati per porta**: per (apparato, porta locale nota e fisica) l'insieme degli apparati sentiti **con un annuncio
   di collegamento** (LLDP, o CDP scritto come tale dal lettore: 13.5.2, 13.5.4) **entro la soglia «non visto» dalla
   lettura più recente dello stesso apparato e della stessa fonte** (`topology_link_stale_days`, 2 giorni), contati
   **per apparato** (13.6.4: il nodo abbinato, con le righe VLAN e VRRP che non si abbinano per IP; altrimenti il
   telaio, o per le righe di RouterOS il nome annunciato quando identifica) e senza sé stesso. Senza
   la finestra, dopo un ricablaggio la porta sentirebbe per 90 giorni il vicino vecchio e quello nuovo, e diventerebbe
   di segmento togliendo il cavo vero (prova I43). Un hypervisor e le sue VM contano come un apparato solo; su una
   porta non nota non si conta. **Due o più → porta di segmento**: nessuna riga su quella porta diventa un cavo,
   presta una porta o conferma un cavo (la regola del segmento, decisa in T1: 13.15, punto 2). In T1 il segmento non
   si disegna; le righe restano per l'identità e per il «non visto». Un oggetto che la porta sente e che per questa
   regola resta senza collegamenti va in «Da sistemare», col motivo «nessun collegamento» (H5): prima della revisione
   del piano (15/10) restava una radice sola della mappa automatica.
3. **Candidati**, come oggi (`links.ts:116-184`), con tre cambi.
   - a. **Completare l'uplink.** Se il controller non sa la porta del padre (`links.ts:137`), la porta si prende
     dalla riga LLDP che il figlio ha **sulla sua porta di uplink, verso lo stesso nodo**: mai da un'altra porta,
     mai da una porta di segmento, mai da MNDP. Se quella riga non c'è, la porta del padre resta vuota invece di
     prendere la prima riga in ordine (`links.ts:97-100`).
   - b. **Raggruppare per apparato** le righe sulla stessa porta locale (13.6.2), per telaio, **prima** di abbinarle;
     per le righe di RouterOS, dove il MAC è dell'interfaccia, il gruppo si completa col nome annunciato quando
     identifica (13.6.4).
   - c. **Conferma per porta** (completa §11.1). Una riga del router sulla sua porta fisica P verso B è candidata se
     B è l'unico vicino su P (diretto), oppure se B vede il router via LLDP, CDP o uplink del controller **su una sua
     porta con un solo apparato e con porta remota uguale a P**. MNDP non conferma mai (M-5, resta). Oggi la
     conferma è per coppia (`links.ts:162-167`): così la riga su `ether8` passava perché core 1 vede il router…
     sulla porta 10. In T1 «unico vicino» si conta **su tutte le righe della porta, MNDP compreso, come oggi**
     (`links.ts:170-180`): contare solo LLDP e CDP, come fa il modello per cavo (13.7.2, passo 5), chiuderebbe al
     ripiego la porta `ether3` di router 1 appena la riga della radio vicina diventa `lldp`, e router 2, che oggi vi
     è appeso dalla tabella MAC, perderebbe il suo posto: la regola «oltre» che lo riaggancia (13.7.6, punto 5) c'è
     solo nel modello per cavo.
4. **«Ignora» per cavo** (D3; 13.9).
5. **Fusione per coppia** (`links.ts:186-199`) con le due porte da **un candidato solo**: il migliore per rango fra
   quelli che le hanno tutte e due; se nessuno, il migliore con una. `sources` e `lastSeen` raccolgono solo i
   candidati dello stesso cavo (stesse porte, o porta vuota compatibile); gli altri candidati della coppia
   diventano «Altri cavi visti fra questi due oggetti» nei dettagli. Lo stesso vale per le VM (`vm-ports.ts:118-144`):
   su una coppia che ha già una linea, una prova dalle VM su una porta diversa da quella della linea è un altro cavo
   visto, non riempie la porta vuota e non rinfresca fonti e «visto» (oggi lo fa, `:135`, `:142`); C4 la conta.
   Una prova dalle VM non fa mai di una VM il padre del suo hypervisor, e i MAC propri dell'apparato che osserva non
   sono VM sulla sua porta né suoi client (13.7.8).
   **Sostituisce ADR 0008 punto 11** («le porte vengono dalla fonte di rango più alto, a parità dalla prima
   arrivata»).
6. **Velocità per chiave** (13.6.1), compreso il nome doppio con una velocità sola.

Sulla coppia router 1 – core 1: l'uplink si completa con `sfp-sfpplus1` (3a); la porta 15 di core 1 è di segmento
(2); la riga del router su `ether8` non è confermata su `ether8` (3c). La linea è `sfp-sfpplus1` ↔ porta 10, a 10G.

**Quattro trappole per chi scrive il codice** (viste dalle verifiche sui dati):

- raggruppando le righe per **nodo abbinato con l'abbinamento di oggi** (l'IP per primo) invece che per **telaio**, la
  riga VRRP della porta 10 di core 1, che oggi si abbina per IP a un altro nodo, conta come secondo apparato: la porta
  10 diventa di segmento e il cavo 1 perde la porta del router. Il nodo conta solo dopo l'abbinamento del passo 3b,
  dove le righe VLAN e VRRP non si abbinano per IP (I15);
- una riga del router su un nome scelto dal cliente («VL_…»), dove l'altro router è l'unico vicino, passa la regola
  «unico vicino» se un nome non noto vale come porta fisica: è la linea di oggi fra il router dell'hub e il router di
  frontiera, tracciata da una VLAN (13.1, punto 18). Per un router col traduttore del suo prodotto «porta fisica» vuol
  dire `fisica: true` nella conferma (3c), nell'unico vicino e nel conteggio del passo 2, come nel ripiego qui sotto;
- le regole di bordo di `attach.ts` confrontano i nomi normalizzati delle porte (`attach.ts:50-56`): devono ricevere
  il nome tradotto (`ether4`), non quello grezzo (`ether4,bridge`), altrimenti la porta del router non risulta
  occupata e nasce un ripiego che oggi non c'è;
- il ripiego del router (§11.1 bis) vuole una porta fisica: per un router col traduttore del suo prodotto (MikroTik
  letto via SSH) vale solo `fisica: true`, perché un nome che il traduttore non riconosce («VL_…», `fisica: null`)
  non è una porta del bridge host; col traduttore generico vale ancora «non logica», come prima. Senza questa regola,
  sull'hub il ripiego appendeva un hypervisor al router da una VLAN col nome scelto (verifica del piano, 15/10).

### 13.7.2 T3: una linea per collegamento

```ts
// src/lib/topology/cavi/collegamenti.ts — logica pura (T2 in ombra, T3 a schermo)
export type Genere = "cavo" | "fascio" | "tunnel" | "radio" | "senza_fili" | "segmento";   // segmento = appartenenza
export type StatoCollegamento = "inoltra" | "bloccato" | "bloccato_comune" | "instradato" | "riserva_bond" | "giu" | null;
export interface Collegamento {
  id: string;                      // il genere più i due capi ordinati con la chiave della porta: "cavo:…", "tunnel:…"
  a: Porta; b: Porta;              // per il genere «segmento», b è il segmento
  genere: Genere;
  membri?: Array<{ a: Porta; b: Porta; stato: StatoCollegamento }>;   // fascio
  stato: StatoCollegamento;
  attivoPerVlan?: number[];        // bloccato nell'albero comune, attivo in un'istanza
  fiducia: "certo" | "probabile" | "dedotto" | "a_mano_confermato" | "a_mano";
  verso: string | null;            // il figlio, se una prova di verso lo dice
  velocitaMbps: number | null;
  porteDaVerificare: boolean;      // la prova accoppia porte con velocità diverse (13.6.1)
  prove: Prova[]; frasi: string[];
}
export interface Segmento { id: string; membri: Porta[]; altriApparati: number; frase: string }
/** Fatti già filtrati all'ultimo giro (13.5.7): le righe di topology_port_facts e topology_bridge_facts. */
export interface ContestoCavi {
  nowMs: number; staleDays: number;
  porte: ReadonlyMap<string, ElencoPorte>;                     // nodo → elenco, con la precedenza di 13.5.7
  fattiPorta: readonly FattoPorta[];
  fattiBridge: readonly FattoBridge[];
  statoPorte: ReadonlyMap<string, "su" | "giu" | "spenta">;    // nodo|chiave → da switch_ports.status
  macApparati: ReadonlyMap<string, ReadonlySet<string>>;       // nodo → MAC da topology_device_macs
}
export function costruisciCollegamenti(prove: readonly Prova[], correzioni: readonly LinkOverrideRow[], ctx: ContestoCavi):
  { collegamenti: Collegamento[]; segmenti: Segmento[]; stessaRete: Prova[]; correzioniOrfane: number[] };
```

Passi:

1. Prove per porta (`proveDaInput`), con i passi 0-2 di T1 (finestra «non visto» compresa).
2. Una porta con un apparato → collegamento candidato; con due o più → segmento (13.7.3), salvo che gli apparati
   siano le due radio di un ponte (13.7.6, punto 3); una porta non nota → candidato con la porta da completare
   dall'altro capo, se fra i due apparati c'è un solo collegamento che combacia.
3. **Conferma dai due capi**: A:pA → B e B:pB → A sono un cavo solo, **certo** («lo vedono tutti e due gli
   apparati»). Da un capo solo è **probabile**; diventa certo con un bridge designato coerente sulla porta radice
   dell'altro capo («LLDP e spanning tree indicano lo stesso vicino»). L'uplink del controller dello stesso apparato
   non lo rende certo: il controller lo calcola da quell'LLDP («probabile, confermato dal controller»). Sui dati
   cambia la parola su 3 cavi del cliente A e 1 dell'hub, non l'albero.
4. **Uplink del controller**: prova di verso sul collegamento della porta di uplink del figlio; la porta del padre
   come in T1 (3a); se la porta di uplink dà su un segmento, l'uplink va al segmento. Se le porte che accoppia hanno
   velocità diverse (13.6.1), l'uplink dà solo il verso, non le porte.
5. **Regola dei router** (§11.1 e M-5), per porta. Una riga LLDP o CDP del router sulla sua porta fisica P è un cavo
   se su P c'è **un solo apparato sentito con un annuncio di collegamento**, contato per apparato (13.6.4). Le righe
   di classe MNDP non contano: attraversano switch, radio e tunnel, e fra loro c'è il CDP che vede un MikroTik, che
   il lettore scrive `mndp` (13.5.2). Contato dal protocollo grezzo, sull'hub un membro del fascio fra router e
   aggregazione sentirebbe quattro apparati (l'aggregazione via LLDP e tre apparati dietro di lei via CDP) e
   diventerebbe un segmento falso. Altrimenti è un cavo se l'altro capo la conferma come in T1 (3c). MNDP non
   conferma mai, e dà un collegamento solo come «unico vicino su una porta fisica» **contando tutte le righe della
   porta** (§11.1, come oggi): resta probabile,
   «attraverso apparati non letti», mai certo (senza, router 3 perde l'aggancio di oggi). Una riga del router con la
   porta locale non nota (un nome che il router non ha, come `ethN` del gateway dell'hub) non si scarta: vale come
   cavo con la porta da completare dall'altro capo, e solo se l'altro capo lo conferma.
6. **CDP** vale come LLDP quando il lettore l'ha scritto come annuncio di collegamento (13.5.2, 13.5.4): la logica
   non sa di marche.
7. Fasci (13.6.3), segmenti (13.7.3), instradati (13.7.4), tunnel (13.7.5), ponti radio (13.7.6), senza fili
   (13.6.2).
8. **Stato dai due capi**, nell'albero comune:
   - **giù** se una delle due porte è giù o spenta (`switch_ports.status`; da T2 anche `running`); ogni stato dello
     spanning tree su una porta giù o spenta vale «giù»: «blocking», ma anche «forwarding», che sull'hub hanno tre
     porte giù (I25, I67);
   - **bloccato** se un capo è `discarding` o ha ruolo `alternate` o `backup`, su una porta accesa: il cavo esiste.
     `disabled` su una porta accesa non è un blocco: vuol dire che lo spanning tree è spento (gli switch Flex Mini
     dell'hub), e la porta inoltra (I67);
   - **bloccato nell'albero comune, attivo per la VLAN ‹n›** se il collegamento è bloccato nell'albero comune, i due
     capi sono bridge della stessa regione MSTP (stesso nome, revisione e `config_digest`) e il collegamento è la
     porta radice di un'istanza su uno dei due capi: è attivo per le VLAN di quell'istanza;
   - **instradato** se un capo è fuori dal bridge (13.7.4);
   - **riserva del bond** se il capo di un host è il membro di riserva di un bond (13.5.5);
   - **inoltra** altrimenti. Lo stato SNMP del router vale solo dove la porta del bridge è tradotta (SN4).
9. Correzioni (13.9).
10. **Bordo**: tabella MAC, VM sulla porta e ripiego del router restano le regole di `attach.ts` e `vm-ports.ts`,
    ma per porta: una porta capo di un collegamento non è di bordo, salvo il caso «oltre» (13.7.6, punto 5).
    **Collegamenti «dalle VM»** (13.15, punto 4): uno che non è il principale del suo hypervisor e che nessun'altra
    lettura vede non si disegna, nemmeno a richiesta, e sta solo nei dettagli dell'hypervisor, «visto dalle VM anche
    su ‹porta›»; il principale resta, anche con una VM sola. Questa regola entra se la misura di T3 conferma che quei
    collegamenti sono ridondanze senza altre letture (13.11.4). Dove c'è `lldpd` sull'host (13.5.5), un collegamento
    «dalle VM» su una porta che l'host non conferma si scarta.
11. **Doppi cavi** fra gli stessi apparati, fuori da un fascio: linee separate. Una è principale, le altre sono
    ridondanze con la loro parola. Risolve ADR 0012 M-2 (il cavo di gestione e quello delle VM verso lo stesso
    switch).

### 13.7.3 Segmenti (D5)

- **Quando**: una porta locale **fisica e nota** con due o più apparati sentiti con un annuncio di collegamento,
  contati per apparato, entro la soglia «non visto» (13.7.1, passo 2). Mai da un'interfaccia logica locale: il router
  annuncia LLDP anche dalle VLAN e dalle VRRP, e un MikroTik oltre un ponte trasparente può sentirlo su una sua VLAN;
  senza questo limite nascerebbero segmenti su VLAN e VRRP, fusi a catena in uno solo con decine di membri. Mai da
  una porta non nota. Non è un segmento se gli apparati sono un hypervisor e le sue VM, né se sono le due radio di un
  ponte (13.7.6, punto 3).
- **Una VLAN non è un segmento.** Una VLAN su più porte d'accesso di un bridge gestito (la WAN dentro il bridge del
  router: sull'hub sei porte d'accesso, un apparato ciascuna; la stessa forma sul cliente A) dà un cavo per porta, e
  nessun segmento: ogni porta d'accesso sente un apparato solo, e l'interfaccia della VLAN è logica. I documenti
  chiamano «segmento» una VLAN come questa: per la mappa è una rete, non un oggetto. Che la VLAN di una porta
  compaia sulla linea è un'altra funzione, fuori da questa spec (§9).
- **Oggetto**: un nodo **calcolato**, non salvato (completa §10.3, «cosa è un nodo»). Un **membro** è un apparato
  con una sua porta nota. **Id**: `seg:<id apparato>:<porta>` del membro gestito con la chiave più piccola, dove
  `<porta>` è l'indice (`seg:114:15`) oppure `n-` più il nome normalizzato codificato con `encodeURIComponent`: un
  solo «:» dopo l'apparato, mai «|». Due segmenti che hanno un membro (apparato **e** porta) in comune sono uno solo:
  sulla sede 1 la porta 15 di core 1 sente router 1 e router di riserva, e `ether8` di router 1 sente core 1 e router
  di riserva. Un membro con la porta non nota non fonde due segmenti.
- **Dentro**: i membri (apparato e porta), gli apparati non abbinati e i MAC non censiti visti sulla porta: «+N
  apparati non gestiti» (sulla porta 15 c'è il probabile modem).
- **Collegamenti**: uno per membro, «membro ↔ segmento», genere «segmento», probabile.
- **Nell'albero**: il segmento è un apparato che non si legge, e **fa da padre** dei membri che non hanno altri
  collegamenti (D5: «a cui si attaccano gli apparati»). Un collegamento verso un segmento viene **dopo** un cavo vero
  di pari fiducia (13.8.3, punto 3): per il router di riserva vince accesso B, porta 16, per questa regola e non per
  l'ordine degli id. Il segmento stesso sta sotto il suo **membro più vicino alla testa**, anche se quel membro è
  fuori dal bridge (13.15, punto 1; 13.7.4): un segmento non è un bridge e non ha porta radice. I membri che hanno un
  altro percorso restano membri, come ridondanze. Sulla sede 1 il segmento della WAN sta sotto `ether8` di router 1,
  e la porta 15 di core 1 e `ether8` del router di riserva restano membri.
- **Nelle rotte**: le espressioni di `api-input.ts` (`NODE` a `:51`, `NODE_ANY` a `:58`, `LINK_NODE` a `:65`) oggi
  accettano solo `dev:N`, `host:N` e `vm:N:M`. Si allargano a `seg:` per i nodi delle mappe passo passo, i ritocchi,
  l'«Ignora» di un'appartenenza e la ★, con le loro prove; «Collega a…» no (un segmento non si collega a mano: si
  collegano gli apparati). Un id salvato che non esiste più si risolve nel segmento che oggi contiene quel membro
  (apparato e porta dell'id); se nessuno lo contiene, l'oggetto è perso e si conta (R2).
- Sull'hub, la porta 5 dello switch 48 PoE diventa un segmento. Gli switch di laboratorio, che esistono solo come host
  e non hanno prove di ruolo loro, restano in «Da sistemare» anche alla fine, finché qualcuno non li promuove
  («Ruolo nella mappa → Apparato di rete»); promossi, stanno sotto il segmento.

### 13.7.4 Porte instradate (D5)

- Un capo è fuori dal bridge se un fatto lo dice: `in_bridge = 0` (lettura MK4, nel modello per cavo) oppure, senza
  lettura, `PortaLetta.nelBridge = false` del traduttore MikroTik, che lo ricava dalla forma dell'interfaccia delle
  righe di `/ip neighbor` (`porta,‹bridge›` = nel bridge, con qualunque nome del bridge; una porta fisica senza
  contenitore = fuori): è un dato dell'apparato, non un'ipotesi sul nome (13.6.1, I59). Per gli altri prodotti, senza
  lettura, «nel bridge» è non noto, e un collegamento con un capo non noto non è instradato. Mai dalla tabella MAC: le
  righe vecchie dell'ARP farebbero sembrare `ether1-2.5` nel bridge (I27).
- Un collegamento instradato **non batte mai un percorso nel bridge, ma resta principale di ciò che si raggiunge solo
  da lì** (13.8.3). **Eccezione, solo per i segmenti** (13.15, punto 1): un collegamento instradato verso un segmento
  non perde contro un percorso nel bridge, perché il segmento non è un bridge e non ha porta radice; il segmento sta
  sotto il membro più vicino alla testa (13.7.3).
- Sede 1: `ether1-2.5`, `ether2` e `ether8` di router 1; dall'altra parte del 60 GHz, `ether2` di router 2.
- Hub: le due porte del router di frontiera verso il router, fuori dal bridge e in due VRF (una porta in una VRF è
  instradata come ogni porta fuori dal bridge). Dal lato del router quelle porte stanno nel bridge, nella VLAN della
  WAN: il collegamento è instradato perché lo è un capo. La porta radice del router di frontiera va invece
  all'aggregazione: con lo spanning tree letto (T3) il router di frontiera sta lì, e i due cavi diretti sono
  ridondanze «instradato, fuori dal bridge» (H21). Serve che il router di frontiera sia censito come apparato (13.16).

### 13.7.5 Tunnel

- **Di livello 2, nel bridge (EoIP).** Un annuncio ricevuto su un'interfaccia tunnel locale da un router che
  annuncia dalla sua interfaccia tunnel diventa un collegamento di genere **«tunnel»** fra i due router: probabile,
  mai un cavo, non conta come porta fisica (router 2 sente router 1 sul tunnel con porta remota
  `bridge/eoip-tunnel-…`). Ha uno stato come ogni porta del bridge, anche per istanza.
- **Si disegna solo se acceso.** Lo stato c'è già nelle porte salvate (`switch_ports.status` dell'interfaccia tunnel,
  13.1 punto 17); da T2 anche `running` di MK2. Vale **il capo letto più di recente**; un capo letto da più della
  soglia «non visto» non accende un tunnel che l'altro capo dice spento; con tutti e due i capi vecchi, «stato non
  letto» e nessuna linea. Spento, o con lo stato non letto, il tunnel sta solo nei dettagli («tunnel spento»). Sulla
  sede 1: il tunnel verso la sede 2 è acceso ai due capi e si disegna; quello verso la sede 3 è spento su router 1
  (letto il 14/10) e acceso solo nella lettura di maggio di router 3: spento, e le sue righe vecchie non diventano una
  linea «non vista».
- **Di livello 3** (WireGuard, OpenVPN, L2TP, GRE fuori dal bridge, tunnel cifrati). Gli annunci **possono
  attraversarli**: sull'hub il router virtuale sente il router nel cloud via MNDP su un tunnel WireGuard, in un verso
  solo (il router nel cloud non sente il router virtuale). Un annuncio ricevuto su un'interfaccia tunnel locale è
  quindi una prova di «tunnel» o di «stessa rete», mai di cavo, anche se arriva da un capo solo: con l'altro capo
  censito e il tunnel acceso è un collegamento di genere tunnel, «probabile» (13.4.5); altrimenti il tunnel si
  dichiara a mano («Collega a…», tipo «tunnel»). Che un'interfaccia sia un tunnel lo dice il tipo letto (MK2: `wg`,
  `ovpn-out`, `l2tp-out`, `gre`, `eoip`; SNMP `ifType` 131) e, senza lettura, solo un prefisso di fabbrica nel nome
  (il traduttore): un nome scelto dal cliente per un tunnel resta non noto. Sulla sede 1 conta l'EoIP; il tunnel
  cifrato che lo trasporta non si disegna come secondo collegamento.

### 13.7.6 Ponti radio (D7)

1. **Una porta fisica, un cavo.** Su una porta con un solo apparato sentito via LLDP (le righe MNDP non contano,
   13.7.2 passo 5), o dichiarato a mano, quello è il cavo della porta. Ciò che la stessa porta sente in più (MNDP,
   CDP inoltrato, tabella MAC) sta **oltre** quell'apparato.
2. **Il cavo router ↔ radio vicina** è un cavo normale: LLDP se la radio lo manda; altrimenti tabella MAC e ripiego,
   come oggi.
3. **Il salto radio ≋ radio**, genere «radio». Si deduce quando i due capi si vedono e uno annuncia da
   un'interfaccia senza fili e l'altro da una cablata (fatto del traduttore; nel modello per cavo il tipo
   `wireless` letto): è il caso del 60 GHz, confermato sui due capi (la radio vicina annuncia da `bridge/ether1`,
   quella lontana da `bridge/bond1/wlan60-…`). Si riconosce anche quando una porta sente via LLDP **le due radio di
   un ponte**: se gli apparati della porta sono due radio (capacità LLDP «WLAN», o «bridge» senza «router», lette in
   T2; oppure un capo già noto come radio), non è un segmento «modem o switch non gestito» ma il salto: la radio
   vicina sul cavo della porta, la lontana dopo il salto. È il caso di router 3 su `ether4` (le due radio del ponte
   verso la sede 1, quando router 3 si rilegge col lettore nuovo). Se le due radio non si riconoscono, il segmento
   resta, e la sua frase dice «un modem, uno switch non gestito o un ponte radio» (13.4.6). Altrimenti si disegna a
   mano (D7): «Collega a…» fra le due radio, tipo wireless.
4. **Le radio sono nodi sulla linea.** Il capo di un salto radio (letto, dedotto, dichiarato a mano, o radio vicina
   del punto 5) fa da ponte nell'albero anche se è classificato server o host (eccezione a `tree.ts:47-48`, dove
   `att`, `client` e `hyper` sono foglie), ed essere capo di un salto è una prova di ruolo (13.8.2).
5. **Il router dall'altra parte.** Con la catena completa sta dopo la radio lontana. Con un buco (salto non letto né
   dichiarato) vale una **regola chiusa**, che fa eccezione a §11.1 (MNDP solo come unico vicino) e a §11.1 bis
   (ripiego «porta di bordo», ADR 0010, nato dai circa 230 collegamenti falsi del cliente A) **solo in questo caso**:
   - la porta P del router ha il suo cavo verso un apparato N che non leggiamo (nessuna lettura di vicini sua);
   - oltre N, sulla stessa porta P, si sente **un solo** apparato di rete R (via MNDP o LLDP inoltrato, righe
     dell'ultimo giro; un apparato di rete ha le prove di 13.8.2);
   - allora R si appende a N: «dedotto: oltre ‹N›, salto non letto». Con due o più apparati di rete oltre N nessun
     collegamento, e nei dettagli della porta «Oltre ‹N› ci sono ‹n› apparati di rete: il salto non è letto».
   - Mai dalla tabella MAC di una porta di passaggio: dietro `ether3` di router 1 passa tutta la sede 2 (153 righe
     della tabella del bridge). La porta P resta chiusa al ripiego normale (`attach.ts:51-56`), e resta la prova «porta
     con un ramo intero dietro → niente» (I18).
   Sulla sede 1: oltre la radio vicina su `ether3` router 1 sente un solo apparato di rete, router 2.
6. Se lo spanning tree indica sulla porta un vicino diverso da quello di LLDP, la frase lo dice (13.4.6).
7. Se le radio sono trasparenti all'LLDP e non si leggono, i due router si vedono via LLDP: è un cavo «probabile» fra
   i router. Se Riccardo dichiara a mano la radio su una di quelle porte, la regola 1 mette il router lontano oltre la
   radio.

Sede 1: il 60 GHz non lascia più una seconda radice (C16); router 2 sta dopo il ponte a 5 GHz (col salto letto o
disegnato a mano; senza, «oltre» la radio vicina, punto 5); router 3 resta «probabile, attraverso apparati non
letti», e la linea è vista, perché si regge sulla riga di router 1 del 14/10.

### 13.7.7 Mappe passo passo e oggetti di passaggio

Prim lavora solo sugli oggetti visibili (`tree.ts:25-29`): due membri legati solo attraverso un segmento o un ponte
radio che non sta nella mappa diventerebbero due radici. Allora il segmento o la radio **si contraggono** in una linea
fra i membri, con la parola «segmento» o «≋ radio» (13.10.3); si aggiungono come oggetti con «Aggiungi collegati»
(le rotte accettano l'id del segmento, 13.7.3).

### 13.7.8 Router e firewall in una VM

Un router o un firewall può essere una VM: sull'hub il router virtuale e il firewall virtuale sono VM dello stesso
hypervisor, e in tante reti l'unico router è un firewall virtuale. Valgono le regole delle VM (§11.5: una VM sta
dentro il suo hypervisor), e in più:

- **Fra una VM e il suo hypervisor non c'è un collegamento** (T1, G9): la VM sta dentro. Nessuna prova lo crea, né
  dalle VM, né dalla tabella MAC, né dal ripiego, quindi una VM non fa mai da padre al suo hypervisor. Oggi
  `vm-ports.ts:109` esclude solo che l'hypervisor sia l'apparato stesso.
- **Un apparato non è vicino né client di sé stesso** (T1, G9). I MAC propri dell'apparato che osserva, cioè quelli
  che si abbinano a lui (i MAC noti di oggi, `getNetworkDeviceKnownMacs`), non sono VM sulla sua porta, né client
  della porta, né vicini. `attach.ts:106` li esclude già dai collegamenti, ma li conta fra i client della porta
  (`attach.ts:124-129`), e il giro della tabella MAC delle VM non li esclude (`vm-ports.ts:72-87`). Sull'hub il
  firewall virtuale, registrato come switch, ha nella sua «tabella MAC» i MAC delle sue schede, e da lì la mappa di
  oggi gli appende il suo hypervisor. Nessun ingresso nuovo: il MAC di quella scheda è già un MAC noto del firewall.
- **I suoi annunci sono «stessa rete»** (T3, G15): un router virtuale sente gli altri apparati attraverso il bridge
  dell'hypervisor, non da un cavo suo. Il percorso fisico è quello delle schede dell'hypervisor (bridge, scheda, porta
  dello switch), che si legge con `hypervisor_sync` (13.5.5). Il codice di oggi mette dentro l'hypervisor solo le VM
  senza collegamenti propri (`tree.ts:122-127`): una VM con vicini o con una tabella MAC sua oggi è un oggetto a sé; da
  T3 sta dentro il suo hypervisor anche così.
- **La testa, quando l'unico router è una VM**, è una scelta aperta (13.16): l'hypervisor con la VM dentro, oppure la
  VM come oggetto a sé sopra l'hypervisor. All'hub non serve: la testa è un router fisico.

Effetto sull'hub in T1: l'hypervisor appeso alla scheda del firewall virtuale cambia padre (H15; H13 se entra la
velocità dei nomi doppi, 13.6.1). La misura dice su quale lettura delle VM è fatta (R1): dal 15/10 la lettura notturna
delle VM può aver già tolto quel collegamento, se la VM del firewall risulta spenta.

## 13.8 L'albero

### 13.8.1 T1: pareggi fisici, non alfabetici (D1)

Cambia solo l'ordine con cui Prim sceglie (`tree.ts:44-58`). Restano le foglie (`:47-48`), la ★ e il principale
dell'hypervisor come scelte forzate (`:30-35`, `:95-116`), le radici (`:68-77`).

```ts
// src/lib/topology/tree.ts (T1)
/** Confrontata elemento per elemento, vince la più piccola. A pari chiave, «da|a» in ordine: solo per avere lo
 *  stesso disegno con gli stessi dati. */
export function chiaveScelta(l: MapLink, da: string): readonly number[] {
  return [
    l.primary === "user" ? 0 : 1,      // ★ vince sempre (§11.3)
    l.stale ? 1 : 0,                   // i non visti per ultimi
    rango(l),                          // fonte: uplink 1, LLDP/CDP/MNDP 2, a mano 3 o 4, tabella MAC 3, VM 3,5
    l.uplinkFrom === da ? 1 : 0,       // un uplink dal padre al figlio solo se non c'è altro di pari rango
    -(l.speedMbps ?? 0),               // a parità, il cavo più veloce
  ];
}
```

Il verso viene **dopo** il rango: messo prima, sulla copia del cliente A cambia 4 padri e porta core 1 sotto il router
di riserva attraverso la WAN (13.1 punto 3). `linkCost` (`link-attrs.ts:37-41`) resta per il principale
dell'hypervisor (`tree.ts:111`). Lo stato «giù» non entra in T1, come oggi: entra nella chiave di T3 (13.8.3). Completa
§11.3: il sistema decide sempre per affidabilità, e a parità per verso e velocità.

**La testa proposta** (T1, G8). Dove nessuna testa è confermata, oggi `proposeHead` prova i router in ordine di id e
tiene il primo che raggiunge più nodi (`tree.ts:141`, `:145`): due router nella stessa componente raggiungono gli stessi
nodi, e vince l'id più basso. Sull'hub il router e il gateway del controller sono pari, e vince il router per caso
(13.1, punto 18). Da T1, a pari nodi raggiunti vince il router che fa da gateway di più reti, contate su
`networks.gateway`, che il modello legge già (`db-tenant.ts:9148`), con lo stesso conto della testa proposta di una
sede (`sites.ts:137-158`; §3: «il router che fa da gateway del maggior numero di subnet»). L'id resta solo come ultimo
spareggio, perché stessi dati diano la stessa testa (I39). In T3 fra i due entra la radice dell'albero comune (13.8.3,
punto 7). Sull'hub la testa resta il router (H17); sul cliente A la testa di ogni sede resta quella di oggi, oppure la
regola resta fuori da T1, e si dice (C19).

### 13.8.2 T1b: il ruolo dalle prove (D6)

Un oggetto fa da switch, router o AP nell'albero solo se ha almeno una prova **sua**. D6 elenca quattro prove:
LLDP/CDP, spanning tree, tabella MAC con apparati dietro, VM ospitate. Altre sei, più il ruolo a mano, le ha
aggiunte Riccardo il 14/10 sera (13.15, «Confermato il 14/10»). Nell'elenco per nome di T1b si segnano a parte gli
oggetti tenuti nell'albero **solo** da una prova aggiunta.

| Prova | In D6? | Da dove |
| --- | --- | --- |
| legge vicini (LLDP, CDP, MNDP): lo interroghiamo come apparato di rete | sì (LLDP/CDP) | `device_neighbors.device_id` |
| ha porte con uno stato di spanning tree **attivo** (inoltra, impara o è bloccata: `disabled` non conta, perché vuol dire spanning tree spento) | sì | `switch_ports.stp_state`; nel modello per cavo `topology_port_facts`, e i BPDU che un apparato letto riceve da lui sulla porta che lo vede (`bpdu_rx`, MK6): sull'hub lo switch di storage manda BPDU al router |
| la sua tabella MAC vede altri apparati di rete dietro una porta | sì | `mac_port_entries`, scritta da lui |
| ospita VM (allora è un hypervisor) | sì | scansione Proxmox |
| ha una porta di uplink secondo il controller | aggiunta: è il calcolo del controller sul suo LLDP | `switch_ports.is_uplink`; nel modello per cavo `uplink_local_port_idx` |
| un controller di rete lo gestisce | aggiunta: un controller gestisce solo apparati di rete | `network_devices.controller_mac` |
| un altro apparato esce verso di lui secondo il controller | aggiunta: è padre di un apparato di rete | `network_devices.uplink_mac` di un altro apparato |
| si annuncia come apparato (MNDP o CDP), contando solo le righe che passano R-superata | aggiunta: lo fanno RouterOS, gli switch Cisco e alcune radio. Lo fanno anche apparati che non sono di rete: un telefono IP Cisco, un vSwitch ESXi che annuncia, `lldpd` col CDP acceso. Un telefono che la classificazione dice router passa così la prova e resta nell'albero (famiglia 5, riga «da fare»): fatto da confermare a Riccardo, 13.16, scelta 8 | `device_neighbors` di un altro apparato (fino a T2 la colonna `protocol`, che per un router dice `mndp` anche per righe CDP; nel modello per cavo `discovered_by`) |
| capo di un ponte radio (13.7.6) | aggiunta: la radio sta in mezzo a un percorso | collegamenti di genere «radio» (T3) |
| annuncia le capacità LLDP «bridge», «router» o «AP» | aggiunta, solo se l'apparato non è un server o un hypervisor noto (un server Linux con un bridge e l'inoltro IP annuncia «Bridge, Router»), e solo da un annuncio col nome di sistema: l'LLDP del firmware delle schede di rete annuncia senza nome capacità senza senso (sull'hub la scheda di un hypervisor, «bridge, telephone, docsis-cable-device») | `device_neighbors.remote_caps`, **solo nel modello per cavo**: i dati arrivano con T2, quindi in T1b questa prova non c'è ancora (sotto) |
| ruolo a mano: «Apparato di rete» | aggiunta: la via d'uscita di «Da sistemare» | `network_devices.topology_role = 'rete'` |

**Non sono prove** il tipo dichiarato, la classificazione automatica, essere visto via LLDP da uno switch (sull'hub un
PC registrato come switch manda LLDP dalla sua scheda) o essere visto nella tabella MAC di altri.

```ts
// src/lib/topology/cavi/ruolo.ts (T1b, logica pura)
export type ProvaRuolo = "vicini" | "spanning_tree" | "mac_dietro" | "vm" | "uplink" | "controller" | "padre_di" | "annuncio" | "radio" | "capacita" | "a_mano";
export function proveDiRuolo(input: TopologyModelInput, idx: NodeIndex): Map<string, ProvaRuolo[]>;
/** La classe nella mappa: quella di nodeClass (identity.ts:52-60), ma «infra» e «ap» solo con una prova, e «hyper»
 *  solo per chi ospita VM o è un hypervisor censito e letto (scansione Proxmox): altrimenti «att». */
export function classeInMappa(n: MapNode, prove: readonly ProvaRuolo[] | undefined,
  ruoloAMano: "rete" | "attaccato" | null): NodeClass | "da_sistemare";
```

Vale per apparati e host: un host che la classificazione automatica dice router, switch o AP, senza prove, è «da
sistemare» come un apparato (H4b): è la seconda causa del vincolo 7 (un telefono, un notebook, due host con
«Insufficient evidence» sull'hub; 2 host «router» sul cliente A). Vale anche per «hypervisor» (G10): un host che la
classificazione dice hypervisor e che non ospita VM è un attaccato, non un hypervisor. Sull'hub è un nodo fatto di 18
host fusi su un MAC amministrato localmente: con questa regola resta dov'è, come attaccato; che 18 host diventino un
nodo solo è un problema d'identità, fuori dal §13.

**Una prova che in T1b non c'è ancora.** Le capacità annunciate stanno in `remote_caps`, che arriva con T2. In T1b,
quindi, uno switch che gli altri vedono solo via LLDP, che non legge vicini suoi e che nessun controller gestisce,
esce dall'albero: sull'hub è lo switch di storage (dopo il lettore di T1 le sue righe sono solo LLDP, e perde anche la
prova «si annuncia»). Torna nell'albero in T3, con le capacità o coi BPDU che manda (sopra), oppure subito col ruolo a
mano. Sul cliente A, prima del rilascio di T1b, si contano gli switch visti solo via LLDP: se sono molti, è un fatto da
portare a Riccardo con l'elenco per nome (13.16).

Effetti:

- **«Da sistemare» si comporta come un client**: non entra nella mappa automatica (`autoVisible`, `tree.ts:122-127`),
  non fa da ponte, conta come un client sulla porta dello switch che lo vede, e i MAC dietro le sue porte non lo
  rendono un apparato di passaggio (`attach.ts`). Compare in «Da sistemare» (`object-list.tsx:54-68`) col motivo:
  «dichiarato switch, ma nessuna prova che lo sia: non vede vicini (LLDP, CDP, MNDP), nessuna porta con spanning
  tree, nessun apparato dietro le sue porte. Se lo è: Ruolo nella mappa → Apparato di rete». Per un host: «la
  classificazione automatica lo dice router, ma nessuna prova che lo sia…». È la promessa della spec §8, che oggi
  non è mantenuta (vincolo 7).
- **Nessuna radice sola** (G10). Un oggetto di rete con una prova di ruolo ma senza collegamenti non è una radice
  della mappa automatica: va in «Da sistemare» col motivo «nessun collegamento». Oggi «Da sistemare» prende solo
  apparati, attaccati e hypervisor (`model.ts:60-63`); T1 aggiunge chi resta senza collegamenti su una porta di
  segmento (H5); T1b aggiunge gli host di classe «infra» e «ap». Sull'hub sono i cinque oggetti di rete senza
  collegamenti del 13.1, punto 18 (H14: una radice sola); sul cliente A la radio lontana a 60 GHz, finché il salto
  radio di T3 non la lega (C16). È la regola del §10.2 («gli apparati senza collegamenti stanno in Da sistemare»)
  estesa agli host che la mappa tratta da apparati; il controllo dei tipi sospetti resta solo per gli apparati, come
  in T1 (`model.ts:64-67` confrontava l'id di un host col numero di porte di un apparato).
- Nelle mappe passo passo un membro «da sistemare» resta, come foglia, con la parola «da sistemare»: nessuna mappa
  perde oggetti (R2).
- `nodeClass` è chiamata 25 volte in 10 file: la mappa passa per `classeInMappa` solo dove decide foglie, ponti e
  visibilità; attribuzione e altri moduli non cambiano.
- **Ruolo a mano** (via d'uscita per uno switch vero senza letture): tasto destro su un apparato, solo admin, «Ruolo
  nella mappa ▸ Apparato di rete · Attaccato (server, PC) · Decide il sistema». Si salva in
  `network_devices.topology_role` (esiste, `db-tenant.ts:265`, `db-tenant-schema.ts:184`, ed è vuota su tutte e due le
  copie: `SELECT SUM(topology_role <> '') FROM network_devices;` → 0 e 0), con `PATCH /api/topology/nodes/role
  { node_id, role }`, `requireAdmin` come prima istruzione e Zod. Valori: `''` (decide il sistema), `'rete'`,
  `'attaccato'`; da T3 anche `'core'` e `'accesso'` (13.9). Per un host: «Prima Promuovi ad apparato» (la proposta
  c'è già, `model.ts:52-57`).
- **Misura di lavoro** (prove di oggi, prima del lettore corretto): sul cliente A 9 oggetti «di rete» senza prove, 2
  nella mappa automatica, nessuno con figli; sull'hub 27, 14 nella mappa (fra cui i PC e lo scanner registrati come
  switch, gli switch di laboratorio che esistono solo come host, un notebook, un telefono), nessuno con figli. Non si
  sposta nessun altro nodo. **Sono numeri indicativi**: nelle copie del 14/10 tutte le righe del router sono `mndp`,
  anche quelle LLDP, e la prova «si annuncia come apparato» è sporca (sull'hub due switch veri, uno Cisco e uno di
  storage, hanno solo questa prova: con un MNDP vero sarebbero 29). La misura vera si fa su una copia presa **dopo
  almeno una lettura oraria col lettore di T1**, con le prove confermate il 14/10 sera, e l'elenco per nome di chi
  esce si guarda con Riccardo prima del rilascio (13.15, punto 3; solo nella chat, mai nel repo), compresi i 2 host
  «router» del cliente A di cui non si sa che cosa siano. Dalla lettura dei router dell'hub: con le sole quattro prove
  di D6 escono 8 apparati di rete veri, visti solo da altri (il router di frontiera, quattro switch MikroTik, un router
  di laboratorio, uno switch Cisco, lo switch di storage); con le prove aggiunte ne esce uno, lo switch di storage.

### 13.8.3 T3: l'albero lo decide lo spanning tree (D2)

1. **Collegamento scelto di ogni bridge = il collegamento sulla sua porta radice dell'albero comune**: MikroTik
   `root-port` (MK5); SNMP `dot1dStpRootPort` tradotta con `dot1dBasePortIfIndex`, o il ruolo nell'albero comune della
   MSTP-MIB. Per gli apparati del controller, che non dicono il ruolo, la porta di uplink (`uplink_local_port_idx`,
   poi `is_uplink`), **solo se non è ferma**, con le parole del 13.7.2, passo 8: «ferma» vuol dire bloccata
   (`discarding`, `alternate`, `backup`) su una porta accesa; `disabled` su una porta accesa vuol dire spanning tree
   spento, e la porta inoltra (gli switch Flex Mini dell'hub, che altrimenti darebbero due anomalie false); una porta
   giù non inoltra, qualunque stato dica. Se è ferma, nessuna scelta e l'anomalia «uplink del controller su una porta
   ferma». **Per un gateway del controller** (un apparato del controller censito come router) l'uplink è la WAN: dà
   un collegamento «instradato (WAN)», senza verso, e non sceglie il padre, che viene dal cavo della sua LAN con le
   regole dei punti 3-5. Sull'hub WAN e LAN del gateway vanno allo stesso switch, e il padre di oggi è giusto per
   caso; con WAN e LAN su due switch diversi l'uplink sceglierebbe lo switch della WAN (H11). Un AP in mesh ha un
   uplink senza fili e nessuna porta di uplink: non sceglie, decide il punto 5, e il collegamento è «senza fili»
   (`uplink_type`, `link-attrs.ts:121-124`). Se la porta radice dà su un segmento, il padre è il segmento. Se il
   collegamento è «non visto», o su quella porta non c'è un collegamento, nessuna scelta: decide il ripiego e la
   frase lo dice.
2. **La trappola della radice regionale.** Il bridge designato non sceglie il padre e non crea un collegamento:
   conferma soltanto un cavo già provato da LLDP, e solo letto da chi riceve RSTP dall'altro capo (`sending-rstp`).
3. **Prim** come oggi, con le due passate (prima le scelte forzate, poi tutte, `tree.ts:60`), e la chiave, confrontata
   elemento per elemento (vince la più piccola):

   ```ts
   [ ★ ? 0 : 1,
     scelto(to) === collegamento ? 0 : 1,      // la porta radice di «to» (punto 1)
     nonVisto ? 1 : 0,
     giu ? 1 : 0,                              // una porta giù o spenta non porta traffico
     bloccato ? 1 : 0,
     instradato && !versoSegmento ? 1 : 0,     // verso un segmento l'instradato non perde (13.15, punto 1)
     fiducia,                                  // certo 0 · probabile 1 · dedotto 2 · a mano confermato 3 · a mano 4
     versoSegmento ? 1 : 0,                    // a pari fiducia, un cavo vero prima di un collegamento verso un segmento
     versoSegmento ? profondita(da) : 0,       // il segmento sotto il membro più vicino alla testa (0 = la testa)
     controVerso ? 1 : 0,
     -velocità ]                               // poi «da|a», solo come ultimo spareggio
   ```

   `versoSegmento` vale quando l'arrivo `to` è un segmento, o quando il collegamento parte da un segmento verso un
   membro. `profondita(da)` è la profondità del membro nell'albero già costruito. Senza questi due elementi i due
   candidati per il segmento della WAN (router 1 `ether8` e core 1 porta 15) sono pari in tutto, e lo spareggio sugli
   id li ordina per alfabeto («dev:114|…» viene prima di «dev:1|…», `tree.ts:54`): il segmento andrebbe sotto core 1
   per caso, contro la decisione del 14/10 sera (13.15, punto 1). Misurato col prototipo della verifica, che metteva
   la profondità subito dopo «scelto»: il segmento va sotto `ether8` di router 1 e nessun altro padre cambia. Qui la
   profondità viene dopo la fiducia, così un collegamento più affidabile verso il segmento vince comunque; sul
   cliente A i due candidati sono tutti e due «probabile», quindi il risultato atteso è lo stesso, e lo prova lo
   scenario S10.
4. **Bloccati**: fanno da padre solo se non c'è altro (D2). **Instradati**: non battono mai un percorso nel bridge,
   ma restano principali di ciò che si raggiunge solo da lì (D5): la radio vicina del 60 GHz. **Segmenti**: un
   segmento fa da padre dei membri senza altri collegamenti; il segmento stesso sta sotto il membro più vicino alla
   testa, anche se fuori dal bridge (13.15, punto 1): sulla sede 1 sotto `ether8` di router 1, con la porta 15 di
   core 1 e `ether8` del router di riserva come membri e ridondanze.
5. **Dove lo spanning tree manca** (switch senza spanning tree, AP, porte instradate, marche senza lettura): decidono
   fiducia, verso del controller e velocità, e la frase dice che è un ripiego («Scelto fra 3 cavi uguali: nessuna
   prova dice quale porta il traffico»).
6. **Hypervisor**: §12.5, dopo la ★: prima il non vecchio, poi il **non giù**, poi il più veloce, poi quello con più
   VM. Completa §12.5: sull'hub un hypervisor oggi pende da una scheda virtuale spenta del firewall virtuale (H13).
7. **Testa**: quella confermata (sede o mappa); altrimenti il router o firewall «di rete» (13.8.2) che raggiunge più
   nodi con collegamenti non vecchi e **non bloccati**; a parità quello che fa da gateway di più reti (13.8.1, già in
   T1), poi quello che è radice dell'albero comune, e l'id solo per ultimo. Quando l'unico router è una VM la testa è
   una scelta aperta (13.7.8, 13.16). Completa la
   testa proposta di §3 e §10.2 (oggi solo i router e tutti i collegamenti non vecchi, `tree.ts:130-148`): anche i
   firewall, e solo i collegamenti non bloccati. La radice dello spanning tree non diventa testa da sola: può essere un
   core. Sul cliente A e sull'hub la testa resta quella di oggi (si misura).
8. **Anomalia «core che esce da uno switch di accesso»** (D2). Uno switch X con padre P ha l'anomalia se ha cavi,
   anche bloccati, verso **almeno altri due** switch che stanno allo stesso livello di P: X fa da centro per quel
   livello, ma il suo traffico esce da uno di loro. Sulla sede 1 scatta su core 2 (padre accesso C; cavi anche verso
   accesso A e accesso B). Uno switch con due soli uplink, verso due switch dello stesso livello, non lo fa scattare.
   Se un admin ha dato i ruoli a mano, vale il ruolo: un apparato «accesso» non ha mai l'anomalia. Nei dettagli e
   nell'elenco «Anomalie della rete» di «Dati della mappa» il titolo è il testo di D2, **«core che esce da uno switch
   di accesso»**, seguito da: «Il percorso attivo di ‹X› passa da ‹P› (porta ‹p›). ‹X› ha cavi anche verso ‹elenco›,
   che stanno allo stesso livello di ‹P›. Di solito i core stanno sopra gli accessi: controlla le priorità dello
   spanning tree, o il cavo fra i due core.» Sul riquadro la forma corta **«⚠ core sotto accesso»**, un'abbreviazione
   dichiarata, confermata da Riccardo il 14/10 sera (13.15). Mai sulla linea.
9. **Seconda partenza scartata**: una partenza di una mappa passo passo raggiungibile dalla prima oggi sparisce in
   silenzio (`tree.ts:68`). Il pannello lo dice: «‹X› è raggiungibile da ‹testa›: sta nell'albero sotto ‹padre›».
10. **★ non applicabile**: se l'altro capo si raggiunge solo passando dal nodo stesso, «★ non applicabile: ‹B› si
    raggiunge solo passando da ‹A›».

**Sostituisce §11.3** («quando un oggetto ha più collegamenti verso l'albero decide il sistema: confermati e recenti
prima, poi la fonte più affidabile») e §3 («visita dei collegamenti preferendo le fonti più affidabili»): per un
bridge con lo spanning tree letto decide la porta radice; la fonte più affidabile decide dove lo spanning tree manca;
la ★ vince sempre.

## 13.9 Correzioni a mano

| Correzione | T1 | T3 | Dove si salva |
| --- | --- | --- | --- |
| **«Ignora»** | toglie solo il cavo con quelle due porte (D3), confrontate con `stessaPorta` dopo il completamento 3a; una porta vuota vale per qualunque porta su quel lato; **con tutte e due le porte vuote toglie solo un cavo senza porte fra quei due oggetti** (l'uplink senza fili di un access point in mesh), mai un cavo con le porte: se fra i due non c'è un cavo senza porte è orfana e chiede «Scegli il cavo da ignorare…» (revisione finale del 15/10: prima era sempre orfana, e su una linea senza porte «Scegli il cavo da ignorare…» riproponeva lo stesso cavo vuoto). Le porte salvate prima di T1 si leggono come le scrive l'apparato e, se così non sono una porta che un cavo può avere, come le annuncia a chi lo vede («bridge/ether3», «Port 10» di un padre con la porta rinominata) | uguale; su un fascio, il fascio (dialogo con i membri spuntati); su un segmento, solo l'appartenenza di quella porta (l'id del segmento passa le rotte, 13.7.3) | `topology_link_overrides`, `a_port` e `b_port` che la pagina già scrive (`topology-map-client.tsx:579`) |
| **«★ Rendi principale»** | per coppia, come oggi (`link-attrs.ts:105-106`) | per collegamento: la riga ha già `node_port` e `other_port` (`db-tenant.ts:381-389`). Toglie il limite dell'ADR 0010 (N-2, il principale cade per coppia, `deleteLinkOverride`, `db-tenant.ts:9552-9565`) | `topology_link_primary` |
| **«Collega a…»** con le porte | come oggi (§11.3) | un collegamento «a mano»; se le porte coincidono con un cavo visto, una linea sola «a mano, confermato»; su porte diverse da quelle viste, due linee e «a mano su porte diverse da quelle viste»; tipo in più «tunnel»: `medium` è senza CHECK nel DB, lo valida Zod (`MEDIUM` di `api-input.ts:66`, oggi «cavo», «fibra», «wireless», riceve «tunnel»; lo stesso `MEDIA` di `link-attrs.ts`) | `topology_link_overrides`, `add` |
| **«Ruolo nella mappa»** | (T1b) «Apparato di rete · Attaccato (server, PC) · Decide il sistema» | in più «Core · Accesso», solo per correggere l'anomalia | `network_devices.topology_role` (`''`, `'rete'`, `'attaccato'`; da T3 `'core'`, `'accesso'`) |

- **Sostituisce §11.2** (tasto destro su una linea, «Ignora (automatico)») e la frase di §12.5 «“Ignora il
  collegamento…” vale anche per questa fonte»: «Ignora» toglie il cavo con le sue due porte, non la coppia di
  apparati (oggi `links.ts:121`, `:189`), e vale per tutte le fonti di quel cavo, «dalle VM» compresa (D3).
- **Sostituisce §11.3, «Verifica», da T3.** Oggi un collegamento a mano è confermato se c'è un collegamento automatico
  fra gli stessi oggetti, o un MAC dell'oggetto di arrivo sulla porta dichiarata (`link-attrs.ts:78`). Da T3 lo
  conferma un cavo visto **con le stesse porte**, o il MAC sulla porta dichiarata; un collegamento visto fra gli stessi
  oggetti su altre porte non lo conferma più, ed è una linea sua.
- Le porte di un cavo ignorato **restano occupate verso quell'oggetto**: tabella MAC, ripiego del router e VM non
  ripropongono una linea su quella porta verso quell'oggetto. È la regola I-3 della fase 2b, oggi per coppia
  (`attach.ts:57-58`, `vm-ports.ts:111`), applicata al cavo.
- Nessuna colonna nuova sulle correzioni: si confrontano per chiave di porta, calcolata alla lettura. Una porta
  rinominata stacca la correzione, che diventa orfana e si vede.
- **Testi che cambiano.** Voce del tasto destro (`map-menus.ts:89`): la parola del genere, «Ignora questo cavo…»,
  «Ignora questo tunnel…», «Ignora questo ponte radio…», «Ignora questo fascio…», «Togli ‹A› dal segmento…»; in T1,
  dove una linea è una coppia, «Ignora questo cavo…». Dialogo (`topology-map-client.tsx:562-583`), titolo: «Ignorare
  il cavo ‹A› · ‹porta› ↔ ‹B› · ‹porta›?»; testo: «Questo cavo sparisce da tutte le mappe, anche se le letture
  continuano a vederlo (‹fonti›). Gli altri cavi fra ‹A› e ‹B›, se ci sono, restano. I dati letti non si toccano.»,
  più la riga di oggi su dove si annulla (`ignored-links.ts:10`).
- **Correzione orfana**, in «Dati della mappa → Collegamenti ignorati» (`ignored-links.ts:46-60`): «non corrisponde a
  nessun cavo visto: non toglie niente», con due pulsanti, «Togli la correzione» e «Scegli il cavo da ignorare…»
  (elenca i cavi fra i due oggetti: in T1 la linea e gli «Altri cavi visti», 13.4.6). «Ripristina» resta per le righe
  che nascondono davvero un cavo.
- **★ di prima, in T3**: senza porte, o con porte che non indicano nessun collegamento, vale per il collegamento
  migliore della coppia, e i dettagli lo dicono: «★ scelta prima che le linee fossero per cavo: ora vale per il cavo
  migliore fra questi due apparati. Scegli il cavo», con il pulsante.
- La prova che oggi fissa l'«Ignora» per coppia (`links.test.ts:64-71`) **si riscrive** col motivo nel commento
  (incidente del 14/10), non si cancella.

**Le correzioni che ci sono già: nessuna conversione automatica.** Sul cliente A ce n'è una (porta 10 di core 1 ↔
`ether8` di router 1, 14/10). Con le regole di T1 non corrisponde a nessun cavo: la porta 10 va a `sfp-sfpplus1`, e
`ether8` sta su una porta di segmento. Dopo il rilascio non nasconde più niente e compare come orfana; **Riccardo la
riguarda e la toglie a mano** (D3): nessuno script scrive sul DB del cliente. Sull'hub non ci sono correzioni; ★
salvate: 0 e 0. Sulle altre appliance si contano prima della promozione a `main` (13.11).

## 13.10 Disegno

### 13.10.1 Linee sul lato più vicino, senza giri (vincolo 5)

```ts
// src/lib/topology/map-screen.ts (T1) — una funzione sola per schermo e stampa (ADR 0012, «cosa diventa difficile» 1)
export type Lato = "su" | "giu" | "sx" | "dx";
export function candidatiLati(a: Rect, b: Rect, o: MapOrientation): Array<{ da: Lato; a: Lato }>;  // in ordine
export function latiVicini(a: Rect, b: Rect, o: MapOrientation, ostacoli: readonly Rect[]): { da: Lato; a: Lato };
export function percorso(a: Rect, la: Lato, b: Rect, lb: Lato): Pt[];   // usata anche da print-draw
```

**Regola** (logica pura, deterministica). I candidati sono quattro, in quest'ordine, scritti una volta sola in
`candidatiLati` e usati sia da `latiVicini` sia dalla misura di C10 e C11:

1. la coppia di lati **affacciati** sull'asse dove lo spazio vuoto fra i due riquadri è maggiore (lato di A rivolto
   verso B, lato di B rivolto verso A);
2. la coppia affacciata sull'altro asse;
3. e 4. le due coppie **a «L»**: il lato di A rivolto verso B su un asse e il lato di B rivolto verso A sull'altro,
   prima quella col percorso più corto.

A pari spazio fra 1 e 2 vince l'asse dell'orientamento (orizzontale in «Verticale», verticale in «Orizzontale»). Vince
il primo candidato il cui percorso non attraversa un altro riquadro; se nessuno passa pulito, quello col percorso più
corto. I due lati di un candidato si guardano sempre: nessuna linea esce dalla parte opposta per tornare indietro. Il
percorso è ortogonale, con al massimo due curve (a «Z» fra lati affacciati, a «L» fra lati perpendicolari), raggio 0
come oggi; due riquadri sovrapposti (non dovrebbe succedere) usano i lati di oggi.

Che cosa cambia:

- **Le linee dell'albero restano a tronco, per scelta**, anche dove un altro lato sarebbe più vicino. In «Verticale»
  il padre sta a metà fra il primo e l'ultimo figlio (`tree-layout-lr.ts:85-87`): con sei figli alti 44 px a 18 px
  l'uno dall'altro (`tree-layout-consts.ts:3`) il vuoto verticale fra il padre e il primo figlio è 111 px, più dei 90
  px fra le colonne (`LEVEL_GAP_LR`, `tree-layout-consts.ts:7`), e la regola sceglierebbe su o giù, spezzando il
  tronco in tanti tratti. Il tronco (`LR_TRUNK`, `map-screen.ts:73`) tiene insieme i fratelli e porta le etichette.
  Confermato da Riccardo il 14/10 sera (13.15); la bozza di T1 mostra un ramo con molti figli. Un figlio spostato a
  mano dall'altra parte usa `latiVicini`.
- **Ridondanze, collegamenti bloccati e instradati, membri di un segmento, linee a mano**: sempre `latiVicini` (oggi
  `redundantEnds`, `map-screen.ts:34-39`).
- **Maniglie**: si aggiungono le quattro che mancano (uscita in alto e a sinistra, entrata in basso e a destra), con id
  fissi `s-su`, `s-sx`, `t-giu`, `t-dx`; restano quelle di oggi, `su`, `giu`, `sx`, `dx` e `fondo`
  (`map-screen.ts:16-21`, `map-node.tsx:66-75`). Gli attaccati tengono il tratto dal fondo.
- **Etichette.** La riga delle porte resta dov'è oggi, sopra il riquadro (`labelBoxes`, `map-screen.ts:130`); lungo il
  lato scelto si sposta solo la parola della linea (ridondanze, linee a mano, figli spostati a mano):
  `redundantLabelAt` (`:146`) riceve i punti del percorso vero e la mette vicino alla sua metà, fuori dai riquadri e
  dalla riga delle porte. Corretto il 15/10 nella revisione del piano: il lato scelto non sposta la riga delle porte.
- **Stampa**: `print-draw.ts` usa le stesse funzioni (i gradini dell'albero oggi a `print-draw.ts:30-42`); le
  ridondanze in stampa restano un elenco (§12.5).
- **Misura**: `misura-cavi` conta C10 e C11 già da T1, con `candidatiLati` e `latiVicini` sulla disposizione vera
  delle due copie; il «prima» lo misura il pezzo T1.0 sul codice di oggi.

**Sostituisce §12.2** («le linee escono dal lato destro del genitore ed entrano dal lato sinistro del figlio») per
le linee che non sono dell'albero e per i riquadri spostati a mano.

### 13.10.2 Elenco a sinistra comprimibile (vincolo 6)

- **Un pulsante solo, nella barra della mappa**, gemello di «Dettagli» (`map-toolbar.tsx:193-202`): stesso stile
  (`outline`), etichetta con la freccia verso dove va l'elenco, «◂ Elenco» quando è aperto, «Elenco ▸» quando è
  chiuso; `aria-pressed` = elenco aperto, come «Dettagli» (`aria-pressed={p.detailsOpen}`); un `title` che dice che
  cosa fa il clic. Lo stato si legge dalla freccia e dalla parola, mai dal colore; si usa da tastiera.
- **Chiuso**, l'elenco (300 px, `object-list.tsx:81`) sparisce e la mappa prende la larghezza; «Adatta» rifà il conto.
- **Si ricorda per chi guarda**, in questo browser: `localStorage`, chiave `da-ipam.topologia.elenco`, lettura e
  scrittura in `try`, come la barra dei dettagli (`topology-map-client.tsx:50-67`). Di base è aperto.
- **Elenco chiuso in «passo passo»**: si aggiunge dal pannello dei collegati («+N»); il pulsante, al passaggio del
  mouse, dice «Apre l'elenco per trascinare gli oggetti sulla mappa». Nessuna fascia sulla mappa.
- Si prova a 1280 px, dove la barra del passo passo va già su due righe (ADR 0010), e a 1920.

Completa §11.2, dove la barra di destra ha già il suo pulsante per chiudersi.

### 13.10.3 Forme e parole

Mai il solo colore: forma più parola, distinte per luminanza e disegno, non per tinta (Riccardo è daltonico). Ogni
forma si prova anche in bianco e nero, come la stampa (§12.3). Testo almeno 13 px.

**Il vocabolario di oggi, che non si riusa con un altro significato**: tratteggio grigio «6 4» = non visto
(`edge-look.ts:60`, `:63`); puntini «1.5 4» = a mano, non confermato (`:57`, `:63`); doppia linea sottile =
ridondanza (`:59`); linea ondulata con «≋ Wi-Fi» = senza fili (`:53`); «▲ giù» e bordo spesso sul riquadro = apparato
che non risponde (`map-node.tsx:79`, `:99`); «◆ avviso» = avviso del monitoraggio (`:79`); bordo tratteggiato del
riquadro = host da promuovere (`:99`).

| Che cosa | Forma | Sulla linea dell'albero (corta) | Su una ridondanza e nei dettagli (intera) |
| --- | --- | --- | --- |
| cavo attivo | piena, spessore = velocità (§11.4) | «10G», «2,5G», «1G» | uguale |
| bloccato dallo spanning tree | doppia sottile (è una ridondanza) | «bloccato» (sulla linea dell'albero solo se non c'è altro) | «⊘ bloccato dallo spanning tree», al posto di «ridondanza» |
| bloccato nell'albero comune, attivo per altre VLAN | doppia sottile | «in parte» | «⊘ bloccato nell'albero comune · VLAN ‹n› attiva»; istanze non lette: «… può portare altre VLAN»; «istanza» solo nei dettagli |
| instradato | quella del collegamento (piena o doppia) | «instradato» | «instradato, fuori dal bridge»; per l'uplink di un gateway del controller «instradato: la WAN del gateway» |
| cavo giù | tratteggio lungo «10 4», **nero** (il grigio «6 4» è «non visto») | «cavo giù», senza velocità | «cavo giù: la porta ‹p› di ‹A› è giù» |
| fascio | piena, spessore della somma | «2 cavi» | «fascio di 2 cavi · 2 × 25G»; senza prova del fascio «fascio dedotto» |
| tunnel | tratto lungo-corto «8 3 2 3», diverso da «6 4», «1.5 4» e «10 4» | «tunnel» | «tunnel EoIP», o il tipo letto |
| salto radio | ondulata | «≋ radio» | «≋ ponte radio»; «≋ Wi-Fi» resta per AP e client |
| senza fili (client su un AP) | ondulata | «≋ Wi-Fi» | come oggi |
| riserva del bond | doppia sottile | «riserva» | «riserva del bond: si usa se cade l'altra scheda» |
| oltre un ponte radio non letto | piena | «oltre ‹radio›» | «dedotto: oltre ‹radio›, salto non letto» |
| contrazione in una mappa passo passo | piena con «⋯» al centro, oppure ondulata | «segmento», «≋ radio» | «via segmento non gestito: non è in questa mappa», «via ponte radio» |
| segmento (oggetto) | riquadro piccolo a capsula (angoli tondi pieni), bordo pieno sottile, simbolo «⋯»; mai il bordo tratteggiato | — | su due righe «segmento» / «modem o switch non gestito», sotto «+N apparati non gestiti» |
| anomalia sul riquadro | «⚠» più il testo, solo sul riquadro (mai sulla linea) | — | sul riquadro «⚠ core sotto accesso», al posto della seconda riga (IP o tipo, `map-node.tsx:86-88`, che restano al passaggio del mouse e nei dettagli), come oggi «host · da promuovere»; nei dettagli e in «Anomalie della rete» il testo di D2 |
| non visto, a mano, ★, ridondanza | come oggi (`edge-look.ts:49-68`) | come oggi | come oggi |

**Sostituisce §4** («uplink giù = linea rossa spessa»): colore e spessore restano alla velocità (§11.4), e «giù» ha
forma e parola sue.

**Combinazioni.** Un'etichetta è fatta di pezzi, in quest'ordine: velocità, stato, poi i pezzi di oggi (PoE, ★,
«✎ ✓/?»), che restano. Lo stato è al più un pezzo, nella forma corta; la forma intera va al passaggio del mouse e nei
dettagli.

| Caso | Linea dell'albero | Ridondanza (a richiesta) e dettagli |
| --- | --- | --- |
| inoltra | «10G» | «10G · ridondanza» |
| bloccato | «bloccato», solo se non c'è un altro percorso | «10G · ⊘ bloccato dallo spanning tree» |
| bloccato in parte | «10G» «in parte» | «10G · ⊘ bloccato nell'albero comune · VLAN ‹n› attiva» |
| instradato | «2,5G» «instradato» | «2,5G · instradato, fuori dal bridge» |
| giù | «cavo giù» | «cavo giù»; un cavo giù smette di mandare LLDP e diventa anche «non visto»: vale «cavo giù», e «non visto da N g» va nei dettagli |
| non visto | come oggi: la linea dell'albero non lo ripete, lo dice l'etichetta delle porte; tratteggio grigio | «▲ non visto da N g» |
| tunnel bloccato in parte | «tunnel» «in parte» | «tunnel EoIP · ⊘ bloccato nell'albero comune · VLAN ‹n› attiva» |
| tunnel acceso, annunci vecchi | «tunnel ▲» (8 caratteri: la parola dice «non visto»; il tratto del tunnel è anche grigio, ma il colore non è mai il solo segnale) | «tunnel · ▲ non visto da N g» |
| tunnel spento, o stato non letto | — (non si disegna: 13.7.5) | nei dettagli, «tunnel spento» o «tunnel · stato non letto» |
| fascio | «50G» «2 cavi» | «fascio di 2 cavi · 2 × 25G» |

**I cavi bloccati si vedono a richiesta** (13.15, punto 7). Sono ridondanze: come tutte le ridondanze si disegnano a
richiesta (§12.5: clic sul riquadro o «Mostra ridondanze»), e il «⇄ N» del riquadro li conta. La scritta «bloccato
dallo spanning tree» si vede quindi dopo un clic; nei dettagli sempre. Sempre disegnati, rifarebbero il groviglio
che la regola delle ridondanze ha tolto: core 2 da solo ne ha due.

**Spazio per le parole.** In «Verticale» una linea dell'albero ha almeno 68 px per l'etichetta (90 px fra le colonne,
`LEVEL_GAP_LR` a `tree-layout-consts.ts:7`, meno il tronco e il margine: `lrLabelMaxWidth`, `map-screen.ts:76-78`), di
cui 60 di testo dentro il margine interno di 4 px per lato (`map-edge.tsx:76`). Ogni pezzo va a capo da solo, mai a
metà (`map-edge.tsx:78-82`), e un pezzo che non è l'ultimo porta « ·». A 7 px per carattere (`CHAR_W`,
`tree-layout-consts.ts:5`, una stima per eccesso) ci stanno 8 caratteri: «cavo giù», «tunnel», «≋ radio», «riserva»,
«bloccato», «in parte», «2 cavi» ci stanno; «instradato» (10) supera lo spazio minimo di due caratteri stimati. Un
pezzo che non sta nel suo spazio si accorcia con «…» e resta intero al passaggio del mouse e nei dettagli, come
`fitLabel` per i riquadri (`tree-layout-consts.ts:31-34`). Vale anche per «instradato» sullo spazio minimo, e la
bozza di T3 lo mostra così (13.10.4). La prova I32 misura ogni pezzo contro il suo spazio. Sul
riquadro ci stanno 18-26 caratteri: «⚠ core sotto accesso» ne ha 20, e su un riquadro stretto si accorcia allo stesso
modo.

**Spazio sullo schermo.** Niente fasce né spiegazioni sopra la mappa. «Perché questo collegamento», «Perché è il
principale», «Candidati per porta» e le anomalie stanno nella barra dei dettagli e al passaggio del mouse; correzioni
e letture in più in «Dati della mappa». L'elenco «Cavi di ridondanza» della stampa (§12.5) riceve la colonna «stato».

### 13.10.4 La bozza prima del codice

L'interfaccia si propone oggetto per oggetto prima di scriverla (regola grafica del parco). Ogni tappa che tocca la
pagina ha una bozza statica sul dato del cliente A (dalla copia). Per T1 e T1b, scritti nella notte del 14/10 col
mandato di Riccardo «senza altre domande, chiedimi solo prima del rilascio», il codice parte dai testi che questo
capitolo fissa alla lettera, senza aspettare l'approvazione: la bozza va a Riccardo insieme ai numeri del rilascio, e
le sue correzioni entrano nel giro di correzioni, prima del cancello. Le due regole (la bozza prima del codice, e
nessuna domanda fino al rilascio) qui si toccano: è un fatto da confermare con Riccardo, non una scelta presa per lui.
Da T2 la bozza torna prima del codice. Che cosa mostra:

- **T1**: il pulsante «◂ Elenco»; una ridondanza prima e dopo `latiVicini`; un ramo con molti figli (il tronco resta);
  i dettagli della linea con «Altri cavi visti»; la riga orfana in «Collegamenti ignorati»;
- **T1b**: una riga di «Da sistemare» col motivo (un apparato e un host); il menu «Ruolo nella mappa»; i dettagli
  della linea con «Perché questo collegamento» e il motivo delle righe scartate;
- **T2**: «Letture in più per la mappa» e «Cosa cambierebbe con la mappa nuova (una linea per cavo)»;
- **T3**: il segmento della WAN sotto la porta della WAN di router 1, coi due membri in ridondanza; un cavo bloccato,
  a richiesta; un instradato, con «instradato» sullo spazio minimo; un cavo giù; il tunnel; un ponte radio; un fascio;
  l'anomalia su core 2 con la forma corta; «Candidati per porta»; un foglio di stampa in bianco e nero.

### 13.10.5 Che cosa vede Riccardo, rilascio per rilascio

- **Con la correzione rapida**: core 1 sotto router 1, con «10G»; accesso A sotto core 1; il router di riserva sotto
  accesso B, porta 16. Sull'hub i tre hypervisor sotto lo switch di aggregazione a 10G invece che sotto lo switch di
  gestione, e tre switch di laboratorio in «Da sistemare» (la regola del segmento); il router di frontiera sotto il
  router su un cavo vero, non più su una VLAN; l'hypervisor che pendeva dal firewall virtuale sotto un suo cavo. Nei
  dettagli della linea «Altri cavi visti fra questi due oggetti»; il pulsante «◂ Elenco»; le ridondanze che escono
  dal lato giusto; in «Collegamenti ignorati» la riga del 14/10 con «non corrisponde a nessun cavo visto».
- **Con il ruolo dalle prove, subito dopo**: PC e server registrati come switch, e host classificati router senza
  prove, fuori dall'albero, in «Da sistemare» col motivo; gli oggetti di rete senza collegamenti in «Da sistemare»,
  «nessun collegamento» (sull'hub una radice sola; sul cliente A la radio lontana a 60 GHz, fino a T3); la voce «Ruolo
  nella mappa»; nei dettagli della linea «Perché questo collegamento».
- **Con le letture in più**: la mappa **identica**, anche dopo averle accese; in «Dati della mappa» le letture in più,
  tutte spente, e, per gli amministratori, «Cosa cambierebbe con la mappa nuova (una linea per cavo)».
- **Alla fine, con la mappa nuova accesa per il cliente**: le parole sulle linee, il segmento della WAN sotto la porta
  della WAN di router 1, i due cavi bloccati di core 2 (a richiesta, contati nel «⇄ N») e l'anomalia, i ponti radio
  con le radio sulla linea, il tunnel, i fasci, le linee doppie fra gli stessi apparati, «Candidati per porta»; se la
  misura lo conferma, i collegamenti «dalle VM» che nessun'altra lettura vede solo nei dettagli dell'hypervisor.

## 13.11 Tappe e livelli

Ogni push su `dev` è un rilascio: l'appliance del cliente A fa pull, build e riavvio ogni 15 minuti, e l'hub segue
`dev` (CONTEXT §3). Quindi si lavora in un worktree da `origin/dev`, e `dev` riceve solo una tappa finita, misurata e
confermata. Tornare indietro = `git revert` del commit di unione, `npm run version:release`, push.

**Le altre appliance seguono `main`**, che avanza solo con la promozione fatta dall'app (CONTEXT §3): una tappa arriva
a ogni altro cliente il giorno della promozione, con il lettore nuovo, il significato nuovo degli «Ignora» salvati e,
in T2, la migrazione. Per questo ogni tappa dice quando si promuove e che cosa si controlla prima, in sola lettura,
su ogni appliance (con l'ok di Riccardo).

| Tappa | Contenuto | Livello | Si promuove a `main` |
| --- | --- | --- | --- |
| T1 · Correzione rapida e disegno | l'elenco di D1, con le regole che servono a non riaprire incidenti noti; la regola del segmento (decisa: in T1); «Altri cavi visti fra questi due oggetti» (le frasi «Perché» vanno in T1b); dal passaggio universale (13.16): la porta fisica e il bridge dalla forma e mai dal nome, il conto per apparato, una VM mai padre del suo hypervisor, la testa non per id, la velocità dei nomi doppi | leggero | dopo una settimana senza ritorni su cliente A e hub, e dopo il conteggio delle correzioni salvate su ogni appliance |
| T1b · Ruolo dalle prove | rilascio a parte, subito dopo T1 (13.15, punti 3 e 6): D6 con le prove aggiunte, «Ruolo nella mappa», le frasi «Perché questo collegamento»; dal passaggio universale: nessuna radice sola, «hypervisor» solo con una prova, `disabled` non è una prova di spanning tree | leggero | una settimana dopo il suo rilascio, senza ritorni |
| T2 · Letture in più e traccia | schema, lettori spenti, modello per cavo in ombra, «Cosa cambierebbe» | **completo** (schema e scritture nei DB dei clienti, letture nuove sui loro apparati) | dopo spazio libero, `quick_check` e copia su ogni appliance |
| T3 · Una linea per cavo e albero dallo spanning tree | la pagina per cavo, segmenti, parole, correzioni per cavo, interruttore per cliente | **completo** | spenta: arriva ai clienti col modello di T1 attivo |

**Uscite vere da incollare** (sola lettura, una volta, prima del codice della tappa; diventano fixture rese anonime):

| Nome | Che cosa | Prima di |
| --- | --- | --- |
| T1-a | **fatto il 14/10 sera** sul router 1: `/ip neighbor print terse` (un estratto) e `print detail without-paging` (completo); `discovered-by` c'è anche nel terse (13.5.2). Router 2 e router di riserva: facoltativi | T1.2 |
| Hub | **fatto il 14/10 sera** sui quattro router MikroTik dell'hub (RouterOS 7.24): MK1-MK8, il JSON, lo script unico con `:parse` e `on-error`, un `[find]` vuoto, un errore non catturato; una connessione per router, circa un secondo (13.5.2). Dà la forma di tutti i comandi in RSTP, non in MSTP | T1.1 (fixture con bridge e VLAN dai nomi scelti), T2.2 |
| T2-a | MK3-MK8 su router 1, in più `exec` e nello script unico, anche con `[find]` vuoto; MK5-MK7 su router di riserva, router 2 e router 3 (dicono regione e radice); lo script unico e il JSON con `detail` anche sul RouterOS più vecchio fra i clienti. Dopo la lettura dell'hub serve soprattutto per la forma con MSTP e per le versioni prima della 7.24 | T2.2 |
| T2-b | `lldpcli -f json0 show neighbors details` e `ip -d -j link` dal nodo di prova dell'hub con `lldpd` (13.5.5) | T2.5 |

### 13.11.1 T1: rapida, rilasciabile da sola (D1)

**Stato (15/10): pronta, non rilasciata.** Codice sul ramo `topologia/collegamenti-t1`; misura «dopo» sulle copie
del 15/10 notte (con l'orologio del «prima»), C19, C18 e prova di ritorno R6, revisione finale, verifica a schermo a
1280 e 1920 e cancello completo fatti il 15/10. Aspetta la conferma di Riccardo (punto 5 delle «Conferme», sotto).
Le decisioni prese: ADR 0015.

| Pezzo | Contenuto | File |
| --- | --- | --- |
| T1.0 | **misura e scenari**, fatti per primi: `scripts/misura-cavi.ts` e gli scenari S0-S4 (13.12.1), con C10 e C11; salva l'uscita del codice di oggi sulle due copie come «prima», con la data dell'ultima lettura delle VM di ogni hypervisor (R1); una riga per criterio generale G1-G17 (13.3.0) | `scripts/misura-cavi.ts` (nuovo) |
| T1.1 | l'uscita incollata da Riccardo (T1-a) e quelle dei router dell'hub → fixture anonime con la forma vera (13.12.2: una riga per vicino, `\r\n`, valori senza virgolette, bridge e VLAN dai nomi scelti, membri di un fascio nel bridge, lo stesso apparato con più MAC); `PORTA_GENERICA` allargata ai nomi di serie (13.12.2); le due fixture del modello riestratte; le reti-campione delle famiglie 1, 2 e 4 per la parte di T1 | `src/lib/devices/__tests__/fixtures/`, `src/lib/topology/anonimizza.ts:30-41`, fixture del modello |
| T1.2 | lettore di `/ip neighbor`: valori interi, `mikrotikProtocol` (13.5.2); la parola «annuncio di rete (MNDP o CDP)» per le righe `mndp` | `router-client.ts:1077-1101`, `edge-look.ts:115-116` |
| T1.3 | ingresso del modello: tutte le porte di ogni apparato (indice, nome, velocità, stato), la via di lettura degli apparati, la piattaforma remota dei vicini, il filtro sulle fonti (`device`, `unifi`) nel modello e nell'attribuzione degli host; i traduttori (il contenitore dalla forma, un nome scelto «non noto», il MAC d'interfaccia di RouterOS: 13.6.1); la chiave della porta e la velocità dei nomi doppi; passi 0-6 del 13.7.1, con la porta fisica `true` per le regole del router e il conto per apparato (13.6.4) | `db-tenant.ts` (`getTopologyModelInput`, `:9117-9165`), `model-types.ts` (`:127-133`, `:159-181`), `fixture-anonime.test.ts` (`FORMA`, `:40-66`), `attribution/recompute.ts:85-93`, `lettori/` (nuovo), `cavi/porte.ts` (nuovo), `links.ts`, `link-attrs.ts` |
| T1.4 | «Ignora» per cavo, porte occupate, correzioni orfane, testi (13.9); le VM per cavo (13.7.1, passo 5); nessun collegamento fra una VM e il suo hypervisor, e i MAC propri dell'apparato che osserva fuori da VM, client e vicini (13.7.8) | `links.ts`, `attach.ts:48`, `:57-58`, `:124-129`, `vm-ports.ts:52`, `:72-87`, `:109`, `:111`, `:118-144`, `ignored-links.ts`, `map-menus.ts`, `topology-map-client.tsx` |
| T1.5 | pareggi: `chiaveScelta` (13.8.1); la testa proposta, a pari nodi raggiunti il gateway di più reti (13.8.1) | `tree.ts:44-58`, `:130-148` |
| T1.6 | «Altri cavi visti fra questi due oggetti» (serve all'«Ignora» per cavo); le frasi «Perché questo collegamento» stanno in T1b (13.15, punto 6) | barra dei dettagli (`topology-map-client.tsx`, `linked-panel.tsx`) |
| T1.7 | `candidatiLati` e `latiVicini` per schermo e stampa; etichette lungo il lato; elenco comprimibile (13.10.1-13.10.2) | `map-screen.ts`, `map-canvas.tsx`, `map-node.tsx`, `map-edge.tsx`, `map-toolbar.tsx`, `object-list.tsx`, `topology-map-client.tsx`, `print-draw.ts` |

**Perché è leggera.** Niente schema; nessuna scrittura nuova sui dati dei clienti, a parte il protocollo e i valori
interi che il giro dei router scrive già nelle sue colonne (lo vuole D1), con l'effetto sull'attribuzione misurato
(C18); nessun comando nuovo sui router (T1-a ha mostrato che `discovered-by` c'è anche nel terse, 13.5.2); l'unica
scrittura sul DB del cliente che il rilascio prepara è lo script di «Tornare indietro», che si usa solo se si torna
indietro e solo con la conferma di Riccardo. Tocca più file di quanto sembri: l'ingresso del modello, il suo tipo e le
fixture cambiano forma (T1.1, T1.3), e chi fa la revisione deve saperlo. Le regole 3c e «nessun cavo da
un'interfaccia logica locale» non sono
facoltative: senza, appena le righe del router diventano `lldp`, il falso cavo fra router torna (anche su
`ether1-2.5` o su una VLAN).

**Misure sulle copie, prima della conferma** (`misura-cavi`, codice di prima e codice di T1, copie fresche):

- cliente A: padri cambiati = core 1, accesso A e, per la regola del segmento, il router di riserva; le altre righe
  della sede 1 uguali; rami contro il verso 0; linee cucite 0 (oggi 1); correzioni orfane 1;
  S3 con core 1 sotto router 1; cavi 8 e 9 a 10G; collegamenti fra apparati, vicini non abbinati e attaccati prima e
  dopo il raggruppamento per apparato, ogni differenza spiegata; host che cambiano categoria per i valori interi
  (C18); le regole del passaggio universale una per una (C19);
- hub: i tre hypervisor sotto l'aggregazione (H9), nessun altro padre cambiato dai pareggi o dalla velocità; router –
  aggregazione su porta 31 ↔ `sfp28-2`; l'oggetto senza fili resta (H10); per la regola del segmento gli oggetti che
  stavano solo sulla porta 5 dello switch 48 PoE escono dall'albero e vanno in «Da sistemare», «nessun collegamento»
  (elenco per nome, solo in chat); nessun oggetto appeso al router da un'interfaccia col nome scelto a mano (13.7.1,
  «Quattro trappole»), e nessuna linea del router da una VLAN (H7: restano i due cavi veri verso il router di
  frontiera); nessun oggetto sotto una sua VM (H15; H13 con la velocità dei nomi doppi); la testa resta il router
  (H17); host che cambiano categoria (C18, anche qui); le radici restano quelle di prima; la data della lettura delle
  VM di ogni hypervisor (R1); ogni altro cambio spiegato, o il rilascio non parte;
- reti-campione: una riga per criterio generale di T1 (G1-G10 per la parte di T1, G14 per il senza fili, G17), sulle
  cinque famiglie inventate, e a parte le misure sulle due reti vere (H5-H7, H13, H15, H17, C19) sulle fixture
  (13.12.2);
- prova di ritorno (R6), con le righe vecchie e nuove del router insieme e con `lldp` su tutte le righe fra router;
  ritocchi delle mappe salvate (R2), contati per orientamento (i 7 della sede 1 sono in orizzontale);
- tempo del modello ≤ 20 ms. Il margine è stretto: sul Mac, col dato del 14/10, il cliente A misura circa 15 ms con
  T1 e fino a 18 ms con T1b, e l'appliance è più lenta.

Misurato il 15/10 col codice del piano corretto dalla revisione, sulle copie del 14/10: cliente A con i soli tre
padri attesi, nessuna radice in più (C16: 2), contro il verso 0, cucite 0, correzione orfana 1, i ritocchi della mappa
passo passo della sede 1 validi 4 su 7 (R2); hub con i tre hypervisor (H9), i tre switch di laboratorio in «Da
sistemare» (H5), le radici di prima, nessun hypervisor sotto il router. Le regole entrate col passaggio universale del
15/10 (13.16) sono ragionate sui dati e sul codice, **non ancora misurate** col modello: la misura di T1.0 le conta una
per una, e una regola che cambia un padre non spiegato resta fuori da T1.

**Conferme.**

1. La bozza (13.10.4): va a Riccardo con i numeri del rilascio; le sue correzioni entrano nel giro di correzioni,
   prima del cancello.
2. **Una** revisione finale dell'intero lavoro; prove mirate durante il lavoro; verifica a schermo una volta, a 1280 e
   1920.
3. Il cancello completo **una volta**: `npm run lint && npx tsc --noEmit && npm test && npm run build`, esito dal
   codice d'uscita.
4. I numeri a Riccardo; gli oggetti che cambiano padre o escono, per nome, **solo nella chat**, mai nel repo.
5. La conferma di Riccardo, chiesta una volta e per esteso, per tre cose insieme: il push su `dev` (un rilascio al
   cliente A), l'aggiornamento dell'hub, e il ritorno indietro («Tornare indietro», sotto) se i controlli dopo il
   rilascio vanno male. Poi `npm run version:release`, `git push origin dev`, e l'hub con lo script di aggiornamento.
6. **Prima della promozione a `main`**: su ogni appliance, in sola lettura, `SELECT action, COUNT(*) FROM
   topology_link_overrides GROUP BY action;` e `SELECT COUNT(*) FROM topology_link_primary;`. Se ci sono «Ignora» o
   ★, si guardano con Riccardo prima di promuovere: un «Ignora» fatto per coppia diventa orfano o nasconde un altro
   cavo.

**Controlli dopo il rilascio.**

- Il processo è davvero ripartito, **col commit del rilascio**: `ActiveEnterTimestamp` dopo l'ora del push e la riga
  d'avvio nel journal del servizio; il commit dalla riga «nuovo commit su origin/dev (‹hash›)» nel journal di
  `da-ipam-update` (sull'hub, il commit della cartella dell'app). Non `/api/version`, che cambia prima del riavvio
  (CONTEXT §6). Tempo massimo circa 30 minuti (il timer gira ogni 15 minuti, più la build): se il servizio non è
  ripartito, si legge il journal di `da-ipam-update` e si avvisa subito Riccardo, perché una build fallita lascia
  acceso il processo di prima (CONTEXT §3).
- I conteggi di `GET /api/topology/model` si confrontano con quelli di una copia presa subito prima del riavvio,
  passata al codice nuovo: sono uguali finché il router non si rilegge; dopo la prima lettura oraria cambiano apposta
  le righe del router 1 (protocollo e porte remote) e le linee che ne dipendono, e ogni differenza si spiega.
- **Q-T1**, alla prima lettura oraria del router 1 dopo il riavvio, sull'impianto, in sola lettura:

  ```sql
  SELECT protocol, COUNT(*), SUM(remote_port LIKE '% %')
    FROM device_neighbors
   WHERE device_id = <router 1> AND timestamp >= '<ora del riavvio, UTC>' GROUP BY protocol;
  ```

  e, per i valori troncati, il **confronto con l'uscita vera salvata**: le righe nuove del router contro quelle che il
  lettore legge dall'uscita incollata (T1-a), per porta locale e MAC remoto, contando le porte remote diverse. È neutro:
  l'elenco dei valori troncati dipende dalla rete (sul cliente A «Port» e «Mikrotik», sull'hub altri) e il confronto non
  lo contiene. Misurato il 15/10 sulle copie, con le righe del lettore di prima: 3 diverse sul cliente A e 4 sull'hub,
  dove una query coi valori del cliente A ne avrebbe viste 0. Atteso: righe `lldp` più di 0, porte remote con lo spazio
  («Port 47»), 0 porte remote diverse. Se `lldp` resta a 0, o le porte diverse ci sono, il formato non è quello della
  fixture: **non si indovina**, si guarda l'uscita. Sull'hub la stessa query e lo stesso confronto (con l'uscita del suo
  router, 14/10 sera; H16), alla prima lettura dopo l'aggiornamento (le scansioni veloci lo leggono ogni 15 minuti):
  righe `lldp` più di 0, tutte su porte fisiche, porte remote intere, 0 diverse.
- Riccardo: apre la mappa automatica e guarda dove sta core 1; apre i dettagli della linea; apre «Dati della mappa →
  Collegamenti ignorati» e sulla riga del 14/10 sceglie «Togli la correzione». Se va bene: core 1 sotto router 1, con
  «10G». Se va male: core 1 ancora sotto accesso A; lo dice, e si guardano i conteggi del modello prima di toccare
  altro.

**Tornare indietro**: `git revert`; non c'è schema da togliere. I dati del lettore nuovo restano: righe con
protocollo `lldp` e porte remote intere, accanto alle vecchie, per 90 giorni. La prova di ritorno (R6) dice se il
codice di prima, con quelle righe, dà la mappa di prima anche nel caso peggiore. Se non regge, tornare indietro vuol
dire anche rimettere `mndp` sulle righe che il lettore nuovo ha scritto col protocollo vero (quelle dei MikroTik letti
via SSH, dall'ora del rilascio): il lettore di prima scriveva sempre `mndp`, quindi il codice di prima ritrova i dati
che conosce. È una scrittura sul DB del cliente, con la conferma di Riccardo, e lo script si scrive e si prova sulla
copia **prima** del rilascio. Lo script stampa il testo SQL, che si manda all'impianto da stdin come le altre
interrogazioni: dopo il ritorno non serve nessun file del repo sull'impianto. Prima si salva una copia delle righe
che si toccano.

Misurato il 15/10 sulla copia del 14/10 del cliente A, con il detail incollato del router 1 (revisione del piano):
col codice di prima le righe nuove danno gli stessi padri; nel caso peggiore (`lldp` fra router dai due lati) un
padre cambia, quindi lo script serve; dopo lo script i padri tornano quelli di prima. Nessun host cambia categoria
per i valori interi (C18).

### 13.11.2 T1b: il ruolo dalle prove (D6)

| Pezzo | Contenuto | File |
| --- | --- | --- |
| T1b.1 | `proveDiRuolo`, `classeInMappa` (13.8.2), con «hypervisor» solo con una prova e lo stato di spanning tree solo se attivo; nessuna radice sola: gli host di classe «infra» e «ap» senza collegamenti in «Da sistemare», «nessun collegamento» (13.8.2, G10) | `cavi/ruolo.ts` (nuovo), `tree.ts:122-127`, `attach.ts`, `object-list.tsx`, `model.ts:60-67` |
| T1b.2 | «Ruolo nella mappa» e la rotta `PATCH /api/topology/nodes/role` | `map-menus.ts`, `app/api/topology/nodes/role/route.ts`, `api-input.ts` |
| T1b.3 | «Perché questo collegamento» in forma corta (13.4.6): le frasi con le fonti di oggi e il motivo delle righe scartate sulla coppia (13.15, punto 6) | `cavi/frasi.ts` (nuovo), barra dei dettagli (`topology-map-client.tsx`, `linked-panel.tsx`) |

Un rilascio a parte, subito dopo T1 (13.15, punto 3). Leggero: nessuno schema (`topology_role` c'è), scritture solo
per mano di un admin. Si rilascia dopo almeno una lettura oraria col lettore di T1, perché la prova «si annuncia come
apparato» è pulita solo sulle righe nuove; per lo stesso motivo **la misura si fa su una copia presa dopo quella
lettura** (13.8.2). Misure: l'elenco per nome di chi esce, su tutte e due le copie, guardato con Riccardo prima del
rilascio (solo in chat), con a parte chi resta solo per una prova aggiunta a D6, chi esce perché non ha collegamenti
(sull'hub i cinque oggetti di H14; sul cliente A la radio lontana a 60 GHz, C16) e gli switch visti solo via LLDP che
escono finché le capacità non arrivano (13.8.2); radici della mappa automatica (H14, C16); nessun altro padre cambiato;
una riga per G9 e G10 sulle reti-campione. Conferme come T1.

**Stato (15/10):** pronta sul ramo `topologia/collegamenti-t1b` (dopo T1, rilasciata in v0.3.284), misurata sulle copie
prese dopo la lettura del router col lettore nuovo, vista a schermo a 1280 e 1920, cancello completo verde; **non
rilasciata**, in attesa della conferma di Riccardo sull'elenco di chi esce.

### 13.11.3 T2: letture in più, spente, con la traccia (D4)

| Pezzo | Contenuto |
| --- | --- |
| T2.1 | `migrateTopologyCavi` (13.5.7), con l'annotazione «schema presente» all'apertura; potatura nelle tabelle nuove |
| T2.2 | MikroTik: MK1 (parte di T2), MK2 dall'uscita di oggi, MK3-MK8 in più `exec` sulla stessa connessione, nel ramo dei router e in quello degli switch MikroTik, dietro `topologia.lettura.mikrotik`; nel trasporto il tempo massimo per comando; la cadenza propria e il lucchetto per apparato (13.5.1). I lettori sulle forme vere (13.5.2): le tabelle di `monitor` per colonne, il bridge-id dalle due forme, gli errori dal testo e non dal codice d'uscita, i BPDU ricevuti (`bpdu_rx`); `stp-ssh.ts` passa a MK3 e MK5. La parte di MK1 di T1 resta sempre accesa (confermato il 14/10 sera, 13.15) |
| T2.3 | campi del controller (13.5.3), compreso il parser `unifi-device.ts`, dietro `topologia.lettura.controller`; prima, su un controller con un gateway, se l'indice della porta c'è anche per le righe del gateway, e la fixture estesa con un gateway e un Flex Mini (13.5.3) |
| T2.4 | SNMP SN2-SN9 (13.5.4) nel ramo degli switch di `runArpPoll`, con la cadenza propria, dietro `topologia.lettura.snmp`; SN1 come correzione della lettura a mano |
| T2.5 | `lldpcli` in un comando a parte, stato e MAC permanente dei membri dei bond in `hypervisor_sync`, dietro `topologia.lettura.host` |
| T2.6 | «Letture in più per la mappa», l'esito per apparato, e `PUT /api/topology/settings/letture` (13.5.6) |
| T2.7 | **la traccia**: il modello per cavo (`cavi/prove.ts`, `cavi/collegamenti.ts`, l'albero del 13.8.3; nel suo ingresso anche `device_interfaces`, nella query di `macApparati`, solo per l'identità, 13.5.7) calcolato **in ombra**, e la sezione «Cosa cambierebbe con la mappa nuova (una linea per cavo)», servita da `GET /api/topology/traccia` (`src/app/api/topology/traccia/route.ts`), con `requireAdmin` come prima istruzione e dichiarata in `ATTESI` di `src/lib/permessi/rotte.ts` (un GET si aspetterebbe `auth`) |

**La traccia** («qui avrei scelto X») è il freno con traccia contabile. La mappa a schermo non cambia, **nemmeno a
letture accese**: il modello di T1 non legge niente di ciò che T2 scrive (13.5.7, «Chi legge che cosa»; R7, I33). In
«Dati della mappa», solo per gli admin, una sezione calcolata a richiesta, in memoria e senza scrivere niente
(`cavi/traccia.ts`, `confrontaAlberi`): quanti oggetti avrebbero un altro padre, quanti collegamenti nuovi per genere
(bloccati, instradati, fasci, tunnel, ponti radio), quanti segmenti, quali oggetti entrano o escono dall'albero, quante
anomalie; poi una riga per differenza, «‹oggetto› · padre oggi ‹A› · con la mappa nuova ‹B› · perché», con un limite
e «+ altri N» (CLAUDE.md del repo, regola 9). Non si calcola a ogni apertura della mappa: il calcolo dell'albero non
raddoppia. Il freno si toglie contando: la mappa nuova si accende per un cliente quando ogni differenza è
spiegata (13.15, punto 5; 13.11.4).

**Misure sulle copie.**

- La migrazione su una copia della copia di ogni tenant: durata, `integrity_check` prima e dopo, seconda apertura che
  non aggiunge niente.
- `misura-cavi` con le letture **spente**: mappa identica a quella di T1, bit per bit. E con le letture **accese**
  sulle fixture di T2: la mappa di T1 ancora identica. Sono le due prove che il freno frena.
- I lettori sulle fixture con la forma vera (uscite T2-a e T2-b rese anonime; fixture del controller estesa).
- La traccia sulle copie, con le fixture di T2.
- Con le letture accese, le classificazioni degli host sulla copia uguali a prima: le fonti nuove non entrano nell'attribuzione (13.5.7).
- Il carico si misura solo su un impianto, sul percorso vero (sotto).

**Conferme e ordine di accensione.**

1. Il rilascio con tutto spento, con la conferma di Riccardo, perché la migrazione tocca i DB dei clienti. Prima:
   lo spazio libero (`df`: il DB dell'hub pesa 2,1 GB), `quick_check` di **tutti** i tenant della macchina e copie con
   l'API di backup in `data/backups/<tenant>-pre-topologia-cavi-<data>.db`. Dopo: la riga della migrazione nel journal.
2. **T2-a**: Riccardo esegue una volta a mano, in sola lettura, i comandi di MK3-MK8 sul router 1 (in più `exec` e
   nello script unico, anche con `[find]` vuoto), e MK5-MK7 su router di riserva, router 2 e router 3, e incolla le
   uscite. Diventano le prove dei parser e decidono se lo script unico regge. Sull'hub la stessa lettura è già fatta
   (14/10 sera, 13.5.2): forme in RSTP, script unico, `[find]` vuoto ed errori sono visti su RouterOS 7.24; dal
   cliente A servono la forma con MSTP sulla sua versione (7.24.4).
3. **Prima l'hub** (apparati nostri): `topologia.lettura.mikrotik`, con la durata delle scansioni veloci e il numero
   di connessioni SSH al router prima e dopo, e le righe scritte per tabella; poi `topologia.lettura.controller`; per
   `topologia.lettura.snmp` la durata del giro degli switch e il numero di letture SNMP per switch; si guarda «Cosa
   cambierebbe».
4. **Poi il cliente A**, con la conferma di Riccardo, dopo i numeri dell'hub.
5. **Niente attese a calendario finché la mappa è in sviluppo** (decisione di Riccardo, 15/10 notte, che sostituisce
   la «data di revisione una settimana dopo»): accese le letture in più di un cliente, dopo **un giro** si guardano
   i numeri e «Cosa cambierebbe»; spiegate le differenze, si va avanti subito (13.15, punto 5). T3 parte dopo almeno
   un giro di letture accese sull'hub e sul cliente A. Il freno non resta acceso per dimenticanza perché il passo
   successivo dipende da quei numeri, non da una data. La promozione a `main` resta a parte, con la conferma di
   Riccardo.
6. `topologia.lettura.host` solo dopo il nodo di prova (13.5.5) e la sua uscita vera (T2-b).
7. **Prima della promozione a `main`**: su ogni appliance, con l'ok di Riccardo, spazio libero, `quick_check` e copia
   di backup; la migrazione arriva lì al primo avvio dopo il pull.

**Tornare indietro**: si spegne l'interruttore, senza codice; oppure `git revert`, e le tabelle nuove restano, non
lette. Le righe delle fonti nuove (`snmp`, `host`, `ssh`) restano in `device_neighbors` e il modello di T1 non le
legge, e nemmeno l'attribuzione degli host: il filtro sulle fonti c'è da T1 (13.5.7).

**Stato (15/10):** pronta sul ramo `topologia/collegamenti-t2` (ADR 0018), cancello completo verde, **non
rilasciata**: aspetta la conferma di Riccardo per il rilascio con tutto spento. Senza T2.5 (lettura dell'host) e
senza MK7 (istanze MSTP): mancano le uscite vere T2-b e T2-a, e la pagina le dice «non disponibili». Misure sulle
copie (Task 14): migrazione su 4 tenant in 7-22 ms per apertura, `integrity_check` invariato, seconda apertura senza
modifiche; impronta del modello di T1 identica prima di T2, a letture spente e a letture accese, sull'hub e sul
cliente A; classificazioni degli host invariate; traccia sul cliente A 0 padri diversi e 1 anomalia, sull'hub 1
padre diverso dovuto alla velocità di una porta col nome doppio che il modello per cavo non cercava (regola I70 di
T1), corretto nella revisione finale: dopo, 0 padri diversi sulla stessa copia e alla stessa ora. Tempo del modello
di T1 sul cliente A uguale prima e dopo T2 (circa 18 ms), modello per cavo 27-43 ms, solo a richiesta. A schermo
(Task 15, 1280 e 1920 px) la mappa è identica a prima di T2. Le letture SNMP sono 16 (colonne usate e scalari dello
spanning tree, invece delle tabelle intere che in v1 non stanno nei 10 s). Fatti del controller visti sull'hub (P5,
13.5.3): le righe LLDP del gateway portano l'indice della porta locale; i campi del partner LACP sono `partner_system_id` e
`lacp_state` (non letti in T2: la loro forma non è misurata), e il gateway non ha fasci; il MAC «+ 1» compare nella tabella ethernet di 7 switch su 12; il Flex Mini
si annuncia col modello `USF5P`.

### 13.11.4 T3: una linea per cavo e albero dallo spanning tree (D1, D2, D5)

| Pezzo | Contenuto |
| --- | --- |
| T3.1 | il modello per cavo dall'ombra alla pagina: id della linea per collegamento; «⇄ N» che conta i collegamenti e non più le coppie (`map-screen.ts:110-117`; completa §12.5); menu, pannello dei collegati, verifica dei collegamenti a mano per cavo (sostituisce §11.3, «Verifica», 13.9) e principale (`link-attrs.ts:105-106`) per collegamento; `vm-ports.ts` per cavo, con le regole dei collegamenti «dalle VM» (13.7.2, passo 10); elenco «Cavi di ridondanza» della stampa con lo stato |
| T3.2 | il segmento come nodo (oggi il tipo di nodo è solo `device` o `host`, `model-types.ts:183-186`, e 11 file lo guardano), con l'id `seg:` e la sua risoluzione; `api-input.ts` (`:51`, `:58`, `:65`) e le prove delle rotte (13.7.3); radio sulla linea; contrazione nelle mappe passo passo (13.7.7) |
| T3.3 | albero dallo spanning tree con la chiave del 13.8.3, testa, anomalie ed elenco «Anomalie della rete», seconda partenza, «★ non applicabile»; l'uplink di un gateway del controller come WAN e `disabled` che inoltra (13.8.3, punto 1); il fascio dedotto solo con lo spanning tree fra i due capi (13.6.3); i tunnel di livello 3 (13.7.5); router e firewall virtuali dentro il loro hypervisor (13.7.8) |
| T3.4 | correzioni per collegamento, ★ di prima, ruoli «Core» e «Accesso» (13.9); «tunnel» in `MEDIUM` di `api-input.ts:66` e in `MEDIA` di `link-attrs.ts` |
| T3.5 | forme e parole (13.10.3), oggetto segmento, «Candidati per porta», stampa in bianco e nero |
| T3.6 | l'ordine dell'abbinamento «telaio, nome, IP dalle righe fisiche» (13.6.4) |
| T3.7 | l'interruttore `topologia.mappa.cavi`, **spento**: il modello di T1 resta finché il cliente non si accende |

**Misure sulle copie.** Prima di T3 le righe 12-17 della tabella 13.3.1 si riscrivono con le uscite vere di T2-a. Le
misure si fanno con `misura-cavi` e l'interruttore acceso in memoria, su una copia del cliente A presa **dopo almeno
un giro con le letture accese** (accenderle chiede la conferma di Riccardo, 13.11.3) e su una copia dell'hub presa
allo stesso modo: i collegamenti della sede 1 confrontati con la tabella 13.3.1 **riga per riga**; C13-C17 e H1-H21;
una riga per ogni criterio generale G1-G17 sulle cinque famiglie di reti-campione (13.3.0, 13.12.2).
Per la regola dei collegamenti «dalle VM» (13.15, punto 4): per ognuno che non è il principale del suo hypervisor,
quante VM, su quale switch e porta, e se l'uplink di quello switch è riconosciuto; la regola entra se la misura
conferma che nessun'altra lettura li vede.
Il prototipo di lavoro (fuori dal repo, nella cartella di lavoro dell'indagine) fa da oracolo per le righe 1-11 della
sede 1; per l'hub non riproduce l'albero di oggi, perché i tre hypervisor cambiano padre già con la correzione rapida
(H9). Poi mappe salvate (oggetti e ritocchi); a schermo e in stampa a 1920 e 1280, in verticale e in orizzontale.

**Conferme**: bozza, una revisione finale, cancello una volta, numeri a Riccardo, conferma. Il rilascio è spento;
l'accensione è per cliente, prima l'hub e poi il cliente A, ognuna con la sua conferma e solo quando ogni differenza
di «Cosa cambierebbe con la mappa nuova» è spiegata (13.15, punto 5): appena lo è, senza aspettare una data
(decisione del 15/10 notte, 13.11.3 punto 5).

**Togliere il ramo vecchio**: quando tutti i clienti sono accesi e le loro differenze spiegate, con l'ok di Riccardo
(non a tempo: decisione del 15/10 notte, 13.11.3 punto 5), si toglie il modello
di T1 e l'interruttore (13.13.3, punto 1), e con lui il ripiego «porta del bridge = ifIndex» di `snmp-port-schema.ts`
(13.5.4).

## 13.12 Prove

### 13.12.1 Scenari sulle copie

`scripts/misura-cavi.ts <percorso del DB> [--nomi] [--confronta <istantanea.json>]` (pezzo T1.0) legge **una copia**
passata come argomento (il percorso non sta nel repo). Stampa solo conteggi; con `--nomi` stampa i nomi a terminale,
mai su un file del repo:

- collegamenti per fonte, fra apparati, «non visti», con una porta vuota, «cuciti» (due porte piene che nessuna prova
  sola ha, compresa la porta riempita dalle VM; oggi 1 sul cliente A, 2 senza la correzione del 14/10, 1 sull'hub);
- rami contro il verso; radici; padri cambiati rispetto all'istantanea;
- ritocchi validi e scaduti per mappa; «Da sistemare» per motivo; correzioni orfane;
- da T1: linee che fanno il giro o attraversano un riquadro (C10, C11), con `candidatiLati` e `latiVicini` sulla
  disposizione;
- da T3: segmenti, fasci, tunnel, instradati, bloccati, giù, anomalie.

Scenari costruiti in memoria sull'ingresso del modello:

| Scenario | Tappa | Atteso |
| --- | --- | --- |
| S0 dato vero | T1 | C1, C2; la riga del 14/10 orfana |
| S1 senza correzioni | T1 | come S0 |
| S2b porte di T1 e regola del segmento | T1 | la tabella 13.3.1, colonna T1 |
| S3 senza l'uplink di core 1 | T1 | core 1 sotto router 1 (10G contro 2,5G) |
| S4 righe del router come le scrive il lettore nuovo, **insieme** a quelle vecchie, e con `lldp` su tutte le righe fra router, dai due lati (caso peggiore) | T1 | gli stessi padri; la riga su `ether8` non conferma niente; nessun collegamento fra router su una VLAN o sul tunnel, né col codice nuovo né con quello di prima (R6). Misurato il 15/10 col codice nuovo: una sola differenza, un oggetto che resta senza collegamenti su una porta diventata di segmento e va in «Da sistemare» (sul cliente A la radio lontana a 60 GHz, che oggi è la seconda radice); da mostrare a Riccardo. Col codice di prima R6 non regge nel caso peggiore: serve lo script di «Tornare indietro» (13.11.1) |
| S9 cavo spostato: una porta con il vicino di ieri, non visto da più della soglia, e quello nuovo | T1 | nessun segmento; il cavo nuovo c'è, il vecchio è «non visto» |
| «letture spente» | T2 | mappa identica a T1 |
| «letture accese», con le fixture di T2 | T2 | **la mappa di T1 identica**; la traccia dice la colonna T3 della tabella 13.3.1 |
| S5 stati di oggi del controller | T3 | i cavi 1-11 e il segmento; 8 e 9 bloccati; anomalia su core 2 |
| S6 spanning tree del router simulato: radice router 1, poi radice core 1 | T3 | lo stesso albero nei due casi (nel secondo il cavo 1 è «contro verso», ma è l'unico percorso attivo) |
| S7 «Ignora» sul cavo 1 | T3 | sparisce solo il cavo 1; segmento e cavo 2 restano |
| S8 MAC degli apparati simulati (`ethernet_table` con il «MAC + 1»: sull'hub su 7 switch su 12, 13.5.3) | T3 | il cavo 2 diventa «certo» |
| S10 segmento della WAN (13.15, punto 1) | T3 | sotto router 1 `ether8`; la porta 15 di core 1 e `ether8` del router di riserva membri, come ridondanze; nessun altro padre cambia |
| S11 collegamenti «dalle VM» che non sono principali e che nessun'altra lettura vede (i tre verso l'hypervisor 2) | T3 | non disegnati, nemmeno a richiesta; nei dettagli dell'hypervisor «visto dalle VM anche su ‹porta›»; i principali uguali |
| S12 lettura delle VM rinnovata (simulata: la VM del firewall virtuale spenta, un'altra accesa al suo posto) | T1 | nessun oggetto sotto una sua VM, né con la lettura vecchia né con quella nuova (H15); la misura dice quale lettura ha usato (R1) |
| H1, H2, H9, H10 hub | T1 | padri del controller uguali; porta 31 ↔ `sfp28-2`; i tre hypervisor sotto l'aggregazione; l'oggetto senza fili resta |
| H7, H15, H16, H17 hub | T1 | nessuna linea del router da una VLAN, restano i due cavi veri verso il router di frontiera; nessun oggetto sotto una sua VM; righe `lldp` vere del router, con le porte remote intere; la testa resta il router |
| H14 hub | T1b | una radice sola; i cinque oggetti di rete senza collegamenti in «Da sistemare», «nessun collegamento» |
| H3-H8, H11-H13 hub | T3 | fascio; «Da sistemare»; segmento sulla porta 5; niente segmenti da «eth0»; niente cavi da «VL_…» per ogni marca, coi tipi simulati; anomalie; gateway con l'uplink come WAN e «porte da verificare»; nessun AP con due linee; nessun hypervisor sotto una porta spenta o sotto una sua VM |
| H18-H21 hub | T3 | il fascio verso il NAS dal partner LACP; gli switch senza spanning tree senza anomalie; nessun fascio dedotto fra porte di bordo, instradate, o WAN e LAN; il router di frontiera, se censito, sotto l'aggregazione con i due cavi diretti instradati |

### 13.12.2 Dati finti con la forma vera: reti-campione per ogni famiglia (vincoli 4 e 9)

**I nomi di porta nelle fixture.** L'anonimizzatore tiene i nomi «di serie» e cancella gli altri (`PORTA_GENERICA`,
`anonimizza.ts:30-41`), ma fra quelli che cancella ci sono proprio i nomi su cui si basa T1: nella fixture del cliente
A 329 nomi di porta su 676 sono «porta-N». In T1.1 `PORTA_GENERICA` si allarga ai nomi di serie che mancano, che non
dicono chi è il cliente: «SFP+ N», «SFP_ N», «SFP N», una porta di fabbrica con la velocità in coda come la legge il
traduttore (13.6.1: «-10g», «-2.5»; non un intero né un numero col punto), i suffissi «,bridge» e «,bondN», il
prefisso «bridge/» seguito da un nome di serie; dalle uscite dell'hub anche `sfp28-N` e «SFP28 N». Nessuna forma
vista solo su un cliente: un nome VRRP scelto dal cliente diventa uno pseudonimo che resta logico (`vrrp-porta-N`).
Accanto a `PORTA_GENERICA` c'è un **secondo controllo che fallisce chiuso**: ogni pezzo di un nome di porta rimasto
uguale al vero dev'essere in un elenco chiuso di nomi di fabbrica, per prodotto, che non segue `PORTA_GENERICA`;
altrimenti l'estrazione non scrive la fixture. Verifica del 15/10: un'alternativa per «vrrpN» allargata al disegno
dei nomi del cliente A avrebbe pubblicato le sue cinque VRRP, e il controllo di allora (IP, MAC, nomi degli oggetti)
non guardava le porte; con l'elenco chiuso l'estrazione si ferma («5»). Un nome scelto dal
cliente per un bridge, una VLAN o un tunnel resta anonimo, ma con la sua **forma**: diventa un nome inventato dello
stesso disegno («BR_…», «VL_…»), perché le prove dei traduttori girino su un nome scelto e non su un nome di fabbrica.
Poi si riestraggono le due fixture: così chiave della porta, segmenti e conferma per porta girano sulla forma vera a
ogni `npm test`, non solo sulle copie.

**Reti-campione: cinque famiglie.** Il vincolo 9 chiede prove su reti **inventate** di più famiglie: ogni famiglia ha la
sua rete, con nomi, IP e MAC inventati, scritta nella forma vera delle sue letture, e la sua tabella attesa (i
collegamenti coi due capi, le chiavi di porta e il genere; stato e fiducia di ognuno; il padre di ogni nodo; gli
oggetti in «Da sistemare» col motivo). Per ogni famiglia la prova scrive, per ogni criterio generale G1-G17 (13.3.0),
passa, non passa, non applicabile o da fare, e il titolo di ogni prova nomina solo le famiglie che tocca. Una regola
nuova si scrive prima sulla famiglia dove nasce il caso, poi si guarda che le altre non cambino.

| Famiglia | Che cosa contiene | Forma delle letture | Tappa |
| --- | --- | --- | --- |
| 1 · Solo MikroTik | un router di testa con un bridge dal nome scelto, VLAN dai nomi scelti e annunci da ogni interfaccia; uno switch col nome di fabbrica del bridge; un fascio LACP di due cavi verso uno switch MikroTik di aggregazione, coi membri nel bridge e il CDP di uno switch dietro l'aggregazione inoltrato su un membro; un secondo router con la porta radice verso l'aggregazione e due cavi diretti verso il primo, fuori dal bridge e in due VRF, che il primo sente anche su due VLAN dai nomi scelti, e che sente il primo con più MAC; un router virtuale come VM di un hypervisor, con un tunnel WireGuard verso un router remoto, attraversato da MNDP in un verso solo; un EoIP nel bridge; un NAS dietro un fascio che vede solo la tabella MAC; la WAN come VLAN su due porte d'accesso. Le forme vengono dai casi nati sulla rete dell'hub; la rete no | le forme di RouterOS viste sulle due reti (13.5.2), rese anonime; per MSTP e T3 la forma che porterà T2-a | T1 per MK1 e il modello di T1; T3 per MK2-MK8 |
| 2 · Solo UniFi, col controller | un gateway che è anche controller (UDM) come unico router, con WAN e LAN verso lo stesso switch (la variante coi due switch diversi è quella dell'hub, che ne è la misura); switch con etichette scritte a mano sulle porte, «SFP_ N», «SFP+ N», «Port N» e un nome doppio; uno switch senza spanning tree (uplink `disabled` su una porta accesa); un AP cablato e uno in mesh; due switch di laboratorio dietro uno switch muto; per T3 porte giù con uno stato, un fascio con `lag_idx`, client Wi-Fi | la forma del controller (la fixture `unifi-stat-device.json` e le righe che il controller scrive), resa anonima | T1 per nomi, velocità e testa; T3 |
| 3 · Altre marche via SNMP | switch Cisco in Rapid-PVST e HP/Aruba in MSTP: un fascio («Po1», «Trk1»), CDP fra due Cisco e attraverso uno switch che lo inoltra, una porta bloccata, un'istanza MSTP; un router di un'altra marca, coi nomi di porta della sua marca | le forme delle MIB standard (LLDP-MIB, BRIDGE-MIB, RSTP-MIB, IEEE8021-MSTP-MIB, IF-MIB, LAG-MIB) e della documentazione dei produttori: porta locale LLDP tradotta da `lldpLocPortTable` («Gi1/0/24»), BRIDGE-MIB per VLAN (`community@vlan`) sui Cisco, `lldpRemPortId` locale numerico sugli HP/Aruba. **Non osservate su un apparato**: l'indipendenza dal prodotto va in un ADR solo dopo una lettura SNMP vera (13.5.4) | T1 per il traduttore generico (il router di un'altra marca non perde cavi); T3 |
| 4 · Con hypervisor | due nodi Proxmox con la gestione a 1G su uno switch di accesso e i dati a 10G sul core, uno su una porta con l'etichetta scritta a mano e l'altro su un bond attivo e di riserva di due porte col nome doppio; VM viste su tutte e due le porte di ogni nodo; una VM router e una VM firewall registrata come switch, che legge la sua tabella MAC (le sue schede e il suo hypervisor); schede che si annunciano con l'LLDP del firmware, senza nome; una lettura delle VM vecchia; un host classificato hypervisor senza VM né scansione | le righe del controller e della scansione delle VM (VM e host del cluster) nella forma dei lettori di oggi | T1 (velocità, VM e MAC propri, la misura C4), T1b («hypervisor» solo con una prova), T3 (G15) |
| 5 · Mista | un router MikroTik coi nomi di fabbrica (`bridge`, nessun fascio) e un router di riserva sul segmento della WAN con un modem; uno switch del controller e uno di un'altra marca via SNMP, con un telefono IP che si annuncia via CDP (classificato router) e un PC che vede solo la tabella MAC; l'annuncio di un router che attraversa lo switch fino all'altro; un ponte radio che si annuncia, oltre il quale il router di una sede si sente sulla stessa porta della radio | le forme delle famiglie 1-3 insieme | T1 (segmenti, nomi di fabbrica), T1b (il telefono: 13.16, scelta 8), T3 (il salto radio, G14) |

**Le due misure sulle reti vere.** Le fixture del modello riestratte dalle copie del cliente A e dell'hub, anonime, non
sono una famiglia: sono le misure dei criteri C e H (13.3.1-13.3.6) su due reti vere, provate accanto ai numeri che
fissano (`model-fixtures.test.ts`); se cambiano con una riestrazione, la causa si legge sulla copia. Fino alla verifica
del 15/10 erano la «famiglia 4», e la famiglia 1 era dichiaratamente la forma della rete dell'hub: le famiglie
inventate non avevano un hypervisor, e diverse prove promettevano famiglie che non toccavano. Ciò che quella famiglia
elencava (MSTP con la radice regionale, un core che esce da uno switch di accesso, un cavo bloccato, il segmento della
WAN con due router, ponti radio, tunnel EoIP, bond `balance-rr`, `lldpd` su un host, PC registrati come switch, host
classificati router su prove deboli, oggetti di rete senza collegamenti) si prova su queste due misure e, per T3, nelle
fixture dedicate qui sotto. La famiglia 4 inventata ha già trovato un difetto della misura: C4 non abbinava le schede di
un hypervisor col MAC della sua scansione, come fa il modello, e contava «cucite» due linee vere (corretto in T1.0).

**La rete-campione in quattro letture** (G16, I38): una rete inventata, con router, due core, tre switch di accesso,
un cavo bloccato, un segmento della WAN con due apparati, un fascio di due cavi, un tunnel, una porta instradata, un
ponte radio. Si scrive in quattro letture:

| Lettura | Forma | Che cosa descrive | Che cosa deve uscire uguale |
| --- | --- | --- | --- |
| A | MikroTik (uscite incollate da Riccardo, rese anonime) più controller (la fixture `unifi-stat-device.json`, estesa con `lag_idx`, `stp_version`, `ethernet_table`) | tutta la rete-campione | è il riferimento |
| B | Cisco in Rapid-PVST via SNMP: LLDP-MIB con numeri di porta locale da 1 a n tradotti da `lldpLocPortTable` in «Gi1/0/24»; BRIDGE-MIB della VLAN 1 (`community@1`), con porta radice e bridge designato; CDP fra due Cisco, e da un apparato di altra marca attraverso uno switch che inoltra; un fascio «Po1» (`ifType` 161). **Forma dedotta dalla MIB, non osservata** | tutta la rete tranne il tunnel di livello 2 e gli annunci MNDP | su quella parte, gli stessi collegamenti di A |
| C | HP/Aruba in MSTP via SNMP: MSTP-MIB col ruolo nell'albero comune e un'istanza; un trunk «Trk1»; `lldpRemPortId` locale numerico («24»); BRIDGE-MIB senza porta designata. **Forma dedotta dalla MIB, non osservata** | come B | come B; dove C non sa una cosa (la porta designata) la prova dice quale criterio decide al suo posto, e il risultato resta uguale |
| D | host Proxmox con `lldpcli -f json0 show neighbors details` e un bond attivo e di riserva | solo i cavi dell'hypervisor | i cavi dell'hypervisor uguali a quelli di A, compreso quello di riserva |

**«Uguale»** vuol dire: lo stesso insieme di collegamenti (i due capi con le chiavi di porta, il genere), lo stesso
stato e la stessa fiducia di ognuno, lo stesso padre per ogni nodo. B e C provano che la logica è coerente con chi ha
scritto le fixture, non ancora l'indipendenza dal prodotto: quella si scrive in un ADR solo dopo una lettura SNMP vera
(13.5.4).

In più, fixture dedicate: la trappola della radice regionale (due MikroTik della stessa regione e uno switch RSTP di
altra marca attaccato al secondo); uno switch non gestito (due apparati sulla porta → segmento); l'EoIP nella
regione, bloccato nell'albero comune e attivo nell'istanza 1; un ponte radio che inoltra l'LLDP **e si annuncia anche
lui** (le due radio sulla stessa porta del router: salto radio, non segmento) e uno che non lo inoltra, col salto a
mano; un 48 porte con «Port 1», «SFP_ 1» e «SFP 1»; due porte con lo stesso nome; «eth0» su uno switch; un access
point visto con due nomi di porta; un gateway con l'uplink del controller su porte di velocità diverse; un cavo
spostato; una porta tolta dal bridge. Dalla lettura dell'hub, in più: un bridge col nome scelto e un fascio nel bridge
(`porta,bondN,‹bridge›`); lo stesso router con un MAC per interfaccia; tre righe CDP inoltrate su un membro di un
fascio; nomi inventati a caso per bridge, VLAN e tunnel (I58). Tutte con nomi e MAC inventati; le uscite incollate si
rendono anonime prima del commit, e `fixture-anonime.test.ts` (`FORMA`) si aggiorna quando l'ingresso del modello
cresce (ADR 0010, punto 8).

### 13.12.3 Prove-invariante (l'incidente nel commento della prova)

| # | Regola | Incidente o origine | Prova |
| --- | --- | --- | --- |
| I1 | I vicini non si cancellano: invecchiano | ADR 0008 | una riga non riletta resta «non visto da N g»; R-superata non la scarta se l'apparato è sparito del tutto |
| I2 | Un router aggiunge solo i collegati diretti | §11.1 | riga del router su una porta con più vicini, senza conferma su quella porta → niente |
| I3 | MNDP non conferma; il CDP visto da un MikroTik non conferma | ADR 0010, M-5 | due router che si sentono via MNDP o CDP (`discovered-by` «cdp,mndp») attraverso uno switch o una radio → nessun cavo, nemmeno su `ether1-2.5` o su una VLAN |
| I4 | Conferma per porta, con un solo apparato sulla porta che conferma | 14/10, riga su `ether8` | core 1 vede router 1 sulla porta 10 → la riga del router su `ether8` non passa; una porta che sente tre apparati non conferma |
| I5 | Da un'interfaccia logica locale non nasce un cavo | `links.ts:178-181` | riga del router su una VLAN, coppia confermata → niente |
| I6 | Le porte di una linea vengono da una prova sola | 14/10, «porta 10 ↔ `ether8`», 1G | uplink senza porta del padre + LLDP del figlio sulla porta di uplink → le porte di quella riga; mai la prima in ordine |
| I7 | Una porta con due o più apparati non dà cavi, non presta porte, non conferma | porta 15 di core 1 | il router di riserva va sotto accesso B, porta 16 |
| I8 | «Ignora» per cavo | 14/10, sparito il 10G | ignora (porta 10, `ether8`) → il cavo `sfp-sfpplus1` resta; ignora (porta 10, `sfp-sfpplus1`) → sparisce solo lui; una porta vuota vale per qualunque porta su quel lato; due porte vuote → toglie solo un cavo senza porte (l'uplink senza fili di un access point in mesh), mai un cavo con le porte: con soli cavi con le porte è orfana |
| I9 | «Ignora» vale anche per tabella MAC, ripiego e VM, per cavo | revisione I-3 | porta occupata verso quell'oggetto; un cavo su un'altra porta compare |
| I10 | Il verso non batte il rango | misura del 14/10, ordine «verso, rango» | rete del 14/10 con la correzione per coppia: core 1 non va sotto il router di riserva |
| I11 | Un pareggio non si decide per alfabeto prima di stato, prova, verso e velocità | scenario S3 | senza uplink di core 1, router 1 → core 1 (10G) vince su router 1 → accesso A (2,5G) |
| I12 | «SFP_ 1» è «SFP+ 1» (indice 49), mai «SFP 1» (51) né «Port 1» (1) | accesso B | la porta 1 e «SFP_ 1» sono due porte; i cavi verso core 2 sono a 10G |
| I13 | «eth0» di uno switch che non ha quella porta non è una porta | 7 + 2 porte | più apparati su «eth0» → nessun segmento |
| I14 | Un nome di porta doppio non si risolve per nome | hub, «SFP+ 15» | due porte con lo stesso nome → porta non nota senza indice |
| I15 | Una riga VLAN o VRRP non si abbina per IP; per telaio e per nome sì | riga VRRP sul nodo sbagliato | il gruppo si abbina con la riga fisica; un gruppo senza riga fisica si abbina per telaio (la radio lontana a 60 GHz, il router di riserva) |
| I16 | Il protocollo è quello letto, mai fisso | `router-client.ts:1095` | `discovered-by` con `lldp`, senza, con `cdp,mndp`; valori con spazi |
| I17 | Ciò che il router vede sul bridge non crea cavi; le sue porte vengono dalla tabella del bridge | §11.1, §11.1 bis | restano |
| I18 | Il ripiego vale per le porte di bordo; «oltre» una radio non letta solo con un apparato di rete solo | ADR 0010 (circa 230 falsi) | porta con un ramo dietro → niente; porta con una radio non letta e un solo apparato di rete oltre → appeso alla radio, dedotto; con due o più → niente, e la frase «Oltre ‹N› ci sono ‹n› apparati di rete»; mai dalla tabella MAC di una porta di passaggio |
| I19 | I MAC virtuali non identificano | §10.4 | resta |
| I20 | ★ vince sempre, se raggiungibile | §11.3, D2 | ★ su un cavo bloccato o instradato → principale; ★ irraggiungibile → «★ non applicabile» |
| I21 | Il principale dell'hypervisor è il più veloce, fra i non giù | §12.5 | resta, anche in T3; una porta spenta non è principale se c'è un cavo acceso |
| I22 | Il bridge designato non sceglie e non crea | trappola della radice regionale | switch RSTP dietro il secondo router della regione: il cavo va al secondo router |
| I23 | Un instradato non batte un percorso nel bridge | D5 | accesso A sotto core 1, non sotto `ether1-2.5` |
| I24 | Un bloccato non fa da padre se c'è un percorso che inoltra | D2 | core 2 sotto accesso C |
| I25 | «blocking» su una porta giù vale «giù» | `ether5`, tunnel spento | porta giù con stato «blocking» → collegamento «giù», non «bloccato» |
| I26 | Lo stato SNMP solo su porte tradotte | stati su `bridge` e su una VLAN | senza `dot1dBasePortIfIndex`, nessuno stato |
| I27 | «Nel bridge» non si deduce dalla tabella MAC | righe vecchie dell'ARP | porta del router senza «,bridge» nelle righe dei vicini e con righe vecchie dell'ARP nella tabella MAC → fuori dal bridge, mai «nel bridge» |
| I28 | Senza prove → «Da sistemare»; essere visto via LLDP non è una prova | hub, PC «switch» con LLDP | apparato dichiarato switch, visto via LLDP da uno switch e senza altre prove → «Da sistemare»; host classificato router senza prove → «Da sistemare» |
| I29 | Un tunnel si disegna solo se acceso | tunnel verso la sede 3, spento | righe vecchie sul tunnel → solo nei dettagli |
| I30 | Le linee non si distinguono mai col solo colore, e le forme nuove non riusano quelle di oggi | §11.4, Riccardo daltonico | ogni stato ha parola e forma (`edgeLook`), distinte in bianco e nero; anche il tunnel con gli annunci vecchi: «tunnel ▲» sulla linea dell'albero, non il solo grigio |
| I31 | Schermo e stampa con la stessa geometria | ADR 0012, punto 1 | `latiVicini` è l'unica fonte dei lati |
| I32 | Ogni etichetta sta nel suo spazio, o si accorcia con «…» | 90 px fra le colonne | ogni pezzo delle etichette della mappa del cliente A (fixture) misurato con `CHAR_W` contro il suo spazio |
| I33 | Letture spente = mappa identica; letture accese = mappa di T1 identica | freno a prova di guasto (verifica sul codice) | interruttori assenti → modello uguale a T1, il giro non manda i comandi nuovi (spia su `execCommand`) né richieste SNMP nuove (spia SNMP); interruttori accesi con le fixture di T2 → modello di T1 uguale, e classificazioni degli host uguali (le fonti nuove non entrano nell'attribuzione) |
| I34 | Migrazione non fatta → vicini scritti, mappa calcolata | ADR 0008, punto 10 | migrazione che fallisce (simulata) → `upsertNeighbors` scrive i vicini e il modello si calcola |
| I35 | `switch_ports` non tiene dati di altri lettori | ADR 0008, punto 4 | `topology_port_facts` sopravvive a `upsertSwitchPorts` |
| I36 | Una correzione vecchia non si converte da sola | D3 | la riga del 14/10 resta, orfana |
| I37 | Nessun prodotto nella logica dei collegamenti | vincolo 4 | prova in TypeScript (`cavi-senza-prodotti.test.ts`): legge i file di `src/lib/topology/cavi/` e, senza i commenti e coi valori delle colonne del DB («unifi», «unifi_uplink», «mndp») tolti, il codice di `links.ts` (verifica del 15/10), e cerca, senza distinguere maiuscole, i nomi di prodotto (mikrotik, routeros, unifi, ubiquiti, cisco, aruba, «hp» come parola, proxmox, mndp) e, come espressioni, le forme di porta di un prodotto (`ether` seguito da una cifra, `sfp-sfpplus`, `sfpplus`, `sfp28`, `SFP_`, `,bridge`, `bridge/`, `wlan`, `eoip`, «local» seguito da uno spazio dentro una stringa): 0 righe. Le forme stanno solo in `src/lib/topology/lettori/`. È un elenco di parole in TypeScript, non un comando `grep` copiato da una tabella, dove la barra verticale dell'espressione diventerebbe un carattere da cercare |
| I38 | Stessa rete, marche diverse → stessi collegamenti e stesso albero | vincolo 4 | la rete-campione in quattro letture, con «uguale» come in 13.12.2 |
| I39 | Stessi dati → stessi collegamenti, stesso albero, stesse coordinate | §7 | resta |
| I40 | Un segmento o una radio fuori da una mappa passo passo non la spezza | 13.7.7 | due membri legati solo da un segmento → una radice |
| I41 | `ether1-vlan20` non è una porta fisica | revisione finale M-7 | la prova di oggi (`links.test.ts:208`) si sposta col codice nel traduttore MikroTik |
| I42 | Ogni MAC di VM sta su una porta sola | §12.5, revisione finale del ramo | resta, e si sposta col codice |
| I43 | Un vicino vecchio non fa un segmento | ricablaggio (verifica sul codice) | cavo spostato: il vicino di ieri, non visto da più della soglia, e quello nuovo → nessun segmento, il cavo nuovo c'è |
| I44 | I fatti valgono solo dall'ultimo giro | verifica sul codice | porta tolta dal bridge → non più nel bridge; istanza MSTP tolta → nessuna porta radice per lei |
| I45 | Una prova con velocità diverse ai capi accesi non dà le porte | gateway dell'hub, 10G contro 25G | → collegamento con «porte da verificare» |
| I46 | Il nome di porta di un apparato senza elenco vale come chiave solo se è l'unico visto | due AP dell'hub | due nomi diversi verso lo stesso AP → un cavo solo, porta da completare |
| I47 | Un'interfaccia senza fili non è logica | client di un AP sull'hub | riga LLDP di un AP sulla sua interfaccia radio → collegamento «≋ Wi-Fi» |
| I48 | Lo stato di un tunnel lo dà il capo letto di recente | tunnel verso la sede 3 | un capo acceso a maggio e l'altro spento oggi → spento |
| I49 | La posizione del segmento non si decide per alfabeto; il segmento sta sotto il membro più vicino alla testa, anche fuori dal bridge | segmento della WAN, 13.15 punto 1 | due membri a pari chiave, uno è la testa con la porta fuori dal bridge → il segmento sotto la testa; l'altro membro resta, come ridondanza |
| I50 | A pari fiducia un cavo vero batte un collegamento verso un segmento | router di riserva | accesso B, porta 16, e non il segmento |
| I51 | Fra router, MNDP dà un collegamento solo come unico vicino su una porta fisica, probabile e mai certo; mai da CDP inoltrato | C7, M-5 | router 1 `ether4` con router 3 unico vicino → «probabile, attraverso apparati non letti»; due router su una porta con altri apparati via MNDP o CDP → niente |
| I52 | Nessun lettore scrive `protocol` fuori vincolo | ADR 0008, punto 9 | `lldpd` con «via» CDP, EDP, FDP o SONMP → riga non scritta, giro intero |
| I53 | Un comando che non risponde non ferma il giro | verifica sul codice (`ssh-transport.ts`) | comando che non chiude il canale → errore col codice allo scadere del tempo, e gli apparati dopo si leggono |
| I54 | La lettura di `lldpcli` non tocca le schede vive | verifica sul codice (`proxmox-ssh.ts:185`) | host senza `lldpcli` → schede come prima, nessun errore della lettura delle schede |
| I55 | I MAC dei lettori nuovi non entrano nella sincronizzazione del controller | verifica sul codice (`unifi-sync.ts:153`) | `getNetworkDeviceKnownMacs` dà gli stessi MAC con `topology_device_macs` piena |
| I56 | Un collegamento «dalle VM» che non è principale e che nessun'altra lettura vede non si disegna; con `lldpd`, uno su una porta che l'host non conferma si scarta | tre cavi inventati verso l'hypervisor 2 (M26), 13.15 punto 4 | collegamento «dalle VM» non principale, senza altre prove → non disegnato nemmeno a richiesta, nei dettagli dell'hypervisor «visto dalle VM anche su ‹porta›»; server con una VM sola → il principale resta; host con `lldpd` che non conferma la porta → scartato |
| I57 | Un cavo bloccato si disegna solo a richiesta, come le altre ridondanze | 13.15 punto 7, groviglio delle ridondanze (§12.5) | core 2 con due cavi bloccati → nessuna linea finché non si chiede, il «⇄ N» li conta, i dettagli dicono «bloccato dallo spanning tree» |
| I58 | Un nome scelto dal cliente vale quanto un altro: nessuna regola lo riconosce | vincolo 9; la VLAN del router dell'hub presa per una porta fisica (`links.ts:82`) | nomi inventati a caso, senza prefissi di fabbrica né punti («XQ_7_ABC», «lan-piano2», «PONTE-A»), come porta locale di un MikroTik → sempre `fisica: null`, mai fisica né logica, e nessun cavo dalle righe del router su quei nomi; un prefisso di fabbrica seguito da una coda scelta a caso, o da un numero che non è una velocità («ether3-20»), non è mai fisico; la prova dei nomi (I37) cerca anche, in `cavi/` e in `lettori/`, i prefissi dei nomi scelti visti nelle reti misurate («vl_», «br_») |
| I59 | Il contenitore di una riga si legge dalla forma, con qualunque nome del bridge | hub: ogni riga del router finisce col nome scelto del bridge | `porta,BR_X` → nel bridge; `porta,bond1,BR_X` → membro del fascio, nel bridge; `porta` senza contenitore → fuori; dal lato remoto `‹qualunque›/bond1/sfp28-1` → `sfp28-1` |
| I60 | Gli apparati di una porta si contano per apparato | hub: lo stesso router con due MAC sulla stessa porta; tre righe CDP inoltrate su un membro di un fascio | un router non abbinato sentito su una porta da due interfacce, con due MAC e lo stesso nome che identifica → un apparato, nessun segmento; due router diversi col nome di fabbrica («MikroTik») → due; due gruppi con lo stesso nome e MAC di OUI diversi → due; tre righe CDP scritte `mndp` dal lettore → non contano |
| I61 | Una VLAN su più porte d'accesso non è un segmento | la VLAN della WAN dentro il bridge del router (hub, cliente A) | sei porte d'accesso con la stessa VLAN, un apparato ciascuna → sei cavi, nessun segmento |
| I62 | Fra una VM e il suo hypervisor non c'è un collegamento; i MAC propri di un apparato non sono suoi vicini, VM o client | hub: l'hypervisor appeso alla scheda del suo firewall virtuale | firewall virtuale registrato come switch, con le sue schede nella tabella MAC e la sua VM accesa sull'hypervisor → nessun collegamento fra i due, l'hypervisor sotto un suo cavo; i MAC propri non contano fra i client della porta |
| I63 | La testa non si decide per id | hub: router e gateway del controller pari, vince l'id | due router che raggiungono gli stessi nodi, quello con l'id più alto gateway di più reti → la testa è lui; a pari reti, l'id (stessi dati, stessa testa) |
| I64 | Nessuna radice sola | hub: cinque oggetti di rete senza collegamenti, radici sole | host classificato switch, con una prova di ruolo e nessun collegamento → «Da sistemare», «nessun collegamento», fuori dalla mappa automatica; nessun oggetto perso dalle mappe passo passo |
| I65 | «Hypervisor» solo con una prova; `disabled` non è una prova di spanning tree | hub: un nodo «hypervisor» fatto di host fusi; gli switch senza spanning tree | host classificato hypervisor senza VM → attaccato; switch che ha solo porte `disabled` e nessun'altra prova → «Da sistemare» |
| I66 | Il fascio dedotto solo fra due bridge che si parlano con lo spanning tree | hub: router e router di frontiera; WAN e LAN del gateway del controller | due cavi in inoltro su porte di bordo, senza BPDU → due linee; WAN e LAN di un gateway → due linee; due switch con lo spanning tree attivo fra loro → fascio dedotto |
| I67 | `disabled` su una porta accesa inoltra; ogni stato su una porta giù vale «giù» | hub: gli switch senza spanning tree; tre porte giù con «forwarding» | uplink `disabled` su una porta accesa → nessuna anomalia, la porta sceglie il padre; porta giù con «forwarding» → «giù» |
| I68 | L'uplink del controller di un gateway è la sua WAN | il gateway del controller dell'hub | gateway con la WAN verso lo switch X e la LAN verso lo switch Y → padre Y; il collegamento verso X «instradato (WAN)», senza verso |
| I69 | Un annuncio su un tunnel di livello 3 dà un tunnel, mai un cavo, anche da un capo solo | hub: MNDP sul tunnel WireGuard, in un verso solo | riga MNDP su un'interfaccia `wg` da un router che dall'altro capo non sente niente → tunnel «probabile» se l'altro capo è censito e il tunnel è acceso, altrimenti solo nei dettagli; mai un cavo |
| I70 | Un nome doppio con una velocità sola dà la velocità, non la porta | hub: il cavo dati di un hypervisor su un nome di due porte a 10G | due porte con lo stesso nome, tutte e due a 10G → velocità 10G, porta non nota; una a 10G e una a 1G → velocità non nota |

### 13.12.4 Le altre prove, per tappa

- **T1**: lettore (`discovered-by` con `lldp`, senza, con `cdp,mndp`; valori con spazi, con e senza virgolette);
  traduttori (le regole del 13.6.1, una per una); `links.test.ts` con i casi del 13.7.1; `tree.test.ts` con
  `chiaveScelta`; `map-screen.test.ts` con `candidatiLati` e `latiVicini` (quattro posizioni, pareggio sull'asse,
  ostacoli, riquadri ritoccati, le «L») e le linee dell'albero in disposizione normale **invariate** (le prove di oggi
  restano verdi senza toccare un numero); lettura e scrittura della memoria dell'elenco in `try`. I numeri di
  `model-fixtures.test.ts` che cambiano si riscrivono col perché. Le regole sui nomi di porta girano sulle fixture
  riestratte (13.12.2), oltre che sulle copie. Dal passaggio universale: I58-I63 e I70, il lettore sulla fixture
  dell'hub (bridge e VLAN dai nomi scelti, `porta,bondN,‹bridge›`, righe chiuse da `\r\n`, un carattere di controllo
  nel valore), e le reti-campione delle cinque famiglie per la parte di T1; le misure sulle due reti vere sulle fixture.
- **T1b**: `ruolo.test.ts` (PC senza prove; host classificato router senza prove; switch con porte; MikroTik che si
  annuncia; radio capo di un salto; ruolo a mano); la rotta del ruolo nel censimento dei permessi; le frasi «Perché
  questo collegamento» (una per fonte di oggi, e il motivo delle righe scartate sulla coppia); I64 e I65.
- **T2**: migrazione additiva e idempotente, righe vecchie intatte, CHECK di `protocol` e chiave unica uguali; parser
  sulle fixture vere; tempo massimo per comando; cadenza propria e lucchetto (due giri paralleli dello stesso apparato
  → una lettura); SN1 con un falso agente che annulla le richieste alla chiusura della sessione; interruttori (con
  la chiave assente il giro non manda i comandi nuovi; l'errore di un comando non ferma il giro); `confrontaAlberi`;
  la rotta della traccia nel censimento dei permessi (`ATTESI`). Sulle uscite vere dell'hub: le tabelle di `monitor`
  lette per colonne (con una porta inattiva dalle celle vuote e `active-ports` su più righe), il bridge-id nelle due
  forme, un errore riconosciuto dal testo con `ssh` uscito con 0, `bpdu_rx`, MK7 vuoto senza MSTP.
- **T3**: i casi del 13.7 e del 13.8.3; la rete-campione in quattro letture e le cinque famiglie; le mappe passo
  passo con un segmento non membro; le rotte con un id `seg:`; I56, I57 e I66-I69.
- **A schermo**, sulla copia della copia con l'utenza di prova (solo sul dev): T1, T1b e T3 a 1920 e 1280, in verticale e in
  orizzontale; elenco aperto e chiuso; le ridondanze di core 2; stampa A3 al 100 % in bianco e nero. Solo schermi da
  scrivania.

## 13.13 Alternative scartate, rischi, che cosa diventa difficile

### 13.13.1 Alternative scartate

| Alternativa | Perché no |
| --- | --- |
| Ricostruire `device_neighbors` col protocollo nella chiave, o una riga per protocollo | vietato su una tabella con chiavi esterne (ADR 0008; regola 10); l'elenco va in `discovered_by` |
| Colonne di spanning tree in `switch_ports` | si cancella e si riscrive a ogni giro (`db-tenant.ts:4958-4964`): due lettori si cancellerebbero a vicenda |
| CHECK sulle colonne nuove | un valore nuovo chiederebbe una ricostruzione vietata; il repo li evita già (`medium`, `vendor` e `kind` dei controller, `db-tenant-schema.ts:1361-1362`) |
| Una tabella dei collegamenti salvata | un secondo scrittore da tenere coerente: ogni divergenza è un cavo fantasma (ADR 0008). Il collegamento si calcola |
| Prove scritte dai lettori in una tabella | una prova (raggruppamento, conferma dai due capi, segmenti) chiede il contesto di più apparati: si salvano i fatti, le prove si calcolano |
| Un punteggio unico che pesa le fonti | nessuno strumento maturo lo fa (OpenNMS, NAV, Netdisco), e non si spiega in una frase: le prove restano separate per domanda |
| Il verso prima del rango | misurato: 4 padri sbagliati sul cliente A |
| Il bridge designato come prova di cavo o come padre | la trappola della radice regionale |
| L'uplink del controller come porta radice per definizione, o come seconda prova accanto all'LLDP dello stesso switch | non è documentato (`uplink_source = lldp_uplink`): il controller lo calcola da quell'LLDP. Lo si usa come verso, e lo stato lo controlla |
| Un albero per istanza o per VLAN | D2 sceglie l'albero comune; la vista per VLAN è fuori (§9); le istanze sono una parola sulla linea |
| Lo stato del router via SNMP (BRIDGE-MIB) | inaffidabile, senza ruoli né istanze; RouterOS non elenca RSTP-MIB e MSTP-MIB; la via dei router resta SSH (ADR 0010) |
| JSON (`:serialize`) o API REST per i MikroTik | il JSON con `detail` è provato solo sull'hub (7.24.2 e 7.24.5), non prima della 7.24.2 e non sul cliente A (7.24.4, da provare in T2-a), e senza `detail` non porta i campi che servono; la terse col taglio « chiave=» è provata sulle due reti, dalla 7.24.2 alla 7.24.5 (13.5.2). La REST chiede servizi e permessi da aprire sui router dei clienti |
| Il `print detail` come formato del lettore | va a capo da solo (a 79 colonne via `ssh`, alla larghezza del terminale se incollato), anche dentro un valore: è un'impaginazione, non un formato |
| Tre formati del lettore in T1 | tre strade di codice, due non provate; uno solo, scelto sull'uscita vera |
| Le forme dei nomi dei prodotti dentro la logica dei collegamenti, anche solo per la correzione rapida | il vincolo 4 non sarebbe vero, e la prova dei nomi resterebbe verde lo stesso; i traduttori le tengono fuori già in T1, senza schema |
| Il modello di T1 che legge indici, elenco delle porte e MAC scritti dalle letture in più | accendere una lettura cambierebbe la mappa senza misura: il freno non frenerebbe (D4) |
| I MAC nuovi dentro `getNetworkDeviceKnownMacs` | la usa anche la sincronizzazione del controller, che scrive `network_devices`: cambierebbero abbinamenti e rifiuti |
| Le righe delle letture in più dentro l'attribuzione degli host | l'attribuzione cambia la classificazione degli host, che la mappa di T1 legge: accendere una lettura cambierebbe la mappa e i dati di produzione senza misura; farle entrare è una scelta a parte |
| Le letture in più dentro ogni giro di `runArpPoll`, senza cadenza propria | sull'hub il router si legge ogni 15 minuti da sei scansioni veloci in parallelo: fino a 24 volte l'ora |
| Lo script unico come scelta di base per i comandi MikroTik | se un comando manca in quella versione, RouterOS può rifiutare tutta la riga, e non c'è un errore per comando; resta solo se T2-a lo regge sul RouterOS più vecchio |
| `lldpcli` accodato al comando delle schede vive | su ogni host senza `lldpcli` l'uscita non è 0 e `hypervisor_sync` perde le schede (`proxmox-ssh.ts:185`) |
| «Unico vicino» contato solo fra le righe LLDP già in T1 | senza la regola «oltre», router 2 perderebbe l'aggancio di oggi sulla `ether3` di router 1 |
| «Unico vicino» via MNDP contato solo fra le righe MNDP | riaprirebbe un falso cavo fra router: router 2, unico fra le righe MNDP sulla `ether3` di router 1, sta dietro la radio |
| Togliere il ripiego «oltre» un ponte radio | la sede 2 resterebbe una seconda radice finché il salto non si legge o si disegna a mano; resta, come eccezione chiusa (13.7.6, punto 5) |
| Potare i vicini per fonte invece che per apparato | le righe di una fonte che smette di scrivere non si poterebbero più |
| Segmenti da qualunque interfaccia locale | il router annuncia LLDP anche dalle VLAN e dalle VRRP: nascerebbero segmenti logici, fusi a catena in uno solo con decine di membri |
| Regola «MAC + 1», nomi «compattati» | indovinare; i MAC veri arrivano dal controller e dai router in T2 |
| Una regola sul nome per «VL_…» | è un nome scelto dal cliente; il tipo dell'interfaccia arriva in T2. In T1 un nome che il traduttore del prodotto non riconosce è «non noto», e per le regole del router non è una porta fisica (13.7.1, I58) |
| Un nome non noto come porta fisica, la regola di oggi (`links.ts:82`), anche per un router col traduttore del suo prodotto | sull'hub fa una linea fra due router da una VLAN (H7); resta solo col traduttore generico, dove un router di un'altra marca, senza nessun fatto, perderebbe i cavi che ha |
| «Fuori dal bridge» quando l'interfaccia della riga non finisce con «,bridge» | vale solo col nome di fabbrica del bridge: sull'hub ogni porta del router, fascio compreso, risulterebbe instradata (13.6.1, I59) |
| Contare gli apparati di una porta per MAC anche nelle righe di RouterOS | lo stesso router ha un MAC per interfaccia: segmenti falsi (13.6.4, I60) |
| Contare gli apparati di una porta dall'elenco grezzo dei protocolli (`discovered_by`) | il CDP inoltrato su un membro di un fascio dell'hub farebbe un segmento falso: conta la classe della prova (13.7.2, passo 5) |
| «`ethN` = indice − 1» per le porte del gateway del controller | sull'hub torna con le velocità, ma è un «MAC + 1» delle porte: una deduzione, non una regola; l'indice si chiede al controller (13.5.3) |
| Il seriale del cavo DAC uguale ai due capi come prova di cavo (`/interface ethernet monitor`) | sull'hub prova solo cavi che l'LLDP prova già; è una lettura di 73 KB per giro sul router; vale solo per i cavi DAC, e su controller e SNMP non è verificato. Si riprende se una rete ha cavi fra porte senza LLDP |
| A pari rango il collegamento instradato perde, già in T1 | la parità su cui poggia oggi non c'è (la riga LLDP dell'aggregazione verso il router di frontiera non si abbina, e quel collegamento viene dalla tabella MAC); D5 sta in T3, dove «fuori dal bridge» si legge per ogni prodotto |
| Il limite «capacità uguali in due letture» per la prova delle capacità | non si calcola: un vicino è una riga per chiave, riscritta a ogni giro (ADR 0008); al suo posto, niente ruolo da un annuncio senza nome di sistema (13.8.2) |
| Il modello annunciato (`board` di MNDP, piattaforma CDP intera) come prova di ruolo, già in T1 | passa dall'attribuzione degli host, cioè da dati di produzione: scelta a parte, da misurare come C18 (13.5.7, 13.14) |
| «Nessuna radice sola» già in T1 | sul cliente A toglierebbe dalla mappa automatica la radio lontana a 60 GHz già con la correzione rapida, fuori dall'elenco di D1 (il piano, rivisto il 15/10, la teneva fuori apposta); in T1b esce insieme agli oggetti senza prove, nello stesso elenco per nome |
| Una posizione delle VM più vecchia di una soglia che smette di creare collegamenti, già in T1 | riapre il punto M-3 dell'ADR 0012, parcheggiato apposta, con una soglia da scegliere: la decide Riccardo (13.16). Una VM che fa da padre al suo hypervisor si toglie comunque, senza soglie (13.7.8) |
| La VLAN di una porta d'accesso scritta sulla linea | la vista per VLAN è fuori da questa spec (§9) |
| Il perimetro dei documenti (per instradamento) come albero | un albero di spanning tree segue il livello 2; il percorso di livello 3 è un'altra vista, da progettare a parte (13.3.6, 13.13.3 punto 12) |
| «eth0» come porta | 7 + 2 segmenti falsi |
| La chiave «SFP_ N» → indice N | sul 48 porte l'indice 1 è «Port 1», che ha un altro vicino: segmenti falsi e velocità sbagliate |
| Il segmento come switch fantasma censito | scrittura sul DB e oggetto finto; il segmento si calcola |
| Il segmento solo come foglia | gli apparati che stanno dietro (gli switch di laboratorio dell'hub, una volta promossi) diventerebbero radici isolate |
| Chiavi di porta salvate sulle correzioni | schema in più per un caso raro: una porta rinominata rende la correzione orfana, e si vede |
| Uno script che converte la correzione del 14/10 | scrittura sui dati di produzione; D3 la vuole riguardata a mano |
| Il ruolo «core» per regola di velocità (tre cavi alla velocità più alta) | sul cliente A darebbe anomalie false su switch tutti a 1G: sette switch a 1G hanno cavi verso tre o più switch, e quattro salgono verso uno switch che per quella regola non è core (stima del 14/10); la regola topologica guarda il livello del padre |
| «Collega a…» fra i due router per un ponte radio | dà il padre giusto ma nasconde le radio, che stanno sulla linea |
| D6 rimandato a T3 | i PC dell'hub resterebbero nell'albero per settimane |
| La traccia del solo albero in T2 | il freno deve contare tutto ciò che T3 cambia: collegamenti, segmenti, ruoli |
| Tutte le tappe insieme | cliente A e hub ricevono `dev` da soli: ogni tappa deve potersi togliere da sola |
| Instradamento automatico delle linee (ELK) | già scartato (§5): il lato più vicino è deterministico e basta |
| Le altre possibilità delle sette scelte del 14/10 sera: segmento della WAN sotto la porta 15 di core 1 (D5 alla lettera); regola del segmento solo nella mappa nuova; ruolo dalle prove nello stesso rilascio della correzione rapida; cavi «dalle VM» lasciati col limite scritto; accensione a una data fissa; frasi nella correzione rapida; cavi bloccati sempre disegnati | scartate da Riccardo: il perché di ogni scelta è in 13.15 |

### 13.13.2 Rischi, con il rimedio

| Rischio | Rimedio |
| --- | --- |
| Il formato vero di `/ip neighbor` (virgolette, `discovered-by`) non è quello atteso | T1-a fatto sul router 1 il 14/10 sera, e la stessa lettura sui quattro router dell'hub: `discovered-by` c'è anche nel terse, dalla 7.24.2 alla 7.24.5, e i valori con spazi senza virgolette sono la forma della fixture (13.5.2); Q-T1 dopo il rilascio, neutro (il confronto con l'uscita vera), anche sull'hub (H16); se un altro router dà un'altra forma, non si indovina: si chiede la sua uscita |
| Le regole del passaggio universale (13.16) sono ragionate sui dati e sul codice, non misurate col modello | T1.0 le misura una per una; una che cambia un padre non spiegato resta fuori da T1, e si dice (C19) |
| La base dell'hub cambia da sola dopo il primo giro di `hypervisor_sync` (15/10, 5:00) | la misura dice su quale lettura delle VM è fatta; «prima» e «dopo» sulla stessa copia (R1, S12) |
| Uno switch visto solo via LLDP esce dall'albero in T1b, finché le capacità non arrivano | elenco per nome prima del rilascio di T1b; ruolo a mano; sul cliente A si contano prima (13.8.2, 13.16) |
| Una porta fisica rinominata dal cliente su un MikroTik non dà cavi dalle righe del router | è il prezzo di non indovinare dal nome (G2): il cavo resta se l'altro capo è uno switch che lo vede, e in T2 il tipo letto lo rende. Sul cliente A non tocca niente: la porta a 2,5G è rinominata (`ether1-2.5`), ma la coda è una velocità, che il traduttore legge fisica (13.6.1); toglierla anche a lei è la scelta 9 del 13.16 |
| Le reti-campione dicono solo ciò che sa chi le scrive | ogni famiglia è inventata ma scritta nella forma vera delle letture (le uscite delle due reti, il controller, la scansione delle VM, le MIB); le due reti vere restano misure a parte, non famiglie, così una regola che fa passare un caso vero e sbaglia una rete inventata si vede; una forma nuova vista sul campo diventa una fixture prima del codice che la usa |
| I valori interi cambiano la classificazione di qualche host attraverso l'attribuzione | C18: confronto delle classificazioni sulla copia, prima e dopo; ogni host che cambia, elencato e accettato |
| Il raggruppamento per apparato cambia qualche abbinamento | misura prima del rilascio; ogni differenza spiegata |
| Uno switch vero senza letture esce dall'albero (D6) | ruolo a mano; «Da sistemare» col motivo; «Promuovi ad apparato»; elenco per nome prima del rilascio |
| Gli switch di laboratorio dell'hub escono dall'albero con la regola del segmento, già in T1 | elenco per nome a Riccardo, solo in chat, prima del rilascio; restano in «Da sistemare» anche alla fine, finché qualcuno non li promuove; promossi, stanno sotto il segmento |
| Il carico: sull'hub il router si legge ogni 15 minuti da sei scansioni veloci in parallelo | cadenza propria (al più una volta l'ora per apparato) e lucchetto; misura sul percorso vero (scansioni veloci, connessioni SSH); prima l'hub; interruttore per cliente |
| Un comando SSH che non risponde ferma il giro di tutti gli apparati dopo | tempo massimo per comando nel trasporto (13.5.1) |
| Le uscite di RouterOS per MSTP non rispondono o hanno un'altra forma | si salvano se rispondono; «stato per istanza non letto», mai «inoltra» |
| Campi del controller non documentati (`root_switch`, `uplink_source`) o veri solo in parte (il «MAC + 1» in `ethernet_table`: sull'hub 7 switch su 12, 13.5.3) | indizi, detti in parole; il «+ 1» vale dove è scritto, mai dedotto per gli altri |
| Le fixture Cisco e HP/Aruba sono dedotte dalle MIB | l'indipendenza dal prodotto si scrive in un ADR solo dopo una lettura SNMP vera |
| Dati vecchi: router 3 fermo da maggio, il controller letto una volta per notte (03:00 UTC, le 5:00 italiane fino al 25/10) | «non visto» resta; in T3 un cambio di topologia si vede il giorno dopo, e la traccia lo dice |
| Due modelli vivi insieme (T1 e T3) | interruttore con una scadenza (13.11.4) |
| Le uscite incollate nelle fixture | rese anonime prima del commit; `fixture-anonime.test.ts` controlla la forma |
| `lldpd` sugli host dei clienti è una scrittura sui loro apparati | nodo di prova sull'hub, conferma, Deploy-Appliance (spec §8) |
| L'LLDP del firmware delle schede spento prima che `lldpd` funzioni | si spegne nello stesso intervento; se lo switch non vede `lldpd`, si riaccende (13.5.5); altrimenti tre hypervisor dell'hub tornano sotto lo switch di gestione |
| Le appliance degli altri clienti ricevono le tappe con la promozione a `main` | conteggio delle correzioni salvate prima di T1; spazio, `quick_check` e copia prima di T2 (13.11) |
| La posizione del segmento della WAN sembra contraddire D5 a chi la conosce | l'eccezione è scritta dove sta la regola (13.7.4, 13.8.3) e provata (I49, S10); la ★ resta per il singolo cliente |
| Il freno non si toglie mai | il passo dopo dipende dai numeri del primo giro di letture accese, non da una data (13.15, punto 5; 13.11.3 punto 5) |
| La regione MSTP letta a metà (il router di riserva non si legge) | si dice in parole: «lo spanning tree di ‹nome› non è letto: i cavi bloccati dietro di lui non si vedono» |
| Le radio a 5 GHz inoltrano o no l'LLDP: non verificato | tutti e due i casi sono prove (13.12.2), compresa la radio che si annuncia anche lei |

### 13.13.3 Che cosa diventa difficile in futuro

1. **Finché c'è l'interruttore di T3 ci sono due modelli**: ogni regola nuova della mappa va scritta e provata in
   tutti e due, fino a quando il ramo vecchio si toglie.
2. **Le porte stanno in quattro posti**: `switch_ports` (porte e velocità, riscritta a ogni giro), `device_neighbors`
   (vicini), `topology_port_facts` (spanning tree, fasci, tipo), `mac_port_entries` (MAC). Un lettore nuovo deve sapere
   dove scrivere, con la stessa chiave e lo stesso `ON CONFLICT` (ADR 0009, punto 4), e chi prevale per l'elenco
   delle porte (13.5.7).
3. **L'id della linea passa da coppia a collegamento.** «⇄ N», principali, stampa, menu e prove contano
   collegamenti: un «⇄ 2» fra gli stessi due apparati diventa normale e va spiegato. L'id di un collegamento cambia se
   cambia il nome di una porta letta per nome; un ritocco non dipende dall'id della linea, la selezione sì.
4. **L'id di un segmento** dipende dal membro con la chiave più piccola: se quel membro esce, il segmento cambia id.
   Una mappa passo passo non lo perde finché un altro membro lo tiene (l'id salvato si risolve nel segmento che
   contiene quel membro, 13.7.3); lo perde quando nessun segmento contiene più quel membro, e lo dice.
5. **Ogni lettore nuovo porta il suo traduttore**, che porta le forme del prodotto nel vocabolario neutro rispettando
   i significati («cavo» non è «stessa rete»). Una stranezza di un prodotto si risolve nel suo traduttore; la prova dei
   prodotti lo impone, e chi la toglie «perché fa comodo» riapre il problema.
6. **R-superata** è una regola in più per chi legge `device_neighbors`, oltre alle due viste dell'ADR 0008, punto 1;
   la finestra «non visto» per contare gli apparati di una porta è un'altra (13.7.1, passi 0 e 2).
7. **«Da sistemare» cambia che cosa è un nodo**: un apparato dichiarato switch e mai letto non è un nodo della mappa
   automatica finché qualcuno non lo conferma; l'elenco cresce dove l'inventario è sporco, finché i tipi non si
   correggono (lavoro a parte, D6).
8. **MSTP per istanza è a metà**: si sa la porta radice di ogni istanza, non lo stato di ogni porta in ogni istanza.
   Una regione con più router e più istanze può mostrare «bloccato» dove un'istanza passa.
9. **Le correzioni restano legate al nome della porta**: una porta rinominata le rende orfane (si vedono, non si
   applicano altrove).
10. **Due modi di tracciare le linee**: il tronco per l'albero, il lato più vicino per il resto. Schermo e stampa li
    prendono dallo stesso modulo: chi cambia l'uno cambia l'altro. Una forma nuova di riquadro (VM, gruppi di AP) deve
    dichiarare i suoi quattro lati.
11. **Più tempi per ogni dato**: spanning tree letto a un'ora, LLDP a un'altra, controller una volta al giorno. Le
    contraddizioni fra fonti di età diverse si spiegano, non si risolvono in silenzio.
12. **Se un giorno Internet si disegnerà sopra la testa** (§4), il segmento della WAN, che oggi sta sotto la porta
    della WAN della testa (13.15, punto 1), dovrà passare fra Internet e la testa: servirà una regola sua.
13. **Due modelli leggono cose diverse.** Il modello di T1 legge solo ciò che legge oggi, più l'elenco delle porte e i
    campi dei traduttori; chi aggiunge una lettura decide dove la legge il modello per cavo, e il modello di T1 non la
    legge mai (13.5.7). La prova I33 lo controlla.
14. **Le letture in più hanno la loro cadenza, non quella del job**: chi aggiunge un comando lo mette dietro la
    cadenza propria, il lucchetto e il tempo massimo, e ne misura il carico sul percorso vero.
15. **Le reti-campione sono codice da tenere vivo**: ogni lettore nuovo porta la sua famiglia, o allarga una delle
    quattro, e ogni criterio generale ha la sua riga nel resoconto della tappa. Una regola che passa sui due casi reali
    e non sulle reti-campione si corregge, non si tara.
16. **Ciò che sceglie il cliente non entra nella logica**: una regola su un nome sta nel traduttore del prodotto solo
    se il nome è di fabbrica; un nome scelto resta «non noto» finché non si legge il tipo. Chi ha fretta di riconoscere
    «VL_…» o «WAN» riapre il problema dell'hub (H7); la prova I58 lo ferma.

## 13.14 Lavoro aperto rispetto alle mappe attese

- **I tre cavi «dalle VM» inventati verso l'hypervisor 2 (M26).** Il modello di oggi lega l'hypervisor 2 a tre porte
  di switch di accesso (due della sede 1 e una della sede 2) dove non è collegato: sono ridondanze, con la sola fonte
  «dalle VM». La causa non è verificata (ipotesi: MAC di VM imparati su porte di switch di cui non si riconosce
  l'uplink). Deciso il 14/10 sera (13.15, punto 4): prima di T3 si misura, per ogni collegamento «dalle VM» che non
  è il principale del suo hypervisor, quante VM, su quale switch e porta, e se l'uplink di quello switch è
  riconosciuto; se la misura conferma che nessun'altra lettura li vede, nella mappa nuova non si disegnano nemmeno a
  richiesta (13.7.2, passo 10). Fino ad allora restano ridondanze a richiesta, come oggi.
- **La radio di gestione dal lato della sede 2 (M16)** è fuori dall'albero: dipende dalla lettura della tabella del
  bridge di router 2 (l'ultima è del 13/10). Si riguarda dopo T1, coi dati freschi.
- **Le radio fra router 1 e router 3 (M18)** non stanno sulla linea: router 3 non si legge da maggio, e il problema è
  l'accesso al router, non la mappa. Finché non si rilegge, la linea resta «probabile, attraverso apparati non letti»;
  riletto, le due radio che sente su `ether4` diventano il salto radio (13.7.6, punto 3).
- **I cavi dei server verso core 1 e il cavo diretto a 50G fra i due hypervisor (M25).** I core sentono 8 schede di
  server via LLDP del firmware, senza nome, che non si abbinano; il cavo a 50G, senza switch, non lo vede nessuno
  switch. Li vedrà la lettura dal lato dell'host, se `lldpd` sarà installato, o il MAC permanente dei membri dei bond,
  se `ip -d -j link` lo dà (13.5.5, da verificare); altrimenti si disegnano a mano.
- **Anomalie sull'hub**: nessuno le ha ancora contate; si contano in T3 (H8), e un'anomalia falsa corregge la regola
  prima del rilascio.
- **Letture SNMP vere di altre marche**: nessuna vista; servono prima di dichiarare in un ADR l'indipendenza dal
  prodotto (13.5.4).
- **Il router di frontiera e il router virtuale dell'hub sono censiti solo come host**, e il router nel cloud non è nel
  DB: nessuna regola può mettere il router di frontiera dove lo mette lo spanning tree (H21), né scrivere «instradato»
  sui suoi cavi diretti verso il router. Censirli è una scrittura sui dati dell'hub, e la decide Riccardo (13.16).
- **Il perimetro per instradamento** dei documenti dell'hub non si disegna (13.3.6): se servirà, è una vista di livello
  3 da progettare a parte, insieme a Internet sopra la testa (13.13.3, punto 12).
- **Identità, fuori dal §13**: il NAS dell'hub è tre nodi (tre MAC con prefissi di OUI diversi, che la regola degli
  OUI tiene separati, `node-index.ts:171-177`); 18 host su un MAC amministrato localmente diventano un nodo solo. Il
  partner LACP non lo risolve (H18 chiede solo il fascio): è un lavoro a parte sull'identità.
- **L'elenco «apparati di rete visti ma non letti»** (chi gli altri annunciano come apparato di rete e non è censito,
  con chi lo vede e su quale porta, e «Promuovi ad apparato»): migliorerebbe «Dati della mappa», ma non corregge un
  errore della mappa, e «Promuovi ad apparato» propone già gli host classificati router, switch, AP o firewall che
  hanno un collegamento (`model.ts:52-57`). Si propone a Riccardo con la sua bozza, dopo T1b.
- **Il modello annunciato** (`board` di MNDP, piattaforma CDP intera, descrizione LLDP) correggerebbe forse da solo
  alcune classificazioni sbagliate (sull'hub gli switch MikroTik e Cisco classificati router; non verificato), ma
  passa dall'attribuzione degli host: scelta a parte, da misurare come C18 (13.5.7).
- **Fatti dell'hub da chiarire**, che non cambiano le regole (nella mappa attesa dell'hub, fuori dal repo): una terza
  porta accesa del gateway del controller, a 2,5G, senza vicini noti; che cosa sono due apparati visti dal router solo
  per MAC; i 118 cambi di topologia sul fascio verso lo switch di storage; se il fascio dedotto fra l'aggregazione e
  uno switch di accesso (porte 5 e 6) è configurato; che cosa c'è in mezzo al segmento del laboratorio.
- **Fatti del cliente A ancora da chiarire** che non cambiano le regole, elencati nella sua mappa attesa (fuori dal
  repo): che cosa
  c'è sulla porta 16 di core 1 (un apparato di un'altra marca, forse il router della seconda linea) e sulle porte SFP+ 1
  dei due core; a che cosa serve `ether1-2.5` di router 1.

## 13.15 Decisioni prese il 14/10 (sera)

Le sette scelte che la bozza lasciava aperte, prese da Riccardo il 14/10 sera: il capitolo le applica e le cita come
«13.15, punto N», per non confonderle con D1-D7. «Correzione rapida» è T1; «ruolo dalle prove» è T1b, il rilascio che
toglie dall'albero gli oggetti senza prove; «mappa nuova» è T3, una linea per cavo e l'albero dallo spanning tree.

| # | Scelta | Perché | Dove |
| --- | --- | --- | --- |
| 1 | Il segmento della WAN sta **sotto la porta della WAN di router 1**: un'eccezione, solo per i segmenti, alla regola di D5 «la porta fuori dal bridge non batte un percorso nel bridge»; la porta 15 di core 1 e la WAN del router di riserva restano membri, come ridondanze | un segmento non è un bridge e non ha porta radice; è il segmento del gateway del router, e così lo disegnano gli schemi del cliente | 13.3.1, 13.7.3, 13.7.4, 13.8.3, S10, I49 |
| 2 | La regola «una porta che sente due o più apparati non dà cavi» entra **nella correzione rapida**, con l'elenco per nome di chi esce (solo in chat) prima del rilascio | il router di riserva va subito sotto accesso B, porta 16, e la linea sulla WAN sparisce | 13.7.1 passo 2, 13.11.1, C8, H5 |
| 3 | Il ruolo dalle prove è **un rilascio a parte, subito dopo** (T1b): dopo almeno una lettura dei router col lettore nuovo, misurato su una copia presa dopo; l'elenco per nome di chi esce si guarda con Riccardo prima del rilascio | la prova «si annuncia come apparato» è pulita solo sulle righe del lettore nuovo; un rilascio a parte si toglie da solo | 13.8.2, 13.11.2, H4 |
| 4 | Nella mappa nuova un collegamento «dalle VM» che non è il principale del suo hypervisor e che nessun'altra lettura vede **non si disegna, nemmeno a richiesta**: sta nei dettagli dell'hypervisor («visto dalle VM anche su ‹porta›»), se la misura lo conferma; dove c'è `lldpd`, quelli che l'host non conferma si scartano | sono i tre cavi inventati verso l'hypervisor 2 (M26); il principale di un server con una VM sola resta | 13.5.5, 13.7.2 passo 10, 13.11.4, 13.14, S11, I56 |
| 5 | La mappa nuova si accende per un cliente **a differenze spiegate**, appena lo sono. *Aggiornata da Riccardo il 15/10 notte*: finché la mappa è in sviluppo niente attese di settimane (né «data di revisione una settimana dopo», né «una settimana senza ritorni»); T3 dopo almeno un giro di letture accese su hub e cliente A; la promozione a `main` resta a parte, con la sua conferma | il freno si toglie contando; il passo dopo dipende dai numeri, così non resta acceso per dimenticanza | 13.11.3, 13.11.4 |
| 6 | Le frasi «Perché questo collegamento» entrano **col ruolo dalle prove** (T1b); «Altri cavi visti fra questi due oggetti» entra comunque in T1 | la frase non cambia la mappa, e la correzione rapida arriva prima; l'elenco degli altri cavi serve all'«Ignora» per cavo | 13.4.6, 13.11.1 (T1.6), 13.11.2 (T1b.3) |
| 7 | I cavi bloccati dallo spanning tree si disegnano **a richiesta**, come le altre ridondanze («⇄ N», clic, «Mostra ridondanze»); i dettagli li dicono sempre | disegnati sempre rifarebbero il groviglio che la regola delle ridondanze ha tolto: core 2 da solo ne ha due | 13.10.3, I57 |

### Confermato il 14/10

- **Lettore dei vicini del router**: la sola correzione (protocollo vero, valori interi, stesso comando di oggi) è
  sempre accesa; il resto (l'elenco completo dei protocolli, le capacità annunciate) è spento con le altre letture in
  più (13.5.1). T1-a (14/10 sera) ha mostrato che `print terse` porta `discovered-by`: il protocollo vero sta nello
  stesso comando (13.5.2).
- **Prove del ruolo**: alle quattro di D6 si aggiungono le sei del 13.8.2 (porta di uplink secondo il controller;
  gestito da un controller di rete; padre di un altro apparato secondo il controller; si annuncia come apparato, MNDP
  o CDP; capo di un ponte radio; capacità annunciate «bridge», «router» o «AP», non per server e hypervisor), più il
  «Ruolo nella mappa» a mano, la via d'uscita da «Da sistemare».
- **Anomalia sul riquadro**: la forma corta «⚠ core sotto accesso»; il testo di D2, «core che esce da uno switch di
  accesso», resta il titolo nei dettagli e in «Anomalie della rete» (13.8.3, punto 8).
- **Linee fra un padre e i suoi figli**: restano a tronco; il lato più vicino vale per ridondanze, cavi bloccati e
  instradati, segmenti e linee a mano (13.10.1).
- **Un fatto**: router 1 ha una sola SFP+, `sfp-sfpplus1`, collegata solo a core 1; fra router 1 e core 2 non c'è un
  cavo (D7; 13.3.1, riga 18).

## 13.16 Il passaggio universale del 15/10: che cosa entra nelle tappe, e che cosa resta a Riccardo

Il vincolo 9 («il piano deve essere universale») e la lettura dei router dell'hub (13.1, punto 18) hanno portato regole
nuove nelle tappe. Non riaprono D1-D7 né le sette scelte del 13.15: le applicano a forme di rete che il cliente A non
mostrava. Ognuna è scritta per ogni rete, con la sua prova; sono ragionate sui dati e sul codice, con due verifiche,
ma non ancora misurate col modello: la misura di ogni tappa le conta una per una (C19 per T1), e vanno a Riccardo coi
numeri del rilascio, come fatti da confermare.

**Entrate nelle tappe.**

| Tappa | Regola | Dove | Effetto atteso sui due casi reali |
| --- | --- | --- | --- |
| T1 | il contenitore delle righe di RouterOS si legge dalla forma, con qualunque nome del bridge | 13.6.1, 13.7.4, I59 | nessuno sulla mappa di T1 (il fatto serve a T3); sul cliente A i contenitori sono tutti `,bridge` |
| T1 | per un router letto col traduttore del suo prodotto, un nome scelto dal cliente non è una porta fisica: né conferma, né unico vicino, né conteggio, né ripiego (H7 anticipato per i MikroTik) | 13.6.1, 13.7.1 (passo 1 e trappole), I58 | hub: sparisce la linea router – router di frontiera tracciata da una VLAN, restano i cavi veri; cliente A: nessuno |
| T1 | gli apparati di una porta si contano per apparato; nelle righe di RouterOS il MAC è dell'interfaccia, e una riga non abbinata conta col nome annunciato, quando identifica | 13.6.4, 13.7.1 (passi 2 e 3b), I60 | nessuno atteso sulle due copie; evita segmenti falsi in ogni rete con più MikroTik |
| T1 | fra una VM e il suo hypervisor nessun collegamento; i MAC propri di un apparato non sono VM, client né vicini | 13.7.8, I62 | hub: l'hypervisor appeso al firewall virtuale cambia padre (H15); cliente A: si misura |
| T1 | la testa proposta: a pari nodi raggiunti il gateway di più reti, l'id solo per ultimo | 13.8.1, I63 | hub: la testa resta il router (H17); cliente A: la testa di ogni sede uguale, o la regola resta fuori (C19) |
| T1 | un nome doppio con una velocità sola dà la velocità | 13.6.1, I70 | hub: lo stesso hypervisor sotto l'aggregazione a 10G invece che sotto la sua porta di gestione a 1G (H13); entra se non cambia altri padri senza un perché |
| T1b | nessuna radice sola: gli host di rete senza collegamenti in «Da sistemare» | 13.8.2, I64 | hub: cinque oggetti, una radice sola (H14); cliente A: la radio lontana a 60 GHz fino al salto radio di T3 (C16) |
| T1b | «hypervisor» solo con una prova; `disabled` non è una prova di spanning tree | 13.8.2, I65 | hub: un nodo di host fusi passa da hypervisor ad attaccato, al suo posto |
| T2 | i lettori sulle forme vere: tabelle di `monitor` per colonne, bridge-id in due forme, errori dal testo, BPDU ricevuti, `stp-ssh.ts` su MK3 e MK5; il JSON solo con `detail`, come alternativa da provare; il controller da verificare su un gateway | 13.5.1, 13.5.2, 13.5.3, 13.5.7 (`bpdu_rx`) | nessuno sulla mappa: letture spente, e accese non cambiano la mappa di T1 (R7) |
| T2 | `device_interfaces` fra i MAC degli apparati, solo per l'identità | 13.5.7, 13.6.4 | nel modello per cavo, sull'hub, due cavi in più abbinati |
| T3 | l'uplink di un gateway del controller è la sua WAN; `disabled` su una porta accesa inoltra; ogni stato su una porta giù vale «giù» | 13.8.3 (punto 1), 13.7.2 (passo 8), I67, I68 | hub: niente anomalie false sugli switch senza spanning tree (H19); il gateway attaccato per la LAN (H11) |
| T3 | il fascio dedotto solo fra due bridge con lo spanning tree attivo fra loro; il partner LACP come prova del fascio e del suo apparato | 13.6.3, I66 | hub: nessun fascio falso (H20); il fascio verso il NAS (H18) |
| T3 | gli annunci attraversano anche i tunnel di livello 3: ne nasce un tunnel, mai un cavo | 13.7.5, I69 | hub: nessun effetto finché il router nel cloud non è censito |
| T3 | router e firewall in una VM dentro il loro hypervisor, coi vicini «stessa rete»; i BPDU ricevuti fra le fonti della prova di spanning tree | 13.7.8, 13.8.2 | hub: lo switch di storage torna nell'albero anche senza le capacità |
| tutte | criteri generali G1-G17; reti-campione di cinque famiglie inventate; criteri sui due casi reali separati da quelli generali, con le loro prove fra le misure | 13.3.0, 13.12.2, 13.3.3, 13.3.6 | — |

Quelle che non sono entrate, col perché, stanno nel 13.13.1 (alternative scartate) e nel 13.14 (lavoro aperto).

**Scelte che restano a Riccardo.** Fatti che sa solo lui, o decisioni sue: si chiedono nel messaggio del mattino,
insieme alla domanda di rilascio, e finché non risponde le tappe non ne dipendono.

1. **Censire il router di frontiera e il router virtuale dell'hub** come apparati, letti in sola lettura. È una
   scrittura sui dati dell'hub; senza, nessuna tappa mette il router di frontiera dove lo mette lo spanning tree
   (H21). E il router nel cloud: lo vuole nella mappa come sede remota?
2. **La posizione delle VM da una scansione vecchia** (13.5.5): da quale età smette di creare collegamenti «dalle VM»
   (2 giorni come la soglia «non visto», 30 come il nome dalla scansione Proxmox), oppure resta com'è. Riapre il punto
   M-3 dell'ADR 0012.
3. **La testa quando l'unico router è una VM** (13.7.8): l'hypervisor con la VM dentro, oppure la VM come oggetto a
   sé sopra l'hypervisor.
4. **Gli switch visti solo via LLDP in T1b** (13.8.2): fuori dall'albero fino a T3, oppure promossi a mano subito
   col ruolo «Apparato di rete». Sull'hub è uno, lo switch di storage; sul cliente A si contano prima del rilascio.
5. **Il laboratorio dell'hub** dentro o fuori dall'albero di produzione (DM18).
6. **Il perimetro**: la mappa disegna lo spanning tree, non il percorso per instradamento dei documenti (13.3.6). È un
   fatto da confermare, non una decisione da riaprire.
7. **Il gateway del controller dell'hub**: che la porta a 10G sia la sua WAN e quella a 25G la sua LAN (dedotto da tre
   indizi), e a che cosa serve oggi come gateway, visto che nessuna rete censita lo usa.
8. **La prova «si annuncia (MNDP o CDP)» e i telefoni** (13.8.2; con T1b). È confermata da Riccardo il 14/10 e non si
   riapre: è un fatto da confermare. Il CDP lo mandano anche i telefoni IP, i vSwitch ESXi che annunciano e `lldpd`
   col CDP acceso; un telefono che la classificazione dice router passa la prova e resta nell'albero come apparato di
   rete (la riga «da fare» della famiglia 5). Le due guardie delle capacità (non per server e hypervisor noti, solo col
   nome di sistema) non lo fermerebbero, perché un telefono ha un nome e non è un server: una guardia vera userebbe
   le capacità del CDP («Phone»), che arrivano con T2. Se Riccardo la vuole, entra in T2; altrimenti resta così.
9. **La porta di fabbrica con la velocità in coda** (13.6.1; con T1). `ether1-2.5` è la porta a 2,5G del cliente A
   rinominata: il traduttore la legge fisica perché la coda è una velocità («-2.5», «-10g»), e da T1 non più per
   qualunque coda di cifre. L'alternativa è toglierla: ogni nome rinominato diventa «non noto», le righe del router
   su di lui non danno cavi, e il cavo verso accesso A resta dal lato di accesso A con la porta del router non nota
   (il prezzo già dichiarato nel 13.13.2). Misurato: la restrizione di T1 non cambia nessun nome sulle due copie;
   togliere la forma toccherebbe le 22 righe e porte del cliente A con quel nome.
