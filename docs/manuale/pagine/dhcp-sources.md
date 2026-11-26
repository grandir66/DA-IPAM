---
percorso: /dhcp/sources
titolo: Sorgenti DHCP esterne — i lease letti dai router
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie i **lease DHCP** letti dai server DHCP della rete che non sono la VM dell'appliance: router MikroTik, server
Windows (Active Directory), Cisco. Per ogni indirizzo dato si vede a quale MAC e a quale nome è andato, da quale server
e quando è stato visto l'ultima volta. DA-IPAM usa questi dati per dare un nome e un MAC agli host trovati nelle reti.
Si arriva dalla scheda **Sorgenti** in cima alla pagina [DHCP](pagine/dhcp.md), o dal pulsante **Tabella sorgenti
esterne**.

Le parti comuni (menu, schede, tabelle, ordinamento) sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).
Accanto al titolo, il collegamento **hub DHCP** porta alla pagina [DHCP](pagine/dhcp.md) della VM dell'appliance.

## I numeri e le sorgenti

![I numeri e le sorgenti DHCP](/manuale/dhcp-sources/sorgenti.png)

Sotto il titolo, i riquadri con il numero di **Lease totali** e quanti per tipo di sorgente (MikroTik, Windows…).

1. `tasto:refresh` **Sincronizza tutti**: rilegge subito i lease da tutte le sorgenti. È grigio se non c'è nessuna
   sorgente.
2. `tasto:refresh` **Sync**, sulla riga di una sorgente: rilegge solo quella.

Il riquadro **Sorgenti DHCP** elenca i router e i server configurati come sorgente, con **Nome** (un clic apre la
scheda dell'apparato), **Host**, **Tipo** e **Azioni**.

Sincronizzare spetta all'amministratore: chi è in sola lettura vede i pulsanti, ma il programma rifiuta la richiesta.

## I lease

![La tabella dei lease DHCP](/manuale/dhcp-sources/lease.png)

1. `icona:search` **Cerca per IP, MAC o hostname…**: filtra i lease. Accanto, i filtri **Tutte le fonti** (MikroTik,
   Windows, Cisco, Altro) e **Tutti i device** (una sorgente sola), poi `tasto:search` **Cerca** per applicare.
2. **Solo attivi negli ultimi**: con la casella spuntata nasconde i lease non visti da più del periodo scelto (1 giorno,
   7, 30, 90 giorni, 1 anno). Serve a togliere i relitti che i server DHCP tengono in memoria per mesi. Se così non
   resta niente, **Mostra tutti** toglie la casella.
3. **Tipo**: **DYN** se l'indirizzo è dinamico, **STAT** se è una riserva fissa.
4. **Ultimo visto**: da quanto tempo il server DHCP ha visto il client («1h fa», «3g fa», «2mesi fa»). Il colore dice
   l'età: vedi i segni più sotto. Passa il mouse per la data esatta.

Le altre colonne (un clic sul titolo ordina, `icona:arrow-up-down`; `icona:arrow-down` segna quella in uso):

- **IP** (un clic apre l'host) e **MAC**.
- **Hostname**: il nome che il client ha dato al server DHCP.
- **Sorgente**: il server che l'ha dato, con il pool o lo scope.
- **Rete**: la subnet di DA-IPAM in cui cade l'indirizzo (un clic la apre).
- **Stato**: lo stato del lease sul server (per esempio **bound**, assegnato) e quanto manca alla scadenza.
- **Ultimo sync**: quando DA-IPAM ha letto il dato.

In alto a destra della tabella, `icona:chevrons-left` `icona:chevron-left` `icona:chevron-right` `icona:chevrons-right`
cambiano pagina; in mezzo, la pagina e il totale («1/8»).

## Come si fa

- **Sapere chi ha preso un indirizzo**: scrivilo in **Cerca per IP, MAC o hostname…** e premi `tasto:search`
  **Cerca**.
- **Trovare il nome di un telefono di cui conosci il MAC**: scrivi il MAC in **Cerca** e leggi **Hostname** e
  **Rete**.
- **Ripulire la vista dai client spariti da tempo**: spunta **Solo attivi negli ultimi** e scegli 30 giorni.
- **Leggere subito un router appena aggiunto**: `tasto:refresh` **Sync** sulla sua riga.
- **Vedere solo gli indirizzi dati da un server Windows**: filtro **Windows** in **Tutte le fonti**, poi **Cerca**.

## Cosa vogliono dire i segni

- **Ultimo visto** verde: meno di 7 giorni. Giallo: meno di 30. Arancio: meno di 90. Rosso: più vecchio.
- **DYN** / **STAT**: indirizzo dinamico o riserva fissa.

## Da dove arrivano i dati

Dai router e dai server DHCP registrati come apparati con la loro credenziale (API dei MikroTik, WinRM sui server
Windows). La lettura gira anche da sola, con la scansione programmata.

## Se la pagina è vuota

«Nessun lease DHCP trovato» vuol dire che non c'è ancora stata una lettura: premi **Sincronizza tutti**. Se non c'è
nessuna sorgente, va registrato come apparato il router o il server che fa da DHCP, con la sua credenziale.
