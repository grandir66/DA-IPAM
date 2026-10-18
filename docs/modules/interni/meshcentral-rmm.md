# MeshCentral (Controllo remoto / RMM) — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `meshcentral`) che porta in DA-IPAM il
**controllo remoto degli endpoint**: desktop, terminale, trasferimento file ed
**esecuzione di comandi** — senza far uscire l'operatore dall'interfaccia di
DA-IPAM e senza fargli conoscere alcuna credenziale di MeshCentral. UI nativa in
`/rmm` e nella scheda host. Motore: un container **MeshCentral** (Apache-2.0)
co-locato sull'appliance. È una feature opzionale per tenant: quando spenta non
tocca il core.

Scelta di fondo: si adotta MeshCentral invece di scrivere un agente proprietario
(rischio di sicurezza non sostenibile). I **dati e i comandi** passano da un'API
stabile (`control.ashx`) e vivono in UI nativa DA-IPAM; solo i **pixel** del
desktop arrivano da MeshCentral dentro un iframe — il suo protocollo KVM è
binario e non contrattualizzato, riscriverlo si romperebbe a ogni update.

## Funzioni principali

- **Installazione one-click** dalla pagina Moduli: un solo pulsante fa tutto —
  pull immagine (pinnata per digest), `config.json`, container, service account
  `svc-daipam`, device group "Domarc Endpoints", config cifrata nel tenant, job
  di sync, self-check del login-token. Al termine il modulo è usabile, senza
  passaggi manuali. Vedi `src/lib/integrations/meshcentral/install.ts`.
- **Arruolamento agenti**: script di install generato dalla UI (Windows/Linux/
  macOS) oppure **push via WinRM** su host Windows (`/api/patch/install-meshagent`).
- **Sync periodico** (`meshcentral_sync`, ogni 15 min): allinea i nodi
  MeshCentral agli host DA-IPAM (match per MAC/IP/hostname), preserva i bind
  manuali, non azzera mai su lista vuota (guardia false-zero).
- **Controllo remoto (launch-out SSO)**: DA-IPAM conia un **login-token** cifrato
  (AES-256-GCM, monouso, 3 min) e apre la sessione già autenticata. Tre viewmode:
  **11 desktop · 12 terminale · 13 file**. La sessione è **incorporata** in
  `/rmm/[hostId]` (iframe), non apre la console MeshCentral.
- **Esecuzione comandi remoti (nativa, Fase 2)**: pannello "Comandi" in
  `/rmm/[hostId]` — nessun iframe. Va da `control.ashx` (`runcommands`), rileva la
  piattaforma da sola (Windows cmd/PowerShell, Linux bash), esegue come
  root/SYSTEM. Audit in `mc_command_log` (chi/cosa/dove, anche i fallimenti);
  l'**output non viene mai salvato** (può contenere segreti), vive solo nella
  risposta all'operatore.
- **Password master condivisa**: l'utenza di servizio usa di default la password
  master dei moduli (`src/lib/master-password.ts`), cifrata nel vault
  `system_credentials`, così non c'è un segreto per modulo.

## Come si usa

