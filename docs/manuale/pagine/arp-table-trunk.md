---
percorso: /arp-table/trunk
titolo: Reti dal trunk — allarmi, VLAN e apparati sentiti in ascolto
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

La **sonda trunk** è collegata a una porta dello switch che porta tutte le VLAN e **ascolta soltanto**: non interroga
nessun apparato. Questa pagina mostra quello che sente: i problemi della rete, le VLAN e gli indirizzi che esistono
davvero sul cavo, gli apparati che si presentano da soli. Si arriva da **Sicurezza › Rete**, poi una delle tre schede
del gruppo **Viste in ascolto**.

Menu, schede, ricerca e tabelle funzionano come in tutte le pagine: sono spiegati nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md). Qui c'è quello che questa pagina ha di suo.

## Le schede e la riga della sonda

![Le schede di Rete e la riga della sonda](/manuale/arp-table-trunk/schede.png)

Le schede di **Rete** sono in due gruppi. **Provate dalla sonda** mandano prove sulla rete:
[Porte e servizi](pagine/servizi-rete.md) e [Chi raggiunge cosa](pagine/segmentazione.md). **Viste in ascolto**
ascoltano soltanto: [Traffico](pagine/traffico.md) e le tre schede di questa pagina.

1. **Allarmi di rete**: i problemi che la sonda sente (server DHCP non previsti, indirizzi contesi, protocolli
   insicuri). Vedi [Allarmi di rete](#sicurezza).
2. **VLAN e indirizzi**: le VLAN, le reti e gli indirizzi visti sul cavo, senza leggere il router. Vedi
   [VLAN e indirizzi](#reti).
3. **Apparati annunciati**: gli apparati che si presentano da soli, con nome, modello e versione. Vedi
   [Apparati annunciati](#annunci).
4. **La riga Sonda trunk**: ● acceso o spento, su quale scheda di rete ascolta, quanti pacchetti al secondo vede, se
   legge i tag VLAN, da dove DA-IPAM legge i suoi dati e quando sono arrivati gli ultimi. **Impostazioni** porta alle
   opzioni della sonda; se la lettura è spenta il pulsante dice **Accendi in Opzioni**.

Se qualcosa non va, sotto la riga compare il perché, con ▲ (da guardare) o ✕ (bloccato):

- ✕ **La sonda non risponde**: su questa macchina non è installata o è spenta; serve una seconda scheda di rete
  collegata alla porta trunk.
- ✕ **La sonda è installata ma non ascolta**.
- ▲ **Non ha ancora visto pacchetti con il tag VLAN**: la porta dello switch forse non è configurata come trunk.
- ▲ **La sonda funziona, ma DA-IPAM non legge i suoi dati**: si accende la lettura in Opzioni.
- ▲ **Ultima lettura non riuscita**, con il motivo.

## Allarmi di rete {#sicurezza}

Mostra i problemi che la sonda sente sulla rete. In cima quattro riquadri:

| Riquadro | Che cosa conta |
|---|---|
| **Allarmi** | Cose successe da guardare subito (DHCP, IP contesi, indirizzi fuori rete); sotto, quanti gravi aspettano qualcuno. |
| **Esposizioni** | Come è fatta la rete, con cosa fare; sotto, quanti host usano LLMNR/NetBIOS. |
| **Novità** | Apparati e VLAN sconosciuti sentiti sulla rete. |
| **Da prendere in carico** | I rilievi di cui nessuno si sta occupando. |

### Il pannello Allarmi di rete

I tipi di rilievo stanno in tre colonne, ognuno con il segno della gravità e quanti sono:

- **Allarmi**: **Server DHCP non previsto**, **Indirizzo IP conteso**, **Indirizzo fuori dalla sua rete**;
- **Esposizioni**: **Usa LLMNR o NetBIOS**, **Stesso apparato in più VLAN**, **Switch che si annuncia (CDP/LLDP)**;
- **Novità**: **Apparato non in inventario**, **VLAN non censita**.

Un clic su un tipo filtra l'elenco sotto e in fondo al pannello compare **Cosa fare** per quel tipo; un altro clic
toglie il filtro. «N presi» accanto al numero dice quanti sono già in mano a qualcuno; ✓ **nessuno** vuol dire che in
quella colonna non c'è niente di aperto.

In alto a destra nel pannello:

- **Quali rilievi**: **Tutti** o **Da prendere in carico** (solo quelli senza nessuno);
- `icona:search` **Cerca IP, MAC, testo**: si cerca premendo **Invio**.

Le colonne dell'elenco:

| Colonna | Che cosa dice |
|---|---|
| **Gr.** | La gravità: alta, media o bassa, con le tacche (vedi [Segni e colori](../INTERFACCIA.md#segni)). |
| **Rilievo** | Il dettaglio e, sotto, il tipo. |
| **VLAN** | Dove è stato sentito: la VLAN, **Nativa** o «più VLAN». |
| **Indirizzo IP** | L'indirizzo coinvolto. |
| **MAC e produttore** | La scheda di rete e chi l'ha fatta. |
| **Ultimo visto** | L'ultima volta che la sonda l'ha sentito. |
| **Presa in carico** | ✓ con il nome di chi se ne occupa (passa il mouse per la data), oppure il pulsante. |

Chi è in **sola lettura** vede l'elenco e chi ha preso in carico cosa. Un **amministratore** ha in più, sulla riga:

- **Prendi in carico**: dice ai colleghi che te ne occupi; il rilievo esce da «Da prendere in carico»;
- **Riapri**: lo rimette fra quelli da prendere.

**Precedenti** e **Successivi**, in fondo, sfogliano l'elenco (50 righe alla volta).

I rilievi compaiono anche in [Findings](pagine/vulnerabilities.md), fonte **IPAM / Nety**. Quelli gravi contano nel
numero rosso accanto a **Rete** nel menu.

## VLAN e indirizzi {#reti}

Elenca le VLAN, le reti e gli indirizzi che esistono davvero sul trunk. In cima quattro riquadri: **VLAN viste** (con
quante non dichiarate in DA-IPAM e quante dichiarate e mai viste), **Reti** (dedotte dagli indirizzi visti, quante già
in DA-IPAM), **Indirizzi IP** (quanti silenziosi) e **Nuovi in 7 giorni**.

### Da dove si ascolta

Se oltre alla sonda ci sono i collector del [Traffico](pagine/traffico.md), sopra la riga della sonda compare **Da dove
si ascolta**: **Sonda trunk** oppure una sede con i suoi collector («Sede · 2 collector»; passa il mouse per leggerne i
nomi). Con una sede la pagina mostra le reti viste da quei collector (solo ARP e DHCP degli ultimi 14 giorni) e, per
ogni indirizzo, chi l'ha visto (colonna **Visto da**). Vedi [Le reti di una sede](#sede).

### La VLAN nativa

Se il programma non sa ancora a quale VLAN appartengono i pacchetti senza tag, compare la fascia gialla
▲ **VLAN nativa da confermare**, con quello che ha dedotto. Un amministratore risponde con **Sì, è la VLAN N** oppure
**È un'altra**, che chiede il numero (da 1 a 4094; vuoto vuol dire «nessuna»). Dopo la conferma, in alto a destra del
pannello 1 si legge «Senza tag = VLAN N» e **Cambia** riporta alla VLAN dedotta.

### 1. VLAN viste sul trunk

![Le VLAN viste sul trunk](/manuale/arp-table-trunk/vlan.png)

Una casella per VLAN: il numero (la **Nativa** è quella senza tag), quanti IP ha (o quanti MAC, se non ha indirizzi),
la sua rete o ▲ **non dichiarata** se in DA-IPAM non c'è, una barra con gli IP in ascolto (azzurro) e quelli silenziosi
(blu scuro), e quanti indirizzi stanno nella rete ufficiale della VLAN («✓ ufficiali») e quanti fuori («altri»). Il
bordo tratteggiato vuol dire **dichiarata ma mai vista**.

Un clic su una casella mostra sotto solo le reti e gli indirizzi di quella VLAN; **Tutte** toglie la scelta.

### 2. Reti e 3. Dettaglio della rete

![Le reti e il dettaglio di una rete](/manuale/arp-table-trunk/reti.png)

**2. Reti** ha una voce per rete: l'indirizzo con la maschera, il segno di come è stata trovata la maschera (vedi
[i segni](#segni)), quanti IP, il gateway, «+N oggi» se ci sono indirizzi nuovi, e da quali blocchi /24 vicini è
fatta. ▲ **stessa rete anche su** avvisa che la stessa rete compare in più VLAN.

Un clic su una rete apre a destra **3. Dettaglio della rete**:

- **Gateway**, **Indirizzi** (con quanti silenziosi), **Nuovi in 7 giorni**, **Maschera**;
- il segno della maschera con il perché e **correggi**, una tendina con le maschere possibili; per una maschera
  scritta a mano c'è **Torna alla dedotta**;
- il grafico **IP conosciuti negli ultimi 14 giorni** (quanti in tutto e quanti nuovi ogni giorno);
- **Occupazione**: una casella per indirizzo (o per gruppo di indirizzi): in ascolto, silenzioso, gateway, mai visto;
- `tasto:zap` **Giro ARP**: interroga la VLAN per trovare gli apparati che non parlano da soli (stampanti, PLC,
  telecamere); i risultati arrivano alla lettura successiva. È spento se la lettura della sonda è spenta;
- **Porta in DA-IPAM**: crea subito la rete fra le [Subnet](pagine/networks.md), con un giro ARP e gli host già
  visti (ci vuole fino a un minuto e mezzo). Se la maschera è incerta conviene correggerla prima. Una rete già
  presente lo dice con ✓ **in DA-IPAM**.

Giro ARP, Porta in DA-IPAM e la correzione della maschera cambiano dati e sono pensati per un amministratore.

### 4. Indirizzi IP e MAC

![L'elenco degli indirizzi](/manuale/arp-table-trunk/indirizzi.png)

Ogni indirizzo visto sul trunk, 100 alla volta. Se hai scelto una VLAN o una rete, il suo nome compare accanto ai
filtri.

1. **Come è stato trovato**: **Tutti**, ● **In ascolto**, ▲ **Silenziosi** (trovati solo col giro ARP),
   ◆ **Confermati** (in tutti e due i modi).
2. `icona:search` **Cerca IP, MAC, nome**: si cerca premendo **Invio**.
3. **Appartenenza**, ognuna col suo numero: **Tutti**, ✓ **Ufficiali** (nella rete della sua VLAN), **Altri**,
   ▲ **Altra VLAN** (l'indirizzo è di una rete che in DA-IPAM sta su un'altra VLAN), ● **VLAN non in DA-IPAM**,
   ● **169.254** (indirizzi che il PC si dà da solo quando il DHCP non risponde), – **Instradati** (indirizzi che
   passano dal router e non sono host della VLAN; di serie restano nascosti, e accanto si legge quanti).

| Colonna | Che cosa dice |
|---|---|
| **Indirizzo IP** | L'indirizzo; **GW** se è il gateway annunciato dal DHCP, **GW?** se è l'indirizzo più cercato. |
| **MAC** | La scheda di rete. |
| **Produttore** | Chi ha fatto la scheda, dal MAC. |
| **VLAN · rete** | La VLAN e la rete dedotta. |
| **Appartenenza** | Uno dei segni del filtro 3; passa il mouse per la spiegazione. |
| **Come è stato trovato** | ● visto in ascolto, ▲ solo col giro ARP, ◆ ascolto + giro ARP. |
| **Nome e protocolli** | Il nome, i protocolli sentiti, i segni dei rilievi aperti (✕ DHCP non previsto, ▲ fuori rete, ▲ LLMNR/NetBIOS, ● più VLAN, ● non in inventario) e, sotto, quello che l'apparato dice di sé (annunci, mDNS, DHCP). |
| **Ultimo visto** | Quando la sonda l'ha sentito l'ultima volta. |

**Precedenti** e **Successivi** sfogliano l'elenco.

### Le reti di una sede {#sede}

Scegliendo una sede in **Da dove si ascolta** la pagina cambia: niente riga della sonda, e al posto delle VLAN del
trunk ci sono quelle viste dai collector. Le reti hanno ▲ «N indirizzi visti non sono host» quando in DA-IPAM manca
qualche host. Nel dettaglio di una rete un amministratore ha:

- **Porta in DA-IPAM**, che qui apre una finestra: **Nome** della rete, **Maschera** (la /24 è quella dedotta),
  **Sede e VLAN**, quanti indirizzi **Entrano subito**, e il promemoria che le **Credenziali** si aggiungono dopo e
  che il **Giro ARP** non si può fare (il collector ascolta soltanto). **Porta in DA-IPAM** conferma, **Annulla**
  chiude;
- **Aggiungi i N host che mancano**, per una rete già in DA-IPAM.

L'elenco degli indirizzi ha la ricerca `icona:search` **Cerca IP, MAC, nome** (con **Togli** per azzerarla) e in più la
colonna **Visto da**: quale collector l'ha sentito.

## Apparati annunciati {#annunci}

![La barra di Apparati annunciati](/manuale/arp-table-trunk/annunci.png)

Elenca gli apparati che si presentano da soli sulla rete (MikroTik, Ubiquiti, Cisco e simili). In cima i riquadri
**Apparati annunciati**, **Non in DA-IPAM** (da aggiungere all'inventario), **Non registrati** (noti come host ma non
come apparato) e **Protocolli sentiti**.

Nella barra del pannello:

- `icona:search` **Cerca nome, modello, indirizzo**: filtra mentre scrivi;
- **Protocollo**: **Tutti** oppure **MNDP**, **Ubiquiti**, **CDP**, **LLDP**, ognuno col suo numero;
- **Stato in DA-IPAM**: **Tutti**, **Non in DA-IPAM**, **Non registrati come apparato**.

| Colonna | Che cosa dice |
|---|---|
| `icona:chevron-right` | Apre la riga (`icona:chevron-down` la richiude): da quali porte e VLAN si annuncia l'apparato. |
| **Apparato** | Il nome con cui si presenta e che tipo di apparato dice di essere. |
| **Come** | Il protocollo dell'annuncio. |
| **Modello e versione** | Modello e versione del sistema, come li dichiara l'apparato. |
| **Interfacce** | Da quante porte si annuncia, e in quale VLAN (o in quante). |
| **In DA-IPAM** | Il collegamento all'host con sotto **apparato registrato** o ▲ **non è un apparato**; ▲ **non c'è**, con l'indirizzo, se in DA-IPAM manca. |
| **Vista** | Quando è arrivato l'ultimo annuncio. |

La pagina qui si legge soltanto: per registrare un apparato si va in [Apparati](pagine/discovery.md).

## Come si fa

- **Vedere se la sonda funziona**: guarda la riga **Sonda trunk** in cima a ogni scheda: ● acceso, pacchetti al
  secondo, «tag VLAN letti» e «dati adesso». Se c'è una riga ▲ o ✕ sotto, dice cosa sistemare.
- **Trovare un server DHCP che non dovrebbe esserci**: scheda **Allarmi di rete**, clic su **Server DHCP non
  previsto**: l'elenco mostra indirizzo e MAC, in fondo c'è **Cosa fare**. Un amministratore lo segna con **Prendi in
  carico**.
- **Scoprire le reti che mancano in DA-IPAM**: scheda **VLAN e indirizzi**, cerca le caselle ▲ **non dichiarata**,
  clic sulla VLAN, poi sulla rete; se la maschera è giusta, **Porta in DA-IPAM**.
- **Trovare le stampanti e le telecamere che non parlano**: scegli la rete, `tasto:zap` **Giro ARP**, aspetta un paio
  di minuti, poi nell'elenco **Come è stato trovato** › ▲ **Silenziosi**.
- **Vedere chi usa un indirizzo che non è della sua VLAN**: elenco **Indirizzi IP e MAC**, **Appartenenza** › ▲ **Altra
  VLAN**.
- **Completare l'inventario degli switch**: scheda **Apparati annunciati**, **Stato in DA-IPAM** › **Non in DA-IPAM**;
  apri la riga con `icona:chevron-right` per sapere su quale porta si annuncia.

## Cosa vogliono dire i segni {#segni}

- ● visto in ascolto; ▲ silenzioso, trovato solo col giro ARP; ◆ visto e confermato.
- **GW**: gateway annunciato dal DHCP; **GW?**: l'IP più cercato, probabilmente il gateway.
- Maschera: ✓ **DHCP** (annunciata dal DHCP), ≈ **dedotta** (/24 vicini con lo stesso gateway uniti), **? incerta**
  (indirizzi sparsi, da confermare), ✎ **impostata** (scritta a mano).
- Casella di VLAN col bordo tratteggiato: dichiarata in DA-IPAM ma mai vista sul trunk.
- Gravità dei rilievi: alta (grave, conta nel numero rosso del menu), media (da controllare), bassa (da sapere).

## Da dove arrivano i dati

Dalla sonda trunk, letta ogni 2 minuti; i rilievi si ricalcolano a ogni lettura. Gli annunci sono i messaggi che gli
apparati mandano da soli (CDP, LLDP, MNDP, Ubiquiti). Le reti delle sedi arrivano dai collector del
[Traffico](pagine/traffico.md). Le scansioni di DA-IPAM restano sull'indirizzo ufficiale dell'appliance.

## Se la pagina è vuota

- **Nessun rilievo aperto**: va bene, oppure la sonda non legge; guarda la riga della sonda.
- **Nessuna VLAN letta finora**: la porta dello switch deve essere un trunk con tutte le VLAN; il sensore manda le
  VLAN entro un paio di minuti dall'accensione.
- **Nessun annuncio finora**: gli annunci arrivano entro un paio di minuti; alcuni apparati non si annunciano o hanno
  la funzione spenta.
