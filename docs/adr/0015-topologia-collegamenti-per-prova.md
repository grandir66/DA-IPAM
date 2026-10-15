# ADR 0015 — Collegamenti come la rete reale, tappa T1

**Stato:** Accepted (pronta il 2026-10-15 sul ramo `topologia/collegamenti-t1`, non ancora rilasciata: aspetta la conferma di Riccardo)
**Data:** 2026-10-15
**Autore:** Riccardo Grandi, con Claude

## Contesto

Il 14/10 la mappa automatica del cliente A appendeva core 1 a uno switch di accesso, e quello switch al
router; il router ha invece un solo cavo diretto, a 10G, proprio verso core 1. Le cause, lette sulle copie
del 14/10 (spec §13.1):

- **Una linea «cucita».** Una linea era una coppia di apparati con le porte prese da prove diverse: la
  porta di core 1 dall'uplink del controller, quella del router dalla prima riga del router in ordine
  (`ether8`, che non è un cavo verso core 1). Su quella linea è stato scelto «Ignora».
- **«Ignora» per coppia.** La correzione toglieva la coppia intera, e la coppia ignorata contava come già
  collegata per tabella MAC, ripiego e VM: è sparito anche il cavo vero a 10G.
- **I vicini del router tutti «mndp» e troncati.** Il protocollo era scritto fisso e i valori si leggevano
  fino al primo spazio («Port 47» diventava «Port»): il modello non distingueva un cavo da un annuncio
  arrivato attraverso uno switch.
- **Una porta che sente più apparati** (la porta 15 di core 1 sente router 1, router di riserva e un
  modem) dava cavi a tutti: in mezzo c'è qualcosa che ripete gli annunci, cioè un segmento.

Riccardo ha chiesto di bilanciare LLDP, CDP, MNDP, spanning tree e controller «in forma di infrastruttura
reale di networking», e poi (vincolo 9, 14/10 sera) che **la logica valga per qualunque rete e qualunque
marca**: il cliente A e l'hub sono due misure, non il bersaglio. La spec del capitolo 13
(`docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md`) divide il lavoro in quattro
tappe; T1 è la correzione rapida, a livello leggero, senza schema. La notte del 15/10 la lettura dei
router dell'hub ha portato cinque regole in più («passaggio universale», spec §13.16).

## Decisione

**In T1 una linea prende le porte da una prova sola, «Ignora» vale per un cavo, una porta che sente due o
più apparati non dà cavi, le porte si leggono con un traduttore per prodotto, e le cinque regole del
passaggio universale entrano accese, spegnibili solo dalla misura.**

1. **Porte da una prova sola.** Fino a T3 una linea resta una coppia, ma le sue due porte vengono dallo
   stesso candidato; fra più cavi vince quello che lascia la linea «vista». Gli altri cavi fra i due
   oggetti stanno nei dettagli, «Altri cavi visti fra questi due oggetti».
2. **Lettore dei vicini del router corretto, stesso comando** (`/ip neighbor print terse`): protocollo vero
   da `discovered-by`, valori interi anche con gli spazi. A schermo la riga `mndp` è «annuncio di rete
   (MNDP o CDP)». Nessun comando nuovo sui router.
3. **«Ignora» per cavo** (D3). Una correzione nasconde un cavo (coppia e porte); una di prima che non
   corrisponde a nessun cavo visto è **orfana**, si vede («non corrisponde a nessun cavo visto: non toglie
   niente») e si toglie o si sostituisce a mano («Togli la correzione», «Scegli il cavo da ignorare…»).
   Una correzione senza porte toglie solo un cavo senza porte. Nessuno script converte le correzioni.
4. **Regola del segmento in T1** (13.15, punto 2): una porta che, nella finestra «non visto», sente via
   LLDP o CDP due o più apparati non dà cavi; chi resta senza collegamenti va in «Da sistemare»,
   «nessun collegamento». «eth0» non è una chiave di porta.
5. **Traduttori per prodotto** (`src/lib/topology/lettori/`) e **chiave della porta** (`cavi/porte.ts`:
   `i:<indice>` o `n:<nome normalizzato>`): le forme dei nomi dei prodotti stanno fuori da `links.ts`; un
   nome scelto dal cliente è «non noto». Il ripiego del router parte solo da porte che il traduttore
   riconosce come fisiche.
