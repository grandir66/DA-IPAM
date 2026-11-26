---
percorso: /estrazione-apparati
titolo: Estrazione apparati — il prompt per leggere uno switch o un router con Claude Code
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Questa pagina esiste **solo sull'installazione «tecnico»**, quella che il tecnico usa sul proprio PC. Sulle altre
installazioni l'indirizzo risponde «pagina non trovata» e la voce non compare nel menu.

Contiene un **prompt pronto** da incollare in Claude Code sullo stesso PC. Con quel prompt Claude Code si collega a
**uno switch o un router**, lo legge **in sola lettura** (SSH, SNMP o web/API) e scrive un file JSON con tutto quello
che è riuscito a leggere: identità, porte, VLAN, vicini, tabelle MAC e ARP, rotte. Il file si importa poi in DA-IPAM.
Serve per gli apparati che DA-IPAM non sa ancora leggere da solo. Si arriva dalla voce **Estrazione apparati** nella
parte alta del menu.

La pagina non ha una schermata in questa guida perché l'installazione da cui sono prese le schermate non è di tipo
«tecnico» (lì l'indirizzo dà «pagina non trovata»). Le parti comuni sono nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md). La pagina non ha differenze fra i ruoli: basta essere entrati.

## Le voci della pagina

- **Il titolo e la frase sotto**: dicono a cosa serve il prompt.
- `tasto:copy` **Copia**, in alto a destra: copia tutto il prompt negli appunti. Diventa `icona:check` «Copiato» per un momento. Se la copia non
  riesce, il messaggio chiede di selezionare il testo e copiarlo a mano.
- **Prompt**: il testo intero, da leggere prima di usarlo. Sotto il titolo del riquadro c'è il file da cui è letto
  nell'installazione. Il prompt spiega a Claude Code le fasi: riconoscere l'apparato senza credenziali, cercare la
  documentazione ufficiale (senza mai scrivere nelle ricerche indirizzi, nomi o dati del cliente), chiedere le
  credenziali di sola lettura, leggere e scrivere il JSON nel formato che DA-IPAM importa.

## Come si fa

- **Leggere uno switch che DA-IPAM non conosce**: premi `tasto:copy` **Copia**, apri Claude Code sul PC del tecnico, incolla il
  prompt, dai l'indirizzo dell'apparato (e produttore e modello se li sai) e rispondi alle sue domande; le
  credenziali devono essere di sola lettura.
- **Portare il risultato in DA-IPAM**: quando il JSON è pronto, apri la [scheda dell'apparato](pagine/objects-id.md)
  e importalo con **Importa estrazione**.
- **Controllare che cosa farà Claude Code prima di usarlo**: leggi il riquadro **Prompt**, che riporta le fasi una
  per una.
- **La copia non riesce**: seleziona a mano il testo del riquadro **Prompt** e copialo.

## Se la pagina è vuota

«Prompt non trovato» vuol dire che nell'installazione manca il file del prompt: va reinstallata o aggiornata.
