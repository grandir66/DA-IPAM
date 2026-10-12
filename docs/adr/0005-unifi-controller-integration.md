# ADR 0005 — Controller UniFi: configurazione nell'hub, sessione in sola lettura col certificato fissato, mappatura sulla forma vera

**Stato:** Accepted
**Data:** 2026-10-12
**Autore:** riccardo.grandi@domarc.it
**Deriva da:** [ADR 0004](0004-da-ipam-appliance-edge-guidato.md), punto 5 (i controller
UniFi e Omada sono una fonte che crea oggetti). Quella è la decisione di prodotto; qui ci
sono le scelte tecniche della prima integrazione, la tappa 2 del piano di miglioramento.

## Contesto

Da DTS il controller UniFi (Network Application self-hosted 10.6.1) gestisce 74 apparati:
50 switch e 24 access point, nessun gateway. In DA-IPAM 66 di questi stanno solo fra gli
host, con classificazione switch o access point. Nessuno compare fra i dispositivi di rete,
i vicini noti sono quelli MNDP di tre MikroTik, e la mappa `/topology` mostra quasi solo
quelli. La vista UniFi via SNMP (`summarizeUnifi` in `src/lib/scanner/snmp-query.ts`)
esiste, ma non dà l'inventario del controller, le porte di tutti gli switch e le adiacenze
LLDP. Il controller ha tutto questo in una sola chiamata, `stat/device`.

Vincoli:

- un'installazione serve un cliente, quindi c'è un controller per installazione;
- il ramo `dev` arriva da solo all'appliance di DTS in 15 minuti: ciò che si aggiunge deve
  nascere spento;
- il database del tenant DTS ha già dati che non vanno rovinati: 11 dispositivi di rete,
  138 vicini MNDP, 76 porte su tre apparati;
- le funzioni del database hanno due copie che divergono (`db.ts` e `db-tenant.ts`), e
  l'incidente del 02/09 è nato da un `db-tenant` caricato con un `require` dinamico, che
  scrive nel tenant sbagliato;
- il controller ha un certificato autofirmato, e l'account di DTS (`map`) è in sola
  lettura.

Il 12/10 una risposta vera di `stat/device` ha smentito la forma che il piano dava per
scontata. La `lldp_table` sta sull'apparato (69 su 74), mai dentro le porte. Il vicino non
ha un nome, solo un `chassis_id`. Sugli switch manca `chassis_id_subtype`. Prove scritte
sulla forma del piano sarebbero passate, e la sync vera non avrebbe trovato un vicino.

## Decisione

Il controller UniFi diventa una fonte letta in sola lettura (`stat/device`) che arricchisce
il database del tenant (`network_devices`, `switch_ports`, `device_neighbors`): la
configurazione sta nell'hub, la sessione verifica il certificato fissato al primo uso, la
mappatura si scrive e si prova sulla risposta vera, e una risposta vuota non cancella niente.

1. **Configurazione nell'hub**, chiavi `integration_unifi_*` in `settings`, come LibreNMS e
   Wazuh. La modalità è a prova di errore: tutto ciò che non è `external` vale `disabled`.
   Password e chiave API sono cifrate (`encrypt`/`safeDecrypt`) e non tornano mai al
   browser, che sa solo se sono impostate. Il tipo di controller (`self_hosted`, `udm`,
   `cloud`) sceglie il backend, ma oggi esiste solo `self_hosted`. Nessuna voce nel vault.
2. **Client a sessione, in sola lettura** (`unifi-api.ts`): login, lettura di
   `stat/device`, logout anche dopo un errore. Ogni richiesta passa da
   `isUnifiRequestAllowed`, che ammette solo quei tre percorsi.
3. **Certificato fissato al primo uso**, con l'impronta SPKI dello scanner-edge
   (`spkiPinFromDer`). Si controlla sul socket che porta la richiesta, quindi la password
   non parte verso un certificato non verificato. Si salva solo dopo una sessione riuscita,
   in una chiave propria (`integration_unifi_cert_pin`) che il salvataggio generico non
   scrive. Un certificato diverso è un errore con le due impronte, e la nuova si accetta
   solo con un'azione dell'amministratore (409 se nel frattempo è cambiata di nuovo).
   Cambiare indirizzo o porta azzera l'impronta. La sonda di «Stato moduli» non la fissa
   mai, e senza impronta non contatta il controller.
