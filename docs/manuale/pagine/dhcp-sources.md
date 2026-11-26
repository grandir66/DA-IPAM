---
percorso: /dhcp/sources
titolo: Sorgenti DHCP esterne — i lease letti dai router
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie i **lease DHCP** letti dai server DHCP della rete che non sono la VM dell'appliance: router MikroTik, server
Windows (Active Directory), Cisco. Per ogni indirizzo dato si vede a quale MAC e a quale nome è andato, da quale server
e quando è stato visto l'ultima volta. DA-IPAM usa questi dati per dare un nome e un MAC agli host trovati nelle reti.
Si arriva dalla scheda **Sorgenti** in cima alla pagina [DHCP](pagine/dhcp.md), o dal pulsante **Tabella sorgenti
esterne**.

![La pagina Sorgenti DHCP esterne](/manuale/dhcp-sources/pagina.png)

## Le voci della pagina

1. **Sincronizza tutti**: rilegge subito i lease da tutte le sorgenti. È grigio se non c'è nessuna sorgente.
2. **Cerca per IP, MAC o hostname…**: filtra i lease. Accanto, i filtri **Tutte le fonti** (MikroTik, Windows, Cisco,
   Altro) e **Tutti i device** (una sorgente sola), poi **Cerca** per applicare.
3. **Solo attivi negli ultimi**: con la casella spuntata nasconde i lease non visti da più del periodo scelto (1 giorno,
   7, 30, 90 giorni, 1 anno). Serve a togliere i relitti che i server DHCP tengono in memoria per mesi.
4. **Ultimo visto**: da quanto tempo il server DHCP ha visto il client («1h fa», «3g fa», «2mesi fa»). Il colore dice
   l'età: vedi i segni più sotto. Passa il mouse per la data esatta.

Sopra: i riquadri con il numero di **Lease totali** e quanti per tipo di sorgente.

**Sorgenti DHCP**: i router e i server configurati come sorgente, con Nome (un clic apre la scheda dell'apparato), Host,
Tipo e il pulsante **Sync** per rileggere solo quella.

Le colonne di **Lease DHCP** (un clic sul titolo ordina):

- **IP** e **MAC**.
- **Tipo**: **DYN** se l'indirizzo è dinamico, **STAT** se è una riserva fissa.
- **Hostname**: il nome che il client ha dato al server DHCP.
- **Sorgente**: il server che l'ha dato, con il pool o lo scope.
- **Rete**: la subnet di DA-IPAM in cui cade l'indirizzo (un clic la apre).
- **Stato**: lo stato del lease sul server (per esempio **bound**, assegnato) e quanto manca alla scadenza.
- **Ultimo visto** e **Ultimo sync** (quando DA-IPAM ha letto il dato).

In alto a destra della tabella, le frecce per cambiare pagina.

## Come si usa

1. Per sapere chi ha preso un indirizzo, scrivilo in **Cerca** e premi **Cerca**.
2. Per ripulire la vista dai client spariti da tempo, spunta **Solo attivi negli ultimi** e scegli 30 giorni.
3. Se un router è appena stato aggiunto, premi **Sync** sulla sua riga.

## Cosa vogliono dire i segni

- **Ultimo visto** verde: meno di 7 giorni. Giallo: meno di 30. Arancio: meno di 90. Rosso: più vecchio.
- **DYN** / **STAT**: indirizzo dinamico o riserva fissa.

## Da dove arrivano i dati

Dai router e dai server DHCP registrati come apparati con la loro credenziale (API dei MikroTik, WinRM sui server
Windows). La lettura gira anche da sola, con la scansione programmata.

## Se la pagina è vuota

«Nessun lease DHCP trovato» vuol dire che non c'è ancora stata una lettura: premi **Sincronizza tutti**. Se non c'è
nessuna sorgente, va registrato come apparato il router o il server che fa da DHCP, con la sua credenziale.
