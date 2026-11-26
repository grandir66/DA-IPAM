---
percorso: /settings/opzioni
titolo: Opzioni — ogni funzione che si accende o si spegne, in un posto solo
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in un elenco unico **tutte le funzioni che si accendono e si spengono** e i numeri che le regolano: le
letture degli apparati, i job pianificati, i moduli, gli automatismi, le soglie, le notifiche e le impostazioni che
vengono dal file dell'appliance. Si arriva da **Impostazioni › Opzioni**, oppure dai collegamenti **cambia da
Opzioni ›** sparsi nelle altre pagine, che portano dritti alla riga giusta e la evidenziano.

La pagina la vedono tutti; cambiare un'opzione può solo un amministratore. Chi non lo è vede la scritta «Solo un
amministratore può cambiarle». In alto a sinistra si legge su quale cliente si sta lavorando: ogni riga dice se
vale solo per questo cliente o per tutti.

![La pagina Opzioni](/manuale/settings-opzioni/pagina.png)

## Le voci della pagina

1. **Filtri**: **Tutte**, **Accese**, **Spente**, **▲ Da guardare** (le funzioni con un avviso o un errore) e **Da
   file** (quelle che si leggono qui ma si cambiano solo sul server).
2. **Cerca…**: filtra le righe mentre scrivi, sul nome e sulla descrizione.
3. **Funzione · cosa fa**: il nome della funzione e, sotto, in una riga, che cosa fa.
4. **Cosa è successo**: l'esito dell'ultima volta che la funzione ha lavorato, con un segno: **✓ ok**, **▲ guarda**,
   **✕ errore**, **● niente** (non ha ancora fatto niente). Accanto, quando è girata e che cosa ha trovato.

Sotto i filtri c'è la fila dei **gruppi**, ognuno col numero delle sue righe: **Tutte**, **Letture degli apparati**
(sola lettura, al più una volta l'ora per apparato), **Job pianificati**, **Moduli** (si installano qui; i dati da
inserire restano nella loro scheda), **Automatismi**, **Parametri e soglie** (numeri e scelte; indirizzi e
password restano nelle loro schede), **Notifiche e uscite**, **Da file dell'appliance**.

Le altre colonne:

- **Stato**: la levetta. **ACCESA** su fondo scuro, **SPENTA** su fondo chiaro; per un modulo **INSTALLATO** o **NON
  INSTALLATO**; con bordo tratteggiato **DA CONFIGURARE**. Un clic chiede conferma e cambia lo stato.
- **Vale per**: **questo cliente** o **tutti i clienti**.
- **Di serie**: com'è la funzione appena installato DA-IPAM, oppure chi l'ha cambiata e quando.
- **Ritmo / azione**: ogni quanto gira (si sceglie dal menu) o il collegamento alla pagina dove si configura.

Per i **parametri** (numeri, elenchi, scelte) al posto della levetta c'è il valore: un clic lo apre per cambiarlo.

## Come si usa

1. Trova la funzione con **Cerca** o con il suo gruppo.
2. Clicca la levetta. Si apre una finestra che dice, prima di spegnere, **Si ferma** (che cosa smette di
   funzionare), **Resta** (che cosa si conserva) e **Dopo gli aggiornamenti** (resta spenta, non si riaccende da
   sola). Per un'accensione dice che cosa farà.
3. Conferma con **Spegni**, **Accendi** o **Disinstalla** (per un modulo). Ogni cambio registra chi l'ha fatto e
   quando, e lo si legge nella colonna **Di serie**.
4. Se il salvataggio non riesce, accanto alla riga compare **✕ non salvato**.

## Cosa vogliono dire i segni

- **✓ ok**: l'ultima volta è andata bene. **▲ guarda**: c'è qualcosa da controllare. **✕ errore**: non ha funzionato.
  **● niente**: non ha ancora lavorato.
- Levetta su fondo scuro: accesa. Su fondo chiaro: spenta. Bordo tratteggiato: da configurare.

## Da dove arrivano i dati

Dall'elenco delle funzioni dell'installazione e dai loro registri: ogni funzione scrive il suo ultimo esito. Le
righe **Da file dell'appliance** vengono dal file di configurazione del server e qui si possono solo leggere.

## Se la pagina è vuota

Se resta su «Caricamento…» o compare un errore, ricarica. Se un filtro non trova niente si legge «Nessuna opzione
con questo filtro»: torna su **Tutte**.
