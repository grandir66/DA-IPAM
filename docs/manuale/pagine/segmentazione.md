---
percorso: /segmentazione
titolo: Chi raggiunge cosa — se le reti sono separate davvero
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Dice se **da una rete si arriva ai servizi delle altre**. La sonda si mette, una alla volta, in ogni VLAN e prova a
collegarsi ai servizi già noti delle altre reti: il risultato è una tabella «da questa rete verso quella». Serve a
controllare che firewall e VLAN separino davvero quello che deve restare separato, per esempio che la rete degli
ospiti non arrivi ai server.

Si arriva da **Sicurezza › Rete**, scheda **Chi raggiunge cosa** nel gruppo **Provate dalla sonda**.

![La pagina Chi raggiunge cosa](/manuale/segmentazione/pagina.png)

In cima la riga **Misura** dice se una misura è stata fatta e quando è finito l'ultimo giro («mai fatta» se non c'è
ancora). Chi è amministratore vede **Misura ora**, che rifà subito il giro. Durante il giro compare **Misura in
corso** con l'avanzamento.

Sotto, quattro riquadri:

- **Raggiunti**: le connessioni riuscite, con la percentuale sul totale. La porta ha accettato la connessione.
- **Chiusi**: risposta di rifiuto. Il servizio c'è, ma rifiuta.
- **Filtrati**: nessuna risposta. Firewall o filtro.
- **Prove**: quante connessioni sono state provate nel giro.

## Le voci della pagina

Due schede scelgono il modo di leggere:

1. **Rete × rete**: la matrice. In ogni cella «raggiunti / totale», poi chiusi e filtrati.
2. **Servizio × rete sorgente**: parte dal servizio e dice da quali reti lo si tocca.
3. **Da \ verso**: l'angolo della matrice. La riga è la rete **da cui** si prova, la colonna quella **verso cui**.

Le immagini del manuale nascondono il contenuto delle celle.

## Rete × rete {#matrice}

Dice se da una rete si arriva ai servizi delle altre: serve a controllare che firewall e VLAN separino davvero.

- Leggi la riga come «da questa rete» e la colonna come «verso quella». Una cella come «29/40, 0 chiusi · 11
  filtrati» vuol dire: dei 40 servizi provati in quella rete, 29 si raggiungono, 11 non rispondono.
- La diagonale è vuota (–): una rete non si misura verso sé stessa.
- Clicca una cella: sotto compare **Elenco della cella**, con **Indirizzo**, **Porta** ed **Esito** di ogni servizio
  provato.

### Come si usa

1. Cerca le celle dove ti aspetti zero e trovi dei raggiunti: per esempio dalla rete dei client verso la gestione.
2. Clicca la cella per vedere quali servizi passano.
3. Dopo aver cambiato una regola del firewall premi **Misura ora** e confronta.

### Cosa vogliono dire i segni

- ● **raggiunto**: la porta ha accettato la connessione.
- ■ **chiuso**: il servizio c'è e rifiuta.
- ▲ **filtrato**: nessuna risposta.
- ○ **senza rotta**: dalla rete di partenza non c'è una strada verso quella di arrivo.

### Da dove arrivano i dati

La sonda prova da ogni VLAN i servizi già noti delle altre reti (quelli trovati dalle scansioni, vedi
[Porte e servizi](pagine/servizi-rete.md)). Di serie una volta a settimana; il giro si lancia anche dalle
[Scansioni interne](pagine/scans.md) col tipo **Segmentazione**.

### Se è vuota

**Nessuna misura**: serve la sonda trunk, almeno due reti con VLAN e gateway, e i servizi già noti. Poi **Misura
ora**.

## Servizio × rete sorgente {#servizi}

Parte dal servizio: lo stesso servizio visto da ciascuna VLAN da cui si è misurato. Colonne: **Servizio** (indirizzo e
porta), **Rete** (dove sta il servizio) e **Da dove** (le reti di partenza, ognuna col segno del suo esito).

### Come si usa

1. Cerca i servizi delicati: desktop remoto, database, pannelli di gestione.
2. Controlla **Da dove**: una rete che non dovrebbe arrivarci è una regola del firewall da chiudere.

### Cosa vogliono dire i segni

● raggiunto, ■ chiuso, ▲ filtrato, ○ senza rotta.

### Da dove arrivano i dati

Lo stesso giro di **Rete × rete**.

### Se è vuota

**Nessun servizio misurato**: si riempie dopo il primo giro della matrice.