4. **Mappatura pura sulla forma vera** (`unifi-device.ts`, `unifi-map.ts`), provata su una
   risposta di DTS ridotta e anonimizzata. LLDP letto dall'apparato. Il vicino si risolve
   per MAC fra gli apparati della stessa risposta, con un indice costruito una volta. Un
   `chassis_id` con forma di MAC vale come MAC anche senza sottotipo. `remote_mac` si scrive
   come `hosts.mac` e come i vicini MNDP (`normalizeMacForStorage`), perché il ricalcolo
   dell'attribuzione li confronta senza normalizzare.
5. **Scrittura nel tenant senza danni** (`unifi-sync.ts`). Le funzioni del database vengono
   solo da `@/lib/db-tenant`, con import statico, e c'è una transazione per apparato.
   - Abbinamento: per seriale, poi per i MAC noti, poi per IP. Per IP solo se nessun MAC lo
     smentisce e l'apparato già censito è `ubiquiti` o `other`; altrimenti l'IP è conteso,
     si salta e lo si scrive fra gli errori.
   - Di un apparato già censito si aggiornano i fatti (vendor, tipo, modello, firmware,
     seriale), non le scelte (nome, protocollo, credenziali, abilitazione).
   - Gli apparati nuovi nascono spenti (`enabled = 0`, `use_for_arp_poll = 0`) e agganciati
     all'host con lo stesso IP. L'identità fisica si collega solo se esiste già.
   - Guardia «zero sospetto»: se il controller non riporta porte o vicini per un apparato
     che nel database ne ha, non si cancella niente e lo si segnala.
6. **Tutto nasce spento.** Modalità «Disattivata», e nessun job `unifi_sync` si crea da
   solo: la sync parte a mano dalla card. I tipi di job stanno in un solo elenco
   (`src/lib/scheduled-job-types.ts`), da cui derivano il CHECK dello schema, la migrazione
   v8 e i tipi TypeScript.

Perché così: lo schema hub + client + sync + job + card è quello di LibreNMS, e la
direzione dei dati (lettura esterna, scrittura nel tenant) è quella di Wazuh. Chi conosce
quelle due integrazioni trova la terza dove se l'aspetta. Le altre scelte vengono da un
vincolo preciso: un cliente con dati veri riceve il codice in 15 minuti e il controller
risponde in una forma che il piano aveva sbagliato. Quindi niente si accende da solo,
niente si cancella su una risposta vuota, la password non parte verso un certificato non
verificato, e le prove usano la risposta vera.

## Alternative scartate

- **Solo SNMP** (estendere `summarizeUnifi` e interrogare ogni switch) — scartata: serve
  una community SNMP su 74 apparati, e l'inventario resta quello che si riesce a
  contattare uno per uno. Il controller conosce già tutto, porte e vicini compresi.
- **Configurazione in una tabella per tenant** — scartata: un'installazione serve un
  cliente, le altre integrazioni stanno nell'hub, e una tabella per tenant vuol dire una
  migrazione su ogni database e credenziali in un posto diverso da tutte le altre.
- **Mappatura sui campi del piano** (LLDP dentro ogni porta, `lldp_chassis_id` e
  `lldp_port_id` scritti a mano) — scartata: le prove passavano e la sync vera non avrebbe
  trovato vicini. Si scrive sulla risposta vera.
- **Accettare qualunque certificato** (`rejectUnauthorized: false`) — scartata: la password
  del controller partirebbe verso chiunque risponda a quell'indirizzo.
- **Identità fisica con `resolvePhysicalDevice`** — scartata: crea un record quando non
  trova niente (a DTS sarebbero 74 identità fittizie) e passa dal facade `db.ts`.
- **Funzioni del facade `db.ts`** — scartata: le copie divergono, e il suo `getDb()`
  risolve il tenant con un `require`, la stessa classe di guasto del 02/09.
