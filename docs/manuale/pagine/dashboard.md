---
percorso: /
titolo: Dashboard — lo stato dell'istanza in una schermata
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la prima pagina che si apre dopo l'accesso. Dice in una sola schermata **come sta la rete dell'istanza**: quanti
host rispondono, quante cose ci sono da sistemare e in quali reti, chi è sparito, chi ha sbagliato la password, quali
moduli funzionano. Non si modifica niente da qui: ogni riquadro è una porta verso la pagina che ne sa di più, e un clic
sul numero o sul titolo ci porta. Si arriva da **Dashboard** in cima al menu.

![La Dashboard](/manuale/dashboard/pagina.png)

## Le voci della pagina

1. **La fila dei numeri** in cima:
   - **Health**: la percentuale di host che rispondono, con l'anello che si riempie. Conta gli host online sul totale
     di quelli visti negli ultimi giorni: chi è assente da più di una settimana non abbassa il numero. Verde va bene,
     giallo e rosso vogliono dire che molti host non rispondono.
   - **Subnet**: quante reti sono configurate. Un clic apre [Subnet](pagine/networks.md).
   - **Host**: quanti indirizzi conosce DA-IPAM. Un clic apre l'elenco degli [Apparati](pagine/discovery.md).
   - **Offline**: host che non rispondono ma sono stati visti negli ultimi giorni. Sono quelli da guardare.
   - **Assenti > 7 g**: host spenti da più di sette giorni. Sono fuori dal conto della salute.
   - **Archiviati**: host tolti dalla pulizia automatica. Si recuperano per 90 giorni.
   - **Monitorati**: quanti host tenuti d'occhio rispondono sul totale, con la latenza media. Compare solo se c'è
     almeno un host monitorato.
2. **Le carte della sicurezza**: **Critiche da sistemare** e **Alte da sistemare** (vulnerabilità e rilievi, contati
   come nella pagina Findings), **Accessi falliti 24h** (con la freccia che dice se sono più o meno del giorno prima),
   **Account bloccati 30g**, **Alert da gestire** (gli alert di Wazuh non ancora presi in carico) e **Health AD**
   (l'ultimo controllo di Active Directory e da quanti giorni è stato fatto). Il bordo a sinistra dice il tono: rosso
   è un guasto, giallo un'attenzione, grigio vuol dire che il modulo che porta quel dato non è configurato. Un clic
   apre la pagina del dato.
3. **Cose da sistemare per rete**: una barra per ogni rete con i problemi divisi per gravità, dal rosso scuro
   (critica) al giallo (media). Il numero a destra è il totale della rete. Un clic sul nome della rete apre le
   vulnerabilità.
4. **Stato host nel tempo**: il grafico di online, offline e sconosciuti nelle ultime **24h**, **7d** o **30d** (i tre
   pulsanti cambiano il periodo). La linea tratteggiata azzurra è la percentuale di disponibilità, sulla scala a destra.
5. **Host conosciuti offline**: gli host segnati come «da tenere d'occhio» che oggi non rispondono, con da quanto
   tempo. Un clic su una riga apre la [scheda dell'host](pagine/objects-id.md). Se non c'è nessun host monitorato, il
   riquadro dice come segnarne.
6. **Transizioni recenti**: gli ultimi host passati da online a offline o al contrario, col tempo trascorso.
7. **Accessi falliti**: l'istogramma dei login sbagliati su Windows e Linux raccolti da Wazuh, ora per ora nelle
   **24 ore** o giorno per giorno nei **14 giorni**. «picco» dice l'ora peggiore. **Alert →** apre la pagina degli
   alert di sicurezza.
8. **Moduli**: una casella per ogni modulo collegato (Scanner-Edge, Wazuh, LibreNMS, Zabbix, Active Directory…).
   Verde con la spunta vuol dire che ha risposto, e sotto c'è quando; grigio col pallino vuol dire che non è mai stato
   verificato. La riga in fondo elenca i moduli non configurati e porta alle impostazioni dei moduli.

Il riquadro **Subnet** a destra mostra le reti con la barra online/offline e i conteggi (online / offline (totale));
**Vedi tutte →** apre [Subnet](pagine/networks.md).

Chi ha il ruolo di amministratore vede in cima anche tre pulsanti: **Vista cliente** (la stessa dashboard come la vede
il cliente), **Configurazione guidata** e **Pulizia host**, che portano alle loro carte in Config › Sistema.

## Come si usa

1. A colpo d'occhio: se **Health** è verde e le carte della sicurezza non sono rosse, la rete sta bene.
2. Se un numero è rosso o giallo, cliccalo: si apre la pagina con l'elenco che lo spiega.
3. Per capire se un calo è recente guarda **Stato host nel tempo** e cambia periodo con **7d** o **30d**.
4. Se un modulo è grigio, i numeri che porta non sono aggiornati: controllalo dalle impostazioni dei moduli.

## Cosa vogliono dire i segni

- Bordo **rosso** con la ✕: c'è un guasto o qualcosa di critico. Bordo **giallo** col triangolo: da guardare.
  Bordo **grigio**: il modulo non è configurato.
- Le tacche colorate della legenda (Critica, Alta, Media, Bassa) hanno altezze diverse: si distinguono anche senza
  guardare il colore.
- Nei moduli: **✓** ha risposto, **●** non verificato.

## Da dove arrivano i dati

Host e stati dalle scansioni delle reti; vulnerabilità dallo Scanner-Edge e dagli agenti; accessi falliti, account
bloccati e alert da Wazuh e dai server di dominio; Health AD dal controllo di Active Directory. La pagina si ricalcola
a ogni apertura.

## Se la pagina è vuota

Senza reti configurate i numeri sono a zero: il riquadro Subnet porta ad aggiungere la prima rete. Le carte grigie
diventano vere quando si configura il modulo che le alimenta.
