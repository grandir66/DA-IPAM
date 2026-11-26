---
percorso: /protezione/sistemi
titolo: Sistemi remoti — chi parla con la macchina adesso
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **i sistemi che in questo momento hanno una connessione aperta con la macchina** di DA-IPAM, nei due versi:
chi ci chiama e chi chiamiamo noi. Serve a riconoscere un collegamento che non dovrebbe esserci.

Si arriva dalla scheda **Sistemi remoti** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima la riga **Filtro degli accessi** (vedi [Stato della protezione](pagine/protezione.md)) e quattro numeri:
**Collegati adesso**, **Entrano**, **Escono**, **Non riconosciuti** (indirizzi che non sono in inventario né arrivano
da NetBird).

Il pannello **Chi ci parla e a chi parliamo** è una fotografia delle connessioni aperte: chi parla solo ogni tanto può
non comparire.

| Colonna | Che cosa dice |
|---|---|
| **Sistema** | Il nome, se l'indirizzo è in inventario o su NetBird; altrimenti ▲ **Non riconosciuto**. |
| **Verso** | **← entra** (ha chiamato una nostra porta) o **→ esce** (lo abbiamo chiamato noi). |
| **Indirizzo** | L'indirizzo dall'altra parte. |
| **Porta** | La porta usata. |
| **Connessioni** | Quante connessioni aperte con quel sistema. |

In alto a destra nel pannello **Cosa esce verso Domarc** apre la pagina che spiega le connessioni in uscita verso i
servizi Domarc (DA-Link, Vulcan, Zabbix e gli altri), cosa portano e perché.

## Come si fa

- **Riconoscere un collegamento strano**: guarda le righe ▲ **Non riconosciuto**, prima quelle **← entra**: un sistema
  sconosciuto che chiama la macchina è più delicato di uno che chiamiamo noi.
- **Capire perché la macchina parla con un servizio Domarc**: **Cosa esce verso Domarc**.
- **Rifare la fotografia**: ricarica la pagina.
- **Dare un nome a un indirizzo**: aggiungilo all'inventario da [Apparati](pagine/discovery.md); alla fotografia dopo
  compare col suo nome.

## Cosa vogliono dire i segni

- ● riconosciuto.
- ▲ non riconosciuto: non è in inventario e non arriva da NetBird.

## Da dove arrivano i dati

Le connessioni aperte sulla macchina quando si apre la pagina; i nomi vengono dall'inventario di DA-IPAM.

## Se la pagina è vuota

È una fotografia: ricarica per rifarla. Se dice «Connessioni aperte: non letto», DA-IPAM non gira su un'appliance dove
questo controllo si può fare.
