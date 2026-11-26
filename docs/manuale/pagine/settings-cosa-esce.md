---
percorso: /settings/cosa-esce
titolo: Cosa esce — i dati che questa istanza manda a Domarc
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **tutto quello che esce da questa istanza verso Domarc**, e fa scegliere all'amministratore quanto mandare.
La scelta vale all'origine: un dato che si decide di non mandare non parte proprio. Da Domarc non si può cambiare.
Si arriva da **Config › Cosa esce**. È riservata agli amministratori dell'istanza; gli altri vedono solo un avviso.

Per questa pagina non c'è una schermata nel manuale: mostra indirizzi e dati dell'installazione.

## Le voci della pagina

**DA-Link — segnale di vita**: ogni 5 minuti l'istanza dice a Domarc che è viva e com'è messa.

- **Collegamento**: **✓ Configurato** (con il nodo e il cliente a cui appartiene), **Non configurato** («questa
  istanza non manda niente a DA-Link») o **Configurazione non valida**.
- **Ultimo invio**: **Ricevuto** con l'ora, **Mai inviato**, o il motivo per cui non è arrivato (hub non
  raggiungibile, nessuna risposta in tempo, certificato rifiutato, risposta illeggibile, ricezione spenta).
- **Cosa può uscire**: il livello scelto, che si cambia da [Opzioni](pagine/settings-opzioni.md).
  **Solo stato** manda versione, moduli accesi, salute dei moduli, ultimo errore e le porte aperte sulla rete
  privata di assistenza. **Stato + numeri dell'inventario** aggiunge quanti dispositivi e quante reti ci sono e
  l'esito dell'ultima scansione; mai l'inventario riga per riga. Sotto si legge chi ha fatto la scelta e quando.
- **Cancellazione a Domarc**: dopo aver abbassato il livello compare **In attesa di conferma** finché DA-Link non
  conferma di aver cancellato i numeri; poi **Confermata**. La pagina si rilegge da sola.
- **Invia adesso** manda subito un segnale, senza aspettare i 5 minuti.

**Cosa contiene il prossimo segnale** (o «Cosa conterrebbe il segnale» se il collegamento non è pronto): il
contenuto esatto, letto in quel momento: cliente e nodo, versione, moduli accesi, salute di ciascuno, porte aperte,
ultimo errore e, se il livello lo prevede, i numeri dell'inventario.

**Dati verso DA-Vul-can (AD Health, inventario e scansioni interne)**: i risultati dei controlli di Active
Directory dopo ogni esecuzione, un inventario al giorno (indirizzo, rete, sistema, porte) e i rilievi delle
scansioni interne. Mai credenziali, note, utenti, licenze. Le righe dicono **Stato**, **Destinazione**, **Ultimo
battito**, **Coda** (quanti invii aspettano e quanti sono falliti), **Ultimo AD Health**, **Ultimo inventario**,
**Ultimo errore**. **Invia ora** fa partire subito l'invio e rimette in attesa quelli falliti.

**Altri flussi verso Domarc**: i servizi che il cliente ha chiesto, che si fermano spegnendo il loro modulo:
**Scanner-Edge → da-vulcan** (i risultati delle scansioni di vulnerabilità) e **Proxy Zabbix → DA-ZABBIX** (i dati
del monitoraggio), ognuno con **Acceso**, **Spento**, **Presente**, **Non rilevato su questa macchina** o **Non so**.

**Registro delle scelte**: ogni cambio di livello, con chi e quando (gli ultimi 20).

## Come si usa

1. Per sapere che cosa parte, leggi **Cosa contiene il prossimo segnale**.
2. Per mandare meno: cambia il livello da Opzioni, poi aspetta che la riga **Cancellazione a Domarc** diventi
   **Confermata**.
3. Per controllare che il collegamento funzioni: **Invia adesso** e guarda **Ultimo invio**.

## Cosa vogliono dire i segni

- Verde con bordo pieno e **✓**: funziona. Ambra con bordo tratteggiato: in attesa o limitato. Rosso pieno: errore.
  Bianco con bordo grigio: spento o non si sa.

## Da dove arrivano i dati

Dalla configurazione dell'istanza e dai registri degli invii. L'anteprima è calcolata in quel momento con il
livello salvato.

## Se la pagina è vuota

«Nessun cliente unico su questa istanza» nell'anteprima vuol dire che DA-Link non è ancora configurato. «Nessuna
scelta registrata» nel registro è normale su un'installazione nuova.
