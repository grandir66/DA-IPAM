---
percorso: /networks/[id]
titolo: Pagina di una subnet — host, scansioni e categorie di una rete
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **tutto quello che c'è in una rete**: ogni indirizzo visto, se risponde, che cosa è, se ha credenziali, se è in
Active Directory o nel DNS. Da qui si lanciano le scansioni di quella rete, si assegnano le categorie agli host e si
promuovono gli host ad apparati gestiti. Si arriva da [Subnet](pagine/networks.md) con un clic sulla riga della rete.

Menu, filtri, tabelle, tasto destro e selezione funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). Qui sotto c'è quello che la pagina della subnet ha di suo.

## La testata

![La testata della subnet](/manuale/networks-id/testata.png)

In cima ci sono `icona:arrow-left` (torna all'elenco delle subnet), il **nome della rete**, il suo indirizzo e una
riga di numeri: quanti host, quanti ● online, quanti ○ offline, il gateway (**GW**), il router da cui si legge l'ARP,
il DNS. A destra:

1. `tasto:external-link` **Network Changes**: apre i [Cambiamenti](pagine/network-changes.md).
2. `tasto:download` **CSV**: scarica l'elenco degli host della rete. Lo scarica solo un amministratore: per gli altri è
   spento.
3. `tasto:pencil` **Modifica**: apre **Modifica Rete**, con gli stessi campi della creazione (indirizzo, nome, gateway,
   descrizione, VLAN, posizione, DNS, community SNMP, router ARP). La community SNMP la vedono solo gli
   amministratori: gli altri leggono «Configurata: la leggono gli amministratori».

## Le scansioni

![I pulsanti delle scansioni](/manuale/networks-id/azioni.png)

1. `tasto:radar` **Scoperta host**: trova gli host accesi su tutta la rete. Usa Naabu se è installato, altrimenti
   ping e una scansione nmap veloce. Passando il mouse si legge quando è stata fatta l'ultima volta.
2. `tasto:scan` **Avanzata**: porte e servizi (nmap completo) e poi lettura SNMP. Se ci sono righe spuntate lavora
   solo su quelle («Avanzata · 3 host»). `icona:chevron-down` accanto apre le **fasi singole** (vedi sotto).
3. `tasto:microscope` **Profilo**: una scansione più profonda sugli host spuntati. **Approfondito** legge sistema
   operativo, certificati, NetBIOS e chiavi SSH; **IoT / OT** prova i protocolli degli impianti (Modbus, S7,
   EtherNet/IP, BACnet, MQTT). È spento finché non si spunta almeno una riga.
4. `tasto:key` **Accesso agli host**: entra negli host spuntati con le credenziali della rete, WinRM sui Windows e SSH
   sui Linux, per leggere sistema, software e patch. Spento finché non si spunta almeno una riga; con righe spuntate
   diventa «Accedi a N host».
5. `tasto:tags` **Attribuzione**: quanti host hanno una categoria precisa sul totale (per esempio 30/35). Un clic apre
   [Attribuzione](pagine/controllo-classificazione.md) con la sola rete.
6. **Scansione periodica**: apre la pianificazione della scansione veloce periodica di questa rete (ogni quanto
   ripeterla, sospenderla o toglierla).
7. **VA Scan**: la scansione delle vulnerabilità dallo Scanner-Edge, da avviare subito o pianificare. Il segno
   **Sched. attiva** vuol dire che c'è un giro pianificato.

Tutte le scansioni si vedono anche in sola lettura, ma le avvia solo un **amministratore**.

### Le fasi singole

![Le fasi singole di Avanzata](/manuale/networks-id/avanzata.png)

- **Sui N host selezionati** (se ci sono righe spuntate): **Porte e servizi** (nmap profilo completo) e **SNMP**
  (modello, firmware, seriale).
- **Su tutta la subnet**: **Porte e servizi**, **SNMP** ed **Enrich (ARP/DHCP/AD)**, che completa i dati da router,
  DHCP e Active Directory. Accanto a ogni fase, quando è stata fatta l'ultima volta; **obsoleta** vuol dire che è ora
  di rifarla.

## Filtri, viste e categorie

![Filtri, viste e categorie](/manuale/networks-id/filtri.png)

1. `tasto:filter` **Filtri**: apre a destra il pannello dei filtri: **Stato** (Tutti, Online, Offline, Sconosciuto),
   **Classificazione**, **Sistema**, **Produttore**, **Fisico o virtuale**, **Funzione**, e le spunte **Solo
   conosciuti**, **Solo gli apparati**, **Solo quelli in Active Directory**, **Solo con indirizzo da DHCP**. **Togli
   tutti** azzera. I filtri attivi restano in vista accanto al pulsante, ognuno con `icona:x`; accanto, quante righe
   restano («12 di 35 righe»).
2. **Aggiorna: mai**: ogni quanto la pagina si ricarica da sola (mai, 30 secondi, 1, 2 o 5 minuti). Con un intervallo
   scelto compare **Scoperta periodica**: a ogni ricarica rifà anche la scoperta degli host.
3. `icona:list` **Lista** e `icona:layout-grid` **Griglia IP**: due modi di vedere la rete (la griglia è sotto).

Accanto alle viste, **le categorie** (Tutte, Telefonia, Server, Archiviazione, Rete, Videosorveglianza, OT, Senza
categoria…), ognuna col suo numero: un clic mostra solo quella categoria; dopo la scelta compaiono le classi della
categoria per restringere ancora.

## La lista

![La lista degli host](/manuale/networks-id/tabella.png)

Nella schermata la colonna Nome è sfocata.

1. **Dettagli**: `icona:external-link` apre la [scheda dell'host](pagine/objects-id.md).
2. **Cred.**: le credenziali che hanno funzionato (SSH, SNMP, WinRM…). Il segno giallo **senza cred. provata** vuol
   dire che l'host potrebbe essere letto ma nessuna credenziale è stata provata con successo.
3. **Conosciuto**: l'interruttore che segna l'host come noto, cioè da tenere d'occhio: se si spegne compare fra gli
   host conosciuti offline della [Dashboard](pagine/dashboard.md).
4. **DNS**: com'è nel DNS di Active Directory: **✓** c'è, **∅** manca, **≠** il nome è diverso.
5. **Categoria**: che cos'è e da dove lo si sa. `icona:lock` **a mano** vuol dire scelta da una persona (le scansioni
   non la cambiano più); altrimenti la percentuale di sicurezza e la fonte (per esempio «dalle porte»). Un clic sulla
   cella apre la scelta della categoria.

| Colonna | Che cosa dice |
|---|---|
| **IP** | L'indirizzo, con il MAC sotto. |
| **Stato** | Online o Offline, con l'ora dell'ultima risposta. |
| **Cred.** | Le credenziali provate con successo. |
| **Conosciuto** | L'interruttore «da tenere d'occhio». |
| **DHCP** | **STAT** se l'indirizzo è un'assegnazione fissa, **DYN** se viene dal DHCP. |
| **AD** | L'host è in Active Directory. |
| **DNS** | ✓, ∅ o ≠ rispetto al DNS di Active Directory. |
| **Nome** | Il nome dell'host. |
| **Categoria** | Che cos'è e da dove lo si sa. |
| **Funzioni** | Che cosa fa; `icona:plus` **Funzioni** le aggiunge a mano. |
| **App.** | È un apparato gestito: il segno apre la sua scheda. |
| **MH** | Lo stesso apparato ha più interfacce (per esempio «3 IF»). |
| **Vendor** | Il produttore. |
| **Note**, **Porte** | Le note e le porte aperte. |

L'interruttore **Conosciuto**, la scelta della categoria e **+ Funzioni** cambiano i dati: li usa un
**amministratore**.

### Il tasto destro

![Il tasto destro su una riga](/manuale/networks-id/tasto-destro.png)

In cima l'indirizzo e il valore della cella. Poi `icona:filter` **Mostra solo questo valore**, `icona:eye-off`
**Nascondi questo valore** e `icona:copy` **Copia il valore** (i filtri scelti così restano in vista sopra l'elenco,
dopo «Filtri dal tasto destro:»). Sotto, le azioni sulla riga, o sulle righe spuntate se la riga è fra quelle:
`icona:tag` **Categoria…**, `icona:plus` **Rendi apparato**, `icona:user-check` **Conosciuti**, `icona:user-x`
**Rimuovi noti**, `icona:trash` **Elimina…**.

## Le azioni sulle righe spuntate

Spuntando le caselle a sinistra compare la barra «N righe spuntate» con `tasto:plus` **Rendi apparato** (registra gli
host come apparati gestiti), `tasto:tag` **Assegna categoria a N…**, `tasto:user-check` **Conosciuti** (li segna da
tenere d'occhio), `tasto:user-x` **Rimuovi noti** e `tasto:trash` **Elimina** (gli indirizzi finiscono fra gli
[IP esclusi](pagine/excluded-ips.md)). `icona:x` toglie la spunta a tutte. Queste azioni le esegue un
**amministratore**.

## La griglia degli indirizzi

![La griglia degli indirizzi](/manuale/networks-id/griglia.png)

La **Mappa degli Indirizzi IP** disegna una casella per ogni indirizzo della rete, col suo ultimo numero: **Online**
(verde), **Offline** (rosso), **Sconosciuto** (grigio), **Gateway** (giallo) e **Libero** (bianco). Serve a trovare un
indirizzo libero a colpo d'occhio. Passa il mouse su una casella per leggere indirizzo, nome e stato; un clic su una
casella occupata apre la scheda dell'host, il tasto destro apre la scelta della categoria. Nelle reti più grandi di
256 indirizzi, `icona:chevrons-left` `icona:chevron-left` `icona:chevron-right` `icona:chevrons-right` passano da un
blocco all'altro.

## Come si fa

- **Riempire una rete appena aggiunta**: `tasto:radar` **Scoperta host**, poi `tasto:scan` **Avanzata** per porte e
  modelli.
- **Trovare un indirizzo libero per una stampante nuova**: `icona:layout-grid` **Griglia IP**, scegli una casella
  bianca.
- **Correggere le categorie di più telefoni**: categoria **Telefonia** o tasto destro su una cella › **Mostra solo
  questo valore**, spunta le righe, **Assegna categoria a N…**.
- **Tenere d'occhio un server**: accendi **Conosciuto** sulla sua riga.
- **Leggere software e patch dei PC Windows**: spunta le righe, `tasto:key` **Accedi a N host**.
- **Vedere solo gli host fuori da Active Directory**: tasto destro su una cella vuota della colonna **AD** › **Mostra
  solo questo valore**.

## Da dove arrivano i dati

Dalle scansioni della rete (ping, nmap, SNMP), dalla tabella ARP del router indicato, dal DHCP, da Active Directory e
dal suo DNS, dagli accessi WinRM e SSH.

## Se la pagina è vuota

Una rete appena aggiunta è vuota fino al primo giro: premi **Scoperta host**. Se ci sono filtri attivi, premi **Togli
tutti**.
