# ADR 0010 — Fase 2b: collegamenti a mano, router con le sue porte fisiche, hypervisor e VM

**Stato:** Accepted (completa l'ADR 0009; la regola dei router sostituisce quella della v0.3.278)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude

## Contesto

Dopo una giornata di uso della v0.3.278 sul dato vero (cliente A, copia del 14/10) la mappa
aveva quattro difetti e tre richieste.

Difetti:

- un MAC visto **solo dal router** (sul bridge o su una VLAN) creava un collegamento
  router → oggetto: tre host Proxmox risultavano attaccati al router invece che agli switch;
- un router aggiungeva come collegati anche i vicini che sentiva via LLDP/CDP/MNDP **attraverso
  uno switch** (il router sente gli annunci di tutto il suo segmento);
- i MAC delle schede delle VM comparivano come «client» della porta dello switch e una parte
  degli «apparati isolati» erano in realtà VM dello stesso cluster;
- i due router più piccoli del cliente A mostravano zero collegati, e il principale ne
  mostrava pochi: Riccardo, in corso d'opera: «i link proposti dal router dovrebbero prevedere
  tutto quello che è collegato alle porte; i 2 collegamenti sono sottostimati».

Richieste (brief di Riccardo, spec §11): trascinare gli oggetti sulla mappa e tasto destro;
collegamenti **a mano** con porte e tipo (cavo, fibra, wireless), con un collegamento
**principale** quando ce n'è più d'uno; hypervisor che contengono le **VM**, espandibili.

## Decisione

**Un router aggiunge solo ciò che gli è collegato direttamente, e le sue porte fisiche si
leggono dalla tabella bridge host, non dall'ARP. I collegamenti a mano si verificano contro i
dati. Gli hypervisor sono contenitori di VM, riconosciute dal MAC e dal nome.**

- **Cosa chiede il brief, dove sta.** Trascinamento dall'elenco, tasto destro su oggetti e
  linee, barra dei dettagli chiudibile, «Collega a…» con porte note o scritte a mano, tipo e nota,
  principale scelto dal sistema o da Riccardo («★ Rendi principale»), stile delle linee
  (spessore = velocità, forma = tipo e stato, PoE), hypervisor con «N VM, M accese ▸», job di
  lettura degli hypervisor e «Aggiorna VM». Il testo vincolante è la spec §11.

- **Collegamento di un router (§11.1).** Un vicino del router è diretto solo se è visto su una
  porta fisica e ne è l'unico vicino, oppure se l'altro apparato lo conferma con LLDP/CDP o con
  l'uplink UniFi. La tabella MAC non crea mai collegamenti di un router (`best.counting`).

- **Il router legge le sue porte fisiche.** Si era supposto che le righe MAC del router
  venissero dalla bridge host: non era vero. Le leggeva l'ARP (`/ip arp`), che riporta
  l'**interfaccia di livello 3** (bridge, VLAN, VRRP), mai la porta del cavo. Ora il ramo router
  legge anche `/interface bridge host print` (porta del bridge e VLAN, scartando le righe locali)
  e `/interface print` (il tipo), e salva in `mac_port_entries` solo le righe su porte
  `ether`/`bond`. Tre erano le cause: l'ARP scriveva le porte; il
  filtro `isPhysicalPort` scartava i nomi con punto o virgola (`ether1-2.5`, `ether3,bridge`, che
  sono porte vere); tunnel e wlan non sono cavi e non si salvano.

- **L'ARP non scrive più le porte del router.** Resta per gli indirizzi (host e IP), ma non
  scrive in `mac_port_entries`. Le righe vecchie non si cancellano: invecchiano (2 giorni
  «non visto», 30 giorni la potatura).

- **Ripiego «porta di bordo».** Una porta fisica del router con **un solo** apparato dietro, non
  spiegato da collegamenti più forti (correzioni, uplink, LLDP/CDP, tabella MAC degli switch),
  è una porta di bordo: l'apparato è attaccato al router. Una porta di passaggio (decine di
  switch e AP dietro) non genera nulla: dietro c'è un ramo, e quel ramo si aggancia da un
  collegamento vero. Se due apparati di rete passano la prova sulla stessa porta, nessun
  collegamento. I client visti solo dal router non si contano sulla sua porta.

