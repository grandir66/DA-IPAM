---
percorso: /
titolo: Dashboard — lo stato dell'istanza in una schermata
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la prima pagina che si apre dopo l'accesso. Dice in una sola schermata **come sta la rete dell'istanza**: quanti
host rispondono, quante cose ci sono da sistemare e in quali reti, chi è sparito, chi ha sbagliato la password, quali
moduli funzionano. Non si modifica niente da qui: ogni riquadro è una porta verso la pagina che ne sa di più, e un clic
sul numero o sul titolo ci porta. Si arriva da `icona:dashboard` **Dashboard** in cima al menu.

Il menu funziona come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

Un **amministratore** vede in cima anche tre pulsanti: `tasto:eye` **Vista cliente** (la stessa dashboard come la vede
il cliente), `tasto:wand` **Configurazione guidata** e `tasto:eraser` **Pulizia host**, che portano alle loro carte in
[Impostazioni › Sistema](pagine/settings.md).

## La fila dei numeri

![La fila dei numeri](/manuale/dashboard/indicatori.png)

- **Health**: la percentuale di host che rispondono, con l'anello che si riempie. Conta gli host online sul totale di
  quelli visti negli ultimi giorni: chi è assente da più di una settimana non abbassa il numero. Passa il mouse per il
  conto esatto.
- **Subnet**: quante reti sono configurate. Un clic apre [Subnet](pagine/networks.md).
- **Host**: quanti indirizzi conosce DA-IPAM. Un clic apre gli [Apparati](pagine/discovery.md).
- **Offline**: host che non rispondono ma sono stati visti negli ultimi giorni. Sono quelli da guardare.
- **Assenti > 7 g**: host spenti da più di sette giorni. Sono fuori dal conto della salute.
- **Archiviati**: host tolti dalla pulizia automatica. Si recuperano per 90 giorni.
- **Monitorati**: quanti host tenuti d'occhio rispondono sul totale, con la latenza media. Compare solo se c'è almeno
  un host monitorato; un clic apre [Monitoraggio host conosciuti](pagine/monitoring-known-hosts.md).

## Le carte della sicurezza

![Le carte della sicurezza](/manuale/dashboard/sicurezza.png)

- **Critiche da sistemare** e **Alte da sistemare**: vulnerabilità e rilievi, un software o un rilievo per host,
  contati come nella pagina [Vulnerabilità](pagine/vulnerabilities.md); sotto, in quante reti.
- **Accessi falliti 24h**: i login sbagliati dell'ultimo giorno, con la freccia che dice se sono più o meno del giorno
  prima.
- **Account bloccati 30g**: gli account del dominio bloccati nell'ultimo mese.
- **Alert da gestire**: gli alert di Wazuh non ancora presi in carico ([Alert di sicurezza](pagine/security-alerts.md)).
- **Health AD**: l'ultimo controllo di Active Directory, quanti problemi critici e alti ha trovato e da quanti giorni
  è stato fatto (oltre 7 giorni è da rifare); «mai eseguita» se non c'è ancora. Apre
  [Sicurezza del dominio](pagine/sicurezza-dominio.md).

Il bordo a sinistra e il segno dicono il tono: ✕ rosso è un guasto o qualcosa di critico, ▲ giallo un'attenzione,
grigio vuol dire che il modulo che porta quel dato non è configurato. Passa il mouse su una carta per la spiegazione.

## Cose da sistemare per rete

![Cose da sistemare per rete](/manuale/dashboard/per-rete.png)

Una barra per ogni rete con i problemi divisi per gravità, dal rosso scuro (critica) al giallo (media). Il numero a
destra è il totale della rete. In alto a destra la legenda: **Critica**, **Alta**, **Media**, **Bassa**, con le tacche
di altezza diversa. Un clic sul nome della rete apre le vulnerabilità.

## Stato host nel tempo

![Stato host nel tempo](/manuale/dashboard/stato-tempo.png)

Il grafico di **Online**, **Offline** (a righe) e **Sconosciuti** nelle ultime **24h**, **7d** o **30d**: i tre
pulsanti cambiano il periodo. Accanto, i numeri di adesso e l'**Uptime** del periodo. La linea tratteggiata azzurra è
la percentuale di disponibilità, sulla scala a destra. Passa il mouse sul grafico per i valori di un'ora.

## Accessi falliti

![Accessi falliti](/manuale/dashboard/accessi.png)

L'istogramma dei login sbagliati su Windows e Linux raccolti da Wazuh (esclusi i nostri account e le nostre reti), ora
per ora nelle **24 ore** o giorno per giorno nei **14 giorni**. «picco» dice l'ora peggiore, la linea tratteggiata la
media. **Alert →** apre gli [Alert di sicurezza](pagine/security-alerts.md).

## Gli altri riquadri

- **Host conosciuti offline**: gli host segnati come «da tenere d'occhio» che oggi non rispondono, con da quanto tempo.
  Un clic su una riga apre la [scheda dell'host](pagine/objects-id.md). Se non c'è nessun host monitorato, il riquadro
  porta a «Segna gli host da tenere d'occhio».
- **Transizioni recenti**: gli ultimi host passati da online a offline o al contrario, col tempo trascorso.
- **Subnet**: le reti con la barra online/offline e i conteggi (online / offline (totale)); **Vedi tutte →** apre
  [Subnet](pagine/networks.md).

## Moduli

![Il riquadro Moduli](/manuale/dashboard/moduli.png)

Una casella per ogni modulo collegato (Scanner-Edge, Wazuh, LibreNMS, Zabbix, Active Directory, controller UniFi…).
**✓** su verde vuol dire che ha risposto, e sotto c'è quando; **●** su grigio che non è mai stato verificato. Accanto
al titolo, quanti moduli sono **in errore** e quanti **da verificare**. La riga in fondo elenca i moduli non
configurati e porta alle impostazioni dei moduli.

## Come si fa

- **Il colpo d'occhio del mattino**: se **Health** è verde e le carte della sicurezza non hanno la ✕ rossa, la rete sta
  bene.
- **Capire un numero rosso o giallo**: cliccalo, si apre la pagina con l'elenco che lo spiega.
- **Capire se un calo è recente**: guarda **Stato host nel tempo** e passa a **7d** o **30d**.
- **Un modulo è grigio**: i numeri che porta non sono aggiornati; controllalo da Impostazioni › Moduli.
- **Mostrare al cliente cosa vede lui**: un amministratore preme `tasto:eye` **Vista cliente**.

## Cosa vogliono dire i segni

- Bordo **rosso** con la ✕: c'è un guasto o qualcosa di critico. Bordo **giallo** col ▲: da guardare. Bordo
  **grigio**: il modulo non è configurato.
- Le tacche della legenda (Critica, Alta, Media, Bassa) hanno altezze diverse: si distinguono anche senza guardare il
  colore.
- Nei moduli: **✓** ha risposto, **●** non verificato.

## Da dove arrivano i dati

Host e stati dalle scansioni delle reti; vulnerabilità dallo Scanner-Edge e dagli agenti; accessi falliti, account
bloccati e alert da Wazuh e dai server di dominio; Health AD dal controllo di Active Directory. La pagina si ricalcola
a ogni apertura.

## Se la pagina è vuota

Senza reti configurate i numeri sono a zero: il riquadro Subnet porta ad aggiungere la prima rete («Aggiungi la prima
rete →»). Le carte grigie diventano vere quando si configura il modulo che le alimenta.
