---
percorso: /networks
titolo: Subnet — le reti che DA-IPAM tiene d'occhio
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco delle **reti (subnet)** dell'istanza: ogni riga è una rete con il suo indirizzo, la VLAN, quanti host
contiene e quanti rispondono. DA-IPAM scansiona solo le reti che stanno qui: per far vedere una rete nuova si aggiunge
da questa pagina. Un clic su una riga apre la [pagina della subnet](pagine/networks-id.md), con tutti i suoi host.
Si arriva da **Network › Subnet** nel menu.

![La pagina Subnet](/manuale/networks/pagina.png)

## Le voci della pagina

1. **Cerca per nome, CIDR, posizione…**: filtra le righe mentre scrivi.
2. **Aggiungi Rete**: apre la finestra **Nuova Rete**. I campi:
   - **Rete (IP/Subnet)**: l'indirizzo della rete con la maschera, per esempio `192.168.1.0/24`. È l'unico
     obbligatorio insieme al nome.
   - **Nome**: come la si vuole chiamare (per esempio «LAN Ufficio»).
   - **Gateway**: l'indirizzo del router della rete.
   - **Descrizione**, **VLAN ID**, **Posizione** (la sede): servono a riconoscerla.
   - **Server DNS**: il DNS da usare per tradurre nomi e indirizzi di questa rete. Vuoto vuol dire quello di sistema.
   - **Community SNMP (default)**: la community da provare sugli apparati di questa rete quando il profilo non ne
     indica una.
   - **Router ARP (default)**: il router da cui leggere la tabella ARP della rete, cioè chi ha quale indirizzo.
   **Crea Rete** la salva. Al primo giro della scansione la rete si riempie.
3. **Online**, **Offline**: quanti host della rete rispondono e quanti no, all'ultimo giro.
4. **Ultima Scansione**: data e ora dell'ultimo giro su quella rete.
5. **Reti viste, da confermare**: reti che DA-IPAM ha sentito passare (dalla sonda trunk o dai collector) ma che non
   sono ancora nell'elenco. **Apri ▾** mostra la lista: per ogni rete l'indirizzo, la VLAN, il gateway e quanti
   indirizzi sono stati visti. **Porta … in DA-IPAM** la aggiunge con i suoi host. Le reti con un indirizzo solo stanno
   in fondo, chiuse: di solito sono schede configurate male, non reti vere.

Le altre colonne: **Nome**, **CIDR** (l'indirizzo della rete), **VLAN**, **Posizione**, **Host** (quanti indirizzi
conosce DA-IPAM in quella rete). Un clic sull'intestazione di una colonna ordina l'elenco.

Il **cestino** in fondo alla riga elimina la rete **con tutti i suoi host**: chiede conferma. Spuntando le caselle a
sinistra compare **Assegna credenziali**, che dà le stesse credenziali SSH o SNMP ai router e agli switch di tutte le
reti scelte. Aggiungere, eliminare e assegnare credenziali spetta a chi ha il ruolo di amministratore.

## Come si usa

1. Per aggiungere una rete premi **Aggiungi Rete**, scrivi indirizzo e nome, premi **Crea Rete**.
2. Se DA-IPAM propone reti in **Reti viste, da confermare**, aprile e porta dentro quelle vere con un clic.
3. Per vedere gli host di una rete clicca la sua riga.

## Cosa vogliono dire i segni

- Numero **verde** in «Online», **rosso** in «Offline». Le colonne hanno anche il nome, non serve il colore.
- **▲ indirizzi pubblici** fra le reti proposte: la rete non è privata, controlla che sia davvero da scansionare.

## Da dove arrivano i dati

Le reti le aggiunge una persona o si confermano dalle proposte. I conteggi vengono dalle scansioni; gli orari dei giri
stanno in [Schedulazioni](pagine/settings-schedulazioni.md).

## Se la pagina è vuota

«Nessuna rete configurata»: premi **Aggiungi Rete** per la prima. Se la ricerca non trova niente, cancella il testo.
