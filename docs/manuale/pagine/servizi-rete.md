---
percorso: /servizi-rete
titolo: Porte e servizi — ogni porta aperta, cosa risponde, cosa sistemare
versione: 0.9.1363
aggiornata: 2026-11-26
---

## Porte e servizi {#porte}

Elenca **ogni porta aperta** trovata sulle reti dell'istanza, con il servizio che risponde, il prodotto e la
versione, e se c'è qualcosa da sistemare: un accesso in chiaro, un certificato scaduto, un servizio che nessuno
riconosce. Si arriva da **Sicurezza › Rete**; in cima ci sono le schede **Provate dalla sonda** (Porte e servizi,
[Chi raggiunge cosa](pagine/segmentazione.md)) e **Viste in ascolto** ([Traffico](pagine/traffico.md), Allarmi di
rete, VLAN e indirizzi, Apparati annunciati, tutte e tre in [Reti dal trunk](pagine/arp-table-trunk.md)). Il numero
rosso accanto a **Rete** nel menu conta gli allarmi gravi del trunk.

![La pagina Porte e servizi](/manuale/servizi-rete/pagina.png)

In cima la riga **Sonde** dice se le sonde hanno già letto delle risposte, quanti **servizi**, quanti **host** e
quanti **letti dalla risposta**, e quando è finito l'ultimo giro. Durante un giro compare la barra **Sonde in corso**
(o **Porte comuni in prova**) con l'avanzamento.

### Le voci della pagina

1. **Dove guardare**: la fascia di sintesi, si chiude e si riapre con un clic. Quattro riquadri, ognuno è un filtro:
   - **▲ Accessi in chiaro**: Telnet, FTP, VNC e simili, col conteggio per tipo.
   - **◆ Certificati da sistemare**: scaduti e autofirmati.
   - **○ Non identificati**: porte aperte ma mute, o ancora da sondare.
   - **– Non rivisti da 7 giorni**: porte non più viste di recente, forse non ci sono più.

   A destra **Servizi per rete**: una barra per rete, scura per i servizi identificati e chiara per quelli no. Un
   clic su una rete filtra l'elenco.
2. **Cerca** (IP, CIDR, nome, prodotto, titolo, certificato): scrivi e premi Invio.
3. **Raggruppa per**: **Servizio** (una riga per porta, la vista normale), **Porta**, **Prodotto**, **Host**,
   **Rete**. Nelle viste raggruppate un gruppo si apre con la freccia e mostra le sue porte; i gruppi più gravi
   stanno in cima.
4. **Come risponde**: filtra per tipo di risposta, col numero accanto: **● HTTP**, **◆ TLS**, **■ SSH**, **◇ NTLM**,
   **▲ banner**, **○ muti**, **– da sondare**. **Solo con rilievi** lascia solo le porte con un problema. Un filtro
   scelto diventa un'etichetta: un clic la toglie.
5. **Stesso apparato** (col numero delle proposte): apre la parte che propone gli indirizzi che sembrano lo stesso
   apparato (vedi sotto).

Chi è amministratore vede anche **Sonda tutte le porte**: rifà subito le letture di banner, HTTP, TLS e SSH sulle
porte già trovate, senza credenziali. Con un filtro di rete scelto il pulsante diventa **Sonda** seguito dalla rete,
e sonda solo quella.

### Le colonne

- **Indirizzo**: l'IP e, sotto, il nome dell'host.
- **Porta**: numero e protocollo (`443/tcp`).
- **Servizio**: il nome del servizio.
- **Prodotto · versione**: cosa si dichiara il servizio.
- **Cosa risponde**: il titolo della pagina web, il server, il certificato, la versione SSH.
- **Da guardare**: la gravità più alta dei rilievi della porta, e le etichette **▲ in chiaro**, **◆** con il
  problema del certificato, **– non rivisto**.
- **Ultima vista** e **Come**: come lo sappiamo (vedi i segni).

### Il dettaglio di una porta

La freccia **›** apre il dettaglio:

- **Servizio**, **Indirizzo** (con il pulsante per copiarlo), **Come lo sappiamo**, **Prima vista · ultima vista**,
  **Ultima sonda**.
