---
percorso: /objects/[id], /hosts/[id]
titolo: Scheda dell'oggetto — tutto quello che si sa di un host o di un apparato
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la **scheda unica** di un host o di un apparato: in una pagina sola c'è tutto quello che DA-IPAM sa di lui, diviso in
schede. Da qui si legge dove sta in rete, che cosa è, cosa gira, quali vulnerabilità ha, chi lo gestisce e cosa gli è
successo nel tempo. Ci si arriva da quasi ovunque: `icona:more-vertical` › **Apri la scheda** dall'elenco degli
[Apparati](pagine/discovery.md), `icona:external-link` nella [pagina di una subnet](pagine/networks-id.md), il nome di
un oggetto nei [Cambiamenti](pagine/network-changes.md). Il vecchio indirizzo `/hosts/<numero>` apre questa stessa
scheda.

Menu e schede funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La testata

![La testata della scheda](/manuale/objects-id/testata.png)

Nella schermata i nomi nel DNS sono sfocati.

1. `icona:arrow-left` **Indietro** torna alla pagina da cui sei arrivato. Accanto: il nome, l'indirizzo, il tipo
   (**Host** per un indirizzo visto in rete, oppure il tipo di apparato gestito: Server Windows, switch, router…), i
   ruoli (per esempio **DC**), lo stato (**✓ online** con la latenza, o offline), poi marca, modello e firmware o,
   per una macchina virtuale, «VM n su …» con il collegamento all'hypervisor. **✓ credenziale provata** vuol dire che
   DA-IPAM entra davvero nell'apparato; durante una scansione automatica compare il suo stato, con il collegamento al
   lavoro.
2. **DNS**: com'è l'host nel DNS di Active Directory (**✓** coincide, **∅** manca, **≠** il nome è diverso), i nomi e
   il reverse, i rilievi (per esempio «Stesso IP, più nomi») e la data dell'ultima lettura. **Apri la scheda DNS**
   porta alla scheda DNS di [Active Directory](pagine/active-directory.md) già filtrata su quell'indirizzo.
3. **Le schede** (vedi sotto).
4. Per un host: `tasto:package-plus` **Rendi apparato**, per uno che è in realtà un apparato da gestire (uno switch,
   un server, una stampante…): apre la finestra in cui si sceglie il tipo e le credenziali; da quel momento DA-IPAM lo
   interroga e la scheda si arricchisce. Per un apparato già gestito, al suo posto ci sono `tasto:refresh` **Aggiorna**
   (rilegge subito l'apparato) e `tasto:key` **Prova credenziali** (prova SSH, SNMP, WinRM o API con un accesso vero).
5. **Dati da**: le fonti della scheda e quando hanno parlato l'ultima volta, per esempio «✓ Discovery 26/11, 10:31»
   o «LibreNMS: non abbinato». Sta sotto il primo riquadro della Panoramica.
6. `tasto:more-horizontal` **Altre azioni** (vedi sotto).

Rendi apparato, Aggiorna e Prova credenziali si vedono anche in sola lettura, ma li esegue solo un
**amministratore**.

### Altre azioni

![Il menu Altre azioni](/manuale/objects-id/altre-azioni.png)

- `icona:pencil` **Modifica** (per gli apparati gestiti): nome, classificazione e dati dell'apparato;
- `icona:package-plus` **Crea asset NIS2**, se l'oggetto non è ancora nell'inventario;
- `icona:trash` **Togli apparato**, solo per gli amministratori: lo riporta a semplice host.

## Le schede {#schede}

Quelle che ci sono dipendono da che cosa è l'oggetto. Tutti hanno **Panoramica** e, dopo la riga verticale,
**Sicurezza**, **Gestione** e **Storico**:

- **Panoramica**: lo stato, le porte aperte e la rete (sotto).
- **Sicurezza**: vulnerabilità, porte aperte e rilievi di quell'oggetto.
- **Gestione**: i dati di inventario: categoria e criticità NIS2, sede, reparto, posizione fisica, quando è stato
  scoperto e visto l'ultima volta, se è un host noto.
- **Storico**: i cambiamenti di quell'oggetto nel tempo (indirizzi, MAC, porte, stati).

Gli apparati gestiti hanno schede in più secondo il tipo:

| Tipo | Schede in più |
|---|---|
| Switch | **Porte**, **VLAN**, **Vicini** |
| Router o firewall | **Porte**, **VLAN**, **Vicini**, **Interfacce**, **Routing**, **DHCP**, **Configurazione** (sui MikroTik anche **Bridge** e **Dispositivi**) |
| Server Windows o Linux | **Sistema**, **Servizi**, **Aggiornamenti**, **Software**, **Utenti**; sui domain controller **Active Directory**; dove ci sono, **Sensori** e **Rilievi** |
| Hypervisor | **VM**, **Nodi**, lo storage e la rete del cluster, **Porte** |
| NAS | **Dischi**, **Volumi**, i servizi del NAS |
| Stampante | **Materiali** (toner e carta) |
| UPS | lo stato dell'UPS |
| Gli altri | **Dettagli** |

### La Panoramica

![La Panoramica](/manuale/objects-id/panoramica.png)

1. **Dati da**: le fonti, come sopra.
2. **Rete**: la **Subnet**, la **Porta dello switch** a cui è attaccato, il router che lo vede (**Visto dal router**),
   e gli altri indirizzi dello stesso apparato su altre reti («Stesso apparato su altre reti», con il motivo per cui
   DA-IPAM li ha riconosciuti come lo stesso).

Accanto, **Porte aperte** con le porte TCP e UDP viste all'ultima scansione; sotto, secondo il tipo, Active Directory,
l'utente abituale e gli altri riquadri.

## Come si fa

- **Sapere dove è attaccato un apparato**: **Panoramica** › **Rete** › **Porta dello switch**.
- **Sapere se è vulnerabile**: scheda **Sicurezza**.
- **Gestire davvero uno switch, un server o una stampante**: `tasto:package-plus` **Rendi apparato**, scegli tipo e
  credenziale; poi `tasto:refresh` **Aggiorna**.
- **Controllare che la credenziale funzioni ancora**: `tasto:key` **Prova credenziali**.
- **Correggere nome o categoria di un apparato**: `tasto:more-horizontal` › **Modifica**.
- **Metterlo nell'inventario NIS2**: `tasto:more-horizontal` › **Crea asset NIS2**.

## Cosa vogliono dire i segni

- **✓ online** con la spunta, offline col pallino vuoto: lo stato si legge dal segno oltre che dal colore.
- Nel riquadro DNS: **∅** manca nel DNS, **≠** il nome nel DNS è diverso, **✓** coincide.
- **✓ credenziale provata**: DA-IPAM entra nell'apparato con una credenziale che ha funzionato.

## Da dove arrivano i dati

Dalle scansioni della rete, dalle tabelle ARP e MAC di router e switch, dagli accessi SNMP, SSH, WinRM e API, da
Active Directory e dal suo DNS, e dai moduli collegati (LibreNMS, Wazuh, Scanner-Edge, inventario).

## Se la pagina è vuota

Se l'indirizzo non corrisponde a nessun oggetto (per esempio un host eliminato) la scheda non si apre: torna
all'elenco degli [Apparati](pagine/discovery.md). Una scheda con poche righe vuol dire che l'host è stato solo visto
in rete: si arricchisce con **Rendi apparato** e con le credenziali.
