---
percorso: /cliente/monitoring
titolo: DATIA MONITORING — il monitoraggio visto dal cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Racconta al cliente **come stanno gli apparati sotto monitoraggio**: quanti funzionano, quanti sono fermi, la
disponibilità degli ultimi 30 giorni, gli incidenti, quanto si impiega a risolverli, i problemi aperti. I dati vengono
dal monitoraggio Zabbix di DatIA Mon, riassunti per famiglia (Switch, Router, Wi-Fi, Storage e NAS, Host di
virtualizzazione, Macchine virtuali, Server Windows…). È una pagina della [vista cliente](pagine/cliente.md), in sola
lettura; la vedono gli utenti con il ruolo Cliente e gli amministratori. Si apre dal riquadro **DATIA MONITORING** della
pagina iniziale, da **DatIA Mon › Pagina del cliente** nel menu, o dal pulsante **DATIA MONITORING** della pagina
[Zabbix](pagine/zabbix.md). C'è solo se il pannello Zabbix è acceso per il cliente.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, quanti apparati sono sotto
controllo.

![La pagina DATIA MONITORING](/manuale/cliente-monitoring/pagina.png)

## I riquadri

- **Stato in una frase**: per esempio «7 apparati fermi, 6 da tenere d'occhio», con sotto quanti funzionano e di quanti
  non si sa; a destra l'ora dell'**Ultima lettura**.
- **Disponibilità 30 giorni**, **Incidenti 30 giorni**, **Metà dei problemi si chiude entro** (il tempo di soluzione),
  **Prima scadenza di un certificato**: ognuno con il confronto con il mese prima.
- **Le famiglie**: un riquadro per famiglia con il segno dello stato («3 fermi di 9», «4 di 4») e i numeri propri della
  famiglia (porte attive, spazio usato, dischi e RAID a posto, nodi attivi, servizi fermi…), più **Senza fermi, 30
  giorni**. Un clic porta al dettaglio della famiglia più in basso.
- **Disponibilità per giorno** e **Incidenti per settimana**: i grafici.
- **Apparati per stato** e **Spazio più pieno**.
- **Problemi aperti**: ogni problema con **Grave** o **Medio**, l'apparato, da quando, e se è già preso in carico («Non
  ancora preso in carico» se no).
- **Ultimi 30 giorni per famiglia**: un segmento per giorno, dal più vecchio a oggi. Chiaro: nessun fermo. Scuro: almeno
  un apparato non rispondeva.

Sotto i riquadri, una tabella per ogni famiglia con lo **Stato** e il nome di ogni **Apparato** e le misure di quella
famiglia.

## Comporre la pagina (solo amministratori)

**Componi questa pagina** mette la pagina in modifica: come nella [pagina iniziale](pagine/cliente.md) si spostano, si
allargano, si alzano e si nascondono i riquadri, e in più compare **Cosa vede il cliente**, dove si scelgono le famiglie e
gli apparati da nascondere e il nome da mostrare al cliente al posto di quello di Zabbix. Famiglie e apparati nascosti
spariscono per il cliente anche da conti, problemi e indicatori. **Salva la disposizione** scrive, **Annulla** esce.

## Come si usa

1. Leggi la frase in cima: dice subito se c'è qualcosa di fermo.
2. Apri la famiglia con il segno rosso per vedere quali apparati sono fermi.
3. Guarda **Problemi aperti** per sapere se qualcuno ci sta già lavorando.

## Cosa vogliono dire i segni

- **✓** verde: funziona. **▲** giallo: attenzione. **✕** rosso: fermo. **?** grigio: non si sa.
- Nei problemi, **Grave** (rosso) e **Medio** (giallo).

## Da dove arrivano i dati

Dal centro di monitoraggio Zabbix di Domarc, letto per questo cliente: lo stesso dato della pagina [Zabbix](pagine/zabbix.md),
riassunto per famiglia.

## Se la pagina è vuota

Se il centro non risponde, al posto dei riquadri c'è il motivo e l'ora dell'ultima lettura riuscita: la pagina riprova da
sola. Se la pagina riporta alla pagina iniziale, il monitoraggio non è acceso per questo cliente.
