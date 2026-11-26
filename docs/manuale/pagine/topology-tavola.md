---
percorso: /topology/tavola
titolo: Tavola di cablaggio — le porte degli apparati e i cavi fra loro
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Disegna gli apparati di rete **come sono davanti all'armadio**: per ogni router e switch la fila delle sue porte, e
fra una porta e l'altra il cavo che le collega. Serve quando si mette mano al cablaggio: dice quale porta è libera,
dove va un cavo, quali porte hanno qualcosa di strano. Si arriva da **Network › Topologia**, scheda **Tavola di
cablaggio** in cima.

![La tavola di cablaggio](/manuale/topology-tavola/pagina.png)

## Le voci della pagina

1. **Sede**: sceglie la sede di cui disegnare gli apparati. **Senza sede** raccoglie quelli a cui non è ancora stata
   assegnata una sede (si assegna dalla scheda dell'apparato).
2. **I numeri** della sede: quanti **apparati**, quante **VM**, quanti **cavi**, quante **porte libere** e, nel
   riquadro rosso col punto esclamativo, quante porte sono **da verificare**.
3. **Mostra porte libere**: spenta, le porte vuote spariscono e la tavola si accorcia; un apparato senza porte usate
   si nasconde.
4. **Trova porta o apparato**: scrivi il nome di un apparato o di una porta e la tavola ci va.
5. **La legenda** spiega ogni tipo di porta e di linea (vedi sotto).

Ogni riquadro è un apparato: il nome, il tipo e l'indirizzo, poi le porte numerate come sull'apparato (**S1**, **S2**
sono le porte in fibra SFP). Sotto le porte usate c'è scritto cosa c'è attaccato: il nome dell'altro apparato e la
sua porta, oppure quanti MAC si vedono (per esempio «58 MAC»).

Un clic su una porta o su un cavo apre a destra il riquadro **Porta** o **Collegamento**: stato, velocità, chi c'è
attaccato (nome e indirizzo), da dove lo si sa, e i pulsanti **Vai alla porta** dell'altro capo e **Apri la scheda**
dell'apparato. Per correggere un cavo il riquadro rimanda alla [Topologia](pagine/topology.md).

## Cosa vogliono dire i segni

Si distinguono per forma e tipo di linea, non solo per colore:

- quadratino **pieno scuro** e linea continua scura: **Linea / fuori sede**, la porta verso l'esterno o verso un'altra
  sede;
- quadratino **col doppio bordo** e linea continua azzurra: **Fra apparati di rete** (switch con switch, router con
  switch);
- quadratino **pieno chiaro** e linea a trattini lunghi: **Server / hypervisor**;
- quadratino **vuoto** e linea a trattini: **Un client** (un PC, un telefono);
- quadratino **a righe** e linea a trattini: **Più MAC** sulla stessa porta (di solito un piccolo switch o un telefono
  con il PC dietro);
- quadratino **grigio** e puntini: **Senza dati**;
- quadratino **tratteggiato**: **Libera / giù**;
- porta con il **bordo rosso e il punto esclamativo**: **Da verificare**, cioè non vista di recente, porte diverse fra
  le fonti o porta giù.

## Come si usa

1. Scegli la sede in **Sede**.
2. Per trovare una porta libera lascia **Mostra porte libere** acceso e cerca i quadratini tratteggiati.
3. Per sapere dove va un cavo clicca la porta: il riquadro a destra dice cosa c'è all'altro capo.
4. Guarda le porte col punto esclamativo: sono quelle da controllare sul posto.

## Da dove arrivano i dati

Dagli stessi collegamenti della [Topologia](pagine/topology.md) (LLDP, CDP, controller UniFi, tabelle MAC) e dalle
porte lette dagli apparati gestiti.

## Se la pagina è vuota

«Nessun apparato nella mappa»: servono apparati gestiti con i loro collegamenti. «Nessun apparato in questa sede»: gli
apparati si assegnano alla sede dalla loro scheda, oppure scegli **Senza sede**.
