# ADR 0021 — Unire e separare a mano gli oggetti della mappa (apparati con più indirizzi)

**Stato:** Accepted — sul ramo `topologia/unioni-a-mano`; rilascio con la conferma di Riccardo (nessuna unione al rilascio)
**Data:** 2026-10-16
**Autore:** Riccardo Grandi, con Claude

## Contesto

Un apparato con più schede su più reti (il caso di partenza: un NAS dell'hub, quattro indirizzi su tre reti, MAC tutti
diversi e nessun apparato censito) oggi è **tre oggetti** sulla mappa, ognuno col suo collegamento: le regole automatiche
dell'indice dei nodi (`node-index.ts`) fondono un host in un apparato per indirizzo, apparato fisico, MAC o nome, e due host
fra loro per MAC o nome, ma qui nessuna prova li lega. La spec della mappa (`specs/2026-10-12-topology-map-design.md` §10.4)
lasciava fuori «unire o separare a mano due oggetti» perché serviva una tabella.

Riccardo il 16/10: **nessuna regola automatica nuova, si unisce solo a mano**; «Unisci con…» e «Separa…» in tre posti
(mappa, scheda, Discovery); livello completo, rilascio a parte con la sua conferma. Il collegamento a mano che c'è già
(«Stesso device fisico», `physical_device_id`) serve alle scansioni, e il risolutore lo riscrive da solo
(`identity-resolver.ts`): una decisione a mano lì si perderebbe senza traccia.

## Decisione

**Due tabelle nel DB del cliente, `topology_unioni` (gruppi di membri) e `topology_separazioni` (coppie che non si fondono
da sole), mai cancellate. Le applica un punto solo, l'indice dei nodi delle due mappe; senza righe la mappa è quella di
prima, bit per bit.**

1. **Una tabella propria**, non `physical_device_id` né una colonna su `hosts`/`network_devices`: il risolutore riscrive
   quei campi, e `physical_device_id` guida la deduplica delle scansioni, che un gesto sulla mappa non deve toccare. Le
   righe si tolgono con `tolto_da`/`tolto_il`, mai `DELETE`: la riga è anche la storia (chi e quando).
2. **«Separa» toglie anche le fusioni automatiche deboli** (apparato fisico, MAC, nome, gruppi di host), mai l'indirizzo
   dell'apparato (`host_id`) né quello con l'IP di gestione: senza, una fusione automatica sbagliata non avrebbe rimedio, e
   toglie soltanto, quindi non è una regola nuova.
3. **I membri sono gli indirizzi** (`host:N`; un apparato si scrive col suo host, `dev:N` solo se non ne ha): l'unione regge
   alla promozione a apparato e alla rimozione dell'apparato.
4. **Il nodo che resta:** un apparato vince su un host; fra soli host il primo membro rimasto (l'id più basso), come i
   gruppi automatici di oggi.
5. **«Apparato + apparato» fuori**: la rotta lo rifiuta (409) e, se nasce dopo, l'unione non si applica e scheda e dettagli
   lo dicono. Un alias per un apparato perderebbe i suoi vicini nelle due mappe (`links.ts` scarta i vicini di un apparato che
   non è un nodo).
6. **Le unioni dopo tutte le regole automatiche**: un'unione non attira altri oggetti per nome; collegamenti, correzioni, ★,
   posizioni e ritocchi seguono da `canonical`, come per le fusioni automatiche.
7. **Nessun interruttore**: il gesto è già a mano e per oggetto, e senza righe ingresso e modello non hanno i campi nuovi
   (`unioni`, `separazioni`, `model.unioni` presenti solo con righe), quindi le impronte di oggi non cambiano.
8. **Anteprima obbligatoria**: le due POST vogliono `applica` esplicito, `false` non scrive; tutte e due solo da admin.
10. **Ogni «Unisci» scrive in un gruppo nuovo** e ci sposta le righe attive dei gruppi delle ancore, così l'unione nuova si
   applica per ultima e non porta via membri di un'unione più vecchia (revisione finale del 16/10); se cambierebbe un'altra
   unione già fatta risponde 409 con un testo che dice quale separare prima, mai un 500.
9. **Un indice, due mappe**: fuori da `node-index.ts` l'indice si costruisce solo con `indiceDeiNodi(input)` (lucchetto nelle
   prove), così la mappa di oggi e quella per cavo vedono gli stessi nodi.

Misure sulle copie del 16/10 (hub e cliente A): senza righe impronte e padri uguali nelle due mappe; il NAS unito in memoria
passa da tre oggetti a uno, i tre collegamenti verso il router diventano uno, nessuna coppia persa.

## Alternative scartate

- **Scrivere `physical_device_id`**: lo riscrive il risolutore e cambia la deduplica delle scansioni.
- **Una colonna su `hosts`**: stesso difetto (il risolutore non la conosce) e niente storia.
- **Fondere da soli gli host con lo stesso `physical_device_id`**: sarebbe una regola automatica nuova (decisione 1).
- **Alias per gli apparati** («apparato + apparato»): i vicini dell'apparato assorbito sparirebbero nelle due mappe.
- **Un interruttore per cliente**: niente da proteggere finché non c'è una riga.

## Conseguenze

- **Convivono due funzioni simili**: «Stesso device fisico» (scansioni) e «Unisci con…» (mappa); la scheda le mostra in due
  sezioni con nomi diversi. Riunirle è una proposta per dopo (confermato da Riccardo il 16/10).
- **Cosa diventa difficile:** «apparato + apparato» vorrà riscrivere gli id `dev:` nell'ingresso; ogni chiamante nuovo
  dell'indice passa da `indiceDeiNodi`, e ogni regola automatica nuova rispetta le separazioni; un campo nuovo del modello di
  T1 va passato anche in `cavi/mappa.ts`.
- Dopo un «Separa», le mappe passo passo che avevano rinominato il membro nell'alias non lo mostrano più («Aggiungi
  collegati» lo rimette).
- Estendere un'unione riscrive le sue righe con chi estende e l'ora: la scheda mostra l'ultimo; chi l'aveva fatta prima
  resta nelle righe tolte. Un caso raro (un gemello separato e unito altrove) che col «gruppo più basso» riusciva ora dà
  409: si separa prima l'altra unione.
- Un indirizzo separato che non ha collegamenti propri esce dall'oggetto e non compare sulla mappa, come ogni host senza
  collegamenti (misurato sul cliente A).
- Nel trasferimento fra installazioni i membri sono testo (`host:N`) e non seguono la rinumerazione degli id, come le
  posizioni e le correzioni della mappa di oggi.
- Ogni POST costruisce l'indice tre o quattro volte: sull'hub pochi millisecondi (modello in 8 ms sulla copia).
