---
percorso: /settings/opzioni
titolo: Opzioni — ogni funzione che si accende o si spegne, in un posto solo
versione: 0.9.1367
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

Le parti comuni (menu, schede in cima, ricerca) sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in cima

![La barra di Opzioni](/manuale/settings-opzioni/barra.png)

1. **I filtri**: **Tutte**, **Accese**, **Spente**, **▲ Da guardare** (le funzioni con un avviso o un errore) e **Da
   file** (quelle che si leggono qui ma si cambiano solo sul server). Quello scelto è su fondo scuro.
2. `icona:search` **Cerca…**: filtra le righe mentre scrivi, sul nome e sulla descrizione. A destra, per chi è in
   sola lettura, l'etichetta **Solo un amministratore può cambiarle**.
3. **I gruppi**, come schede, ognuno col numero delle sue righe: **Tutte**, **Letture degli apparati** (sola
   lettura, al più una volta l'ora per apparato), **Job pianificati**, **Moduli** (si installano qui; i dati da
   inserire restano nella loro scheda), **Automatismi**, **Parametri e soglie** (numeri e scelte; indirizzi e
   password restano nelle loro schede), **Notifiche e uscite**, **Da file dell'appliance**.

A sinistra dei filtri si legge su quale cliente si sta lavorando.

## Le righe

![Le colonne di Opzioni](/manuale/settings-opzioni/righe.png)

Le righe sono divise per gruppo, ognuno nel suo riquadro col titolo e una nota. Le colonne:

1. **Stato**: la levetta. **ACCESA** su fondo scuro, **SPENTA** su fondo chiaro; per un modulo **INSTALLATO** o **NON
   INSTALLATO**; con bordo tratteggiato **DA CONFIGURARE**. Un clic apre la conferma (sotto). Per i **parametri**
   (numeri, elenchi, scelte) al posto della levetta c'è il valore: un clic lo apre per cambiarlo, con **Annulla** (o
   **Chiudi** per chi è in sola lettura) e il ritorno al valore di serie.
2. **Funzione · cosa fa**: il nome della funzione e, sotto, in una riga, che cosa fa.
3. **Vale per**: **questo cliente** o **tutti i clienti**.
4. **Di serie**: «di serie» se la funzione è com'era appena installato DA-IPAM, oppure chi l'ha cambiata e quando.
5. **Cosa è successo**: l'esito dell'ultima volta che la funzione ha lavorato, con un segno: **✓ ok**, **▲ guarda**,
   **✕ errore**, **● niente** (non ha ancora fatto niente). Accanto, quando è girata e che cosa ha trovato («letta
   alle 09:15 · 2 apparati»).
6. **Ritmo / azione**: ogni quanto gira (si sceglie dal menu a tendina) o il collegamento alla pagina dove si
   configura.

Arrivando da un collegamento **cambia da Opzioni ›** la riga giusta è evidenziata in giallo.

### La conferma

Il clic sulla levetta apre la finestra **Spegnere «…»?** (o **Accendere**, o **Disinstallare** per un modulo). Prima
di spegnere dice **Si ferma** (che cosa smette di funzionare), **Resta** (che cosa si conserva) e **Dopo gli
aggiornamenti** (resta spenta, non si riaccende da sola). Si conferma con **Spegni**, **Accendi** o **Disinstalla**,
oppure **Annulla**. Ogni cambio registra chi l'ha fatto e quando, e lo si legge nella colonna **Di serie**. Se il
salvataggio non riesce, accanto alla riga compare **✕ non salvato**.

## Come si fa

- **Trovare perché una funzione non lavora**: filtro **▲ Da guardare**, poi leggi la colonna **Cosa è successo**.
- **Spegnere un job pianificato**: gruppo **Job pianificati**, clic sulla levetta **ACCESA**, leggi **Si ferma** e
  **Resta**, **Spegni**.
- **Far girare una lettura più spesso**: trova la riga con `icona:search` **Cerca…**, scegli il ritmo nel menu della
  colonna **Ritmo / azione**.
- **Cambiare una soglia** (per esempio i giorni prima dell'archivio): gruppo **Parametri e soglie**, clic sul valore,
  scrivi il nuovo, conferma.
- **Sapere chi ha cambiato un'impostazione**: leggi la colonna **Di serie** della sua riga.
- **Vedere quello che si cambia solo sul server**: filtro **Da file**.

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