- **Apparati nuovi accesi** — scartata: il poll ARP interroga ogni apparato abilitato, e
  su uno Ubiquiti con protocollo `api` proverebbe SNMP con community `public`. I dati
  arrivano già dal controller.
- **Job `unifi_sync` creato in automatico** — scartata: ogni giro è un login sul
  controller del cliente, e a DTS sarebbe partito da solo con il primo aggiornamento.

## Conseguenze

### Positive

- Gli apparati del controller entrano fra i dispositivi di rete con porte e vicini, e la
  mappa si popola senza configurare SNMP apparato per apparato.
- Una risposta vuota o troncata del controller non cancella porte e vicini buoni.
- Il codice nuovo non passa dal facade e non crea identità fisiche fittizie.
- Le prove girano sulla forma vera: un cambio di forma si scopre ricatturando la fixture.

### Negative

- Funziona solo il controller self-hosted: UDM e cloud rispondono «backend non ancora
  implementato».
- La sync automatica non c'è: la card dice che per ora parte solo a mano.
- Lo stato delle porte è una fotografia dell'ultima sync, non un monitoraggio.
- Un certificato rinnovato sul controller ferma la sync finché un amministratore non
  accetta la nuova impronta.
- L'host e il dispositivo di rete dello stesso apparato restano due righe, legate da
  `host_id`.

### Cosa diventa difficile in futuro

- **`stat/device` è un'API non documentata di Ubiquiti.** Una versione della Network
  Application che sposta `lldp_table` o rinomina i campi rompe la mappatura. La guardia
  «zero sospetto» rende il guasto rumoroso invece di distruttivo, ma la correzione richiede
  una fixture nuova presa dal controller vero.
- **UDM e cloud non riusano il client a sessione**: chiave API in un header, percorsi e
  risposte diversi. Ognuno va misurato su un controller vero prima di scrivere la
  mappatura, come si è fatto per `stat/device`.
- **Un IP conteso non si risolve da solo**: un apparato censito a mano con un altro vendor
  sullo stesso IP resta fuori finché qualcuno non sceglie. Non c'è fusione automatica.
- **Ogni tipo di job nuovo costa una ricostruzione di `scheduled_jobs`** (la v8 è la
  settima). L'elenco unico evita che schema e migrazione divergano, ma non toglie la
  ricostruzione.
- **Omada e i client Wi-Fi** (tappa 4) dovranno seguire lo stesso schema (fixture vera,
  sola lettura, certificato fissato, guardia sulle cancellazioni) o spiegare perché no.
- **Spostare il controller a un altro indirizzo è un primo uso nuovo**: l'impronta si
  azzera e chi lo configura deve controllare quella che il controller presenta.

## Riferimenti

- Spec: [`../superpowers/specs/2026-10-12-unifi-controller-integration-design.md`](../superpowers/specs/2026-10-12-unifi-controller-integration-design.md)
- Piano, con le correzioni in testa e gli esiti dei task:
  [`../superpowers/plans/2026-10-12-unifi-controller-integration.md`](../superpowers/plans/2026-10-12-unifi-controller-integration.md)
- Piano di miglioramento, tappa 2:
  [`../superpowers/specs/2026-10-12-piano-miglioramento-design.md`](../superpowers/specs/2026-10-12-piano-miglioramento-design.md)
- ADR correlati: [0002](0002-static-db-tenant-import.md) (import statico di `db-tenant`),
  [0003](0003-topology-map.md) (mappa topologia), [0004](0004-da-ipam-appliance-edge-guidato.md)
  (DA-IPAM è l'appliance).
- Codice: `src/lib/integrations/unifi-{device,api,map,sync,health}.ts`,
  `src/lib/integrations/config.ts`, `src/lib/scheduled-job-types.ts`,
  `src/app/api/integrations/unifi/`, `src/components/settings/unifi-card.tsx`.
- Fixture: `src/lib/integrations/__tests__/fixtures/unifi-stat-device.json` (risposta vera
  di DTS del 12/10, quattro apparati, MAC, IP, nomi e seriali anonimizzati).
