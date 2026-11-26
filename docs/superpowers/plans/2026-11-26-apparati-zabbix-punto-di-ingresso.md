# Apparati di DatIA Mon: il punto d'ingresso della gestione di Zabbix

**Stato: proposta, in attesa del sì di Riccardo. Nessun codice applicativo scritto.**

Riccardo, 26/11/2026: «la tabella è quasi un prototipo: non ci sono filtri, colonne modificabili, utilizzo del
tasto destro, raggruppamenti gestibili e da forzare, gestione dei modelli e degli agenti, impostazioni varie.
Proviamo a lavorare per creare il punto di ingresso della gestione della integrazione, senza l'esigenza di
passare dalla UI di da-zabbix».

Tavola: [`2026-11-26-apparati-zabbix-tavola.png`](2026-11-26-apparati-zabbix-tavola.png) (sorgente
[`.html`](2026-11-26-apparati-zabbix-tavola.html), dati finti, 1920).

## Censimento (26/11, da `origin/dev` v0.9.1361 e da DA-Zabbix `a425530`)

### Com'è fatta oggi la pagina

- `/zabbix/apparati` → `src/components/zabbix/apparati-datia.tsx` (648 righe, un solo componente con le quattro
  finestre: aggiungi, modelli, famiglia, agente). Legge `GET /api/zabbix/apparati`, che unisce gli host del centro
  (`leggiMonitoringCentro`) e fino a 3000 righe di `hosts` non ancora in Zabbix (`elencoApparati` in
  `src/lib/zabbix-lettura/apparati.ts`).
- Famiglia: per chi è in Zabbix la dà il centro (`/api/lettura/v1/famiglie`); per chi non c'è la ricava IPAM dalla
  classificazione (`famigliaDaClassificazione`). Modelli: solo per chi è in Zabbix; per gli altri la cella dice che
  li propone il centro all'aggiunta. Agente: `si/no/non_so/non_serve` dal centro, `da_installare` deciso da IPAM
  per Windows e Linux non ancora aggiunti.
- Le schede «Tutti / In monitoraggio / Da aggiungere / Agente da installare» sono un secondo livello dentro la
  pagina; la fascia «Si legge ma non si scrive» è fissa in cima.
- `/zabbix` («Vista tecnica e abbinamenti», `zabbix-panel.tsx`) e `/zabbix/aggiungi` (`aggiungi-a-zabbix.tsx`)
  sono pagine a parte, senza riga di schede comune: DatIA Mon non è in `src/lib/menu/sezioni.ts`.
- Guida: «Come si usa» è stato tolto il 26/11 (`cbc6bbdd`); oggi c'è il pulsante «?» (`pulsante-manuale.tsx`) con
  le guide in `docs/manuale/pagine/zabbix*.md`. La pagina nuova aggiorna quelle.

### Cosa c'è già da riusare

- **Elenco apparati `/discovery`**: colonne scelte e ordinate dall'utente, salvate per utente
  (`/api/user/preferences`, chiavi in lista bianca), filtri per valore e viste (`src/lib/discovery/viste-filtri.ts`).
- `src/components/shared/barra-filtri.tsx` (`BarraFiltri`, `PannelloFiltri`, `VoceFiltro`),
  `sortable-table-head.tsx`, `src/components/ui/context-menu.tsx` (già usato in `apparati-datia.tsx` e altrove),
  `SchedeSezione`, `BarraStato`, `SchedaDettaglio` di `console.tsx`.
- Non esiste un componente «tabella ricca» unico: Discovery ha tutto ma dentro la sua pagina. La tappa 1 ne
  estrae il minimo comune (colonne salvate + filtri + raggruppamento) invece di scriverne un secondo.

### Cosa oggi obbliga a passare da DA-Zabbix

Contratto: `/api/lettura/v1/{cliente,host,problemi,valori,famiglie,storico,modelli}` con la chiave di lettura;
`/api/scrittura/v1/{oggetto,modelli,famiglia,agente}` con la chiave di scrittura `zs1.…` (tetti: 10 al minuto,
100 oggetti al giorno; nasce spenta sul centro). DA-Zabbix resta titolare del profilo del cliente (decisione del
16/10).

| Operazione | Da IPAM oggi | Rotta nel centro | Proposta |
|---|---|---|---|
| Aggiungere un apparato | sì, uno alla volta | `scrittura/v1/oggetto` | resta; in massa con coda e contatore «oggi n di 100» |
| Sapere prima quali modelli avrà | solo con la prova a vuoto, riga per riga | `oggetto` con `prova` | **rotta nuova** di proposta in blocco (474 prove a 10/min sono 48 minuti) |
| Aggiungere e togliere modelli | sì | `scrittura/v1/modelli` | resta, in massa e dalla scheda di lato |
| Elenco dei modelli adatti | sì | `lettura/v1/modelli` | scheda «Modelli» |
| Forzare la famiglia / tornare all'automatico | sì | `scrittura/v1/famiglia` | resta; **campo nuovo** `famiglia_forzata` nella lettura per mostrare il segno «a mano» |
| Comando dell'agente | sì | `scrittura/v1/agente` | resta; scheda «Agenti» |
| Versione dell'agente installato | no | — | **campo nuovo** in `famiglie` |
| Sospendere / riattivare | no | solo interfaccia (`oggetti/azioni`) | **rotta nuova** |
| Rinominare in Zabbix | no | solo interfaccia (`o/{ip}/nome`) | **rotta nuova** |
| Togliere da Zabbix | no | solo interfaccia (`o/{ip}/togli-zabbix`) | **rotta nuova**, zona rossa: cancella lo storico |
| Parametri del modello (macro) | no | solo interfaccia (`o/{ip}/parametri`) | tappa successiva, da decidere |
| Credenziali SNMP / community / token Proxmox | no (IPAM non le manda) | solo interfaccia | **resta in DA-Zabbix**: sono segreti; IPAM mostra solo se ha una credenziale valida sua |
| Controlli aggiunti a mano, tipologia, importanza | no | solo interfaccia | resta in DA-Zabbix, collegamento dalla scheda |
| Stato del proxy | sì (lettura) | `lettura/v1/cliente` | in riga di stato e scheda «Centro e proxy» |
| Creare/installare il proxy, registrare il cliente, reti | no | interfaccia e `/api/dalink/*` | resta a DA-Link e DA-Zabbix |
| Manutenzione programmata | no | non c'è nemmeno nell'interfaccia (si legge soltanto) | fuori da questo piano |
| Allarmi: conferma e chiusura | no | interfaccia (`allarmi/azioni`) | fuori da questo piano |
| Chiave di scrittura | si incolla in Impostazioni | `/api/dalink/chiave-scrittura` c'è, **DA-Link non la chiama ancora** | lavoro in DA-Link (aperto nel `TASKS.md` di DA-Zabbix dal 13/11) |

