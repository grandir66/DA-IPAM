---
percorso: /arp-table/trunk
titolo: Reti dal trunk — allarmi, VLAN e apparati sentiti in ascolto
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

La **sonda trunk** è collegata a una porta dello switch che porta tutte le VLAN e ascolta, senza interrogare nessun
apparato. Questa pagina mostra quello che sente, in tre parti che stanno come schede in cima, nel gruppo **Viste in
ascolto** di **Sicurezza › Rete**:

- **Allarmi di rete**: i problemi che la sonda sente (server DHCP non previsti, indirizzi contesi, protocolli
  insicuri).
- **VLAN e indirizzi**: le VLAN, le reti e gli indirizzi che esistono davvero sul cavo, senza leggere il router.
- **Apparati annunciati**: gli apparati che si presentano da soli, con nome, modello e versione.

In cima a ogni parte la riga **Sonda trunk** dice se la sonda è accesa, su quale scheda ascolta, quanti pacchetti al
secondo vede, se legge i tag VLAN e quando sono arrivati gli ultimi dati. **Impostazioni** (o **Accendi in Opzioni**
se la lettura è spenta) porta alle opzioni della sonda. Se qualcosa non va, sotto compare il perché: per esempio la
sonda ascolta ma non vede tag VLAN (la porta dello switch forse non è un trunk), oppure funziona ma DA-IPAM non
legge i suoi dati.

## Allarmi di rete {#sicurezza}

Mostra i problemi che la sonda trunk sente sulla rete, senza interrogare nessun apparato.

In cima quattro riquadri: **Allarmi** (cose successe da guardare subito: DHCP, IP contesi, indirizzi fuori rete; con
quanti gravi sono da prendere), **Esposizioni** (come è fatta la rete, con cosa fare; per esempio quanti host usano
LLMNR/NetBIOS), **Novità** (apparati e VLAN sconosciuti sentiti sulla rete), **Da prendere in carico** (senza
nessuno che se ne occupa).

Nel pannello **Allarmi di rete**:

- I tipi di rilievo, divisi in **Allarmi**, **Esposizioni** e **Novità**, ognuno col suo conteggio: **Server DHCP non
  previsto**, **Indirizzo IP conteso**, **Indirizzo fuori dalla sua rete**, **Usa LLMNR o NetBIOS**, **Stesso
  apparato in più VLAN**, **Switch che si annuncia (CDP/LLDP)**, **Apparato non in inventario**, **VLAN non censita**.
  Un clic su un tipo filtra l'elenco e in fondo compare **Cosa fare**.
- **Quali rilievi**: **Tutti** o **Da prendere in carico**.
- **Cerca IP, MAC, testo**, con Invio.
- Colonne: **Rilievo**, **Indirizzo IP**, **MAC e produttore**, **Ultimo visto**, **Presa in carico** (chi e quando,
  oppure «da prendere»).

### Come si usa

1. Parti dagli allarmi gravi.
2. Scegli un tipo di rilievo: l'elenco si filtra e in fondo compare **Cosa fare**.
3. **Prendi in carico** dice ai colleghi che te ne occupi; **Riapri** lo rimette in lista (solo amministratori).
4. Con **Da prendere in carico** restano solo quelli senza nessuno.

### Cosa vogliono dire i segni

- Gravità alta: grave, conta nel numero rosso accanto a **Rete** nel menu.
- Gravità media: da controllare.
- Gravità bassa: da sapere.
- ✓ **nessuno**: per quel tipo non c'è niente di aperto.

### Da dove arrivano i dati

La sonda trunk, in ascolto sulla porta con tutte le VLAN. Si calcola a ogni lettura, ogni 2 minuti. I rilievi
compaiono anche in [Findings](pagine/vulnerabilities.md), fonte **IPAM / Nety**.

### Se è vuota

**Nessun rilievo aperto**: guarda la riga della sonda in alto. Se è spenta o la lettura non è attiva, lì c'è scritto
perché.

## VLAN e indirizzi {#reti}

Elenca le VLAN, le reti e gli indirizzi che esistono davvero sul trunk, senza leggere il router.

![VLAN e indirizzi](/manuale/arp-table-trunk/reti.png)

1. **Da dove si ascolta**: se oltre alla sonda ci sono dei collector del [Traffico](pagine/traffico.md), qui si
   sceglie il punto di ascolto: **Sonda trunk** o una sede con i suoi collector. Con una sede la pagina mostra le
   reti viste da quei collector (solo ascolto di ARP e DHCP degli ultimi 14 giorni) e chi ha visto ogni indirizzo.
2. **VLAN viste sul trunk**: una casella per VLAN con quanti IP ha, se è dichiarata in DA-IPAM (**▲ non
   dichiarata** se no), una barra (IP in ascolto e IP silenziosi) e quanti indirizzi stanno nella rete ufficiale
   della VLAN («ufficiali») e quanti fuori («altri»). Un bordo tratteggiato vuol dire dichiarata ma mai vista.
   **Tutte** toglie la scelta. A destra si legge quale VLAN è la nativa (i pacchetti senza tag).
