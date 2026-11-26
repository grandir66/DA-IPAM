---
percorso: /scans
titolo: Scansioni interne — lanciare un giro sulle reti
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Da qui si lancia a mano un **giro** di DA-IPAM e della sonda sulle reti già in inventario: si sceglie il tipo di giro,
le reti, il profilo e, se serve, i parametri fini. Sotto si seguono i giri in corso e lo storico. I giri automatici
partono da soli secondo le [Schedulazioni](pagine/settings-schedulazioni.md): questa pagina serve per rifarli subito o
per un giro diverso dal solito.

Si arriva da **Sicurezza › Scansioni**. Menu, schede e tabelle funzionano come in tutte le pagine: sono spiegati nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md).

Chi è in **sola lettura** vede tutta la pagina, può scegliere tipo, reti e profilo per vedere cosa farebbe il giro, ma
il pulsante di avvio resta spento («Solo un amministratore può lanciare un giro»). Il giro lo lancia un
**amministratore**.

## Le schede e il tipo di giro

![Le schede e il tipo di giro](/manuale/scans/tipo.png)

In cima le schede di **Scansioni**: **Interne** (questa pagina) e [VA dall'Edge](pagine/vulnerabilities-scansioni.md),
le scansioni delle vulnerabilità fatte dallo Scanner-Edge. **Vedi i findings**, accanto al titolo, porta ai
[Findings](pagine/vulnerabilities.md).

Sotto il titolo, la fila **Tipo di giro**; la riga sotto la fila dice che cosa fa il tipo scelto, e la pagina cambia i
pannelli di conseguenza.

1. **Discovery**: host, porte, servizi, identità. È l'unico tipo che cerca porte nuove.
2. **Segmentazione**: dalla VLAN scelta prova i servizi delle altre reti. Il risultato si legge in
   [Chi raggiunge cosa](pagine/segmentazione.md).
3. **Sonda L2**: ascolta CDP, LLDP, STP e i tag 802.1Q sul trunk. Niente scansione.
4. **Solo controlli**: rifà sonde, identità e controlli sui servizi già noti. Non cerca porte nuove.

## Discovery: reti e profilo

![Le reti e il profilo](/manuale/scans/reti-profilo.png)

**1. Reti**: le reti già in inventario, una casella per rete con nome e indirizzo. Un clic la sceglie (bordo azzurro),
un altro la toglie. Se una rete non c'è, si aggiunge da [Subnet](pagine/networks.md).

Sotto può comparire il pannello **Fuori dal giro**: per ogni rete, quanti impianti (IoT, OT, PLC) e quanti host
esclusi a mano nell'Edge il giro non toccherà, con qualche esempio. Per loro restano solo ping e dati passivi.

**2. Profilo**: quante porte e a che ritmo.

| Profilo | Che cosa fa |
|---|---|
| **Rapido** | Le 100 porte TCP più comuni. |
| **Standard** | 1000 porte TCP e 20 UDP, riconoscimento, identità, controlli. È quello di serie. |
| **Completo** | Tutte le 65.535 porte TCP. Non parte mai da solo e chiede la spunta **Confermo: tutte le 65.535 porte TCP**. |
| **Lento** | Come lo Standard, a 300 pacchetti al secondo, per reti delicate. |
| **Su misura** | Scegli tu le fasi e i parametri nel pannello 3. |

## Discovery: targets e parametri

![Targets e parametri, profilo Su misura](/manuale/scans/parametri.png)

Con un profilo fisso i campi sono grigi e mostrano i valori del profilo; con **Su misura** sono tuoi (vuoto = valore
del motore).

- **Targets**: indirizzi IPv4 o reti CIDR, separati da spazio o virgola. Devono cadere nelle reti scelte.
- **Esclusioni**: indirizzi da non sondare mai, in aggiunta a quelli esclusi nella rete.
- **Auto-target**: aggiunge da solo le reti scelte. Se lo spegni, devi indicare almeno un target.
- **Porte TCP**: **Top 100 TCP**, **Top 1000 TCP**, **Tutte (65.535)** o un elenco tuo come `22,80,8000-8100`.
  «Tutte» chiede la stessa conferma del profilo Completo.
- **Porte UDP**: un elenco; vuoto = niente UDP.
- **Modo di scansione**: **Automatico** (SYN se c'è root, altrimenti connect), **SYN (serve root)**, **Connect
  (senza root)**.
- **Rate (pps)**, **Timeout (ms)**, **Concorrenza**, **Tentativi**: pacchetti al secondo, attesa per risposta, prove
  in parallelo, ripetizioni. Accanto a ogni casella è scritto l'intervallo ammesso.
- **Fasi**: **Host (ICMP)**, **Porte TCP**, **Porte UDP**, **Sonde e identità**.
- **Usa le credenziali già validate**: solo SSH e SNMP, e solo sugli host dove la Discovery le ha già verificate.
  Via SSH legge in sola lettura alcune impostazioni di sicurezza. Mai nei giri automatici.
- **Prove invasive** ▲ **invasiva**: controlli più spinti, che possono disturbare il servizio e vanno concordati col
  cliente. Mai nei giri automatici.

## Gli altri tipi di giro

**Segmentazione** ha tre pannelli:

- **1. Da**: la rete da cui mandare le prove; ogni prova esce da quella interfaccia.
- **2. Reti da raggiungere**: una casella per rete con la VLAN, quanti servizi e quanti host già noti. Nessuna scelta
  = tutte le altre reti. Si rigiocano i servizi già noti, senza scansioni nuove.
- **Come prova la raggiungibilità**: **Connessione TCP diretta** prova il servizio noto sulla sua porta (è la prova di
  serie); **Ping ICMP** misura solo se l'host risponde.

![Come prova la raggiungibilità](/manuale/scans/segmentazione.png)

**Sonda L2** ha solo **Ascolto**: la **Durata (secondi)** dell'ascolto passivo, da 1 a 600; vuoto = una lettura
immediata.

**Solo controlli** lavora sugli host e sui servizi già in inventario per le reti scelte. Ha **Timeout (ms)**,
**Concorrenza**, **Usa le credenziali già validate** e **Prove invasive**. Rifarlo non duplica niente: aggiorna le
righe che ci sono e lascia stati e note come sono.

## L'avvio, i giri in corso e lo storico

![Il pulsante di avvio e lo storico](/manuale/scans/storico.png)

1. Il pulsante di avvio dice che cosa parte («Avvia Discovery · Standard»). Se è spento, passa il mouse sopra per
   leggere cosa manca: «Scegli almeno una rete», «Scegli la rete sorgente», «Senza auto-target indica almeno un
   bersaglio», «Tutte le porte: conferma le 65.535 porte TCP», «Un avvio è già in corso».

**Giri in corso** compare mentre un giro lavora: una riga per rete, con la fase e la percentuale. Le righe restano 5
minuti dopo la fine (Finito, o il motivo dell'errore). **Apri** mostra l'avanzamento del giro in dettaglio; lo stesso
si trova in **In esecuzione** nel menu.

**Storico**: gli ultimi giri, una riga per rete. Il controllo automatico ogni 15 minuti non compare.

| Colonna | Che cosa dice |
|---|---|
| **Tipo** | Il nome tecnico del giro (per esempio `network_discovery`). |
| **Risultato** | Quanti host online e offline e quante porte aperte, oppure l'errore. |
| **Porte aperte** | Le porte trovate, quando il giro le registra. |
| **Durata** | Quanto è durato, in secondi. |
| **Data** | Quando è partito. |

## Come si fa

- **Rifare subito la Discovery di una rete**: **Discovery**, clic sulla rete, profilo **Standard**, **Avvia Discovery
  · Standard**. Segui il giro in **Giri in corso**; i risultati vanno in [Apparati](pagine/discovery.md) e
  [Porte e servizi](pagine/servizi-rete.md).
- **Controllare un solo server**: **Discovery**, la sua rete, profilo **Su misura**, togli la spunta **Auto-target** e
  scrivi il suo indirizzo in **Targets**.
- **Sondare una rete di impianti delicati**: profilo **Lento**. Gli impianti già riconosciuti come IoT, OT o PLC
  restano comunque fuori (pannello **Fuori dal giro**).
- **Verificare se la rete ospiti raggiunge i server**: **Segmentazione**, in **1. Da** la rete ospiti, in **2. Reti da
  raggiungere** la rete dei server, **Connessione TCP diretta**. Il risultato è in
  [Chi raggiunge cosa](pagine/segmentazione.md).
- **Aggiornare i controlli dopo una correzione**: **Solo controlli** sulla rete: rilegge i servizi già noti senza
  cercare porte nuove, e aggiorna i [Findings](pagine/vulnerabilities.md).

## Cosa vogliono dire i segni

- ▲ **invasiva**: la prova può disturbare il servizio; si accende solo di proposito.
- Casella con il bordo azzurro: rete o profilo scelti.

## Da dove arrivano i dati

Il giro lo fanno DA-IPAM e la sonda dall'appliance, sulle reti scelte. Le reti vengono dall'inventario
([Subnet](pagine/networks.md)).

## Se la pagina è vuota

**Nessuna rete**: censisci una subnet, poi torna qui. **Nessuna scansione eseguita** nello storico: lancia un giro
qui sopra.