6. **Pareggi per verso e velocità**, non per id (`chiaveScelta`); la testa proposta, a pari oggetti
   raggiunti, è il gateway di più reti, e l'id decide solo per ultimo.
7. **Il passaggio universale** (`REGOLE_T1` in `src/lib/topology/regole.ts`): un nome scelto dal cliente non
   è una porta fisica; gli apparati di una porta si contano per apparato; fra una VM e il suo hypervisor
   nessun collegamento, e i MAC propri di un apparato non sono client, VM né vicini; la testa dalle reti di
   cui fa da gateway; la velocità di un nome doppio. L'app le ha tutte accese; solo
   `scripts/misura-cavi.ts --senza-regola` ne spegne una, per misurarla (C19).
8. **A schermo** il lato più vicino per ridondanze, linee a mano fuori dall'albero e figli spostati a mano
   (`latiVicini`, una funzione per schermo, stampa e misura); le linee dell'albero restano a tronco.
   L'elenco a sinistra si chiude («◂ Elenco» / «Elenco ▸»).
9. **Misura prima, ritorno pronto.** `scripts/misura-cavi.ts` misura sulle copie (scenari, padri, conteggi,
   tempo; `--adesso` fissa l'ora a cui il modello giudica «non visto»). `scripts/ripristina-vicini-router.ts`
   è lo script di «Tornare indietro»: col codice di prima, le righe nuove del router fra router dai due
   lati cambiano un padre, e lo script le riporta a `mndp`.

**Misurato il 15/10** sulle copie della notte, col «prima» e il «dopo» sulla stessa copia e con lo stesso
orologio: cliente A, tre apparati cambiano padre (core 1 sotto router 1 sul cavo a 10G, uno switch di
accesso sotto core 1, il router di riserva sotto un altro switch di accesso), linee cucite 1 → 0, rami
contro il verso 1 → 0, una correzione orfana, un server senza nome esce da «Da sistemare»; hub, tre
hypervisor sotto l'aggregazione e tre switch di laboratorio fuori dall'albero, in «Da sistemare». Le cinque
regole spente una per volta: sul cliente A nessuna cambia niente, sull'hub ognuna fa ciò che la spec
prevede. Tempo del modello sul cliente A, sul Mac: circa 18-19 ms (prima circa 14; tetto 20).

## Alternative scartate

- **Ricostruire `device_neighbors` col protocollo nella chiave** — vietato su una tabella con chiavi
  esterne (ADR 0008).
- **Una tabella dei collegamenti salvata** — un secondo scrittore da tenere coerente: ogni divergenza è un
  cavo fantasma. Il collegamento si calcola.
- **Il `print detail`, il JSON o la REST come formato del lettore** — il detail va a capo da solo; il JSON
  con `detail` non è provato prima della 7.24.2; la REST chiede servizi da aprire sui router dei clienti.
  Un formato solo, scelto sull'uscita vera.
- **Le forme dei nomi dei prodotti nella logica dei collegamenti, anche solo per la correzione rapida** —
  la logica non sarebbe più indipendente dal prodotto, e la prova dei nomi resterebbe verde lo stesso.
- **Una regola sul nome per «VL_…» o «WAN»** — è un nome scelto dal cliente; il tipo dell'interfaccia
  arriva in T2. Un nome non riconosciuto è «non noto».
- **Un nome non noto come porta fisica (la regola di prima) anche per un router col suo traduttore** —
  sull'hub fa una linea fra due router da una VLAN.
- **Contare gli apparati di una porta per MAC anche nelle righe di RouterOS** — lo stesso router ha un MAC
  per interfaccia: segmenti falsi.
- **«eth0» come porta, e la chiave «SFP_ N» → indice N** — segmenti falsi e velocità sbagliate.
- **Il segmento come switch fantasma censito** — scrittura sul DB e oggetto finto; il segmento si calcola.
- **Chiavi di porta salvate sulle correzioni** — schema in più per un caso raro: una porta rinominata rende
  la correzione orfana, e si vede.
- **Uno script che converte la correzione del 14/10** — scrittura sui dati di produzione; D3 la vuole
  riguardata a mano.
- **«Nessuna radice sola» già in T1** — toglierebbe dalla mappa la radio lontana del cliente A fuori
  dall'elenco di D1: va in T1b, con gli oggetti senza prove.
- **Una soglia di età sulla posizione delle VM già in T1** — riapre il punto M-3 dell'ADR 0012 con una
  soglia da scegliere: la decide Riccardo.
- **A pari rango il collegamento instradato perde, già in T1** — la parità su cui poggia oggi non c'è; sta
  in T3.
- **Instradamento automatico delle linee (ELK)** — già scartato: il lato più vicino è deterministico e basta.
- **Tutte le tappe insieme** — cliente A e hub ricevono `dev` da soli: ogni tappa deve potersi togliere da
  sola.

Le altre, col perché, nella spec §13.13.1.

## Conseguenze

### Positive

- Core 1 del cliente A sta sotto router 1, sul cavo a 10G; nessuna linea cucita; un «Ignora» non può più
  far sparire un cavo vero per caso, e una correzione che non tocca niente lo dice.
- Le righe del router hanno il protocollo vero e le porte intere; sull'hub la linea verso il router di
  frontiera passa dai cavi veri, e nessun hypervisor sta sotto una sua VM.
- Ogni regola è scritta per ogni rete e provata su cinque famiglie di reti-campione inventate; le due reti
  vere sono misure, con le loro prove.

### Negative

- Il modello costa di più: circa 18-19 ms sul cliente A, sul Mac, contro 14; il tetto è 20 e l'appliance
  è più lenta.
- Chi stava solo dietro una porta di segmento esce dall'albero e va in «Da sistemare» (sull'hub i tre
  switch di laboratorio).
