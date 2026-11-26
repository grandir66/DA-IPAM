---
percorso: /settings/moduli/[key]
titolo: Pagina di un modulo — configurazione, stato e verifica
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Ogni modulo di DA-IPAM ha la sua pagina, dove lo si configura, se ne legge lo stato e lo si verifica. Ci si arriva
dalla scheda **Moduli** di [Impostazioni](pagine/settings.md#moduli) premendo **Apri** sulla riga del modulo.
L'indirizzo finisce con il nome del modulo, per esempio `/settings/moduli/patch_management`.

I moduli con una pagina: **Scanner-Edge** (scansioni di vulnerabilità), **Patch Management**, **Inventory Agent**,
**MeshCentral** (controllo remoto), **Inventario NIS2**, **Network Services** (DNS, DHCP, AdGuard, Unbound), il
**pannello Zabbix** in sola lettura, **Controller di rete** (UniFi), **LibreNMS**, **Graylog**, **Wazuh SIEM**,
**Grafana Loki** e le **Credenziali di sistema** condivise dalle integrazioni. Un nome che non è fra questi dà la
pagina «Modulo sconosciuto», con il collegamento **Tutti i moduli**. L'MDM ha una pagina a sé:
[MDM (Headwind)](pagine/settings-mdm.md).

Menu e parti comuni: [parti comuni dell'interfaccia](../INTERFACCIA.md).

## L'ossatura della pagina

![La pagina del modulo Patch Management](/manuale/settings-moduli-key/pagina.png)

Ogni pagina ha la stessa ossatura; i campi cambiano da modulo a modulo.

1. `icona:arrow-left` **Tutti i moduli**: torna all'elenco.
2. `tasto:upload` **Importa JSON**, a destra del nome del modulo: carica la configurazione del modulo da un file
   preparato prima. Accanto al nome può esserci l'etichetta **Opzione**: modulo opzionale, potenzialmente a
   pagamento.
3. **Il riquadro del modulo**: il nome completo, lo stato (**Installato** su fondo verde, **Non installato**, **Non
   configurato**), una riga che dice che cosa fa, la data d'installazione e i pulsanti per installarlo o toglierlo
   (per esempio **Disinstalla e cancella i dati…**, oppure **Installa da Opzioni ›**).

## Il collegamento a un servizio esterno

![La configurazione di LibreNMS](/manuale/settings-moduli-key/collegamento.png)

Per i moduli che parlano con un altro programma (LibreNMS, Graylog, Wazuh, UniFi, Zabbix…) il riquadro ha i campi del
collegamento. Su LibreNMS, per esempio:

- **Modalità**: **Installato dall'appliance** (il programma gira in un contenitore sull'appliance) oppure un server
  esterno già esistente. L'etichetta a destra del titolo ripete la scelta.
- **URL API (backend)**: l'indirizzo con cui DA-IPAM legge i dati; può essere interno e non aprirsi dal browser.
- **URL dashboard (browser)**: l'indirizzo che si apre col collegamento `icona:external-link` **Apri**; vuoto, viene
  ricavato da solo.
- **API Token**: il gettone d'accesso. Salvato, non si rivede: si lascia vuoto per tenerlo.

1. **Salva** registra i campi.
2. **Test connessione** prova il collegamento con i valori scritti e dice l'esito in basso a destra.

Accanto, `tasto:refresh` **Sincronizza inventario** fa subito un giro di lettura. Sopra il riquadro, la riga
**Docker disponibile** dice se l'appliance può installare da sola i moduli che girano in un contenitore; se Docker
manca la pagina lo dice e propone di installarlo.

Le funzioni del modulo che si accendono e si spengono stanno in [Opzioni](pagine/settings-opzioni.md): qui compaiono
come righe **ACCESA**/**SPENTA** con **cambia da Opzioni ›**. Sotto il riquadro alcuni moduli hanno parti in più (per
LibreNMS: **Apparati e lettura dei dati**, con l'esito di ogni parte letta, gli apparati mai interrogati, i rifiutati
e quelli da aggiungere).

Salvare, provare, sincronizzare, installare e disinstallare spetta all'amministratore: chi è in sola lettura vede i
pulsanti, ma il programma rifiuta la modifica.

## La verifica

![Il riquadro Verifica](/manuale/settings-moduli-key/verifica.png)

`icona:globe` **Verifica: API e apertura per il browser**, in fondo alla pagina dei moduli che lo prevedono.
`tasto:refresh` **Verifica** prova davvero il collegamento su due righe distinte: **API** (il programma risponde e
accetta il gettone) e **Apertura per il browser** (certificato, nome, scadenza, accesso e riquadro: se l'interfaccia
del modulo si apre da qui). La riga API la vede solo l'amministratore. Da spento si legge «Modulo spento: nessuna
verifica, nessuna chiamata».

## Disinstallare un modulo

Il pulsante di disinstallazione apre la finestra **Disinstallare …?**. Si può spuntare **Elimina anche i dati storici
del modulo**: senza spunta i dati restano nel database e tornano se lo si reinstalla (il pulsante dice
**Disinstalla**); con la spunta si cancellano (**Disinstalla e cancella i dati**). Il messaggio finale dice che cosa è
successo davvero ai dati.

## Come si fa

- **Collegare LibreNMS esterno**: Moduli › **Apri** su LibreNMS, Modalità sul server esterno, scrivi URL API e API
  Token, **Test connessione**, poi **Salva**.
- **Controllare che un modulo si apra dal browser**: in fondo alla sua pagina `tasto:refresh` **Verifica**; se la riga
  Apertura è rossa, leggi il motivo (spesso il certificato).
- **Portare la configurazione da un'altra installazione**: `tasto:upload` **Importa JSON** e scegli il file.
- **Cambiare il gettone d'accesso**: scrivi il nuovo nel campo del gettone, **Test connessione**, **Salva**.
- **Togliere un modulo senza perdere lo storico**: disinstalla lasciando vuota la casella **Elimina anche i dati
  storici del modulo**.

## Da dove arrivano i dati

Dalla configurazione del modulo salvata nell'istanza e, per lo stato, da una verifica fatta al momento verso il
servizio del modulo.

## Se la pagina è vuota

Se si legge «Caricamento…» a lungo o un errore sullo stato dei moduli, ricarica. Un modulo spento mostra solo il
pulsante per installarlo o accenderlo.
