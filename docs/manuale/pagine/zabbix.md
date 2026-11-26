---
percorso: /zabbix
titolo: Zabbix — cosa sa il centro di monitoraggio
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **cosa sa il centro di monitoraggio Zabbix** degli apparati di questo cliente: quanti host controlla, quali sono
disponibili, i problemi aperti, il proxy Zabbix della macchina e l'abbinamento fra gli host di Zabbix e quelli di
DA-IPAM. È una pagina **in sola lettura**: i dati vecchi sono mostrati come vecchi e, quando non sono affidabili, la
pagina dice «non so» invece di «tutto ok». È un modulo opzionale (segno **Opzione** accanto al titolo).

Si arriva da **DatIA Mon › Apparati monitorati** nel menu (per chi non è amministratore), oppure dal collegamento
**Vista tecnica e abbinamenti ›** della pagina [Apparati di DatIA Mon](pagine/zabbix-apparati.md).

Menu, tabelle e segni funzionano come nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## L'intestazione

![L'intestazione di Zabbix](/manuale/zabbix/testa.png)

1. Accanto al titolo, dopo l'etichetta **Opzione**, lo stato del pannello: **Attivo**, **Spento**, **Da
   configurare**, **Non acquistato** o **Guasto**.
2. **DATIA MONITORING** (solo col pannello attivo): apre la pagina che vede il cliente,
   [DATIA MONITORING](pagine/cliente-monitoring.md).
3. `tasto:refresh` **Aggiorna**: rilegge i dati dal centro.

Un amministratore vede in più **Aggiungi apparati**, che apre [Apparati](pagine/zabbix-apparati.md) di DatIA Mon, e
`tasto:settings` **Configura**, che apre la configurazione del modulo Zabbix nella scheda Moduli di
[Impostazioni](pagine/settings.md#moduli).

## Il riepilogo e il proxy

![Il riepilogo e il proxy](/manuale/zabbix/riepilogo.png)

- **Tutto ok** / **Da guardare**: il riepilogo, con il nome del cliente sul centro e l'ora della lettura. Sotto, i
  numeri: host, disponibili, non disponibili, «non so» (disponibilità non nota), problemi aperti, e l'elenco dei motivi
  per cui c'è da guardare.
- **Proxy Zabbix di questa macchina**: il componente locale che raccoglie i dati per il centro. **Sulla macchina** dice
  se gira, se è installato ma fermo, se non è installato; **Per il centro** dice se il centro lo vede in linea e quando
  l'ha sentito l'ultima volta. DA-IPAM lo guarda e basta: non lo avvia né lo riavvia.

## I problemi aperti

![I problemi aperti](/manuale/zabbix/problemi.png)

Colonne **Gravità**, **Problema** (il testo scritto da Zabbix, spesso in inglese), **Host**, **Dal** (da quando).
Mostra i primi 50; **Mostra tutti** li apre tutti, **Mostra solo i primi 50** torna indietro. «preso in carico» vuol
dire che qualcuno sul centro ci sta già lavorando.

## Gli host del cliente sul centro

![Gli host del cliente sul centro](/manuale/zabbix/host.png)

Ogni host di Zabbix, col nome e il numero dei suoi problemi, l'**IP** e il **Proxy** che lo raccoglie.

1. **Disponibilità**: Disponibile, Non disponibile, Non so.
2. **Misure**: gli ultimi valori letti (ping, perdita, latenza); quelli vecchi sono in grigio.
3. **DA-IPAM**: l'host abbinato (vedi sotto).

La stella gialla segna gli host raccolti dal proxy di questa macchina; quando ce ne sono compare l'interruttore **Solo
questa macchina**, che lascia solo loro. In fondo, i pulsanti per scorrere le pagine dell'elenco.

**Abbinamenti persi**, se c'è: host verificati che il centro non elenca più. Non si riabbinano da soli; un
amministratore li toglie con **Togli**.

## La colonna DA-IPAM

Dice come l'host di Zabbix è legato a un host di DA-IPAM:

- **Verificato**: l'abbinamento è confermato; il nome apre la scheda dell'host.
- **Proposto per IP** (eventualmente «anche il nome coincide»): DA-IPAM ha trovato un host con lo stesso indirizzo. Un
  amministratore lo conferma con **Conferma** (chi è in sola lettura vede solo la proposta).
- **Ambiguo**: lo stesso IP è su più host del centro o su più host di DA-IPAM; sotto ci sono i candidati. Va risolto a
  mano.
- **Perso**: era verificato, ma l'IP è cambiato. **Togli l'abbinamento** lo cancella.
- **Non in DA-IPAM**: DA-IPAM non conosce quell'host.

## Quando il centro non risponde

Se il pannello è **Guasto**, al posto dei dati c'è il motivo, l'ora dell'**Ultima lettura buona**, il **Prossimo
tentativo** con quanti tentativi sono falliti di fila, e per gli amministratori **Riprova adesso**. Non si mostra nessun
dato finché il centro non risponde di nuovo. Se i dati sono di qualche minuto fa, una fascia gialla lo dice e la
disponibilità diventa «non so».

## Come si fa

- **Sapere se va tutto bene**: guarda il riquadro del riepilogo: **Tutto ok** o **Da guardare**, con i motivi elencati.
- **Capire che cosa non va su un apparato**: in **Problemi aperti** cerca il suo nome nella colonna Host; se sono più
  di 50, **Mostra tutti**.
- **Collegare gli host di Zabbix a quelli di DA-IPAM** (amministratore): nella colonna **DA-IPAM** premi **Conferma**
  sulle righe **Proposto per IP, anche il nome coincide**; risolvi a mano le righe **Ambiguo**.
- **Il pannello è Guasto**: leggi il motivo e il **Prossimo tentativo**; un amministratore può premere **Riprova
  adesso** dopo aver sistemato la chiave o la rete.
- **Mettere sotto monitoraggio un apparato nuovo** (amministratore): **Aggiungi apparati**.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc, letto con una chiave di sola lettura; il proxy locale lo legge DA-IPAM sulla macchina. Gli
abbinamenti nascono dal confronto degli indirizzi con gli host di DA-IPAM.

## Se la pagina è vuota

**Non acquistato** o **Da configurare**: il modulo non è attivo per questo cliente; un amministratore lo configura con
**Configura**. **Spento**: il pannello è configurato ma spento. «Il centro non ha host per questo cliente» vuol dire che
su Zabbix non c'è ancora niente: si aggiungono da [Apparati](pagine/zabbix-apparati.md).
