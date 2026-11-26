---
percorso: /port-map
titolo: Mappa porte — cosa c'è in rete e su quale porta sta
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Risponde alla domanda **«dove è attaccato?»**: per ogni oggetto visto in rete dice su quale switch e su quale porta
sta, con quanta certezza, e da quali prove lo si sa. Mostra anche ogni porta degli apparati con cosa c'è sopra, e le
rotte dei router. Serve per trovare un PC sul patch panel, per capire cosa c'è dietro una porta, per accorgersi di uno
switch non gestito nascosto sotto una scrivania. Si arriva da **Network › Topologia**, scheda **Porte** in cima.

![La mappa porte](/manuale/port-map/pagina.png)

## Le voci della pagina

1. **Calcolo**: se il calcolo delle posizioni è **acceso** e quando è stato fatto l'ultimo. Accanto: quanti apparati
   hanno una tabella MAC letta, quanti oggetti si conoscono **solo dal controller** e quanti MAC sono **senza host
   noto**.
2. **Le quattro tessere** contano le posizioni per certezza: **Certe** (lo dice il controller, o è l'unico MAC sulla
   porta), **Spiegate** (porta condivisa con un motivo: un hypervisor, un telefono con il PC dietro), **Da capire**
   (più MAC sulla stessa porta senza motivo: forse uno switch non gestito, o due porte insieme), **Non so** (visto solo
   sulle porte di passaggio fra switch: si sa il ramo, non la porta).
3. **Le viste**: **Oggetti** (ogni cosa vista in rete e dove sta), **Porte** (ogni porta, aggregato e cosa ha
   sopra), **Rotte** (le rotte di tutti i router, comprese quelle non più viste).
4. **Cerca**: nome, indirizzo, MAC o porta (nelle Porte: porta, apparato, vicino; nelle Rotte: destinazione, gateway,
   interfaccia). Accanto i filtri: **Tutti gli apparati**, **Tutte le VLAN**, **Ogni confidenza**, **Ogni tipo di
   porta** e le spunte **Senza host** (MAC che non corrispondono a nessun host), **Spostati** (cambiati di porta di
   recente), **Solo visti di recente**. Nella vista Porte ci sono anche **Ogni modo** e **Libere**.
5. **Confidenza**: il segno della certezza di quella posizione (vedi sotto).

Nella vista **Oggetti** le colonne sono **Oggetto** (con il tipo sotto), **MAC**, **IP** (**+3** vuol dire altri tre
indirizzi), **Dove** (apparato e porta, oppure «Visto da» o «Solo su porte di passaggio»), **VLAN**, **Confidenza**.
In fondo **Precedenti** e **Successivi** sfogliano a cento righe per volta; sotto c'è la legenda dei segni.

Un clic su una riga apre il **Dettaglio della posizione**: il perché, la confidenza, le fonti, le **Prove** (ogni
porta dove è stato visto, con il tipo di porta e quando) e gli **Spostamenti** degli ultimi 90 giorni. Da lì si va alla
**Scheda host**, alla **Scheda apparato** o alla [Topologia](pagine/topology.md).

Nella vista **Porte** ogni riga è una porta (**Apparato · porta**, **Tipo**, **Fonte**, cosa c'è sopra, **VLAN**) con
lo stato: **● attiva**, **○ inattiva**, **◌ non più vista**. Nella vista **Rotte**: **Apparato**, **Destinazione**,
**Gateway**, **Interfaccia**, **Protocollo**, **Metrica**, **Stato**.

## Come si usa

1. Per trovare dove è attaccato un PC scrivi nome o MAC in **Cerca** e leggi **Dove**.
2. Se la confidenza è **Da capire**, apri la riga e guarda le **Prove**: più oggetti sulla stessa porta di solito
   vogliono dire un piccolo switch o un telefono con il PC dietro.
3. Per trovare una porta libera passa a **Porte** e spunta **Libere**.

## Cosa vogliono dire i segni

- **● Certa**: lo dice il controller, oppure è l'unico MAC sulla porta.
- **◐ Spiegata**: porta condivisa per un motivo noto.
- **○ Da capire**: più MAC senza motivo.
- **✕ Non so**: visto solo su porte di passaggio.
- **non più visto** sotto il nome dell'oggetto: non compare più nelle tabelle da un po'.

## Da dove arrivano i dati

Dalle tabelle MAC degli switch gestiti, dal controller UniFi o Omada, dalla tabella ARP dei router per abbinare MAC e
indirizzi, dagli hypervisor per le macchine virtuali, dai vicini LLDP e CDP per riconoscere le porte di passaggio.

## Se la pagina è vuota

«Nessuna riga»: con dei filtri attivi, toglili. Dopo un'installazione nuova serve un giro sugli switch: gli switch
vanno resi apparati con credenziali SNMP o API, e il controller collegato in [Controller di rete](pagine/controllers.md).
