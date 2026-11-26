---
percorso: /servizi-rete
titolo: Porte e servizi — ogni porta aperta, cosa risponde, cosa sistemare
versione: 0.9.1367
aggiornata: 2026-11-26
---

## Porte e servizi {#porte}

Elenca **ogni porta aperta** trovata sulle reti dell'istanza, con il servizio che risponde, il prodotto e la
versione, e se c'è qualcosa da sistemare: un accesso in chiaro, un certificato scaduto, un servizio che nessuno
riconosce. Si arriva da **Sicurezza › Rete**, prima scheda del gruppo **Provate dalla sonda** (le schede di Rete sono
descritte in [Reti dal trunk](pagine/arp-table-trunk.md)). Il numero rosso accanto a **Rete** nel menu conta gli
allarmi gravi del trunk.

Ricerca, tabelle e pagine dell'elenco funzionano come altrove: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).
Le immagini di questa guida tengono chiusa la sintesi e nascondono indirizzi, prodotti e risposte.

### La riga delle sonde

![La riga delle sonde](/manuale/servizi-rete/sonde.png)

**Sonde** dice se le sonde hanno già letto delle risposte, quanti **servizi**, quanti **host**, quanti **letti dalla
risposta** e quando è finito l'ultimo giro. A destra:

1. **Stesso apparato**, col numero delle proposte: apre la parte [Stesso apparato](#identita).

Un **amministratore** ha in più `tasto:radar` **Sonda tutte le porte**: rilegge subito banner, HTTP, TLS e SSH sulle
porte già trovate, senza credenziali. Con un filtro di rete scelto il pulsante diventa **Sonda** seguito dalla rete, e
sonda solo quella. È spento mentre un giro è già in corso. Durante il giro compare la barra **Sonde in corso** (o
**Porte comuni in prova**) con «N di M porte».

### La sintesi e la barra dell'elenco

![La sintesi chiusa e la barra dell'elenco](/manuale/servizi-rete/barra.png)

1. `icona:chevron-right` **Dove guardare**: la fascia di sintesi; un clic la apre (`icona:chevron-down`) o la chiude, e
   il browser ricorda la scelta. Chiusa, mostra i numeri in una riga. Aperta ha quattro riquadri, ognuno è un filtro:
   - ▲ **Accessi in chiaro**: Telnet, FTP, VNC e simili, con il conteggio per tipo;
   - ◆ **Certificati da sistemare**: scaduti e autofirmati;
   - ○ **Non identificati**: porte aperte ma mute, o ancora da sondare;
   - – **Non rivisti da 7 giorni**: porte non più viste di recente, forse non ci sono più.

   A destra **Servizi per rete**: una barra per rete, scura per i servizi identificati e chiara per quelli no (passa il
   mouse per i numeri). Un clic su una rete filtra l'elenco.
2. `icona:search` **IP, CIDR, nome, prodotto, titolo, certificato**: scrivi e premi **Invio**.
3. **Raggruppa per**: **Servizio** (una riga per porta, la vista normale), **Porta**, **Prodotto**, **Host**, **Rete**.
4. **Come risponde**: filtra per tipo di risposta, col numero accanto: ● **HTTP**, ◆ **TLS**, ■ **SSH**, ◇ **NTLM**,
   ▲ **banner**, ○ **muti**, – **da sondare**. **Solo con rilievi** lascia solo le porte con un problema.

Ogni filtro scelto (riquadro, rete, host, porta, prodotto, ricerca) diventa un'etichetta accanto ai pulsanti: un clic
sulla sua `icona:x` lo toglie. I filtri restano cambiando **Raggruppa per**.

### L'elenco

![L'inizio dell'elenco](/manuale/servizi-rete/tabella.png)

| Colonna | Che cosa dice |
|---|---|
| `icona:chevron-right` | Apre il dettaglio della porta (vedi sotto). Si apre anche con un clic sulla riga. |
| **Indirizzo** | L'IP, con sotto il nome dell'host; `icona:copy` accanto lo copia. |
| **Porta** | Numero e protocollo (`443/tcp`). |
| **Servizio** | Il nome del servizio, con **TLS** se risponde cifrato. |
| **Prodotto · versione** | Cosa dichiara di essere il servizio. |
| **Cosa risponde** | Il titolo della pagina web, il server, il certificato, la versione SSH (passa il mouse per il testo intero). |
| **Come** | Come lo sappiamo (vedi [i segni](#segni)). |
| **Da guardare** | La gravità più alta dei rilievi della porta, col loro numero, ✓ **Rivisto** se sono tutti chiusi, e le etichette ▲ **in chiaro**, ◆ con il problema del certificato, – **non rivisto**. |
| **Rete** | La rete in cui sta. |
| **Ultima vista** | L'ultima volta che la porta è stata vista aperta. |

Nelle viste raggruppate ogni riga è un gruppo, con **Servizi**, **Host** (quanti distinti), **Cosa risponde** e **Da
guardare**; i gruppi più gravi stanno in cima. `icona:chevron-right` apre il gruppo e mostra le sue porte; **Apri
l'elenco** torna alla vista per servizio filtrata su quel gruppo.

### Il dettaglio di una porta

Si apre con `icona:chevron-right` o con un clic sulla riga:

- **Servizio**, **Indirizzo**, **Come lo sappiamo**, **Prima vista · ultima vista**, **Ultima sonda**;
- **Certificato TLS**: protocollo e cifrario, **Intestato a**, **Emesso da**, **Validità**, chiave e impronta;
- **Risposta HTTP/HTTPS**: **Titolo**, **Server**, **Rimanda a**;
- **Nome Windows (NTLM)**: computer, NetBIOS, dominio e versione del sistema, letti senza autenticarsi;
- **SSH**: come si presenta, l'impronta della chiave dell'host, scambio chiavi, chiavi e cifrari;
- **Banner**: quello che il servizio scrive da solo appena ci si collega;
- **Rilievi di questa porta**: per ognuno gravità, titolo, **Prova** e **Rimedio**, e a destra lo stato del lavoro.

Lo stato del lavoro è lo stesso dei [Findings](pagine/vulnerabilities.md). Chi è in **sola lettura** lo vede soltanto
(stato, chi e quando, nota). Un **amministratore** lo cambia con i pulsanti **Da rivedere**, ▲ **In corso**,
✓ **Rivisto**, **Ignorato** (si salva al clic), scrive nella casella **Cosa hai provato, cosa hai trovato** e salva con
**Salva la nota**.

## Stesso apparato {#identita}

Propone le **coppie di indirizzi che sembrano lo stesso apparato**, perché hanno la stessa impronta forte: la stessa
chiave SSH, lo stesso certificato TLS, lo stesso engineID SNMP o lo stesso nome Windows. Capita con server e firewall
che hanno più schede di rete. Si apre con **Stesso apparato**; `tasto:arrow-left` **Porte e servizi** torna
all'elenco.

![Stesso apparato](/manuale/servizi-rete/stesso-apparato.png)

In cima quattro riquadri: **Da confermare** (stessa impronta forte su due IP), **Collegati** (confermati da una
persona), **Rifiutati** (non si ripropongono da soli), **Prove** (quante impronte sono state raccolte).

| Colonna | Che cosa dice |
|---|---|
| **Primo IP**, **Secondo IP** | I due indirizzi, con sotto il nome o la rete. |
| **Prova** | Quale impronta coincide (SSH, TLS, SNMP, NTLM, nome dal trunk). |
| **Impronta** | L'inizio del valore. |
| **Decisione** | Solo per un amministratore: **Collega** li unisce come stesso apparato; **Non è lo stesso** scarta la proposta, che non torna da sola. |

Un amministratore ha anche **Raccogli le prove**, in alto nel pannello: rilegge le impronte già note. Niente si unisce
da solo: decide sempre una persona.

## Come si fa

- **Trovare i servizi con accesso in chiaro**: apri **Dove guardare**, clic su ▲ **Accessi in chiaro**; l'elenco resta
  filtrato, apri una riga per la prova e il rimedio.
- **Vedere quali versioni di un prodotto girano in rete**: **Raggruppa per** › **Prodotto**, apri il gruppo con
  `icona:chevron-right`.
- **Controllare tutti i servizi di un server**: scrivi il suo indirizzo nella ricerca e premi **Invio**, oppure
  **Raggruppa per** › **Host**.
- **Segnare un rilievo come sistemato** (amministratore): apri la riga, nel rilievo premi ✓ **Rivisto** e scrivi nella
  nota cosa hai fatto, poi **Salva la nota**.
- **Rileggere le risposte di una rete dopo una modifica** (amministratore): clic sulla rete in **Servizi per rete**,
  poi **Sonda** seguito dalla rete.
- **Unire due indirizzi dello stesso firewall**: **Stesso apparato**, controlla **Prova** e **Impronta**, poi
  **Collega**.

## Cosa vogliono dire i segni {#segni}

Nella colonna **Come** e nella legenda in fondo all'elenco:

- ◆ **TLS + HTTP**, ◆ **TLS**, ● **HTTP**, ■ **SSH**, ◇ **NTLM**: la risposta di quel protocollo è stata letta.
- ▲ **banner**: il servizio si presenta da solo.
- ▼ **UDP**: ha risposto a una domanda UDP di protocollo (DNS, NTP, NetBIOS, SQL Browser).
- ○ **tace**: aperta, ma non risponde alle sonde.
- – **aperta**: trovata aperta dal giro leggero, non ancora sondata. – **solo nmap**: nome dalla scansione, non ancora
  sondata.
- Nella colonna Da guardare: ▲ accesso in chiaro, ◆ certificato da sistemare, – non rivista da 7 giorni.

## Da dove arrivano i dati

Le porte vengono dalle scansioni ([Scansioni interne](pagine/scans.md)): entrano qui subito, anche prima delle sonde.
Le sonde leggono le risposte ogni 6 ore, per i clienti che non le hanno spente. Le impronte di Stesso apparato
arrivano dalle sonde, da SNMP, dai nomi Windows e dai nomi sentiti dalla sonda trunk.

## Se la pagina è vuota

- **Nessuna porta aperta finora**: le porte entrano dopo la prima scansione delle reti.
- **Nessun servizio con questi filtri**: togli un filtro con la sua `icona:x` o cerca un'altra cosa.
- Oltre 20.000 servizi la pagina avvisa che i numeri sono per difetto: restringi con un filtro.
- **Nessuna proposta** in Stesso apparato: nessuna impronta uguale su due indirizzi. È il caso normale.
