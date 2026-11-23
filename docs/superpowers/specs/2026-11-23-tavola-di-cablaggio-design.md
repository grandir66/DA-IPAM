# Tavola di cablaggio — una seconda vista della Topologia

**Data:** 2026-11-23 · **Chi la chiede:** Riccardo («sarebbe possibile integrare la mappa dinamica dentro da-ipam,
collegandola ai dati reali?»; «esiste già una pagina topologia, ma quello che hai generato è molto efficace»).
**Modello:** la tavola fatta a mano per la sede Domarc nella sessione DA-Infra del 18-20/11
(artifact `M6kM8kAvznAcTbLhV4V5pH`, sezione «Tavola di cablaggio della sede»).
**Livello proposto:** base (interfaccia e una rotta di sola lettura; niente zone rosse, niente scritture sul dato).
**Stato:** da approvare. TASKS: sezione 2026-11-23 «Idea: la tavola di cablaggio…».

## 1. Cosa è e cosa non è

Una pagina che mostra **ogni apparato come un pannello di porte**: le porte in fila, ognuna colorata per tipo, e
**sotto ogni porta scritto dove va**. I cavi corrono nei corridoi fra le file di apparati; passando il mouse su
una porta o su un cavo resta acceso solo quel collegamento.

Risponde alla domanda «**cosa c'è attaccato alla porta 17 di quello switch, e dov'è l'altro capo?**», che la
Topologia di oggi (un grafo di oggetti, uno per nodo) non mostra senza aprire la scheda di ogni collegamento.

**Non è:**
- un sostituto della Topologia: stessi dati, altra vista. Si arriva da un collegamento accanto a «Dati della mappa»;
- un editor: i cavi tracciati a mano, gli «Ignora», le unioni e i principali restano nella Topologia (v1 di sola lettura);
- la vista «Servizi» (pubblicazioni NAT, reverse proxy) né la vista «Sedi e tunnel»: sono le fasi 2 e 3 dell'idea in
  TASKS e hanno bisogno di lettori nuovi. Questa spec non le tocca.

## 2. Da dove vengono i dati (niente lettori nuovi)

| Cosa serve | Da dove | Già esiste |
| --- | --- | --- |
| Apparati, sito e armadio | `TopologyModel.nodes` (`MapNode`: `siteId`, `rackId`, `type`, `ruolo`, `vendor`) | sì, `GET /api/topology/model` |
| Collegamenti con le due porte | `TopologyModel.links` (`MapLink`: `a`/`aPort`, `b`/`bPort`, `cavo.fascio`, `stale`, `speedMbps`) | sì |
| Elenco completo delle porte di un apparato | `switch_ports` (`port_index`, `port_name`, `status`, `speed`, `vlan`, `is_trunk`, `mac_count`, `single_mac_hostname`, `single_mac_ip`, `poe_power_mw`) | sì, ma oggi solo una per volta (`/api/topology/ports?node=`) |
| Schede degli hypervisor | `hypervisorNics()` dalla scansione Proxmox (come fa `getTopologyKnownPorts`) | sì |

L'unica cosa nuova lato server è una rotta che restituisca **in un colpo le porte di tutti gli apparati di un sito**,
perché chiamare `/api/topology/ports` quaranta volte non va bene:

`GET /api/topology/tavola?site=<id>` → `{ site, apparati: [{ node, porte: PortaTavola[] }] }`.
Sola lettura, `requireAuth` + `withTenantFromSession` come le rotte sorelle, `NO_STORE`. Legge `switch_ports` con una
query sola (`WHERE device_id IN (...)`) e per gli hypervisor riusa `hypervisorNics`. Il modello dei collegamenti si
prende dalla rotta esistente: la tavola **non ricalcola** niente della Topologia, così le due viste non possono dire
cose diverse sullo stesso cavo.

## 3. La logica (pura, in `src/lib/topology/tavola/`)

Tre file, tutti senza accesso al database e provati con `node --test`:

