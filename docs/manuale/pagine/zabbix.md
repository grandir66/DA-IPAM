---
percorso: /zabbix
titolo: Zabbix — cosa sa il centro di monitoraggio
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **cosa sa il centro di monitoraggio Zabbix** degli apparati di questo cliente: quanti host controlla, quali sono
disponibili, i problemi aperti, il proxy Zabbix della macchina e l'abbinamento fra gli host di Zabbix e quelli di
DA-IPAM. È una pagina **in sola lettura**: i dati vecchi sono mostrati come vecchi e, quando non sono affidabili, la
pagina dice «non so» invece di «tutto ok». È un modulo opzionale (segno **Opzione** accanto al titolo).

Si arriva da **DatIA Mon › Apparati monitorati** nel menu (per chi non è amministratore), oppure dal collegamento
**Vista tecnica e abbinamenti ›** della pagina [Apparati di DatIA Mon](pagine/zabbix-apparati.md).

![La pagina Zabbix](/manuale/zabbix/pagina.png)

## Le voci della pagina

In cima, accanto al titolo, lo stato del pannello: **Attivo**, **Spento**, **Da configurare**, **Non acquistato** o
**Guasto**. A destra:

- **DATIA MONITORING**: apre la pagina che vede il cliente, [DATIA MONITORING](pagine/cliente-monitoring.md).
- **Aggiungi apparati** (solo amministratori): apre [Apparati](pagine/zabbix-apparati.md) di DatIA Mon.
- **Configura** (solo amministratori): apre la configurazione del modulo Zabbix nelle impostazioni.
- **Aggiorna**: rilegge i dati dal centro.

I riquadri:

- **Tutto ok** / **Da guardare**: il riepilogo, con il nome del cliente sul centro e l'ora della lettura. Sotto, i
  numeri: host, disponibili, non disponibili, «non so» (disponibilità non nota), problemi aperti, e l'elenco dei motivi
  per cui c'è da guardare.
- **Proxy Zabbix di questa macchina**: il componente locale che raccoglie i dati per il centro. **Sulla macchina** dice
  se gira, se è installato ma fermo, se non è installato; **Per il centro** dice se il centro lo vede in linea e quando
  l'ha sentito l'ultima volta. DA-IPAM lo guarda e basta: non lo avvia né lo riavvia.
- **Problemi aperti**: Gravità, Problema, Host, Dal (da quando). Mostra i primi 50; **Mostra tutti** li apre tutti. «preso
  in carico» vuol dire che qualcuno sul centro ci sta già lavorando.
- **Host del cliente sul centro**: ogni host di Zabbix con IP, Proxy, **Disponibilità** (Disponibile, Non disponibile,
  Non so), **Misure** (gli ultimi valori letti; quelli vecchi sono in grigio) e **DA-IPAM** (l'host abbinato). La stella
  gialla segna gli host raccolti dal proxy di questa macchina; l'interruttore **Solo questa macchina** lascia solo loro.
- **Abbinamenti persi**: host verificati che il centro non elenca più. Non si riabbinano da soli; un amministratore li
  toglie con **Togli**.

## La colonna DA-IPAM

Dice come l'host di Zabbix è legato a un host di DA-IPAM:

- **Verificato**: l'abbinamento è confermato; il nome apre la scheda dell'host.
- **Proposto per IP** (eventualmente «anche il nome coincide»): DA-IPAM ha trovato un host con lo stesso indirizzo. Un
  amministratore lo conferma con **Conferma**.
- **Ambiguo**: lo stesso IP è su più host del centro o su più host di DA-IPAM; sotto ci sono i candidati. Va risolto a
  mano.
- **Perso**: era verificato, ma l'IP è cambiato. **Togli l'abbinamento** lo cancella.
- **Non in DA-IPAM**: DA-IPAM non conosce quell'host.

## Quando il centro non risponde

Se il pannello è **Guasto**, al posto dei dati c'è il motivo, l'ora dell'**Ultima lettura buona**, il **Prossimo
tentativo** con quanti tentativi sono falliti di fila, e per gli amministratori **Riprova adesso**. Non si mostra nessun
dato finché il centro non risponde di nuovo. Se i dati sono di qualche minuto fa, una fascia gialla lo dice e la
disponibilità diventa «non so».

## Come si usa

1. Guarda il riquadro del riepilogo: **Tutto ok** o **Da guardare**, con i motivi.
2. Apri **Problemi aperti** per sapere cosa non va e su quale host.
3. Nella tabella degli host, conferma gli abbinamenti **Proposti** se sei amministratore.
4. Per aggiungere apparati al monitoraggio usa **Aggiungi apparati**.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc, letto con una chiave di sola lettura; il proxy locale lo legge DA-IPAM sulla macchina. Gli
abbinamenti nascono dal confronto degli indirizzi con gli host di DA-IPAM.

## Se la pagina è vuota

**Non acquistato** o **Da configurare**: il modulo non è attivo per questo cliente; un amministratore lo configura con
**Configura**. **Spento**: il pannello è configurato ma spento. «Il centro non ha host per questo cliente» vuol dire che
su Zabbix non c'è ancora niente: si aggiungono da [Apparati](pagine/zabbix-apparati.md).
