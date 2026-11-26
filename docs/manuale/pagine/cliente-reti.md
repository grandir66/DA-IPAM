---
percorso: /cliente/reti
titolo: Reti — vista cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra le **reti del cliente** e, per la rete scelta, la mappa di tutti i suoi indirizzi: quali sono usati da un
apparato acceso, quali da uno spento, quali sono liberi. È una pagina della [vista cliente](pagine/cliente.md), in sola
lettura; la vedono gli utenti con il ruolo Cliente e gli amministratori. Si apre dal riquadro **Reti** della pagina
iniziale o dai collegamenti **Reti →** dei grafici.

![La pagina Reti della vista cliente](/manuale/cliente-reti/pagina.png)

## Le voci della pagina

1. **← La tua rete**: torna alla [pagina iniziale](pagine/cliente.md).

**Le reti**: l'elenco delle reti, con il numero accanto al titolo. Ogni riga ha il nome, il segno della **VLAN** se c'è e
quanti indirizzi sono usati su quanti («17 su 254»). Un clic sceglie la rete; quella scelta ha il fondo azzurro.

**Viste sul cavo, non censite** (se ci sono): reti che la sonda sente passare sul cavo ma che nessuno ha dichiarato in
DA-IPAM, con la VLAN e quanti indirizzi ci ha visto.

**A destra**, il nome e l'indirizzo della rete scelta e la **griglia degli indirizzi**: un quadretto per ogni indirizzo.
Un clic su un quadretto usato apre sotto la scheda dell'apparato che ha quell'indirizzo (nome, tipo, produttore, quando
è stato visto).

## Come si usa

1. Scegli la rete nell'elenco a sinistra.
2. Guarda la griglia: i quadretti pieni sono gli apparati.
3. Clicca un quadretto per sapere quale apparato usa quell'indirizzo.

## Cosa vogliono dire i segni

La legenda sopra la griglia:

- **acceso** (quadretto scuro pieno): l'apparato risponde.
- **spento** (azzurro): l'apparato c'è ma non risponde.
- **non si vede da più di 7 giorni** (azzurro chiaro): l'indirizzo era usato ma da una settimana non si vede.
- **libero** (contorno tratteggiato): nessuno lo usa.

## Da dove arrivano i dati

Dalle scansioni delle reti di DA-IPAM e, per le reti non censite, dalla sonda che ascolta il traffico sul cavo.

## Se la pagina è vuota

«Nessuna rete dichiarata» vuol dire che per questo cliente non è ancora stata inserita nessuna rete. «Dato non
disponibile» vuol dire che quella parte non si è potuta leggere: riprova più tardi.
