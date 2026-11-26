---
percorso: /objects/[id], /hosts/[id]
titolo: Scheda dell'oggetto — tutto quello che si sa di un host o di un apparato
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la **scheda unica** di un host o di un apparato: in una pagina sola c'è tutto quello che DA-IPAM sa di lui, diviso in
schede. Da qui si legge dove sta in rete, che cosa è, cosa gira, quali vulnerabilità ha, chi lo gestisce e cosa gli è
successo nel tempo. Ci si arriva da quasi ovunque: **⋮ › Apri la scheda** dall'elenco degli
[Apparati](pagine/discovery.md), la freccia nella [pagina di una subnet](pagine/networks-id.md), il nome di un oggetto
nei [Cambiamenti](pagine/network-changes.md). Il vecchio indirizzo `/hosts/<numero>` apre questa stessa scheda.

![La scheda di un host](/manuale/objects-id/pagina.png)

## Le voci della pagina

1. **La testata**: il nome, l'indirizzo, il tipo (**Host** per un indirizzo visto in rete, oppure il tipo di apparato
   gestito: switch, router, server…), lo stato (**✓ online** o offline) e il produttore. La freccia a sinistra torna
   alla pagina da cui sei arrivato.
2. **DNS**: com'è l'host nel DNS di Active Directory, con la data dell'ultima lettura. Per esempio «DA-IPAM lo conosce
   per nome, nel DNS manca». **Apri la scheda DNS** porta ai dettagli del DNS di quell'host.
3. **Le schede**. Quelle che ci sono dipendono da che cosa è l'oggetto:
   - **Panoramica**: lo stato e la rete. Nel riquadro **Rete** ci sono la subnet, la **porta dello switch** a cui è
     attaccato, il router che lo vede, e gli altri indirizzi dello stesso apparato su altre reti («Stesso apparato su
     altre reti», con il motivo per cui DA-IPAM li ha riconosciuti come lo stesso).
   - **Sicurezza**: vulnerabilità, porte aperte e rilievi di quell'oggetto.
   - **Gestione**: i dati di inventario: categoria e criticità NIS2, sede, reparto, posizione fisica, quando è stato
     scoperto e visto l'ultima volta, se è un host noto.
   - **Storico**: i cambiamenti di quell'oggetto nel tempo (indirizzi, MAC, porte, stati).
   - Gli apparati gestiti hanno schede in più secondo il tipo. Uno switch: **Porte**, **VLAN**, **Vicini**. Un router
     o firewall: anche **Interfacce**, **Routing**, **DHCP**, **Configurazione**. Un server Windows o Linux:
     **Sistema**, **Servizi**, **Aggiornamenti**, **Software**, **Utenti** (e **AD** sui domain controller). Un
     hypervisor: **VM**, **Nodi**, lo storage e la rete del cluster. Una stampante: **Materiali**. Un NAS: **Dischi**,
     **Volumi**, servizi. Gli altri: **Dettagli**.
4. **Rendi apparato**: per un host che è in realtà un apparato da gestire (uno switch, un server, una stampante…).
   Apre la finestra in cui si sceglie il tipo e le credenziali: da quel momento DA-IPAM lo interroga e la scheda si
   arricchisce. Per un apparato già gestito, al suo posto compaiono **Aggiorna** (rilegge subito l'apparato) e **Prova
   credenziali** (prova SSH, SNMP, WinRM o API con un accesso vero).
5. **Dati da**: le fonti della scheda e quando hanno parlato l'ultima volta, per esempio «Discovery 26/11, 01:00» o
   «LibreNMS: non abbinato».

Il pulsante **⋯** in alto a destra apre le altre azioni: **Modifica** (nome, classificazione e dati dell'apparato
gestito), **Crea asset NIS2** (se l'oggetto non è ancora nell'inventario) e **Togli apparato** (lo riporta a semplice
host, solo per gli amministratori). Chi è in sola lettura vede la scheda ma non può usare le azioni che cambiano
qualcosa.

## Come si usa

1. Per sapere dove è attaccato un apparato guarda **Panoramica › Rete › Porta dello switch**.
2. Per sapere se è vulnerabile apri **Sicurezza**.
3. Se è uno switch, un server o una stampante che vuoi gestire davvero, premi **Rendi apparato**.
4. Per correggere nome o categoria usa **⋯ › Modifica**.

## Cosa vogliono dire i segni

- **✓ online** con la spunta, offline col pallino vuoto: lo stato si legge dal segno oltre che dal colore.
- Nel riquadro DNS: **∅** manca nel DNS, **≠** il nome nel DNS è diverso, **✓** coincide.

## Da dove arrivano i dati

Dalle scansioni della rete, dalle tabelle ARP e MAC di router e switch, dagli accessi SNMP, SSH, WinRM e API, da
Active Directory e dal suo DNS, e dai moduli collegati (LibreNMS, Wazuh, Scanner-Edge, inventario).

## Se la pagina è vuota

Se l'indirizzo non corrisponde a nessun oggetto (per esempio un host eliminato) la scheda non si apre: torna
all'elenco degli [Apparati](pagine/discovery.md). Una scheda con poche righe vuol dire che l'host è stato solo visto
in rete: si arricchisce con **Rendi apparato** e con le credenziali.