1. **Installazione**: `/settings?tab=moduli#module-meshcentral` → "Installa". Il
   wizard chiede host (default = l'indirizzo con cui raggiungi DA-IPAM), porta
   (4443), titolo/sottotitolo e la password (master o specifica). Segue il log
   live; a fine corsa il modulo è pronto.
2. **Arruolare un endpoint**: dalla scheda host → scarica lo script di install,
   oppure push WinRM su host Windows con credenziali note.
3. **Controllo remoto**: `/rmm` → "Controllo remoto" su un endpoint online →
   si apre `/rmm/[hostId]` con Desktop / Terminale / File / Comandi.
4. **Comandi**: tab "Comandi", digita ed esegui (Ctrl+Invio); l'output resta a
   schermo, la traccia va in `mc_command_log`.

## Note operative importanti

- **Certificato su :4443**: se esiste `/etc/da-appliance/cert/server.{crt,key}`
  (il certificato di nginx/DA-IPAM), l'installazione lo monta in sola lettura come
  certificato web di MeshCentral e scrive `KeepCerts: true` (altrimenti MeshCentral
  lo scarta perché `Cert` = IP non è fra i suoi nomi DNS, e se ne rigenera uno).
  Il browser ricorda l'eccezione per indirizzo e certificato, non per porta: chi ha
  accettato DA-IPAM non vede un secondo avviso. Senza quel file MeshCentral usa un
  certificato suo e dentro l'iframe Chrome mostra solo una pagina d'errore muta
  (non può offrire «Procedi»): va accettato a mano su `https://<host>:4443`.
  Su un'appliance già installata: reinstallare il modulo dalla UI. Fix
  definitivo: nome e certificato veri per appliance (backlog).
- **Immagine pinnata per digest** (mai `:latest`): MeshCentral cambia il codec
  del login-token fra versioni; un aggiornamento automatico romperebbe il
  launch-out. Aggiornare = cambiare il digest in `install.ts` **e** in
  `Deploy-Appliance/modules/meshcentral.sh`.
- **id nudi negli URL**: `?node=` e `?id=` vogliono l'id senza prefisso
  `node//` / `mesh//`; col prefisso MeshCentral ricostruisce spazzatura senza
  errori (schermo nero / 401). Vedi `deep-link.ts` (`nodeIdParam`) e
  `install-scripts.ts` (`mshIdParam`).
- **TLS verso il server co-locato**: accettato solo se l'host risolve a questa
  macchina (`isSelfHostResolved`); verso un MeshCentral remoto la verifica resta
  attiva.

## Architettura e integrazioni

- DA-IPAM (systemd) orchestra il **container Docker** MeshCentral sulla stessa
  VM. Il canale dati/comandi è `control.ashx` (WebSocket, auth `x-meshauth`).
- Config per-tenant cifrata in `mc_config` (loginTokenKey a 80 byte + admin pass,
  AES-GCM at-rest, mai in log né verso AI).
- **allowedFramingOrigins** su MeshCentral autorizza SOLO l'origine di DA-IPAM a
  incorniciare la sessione (CSP `frame-ancestors`), senza disattivare la
  protezione anti-clickjacking per tutti.
- Provisioning riproducibile anche da CLI: `da-appliance add-module meshcentral`
  (`Deploy-Appliance/modules/meshcentral.sh`) — deve restare allineato a
  `install.ts`.

## Desktop remoto senza agente (RDP / VNC)

Per le postazioni e i device dove l'agente non si installa. **Spento di default**:
si accende con `MESHCENTRAL_SENZA_AGENTE=1` in `.env.local` (riavvio del servizio).

- Nella scheda host (tab Generale), se l'host **non ha** un nodo MeshCentral, la
  card «Controllo remoto» mostra «Desktop remoto (RDP)» quando la scansione ha
  trovato la 3389 o l'host è Windows, e «VNC» quando ha trovato la 5900-5902 →
  `/rmm/[hostId]/senza-agente?p=rdp|vnc`.
- In **Discovery** RDP e VNC sono anche nel menu dei tre puntini, e RDP e SSH fra
  le icone della colonna Profilo (colorate se la scansione ha visto la porta,
  grigie ma cliccabili altrimenti).
- Se la scansione non ha visto la porta si usa quella standard (3389, 5900): la
  scansione veloce può non vederla, e se è chiusa lo dice MeshCentral.
- Al primo clic DA-IPAM crea in MeshCentral il gruppo **«Domarc Senza Agente»**
  (meshtype 3, «Local devices», **senza** relayid) e il device con l'IP dell'host
  (`addlocaldevice`). Nessuna sincronizzazione di massa; `mesh-sync` ignora questi
  nodi (`agentless`), così non figurano come agenti offline.
- È il **server MeshCentral** a collegarsi all'IP (relay locale): sta
  sull'appliance nella LAN del cliente, quindi niente agente ponte. Un host di
  un'altra sede si raggiunge dall'appliance di quella sede.
- RDP: `mstsc.html?login=<token monouso>&node=<id>&port=3389`. VNC: cookie da
  `getcookie` + `novnc/vnc.html` su `localrelay.ashx`, come la console MeshCentral.
- **Credenziali**: restano in DA-IPAM. MeshCentral non ha un'API per riceverle,
  quindi la sessione le chiede. La casella «ricorda» di MeshCentral le salverebbe
  sull'utenza di servizio, cioè per tutti gli operatori.
- Audit in `mc_remote_session` con `viewmode` 21 (RDP) / 22 (VNC), `node_id` nullo.
- **SSH** non passa da MeshCentral: con la 22 aperta la stessa card apre il
  terminale SSH di DA-IPAM (`components/ssh-terminal`), che usa le credenziali
  salvate dell'host. Sempre attivo, senza flag.
- Codice: `src/lib/integrations/meshcentral/senza-agente.ts`, rotta
  `host/[hostId]/senza-agente`.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `meshcentral`.
- `src/lib/integrations/meshcentral/install.ts` — provisioning one-click.
- `src/lib/integrations/meshcentral/control-client.ts` — client `control.ashx`
  (listNodes/listMeshes/addMesh/runCommand; `isSelfHostResolved`).
- `src/lib/integrations/meshcentral/{config,login-token,deep-link,tls-fetch}.ts`.
- `src/lib/integrations/meshcentral/{mesh-sync,node-resolver,run-command,schema}.ts`.
- `src/lib/master-password.ts` — password master condivisa (vault).
- `src/app/(dashboard)/rmm/` — UI: elenco endpoint + sessione `/rmm/[hostId]`.
- `src/components/rmm/command-panel.tsx` — pannello comandi nativo.
- `src/components/settings/meshcentral-install-dialog.tsx` — wizard installazione.
- `src/app/api/integrations/meshcentral/**` — config, nodes, bind, host-status,
  install-script, remote-session, run-command, install.
