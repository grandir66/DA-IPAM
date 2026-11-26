---
percorso: /networks/[id]
titolo: Pagina di una subnet — host, scansioni e categorie di una rete
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **tutto quello che c'è in una rete**: ogni indirizzo visto, se risponde, che cosa è, se ha credenziali, se è in
Active Directory o nel DNS. Da qui si lanciano le scansioni di quella rete, si assegnano le categorie agli host e si
promuovono gli host ad apparati gestiti. Si arriva da [Subnet](pagine/networks.md) con un clic sulla riga della rete.

![La pagina di una subnet](/manuale/networks-id/pagina.png)

## La testata

In cima ci sono il **nome della rete**, il suo indirizzo e una riga di numeri: quanti host, quanti ● online, quanti
○ offline, il gateway (**GW**), il router da cui si legge l'ARP, il DNS. La freccia a sinistra torna all'elenco
delle subnet.

A destra:

- **Network Changes**: apre i [Cambiamenti](pagine/network-changes.md).
- **CSV**: scarica l'elenco degli host della rete. Lo può scaricare solo un amministratore.
- **Modifica**: apre la finestra **Modifica Rete**, con gli stessi campi della creazione (indirizzo, nome, gateway,
  VLAN, posizione, DNS, community SNMP, router ARP). La community SNMP la vedono solo gli amministratori.

## Le voci della pagina

1. **Scoperta host**: trova gli host accesi su tutta la rete. Usa Naabu se è installato, altrimenti ping e una
   scansione nmap veloce. Passando il mouse si legge quando è stata fatta l'ultima volta.
2. **Avanzata**: porte e servizi (nmap completo) e poi lettura SNMP. Se ci sono righe spuntate lavora solo su quelle
   («Avanzata · 3 host»). La freccia accanto apre le **fasi singole**: sugli host selezionati **Porte e servizi** o
   **SNMP** (modello, firmware, seriale); su tutta la subnet **Porte e servizi**, **SNMP** ed **Enrich (ARP/DHCP/AD)**,
   che completa i dati da router, DHCP e Active Directory.
3. **Profilo**: una scansione più profonda sugli host spuntati. **Approfondito** legge sistema operativo, certificati,
   NetBIOS e chiavi SSH; **IoT / OT** prova i protocolli degli impianti (Modbus, S7, EtherNet/IP, BACnet, MQTT). È
   spento finché non si spunta almeno una riga.
4. **Accesso agli host**: entra negli host con le credenziali della rete, WinRM sui Windows e SSH sui Linux, per
   leggere sistema, software e patch. Con righe spuntate diventa «Accedi a N host».
5. **Attribuzione**: quanti host hanno una categoria precisa sul totale (per esempio 30/35). Un clic apre
   [Attribuzione](pagine/controllo-classificazione.md) con la sola rete.
6. **Scansione periodica**: apre la pianificazione dei giri automatici su questa rete.
7. **VA Scan**: la scansione delle vulnerabilità dallo Scanner-Edge, da avviare subito o pianificare. Il segno
   **Sched. attiva** vuol dire che c'è un giro pianificato.
8. **Filtri**: apre il pannello dei filtri: **Stato** (Tutti, Online, Offline, Sconosciuto), **Classificazione**,
   **Sistema**, **Produttore**, **Fisico o virtuale**, **Funzione**, e le spunte **Solo conosciuti**, **Solo gli
   apparati**, **Solo quelli in Active Directory**, **Solo con indirizzo da DHCP**. **Mostra N righe** chiude il
   pannello, **Togli tutti** azzera. I filtri attivi restano in vista sotto la barra, con la ✕ per toglierli.
   Accanto, **Aggiorna** sceglie ogni quanto la pagina si ricarica da sola (mai, 30 secondi, 1, 2 o 5 minuti).
9. **Lista** e **Griglia IP**: due modi di vedere la rete. La lista è la tabella; la **Mappa degli Indirizzi IP**
   disegna una casella per ogni indirizzo, colorata e con il segno per online, offline, sconosciuto, gateway e libero:
   serve a trovare un indirizzo libero a colpo d'occhio.
10. **Le categorie** (Tutte, Telefonia, Server, Archiviazione, Rete, Videosorveglianza, OT, Senza categoria…): un
    clic mostra solo quella categoria; dopo la scelta compaiono le classi della categoria per restringere ancora.

## Le colonne della lista

- **Dettagli**: la freccia apre la [scheda dell'host](pagine/objects-id.md).
- **IP**, con il MAC sotto. **Stato**: Online o Offline, con l'ora dell'ultima risposta.
- **Cred.**: le credenziali che hanno funzionato (SSH, SNMP, WinRM…). Il segno giallo **senza cred. provata** vuol
  dire che l'host potrebbe essere letto ma nessuna credenziale è stata provata con successo.
- **Conosciuto**: l'interruttore che segna l'host come noto, cioè da tenere d'occhio: se si spegne compare fra gli
  host conosciuti offline della [Dashboard](pagine/dashboard.md).
- **DHCP**: **STAT** se l'indirizzo è un'assegnazione fissa, **DYN** se viene dal DHCP.
- **AD**: l'host è in Active Directory.
- **DNS**: com'è nel DNS di Active Directory: **✓** c'è, **∅** manca, **≠** il nome è diverso.
- **Nome**, **Categoria** (che cos'è e da dove lo si sa: «a mano» con il lucchetto vuol dire scelta da una persona,
  altrimenti la percentuale di sicurezza e la fonte, per esempio «dalle porte»), **Funzioni** (che cosa fa: «+
  Funzioni» le aggiunge a mano), **App.** (è un apparato gestito: il segno apre la sua scheda), **Note**, **Porte**.

Un clic sulla cella **Categoria** apre la scelta della categoria. Il **tasto destro** su una cella apre **Mostra solo
questo valore**, **Nascondi questo valore** e **Copia il valore**: i filtri scelti così restano in vista sopra
l'elenco («Filtri dal tasto destro»).

## Le azioni sulle righe spuntate

Spuntando le caselle a sinistra compare la barra «N righe spuntate» con **Rendi apparato** (registra gli host come
apparati gestiti), **Assegna categoria a N…**, **Conosciuti** (li segna da tenere d'occhio), **Rimuovi noti** ed
**Elimina**. La ✕ toglie la spunta a tutte. Queste azioni e le scansioni spettano a chi ha il ruolo di amministratore.

## Come si usa

1. Per sapere chi c'è in rete guarda la lista; per trovare un indirizzo libero passa a **Griglia IP**.
2. Dopo aver aggiunto la rete lancia **Scoperta host**, poi **Avanzata** per porte e modelli.
3. Per correggere le categorie usa la cella **Categoria** o spunta più righe e premi **Assegna categoria**.
4. Per tenere d'occhio un server accendi **Conosciuto** sulla sua riga.

## Da dove arrivano i dati

Dalle scansioni della rete (ping, nmap, SNMP), dalla tabella ARP del router indicato, dal DHCP, da Active Directory e
dal suo DNS, dagli accessi WinRM e SSH.

## Se la pagina è vuota

Una rete appena aggiunta è vuota fino al primo giro: premi **Scoperta host**. Se ci sono filtri attivi, premi **Togli
tutti**.