## Cosa si costruisce (oggetti della tavola)

1. **Una riga di schede** per DatIA Mon in `sezioni.ts`: Apparati · Modelli · Agenti · Abbinamenti · Per il
   cliente · Centro e proxy. `/zabbix/aggiungi` confluisce in Apparati (filtro «Da aggiungere»).
2. **Stato in riga**, a destra delle schede: centro, proxy, scrittura (con «Inserisci la chiave» quando manca),
   aggiunti oggi, «?». Niente fascia fissa.
3. **Filtri**: testo, stato (pulsanti con i conteggi, al posto delle schede interne), famiglia, rete/VLAN, marca,
   modello Zabbix, agente, credenziale.
4. **Raggruppa per** (famiglia, rete, marca, stato, nessuno), **Colonne** e **Viste** salvate per utente.
5. **Azioni sulla selezione**, sempre nella stessa riga; quelle che il centro non sa ancora fare restano spente
   col motivo.
6. **Tabella**: un fatto per colonna (modello principale e «Altri» separati), gruppi richiudibili con l'azione del
   gruppo, 100 righe per pagina.
7. **Tasto destro** su riga e su selezione: le stesse azioni dei pulsanti, più «Filtra per…» e «Copia».
8. **Scelta delle colonne** con ordine a trascinamento.
9. **Scheda di lato** dell'apparato: famiglia (forzata/automatica), modelli, agente, credenziale, stato.

## Tappe

Livello **Leggero** per le tappe 1-3 e 5 (interfaccia e lettura). Le rotte nuove che scrivono in Zabbix (tappa 4:
sospendi, rinomina, togli) toccano dati di produzione del centro: **livello Completo**, snapshot della VM di
Zabbix prima del rilascio, e approvazione a parte.

- [ ] **T1 — Tabella nuova in sola lettura** (IPAM). Schede di sezione, stato in riga, filtri, colonne e viste
  salvate, raggruppamenti, paginazione, tasto destro con le azioni che esistono già. La rotta `apparati` porta
  rete/VLAN, marca, modello, MAC e credenziale valida. *Fatto quando*: su IPAM `192.168.4.8` i 474 apparati si
  filtrano per rete e famiglia, le colonne scelte restano dopo un nuovo accesso, una schermata a 1920.
  Stima: mezza giornata.
- [ ] **T2 — Scheda di lato, Modelli e Agenti** (IPAM). Scheda dell'apparato, schede «Modelli» (per famiglia, chi
  li ha) e «Agenti» (serve, da installare, installato, comando). *Fatto quando*: aggiunta e tolta di un modello e
  comando dell'agente si fanno dalla scheda, con la prova a vuoto. Stima: mezza giornata.
- [ ] **T3 — Aggiunta in massa con coda** (IPAM). Rispetta 10/min e 100/giorno, mostra avanzamento e residuo,
  riprende. *Fatto quando*: 20 apparati di una sonda di prova entrano senza superare i tetti. Stima: 2-3 ore.
- [ ] **T4 — Rotte nuove in DA-Zabbix** (altro repo, lavoro a parte): proposta dei modelli in blocco;
  `famiglia_forzata` e `agente_versione` nella lettura; `sospendi`, `rinomina`, `togli` in scrittura. Poi i
  pulsanti spenti di IPAM si accendono. Stima: una giornata là, 2-3 ore qui.
- [ ] **T5 — Guide e pulizia** (IPAM): `docs/manuale/pagine/zabbix*.md`, tolte le pagine confluite, `CHANGELOG`,
  `CONTEXT`. Stima: 1-2 ore.

**Totale realistico: 2 giornate di sessioni per IPAM (T1-T3, T5), più una per DA-Zabbix (T4).**

## Domande aperte (poste a Riccardo il 26/11)

1. Schede di DatIA Mon: vanno bene le sei della tavola, con «Aggiungi» dentro Apparati?
2. Togliere da Zabbix, sospendere e rinominare da IPAM: sì (rotte nuove nel centro, livello Completo) o restano in DA-Zabbix?
3. Tetto di 100 aggiunte al giorno: si alza per chiave, o basta la coda su più giorni?
4. Credenziali che usa Zabbix: restano in DA-Zabbix (proposta) o IPAM deve poter indicare quale delle sue usare?
5. Chiave di scrittura: la emette DA-Link con un pulsante (lavoro là) e IPAM la riceve da sola, o resta da incollare?
6. Colonne di serie: quelle della tavola vanno bene?