- **`componi.ts`** — da modello + porte alla tavola: per ogni apparato l'elenco porte e, per ogni porta, il **tipo**
  e la **destinazione**:

  | Tipo | Quando | Destinazione scritta sotto |
  | --- | --- | --- |
  | `linea` | collegamento con `cavo.wan` o verso un nodo fuori sito/Internet | nome della linea o dell'altro capo |
  | `trunk` | collegamento fra due apparati di rete (switch, router, firewall), o fascio/LAG | `<apparato> p<porta>` |
  | `server` | collegamento verso un hypervisor o un server | `<apparato> <scheda>` |
  | `client` | nessun collegamento ma `single_mac_hostname` o `single_mac_ip` | il nome o l'IP |
  | `molti` | nessun collegamento e `mac_count > 1` (non è un trunk 802.1Q: vedi trappola in CONTEXT) | «N MAC» |
  | `libera` | `status` `down` o `disabled`, nessun collegamento | niente (porta tratteggiata) |
  | `dubbio` | collegamento `stale`, `cavo.porteDaVerificare`, oppure porta giù con un collegamento | come sopra + «da verificare» |

  Un fascio (`cavo.fascio.membri`) diventa **una riga per membro**, unite da una graffa sotto le porte.
  Il nome della porta si mostra come lo dà `traduciPorta` (stessa forma della Topologia), il numero corto sulla porta.

- **`righe.ts`** — in che ordine stanno gli apparati: per sito, poi per armadio (`rackId`), e dentro l'armadio per
  ruolo: router e firewall, poi switch di nucleo (`ruolo: "core"`), switch di accesso, hypervisor, il resto.
  Un apparato con più di 28 porte va su una riga sua; gli altri si affiancano finché la riga non supera la larghezza.

- **`instrada.ts`** — dove passano i cavi, la parte che nella tavola a mano ha richiesto più lavoro:
  - fra due file adiacenti il cavo scende dalla porta, corre orizzontale in una **corsia** del corridoio e risale;
    ogni corridoio ha tante corsie quanti cavi lo attraversano (`altezza = 30 + 8 × corsie`), assegnate in modo che due
    cavi non si sovrappongano mai sullo stesso tratto orizzontale (assegnazione a intervalli, la più semplice: si
    ordina per x di partenza e si prende la prima corsia libera);
  - fra file **non adiacenti** il cavo non attraversa gli apparati in mezzo: esce nel corridoio sotto la sua fila,
    va al **bordo** (sinistro o destro, quello più vicino alla x media dei due capi), scende in una corsia di bordo
    e rientra nel corridoio sopra la fila d'arrivo;
  - collegamenti dentro la stessa fila: corsia del corridoio sotto la fila.

  Uscita: per ogni cavo una polilinea ortogonale. Nessun calcolo grafico nel componente.

## 4. L'interfaccia, oggetto per oggetto

Pagina `/topology/tavola`, stesso guscio della Topologia (sidebar Domarc), larghezza di riferimento 1920.

1. **Barra in alto**: titolo «Tavola di cablaggio», scelta del **sito** (i siti di `TopologyModel`; si ricorda per
   utente), interruttore «Mostra porte libere» (acceso), ricerca «Trova porta o apparato» che accende il risultato.
2. **Legenda** in una riga: un quadratino per tipo, col nome. Colori del design system Domarc **più un segno che non
   dipende dal colore** (Riccardo è daltonico): `linea` piena scura, `trunk` con bordo doppio, `server` piena chiara,
   `client` vuota con bordo, `libera` tratteggiata, `dubbio` col bordo rosso e un punto esclamativo.
3. **Telaio di ogni apparato**: rettangolo col nome (grande), sotto modello e IP di gestione (piccoli, mono). Clic sul
   nome → scheda dell'apparato (`/objects/[id]`).
