# ADR 0012 — Mappa verticale, stampa, ridondanze a richiesta e hypervisor dalle VM

**Stato:** Accepted (completa l'ADR 0010; rilasciata in v0.3.281 il 2026-10-14)
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude

## Contesto

Dopo il rilascio della fase 2b (ADR 0010) Riccardo ha chiesto: «non avrebbe più senso una
rappresentazione verticale, se poi si deve andare in stampa? Le caselle sono più larghe che
alte». Il dato vero (copia del cliente A del 14/10, `scripts/misura-orientamento.ts`) gli ha dato
ragione, e ha mostrato altri due difetti.

- **La mappa automatica è una striscia.** L'albero parte dall'alto e mette i fratelli affiancati:
  ogni fratello costa una larghezza di riquadro (170-230 px), ogni livello un'altezza (44 px). La
  mappa automatica del cliente A misurava **13.121 × 930 px**: «Adatta» su uno schermo da 1920 px
  la porta a zoom 0,10, illeggibile, e in stampa diventa una fila di fogli larghi un riquadro.
- **Il groviglio delle ridondanze.** Il cliente A ha due switch centrali e quasi ogni apparato è
  collegato a tutti e due. L'albero dà un solo padre, quindi ogni secondo cavo diventa una linea
  «ridondanza» che attraversa la mappa. Accese all'apertura (com'era nella 2b), coprivano il disegno.
- **Gli hypervisor del cluster stavano sotto uno switch di accesso**, sulla porta 1G di gestione.
  Sui centrali, dove arrivano i loro cavi 10G, passano solo i MAC delle schede (sconosciuti finché
  `hypervisor_sync` non legge le schede vive) e quelli delle VM: il MAC di gestione mai. Le VM però
  parlano chiaro: su una porta di un centrale passavano 15 VM accese, tutte dello stesso server; su
  un'altra 11, tutte di un altro.
- **Il nome DNS di due hypervisor non era quello del nodo Proxmox** (un nome vecchio rimasto nel DNS).

Testo vincolante: spec §12 (§12.2 orientamento, §12.3 stampa, §12.5 ridondanze e hypervisor).

## Decisione

**La mappa si dispone da sinistra a destra («Verticale», predefinito) e si stampa in SVG su
tasselli sovrapposti con una panoramica. Si disegna solo il collegamento principale, e un
hypervisor si aggancia al cavo da cui escono le sue VM.**

- **Orientamento per mappa.** Due orientamenti: «Verticale» (`lr`: un livello per colonna, i
  fratelli impilati, si legge dall'alto in basso come un elenco) e «Orizzontale» (`tb`, quello di
  prima). Verticale è il predefinito per tutte le mappe, anche quelle già salvate. L'orientamento
  è della **mappa**, non di chi guarda (`topology_maps.orientation TEXT NOT NULL DEFAULT 'lr'`):
  è una scelta di come si consegna la mappa. L'automatica lo tiene nella sua riga `auto`, che nasce
  alla prima scelta come per la testa. Lo cambia un admin, con
  `PATCH /api/topology/maps/<id|auto> { orientation }` (solo quel campo); gli altri vedono
  l'interruttore fermo, col motivo.
- **Ritocchi per orientamento.** Un ritocco vale nell'orientamento in cui è fatto
  (`topology_position.orientation`; `NULL` = `tb`, cioè tutte le righe di prima). Cambiando
  orientamento la mappa si ridispone da sola e i ritocchi dell'altro restano da parte. Resta una
  riga per mappa e oggetto: un ritocco nuovo sostituisce quello dell'altro orientamento.
  L'appartenenza alla mappa passo passo (`pinned = 0`) non dipende dall'orientamento. La rotta
  esige l'orientamento per salvare un ritocco (400 senza): con un valore predefinito una pagina che
  se ne dimentica scriverebbe in silenzio nel disegno sbagliato. «Riordina» toglie solo i ritocchi
  dell'orientamento che manda.
