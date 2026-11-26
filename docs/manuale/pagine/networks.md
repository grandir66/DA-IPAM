---
percorso: /networks
titolo: Subnet — le reti che DA-IPAM tiene d'occhio
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco delle **reti (subnet)** dell'istanza: ogni riga è una rete con il suo indirizzo, la VLAN, quanti host
contiene e quanti rispondono. DA-IPAM scansiona solo le reti che stanno qui: per far vedere una rete nuova si aggiunge
da questa pagina. Un clic su una riga apre la [pagina della subnet](pagine/networks-id.md), con tutti i suoi host.
Si arriva da **Network › Subnet** nel menu.

Menu, tabelle e selezione funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).
Qui sotto c'è quello che Subnet ha di suo.

## La barra in cima

![La barra di Subnet](/manuale/networks/barra.png)

1. `icona:search` **Cerca per nome, CIDR, posizione…**: filtra le righe mentre scrivi; `icona:x` cancella la ricerca.
2. `tasto:plus` **Aggiungi Rete**: apre la finestra [Nuova Rete](#nuova-rete).

## La tabella

![La tabella delle reti](/manuale/networks/tabella.png)

1. La casella nell'intestazione seleziona tutte le reti; quella su ogni riga, la riga sola (vedi
   [Più reti insieme](#selezione)).
2. **Host**: quanti indirizzi conosce DA-IPAM in quella rete.
3. **Online** (numero verde) e **Offline** (numero rosso): quanti host rispondono e quanti no, all'ultimo giro.
4. **Ultima Scansione**: data e ora dell'ultimo giro su quella rete, oppure «Mai».
5. `icona:trash` elimina la rete **con tutti i suoi host**, dopo una conferma.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome della rete. All'apertura l'elenco è ordinato per nome (`icona:arrow-up`). |
| **CIDR** | L'indirizzo della rete con la maschera. |
| **VLAN** | Il numero della VLAN. |
| **Posizione** | La sede. |
| **Host**, **Online**, **Offline** | I conteggi. |
| **Ultima Scansione** | L'ultimo giro. |

Ogni intestazione con `icona:arrow-up-down` ordina con un clic. Un clic sulla riga apre la pagina della subnet.

Il cestino si vede anche in sola lettura, ma eliminare una rete spetta a un **amministratore**.

## Più reti insieme {#selezione}

![La barra della selezione](/manuale/networks/selezione.png)

Spunta le caselle a sinistra: sopra la tabella compare la barra con quante reti sono scelte e quante non hanno un
router (quelle vengono ignorate).

1. `tasto:key` **Assegna credenziali**: dà le stesse credenziali SSH o SNMP ai router e agli switch di tutte le reti
   scelte; si scelgono nella finestra e si conferma con **Applica**.
2. `tasto:scan` **Scansiona dispositivi**: rilegge subito i router e gli switch delle reti scelte.
3. `tasto:download` **Esporta CSV host**: scarica gli host delle reti scelte. Lo scarica solo un amministratore: per
   gli altri è spento.

`icona:x` toglie la selezione. Assegnare credenziali e scansionare cambiano dati: li esegue un **amministratore**.

## La finestra Nuova Rete {#nuova-rete}

![La finestra Nuova Rete](/manuale/networks/nuova-rete.png)

- **Rete (IP/Subnet)**: l'indirizzo della rete con la maschera, per esempio `10.20.21.0/24`. È obbligatorio insieme al
  nome.
- **Nome**: come la si vuole chiamare (per esempio «LAN Ufficio»).
- **Gateway**: l'indirizzo del router della rete.
- **Descrizione**, **VLAN ID**, **Posizione** (la sede): servono a riconoscerla.
- **Server DNS**: il DNS da usare per tradurre nomi e indirizzi di questa rete. Vuoto vuol dire quello di sistema.
- **Community SNMP (default)**: la community da provare sugli apparati di questa rete quando il profilo non ne indica
  una.
- **Router ARP (default)**: il router da cui leggere la tabella ARP della rete, cioè chi ha quale indirizzo.
  **Aggiungi router** apre **Nuovo router (ARP)** per registrarne uno al volo: nome, indirizzo IP, vendor, protocollo e
  credenziali.
- **Credenziali subnet**: le credenziali da provare sugli host di questa rete, in ordine di priorità. **Importa**, **Da
  archivio** e `tasto:plus` **Nuova** ne aggiungono; `icona:arrow-up` `icona:arrow-down` cambiano l'ordine,
  `icona:trash` toglie la credenziale dalla rete (non dall'archivio). Quelle che si agganciano da sole sono già
  proposte.

**Crea Rete** la salva. Al primo giro della scansione la rete si riempie.

## Le reti viste, da confermare

![Le reti viste, da confermare](/manuale/networks/proposte.png)

Sotto l'elenco: le reti che DA-IPAM ha sentito passare (dalla sonda trunk o dai collector) ma che non sono ancora
nell'elenco, col numero. **Apri ▾** mostra la lista: per ogni rete l'indirizzo, la VLAN, il gateway e quanti indirizzi
sono stati visti; **Porta … in DA-IPAM** la aggiunge con i suoi host. Le reti con un indirizzo solo stanno in fondo,
chiuse: di solito sono schede configurate male, non reti vere. **Chiudi ▴** richiude.

## Come si fa

- **Aggiungere una rete**: `tasto:plus` **Aggiungi Rete**, scrivi indirizzo e nome, scegli il router ARP, **Crea
  Rete**.
- **Portare dentro le reti che DA-IPAM ha già sentito**: **Reti viste, da confermare** › **Apri ▾**, poi **Porta … in
  DA-IPAM** per quelle vere.
- **Dare la community SNMP a tutti gli switch di più reti**: spunta le reti, `tasto:key` **Assegna credenziali**,
  scegli la credenziale SNMP, **Applica**.
- **Vedere quale rete ha più host spenti**: ordina per **Offline**.
- **Togliere una rete dismessa**: `icona:trash` sulla sua riga e conferma: spariscono anche i suoi host.

## Cosa vogliono dire i segni

- Numero **verde** in «Online», **rosso** in «Offline». Le colonne hanno anche il nome, non serve il colore.
- **▲ indirizzi pubblici** fra le reti proposte: la rete non è privata, controlla che sia davvero da scansionare.

## Da dove arrivano i dati

Le reti le aggiunge una persona o si confermano dalle proposte. I conteggi vengono dalle scansioni; gli orari dei giri
stanno in [Schedulazioni](pagine/settings-schedulazioni.md).

## Se la pagina è vuota

«Nessuna rete configurata»: premi **Aggiungi Rete** per la prima. Se la ricerca non trova niente, cancella il testo.
