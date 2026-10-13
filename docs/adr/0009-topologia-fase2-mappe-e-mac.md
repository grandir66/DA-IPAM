# ADR 0009 — Mappe passo passo salvate, automatica ricalcolata, MAC per porta

**Stato:** Accepted (supera la pagina e la disposizione dell'ADR 0003; completa l'ADR 0008)
**Data:** 2026-10-13
**Autore:** Riccardo Grandi, con Claude

## Contesto

La fase 1 (ADR 0008) ha reso giusti i dati. La mappa però era ancora quella vecchia (React Flow
con dagre), e sul dato vero di un cliente era inservibile: lo stesso router compariva tre volte, i
PC non dicevano a quale porta fossero attaccati, e non si poteva costruire una mappa un oggetto
alla volta. La tabella dei MAC per porta (`mac_port_entries`) era vuota: ogni lettura la
cancellava, quindi «dove è attaccato» spariva appena un PC si spegneva.

Misure sul dato vero (copie del 13/10, cliente A e hub; nomi e indirizzi non si riportano qui):

- il seriale degli host non è affidabile: circa metà dei seriali di un cliente era condivisa da host
  diversi, e i router MikroTik riportano tutti lo stesso seriale (un controller USB);
- i router in coppia hanno più indirizzi, due dei quali con MAC virtuale (VRRP/HSRP) condiviso;
- sul bridge di un router si vedono centinaia di MAC (tutta la rete): il numero di client ha senso
  solo su switch e AP;
- la lettura dei client UniFi, provata in sola lettura sulle copie, ha dato poche centinaia di
  client per cliente in meno di due secondi; sull'hub nessuno si abbinava, perché gli apparati
  erano stati letti l'ultima volta con il codice della fase 1 (senza `controller_mac`).

## Decisione

**Le mappe «passo passo» si salvano (tabella `topology_maps` più `topology_position`); la mappa
automatica si ricalcola a ogni apertura. Un oggetto fisico è un nodo solo, per MAC vero o nome
annunciato, mai per MAC virtuale né per seriale dell'host. La tabella dei MAC per porta invecchia
per 30 giorni, scritta da SNMP/SSH e dai client UniFi.**

- **Identità** (`src/lib/topology/identity.ts`, `node-index.ts`): prima l'unione per MAC vero, poi
  quella per nome, solo fra gruppi compatibili. Nomi di fabbrica (`MikroTik`, `localhost`,
  `router`…), nomi corti (sotto 4 caratteri) e nomi fatti solo di cifre o esadecimali non
  identificano; un nome che collegherebbe due gruppi con OUI veri diversi si salta. I MAC
  virtuali non identificano mai nessuno, nemmeno nell'indice per MAC.
- **Attaccati** (`attach.ts`): dove sta un MAC si legge dall'ultimo giro (letture entro la soglia dalla
  più recente); i client si contano solo su switch e AP.
- **Albero e disposizione** (`tree.ts`, `tree-layout.ts`): funzioni pure dei dati; la testa
  automatica è quella della sede o, altrimenti, il router che raggiunge più nodi; un admin la
  cambia (`PATCH /api/topology/maps/auto`).
- **Pagina** (`src/components/topology/map/`, rotte `/api/topology/maps*`): «Tutto automatico» e mappe
  «passo passo», pannello dei collegati, «Da sistemare».
- **Le mappe salvate seguono gli oggetti** promossi o fusi: il modello espone una mappa
  `canonical` (vecchio id → id attuale) e la mappa salvata la applica; i nodi si riscrivono con il
  nome nuovo solo alla prossima modifica (campo `rename` della rotta delle posizioni).
- **MAC per porta**: `mac_port_entries` ha chiave `(device_id, mac, port_name)` e due colonne
  (`first_seen`, `source`); la scrittura è `ON CONFLICT DO UPDATE` con `COALESCE`, così la lettura
  UniFi non cancella la VLAN che SNMP aveva scritto. Si pota a 30 giorni.
- **Lettura dei client UniFi**: un job a parte per controller, spento di default, che gira solo
  fra le 7:00 e le 19:59 (ora di Roma). Lo storico delle letture dei controller si divide per
  tipo di avvio: quelle con `trigger` «client:*» hanno le loro 50, quelle degli apparati le
  loro 50, così i giri orari dei client non cancellano gli altri.