- **MNDP non conferma dai due lati.** La spec diceva «LLDP/MNDP dell'altro apparato» (revisione
  finale, M-5). MNDP è un annuncio di segmento: attraversa gli switch, quindi il router A che sente
  il router B e viceversa non prova nessun cavo fra loro (sul cliente A creava un falso
  collegamento fra due router). La conferma dai due lati vale solo per **LLDP/CDP** (annunci
  che non passano gli switch). MNDP resta valido per l'«unico vicino su una porta fisica».
  Il nome di una porta MikroTik rinominata (`ether1-<suffisso>`) è fisica solo se il suffisso è
  cifre e punti o una velocità in `g`; altri nomi non passano (limite noto, vedi sotto).

- **Lettura dei router con un job `arp_poll`, non con la scansione veloce.** I router leggono le
  loro porte solo quando gira il passo ARP/bridge host. Quel passo parte dalla scansione veloce di
  una rete, ma l'avvio dello scheduler (`scheduler-defaults`, regola del 25/05 dopo l'incidente
  del cliente A) **spegne `fast_scan` e `ping_sweep` sulle reti da /22 in su** (1024 indirizzi o
  più, cadenza sotto i 720 minuti): riaccenderli per i router sarebbe stato rimesso a posto alla
  prima partenza. Un job `arp_poll` senza rete non scansiona nulla: legge **tutti** gli apparati
  che usano l'ARP, router compresi, a prescindere dalla rete. Per questo i router piccoli del
  cliente A (una rete con la scansione veloce spenta, una senza job) si leggono con questo job.

- **Job accesi dopo il rilascio.** `hypervisor_sync` (schede vive degli hypervisor e VM, una volta
  al giorno) sul cliente A e sull'hub (solo il tenant che ha hypervisor); `arp_poll` sul cliente A.
  Sono scritture di configurazione in produzione, accese con conferma di Riccardo. Il job si
  spegne cancellandolo (come la lettura dei client UniFi), non c'è un campo «spento».

- **Collegamenti a mano (§11.3).** `topology_link_overrides` ha `medium` (cavo, fibra, wireless,
  `NULL` se non dichiarato: mai «cavo» per default). Un collegamento a mano è **confermato** se un
  collegamento automatico fra gli stessi oggetti, non vecchio, lo vede, oppure se un MAC
  dell'oggetto di arrivo sta sulla porta dichiarata; altrimenti è «solo a mano». La scelta del
  principale vive in `topology_link_primary`, per coppia, e vince sempre su quella del sistema. Un
  collegamento a mano verso una VM non censita si rifiuta in parole (revisione I-1): sparirebbe senza
  dire niente.

- **Hypervisor e VM (§11.5).** Un hypervisor è un apparato `hypervisor`, oppure un `server` con
  fornitore o scansione Proxmox. Le VM vengono da `last_proxmox_scan_result`, che ora porta anche
  le schede vive (MAC vero `permaddr`, stato, velocità, membri del bond) via `ip -d -j link`.
  Una VM è un nodo già esistente se coincide per MAC, per nome o per l'IP che dichiara; i MAC delle
  VM escono dai client della porta dello switch. L'id di una VM non censita è `vm:<apparato>:<vmid>`,
  con l'apparato dall'**id più basso** del cluster (due apparati scansionano spesso lo stesso
  cluster). Le VM spente ora si leggono (I-2): senza, sparivano dalla mappa col job acceso.

- **Tipo di uplink UniFi** (cavo o wireless) salvato accanto all'uplink (`uplink_type`): serve a
  disegnare la linea ondulata degli AP in mesh.

## Alternative scartate

- **Riaccendere la scansione veloce dei router** — scartata: la regola del 25/05 la spegne di nuovo
  all'avvio sulle reti grandi, e un job che sembra acceso non lo è.
- **Leggere le porte dei router con SNMP (BRIDGE-MIB)** — scartata per ora: non verificato sui
  RouterOS del cliente A, e l'SSH è già la via del router. Resta aperta per altri produttori.
- **Far valere la riga del router su un'interfaccia logica come «porta di bordo»** — scartata:
  bridge, VLAN e VRRP non provano un cavo (§11.1) e rimetterebbero il difetto di partenza.
- **Un collegamento a mano che vince su tutto** (rango 0) — scartata: un LLDP (costo 2) batte un
  manuale confermato (3); Riccardo ha «★ Rendi principale» per i casi che vuole decidere lui.
- **Fondere le due letture della stessa VM elemento per elemento** — scartata: un IP vecchio
  riassegnato abbinerebbe la VM sbagliata; si prendono IP e MAC vecchi solo se la lettura nuova
  non ne ha.
