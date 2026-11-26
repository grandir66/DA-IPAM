---
percorso: /settings/moduli/[key]
titolo: Pagina di un modulo — configurazione, stato e verifica
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Ogni modulo di DA-IPAM ha la sua pagina, dove lo si configura, se ne legge lo stato e lo si verifica. Ci si arriva
da **Impostazioni › Moduli** premendo **Apri** sulla riga del modulo. L'indirizzo finisce con il nome del modulo,
per esempio `/settings/moduli/patch_management`.

I moduli con una pagina: **Scanner-Edge** (scansioni di vulnerabilità), **Patch Management**, **Inventory Agent**,
**MeshCentral** (controllo remoto), **Inventario NIS2**, **Network Services** (DNS, DHCP, AdGuard, Unbound), il
**pannello Zabbix** in sola lettura, **Controller di rete** (UniFi), **LibreNMS**, **Graylog**, **Wazuh SIEM**,
**Grafana Loki** e le **Credenziali di sistema** condivise dalle integrazioni. Un nome che non è fra questi dà la
pagina «Modulo sconosciuto», con il collegamento **Tutti i moduli**.

![La pagina del modulo Patch Management](/manuale/settings-moduli-key/pagina.png)

## Le voci della pagina

Ogni pagina ha la stessa ossatura; i campi cambiano da modulo a modulo.

- **Tutti i moduli**, in alto: torna all'elenco.
- **Il titolo del modulo**, con l'etichetta **Opzione** se è un modulo opzionale (potenzialmente a pagamento).
- **Importa JSON**, a destra del titolo: carica la configurazione del modulo da un file preparato prima.
- **Il riquadro del modulo**: il nome completo, lo stato (**Installato**, **Non installato**, **Non configurato**),
  una riga che dice che cosa fa, e i pulsanti per installarlo, configurarlo o toglierlo. Per i moduli che si
  collegano a un servizio esterno ci sono i campi dell'indirizzo e dell'accesso; le password e i gettoni salvati
  non si rivedono.
- **Le righe «cambia da Opzioni ›»**: le funzioni del modulo che si accendono e spengono stanno in
  [Opzioni](pagine/settings-opzioni.md); qui se ne vede lo stato.
- **Verifica**, per i moduli che lo prevedono: prova davvero il collegamento e dice com'è andata. La riga
  **Apertura per il browser** dice se l'interfaccia del modulo si apre da qui; da spento si legge «Modulo spento:
  nessuna verifica, nessuna chiamata».

Alcuni moduli si installano come contenitori Docker sull'appliance: se Docker manca la pagina lo dice e propone di
installarlo.

## Disinstallare un modulo

Il pulsante di disinstallazione apre una conferma. Si può scegliere **Elimina anche i dati storici del modulo**:
senza spunta i dati restano nel database e tornano se lo si reinstalla; con la spunta si cancellano. Il messaggio
finale dice che cosa è successo davvero ai dati.

## Come si usa

1. Da **Impostazioni › Moduli** premi **Apri** sul modulo.
2. Compila i campi del collegamento e salva.
3. Premi **Verifica**: se torna verde, il modulo è pronto. Nell'elenco dei moduli lo stato diventa **✓ Acceso**.

## Da dove arrivano i dati

Dalla configurazione del modulo salvata nell'istanza e, per lo stato, da una verifica fatta al momento verso il
servizio del modulo.

## Se la pagina è vuota

Se si legge «Caricamento…» a lungo o un errore sullo stato dei moduli, ricarica. Un modulo spento mostra solo il
pulsante per installarlo o accenderlo.