- La correzione del 14/10 resta orfana finché Riccardo non la toglie.
- Tornare indietro non è più solo un `git revert`: le righe del lettore nuovo restano (si potano a 90
  giorni) e il codice di prima, nel caso peggiore, cambia un padre; serve lo script, che scrive sul DB del
  cliente con la sua conferma.
- L'ingresso del modello ha cambiato forma (elenco delle porte, via di lettura, piattaforma remota): le
  fixture del modello sono state riestratte.

### Cosa diventa difficile in futuro

- **Le porte stanno in più posti** (`switch_ports`, `device_neighbors`, i MAC per porta, e da T2 i fatti di
  spanning tree): un lettore nuovo deve sapere dove scrivere, con la stessa chiave, e chi prevale per
  l'elenco delle porte.
- **Ogni lettore nuovo porta il suo traduttore**, che porta le forme del prodotto nel vocabolario neutro.
  Una stranezza di un prodotto si risolve nel suo traduttore; chi la sposta in `links.ts` «perché fa
  comodo» riapre il problema, e la prova dei prodotti lo ferma.
- **Chi legge `device_neighbors` ha una regola in più** (R-superata: per apparato, fonte, porta locale e
  apparato remoto contano solo le righe dell'ultimo giro), e la finestra «non visto» per contare gli
  apparati di una porta è un'altra ancora.
- **Le correzioni restano legate al nome della porta**: una porta rinominata le rende orfane (si vedono,
  non si applicano altrove).
- **Due modi di tracciare le linee**: il tronco per l'albero, il lato più vicino per il resto. Schermo e
  stampa li prendono dallo stesso modulo: chi cambia l'uno cambia l'altro. Una forma nuova di riquadro deve
  dichiarare i suoi quattro lati.
- **Le reti-campione sono codice da tenere vivo**: ogni lettore nuovo porta la sua famiglia, o ne allarga
  una, e ogni criterio generale ha la sua riga nel resoconto della tappa. Una regola che passa sui due casi
  reali e non sulle reti-campione si corregge, non si tara.
- **Ciò che sceglie il cliente non entra nella logica**: una regola su un nome sta nel traduttore del
  prodotto solo se il nome è di fabbrica; un nome scelto resta «non noto» finché non si legge il tipo.
- **Una misura «prima/dopo» vale solo con lo stesso orologio**: il modello giudica «non visto» dall'ora
  della misura, e due misure a ore diverse cambiano per l'orologio, non per il codice (`--adesso`).

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` (§13.11.1 per T1,
  §13.13 alternative e difficoltà, §13.15 decisioni del 14/10 sera, §13.16 passaggio universale)
- Piano: `docs/superpowers/plans/2026-10-14-topologia-collegamenti-T1.md`
- Script: `scripts/misura-cavi.ts`, `scripts/ripristina-vicini-router.ts`
- ADR 0008 (dati della mappa), 0009 (mappe e MAC per porta), 0010 (fase 2b), 0012 (verticale e stampa)
