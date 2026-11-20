# Collector di traffico — progetto

> Spec del 20/11/2026, chiesta da Riccardo. **Stato: approvata da Riccardo il 20/11/2026.** Piano: `docs/superpowers/plans/2026-11-20-collector-traffico.md`.
> Riga in `TASKS.md` di DA-IPAM (20/11) e di DA-Vul-can (sezione del 14/11).

## Cos'è e cosa non è

Una VM piccola che ascolta il traffico in copia (mirror) e conta **chi parla con chi**.
Manda i conteggi a IPAM, che conosce gli host e segnala i comportamenti insoliti.

**Non è**:

- l'NDR con Suricata e Zeek che Codex sviluppa sul ramo `codex/edge-va-gemella` di
  DA-Vul-can: quello resta il livello pesante, per le macchine che lo reggono;
- un sistema che riconosce gli attacchi dalle firme: non ha le decine di migliaia di
  regole di Suricata. Ha una lista corta e fissa di controlli sui casi conclamati (vedi
  «Controlli sul contenuto»);
- una sonda attiva: non manda niente sulla rete del cliente. La scheda in mirror non ha
  indirizzo e non trasmette. Dopo l'incidente del 16/11 (la VA sul router di core) è il
  punto che conta di più.

## Decisioni di Riccardo (20/11)

1. VM a sé, non dentro Edge e non l'NDR di Codex.
2. Leggera: «non deve essere una cosa pesante»; Suricata e Zeek «sarebbe bello ma
   richiedono troppe risorse».
3. Distribuita: più VM, una per sede o per punto di ascolto.
4. I risultati vanno a IPAM.
5. Confermate col «sì, scrivi la spec»: codice dentro DA-IPAM, mirror più NetFlow/sFlow,
   anomalie in una pagina di IPAM, prima prova su PX-NAS accanto a `banco-sim`.

## Come è fatto

```
switch (porta SPAN) ──mirror──▶ ┌─ VM collector ──────────────┐
switch/firewall ──NetFlow/sFlow▶│ conteggio ▶ SQLite ▶ API    │◀── IPAM legge col cursore
                                └─────────────────────────────┘
                                             IPAM: coppie, abitudini, anomalie, pagina
```

### La VM collector

- **Obiettivo di risorse**: 1 vCPU, 512 MB di RAM, 8 GB di disco, fino a circa 200 Mbit/s
  di mirror. Da misurare alla tappa 1: il numero è un obiettivo, non un dato.
- **Due schede**: una di gestione con indirizzo, una in mirror senza indirizzo.
- **Conteggio**: lo fa un programma già pronto e leggero, non codice nostro pacchetto per
  pacchetto. Proposta: `pmacct` (pacchetto Debian; `pmacctd` per il mirror, `nfacctd` e
  `sfacctd` per NetFlow e sFlow, quindi le due sorgenti con lo stesso strumento). Si usa
  come programma installato, non se ne copia il codice. Da confermare con la prova di carico.
- **Cosa registra**, per finestra di 5 minuti: IP sorgente, IP destinazione, protocollo,
  porta del servizio, byte, pacchetti, numero di connessioni aperte. La porta effimera del
  client non si tiene.
- **Verso internet** le destinazioni non si elencano una per una (sarebbero milioni di
  righe): per ogni host interno si tiene porta, volume e numero di destinazioni diverse.
- **Mai salvati**: contenuto dei pacchetti, URL, credenziali. I controlli sul contenuto
  guardano l'inizio della connessione e salvano solo il fatto («FTP con password in
  chiaro da A a B»), mai il valore.

### Controlli sul contenuto (Riccardo, 20/11)

Riccardo: «non potrebbe leggere qualcosa di più dei pacchetti: protocolli, pacchetti in
chiaro pericolosi, solo per allertare anomalie conclamate». Sì, restando leggeri, a due
condizioni: si guarda **solo l'inizio di ogni connessione**, e i controlli sono **una
lista corta e fissa** scritta da noi, non un motore di firme.

Primo gruppo, costo basso perché il filtro lo fa il kernel e al programma arrivano pochi
pacchetti:

| Controllo | Cosa segnala |
|---|---|
| Telnet, FTP, POP3, IMAP, SMTP con accesso in chiaro | credenziali che passano leggibili |
| HTTP con accesso «Basic» | idem, su pagine senza cifratura |
| LDAP con accesso semplice senza TLS | password di dominio leggibili |
| SNMP v1/v2c, e comunità `public`/`private` | apparati interrogabili da chiunque |
| SMB versione 1 | protocollo vecchio, quello di EternalBlue |
| TLS 1.0 o più vecchio | cifratura superata |
| NTLM versione 1 | risposte che si rompono in poco tempo |
| LLMNR e NetBIOS con una risposta da chi non dovrebbe | tentativo di farsi passare per un altro host |
| Scrittura verso un impianto (Modbus, S7) da un host nuovo | qualcuno comanda un PLC per la prima volta |
| Richieste DNS lunghissime o in numero abnorme | dati fatti uscire dentro il DNS |

Secondo gruppo, da misurare prima di prometterlo: riconoscere il protocollo dai primi
byte **su qualunque porta** (SSH sulla 443, RDP su una porta alta). Qui il programma deve
vedere il primo pacchetto di dati di ogni connessione, non solo di alcune porte: il costo
si sa solo sul banco. Se pesa, resta spento di serie.

