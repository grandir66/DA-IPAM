---
percorso: /controllers
titolo: Controller di rete — UniFi e Omada collegati a DA-IPAM
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Molte reti hanno switch e access point governati da un **controller** (console UniFi OS, UniFi Network installato su
un server, Omada). Il controller sa già quali apparati ha, le loro porte, chi è attaccato dove e chi è vicino a chi.
Collegandolo qui, DA-IPAM lo legge e porta quelle informazioni fra gli [Apparati](pagine/discovery.md), nella
[Topologia](pagine/topology.md) e nella [Mappa porte](pagine/port-map.md), senza dover entrare in ogni switch.

Si arriva da **Network › Credenziali**, scheda **Controller di rete** in cima (l'altra scheda è
[Credenziali](pagine/credentials.md)). Menu, schede e tabelle funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

## La tabella dei controller

![La tabella dei controller](/manuale/controllers/tabella.png)

1. `icona:chevron-right` accanto al **Nome**: un clic sulla riga apre il [dettaglio](#dettaglio) sotto la riga
   (`icona:chevron-down` quando è aperto); un altro clic lo chiude.
2. **Stato**: ● **Attivo** (viene letto), ▲ **Errore** (l'ultima lettura non è riuscita: passa il mouse per il
   motivo), ○ **Spento** (disattivato).
3. **Pianificazione**: quando viene letto da solo e, sotto, quando si leggono i client collegati.
4. **Azioni**: i pulsanti dell'amministratore (sotto). In sola lettura qui c'è un trattino.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome dato al controller. |
| **Tipo** | UniFi OS, UniFi Network self-hosted, Omada. |
| **Indirizzo** | L'indirizzo della console. |
| **Site** | Il sito del controller che si legge (di solito «default»). |
| **Stato** | Attivo, Errore o Spento. |
| **Ultima lettura** | Quando è stato letto l'ultima volta; passa il mouse per il messaggio. |
| **Apparati**, **Porte**, **Vicini** | Quanti ne ha portati l'ultima lettura. |
| **Pianificazione** | Ogni ora, ogni 2, 4, 6, 12 ore, ogni giorno (03:00), oppure spenta. |

### Le azioni dell'amministratore

Un **amministratore** vede in più:

- `tasto:plus` **Aggiungi controller**, in alto a destra: apre la finestra del [controller](#finestra);
- **Prova**: prova il collegamento alla console senza leggere niente;
- **Sincronizza ora**: legge subito il controller e scrive apparati, porte e vicini. Chiede conferma;
- `icona:more-horizontal` **Altre azioni**: **Modifica** (riapre la finestra), **Certificato** (apre il dettaglio sul
  riquadro del certificato), **Disattiva** / **Attiva** ed **Elimina** (chiede conferma). Disattivando, il controller
  non viene più letto ma gli apparati già acquisiti restano.

L'esito di Prova e Sincronizza ora compare in una riga sotto i pulsanti.

## Il dettaglio di un controller {#dettaglio}

![Il dettaglio di un controller](/manuale/controllers/dettaglio.png)

- **In cima**: quando si leggono i **client** (i dispositivi collegati agli access point e agli switch) e com'è
  andata l'ultima lettura (letti, salvati, non abbinati). La lettura dei client si accende e si spegne da
  [Opzioni](pagine/settings-opzioni.md) («cambia da Opzioni»).
- **Ultime letture degli apparati**: per ogni lettura **Quando**, **Durata**, **Origine** (pianificata o a mano),
  **Esito**, quanti apparati **Nuovi**, **Aggiornati** e **Saltati**, **Porte**, **Vicini** ed **Errori**.
- Sotto, se ci sono: **Errori dell'ultima lettura**, **Saltati, con il motivo** e **Non connessi al controller**
  (apparati che il controller vede scollegati: porte e vicini restano quelli dell'ultima volta).
- **Il certificato**: `icona:shield-check` **Certificato del controller fissato** con la sua impronta, oppure «Nessun
  certificato fissato».

### Il certificato

Alla prima prova riuscita DA-IPAM si segna l'**impronta del certificato** del controller. Se un giorno il controller
presenta un certificato diverso, la lettura si ferma e il riquadro mostra le due impronte, **fissata** e **presentata
adesso**. Se il cambio è voluto (certificato rinnovato) l'amministratore preme **Accetta il nuovo certificato**. Un
certificato cambiato senza motivo può voler dire che qualcuno si è messo in mezzo: in quel caso non si accetta.

## La finestra del controller {#finestra}

Si apre con **Aggiungi controller** o **Modifica** (solo amministratori). I campi:

- **Tipo**: «UDM / console UniFi OS — chiave API o utente locale», «UniFi Network self-hosted — utente e password»,
  «Omada — client id e secret» (non ancora disponibile);
- **Nome** e **Indirizzo** della console;
- **Site**: il sito da leggere, scelto da un elenco quando la console risponde;
- **Accesso alla console** (per UniFi OS): **Chiave API** (si crea sulla console, nell'app Network: Control Plane,
  poi Integrazioni) oppure **Utente locale e password** (un account locale senza verifica in due passaggi, con almeno
  la lettura dell'app Network);
- **Credenziale**: **Scegli dall'archivio** una credenziale di [Credenziali](pagine/credentials.md), oppure **Nuova
  nell'archivio** per scriverla qui;
- **Pianificazione**: Spenta, Ogni ora… Ogni giorno (03:00);
- **Attivo**: l'interruttore che accende o spegne la lettura.

In fondo: **Annulla**, **Prova** (verifica il collegamento con i dati scritti) e **Salva**. Finché manca un campo
obbligatorio, Prova e Salva sono spenti: passa il mouse sopra per leggere che cosa manca.

## Come si fa

- **Collegare una console UniFi**: crea sulla console una chiave API, poi `tasto:plus` **Aggiungi controller**, tipo
  UDM, indirizzo, **Prova**, scegli il Site, **Salva**. Poi **Sincronizza ora** per la prima lettura.
- **Capire perché mancano degli switch**: apri il dettaglio e leggi **Saltati, con il motivo** e **Non connessi al
  controller**.
- **Il controller è in ▲ Errore dopo un aggiornamento della console**: apri il dettaglio; se il certificato è cambiato
  e il rinnovo è voluto, **Accetta il nuovo certificato**, poi **Prova**.
- **Fermare per un po' le letture**: `icona:more-horizontal` › **Disattiva**. Apparati e porte già letti restano.
- **Leggere anche i client collegati**: «cambia da Opzioni» nel dettaglio, poi accendi la lettura dei client.

## Da dove arrivano i dati

Dalla console del controller, letta con l'accesso indicato, alla pianificazione scelta o a mano con **Sincronizza
ora**.

## Se la pagina è vuota

«Nessun controller configurato»: l'amministratore lo aggiunge con **Aggiungi controller**. Se la rete non ha un
controller, switch e access point si leggono uno per uno con SNMP o API da [Dispositivi](pagine/devices.md).
