---
percorso: /segmentazione
titolo: Chi raggiunge cosa — se le reti sono separate davvero
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Dice se **da una rete si arriva ai servizi delle altre**. La sonda si mette, una alla volta, in ogni VLAN e prova a
collegarsi ai servizi già noti delle altre reti: il risultato è una tabella «da questa rete verso quella». Serve a
controllare che firewall e VLAN separino davvero quello che deve restare separato, per esempio che la rete degli
ospiti non arrivi ai server.

Si arriva da **Sicurezza › Rete**, scheda **Chi raggiunge cosa** nel gruppo **Provate dalla sonda** (le schede di Rete
sono descritte in [Reti dal trunk](pagine/arp-table-trunk.md)). Tabelle e schede funzionano come nelle altre pagine:
vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La misura e i numeri

![La riga della misura e i quattro numeri](/manuale/segmentazione/misura.png)

La riga **Misura** dice se una misura c'è («fatta», «in corso», «mai fatta») e quando è finito l'ultimo giro. Un
**amministratore** ha in fondo alla riga `tasto:radar` **Misura ora**, che rifà subito il giro (spento mentre un giro
è in corso). Chi è in **sola lettura** non ha il pulsante.

Durante il giro compare **Misura in corso** con la barra e «N di M VLAN sorgente»; la pagina si aggiorna da sola ogni
pochi secondi. Se il giro si è fermato con un errore, al suo posto c'è il riquadro con il motivo.

Sotto, quattro numeri:

| Numero | Che cosa conta |
|---|---|
| **Raggiunti** | Le connessioni riuscite, con la percentuale sul totale: la porta ha accettato. |
| **Chiusi** | Risposta di rifiuto: il servizio c'è, ma rifiuta. |
| **Filtrati** | Nessuna risposta: un firewall o un filtro. |
| **Prove** | Quante connessioni sono state provate nel giro. |

## Le due schede

![Le schede e la matrice](/manuale/segmentazione/matrice.png)

1. **Rete × rete**: la matrice, rete per rete (vedi [Rete × rete](#matrice)).
2. **Servizio × rete sorgente**: parte dal servizio e dice da quali reti lo si tocca (vedi
   [Servizio × rete sorgente](#servizi)).
3. **Da \ verso**: l'angolo della matrice. La riga è la rete **da cui** si prova, la colonna quella **verso cui**.

Le immagini del manuale nascondono il contenuto delle celle.

## Rete × rete {#matrice}

Il pannello **Quali reti raggiungono quali**. Le intestazioni sono i nomi delle reti (passa il mouse per l'indirizzo).

- In ogni cella «raggiunti / totale» e sotto «N chiusi · N filtrati». Una cella come «29/40, 0 chiusi · 11
  filtrati» vuol dire: dei 40 servizi provati in quella rete, 29 si raggiungono, 11 non rispondono.
- La diagonale è grigia con –: una rete non si misura verso sé stessa. Un · vuol dire che quella coppia non è stata
  provata.
- Un clic su una cella apre sotto la matrice **Elenco della cella**: **Indirizzo** (con il nome dell'host),
  **Porta** ed **Esito** di ogni servizio provato.

In fondo al pannello la legenda dei segni.

## Servizio × rete sorgente {#servizi}

Lo stesso servizio visto da ciascuna VLAN da cui si è misurato.

| Colonna | Che cosa dice |
|---|---|
| **Servizio** | Indirizzo e porta, con sotto il nome dell'host. |
| **Rete** | La rete dove sta il servizio. |
| **Da dove** | Le reti di partenza, ognuna con il segno del suo esito. |

## Come si fa

- **Controllare che gli ospiti non arrivino ai server**: scheda **Rete × rete**, riga della rete ospiti, colonna della
  rete dei server: deve dire 0 raggiunti. Se no, clic sulla cella per sapere quali servizi passano.
- **Trovare chi raggiunge un pannello di gestione o un database**: scheda **Servizio × rete sorgente**, cerca la riga
  del servizio e leggi **Da dove**: ogni ● è una rete che ci arriva.
- **Verificare una regola del firewall appena cambiata**: un amministratore preme `tasto:radar` **Misura ora**, aspetta
  la fine della barra **Misura in corso**, poi riapre la cella.
- **Misurare da una sola rete**: dalle [Scansioni interne](pagine/scans.md), tipo **Segmentazione**, si sceglie la rete
  di partenza e quelle da raggiungere.

## Cosa vogliono dire i segni

- ● **raggiunto**: la porta ha accettato la connessione.
- ■ **chiuso**: il servizio c'è e rifiuta.
- ▲ **filtrato**: nessuna risposta.
- ○ **senza rotta**: dalla rete di partenza non c'è una strada verso quella di arrivo.
- – sulla diagonale: la rete verso sé stessa, non si misura. · : coppia non provata.

## Da dove arrivano i dati

La sonda prova da ogni VLAN i servizi già noti delle altre reti, quelli trovati dalle scansioni (vedi
[Porte e servizi](pagine/servizi-rete.md)). Di serie una volta a settimana (orari in
[Schedulazioni](pagine/settings-schedulazioni.md)); il giro si lancia anche dalle [Scansioni interne](pagine/scans.md).

## Se la pagina è vuota

- **Nessuna misura**: serve la sonda trunk, almeno due reti con VLAN e gateway, e i servizi già noti. Poi **Misura
  ora**.
- **Nessun servizio misurato**: la scheda Servizio × rete sorgente si riempie dopo il primo giro della matrice.
