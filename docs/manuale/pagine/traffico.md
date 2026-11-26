---
percorso: /traffico
titolo: Traffico — chi parla con chi sulla rete, e cosa esce dall'abitudine
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra il **traffico vero** della rete: chi parla con chi, con chi parlano gli host fuori dalla rete, le connessioni
che non funzionano e le **anomalie**, cioè quello che esce dall'abitudine o passa in chiaro. Non manda niente sulla
rete: ascolta. I dati arrivano dai **collector**, macchine che ricevono dallo switch una copia del traffico.

Si arriva da **Sicurezza › Rete**, scheda **Traffico** nel gruppo **Viste in ascolto** (le schede di Rete sono
descritte in [Reti dal trunk](pagine/arp-table-trunk.md)). Tabelle, ricerca e pagine dell'elenco funzionano come
altrove: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini del manuale nascondono i servizi.

## In cima: collector, apprendimento e schede

![La riga dei collector, l'apprendimento e le schede](/manuale/traffico/schede.png)

- La riga **Collector** dice quanti collector sono accesi, con quale motore («tutti con Zeek» o «sonda leggera»),
  l'ultimo contatto (il più vecchio, se sono più d'uno) e la copertura peggiore. Sotto, con ▲, i problemi di un
  collector: spento, fermo per il disco pieno, ultimo errore, dati persi in un giorno.
- La fascia **In apprendimento** elenca le reti che hanno meno di 14 giorni di storia e fino a quando: in quel
  periodo DA-IPAM impara chi parla con chi, e collegamenti e porte nuove non vengono segnalati. Il resto sì.
- Senza nessun collector compare **Nessun collector registrato**; un amministratore ha **Registra un collector**.

Le schede (si apre sulla prima); la riga sotto la fila dice a cosa serve quella scelta:

1. **Chi parla con chi**: il traffico sulla rete intera, fra reti, per host, per coppia.
2. **Verso l'esterno**: con chi fuori parlano gli host, per nome, paese e fornitore.
3. **Cosa non va**: chi bussa a vuoto, i servizi che non rispondono, i servizi lenti.
4. **Anomalie**: col segno ▲ e il numero delle nuove da guardare.
5. **Reti viste**: indirizzi interni che parlano fuori dalle subnet censite; il numero dice quante sono ancora senza
   nome.

Un **amministratore** vede in più **Accessi** (solo se accesi: chi accede a cosa, coi nomi utente) e **Collector e
controlli** (le macchine che ascoltano e i controlli accesi, rete per rete).

## Chi parla con chi {#insieme}

Mostra chi parla con chi: fra reti, per host e per coppia di indirizzi.

In cima quattro riquadri: **Host che parlano** (indirizzi interni visti nel periodo), **Coppie** (chi ha aperto un
collegamento verso chi), **Volume** (byte, pacchetti e connessioni), **Verso l'esterno** (la parte del volume da o
verso fuori). Sotto, **Andamento, ultime 24 ore**: il volume ora per ora, in pieno quello fra host interni e a righe
quello da o verso fuori. Una colonna fuori scala è tagliata e porta scritto il suo valore.

![I comandi di Chi parla con chi](/manuale/traffico/comandi.png)

1. Periodo: **Ultima ora**, **Oggi**, **7 giorni**, **30 giorni**.
2. Modo di guardare: **Fra reti** (una riga per verso: la rete di chi apre il collegamento e quella di chi risponde),
   **Per host** (quanti ne contatta, da quanti è contattato, cosa offre), **Per coppia** (una riga per collegamento e
   servizio, i più pesanti in alto).
3. **Tutte le reti**: limita a una rete; ci sono anche **Fuori dalla rete**, **A tutti (diffusione)**, **Rete non
   censita** e le **Reti con nome, non censite** di **Reti viste**.
4. **Host, indirizzo o porta** con **Cerca**; **Togli la ricerca** la azzera.

Sotto, `icona:chevrons-left` `icona:chevron-left` `icona:chevron-right` `icona:chevrons-right` sfogliano le pagine.

