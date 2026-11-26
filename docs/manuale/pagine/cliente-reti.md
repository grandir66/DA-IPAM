---
percorso: /cliente/reti
titolo: Reti — vista cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra le **tue reti** e, per la rete scelta, la mappa di tutti i suoi indirizzi: quali sono usati da un apparato
acceso, quali da uno spento, quali sono liberi. È una pagina della [vista cliente](pagine/cliente.md), in sola lettura.
Si apre dal riquadro **Reti** della pagina iniziale o dai collegamenti **Reti →** dei grafici. In alto, **← La tua
rete** torna alla [pagina iniziale](pagine/cliente.md).

![La pagina Reti della vista cliente](/manuale/cliente-reti/pagina.png)

## Le reti (a sinistra)

Il titolo dice quante reti ci sono. Ogni riga ha il nome, il segno della **VLAN** se c'è e quanti indirizzi sono usati
su quanti («17 su 254»). Un clic sceglie la rete; quella scelta ha il fondo azzurro.

**Viste sul cavo, non censite** (se ci sono): reti che la sonda sente passare sul cavo ma che nessuno ha dichiarato, con
la VLAN (o «senza VLAN») e quanti indirizzi ci ha visto. Vale la pena chiedere al tuo referente tecnico che cosa sono.

## La griglia degli indirizzi (a destra)

In cima il nome e l'indirizzo della rete scelta, poi la legenda e la griglia: un quadretto per ogni indirizzo. Un clic su
un quadretto usato apre sotto la scheda dell'apparato che ha quell'indirizzo: nome, stato (`icona:circle-check` acceso,
`icona:circle-off` spento, `icona:eye-off` non si vede da più di 7 giorni), **Cos'è**, **Visto l'ultima volta**,
**Collegato a**, **Porte aperte**.

## Come si fa

- **Sapere quanto è piena una rete**: leggi «17 su 254» accanto al suo nome.
- **Trovare un indirizzo libero da dare a una stampante**: scegli la rete e cerca un quadretto tratteggiato.
- **Sapere chi usa un indirizzo**: clic sul quadretto e leggi la scheda sotto.
- **Vedere gli apparati che non si vedono da giorni**: cerca i quadretti azzurro chiaro.
- **Una rete compare fra le Viste sul cavo, non censite**: segnalala al tuo referente tecnico.

## Cosa vogliono dire i segni

La legenda sopra la griglia:

- **acceso** (quadretto scuro pieno): l'apparato risponde.
- **spento** (azzurro): l'apparato c'è ma non risponde.
- **non si vede da più di 7 giorni** (azzurro chiaro): l'indirizzo era usato ma da una settimana non si vede.
- **libero** (contorno tratteggiato): nessuno lo usa.

## Da dove arrivano i dati

Dai controlli delle tue reti fatti da DA-IPAM e, per le reti non censite, dalla sonda che ascolta il traffico sul cavo.

## Se la pagina è vuota

«Nessuna rete dichiarata» vuol dire che non è ancora stata inserita nessuna rete. «Dato non disponibile» vuol dire che
quella parte non si è potuta leggere: riprova più tardi. Se la pagina ti riporta alla pagina iniziale, questo servizio
non è attivo per te.
