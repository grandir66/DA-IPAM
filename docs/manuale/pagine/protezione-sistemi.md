---
percorso: /protezione/sistemi
titolo: Sistemi remoti — chi parla con la macchina adesso
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **i sistemi che in questo momento hanno una connessione aperta con la macchina** di DA-IPAM, nei due versi:
chi ci chiama e chi chiamiamo noi. Serve a riconoscere un collegamento che non dovrebbe esserci.

Si arriva dalla scheda **Sistemi remoti** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata nel
manuale.

## Le voci della pagina

In cima quattro numeri: **Collegati adesso**, **Entrano**, **Escono**, **Non riconosciuti** (indirizzi che non sono
in inventario né arrivano da NetBird).

Il pannello **Chi ci parla e a chi parliamo** è una fotografia delle connessioni aperte: chi parla solo ogni tanto può
non comparire. Colonne:

- **Sistema**: il nome, se l'indirizzo è in inventario o su NetBird; altrimenti **Non riconosciuto**.
- **Verso**: **← entra** (ha chiamato una nostra porta) o **→ esce** (lo abbiamo chiamato noi).
- **Indirizzo**, **Porta**, **Connessioni**.

**Cosa esce verso Domarc** spiega le connessioni in uscita verso i servizi Domarc (DA-Link, Vulcan, Zabbix e gli
altri), cosa portano e perché.

## Come si usa

1. Guarda le righe **Non riconosciuto**: sono indirizzi fuori dall'inventario.
2. Distingui **← entra** da **→ esce**: un sistema sconosciuto che entra è più delicato.
3. Ricarica la pagina per una nuova fotografia.

## Cosa vogliono dire i segni

- ● riconosciuto.
- ▲ non riconosciuto: non è in inventario e non arriva da NetBird.

## Da dove arrivano i dati

Le connessioni aperte sulla macchina quando si apre la pagina; i nomi vengono dall'inventario di DA-IPAM.

## Se la pagina è vuota

È una fotografia: ricarica per rifarla. Se dice «non letto», DA-IPAM non gira su un'appliance dove questo controllo
si può fare.
