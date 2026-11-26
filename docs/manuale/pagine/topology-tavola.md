---
percorso: /topology/tavola
titolo: Tavola di cablaggio — le porte degli apparati e i cavi fra loro
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Disegna gli apparati di rete **come sono davanti all'armadio**: per ogni router e switch la fila delle sue porte, e
fra una porta e l'altra il cavo che le collega. Serve quando si mette mano al cablaggio: dice quale porta è libera,
dove va un cavo, quali porte hanno qualcosa di strano. La pagina è tutta in lettura: i cavi si correggono nella
[Topologia](pagine/topology.md).

Si arriva da **Network › Topologia**, scheda **Tavola di cablaggio** in cima (le altre schede:
[Mappa](pagine/topology.md), [Porte](pagine/port-map.md), [Tabella ARP](pagine/arp-table.md),
[Dati della mappa](pagine/topology-dati.md)). Menu e schede funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in cima

![La barra della tavola](/manuale/topology-tavola/barra.png)

1. **Sede**: sceglie la sede di cui disegnare gli apparati. **Senza sede** raccoglie quelli a cui non è ancora stata
   assegnata una sede (si assegna dalla scheda dell'apparato).
2. **I numeri** della sede: quanti **apparati**, quante **VM**, quanti **cavi**, quante **porte libere** e, nel
   riquadro rosso col punto esclamativo, quante porte sono **da verificare**.
3. **Mostra porte libere**: spenta, le porte vuote spariscono e la tavola si accorcia; un apparato senza porte usate
   si nasconde.
4. **Trova porta o apparato**: scrivi il nome di un apparato o di una porta e la tavola ci va, illuminando quello che
   corrisponde. Con più risultati, `icona:chevron-left` `icona:chevron-right` passano al precedente e al successivo.

## La legenda

![La legenda della tavola](/manuale/topology-tavola/legenda.png)

Sotto la barra, un quadratino per tipo di porta con la sua linea. Si distinguono per forma e tipo di linea, non solo
per colore:

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

## Un apparato

![Un apparato sulla tavola](/manuale/topology-tavola/apparato.png)

Ogni riquadro è un apparato: il nome, il tipo e l'indirizzo, poi le porte numerate come sull'apparato (**S1**, **S2**
sono le porte in fibra SFP). Sotto le porte usate c'è scritto cosa c'è attaccato: il nome dell'altro apparato e la
sua porta, oppure quanti MAC si vedono (per esempio «58 MAC»). Sotto gli hypervisor c'è l'elenco delle loro macchine
virtuali; un nome in azzurro apre la sua scheda.

Passando il mouse su una porta o su un cavo, la tavola illumina il cavo e le due porte ai suoi capi.

## Il riquadro della porta o del collegamento

![Il riquadro Collegamento](/manuale/topology-tavola/porta.png)

Un clic su una porta o su un cavo apre a destra il riquadro **Porta** o **Collegamento**:

- i due capi del cavo, ognuno con `icona:locate-fixed` **Vai alla porta**, che porta la tavola su quella porta; un
  capo che non è sulla tavola ha **Apri la scheda**;
- la fonte (LLDP, controller, tabella MAC…), da quando è visto e la velocità;
- le prove, scritte per esteso (chi vede chi, su quale porta, quando) e quanto è sicuro il collegamento;
- **Per correggere questo cavo: Topologia**, il rimando alla mappa;
- sotto, per la porta scelta: **Tipo**, **Stato**, **Velocità** e cosa c'è attaccato.

`icona:x` **Chiudi** chiude il riquadro; un secondo clic sulla stessa porta anche.

## Come si fa

- **Trovare una porta libera su uno switch**: scegli la **Sede**, lascia **Mostra porte libere** acceso e cerca i
  quadratini tratteggiati sotto lo switch.
- **Sapere dove va un cavo**: clicca la porta; il riquadro a destra dice cosa c'è all'altro capo, e
  `icona:locate-fixed` porta lì.
- **Preparare un giro sul posto**: guarda le porte col punto esclamativo (il numero **da verificare** dice quante
  sono) e aprile una per una per leggere il motivo.
- **Trovare dove è attaccato un server**: scrivi il suo nome in **Trova porta o apparato**.
- **Stampare la tavola di un armadio senza le porte vuote**: spegni **Mostra porte libere**, poi stampa dal browser.

## Da dove arrivano i dati

Dagli stessi collegamenti della [Topologia](pagine/topology.md) (LLDP, CDP, controller UniFi, tabelle MAC) e dalle
porte lette dagli apparati gestiti.

## Se la pagina è vuota

«Nessun apparato nella mappa»: servono apparati gestiti con i loro collegamenti. «Nessun apparato in questa sede»: gli
apparati si assegnano alla sede dalla loro scheda, oppure scegli **Senza sede**.