Ogni controllo ha il suo interruttore in IPAM, rete per rete: una rete piena di apparati
vecchi darebbe cento avvisi di SNMP v2 il primo giorno. Le anomalie conclamate non aspettano i 14 giorni di apprendimento.
- **Servizio nostro**, piccolo, in Python come il sensore trunk di DA-Vul-can: legge
  l'uscita del conteggio, la tiene in SQLite con un numero progressivo, la espone su
  un'API. Tetto sul disco: finite le finestre di 7 giorni si buttano le più vecchie.
- **Copertura dichiarata**: se il traffico supera quello che la VM regge, il collector
  conta i pacchetti persi e lo dice a IPAM. Una misura a metà non deve sembrare intera.

### Trasferimento a IPAM

IPAM **legge** dal collector, a giri, con un cursore: chiede solo le righe dopo l'ultima
ricevuta. È lo schema di `src/lib/trunk/sensore-trunk.ts`, già in uso. Se IPAM è fermo il
collector accumula e niente va perso entro i 7 giorni.

In chat avevo proposto il contrario (il collector spinge). Cambio perché lo schema a
lettura esiste già, e un collector che non conosce IPAM si installa senza configurarlo.
Resta aperto il caso di una sede che IPAM non raggiunge: lì serve la spinta (vedi «Aperto»).

Accesso come per Edge: gettone per collector, HTTPS con l'impronta del certificato fissata
al primo contatto. Ogni collector è una riga in IPAM: nome, sede, indirizzo, ultimo
contatto, copertura.

### In IPAM

- **Tabelle nuove** (migrazioni solo additive, dentro il database del tenant):
  `traffico_collector`, `traffico_coppie` (prima e ultima volta vista, totali per giorno,
  tenuti 90 giorni), `traffico_anomalie`.
- **Aggancio agli host**: per IP, con la mappa MAC-IP che IPAM ha già. Un IP che IPAM non
  conosce è già un'informazione («host mai censito che parla»).
- **Apprendimento**: i primi 14 giorni di una rete non producono avvisi, la pagina dice
  «in apprendimento». Poi vale come abitudine ciò che si è visto.
- **Anomalie**, tutte calcolate in IPAM:
  1. coppia di host mai vista;
  2. porta nuova su un host noto;
  3. un host che ne contatta molti in pochi minuti;
  4. un impianto (`eImpianto`) che parla con qualcuno di nuovo o esce verso internet;
  5. traffico fra VLAN che la matrice di segmentazione dà per chiuse;
  6. volume lontano dall'abitudine di quell'host;
  7. host non censito che parla.
- Ogni anomalia si può segnare **«è normale»**: entra nelle abitudini e non torna.
- **Pagina**: elenco delle anomalie e scheda «con chi parla» dentro l'host. La gravità si
  distingue per forma e luminosità, non per colore. L'interfaccia si propone oggetto per
  oggetto prima di scriverla.

## Tappe

| # | Cosa | Fatto quando |
|---|------|--------------|
| 1 | Collector su PX-NAS accanto a `banco-sim`: conteggio, SQLite, API col cursore | l'API restituisce le coppie del traffico finto; misurati CPU, RAM e pacchetti persi |
| 2 | IPAM legge il collector e mostra «con chi parla» nella scheda dell'host | le coppie del banco compaiono agganciate ai due host finti |
| 3 | Abitudini e anomalie 1-5 e 7, pagina delle anomalie | un host finto che ne contatta un altro per la prima volta genera un'anomalia; «è normale» la spegne |
| 4 | Volumi (anomalia 6), nomi DNS chiesti e nome del server nel saluto TLS | l'anomalia riporta il nome oltre all'indirizzo |
| 4 bis | Controlli sul contenuto, primo gruppo; il secondo solo dopo la misura | sul banco un accesso FTP in chiaro genera l'avviso e la password non è in nessun file |
| 5 | NetFlow e sFlow come seconda sorgente | un apparato vero esporta e le coppie arrivano |
| 6 | Installazione in un comando (Deploy-Appliance) e prima sede vera | una VM nuova si registra in IPAM senza mani sul database |

Livello di controllo proposto: **leggero** (più tappe, progetto in esercizio, nessuna zona
rossa). Zona gialla: le migrazioni SQLite e le rotte nuove, che passano da
`withTenantFromSession` o dal gettone del collector.

## Aperto

- **Nome**: qui è «collector di traffico»; il nome vero lo dà Riccardo.
- **Sedi che IPAM non raggiunge**: spinta dal collector, oppure NetBird. Da decidere alla tappa 6.
- **Mail e Wazuh** per le anomalie gravi: dopo la pagina, se servono.
- **`pmacct`**: scelta da confermare alla tappa 1; l'alternativa è un contatore nel kernel
  (eBPF), più leggero ma più lungo da scrivere.
- **Dove si prende il mirror** sulla rete Domarc e dai clienti: quali switch hanno la porta SPAN.
- **Mirror dentro Proxmox** (traffico fra VM dello stesso nodo): si copia dal bridge con
  `tc mirred`, come fa già il sensore trunk. Da provare sul banco.
- **Piano delle evidenze passive** (`TASKS.md` di DA-Vul-can, 10/11): cita un piano in
  `docs/superpowers/plans/2026-11-10-ipam-evidenze-passive-confronto-rete.md` di DA-IPAM e
  una prova JA4 da mirror in Edge. Il 20/11 quel file a quel percorso non c'è: da ritrovare
  prima della tappa 4, per non fare due volte la stessa lettura del saluto TLS.