- **Certificato TLS**: protocollo e cifrario, **Intestato a**, **Emesso da**, **Validità**, chiave e impronta.
- **Risposta HTTP/HTTPS**: **Titolo**, **Server**, **Rimanda a**.
- **Nome Windows (NTLM)**: computer, NetBIOS, dominio e versione del sistema, letti senza autenticarsi.
- **SSH**: come si presenta, l'impronta della chiave dell'host, scambio chiavi, chiavi e cifrari.
- **Rilievi di questa porta**: per ognuno gravità, titolo, **Prova**, **Rimedio** e il **triage** (stato e nota). È
  lo stesso stato dei [Findings](pagine/vulnerabilities.md).

### Come si usa

1. Parti da **Dove guardare**: un clic su un riquadro o su una rete filtra l'elenco.
2. Cambia **Raggruppa per** per vedere le stesse porte per prodotto, host o rete.
3. Apri una riga: trovi la risposta letta e i rilievi, con prova e rimedio.
4. Nel rilievo segna a che punto sei e scrivi una nota.
5. **Sonda tutte le porte** rifà subito le letture; con un filtro di rete sonda solo quella.

### Cosa vogliono dire i segni

Nella colonna **Come** e nella legenda in fondo:

- **TLS + HTTP**, **TLS**, **HTTP**, **SSH**, **NTLM**: la risposta di quel protocollo è stata letta.
- **banner**: il servizio si presenta da solo.
- **UDP**: ha risposto a una domanda UDP di protocollo (DNS, NTP, NetBIOS, SQL Browser).
- **○ tace**: aperta, ma non risponde alle sonde.
- **aperta**: trovata aperta dal giro leggero, non ancora sondata. **solo nmap**: nome dalla scansione, non ancora
  sondata.
- **▲** accesso in chiaro o banner, **◆** TLS o certificato da sistemare, **–** non ancora sondata o non rivista.

### Da dove arrivano i dati

Le porte vengono dalle scansioni ([Scansioni interne](pagine/scans.md)): entrano qui subito, anche prima delle
sonde. Le sonde leggono le risposte ogni 6 ore, per i clienti che non le hanno spente.

### Se la pagina è vuota

**Nessuna porta aperta finora**: le porte entrano dopo la prima scansione delle reti. **Nessun servizio con questi
filtri**: togli un filtro con la ✕ o cerca un'altra cosa. Oltre 20.000 servizi la pagina avvisa che i numeri sono
per difetto: restringi con un filtro.

## Stesso apparato {#identita}

Propone le **coppie di indirizzi che sembrano lo stesso apparato**, perché hanno la stessa impronta forte: la stessa
chiave SSH, lo stesso certificato TLS, lo stesso engineID SNMP o lo stesso nome Windows. Capita con server e
firewall che hanno più schede di rete. Si apre con **Stesso apparato**; **← Porte e servizi** torna all'elenco.

![Le proposte di Stesso apparato](/manuale/servizi-rete/stesso-apparato.png)

In cima quattro riquadri: **Da confermare** (stessa impronta forte su due IP), **Collegati** (confermati da una
persona), **Rifiutati** (non si ripropongono da soli), **Prove** (quante impronte sono state raccolte).

Colonne: **Primo IP** e **Secondo IP** (con nome o rete sotto), **Prova** (che impronta coincide), **Impronta**
(l'inizio del valore) e, per l'amministratore, **Decisione**.

### Come si usa

1. Guarda **Prova** e **Impronta** per capire perché sono proposti insieme.
2. **Collega** li unisce come stesso apparato; **Non è lo stesso** scarta la proposta, che non torna da sola.
3. **Raccogli le prove** rilegge le impronte già note. Niente si unisce da solo: decide sempre una persona.

### Da dove arrivano i dati

Impronte SSH e TLS lette dalle sonde, SNMP, nomi Windows e nomi sentiti dalla sonda trunk.

### Se è vuota

**Nessuna proposta**: nessuna impronta uguale su due indirizzi. È il caso normale.