3. **Dettaglio della rete**: si riempie scegliendo una rete nell'elenco **2. Reti** a sinistra.

In cima quattro riquadri: **VLAN viste** (con quante non dichiarate e quante dichiarate e mai viste), **Reti**
(dedotte dagli indirizzi visti, quante già in DA-IPAM), **Indirizzi IP** (visti senza leggere il router, quanti
silenziosi), **Nuovi in 7 giorni**.

Se la VLAN nativa non è confermata compare **▲ VLAN nativa da confermare**: si scrive il numero (da 1 a 4094) o si
lascia vuoto per «nessuna».

**2. Reti**: una voce per rete, con la sua maschera, quanti IP, il gateway e come è stata trovata la maschera (vedi i
segni). **▲ stessa rete anche su** avvisa che la stessa rete compare in più VLAN.

**Dettaglio della rete**: **Gateway**, **Indirizzi**, **Nuovi in 7 giorni**, **Maschera** (con **correggi** e
**Torna alla dedotta**), il grafico degli IP conosciuti per giorno e la mappa dell'**Occupazione** (in ascolto,
silenzioso, gateway, mai visto). **Porta in DA-IPAM** aggiunge la rete all'inventario: chiede il nome e mostra
sede e VLAN, quanti indirizzi entrano subito e che le credenziali si aggiungono dopo. Una rete già presente lo dice
con **✓ in DA-IPAM**.

**Indirizzi IP e MAC**: ogni indirizzo visto sul trunk. Filtri **Come è stato trovato** (**Tutti**, **● In
ascolto**, **▲ Silenziosi**, **◆ Confermati**), **Appartenenza** (**Tutti**, **✓ Ufficiali**, **Altri**, **▲ Altra
VLAN**, **● VLAN non in DA-IPAM**, **● 169.254**, **– Instradati**) e **Cerca IP, MAC, nome**. Colonne: **Indirizzo
IP**, MAC, **Produttore**, **VLAN · rete**, **Appartenenza**, **Come è stato trovato**, **Nome e protocolli**,
**Ultimo visto**. Sull'indirizzo possono comparire i segni dei rilievi aperti (**✕ DHCP non previsto**, **▲ fuori
rete**, **▲ LLMNR/NetBIOS**, **● più VLAN**, **● non in inventario**). **Precedenti** e **Successivi** sfogliano.

### Come si usa

1. Scegli una VLAN: sotto compaiono le sue reti.
2. Scegli una rete per il dettaglio; se la maschera è sbagliata si corregge lì.
3. **Porta in DA-IPAM** aggiunge una rete che non c'è ancora.
4. In fondo trovi ogni indirizzo IP e MAC, con i filtri.

### Cosa vogliono dire i segni

- ● visto in ascolto.
- ▲ silenzioso, trovato solo col giro ARP.
- ◆ visto e confermato.
- **GW?**: l'IP più cercato, probabilmente il gateway.
- Maschera: **✓ DHCP** (annunciata dal DHCP), **≈ dedotta** (/24 vicini con lo stesso gateway uniti), **? incerta**
  (IP sparsi, da confermare), **✎ impostata** (scritta a mano).

### Da dove arrivano i dati

La sonda trunk, letta ogni 2 minuti. Le scansioni restano sull'IP ufficiale dell'appliance.

### Se è vuota

**Nessuna VLAN letta finora**: la porta dello switch deve essere un trunk con tutte le VLAN. Guarda la riga della
sonda in alto. Il sensore manda le VLAN alla prima lettura, entro un paio di minuti dall'accensione.

## Apparati annunciati {#annunci}

Elenca gli apparati che si presentano da soli sulla rete, con nome, modello e versione.

In cima i riquadri **Apparati annunciati**, **Non in DA-IPAM** (da aggiungere all'inventario), **Non registrati**
(noti come host, non come apparato) e **Protocolli sentiti**. Filtri: **Cerca nome, modello, indirizzo**,
**Protocollo** (**Tutti** o uno solo) e **Stato in DA-IPAM** (**Non in DA-IPAM**, **Non registrati come apparato**).
Colonne: **Apparato**, **Modello e versione**, **Interfacce**, **In DA-IPAM** (**apparato registrato** o **▲ non è
un apparato**). Una riga si apre e mostra da quali porte e VLAN si annuncia.

### Come si usa

1. Filtra **Non in DA-IPAM** per trovare apparati che mancano nell'inventario.
2. Filtra **Non registrati come apparato** per completare quelli già noti come host.
3. Apri una riga per vedere da quali porte si annuncia.

### Da dove arrivano i dati

I messaggi che MikroTik, Ubiquiti e Cisco mandano da soli (CDP, LLDP e simili), sentiti dalla sonda trunk.

### Se è vuota

**Nessun annuncio finora**: gli annunci arrivano entro un paio di minuti. Alcuni apparati non si annunciano o hanno
la funzione spenta.