- **Risolvere subito «apparato e host sono la stessa macchina»** — rinviata: è dato sporco già noto
  (server classificati come switch, ADR 0008), serve una regola d'identità, non una deduplica.

## Conseguenze

### Positive

- Un router mostra ciò che è attaccato alle sue porte di bordo; i rami dietro porte di passaggio
  non generano collegamenti falsi.
- Sulla copia del cliente A: collegamenti 133 → 122, radici 4 → 3, apparati «senza padre» 26 → 24,
  falso fra due router tolto, 23 MAC di VM tolti dai client. Sull'hub: «da sistemare» 30 → 18.
- Collegamenti a mano con verifica; due letture della stessa VM sono una VM sola.

### Negative

- Un router si legge con una chiamata SSH in più per giro, e `arp_poll` senza rete tocca tutti gli apparati.
- Con i template Proxmox contati come VM spente il conteggio «N VM» è un po' gonfio.

### Cosa diventa difficile in futuro

1. **Le righe MAC dei router vengono solo dalla bridge host.** Un produttore o un firmware senza
   quella tabella (CRS con chip, RouterOS 6, altri marchi) non dà porte fisiche: servono la
   lettura dello switch chip o SNMP, e il filtro per tipo (`ether`/`bond`) va esteso.
2. **`arp_poll` senza rete legge tutti gli apparati.** Chi lo accende su una rete grande paga il
   giro intero; chi lo spegne ferma anche i router. La regola `scheduler-defaults` non lo tocca
   (non è `fast_scan`), ma un cambio di quella regola va riletto insieme.
3. **Un INSERT diretto in `scheduled_jobs` non basta**: lo scheduler legge i job all'avvio, serve
   un riavvio. Il rilascio via `git pull` aggiorna `/api/version` **prima** del riavvio: per
   sapere se il codice nuovo gira si guarda `MainPID`/`ActiveEnterTimestamp` o la riga della
   migrazione nel journal.
4. **L'id `vm:` dipende dall'apparato con l'id più basso del cluster**: se quell'apparato viene
   tolto o riclassificato, le mappe salvate con quella VM la perdono. «Aggiorna VM» rilegge proprio
   quell'apparato: se ha le credenziali rotte fallisce anche quando un altro membro funzionerebbe.
5. **I template Proxmox contano come VM spente** (N-1, aperto): gonfiano «N VM, M accese», compaiono
   nell'espansione e i loro MAC entrano fra quelli delle VM.
6. **Il principale cade per coppia, non per collegamento** (N-2): togliendo un collegamento a mano
   cade ogni scelta del principale fra quei due oggetti, anche se ne restava un secondo.
7. **MNDP «unico vicino» su una porta rinominata** (N-3): `ether1-gateway` non è più una porta
   fisica per la regola dei nomi; quel caso va guardato sul dato vero.
8. **Le fixture anonimizzate non hanno VM né i campi nuovi** (`medium`, `uplink_type`): chi le
   rigenera deve aggiornare `FORMA` in `fixture-anonime.test.ts`.
9. **MAC di una scheda in attivo/riserva**: lo switch vede il MAC del bond, e la scheda di riserva col
   suo MAC proprio non compare finché non passa il traffico.
10. **Apparato e host non hanno una regola d'identità comune**: la stessa macchina censita come «switch» e
    come host resta un isolato in «Da sistemare» (1-2 oggetti sul cliente A) finché manca una regola d'identità.

### Minori rimasti aperti

- «Ignora» di un collegamento si annulla da «Dati della mappa» → «Collegamenti ignorati»; il
  `DELETE` del principale risponde `{ ok: true }` anche senza una scelta.
- Sei vecchie righe ARP su porte instradate non si distinguono da quelle della bridge host
  (invecchiano a 2 giorni, spariscono a 30).
- Stile della linea sottile coperto sul tratto orizzontale comune; ridondanza fra pari livello che
  esce dal fianco; a 1280 px la barra del passo passo va su due righe.
- «Aggiorna VM» non è stata provata con un server vero: da guardare sul dev.
- Schede vive misurate su un host Proxmox su tre (gli altri si raggiungono solo dal cliente A).

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md` (§11, con §11.1 bis)
- Piano: `docs/superpowers/plans/2026-10-14-topologia-fase2b.md`
- ADR 0006 (scansioni), ADR 0008 (dati), ADR 0009 (mappe e MAC per porta), ADR 0007 (controller)