- **A schermo in verticale.** Le linee escono dal lato destro del genitore e passano da un tronco a
  14 px da lui (a metà fra le colonne l'etichetta di porta e velocità non ci stava). «Adatta»
  adatta la larghezza e porta in cima; la rotellina scorre, Ctrl o il pizzico fanno lo zoom.
- **Stampa.** «Stampa» apre `/topology/stampa?mappa=<id|auto>` in una scheda nuova, fuori dal
  layout del cruscotto. Il disegno è un **SVG statico** con le stesse coordinate dello schermo (un
  solo calcolo, `computeMapView`, per pagina e stampa) e lo stesso stile delle linee (`edgeLook`),
  in bianco e nero. Foglio A3 (predefinito) o A4, scala 100 % (predefinita) o 80 %, orientamento
  del foglio quello che dà meno fogli. Il primo foglio ha nome, data e ora italiana, legenda, la
  **panoramica** con la griglia dei fogli «riga-colonna» e l'elenco «Cavi di ridondanza». Gli altri
  sono **tasselli** con 15 mm di sovrapposizione, «Foglio r-c di R×C» e le frecce ai vicini. I
  tagli non spezzano i riquadri (il tassello dopo comincia prima del riquadro tagliato) e i
  tasselli vuoti non si stampano. Il PDF lo fa il browser.
- **Ridondanze a richiesta.** Si disegna solo il principale. Il riquadro porta «⇄ N» (testo e
  simbolo); un clic mostra le sue ridondanze, «Mostra ridondanze» le mostra tutte (ricordato per chi
  guarda). «⇄ N» a schermo e l'elenco della stampa contano le stesse linee: quelle fra due riquadri,
  non verso un attaccato. La disposizione non cambia: usava già solo i principali.
- **Fonte `vm_mac` («dalle VM»).** Una porta di bordo di uno switch o AP (non uplink, non porta di
  un collegamento verso un altro oggetto) su cui passano MAC di VM **accese** e **tutte** dello
  stesso hypervisor H (almeno una) propone il collegamento porta ↔ H. Ogni MAC di VM sta su **una
  sola porta**, come i client: fra le letture del suo **ultimo giro** (6 ore dalla più recente, così
  la porta di prima di una migrazione non conta) vince la porta di un cavo già noto di H, poi quella
  con meno MAC distinti freschi, poi la lettura più recente. Il proprietario di un MAC è
  l'hypervisor della lettura Proxmox più recente che lo riporta. «Ignora il collegamento…» vale
  anche per questa fonte e per la tabella MAC. Si somma alle schede vive (ADR 0010), non le
  sostituisce.
- **Principale dell'hypervisor = il cavo più veloce.** Fra i suoi collegamenti dai dati vince
  prima quello non vecchio (§11.3, «recenti prima»), poi il più veloce, poi quello con più VM, poi
  le regole di prima. «★ Rendi principale» vince sempre. Così il 10G verso il centrale è il
  principale e il 1G di gestione una ridondanza.
- **Nome dal Proxmox.** Se l'IP di un hypervisor sta nelle schede di un host della scansione
  Proxmox e il nome è diverso, il riquadro prende il nome del Proxmox con «DNS: nome di prima»
  sotto, a schermo e in stampa; l'inventario non si rinomina. Vale solo l'abbinamento per IP, e
  solo da una scansione degli **ultimi 30 giorni** (Riccardo, 14/10): un server con la sola
  scansione di maggio prendeva un nome che nessuno poteva confermare.

## Alternative scartate

- **La coppia di centrali in un riquadro solo** — scartata il 14/10: toglie il groviglio solo per
  quei due apparati e rompe «un oggetto fisico, un nodo» (§10.4); le ridondanze a richiesta lo
  tolgono senza toccare il modello. Resta l'idea per dopo: sul cliente A il centrale 2 pende da uno
  switch di accesso invece di stare accanto al centrale 1.
- **Instradamento automatico delle linee con ELK** — scartato già in §5: esito meno prevedibile,
  contro «stessa rete = stesso disegno». Qui in più la stampa deve avere le stesse coordinate dello
  schermo, ritocchi compresi.
- **Trovare i cavi dei server con l'LLDP** — scartato: l'LLDP della scheda di un hypervisor manda
  solo un MAC senza nome, che non dice di chi è; e i cavi di riserva dei bond non portano VM.
- **Collegare gli hypervisor solo a mano** («Collega a…» della 2b) — scartato come regola: è lavoro
  da rifare a ogni cluster e a ogni ricablaggio, mentre le VM sulle porte danno il cavo da sole. A
  mano resta per i casi che i dati non vedono.
- **Soglia di 2 VM per la fonte `vm_mac`** — scartata: nasconde i server con una VM sola e non
  ripara le porte di passaggio, che si risolvono con «una porta per MAC». Prezzo: qualche riga in
  più nell'elenco delle ridondanze (sul cliente A, due porte di switch di accesso con 1 VM).

## Conseguenze

### Positive

- Sulla copia del cliente A la mappa automatica in verticale è larga circa 2.600 px: «Adatta» a
  1920 px dà zoom 0,51 invece di 0,10. In A3 al 100 % sono 9 pagine contro 11, in A4 16 contro 23
  (primo foglio compreso; misura del 14/10, PDF con pagine = fogli e nessuna pagina bianca).
- Gli hypervisor del cluster stanno sotto il centrale col 10G, il 1G di gestione è una ridondanza:
  sulla copia 7 collegamenti `vm_mac` (5 nuovi, 2 fusi con la tabella MAC), 3 hypervisor su 4 con
  il principale cambiato.
- Pagina e stampa usano lo stesso calcolo: non si possono più disegnare due mappe diverse.
- «Ignora» funziona anche sui collegamenti della tabella MAC e del ripiego del router: prima si
  salvava e la linea restava (ripiego muto).

### Negative

- I ritocchi orizzontali esistenti non valgono in verticale: chi apre una mappa ritoccata la trova
  ridisposta.
- In verticale la mappa è alta invece che larga: a schermo si scorre in giù, e in A3 al 100 %
  resta su più fogli (si legge tutta solo sulla panoramica).

### Cosa diventa difficile in futuro

1. **Due disposizioni da tenere allineate.** `tree-layout.ts` (`tb`) e `tree-layout-lr.ts` (`lr`)
   sono due algoritmi; ogni ritocco della disposizione (attaccati, gruppi AP, VM, riga «DNS:»,
   porte sopra il riquadro) va fatto e provato in tutti e due. Anche la stampa (`print-draw.ts`)
   ripete la geometria dei gradini dello schermo (tronco a `LR_TRUNK`): chi cambia l'una cambia l'altra.
2. **I ritocchi orizzontali esistenti non valgono in verticale.** Sul cliente A sono 139: restano
   da parte e ricompaiono passando a «Orizzontale». Non c'è conversione automatica, e una conversione
   futura dovrà decidere cosa vuol dire uno spostamento ruotato.
3. **Le pagine aperte prima del rilascio** salvano i ritocchi senza orientamento e ricevono 400; il
   loro «Riordina» non manda l'orientamento e toglie i ritocchi di **tutti e due** (M-5). Si
   ricarica la pagina. Ogni campo nuovo obbligatorio su quella rotta avrà lo stesso effetto.
4. **La stampa dipende dal browser per il PDF.** La scala vera c'è solo con margini «Predefiniti» e
   scala «Predefinita» (la barra della pagina lo dice): chi li cambia rimpicciolisce tutto e i 15 mm
   di sovrapposizione non tornano più. Un PDF generato sul server chiederebbe un browser sul server.
5. **La finestra di 6 ore di `vm_mac` è tarata su letture orarie** (R-1). Sul cliente A e sull'hub
   switch e UniFi si leggono ogni ora dalle 7 alle 19, e di notte nessuno legge, quindi l'ultimo giro
   sta tutto nelle 6 ore. Uno switch letto più di rado perde le letture giuste: l'hypervisor perde il
   cavo «dalle VM» (resta il 1G) o, con una porta di passaggio senza proprietari, torna il principale
   sbagliato. Il rimedio è una finestra per switch (il suo ultimo giro). Chi cambia la cadenza delle
   tabelle MAC deve rileggere questa regola.
6. **Parcheggiati, consapevolmente:**
   - **M-2** · stesso switch, due cavi: se il 1G di gestione e il 10G delle VM vanno allo stesso
     switch c'è un solo collegamento (per coppia di oggetti) e si vede il 1G, con le fonti «tabella
     MAC + dalle VM». Il rimedio vero è il modello con più cavi per coppia (schede vive, §11.5);
   - **M-3** · il proprietario dei MAC di VM viene anche da scansioni Proxmox vecchie, se sono le
     uniche a riportarli (per il nome è già risolto con i 30 giorni);
   - **M-5** · «Riordina» da una pagina vecchia toglie i ritocchi di tutti e due gli orientamenti
     (punto 3);
   - **R-2** · migrazione da meno di 6 ore: la porta vecchia e quella nuova convivono, la porta del
     primo hypervisor può risultare «di due» e perdere per qualche ora il collegamento. Si ripara da sola;
   - **R-3** · la regola «porta del cavo noto prima» rafforza anche un cavo noto falso (un
     `mac_table` sbagliato); il rimedio è «Ignora».
7. **Restano aperti, minori:** due collegamenti `vm_mac` da 1 VM su switch di accesso (ridondanze
   nell'elenco, non disegnate), e i minori del collaudo: «⇄ N» sull'ultima riga accorcia IP e
   client; la parola «ridondanza» evita i riquadri ma non le altre scritte; i numeri della griglia
   sulla panoramica coprono un po' di disegno; a 1280 px «Adatta» scende a zoom 0,27. Le prove della
   disposizione `lr` non hanno un albero misto (ramo profondo accanto ad attaccati e gruppo AP):
   vanno aggiunte alla prossima modifica.

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md` §12 (§12.2, §12.3, §12.5)
- Piano: `docs/superpowers/plans/2026-10-14-topologia-verticale-stampa.md`
- Commit dal `d57432b` (spec) al `50ad0f3` (release v0.3.281) sul ramo `topologia/verticale`
- ADR 0009 (mappe e MAC per porta), ADR 0010 (fase 2b: collegamenti a mano, hypervisor e VM)
