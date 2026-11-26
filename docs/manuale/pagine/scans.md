---
percorso: /scans
titolo: Scansioni interne — lanciare un giro sulle reti
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Da qui si lancia a mano un **giro** di DA-IPAM e della sonda sulle reti già in inventario: si scelgono il tipo di
giro, le reti, il profilo e, se serve, i parametri fini. Sotto si seguono i giri in corso e lo storico. I giri
automatici partono da soli secondo le [Schedulazioni](pagine/settings-schedulazioni.md); questa pagina serve per
rifarli subito o per un giro diverso dal solito.

Si arriva da **Sicurezza › Scansioni**, scheda **Interne** in cima (l'altra è
[VA dall'Edge](pagine/vulnerabilities-scansioni.md)). In alto a destra **Vedi i findings** porta ai
[Findings](pagine/vulnerabilities.md). Solo un amministratore può lanciare un giro.

![La pagina Scansioni interne](/manuale/scans/pagina.png)

## Le voci della pagina

1. **Tipo di giro**: quattro schede, sotto la riga dice cosa fa quella scelta.
   - **Discovery**: host, porte, servizi, identità. È l'unico tipo che cerca porte nuove.
   - **Segmentazione**: dalla VLAN prova i servizi delle altre reti. Il risultato si legge in
     [Chi raggiunge cosa](pagine/segmentazione.md).
   - **Sonda L2**: ascolto CDP, LLDP, STP e tag 802.1Q sul trunk. Niente scansione.
   - **Solo controlli**: rifà sonde, identità e controlli sui servizi già noti. Non cerca porte nuove.
2. **Reti**: le reti già in inventario, una casella per rete; un clic la sceglie, un altro la toglie. Sotto può
   comparire **Fuori dal giro**: gli impianti (IoT, OT, PLC) e gli host esclusi nell'Edge non si toccano, con la
   stessa cautela dell'Edge; per loro restano solo ping e dati passivi.
3. **Profilo** (Discovery): quante porte e a che ritmo.
   - **Rapido**: le 100 porte TCP più comuni.
   - **Standard**: 1000 TCP + 20 UDP, riconoscimento, identità, controlli.
   - **Completo**: tutte le 65.535 porte TCP. Non parte mai da solo e chiede la spunta **Confermo: tutte le 65.535
     porte TCP**.
   - **Lento**: come lo Standard, a 300 pacchetti al secondo, per reti delicate.
   - **Su misura**: scegli tu le fasi e i parametri.
4. **Targets e parametri**: con un profilo fisso porte e ritmo vengono dal profilo; con **Su misura** sono tuoi
   (vuoto = valore del motore).
   - **Targets**: indirizzi IPv4 o CIDR, separati da spazio o virgola. Devono cadere nelle reti scelte.
   - **Esclusioni**: indirizzi mai sondati, in aggiunta a quelli esclusi nella rete.
   - **Auto-target**: aggiunge da solo i prefissi delle reti scelte. Se spento, indica almeno un target.
   - **Porte TCP** (preset **Top 100 TCP**, **Top 1000 TCP**, **Tutte (65.535)** o un elenco come `22,80,8000-8100`)
     e **Porte UDP** (vuoto = niente UDP).
   - **Modo di scansione**: **Automatico** (SYN se c'è root, altrimenti connect), **SYN (serve root)**, **Connect
     (senza root)**.
   - **Rate (pps)**, **Timeout (ms)**, **Concorrenza**, **Tentativi**: ritmo, attesa, prove in parallelo, ripetizioni.
   - **Fasi**: **Host (ICMP)**, **Porte TCP**, **Porte UDP**, **Sonde e identità**.
   - **Usa le credenziali già validate**: solo SSH e SNMP, e solo sugli host dove la Discovery le ha già verificate.
     Via SSH legge in sola lettura alcune impostazioni di sicurezza (accesso di root, aggiornamenti, riavvio
     richiesto). Mai nei giri automatici.
   - **Prove invasive** (▲ invasiva): controlli più spinti, che fanno parte della fase **Sonde e identità**.

### Le voci degli altri tipi

- **Solo controlli**: lavora sugli host e sui servizi già in inventario per la rete. Ha **Timeout (ms)**,
  **Concorrenza**, **Usa le credenziali già validate** e **Prove invasive**. Rifarlo non duplica niente: aggiorna le
  righe che ci sono e lascia stati e note come sono.
- **Segmentazione**: la rete da cui mandare (ogni prova esce da quella interfaccia), **Reti da raggiungere** (vuoto
  = tutte le altre) e **Come prova la raggiungibilità**: **Connessione TCP diretta** (prova il servizio noto sulla
  sua porta, la prova di default) o **Ping ICMP**. Rigioca i servizi già noti, nessuna nuova scansione.
- **Sonda L2**: **Ascolto**, cioè la **Durata (secondi)** dell'ascolto passivo; vuoto = una lettura immediata.

Il pulsante di avvio in fondo dice cosa manca se non si può partire («Scegli almeno una rete», «Un avvio è già in
corso», «Senza auto-target indica almeno un bersaglio»).

## Giri in corso e Storico

- **Giri in corso**: uno per rete, avanzano insieme, con la fase e la percentuale. Restano 5 minuti dopo la fine;
  **Apri** mostra il dettaglio.
- **Storico**: gli ultimi giri, una riga per rete, con **Tipo**, **Risultato**, **Porte aperte**, **Durata**,
  **Data**. Il controllo automatico ogni 15 minuti non compare.

## Come si usa

1. Scegli il **Tipo di giro** (di solito **Discovery**).
2. Spunta le **Reti**.
3. Scegli il **Profilo**: **Standard** per l'uso normale, **Rapido** per un controllo veloce, **Lento** su reti
   fragili.
4. Solo se serve, apri **Targets e parametri** e passa a **Su misura**.
5. Premi il pulsante di avvio e segui il giro in **Giri in corso**. I risultati vanno in
   [Apparati](pagine/discovery.md), [Porte e servizi](pagine/servizi-rete.md) e [Findings](pagine/vulnerabilities.md).

## Cosa vogliono dire i segni

- **▲ invasiva**: la prova può disturbare il servizio; si accende solo di proposito.

## Da dove arrivano i dati

Il giro lo fanno DA-IPAM e la sonda dall'appliance, sulle reti scelte. Le reti vengono dall'inventario
([Subnet](pagine/networks.md)).

## Se la pagina è vuota

**Nessuna rete**: censisci una subnet, poi torna qui. **Nessuna scansione eseguita** nello storico: lancia un giro
qui sopra.