4. **Porte**: quadrati di 24 px col numero corto dentro, in una o due file come sul fronte dell'apparato (dispari
   sopra e pari sotto quando le porte sono più di 24). Sotto ogni porta, ruotata di 90°, la destinazione.
5. **Cavi**: polilinee del colore del tipo, con un contorno del colore del fondo perché si leggano dove si incrociano,
   e un pallino all'attacco. I cavi lunghi (via bordo) un po' più sottili.
6. **Fuoco**: passando su una porta o su un cavo, tutto il resto va al 10 % di opacità e il telaio dell'altro capo si
   evidenzia; clic su un cavo → il pannello del collegamento che la Topologia già ha (stesso componente, «Perché questo
   collegamento» compreso). `prefers-reduced-motion` senza transizioni.
7. **Scorrimento**: la tavola si stringe fino a 1240 px, sotto scorre in orizzontale dentro il suo riquadro (mai la pagina).

Tema chiaro e scuro dai token esistenti. Niente telefono (pagina da scrivania, come la Topologia).

## 5. Prove (≤ 2 minuti, solo logica pura)

`src/lib/topology/tavola/__tests__/`, dati finti con nomi inventati (**il repo è pubblico**: nessun nome, IP o MAC di
Domarc o dei clienti):
- `componi`: ogni tipo della tabella del §3 da una riga di `switch_ports` + un collegamento; un fascio di due membri dà
  due righe e una graffa; un collegamento `stale` dà `dubbio`;
- `instrada`: nessun cavo sovrapposto a un altro sullo stesso tratto; un cavo fra le file 1 e 3 passa dal bordo e non
  attraversa la fila 2; ogni collegamento del modello disegnato **una volta sola**;
- la rotta: un sito senza apparati dà `apparati: []`, un `site` non numerico 400.

Resa: una schermata a 1920 sul dev con un sito vero, perché cambia il layout (REGOLA #3).

## 6. File

| File | Cosa |
| --- | --- |
| `src/app/(dashboard)/topology/tavola/page.tsx` | la pagina |
| `src/app/api/topology/tavola/route.ts` | la rotta di sola lettura |
| `src/lib/db-tenant.ts` | `getTopologyTavolaPorte(siteId)` (una query, accanto a `getTopologyKnownPorts`) |
| `src/lib/topology/tavola/{componi,righe,instrada,tipi}.ts` | logica pura |
| `src/components/topology/tavola/*.tsx` | telaio, porta, cavo, legenda, barra |
| `src/app/(dashboard)/topology/page.tsx` | il collegamento «Tavola di cablaggio» accanto a «Dati della mappa» |

## 7. Rischi

- **Porte senza nome uguale fra fonti** (CONTEXT, «Mappa porte»): stessa porta con nomi diversi secondo la fonte. Si
  abbina per indice come fa già `cavi/porte.ts` (`chiavePorta`, `elenchiPorte`); se un `aPort` non si trova
  nell'elenco, il cavo parte da una **porta fantasma** grigia in fondo al telaio, col nome letto, invece di sparire.
- **Siti grandi**: oltre ~40 apparati la tavola diventa lunga ma resta leggibile; oltre 80 si mostra il filtro per
  armadio prima di disegnare.
- **Apparati senza `switch_ports`** (es. un firewall letto solo via LLDP dei vicini): il telaio mostra solo le porte
  che compaiono nei collegamenti.

## 8. Domande per Riccardo (con la scelta che farei)

1. Raggruppare per **sito e poi armadio**, come qui proposto? *(sì)*
2. Ordine degli apparati **automatico** in v1, e lo spostamento a mano dopo, se serve? *(sì, automatico)*
3. Pagina solo sull'**hub** o anche sulle **appliance dei clienti**? *(tutte e due: è la stessa pagina e gli stessi dati;
   il rilascio alle appliance passa comunque dal push su main, che conferma Riccardo)*
4. In v1 **sola lettura**, con il clic che porta alla Topologia per correggere un cavo? *(sì)*