![L'elenco Fra reti](/manuale/traffico/fra-reti.png)

Colonne di **Fra reti**: **Da**, **Verso**, **Host**, **Coppie**, **Volume**, **Pacchetti**, **Connessioni**,
**Servizi principali**, **Dettaglio**. Colonne di **Per host**: **Ne contatta**, **Lo contattano**, **Volume aperto
da lui**, **Volume verso di lui**, **Esterni** (indirizzi esterni diversi contattati), **Servizi che offre**. Fra le
reti compaiono anche **Fuori dalla rete**, **A tutti (diffusione)** e **Rete non censita**.

### Come si usa

1. Scegli il periodo e il modo di guardare: reti, host o coppie.
2. Da una riga fra reti, **Vedi le coppie** apre i singoli indirizzi; **Torna alle reti** risale.
3. Su un host, **Andamento** disegna il suo volume nelle ultime 24 ore; **Torna a tutta la rete** chiude.

Con molti dati la pagina avvisa che i numeri sono calcolati sulle coppie più pesanti.

### Da dove arrivano i dati

La copia del traffico che lo switch manda ai collector. DA-IPAM li legge ogni 5 minuti.

### Se è vuota

Serve un collector acceso: si controlla in **Collector e controlli**. Con un periodo più lungo possono comparire
dati più vecchi.

## Verso l'esterno {#esterno}

Dice con chi, fuori dalla rete, parlano gli host: nome, paese e fornitore (la rete che ospita quell'indirizzo).

Riquadri: **Destinazioni**, **Paesi**, **Fornitori**. Periodo: **Oggi**, **7 giorni**, **30 giorni**. Modi di
raggruppare: **Per destinazione**, **Per paese**, **Per fornitore**, **Per host** (con quante destinazioni parla
ogni host interno). Ricerca: **Nome, indirizzo, paese, fornitore**.

Colonne principali: **Destinazione**, **Paese**, **Fornitore**, **Host interni**, **Volume**, **Servizi
principali**, **Ultima volta**. Una destinazione col nome dato a mano lo mostra; **Dai un nome** (o **Cambia nome**)
la rende riconoscibile.

**Archivio dei paesi**: senza archivio le destinazioni si vedono lo stesso, ma senza paese e fornitore. **Scarica
l'archivio** scarica il file intero e la ricerca si fa sull'appliance: nessun indirizzo esce dall'installazione.
Quando ce n'è uno più recente compare **Scarica quello nuovo**.

Chi è in sola lettura vede destinazioni, paesi e fornitori; la colonna **Nome** con **Dai un nome** e il pulsante
**Scarica l'archivio** li ha solo un amministratore.

**Liste di DA-GEO**: se l'istanza è collegata a DA-GEO, le destinazioni si confrontano con le sue liste di indirizzi
compromessi e di paesi ad alto rischio. Compaiono la colonna **Segnate** e i conteggi **Destinazioni compromesse** e
**Le taglierebbe il geoblocking**. L'amministratore collega DA-GEO con **Collega DA-GEO** (si conferma il numero
della richiesta dentro DA-GEO, oppure **Codice a mano**); poi **Gestisci** mostra le liste (**Lista**, **Cosa
contiene**, **Voci**, **Generata**, **Scaricata**, **Stato**), **Scarica adesso**, **Ricollega** e **Scollega**. Le
liste si scaricano intere e si aggiornano da sole ogni mattina.

### Come si usa

1. Raggruppa e cerca per nome, indirizzo, paese o fornitore.
2. Con **Dai un nome** una destinazione conosciuta diventa riconoscibile.

### Da dove arrivano i dati

I collector, con l'archivio di paesi e fornitori scaricato sull'appliance.

### Se è vuota

Se mancano paesi e fornitori premi **Scarica l'archivio**. Se manca tutto, i collector non mandano ancora questo dato:
vanno aggiornati.

## Cosa non va {#nonva}

Raccoglie le connessioni che non funzionano. Periodo: **Oggi**, **7 giorni**, **30 giorni**. Sono indizi presi dalla
copia del traffico, non misure esatte; le scansioni di DA-IPAM non sono contate.

- **Chi bussa a vuoto**: host che aprono connessioni senza risposta o rifiutate, i peggiori in alto. Colonne:
  **Host**, **Destinazioni diverse**, **Tentativi**, **Senza risposta**, **Rifiutati**, **Ultima volta**.
- **Servizi che non rispondono**: servizi di casa che rifiutano o lasciano senza risposta chi li cerca. Colonne:
  **Server**, **Porta**, **Stato**, **Client**, **Senza risposta**, **Rifiutati**, **Riusciti**, **Ultima volta**.
- **Servizi lenti**: servizi di casa che ci mettono più di 200 ms ad accettare una connessione (almeno 5 aperture).
  Colonne: **Server**, **Porta**, **Aperture**, **Tempo tipico**, **Minimo**, **Ultima volta**.

### Come si usa

1. **Chi bussa a vuoto**: un host in cima cerca qualcosa che non c'è più, o sta esplorando la rete.
2. **Servizi che non rispondono**: guarda se sono spenti o chiusi da una regola.
3. **Servizi lenti**: un servizio sempre lento è da controllare.

### Cosa vogliono dire i segni

- ✕ **Mai risposto**.
- ◐ **A volte**: risponde ogni tanto.

### Da dove arrivano i dati

I collector. Sono indizi, non misure esatte.

### Se è vuota

Se la pagina dice **I collector non mandano ancora questo dato**, il collector va aggiornato.

## Anomalie {#anomalie}

Mette in fila quello che esce dall'abitudine o passa in chiaro, dal più grave e recente.

In cima tre riquadri: **Gravità alta** (nuove, da guardare per prime), **Gravità media**, **Gravità bassa**. Filtri
dell'elenco:

- Stato: **Nuove**, **Viste**, **Normali**, **Tutte**.
- Gravità: **Ogni gravità**, ▲ **alta**, △ **media**, ○ **bassa**.
- **Ogni tipo** o un tipo solo, per esempio **Collegamento nuovo**, **Porta nuova**, **Molti contatti**, **Telnet
  in chiaro**, **FTP in chiaro**, **Posta in chiaro**, **Web in chiaro**, **LDAP in chiaro**, **SNMP vecchio**, **SMB
  1**, **TLS vecchio**, **NTLM 1**, **IP doppio**, **MAC cambiato**, **Paese nuovo**, **Indirizzo compromesso**,
  **Password SSH provate**, **Iniezione SQL**, **VLAN sbagliata**.

![I filtri delle anomalie](/manuale/traffico/anomalie.png)

Colonne: **Gravità**, **Cosa è successo** (una frase e il tipo), **Chi**, **Verso chi**, **Porta**, **Prima volta**,
**Ultima volta**, **Volte**, **Stato** (solo con **Tutte**) e **Azioni**.

### Come si usa

1. Guarda prima le **Nuove** di gravità alta.
2. **Vista**: l'hai controllata, resta in elenco fra le viste.
3. Se quel traffico è voluto, **È normale**: insegna l'abitudine e quella coppia non verrà più segnalata.

Le due azioni le usa solo un amministratore: chi è in sola lettura vede i pulsanti grigi («Serve un amministratore»).

### Da dove arrivano i dati

I collector, letti ogni 5 minuti. Nei primi 14 giorni di una rete si impara: collegamenti e porte nuove non vengono
segnalati, il resto sì.

### Se è vuota

**Nessuna anomalia nuova** o **Niente con questi filtri**: prova **Tutte**. Senza collector non arriva niente.

## Reti viste {#reti}

Trova gli indirizzi interni che parlano ma non stanno in nessuna subnet censita. Periodo: **7 giorni** o **30
giorni**. Colonne: la rete, **Host visti**, **Parla con**, **Prima volta**, **Ultima volta** e le azioni.

Un amministratore ha **Dai un nome** (o **Cambia nome**), che apre una finestra con la rete (si può allargare o restringere, da una sede intera
a un indirizzo solo), il nome e una **Nota (facoltativa)**. Il nome non crea una subnet: niente scansioni, niente host
creati. **Togli il nome** la riporta a «Rete non censita».

### Come si usa

1. **Dai un nome** alle reti che riconosci.
2. Con un nome, **Vedi le coppie** apre **Chi parla con chi** filtrato su quella rete.

### Da dove arrivano i dati

I collector, nel periodo scelto.

### Se è vuota

**Nessuna rete fuori dal censimento**: tutti gli indirizzi interni visti stanno in una subnet censita. È il caso
giusto.

## Come si fa

- **Vedere quanto traffico va da una rete all'altra**: **Chi parla con chi**, periodo **7 giorni**, **Fra reti**; da una
  riga **Vedi le coppie** apre i singoli indirizzi.
- **Trovare chi consuma la banda verso Internet**: **Chi parla con chi** › **Per host**, oppure **Verso l'esterno** ›
  **Per host**.
- **Sapere dove si collega un PC**: scrivi il suo indirizzo in **Host, indirizzo o porta**, **Cerca**, poi **Verso
  l'esterno** per i paesi e i fornitori.
- **Guardare le anomalie del mattino**: **Anomalie**, **Nuove**, ▲ **alta**; un amministratore segna **Vista** quelle
  controllate ed **È normale** il traffico voluto.
- **Trovare un servizio spento**: **Cosa non va** › **Servizi che non rispondono**: ✕ **Mai risposto** vuol dire spento
  o chiuso da una regola.
- **Dare un nome a una rete che non è in DA-IPAM**: **Reti viste**, **Dai un nome** (amministratore); da lì in poi
  compare col suo nome in tutte le schede.

## Accessi {#accessi}

Mostra chi si è presentato con quale **nome utente**, da dove e verso quale server. Solo amministratori. Sono dati
personali: la funzione è **spenta di serie**, visibile solo agli amministratori, e i dati si tengono 90 giorni.

Periodo: **7 giorni**, **30 giorni**, **90 giorni**. Ricerca: **Utente, dominio, indirizzo**. Colonne: **Utente**,
**Dominio**, da dove, **Verso**, **Protocollo**, **Riusciti**, **Falliti**, **Prima volta**, **Ultima volta**.

### Come si usa

1. Cerca un utente, un dominio o un indirizzo.
2. Guarda **Falliti**: molti tentativi falliti sono da chiarire.

### Da dove arrivano i dati

I collector leggono il nome utente di Kerberos, SMB e LDAP, mai le password.

### Se è vuota

**Accessi spenti**: si accendono in **Collector e controlli**, e il collector va configurato per gli accessi.

## Collector e controlli {#collector}

Gestisce le macchine che ascoltano il traffico e i controlli sul contenuto, rete per rete. Solo amministratori.

**Collector**: l'elenco, con **Nome**, **Sede**, **Indirizzo**, **Ultimo contatto**, **Copertura** (quanta parte del
traffico è riuscito a leggere), **Motore**, **Ultimo errore**, **Acceso** e **Azioni** (**Togli**). **Registra un
collector** apre il modulo: nome, indirizzo, gettone e impronta del certificato, che stampa l'installazione del
collector; **Prova e registra** verifica il collegamento e lo salva. La prima lettura parte entro 5 minuti.

**Controlli sul contenuto**: i controlli che guardano dentro il traffico (protocolli in chiaro, versioni vecchie e
simili), accesi di serie. Si spengono per una rete dove quel traffico è voluto. Del contenuto si salva il fatto, mai
il valore. Qui si accendono anche gli **Accessi con nome utente**.

### Come si usa

1. **Registra un collector** con i dati che stampa la sua installazione.
2. Guarda **Ultimo contatto**, **Copertura** e **Ultimo errore**: dicono se sta ascoltando bene.
3. Spegni un controllo solo per le reti dove quel traffico è voluto.

### Da dove arrivano i dati

DA-IPAM legge i collector ogni 5 minuti.

### Se è vuota

**Nessun collector**: un collector si installa su una macchina che riceve la copia del traffico dallo switch, poi si
registra qui.
