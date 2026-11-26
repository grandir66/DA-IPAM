---
percorso: /cliente/monitoring
titolo: DATIA MONITORING — il monitoraggio visto dal cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Ti racconta **come stanno gli apparati controllati di continuo**: quanti funzionano, quanti sono fermi, la
disponibilità degli ultimi 30 giorni, gli incidenti, quanto si impiega a risolverli, i problemi aperti. I dati sono
riassunti per famiglia (Switch, Router, Wi-Fi, Storage e NAS, Host di virtualizzazione, Macchine virtuali, Server
Windows…). È una pagina della [vista cliente](pagine/cliente.md), in sola lettura. Si apre dal riquadro **DATIA
MONITORING** della pagina iniziale; il personale tecnico la apre anche da **DatIA Mon › Pagina del cliente** nel menu o
dal pulsante **DATIA MONITORING** della pagina [Zabbix](pagine/zabbix.md). C'è solo se il monitoraggio è acceso per te.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, quanti apparati sono sotto
controllo.

![La pagina DATIA MONITORING](/manuale/cliente-monitoring/pagina.png)

## I riquadri

- **Stato in una frase**: per esempio «7 apparati fermi, 6 da tenere d'occhio», con sotto quanti funzionano e di quanti
  non si sa; a destra l'ora dell'**Ultima lettura**.
- **Disponibilità 30 giorni**, **Incidenti 30 giorni**, **Metà dei problemi si chiude entro** (il tempo di soluzione),
  **Prima scadenza di un certificato**: ognuno con il confronto con il mese prima.
- **Le famiglie**: un riquadro per famiglia con il segno dello stato («3 fermi di 9», «4 di 4») e i numeri propri della
  famiglia (porte attive, spazio usato, dischi a posto, servizi fermi…), più **Senza fermi, 30 giorni**. Un clic porta
  al dettaglio della famiglia più in basso.
- **Disponibilità per giorno** e **Incidenti per settimana**: i grafici.
- **Apparati per stato** e **Spazio più pieno**.
- **Problemi aperti**: ogni problema con **Grave** o **Medio**, l'apparato, cosa succede, da quando e quante volte. Se
  qualcuno ci sta già lavorando c'è `icona:wrench` **Domarc ci sta lavorando**, altrimenti «Non ancora preso in carico».
- **Ultimi 30 giorni per famiglia**: un segmento per giorno, dal più vecchio a oggi. Chiaro: nessun fermo. Scuro: almeno
  un apparato non rispondeva.

Sotto i riquadri, una tabella per ogni famiglia con lo **Stato** e il nome di ogni **Apparato** e le misure di quella
famiglia.

## Come si fa

- **Sapere subito se c'è qualcosa di fermo**: leggi la frase in cima.
- **Trovare quali apparati sono fermi**: clic sulla famiglia con `icona:x` rosso, poi leggi la sua tabella.
- **Sapere se qualcuno se ne sta occupando**: **Problemi aperti**, cerca `icona:wrench` **Domarc ci sta lavorando**.
- **Controllare com'è andato il mese**: **Disponibilità 30 giorni** e **Ultimi 30 giorni per famiglia**.
- **Evitare che scada un certificato**: **Prima scadenza di un certificato**.

## Cosa vogliono dire i segni

- `icona:check` verde: funziona. `icona:triangle-alert` giallo: attenzione. `icona:x` rosso: fermo. `icona:circle-help`
  grigio: non si sa.
- Nei problemi, **Grave** (rosso) e **Medio** (giallo).

## Comporre la pagina (solo per il personale tecnico) {#componi}

Il cliente non vede questa parte. **Componi questa pagina** mette la pagina in modifica: come nella
[pagina iniziale](pagine/cliente.md#componi) si spostano, si allargano, si alzano e si nascondono i riquadri, e in più
compare **Cosa vede il cliente**, dove si scelgono le famiglie e gli apparati da nascondere e il nome da mostrare al
cliente al posto di quello di Zabbix. Famiglie e apparati nascosti spariscono per il cliente anche da conti, problemi e
indicatori. **Salva la disposizione** scrive, **Annulla** esce.

## Da dove arrivano i dati

Dal centro di monitoraggio di Domarc, letto per la tua azienda: lo stesso dato della pagina [Zabbix](pagine/zabbix.md),
riassunto per famiglia.

## Se la pagina è vuota

Se il centro di monitoraggio non risponde, al posto dei riquadri c'è il motivo e l'ora dell'ultima lettura riuscita: la
pagina riprova da sola. Se la pagina ti riporta alla pagina iniziale, il monitoraggio non è acceso per te.