- **Un errore sui MAC per porta non ferma il giro**: vicini e routing continuano (punto 12 dell'ADR
  0008); la riga `[MacPorta]` nel log dice quale apparato.
- Fatto emerso: a metà lavoro il file `DEFAULT.db` orfano dell'hub è risultato **malformato** al
  `quick_check` del 13/10 (nessun tenant attivo lo usa). Ricostruito con `.dump` il 13/10 sera, prima del
  rilascio (81 tabelle, righe identiche, integrità ok); originale `DEFAULT.db.bak-20261013-214254`.

## Alternative scartate

- **Mappe in JSON dentro `tenant_settings`** — scartata: non si interroga, non si migra, e si
  sovrascrive per intero a ogni salvataggio.
- **Storico degli spostamenti dei MAC** (dove era un PC mese per mese) — scartata: serve un
  secondo scrittore e nessuna schermata lo chiede; i 30 giorni di «ultima volta visto» bastano.
- **Il seriale come chiave dell'oggetto** — scartata: misurato inaffidabile (duplicati fra host
  diversi, valore unico per tutti i MikroTik).
- **Fusione per solo nome** — scartata nella forma semplice: due apparati diversi con nome di
  fabbrica sarebbero diventati uno; da qui le regole sopra.

## Conseguenze

### Positive

- Un oggetto con più indirizzi è un nodo solo; il pannello elenca i suoi indirizzi.
- «Dove è attaccato» sopravvive a un PC spento per 30 giorni.
- Mappe costruibili partendo da qualunque apparato, anche senza controller.
- Una mappa salvata non si rompe se un host viene promosso ad apparato o due oggetti si fondono.

### Negative

- Più scritture sul database a ogni lettura (una riga per MAC per porta).
- La mappa automatica di una rete grande è molto larga: per leggerla si usa «passo passo».

### Cosa diventa difficile in futuro

1. **Unire o separare a mano due oggetti non si può**: servirebbe una tabella delle decisioni. Se
   la fusione automatica sbaglia, si corregge la regola, non il singolo caso.
2. **Job dei client spento = attaccati solo da SNMP/SSH e LLDP**; chi non lo accende vede meno
   client. L'abbinamento dei client richiede apparati letti una volta con il codice della fase 1
   (`controller_mac`): finché non succede, zero client abbinati (visto sull'hub).
3. **La finestra 7:00–19:59 è fissa nel codice**: cambiarla è una modifica di codice. «Esegui ora» fuori
   orario risponde che non ha letto.
4. **`mac_port_entries` ha due scrittori** (poll dell'apparato e controller) con la chiave in comune:
   `source` è di chi ha scritto per ultimo, e i campi che uno non conosce (VLAN) li tiene l'altro grazie al
   `COALESCE`. Un terzo scrittore deve usare la stessa chiave e lo stesso `ON CONFLICT`.
5. **La vecchia vista `default` di `topology_position` resta orfana**: non si cancella, non si legge.
6. **Le mappe salvate dipendono da `canonical`**: chi cambia le regole di identità deve
   mantenere quella mappa, altrimenti le mappe salvate perdono nodi in silenzio. I nodi si riscrivono
   solo alla prossima modifica, quindi un id vecchio può vivere a lungo nel database.
7. **Gli stati**: lo stato «sconosciuto» di un apparato ripiega sui suoi host (altrimenti quasi tutti gli
   apparati senza interrogazione darebbero «?»); un host vecchio può quindi dare uno stato che non è
   dell'apparato. LibreNMS scrive «online», che la mappa leggeva come giù.
8. **Se `migrateTopologyPhase2` fallisce all'apertura** il tenant si apre lo stesso, ma senza indice unico né mappe:
   vedi ADR 0008, punto 12.
9. **Nomi di fabbrica**: l'elenco in `identity.ts` è scritto a mano; un produttore nuovo che usa
   un nome generico come nome host va aggiunto lì.

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md` (§10)
- Piano: `docs/superpowers/plans/2026-10-13-topologia-fase2-mappa.md`
- ADR 0003 (mappa), ADR 0008 (dati della fase 1), ADR 0007 (controller di rete)
