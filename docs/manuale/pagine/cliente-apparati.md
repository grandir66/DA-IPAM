---
percorso: /cliente/apparati
titolo: Apparati — vista cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **tuoi apparati divisi per tipo**: computer, server, macchine virtuali, apparati di rete, stampanti, telefoni,
cellulari e tablet, telecamere. Per ogni apparato vedi la scheda; per gli switch, le porte e cosa c'è collegato. È una
pagina della [vista cliente](pagine/cliente.md), in sola lettura. Si apre dal riquadro **Apparati** della pagina
iniziale o dai collegamenti **Apparati →** dei grafici. In alto, **← La tua rete** torna alla
[pagina iniziale](pagine/cliente.md).

![La pagina Apparati della vista cliente, tipo Rete](/manuale/cliente-apparati/pagina.png)

La pagina ha tre colonne: a sinistra scegli il tipo, al centro l'apparato, a destra leggi il dettaglio.

## Per tipo (a sinistra)

Il titolo dice quanti apparati hai in tutto. Sotto, i tipi con la loro icona e quanti sono: `icona:monitor` Computer,
`icona:server` Server, `icona:boxes` Macchine virtuali, `icona:network` Rete, `icona:printer` Stampanti, `icona:phone`
Telefoni, `icona:smartphone` Cellulari e tablet, `icona:camera` Telecamere e altro, `icona:circle-help` Non
riconosciuti. Compaiono solo i tipi che hanno almeno un apparato. Un clic sceglie il tipo; quello scelto ha il fondo
azzurro.

## L'elenco (al centro)

Gli apparati del tipo scelto («Rete · 40 apparati»): nome, tipo e produttore, indirizzo, e da quanto non si vede se è
spento. Il segno a sinistra dice se è acceso. Un clic su una riga apre il dettaglio a destra.

## Il dettaglio (a destra)

Finché non scegli niente il riquadro dice «Scegli un apparato per vedere i dettagli».

**Per un computer, un server, una stampante…** la scheda dice:

- nome e indirizzo;
- lo stato: `icona:circle-check` **acceso**, `icona:circle-off` **spento**, oppure `icona:eye-off` **non si vede da più
  di N giorni**;
- **Cos'è**, **Visto l'ultima volta**, **Collegato a** (lo switch e la porta a cui è attaccato), **Porte aperte**.

**Per uno switch** o un altro apparato di cui si leggono le porte: il pannello delle **porte**. Sotto, il conto di
quante sono collegate, libere, senza stato e dorsali, e la legenda:

- pieno: **collegata**, c'è qualcosa attaccato;
- vuoto: **libera**;
- tratteggiato: **senza stato**, la porta non è stata letta;
- contorno azzurro: **dorsale**, il collegamento verso un altro apparato di rete.

Un clic su una porta mostra il suo numero, verso cosa va e cosa c'è collegato.

## Come si fa

- **Trovare una stampante**: a sinistra `icona:printer` **Stampanti**, poi clicca la stampante.
- **Sapere a quale presa dello switch è attaccato un PC**: aprilo e leggi **Collegato a**.
- **Vedere se ci sono porte libere su uno switch**: `icona:network` **Rete**, scegli lo switch, conta le porte vuote.
- **Controllare un apparato che non risponde**: guarda lo stato nella scheda e **Visto l'ultima volta**.
- **Capire cosa sono gli apparati non riconosciuti**: `icona:circle-help` **Non riconosciuti**; se ne riconosci uno,
  dillo al tuo referente tecnico.

## Da dove arrivano i dati

Dalle scansioni delle tue reti e dalle letture degli apparati (per le porte degli switch). Il tipo viene dalla
classificazione di DA-IPAM: quelli che non è riuscita a classificare stanno in **Non riconosciuti**.

## Se la pagina è vuota

Se l'elenco dei tipi dice «Nessun apparato», non è ancora stato trovato nessun apparato: serve almeno una rete
controllata. Se la pagina ti riporta alla pagina iniziale, questo servizio non è attivo per te.
