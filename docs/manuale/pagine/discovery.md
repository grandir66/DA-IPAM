---
percorso: /discovery
titolo: Apparati — l'elenco di tutto quello che c'è in rete
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco di **tutti gli apparati e gli host** che DA-IPAM ha trovato nelle reti dell'istanza: PC, telefoni,
stampanti, server, switch, telecamere, impianti. Ogni riga è un apparato. Quasi tutto il lavoro parte da qui: si
cerca un apparato, se ne apre la scheda, se ne corregge il nome o la categoria, lo si registra come dispositivo
gestito, gli si assegna una credenziale. Si arriva da **Network › Apparati** nel menu. Il numero rosso accanto alla
voce dice quanti cambiamenti aspettano di essere visti nella scheda [Cambiamenti](pagine/network-changes.md).

Menu, schede, filtri, colonne, tasto destro e selezione funzionano come in tutte le pagine: sono spiegati una volta
sola nelle [parti comuni dell'interfaccia](../INTERFACCIA.md). Qui sotto c'è quello che Apparati ha di suo.

## Le schede in cima

| Scheda | A cosa serve |
|---|---|
| **Elenco** | Questa pagina: tutti gli apparati. |
| [Attribuzione](pagine/controllo-classificazione.md) | Controllare e correggere **che cos'è** ogni apparato (classificazione, produttore, funzione), con le prove su cui il programma si è basato. |
| [Cambiamenti](pagine/network-changes.md) | Che cosa è cambiato in rete: apparati nuovi, spariti, con un altro indirizzo o un altro MAC. |
| [IP esclusi](pagine/excluded-ips.md) | Gli indirizzi che le scansioni devono saltare. |

## Il titolo e i numeri

Accanto al titolo: quante righe ci sono («322 apparati e host»), quanti indirizzi sono stati **accorpati** a un
apparato che ne ha più d'uno («82 IP accorpati»), e quanti apparati sono ● online, ○ offline e sconosciuti. I numeri
contano tutte le righe, senza filtri.

## La barra in cima all'elenco

![La barra di Apparati](/manuale/discovery/barra.png)

1. `icona:search` **Cerca IP, MAC, nome…**: cerca nell'indirizzo, nel MAC, nel nome, nel produttore, nella rete,
   nelle note, nel sistema operativo e nel nome dell'utente abituale.
2. `tasto:filter` **Filtri**: apre il pannello dei filtri (sotto).
3. **Colonne: le tue**: passa al volo a una vista pronta, **Inventario**, **Sicurezza** o **Rete**, con le colonne
   adatte a quel lavoro; «le tue» sono quelle che hai scelto tu.
4. `tasto:columns` **Gestisci colonne**: quali colonne vedere e in che ordine.
5. `tasto:download` **Esporta CSV**: scarica quello che vedi, con i filtri e le colonne scelte.
6. `tasto:refresh` **Aggiorna**: ricarica l'elenco.

### Le categorie

![Le categorie](/manuale/discovery/categorie.png)

Sopra la tabella: **Tutti**, Postazioni, Telefonia, Server, Archiviazione, Rete, Stampa, Videosorveglianza, OT
(impianti), IoT (oggetti connessi)… e **Senza categoria**. Un clic mostra solo quel gruppo, il numero dice quanti
apparati ci sono. Senza categoria raccoglie gli apparati ancora da classificare: è la lista di lavoro di
[Attribuzione](pagine/controllo-classificazione.md).

### I filtri

![Il pannello dei filtri](/manuale/discovery/filtri.png)

- **Stato**: Online, Offline, Sconosciuto.
- **Classificazione**: che tipo di apparato è (PC, stampante, switch…).
- **Subnet**: una sola rete.
- **Sistema**: il sistema operativo (Windows, Linux…).
- **Produttore**: fra quelli trovati.
- **Fisico o virtuale**: macchine fisiche o virtuali.
- **Funzione**: il ruolo del server (di dominio, file server, database, backup, email, applicativo…).
- **Vulnerabilità**: con CVE Critical, con CVE Critical o High, con qualsiasi finding.
- **Dati acquisiti**: solo gli apparati di cui DA-IPAM ha già letto l'inventario (modello, seriale, firmware), oppure
  solo quelli senza.
- **Solo le righe da rivedere**: gli apparati con campi scritti in automatico da confermare.

Il pulsante in fondo, **Mostra N righe**, chiude il pannello. Ogni filtro attivo resta accanto a `tasto:filter` con
la sua `icona:x` per toglierlo.

## La tabella

![L'inizio della tabella](/manuale/discovery/tabella.png)

1. La casella nell'intestazione seleziona tutte le righe visibili; quella su ogni riga, la riga sola (vedi
   [Più apparati insieme](#selezione)).
2. `icona:more-vertical` apre il [menu della riga](#menu-riga).
3. La colonna **Profilo**, con le icone delle integrazioni (vedi sotto).
4. `icona:arrow-up` accanto al nome: la tabella è ordinata per questa colonna; `icona:arrow-up-down` vuol dire che
   la colonna si può ordinare con un clic.
5. `icona:pencil` accanto a un valore: un clic lo corregge (Invio salva, Esc annulla).

### Le colonne

Di serie si vedono queste colonne, in quest'ordine. Passa il mouse sull'intestazione per leggerne la spiegazione.

| Colonna | Che cosa dice |
|---|---|
| **Profilo** | Le icone delle integrazioni: vedi sotto. |
| **IP** | L'indirizzo principale. **+1 IP**, **+2 IP**: lo stesso apparato ha altri indirizzi (passa il mouse per leggerli). `icona:external-link` apre la sua interfaccia web. |
| **Nome** | Il nome dell'apparato. `icona:pencil` lo corregge: il nome scritto a mano vince su quello trovato. |
| **Stato** | Online, Offline o Sconosciuto, con l'ora dell'ultima risposta. |
| **Produttore** | Chi fa l'apparato. *In corsivo* se è ricavato dal MAC e nessuno l'ha confermato. |
| **Classificazione** | Che tipo di apparato è. «Senza categoria» tratteggiato: ancora da decidere. |
| **Cred** | I protocolli per cui c'è una credenziale **provata con successo** su questo apparato (SSH, SNMP, WinRM, API). |
| **Manuale** | L'apparato è stato segnato a mano come conosciuto. |
| **DHCP** | Come ha avuto l'indirizzo: dinamico, riservato o statico. |
| **AD** | È un computer di Active Directory. |
| **Utente abituale** | Chi usa di più la postazione. «auto» = calcolato dagli accessi di Active Directory; `icona:lock` = scelto a mano; il triangolo = il calcolo indica un'altra persona. |
| **CVE** | La gravità più alta fra le vulnerabilità trovate. |
| **CVE C/H/M** | Quante vulnerabilità critiche, alte e medie. |
| **Conf** | Quanto è sicuro il riconoscimento del tipo di apparato, in percentuale. |
| **MAC** | L'indirizzo della scheda di rete. |
| **Subnet** | La rete in cui si trova. |
| **Seriale** | Il numero di serie, se è stato letto. |
| **Porte TCP**, **Porte UDP** | Le porte aperte viste all'ultima scansione. |
| **Ultimo visto** | Quando ha risposto l'ultima volta. |
| **OS** | Il sistema operativo letto dalla scansione o via SNMP. |
| **Da rivedere** | I campi scritti in automatico da un profilo e non ancora confermati. |

Da **Gestisci colonne** si aggiungono anche: Vendor, Note, Primo visto, VLAN, Sede, Porta switch (dove è attaccato),
AD DNS (il nome nel DNS di Active Directory), MH (quante interfacce ha), Rilevato, Porte aperte, RTT (il tempo di
risposta in millisecondi), Modello, Firmware, Asset tag, App scansionate, Dati acquisiti.

### Le icone del Profilo

![La colonna Profilo](/manuale/discovery/profilo.png)

Ogni icona dice una cosa che DA-IPAM sa dell'apparato. **Colorata** = sì, ed è un collegamento; **grigia** = no.

| Icona | Colorata vuol dire | Un clic |
|---|---|---|
| `icona:wrench` | È un **dispositivo gestito**, con la sua scheda tecnica | Apre il dispositivo |
| `icona:package` | È un **asset NIS2** dell'inventario | Apre l'asset |
| `icona:activity` | È **monitorato in LibreNMS** | Apre l'apparato in LibreNMS |
| `icona:shield` / `icona:plus-circle` | Lo scudo: ha l'agente **Wazuh**, verde se collegato, rosso se non risponde. Il cerchio grigio col più: non c'è | Apre l'agente, o ne propone l'aggiunta |
| `icona:monitor` | Ha il **desktop remoto** (RDP) aperto. Barrato: la scansione non ha visto la porta | Apre il controllo remoto senza agente |
| `icona:terminal` | Ha **SSH** aperto | Apre il terminale |
| `icona:link` con **P** o **/N** | Ha **più indirizzi**: P = questo è il principale, /N = è uno degli N indirizzi | Apre l'apparato principale |

## Il menu della riga {#menu-riga}

Si apre con `icona:more-vertical` all'inizio della riga, oppure col tasto destro sulla riga.

![Il menu della riga](/manuale/discovery/azioni-riga.png)

Chi è in **sola lettura** vede:

- `icona:pencil` **Apri la scheda**: tutto quello che si sa dell'apparato ([scheda dell'oggetto](pagine/objects-id.md));
- `icona:globe` **Apri web (http/s)**: l'interfaccia web dell'apparato in una scheda nuova;
- `icona:activity` **Apri in LibreNMS**, se è monitorato.

Un **amministratore** vede in più:

- **Promuovi a dispositivo** (se non lo è) o **Modifica dispositivo** (se lo è già): lo registra come dispositivo
  gestito, con tipo, produttore e credenziali, oppure ne cambia i dati;
- `icona:shield-check` **Testa credenziali device** e `icona:refresh` **Riscansiona dispositivo**, per i dispositivi gestiti: provano le credenziali e
  rileggono l'apparato (SNMP, ARP, inventario, software);
- `icona:key` **Test credenziali host**: prova una credenziale su questo indirizzo;
- **Installa agent/moduli**: installa sui computer Windows gli agenti di controllo remoto, inventario e Wazuh;
- `icona:terminal` **Terminale SSH**, e dove serve `icona:monitor` **Desktop remoto (RDP)** e **VNC**;
- **Aggiungi a LibreNMS**;
- `icona:trash` **Elimina dispositivo** o **Elimina host**: toglie la riga. Un host che risponde ancora ricompare alla scansione
  successiva; per farlo sparire davvero si mette fra gli [IP esclusi](pagine/excluded-ips.md).

### Il tasto destro su una cella

![Il tasto destro su una cella](/manuale/discovery/tasto-destro.png)

Oltre alle voci qui sopra, il tasto destro su una cella offre, per quella colonna, `icona:filter` **Mostra solo questo
valore**, `icona:eye-off` **Nascondi questo valore** e `icona:copy` **Copia il valore**. È il modo più rapido per filtrare: tasto destro sulla cella
«Senza categoria», poi «Mostra solo questo valore». I filtri fatti così compaiono sopra la tabella, ognuno con la sua `icona:x`.

## Più apparati insieme {#selezione}

![La barra della selezione](/manuale/discovery/selezione.png)

Spunta le caselle a sinistra delle righe: sopra la tabella compare la barra della selezione. Le azioni cambiano dati,
quindi le esegue solo un amministratore.

- `icona:pencil` **Modifica multipla**: apre una finestra con i campi da applicare a tutti gli apparati scelti: classificazione,
  tipologia, produttore, note, host conosciuto, assegnazione dell'indirizzo, categoria e criticità NIS2, credenziale.
  Si applicano **solo i campi spuntati** (riquadrati in blu): gli altri restano come sono.
- `icona:package-plus` **Rendi apparato**: registra come dispositivi gestiti gli host scelti.
- `icona:link` **Stesso device fisico**: dice al programma che gli indirizzi scelti sono lo stesso apparato (per esempio un server
  con due schede di rete). Per gli amministratori ci sono anche `icona:merge` **Unisci con…** e `icona:split` **Separa…**.
- `icona:lock` **Utente abituale…**: assegna a mano la persona che usa le postazioni scelte.
- `icona:check` **Conferma i campi letti**: toglie il segno «da rivedere» senza cambiare i valori.
- `icona:refresh` **Aggiorna selezionati**: rilegge i dispositivi gestiti scelti, uno dopo l'altro (SNMP, ARP, software).
- `icona:boxes` **Crea asset NIS2**: crea o aggiorna l'asset nell'inventario NIS2 per ogni apparato scelto.
- `icona:activity` **Aggiungi a LibreNMS**: li mette sotto monitoraggio, uno alla volta.
- `icona:x` **Deseleziona**: toglie la selezione.

## Come si fa

- **Trovare un apparato**: scrivi una parte del nome, dell'indirizzo o del MAC in **Cerca**.
- **Vedere solo i server che non rispondono**: categoria **Server**, poi tasto destro su una cella «Online» della
  colonna Stato › **Nascondi questo valore**.
- **Classificare quello che manca**: categoria **Senza categoria**, poi per ogni riga `icona:more-vertical` › Apri la scheda, oppure la
  scheda [Attribuzione](pagine/controllo-classificazione.md), che li mostra con le prove.
- **Correggere il nome di una stampante**: `icona:pencil` accanto al nome, scrivi, **Invio**.
- **Portare in Excel l'elenco dei PC con vulnerabilità critiche**: categoria **Postazioni**, `tasto:filter` › Vulnerabilità ›
  Con CVE Critical, poi `tasto:download`.
- **Registrare dieci switch come dispositivi gestiti**: categoria **Rete**, spunta le righe, **Rendi apparato**, poi
  **Modifica multipla** per dare a tutti la stessa credenziale SNMP.

## Cosa vogliono dire i segni

- ● **Online** (pastiglia verde): ha risposto all'ultimo giro. ● **Offline** (rossa): non risponde più; un PC spento
  la sera è normale. **Sconosciuto**: non è mai stato provato.
- Produttore *in corsivo*: ricavato dal MAC, non confermato.
- Classificazione tratteggiata: ancora da decidere.
- **+1 IP** grigio: lo stesso apparato ha un altro indirizzo.

## Da dove arrivano i dati

Dalle scansioni delle reti (ping, ARP, nmap), dalle tabelle ARP di router e switch, dal DHCP, da Active Directory e
dalle letture dei dispositivi gestiti (SNMP, SSH, WinRM). Gli stati si aggiornano a ogni giro della scansione
programmata; gli orari stanno in [Schedulazioni](pagine/settings-schedulazioni.md).

## Se la pagina è vuota

Serve almeno una rete con la scansione accesa: si aggiunge da [Subnet](pagine/networks.md). Se ci sono filtri attivi
o una categoria scelta, toglili (pastiglia **Tutti**, poi `icona:x` sui filtri). Una rete appena aggiunta si riempie al primo
giro della scansione.
