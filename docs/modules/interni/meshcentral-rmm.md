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

- **Certificato self-signed su :4443**: al primo controllo remoto il browser
  dell'operatore blocca l'iframe finché non accetta una volta il certificato di
  `https://<host>:4443`. La UI mostra un banner con il link per farlo. Fix
  permanente: cert valido su :4443 (backlog).
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
