---
percorso: /discovery
titolo: Apparati — l'elenco di tutto quello che c'è in rete
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco di **tutti gli apparati e gli host** che DA-IPAM ha trovato nelle reti dell'istanza: PC, telefoni,
stampanti, server, switch, telecamere. Ogni riga è un apparato, con indirizzo, nome, stato, produttore e
classificazione. Da qui si parte quasi sempre: si cerca un apparato, se ne apre la scheda, se ne corregge il nome o la
categoria. Si arriva da **Network › Apparati** nel menu.

In cima ci sono quattro schede: **Elenco** (questa pagina), [Attribuzione](pagine/controllo-classificazione.md),
[Cambiamenti](pagine/network-changes.md) e [IP esclusi](pagine/excluded-ips.md).

![La pagina Apparati](/manuale/discovery/pagina.png)

## Le voci della pagina

1. **Cerca IP, MAC, nome…**: filtra l'elenco mentre scrivi. Cerca nell'indirizzo, nel MAC, nel nome e nel produttore.
2. **Filtri**: apre i filtri per stato, rete, classificazione, vulnerabilità e inventario letto. Un filtro scelto si
   toglie con la ✕ accanto al suo nome.
3. **Categorie** (Tutti, Postazioni, Telefonia, Server, Archiviazione, Rete, Stampa, Videosorveglianza…): un clic
   mostra solo quella categoria. Il numero dice quanti apparati ci sono. **Senza categoria** raccoglie quelli ancora
   da classificare.
4. **Profilo**: una fila di piccole icone che dicono cosa sa DA-IPAM dell'apparato. Colorata vuol dire «sì», grigia
   vuol dire «non ancora». Nell'ordine: la chiave inglese (è un dispositivo gestito, con la sua scheda), la scatola
   (è un asset NIS2 nell'inventario), l'onda (è monitorato in LibreNMS), poi le altre integrazioni. Passa il mouse su
   un'icona per leggerne il nome. Un clic su un'icona colorata apre la cosa a cui si riferisce.
5. **Stato**: **Online** se l'apparato ha risposto all'ultimo giro, **Offline** se non risponde più, **Sconosciuto**
   se non è mai stato provato. Accanto c'è da quanto tempo: «2h fa» vuol dire che l'ultima risposta è di due ore fa.

Le altre colonne:

- **IP**: l'indirizzo principale. Il segno **+1 IP**, **+2 IP** dice che lo stesso apparato ha altri indirizzi: un
  clic li mostra.
- **Nome**, **Produttore**, **Note**: si correggono a mano con la matita accanto al valore. Il produttore in corsivo
  è ricavato dal MAC: vuol dire che nessuno l'ha ancora confermato.
- **Classificazione**: che tipo di apparato è. Se è sbagliata si corregge da [Attribuzione](pagine/controllo-classificazione.md).

In alto a destra: **Colonne** sceglie quali colonne vedere e in che ordine, la freccia in giù **esporta in CSV**
quello che vedi, le due frecce ricaricano l'elenco.

## Il menu di ogni riga

Il pulsante **⋮** all'inizio della riga (oppure il tasto destro sulla riga) apre le azioni su quell'apparato.

![Il menu ⋮ di una riga](/manuale/discovery/azioni-riga.png)

- **Apri la scheda**: tutto quello che si sa dell'apparato, in una pagina ([scheda dell'oggetto](pagine/objects-id.md)).
- **Apri web (http/s)**: apre l'interfaccia web dell'apparato in una scheda nuova del browser, se ne ha una.
- Chi ha il ruolo di amministratore vede anche le azioni che cambiano qualcosa: **Rendi apparato** (lo registra come
  dispositivo gestito), **Assegna credenziale**, **Riscansiona dispositivo**, l'aggiunta a LibreNMS o a Wazuh,
  **Elimina**. Chi è in sola lettura vede solo le prime voci.

## Come si usa

1. Per trovare un apparato scrivi una parte del nome o dell'indirizzo in **Cerca**.
2. Per vedere solo un tipo di apparato clicca la sua categoria. Per ripulire l'elenco usa **Filtri**.
3. Per sapere tutto di un apparato: **⋮ › Apri la scheda**.
4. Per correggere un nome o un produttore clicca la matita, scrivi e premi Invio.
5. Per agire su più apparati insieme spunta la casella a sinistra delle righe: in alto compaiono le azioni sulla
   selezione (riscansione, creazione degli asset NIS2, aggiunta a LibreNMS).

## Cosa vogliono dire i segni

- ● **Online** (pallino pieno): ha risposto all'ultimo giro.
- ○ **Offline** (pallino vuoto): non risponde più. Un apparato spento la sera è normale.
- Icona del profilo **colorata**: quella cosa c'è. **Grigia**: non ancora.
- Produttore **in corsivo**: ricavato dal MAC, non confermato.

## Da dove arrivano i dati

Dalle scansioni delle reti (ping, ARP, nmap), dalle tabelle ARP di router e switch, dal DHCP e da Active Directory.
Gli stati si aggiornano a ogni giro della scansione programmata: gli orari stanno in
[Schedulazioni](pagine/settings-schedulazioni.md).

## Se la pagina è vuota

Serve almeno una rete con la scansione accesa: si aggiunge da [Subnet](pagine/networks.md). Se ci sono filtri scelti,
toglili. Una rete appena aggiunta si riempie al primo giro della scansione.
