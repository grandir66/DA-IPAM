# Matrice auth API — DA-IPAM

> Generato da `scripts/audit-api-auth.ts` · 2026-10-14 · rilevatore e censimento di `src/lib/permessi/` (gli stessi della prova `rotte-censite.test.ts`).

## Riepilogo

- File `route.ts`: **311** · gestori (metodo × rotta): **481**
- Forme di export: funzione 465 · destrutturata 2 · rinomina 14
- Guardie viste: `nessuna`=9 · `esterna`=2 · `token`=1 · `sessione`=52 · `auth-diretto`=3 · `auth`=129 · `admin-o-onboarding`=7 · `admin`=275 · `superadmin`=3
- Esiti: ok **448** · eccezioni **33** · debiti **0** · scoperti **0**

Livello atteso: GET/HEAD/OPTIONS → `auth`; scritture → `admin`; letture col nome sensibile → `admin`; i livelli dichiarati stanno in `ATTESI` di `src/lib/permessi/rotte.ts`. `withTenantFromSession` (`sessione`) chiede l'accesso ma non il ruolo: per una lettura vale quanto `auth`.

## Debiti (guardie da alzare)

| Rotta | Metodo | Guardia | Attesa | Nota |
|---|---|---|---|---|
| — | — | — | — | nessuna |

## Scoperti

| Rotta | Metodo | Guardia | Attesa | Nota |
|---|---|---|---|---|
| — | — | — | — | nessuna |

## Eccezioni dichiarate

| Rotta | Metodo | Guardia | Attesa | Nota |
|---|---|---|---|---|
| `/api/ad/healthcheck/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/auth/[...nextauth]` | GET | `esterna` | `auth` | pubblica: gestori di NextAuth: accesso e uscita |
| `/api/auth/[...nextauth]` | POST | `esterna` | `admin` | pubblica: gestori di NextAuth: accesso e uscita |
| `/api/auth/change-password` | POST | `auth-diretto` | `admin` | motivata: ogni utente cambia la propria password |
| `/api/auth/lock-state` | GET | `nessuna` | `auth` | pubblica: la pagina di accesso la interroga prima che esista una sessione |
| `/api/auth/select-tenant` | POST | `auth-diretto` | `admin` | motivata: sceglie il cliente della propria sessione |
| `/api/credentials/[id]` | GET | `sessione` | `admin` | mascherata: campi cifrati sostituiti dalla maschera |
| `/api/credentials` | GET | `sessione` | `admin` | mascherata: campi cifrati sostituiti dalla maschera |
| `/api/devices/[id]/credentials` | GET | `sessione` | `admin` | mascherata: password in linea sostituita dalla maschera |
| `/api/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/health` | GET | `nessuna` | `auth` | pubblica: controllo di salute per il monitoraggio |
| `/api/hosts/[id]/credentials` | GET | `sessione` | `admin` | mascherata: solo le associazioni host-credenziale, nessun campo cifrato |
| `/api/integrations/[component]` | GET | `auth` | `admin` | mascherata: token e password vuoti con i flag «impostato» per chi non è admin (SEC-5) |
| `/api/integrations/[component]/test-connection` | GET | `auth` | `admin` | motivata: prova solo l'indirizzo già salvato e risponde raggiungibile sì/no: non accetta indirizzi da chi chiama |
| `/api/integrations/inventory-agent/install/linux.sh` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/inventory-agent/install/macos.sh` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/inventory-agent/install/windows.ps1` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/meshcentral/host-status` | POST | `auth` | `admin` | motivata: lettura in blocco con l'elenco nel corpo (POST per la lunghezza): non scrive |
| `/api/integrations/proxy/librenms/[[...path]]` | POST | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | PUT | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | PATCH | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | DELETE | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/wazuh/host-status` | POST | `auth` | `admin` | motivata: lettura in blocco con l'elenco nel corpo (POST per la lunghezza): non scrive |
| `/api/inventory/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/inventory/ingest` | GET | `nessuna` | `auth` | pubblica: risponde solo con la descrizione del servizio |
| `/api/inventory/ingest` | POST | `token` | `admin` | pubblica: l'agente d'inventario si autentica col proprio token, non con una sessione |
| `/api/networks/[id]/credentials` | GET | `sessione` | `admin` | mascherata: solo le associazioni rete-credenziale, nessun campo cifrato |
| `/api/networks/export-csv` | POST | `auth` | `admin` | motivata: esportazione con l'elenco delle reti nel corpo: non scrive |
| `/api/settings` | GET | `auth` | `admin` | mascherata: chiavi dei segreti tolte per chi non è admin (SEC-5) |
| `/api/setup` | GET | `nessuna` | `auth` | pubblica: prima configurazione, prima che esista un utente |
| `/api/setup` | POST | `nessuna` | `admin` | pubblica: prima configurazione, prima che esista un utente |
| `/api/user/preferences` | PUT | `auth` | `admin` | motivata: preferenze del proprio utente |
| `/api/version` | GET | `nessuna` | `auth` | pubblica: versione installata, letta dall'aggiornamento |

## Inventario completo

| Rotta | Metodo | Guardia | Attesa | Nota |
|---|---|---|---|---|
| `/api/ad` | GET | `sessione` | `auth` |  |
| `/api/ad` | POST | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/ad-setup/manual` | GET | `auth` | `auth` |  |
| `/api/ad/[id]` | DELETE | `admin` | `admin` |  |
| `/api/ad/[id]` | GET | `sessione` | `auth` |  |
| `/api/ad/[id]` | PUT | `admin` | `admin` |  |
| `/api/ad/[id]/computers` | GET | `sessione` | `auth` |  |
| `/api/ad/[id]/dhcp-leases` | GET | `sessione` | `auth` |  |
| `/api/ad/[id]/groups` | GET | `sessione` | `auth` |  |
| `/api/ad/[id]/sync` | GET | `sessione` | `auth` |  |
| `/api/ad/[id]/sync` | POST | `admin` | `admin` |  |
| `/api/ad/[id]/test` | POST | `admin` | `admin` |  |
| `/api/ad/[id]/users` | GET | `sessione` | `auth` |  |
| `/api/ad/healthcheck` | GET | `sessione` | `auth` |  |
| `/api/ad/healthcheck` | POST | `admin` | `admin` |  |
| `/api/ad/healthcheck/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/ad/kerberos` | GET | `sessione` | `auth` |  |
| `/api/ad/kerberos` | POST | `admin` | `admin` |  |
| `/api/admin/backup-now` | POST | `admin` | `admin` |  |
| `/api/agents` | GET | `admin` | `auth` |  |
| `/api/analytics/anomalies` | GET | `auth` | `auth` |  |
| `/api/analytics/anomalies` | POST | `admin` | `admin` |  |
| `/api/analytics/anomalies/[id]` | DELETE | `admin` | `admin` |  |
| `/api/analytics/anomalies/[id]` | PATCH | `admin` | `admin` |  |
| `/api/analytics/classification/batch-refingerprint` | POST | `admin` | `admin` |  |
| `/api/analytics/classification/feedback` | GET | `auth` | `auth` |  |
| `/api/analytics/classification/feedback` | POST | `admin` | `admin` |  |
| `/api/asset-assignees` | GET | `sessione` | `auth` |  |
| `/api/asset-assignees` | POST | `admin` | `admin` |  |
| `/api/asset-assignees/[id]` | DELETE | `admin` | `admin` |  |
| `/api/asset-assignees/[id]` | GET | `sessione` | `auth` |  |
| `/api/asset-assignees/[id]` | PUT | `admin` | `admin` |  |
| `/api/attribution/credential-coverage` | GET | `auth` | `auth` |  |
| `/api/attribution/recompute` | POST | `admin` | `admin` |  |
| `/api/auth/[...nextauth]` | GET | `esterna` | `auth` | pubblica: gestori di NextAuth: accesso e uscita |
| `/api/auth/[...nextauth]` | POST | `esterna` | `admin` | pubblica: gestori di NextAuth: accesso e uscita |
| `/api/auth/change-password` | POST | `auth-diretto` | `admin` | motivata: ogni utente cambia la propria password |
| `/api/auth/lock-state` | GET | `nessuna` | `auth` | pubblica: la pagina di accesso la interroga prima che esista una sessione |
| `/api/auth/select-tenant` | POST | `auth-diretto` | `admin` | motivata: sceglie il cliente della propria sessione |
| `/api/backup` | GET | `admin` | `auth` |  |
| `/api/classifications/custom` | GET | `auth` | `auth` |  |
| `/api/classifications/custom` | POST | `admin` | `admin` |  |
| `/api/classifications/custom/[slug]` | DELETE | `admin` | `admin` |  |
| `/api/classifications/custom/[slug]` | GET | `auth` | `auth` |  |
| `/api/classifications/custom/[slug]` | PUT | `admin` | `admin` |  |
| `/api/client-config` | DELETE | `admin` | `admin` |  |
| `/api/client-config` | GET | `auth` | `auth` |  |
| `/api/client-config` | PUT | `admin` | `admin` |  |
| `/api/client-config/export` | GET | `admin` | `admin` |  |
| `/api/client-config/import` | POST | `admin` | `admin` |  |
| `/api/controllers` | GET | `auth` | `auth` |  |
| `/api/controllers` | POST | `admin` | `admin` |  |
| `/api/controllers/[id]` | DELETE | `admin` | `admin` |  |
| `/api/controllers/[id]` | GET | `auth` | `auth` |  |
| `/api/controllers/[id]` | PATCH | `admin` | `admin` |  |
| `/api/controllers/[id]` | PUT | `admin` | `admin` |  |
| `/api/controllers/[id]/cert-pin` | POST | `admin` | `admin` |  |
| `/api/controllers/[id]/sync` | POST | `admin` | `admin` |  |
| `/api/controllers/[id]/test` | POST | `admin` | `admin` |  |
| `/api/controllers/probe` | POST | `admin` | `admin` |  |
| `/api/credentials` | GET | `sessione` | `admin` | mascherata: campi cifrati sostituiti dalla maschera |
| `/api/credentials` | POST | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/credentials/[id]` | DELETE | `admin` | `admin` |  |
| `/api/credentials/[id]` | GET | `sessione` | `admin` | mascherata: campi cifrati sostituiti dalla maschera |
| `/api/credentials/[id]` | PUT | `admin` | `admin` |  |
| `/api/credentials/[id]/test` | POST | `admin` | `admin` |  |
| `/api/credentials/[id]/test-snmp` | GET | `admin` | `admin` |  |
| `/api/custom-oui` | GET | `auth` | `auth` |  |
| `/api/custom-oui` | PUT | `admin` | `admin` |  |
| `/api/device-vendor-options` | GET | `sessione` | `auth` |  |
| `/api/devices` | GET | `sessione` | `auth` |  |
| `/api/devices` | POST | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/devices/[id]` | DELETE | `admin` | `admin` |  |
| `/api/devices/[id]` | GET | `sessione` | `auth` |  |
| `/api/devices/[id]` | PUT | `admin` | `admin` |  |
| `/api/devices/[id]/credentials` | GET | `sessione` | `admin` | mascherata: password in linea sostituita dalla maschera |
| `/api/devices/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/devices/[id]/location` | GET | `auth` | `auth` |  |
| `/api/devices/[id]/location` | PUT | `admin` | `admin` |  |
| `/api/devices/[id]/mikrotik` | GET | `sessione` | `auth` |  |
| `/api/devices/[id]/mikrotik` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/proxmox-match` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/proxmox-scan` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/query` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/software-current` | GET | `auth` | `auth` |  |
| `/api/devices/[id]/software-scan` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/software-scans` | GET | `auth` | `auth` |  |
| `/api/devices/[id]/test` | GET | `sessione` | `auth` |  |
| `/api/devices/bulk` | PATCH | `admin` | `admin` |  |
| `/api/devices/bulk` | POST | `admin` | `admin` |  |
| `/api/devices/bulk-scan` | POST | `admin` | `admin` |  |
| `/api/devices/detect-protocol` | POST | `admin` | `admin` |  |
| `/api/devices/test-provisional` | POST | `admin` | `admin` |  |
| `/api/dhcp-leases` | GET | `sessione` | `auth` |  |
| `/api/dhcp-leases` | POST | `admin` | `admin` |  |
| `/api/excluded-ips` | GET | `auth` | `auth` |  |
| `/api/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/features` | GET | `auth` | `auth` |  |
| `/api/features/[key]` | GET | `auth` | `auth` |  |
| `/api/features/[key]/install` | POST | `admin` | `admin` |  |
| `/api/features/[key]/uninstall` | POST | `admin` | `admin` |  |
| `/api/fingerprint-classification-map` | GET | `auth` | `auth` |  |
| `/api/fingerprint-classification-map` | POST | `admin` | `admin` |  |
| `/api/fingerprint-classification-map/[id]` | DELETE | `admin` | `admin` |  |
| `/api/fingerprint-classification-map/[id]` | PUT | `admin` | `admin` |  |
| `/api/fingerprint-rules` | GET | `auth` | `auth` |  |
| `/api/fingerprint-rules` | POST | `admin` | `admin` |  |
| `/api/fingerprint-rules/[id]` | DELETE | `admin` | `admin` |  |
| `/api/fingerprint-rules/[id]` | PUT | `admin` | `admin` |  |
| `/api/health` | GET | `nessuna` | `auth` | pubblica: controllo di salute per il monitoraggio |
| `/api/hosts` | GET | `sessione` | `auth` |  |
| `/api/hosts` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]` | DELETE | `admin` | `admin` |  |
| `/api/hosts/[id]` | GET | `sessione` | `auth` |  |
| `/api/hosts/[id]` | PUT | `admin` | `admin` |  |
| `/api/hosts/[id]/attribution` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/attribution/override` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | DELETE | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | GET | `sessione` | `admin` | mascherata: solo le associazioni host-credenziale, nessun campo cifrato |
| `/api/hosts/[id]/credentials` | PATCH | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/hosts/[id]/fingerprint-explanation` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/inventory-agent` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/latency` | GET | `sessione` | `auth` |  |
| `/api/hosts/[id]/librenms` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/link-candidates` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/software-current` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/software-scan` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]/software-scans` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/status-history` | GET | `sessione` | `auth` |  |
| `/api/hosts/[id]/vulnerabilities` | GET | `auth` | `auth` |  |
| `/api/hosts/bulk` | DELETE | `admin` | `admin` |  |
| `/api/hosts/bulk` | PATCH | `admin` | `admin` |  |
| `/api/hosts/bulk-update` | PATCH | `admin` | `admin` |  |
| `/api/hosts/discovery` | GET | `auth` | `auth` |  |
| `/api/integrations/[component]` | GET | `auth` | `admin` | mascherata: token e password vuoti con i flag «impostato» per chi non è admin (SEC-5) |
| `/api/integrations/[component]` | PUT | `admin` | `admin` |  |
| `/api/integrations/[component]/action` | POST | `admin` | `admin` |  |
| `/api/integrations/[component]/install` | POST | `admin` | `admin` |  |
| `/api/integrations/[component]/logs` | GET | `admin` | `auth` |  |
| `/api/integrations/[component]/test-connection` | GET | `auth` | `admin` | motivata: prova solo l'indirizzo già salvato e risponde raggiungibile sì/no: non accetta indirizzi da chi chiama |
| `/api/integrations/active` | GET | `auth` | `auth` |  |
| `/api/integrations/docker-status` | GET | `auth` | `auth` |  |
| `/api/integrations/install-docker` | POST | `admin` | `admin` |  |
| `/api/integrations/install-progress/[jobId]` | GET | `admin` | `admin` |  |
| `/api/integrations/inventory-agent` | GET | `auth` | `auth` |  |
| `/api/integrations/inventory-agent/install-script` | POST | `admin` | `admin` |  |
| `/api/integrations/inventory-agent/install/linux.sh` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/inventory-agent/install/macos.sh` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/inventory-agent/install/windows.ps1` | GET | `nessuna` | `auth` | pubblica: script d'installazione scaricato dall'host del cliente, senza sessione |
| `/api/integrations/inventory-agent/token` | POST | `admin` | `admin` |  |
| `/api/integrations/librenms/device` | GET | `auth` | `auth` |  |
| `/api/integrations/librenms/device` | POST | `admin` | `admin` |  |
| `/api/integrations/librenms/graph` | GET | `auth` | `auth` |  |
| `/api/integrations/librenms/graph-list` | GET | `auth` | `auth` |  |
| `/api/integrations/librenms/host` | POST | `admin` | `admin` |  |
| `/api/integrations/librenms/sso` | GET | `auth` | `auth` |  |
| `/api/integrations/librenms/sync` | GET | `auth` | `auth` |  |
| `/api/integrations/librenms/sync` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/bind` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/config` | DELETE | `admin` | `admin` |  |
| `/api/integrations/meshcentral/config` | GET | `auth` | `auth` |  |
| `/api/integrations/meshcentral/config` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/host-status` | POST | `auth` | `admin` | motivata: lettura in blocco con l'elenco nel corpo (POST per la lunghezza): non scrive |
| `/api/integrations/meshcentral/host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/integrations/meshcentral/host/[hostId]/remote-session` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/host/[hostId]/run-command` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/install` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/install-script` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/nodes` | GET | `auth` | `auth` |  |
| `/api/integrations/meshcentral/nodes` | POST | `admin` | `admin` |  |
| `/api/integrations/proxy/librenms/[[...path]]` | DELETE | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | GET | `auth` | `auth` |  |
| `/api/integrations/proxy/librenms/[[...path]]` | HEAD | `auth` | `auth` |  |
| `/api/integrations/proxy/librenms/[[...path]]` | OPTIONS | `auth` | `auth` |  |
| `/api/integrations/proxy/librenms/[[...path]]` | PATCH | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | POST | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/librenms/[[...path]]` | PUT | `auth` | `admin` | motivata: proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6) |
| `/api/integrations/proxy/wazuh/[[...path]]` | DELETE | `admin` | `admin` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | GET | `auth` | `auth` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | HEAD | `auth` | `auth` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | OPTIONS | `auth` | `auth` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | PATCH | `admin` | `admin` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | POST | `admin` | `admin` |  |
| `/api/integrations/proxy/wazuh/[[...path]]` | PUT | `admin` | `admin` |  |
| `/api/integrations/scanner-edge` | DELETE | `admin` | `admin` |  |
| `/api/integrations/scanner-edge` | GET | `auth` | `auth` |  |
| `/api/integrations/scanner-edge` | PATCH | `admin` | `admin` |  |
| `/api/integrations/scanner-edge` | POST | `admin` | `admin` |  |
| `/api/integrations/scanner-edge/profiles` | GET | `auth` | `auth` |  |
| `/api/integrations/scanner-edge/sync` | POST | `admin` | `admin` |  |
| `/api/integrations/scanner-edge/test` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/agent-script` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/agents` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/agents/[agentId]` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/agents/[agentId]` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/alerts` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/alerts` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/alerts/[id]` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/alerts/config` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/alerts/config` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/alerts/stats` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/config` | DELETE | `admin` | `admin` |  |
| `/api/integrations/wazuh/config` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/config` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/health` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/health` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/host-status` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/host-status` | POST | `auth` | `admin` | motivata: lettura in blocco con l'elenco nel corpo (POST per la lunghezza): non scrive |
| `/api/integrations/wazuh/host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/host/[hostId]` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/setup-script` | GET | `admin` | `auth` |  |
| `/api/integrations/wazuh/sync` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/sync` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/test` | POST | `admin` | `admin` |  |
| `/api/inventory` | GET | `sessione` | `auth` |  |
| `/api/inventory` | POST | `admin` | `admin` |  |
| `/api/inventory/[id]` | DELETE | `admin` | `admin` |  |
| `/api/inventory/[id]` | GET | `sessione` | `auth` |  |
| `/api/inventory/[id]` | PATCH | `admin` | `admin` |  |
| `/api/inventory/[id]/audit` | GET | `sessione` | `auth` |  |
| `/api/inventory/[id]/licenses` | GET | `sessione` | `auth` |  |
| `/api/inventory/[id]/services` | GET | `auth` | `auth` |  |
| `/api/inventory/[id]/sync-discovery` | POST | `admin` | `admin` |  |
| `/api/inventory/bulk` | PATCH | `admin` | `admin` |  |
| `/api/inventory/bulk-from-hosts` | POST | `admin` | `admin` |  |
| `/api/inventory/export` | GET | `sessione` | `admin` | motivata: esporta gli stessi dati che l'utente vede nelle pagine, senza segreti |
| `/api/inventory/gaps` | GET | `admin` | `auth` |  |
| `/api/inventory/ingest` | GET | `nessuna` | `auth` | pubblica: risponde solo con la descrizione del servizio |
| `/api/inventory/ingest` | POST | `token` | `admin` | pubblica: l'agente d'inventario si autentica col proprio token, non con una sessione |
| `/api/inventory/sync-devices` | POST | `admin` | `admin` |  |
| `/api/inventory/sync-discovery-bulk` | POST | `admin` | `admin` |  |
| `/api/inventory/sync-hosts` | POST | `admin` | `admin` |  |
| `/api/jobs` | DELETE | `admin` | `admin` |  |
| `/api/jobs` | GET | `admin` | `auth` |  |
| `/api/jobs` | POST | `admin` | `admin` |  |
| `/api/jobs` | PUT | `admin` | `admin` |  |
| `/api/jobs/[id]/run` | POST | `admin` | `admin` |  |
| `/api/lab-config/reset` | POST | `admin` | `admin` |  |
| `/api/licenses` | GET | `admin` | `auth` |  |
| `/api/licenses` | POST | `admin` | `admin` |  |
| `/api/licenses/[id]` | DELETE | `admin` | `admin` |  |
| `/api/licenses/[id]` | GET | `admin` | `auth` |  |
| `/api/licenses/[id]` | PUT | `admin` | `admin` |  |
| `/api/licenses/[id]/seats` | GET | `sessione` | `auth` |  |
| `/api/licenses/[id]/seats` | POST | `admin` | `admin` |  |
| `/api/licenses/seats/[id]` | DELETE | `admin` | `admin` |  |
| `/api/locations` | GET | `admin` | `auth` |  |
| `/api/locations` | POST | `admin` | `admin` |  |
| `/api/locations/[id]` | DELETE | `admin` | `admin` |  |
| `/api/locations/[id]` | GET | `admin` | `auth` |  |
| `/api/locations/[id]` | PUT | `admin` | `admin` |  |
| `/api/locations/[id]/topology` | GET | `auth` | `auth` |  |
| `/api/locations/[id]/topology` | PUT | `admin` | `admin` |  |
| `/api/mac-ip-mapping` | GET | `sessione` | `auth` |  |
| `/api/mac-product-map` | GET | `auth` | `auth` |  |
| `/api/mac-product-map` | POST | `admin` | `admin` |  |
| `/api/mac-product-map/[id]` | DELETE | `admin` | `admin` |  |
| `/api/mac-product-map/[id]` | PUT | `admin` | `admin` |  |
| `/api/mdm/by-host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/mdm/config` | GET | `admin` | `auth` |  |
| `/api/mdm/config` | PUT | `admin` | `admin` |  |
| `/api/mdm/sync` | POST | `admin` | `admin` |  |
| `/api/modules` | GET | `auth` | `auth` |  |
| `/api/modules/[key]/repair` | POST | `admin` | `admin` |  |
| `/api/modules/health` | GET | `auth` | `auth` |  |
| `/api/modules/health` | POST | `admin` | `admin` |  |
| `/api/modules/import` | POST | `admin` | `admin` |  |
| `/api/modules/nis2-inventory` | GET | `auth` | `auth` |  |
| `/api/modules/nis2-inventory` | POST | `admin` | `admin` |  |
| `/api/monitoring/known-hosts/run-check` | POST | `admin` | `admin` |  |
| `/api/multihomed/recompute` | POST | `admin` | `admin` |  |
| `/api/network-services/adblock/cache/flush` | POST | `admin` | `admin` |  |
| `/api/network-services/adblock/rules` | DELETE | `admin` | `admin` |  |
| `/api/network-services/adblock/rules` | GET | `auth` | `auth` |  |
| `/api/network-services/adblock/rules` | POST | `admin` | `admin` |  |
| `/api/network-services/adblock/upstream` | GET | `auth` | `auth` |  |
| `/api/network-services/adblock/upstream` | PUT | `admin` | `admin` |  |
| `/api/network-services/dhcp` | GET | `auth` | `auth` |  |
| `/api/network-services/dhcp/reservations` | DELETE | `admin` | `admin` |  |
| `/api/network-services/dhcp/reservations` | GET | `auth` | `auth` |  |
| `/api/network-services/dhcp/reservations` | POST | `admin` | `admin` |  |
| `/api/network-services/dhcp/subnets` | GET | `auth` | `auth` |  |
| `/api/network-services/dhcp/subnets` | POST | `admin` | `admin` |  |
| `/api/network-services/dhcp/subnets/[id]` | DELETE | `admin` | `admin` |  |
| `/api/network-services/dhcp/subnets/[id]` | PATCH | `admin` | `admin` |  |
| `/api/network-services/dns/chain` | GET | `auth` | `auth` |  |
| `/api/network-services/dns/zones` | GET | `auth` | `auth` |  |
| `/api/network-services/dns/zones` | POST | `admin` | `admin` |  |
| `/api/network-services/dns/zones/[zone]/records` | DELETE | `admin` | `admin` |  |
| `/api/network-services/dns/zones/[zone]/records` | GET | `auth` | `auth` |  |
| `/api/network-services/dns/zones/[zone]/records` | POST | `admin` | `admin` |  |
| `/api/network-services/dns/zones/reverse` | POST | `admin` | `admin` |  |
| `/api/network-services/resolver/cache/flush` | POST | `admin` | `admin` |  |
| `/api/network-services/resolver/forwards` | DELETE | `admin` | `admin` |  |
| `/api/network-services/resolver/forwards` | GET | `auth` | `auth` |  |
| `/api/network-services/resolver/forwards` | POST | `admin` | `admin` |  |
| `/api/network-services/resolver/upstream` | GET | `auth` | `auth` |  |
| `/api/network-services/resolver/upstream` | PUT | `admin` | `admin` |  |
| `/api/network-services/setup` | DELETE | `admin` | `admin` |  |
| `/api/network-services/setup` | GET | `auth` | `auth` |  |
| `/api/network-services/setup` | POST | `admin` | `admin` |  |
| `/api/network-services/status` | GET | `auth` | `auth` |  |
| `/api/network-services/test-connection` | POST | `admin` | `admin` |  |
| `/api/network-services/toggle/[service]` | POST | `admin` | `admin` |  |
| `/api/networks` | GET | `sessione` | `auth` |  |
| `/api/networks` | POST | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/networks/[id]` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]` | GET | `sessione` | `auth` |  |
| `/api/networks/[id]` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/credentials` | GET | `sessione` | `admin` | mascherata: solo le associazioni rete-credenziale, nessun campo cifrato |
| `/api/networks/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | GET | `auth` | `auth` |  |
| `/api/networks/[id]/edge-scan` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/excluded-ips` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]/excluded-ips` | GET | `auth` | `auth` |  |
| `/api/networks/[id]/excluded-ips` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/scan-phases` | GET | `auth` | `auth` |  |
| `/api/networks/[id]/test-dns` | GET | `admin` | `admin` |  |
| `/api/networks/[id]/test-snmp` | GET | `admin` | `admin` |  |
| `/api/networks/bulk-assign-credential` | POST | `admin` | `admin` |  |
| `/api/networks/bulk-scan-devices` | POST | `admin` | `admin` |  |
| `/api/networks/export-csv` | POST | `auth` | `admin` | motivata: esportazione con l'elenco delle reti nel corpo: non scrive |
| `/api/networks/with-credentials` | GET | `sessione` | `auth` |  |
| `/api/nmap-profiles` | DELETE | `admin` | `admin` |  |
| `/api/nmap-profiles` | GET | `admin` | `auth` |  |
| `/api/nmap-profiles` | POST | `admin` | `admin` |  |
| `/api/nmap-profiles` | PUT | `admin` | `admin` |  |
| `/api/notifications/config` | GET | `auth` | `auth` |  |
| `/api/notifications/config` | POST | `admin` | `admin` |  |
| `/api/notifications/test` | POST | `admin` | `admin` |  |
| `/api/onboarding/complete` | POST | `admin` | `admin` |  |
| `/api/onboarding/reset` | POST | `admin` | `admin` |  |
| `/api/onboarding/status` | GET | `auth-diretto` | `auth` |  |
| `/api/patch/bootstrap` | POST | `admin` | `admin` |  |
| `/api/patch/cve` | GET | `sessione` | `auth` |  |
| `/api/patch/cve/[cveId]` | GET | `sessione` | `auth` |  |
| `/api/patch/cve/[cveId]/hosts` | GET | `sessione` | `auth` |  |
| `/api/patch/cve/[cveId]/match` | POST | `admin` | `admin` |  |
| `/api/patch/cve/[cveId]/match` | PUT | `admin` | `admin` |  |
| `/api/patch/device` | GET | `sessione` | `auth` |  |
| `/api/patch/device/[hostId]` | GET | `sessione` | `auth` |  |
| `/api/patch/install-glpi-agent-choco` | POST | `admin` | `admin` |  |
| `/api/patch/install-linux-ssh` | POST | `admin` | `admin` |  |
| `/api/patch/install-meshagent` | POST | `admin` | `admin` |  |
| `/api/patch/install-meshagent-choco` | POST | `admin` | `admin` |  |
| `/api/patch/install-wazuh` | GET | `sessione` | `auth` |  |
| `/api/patch/install-wazuh` | POST | `admin` | `admin` |  |
| `/api/patch/matcher/run` | POST | `admin` | `admin` |  |
| `/api/patch/operations` | GET | `sessione` | `auth` |  |
| `/api/patch/operations` | POST | `admin` | `admin` |  |
| `/api/patch/operations/[id]` | GET | `sessione` | `auth` |  |
| `/api/patch/operations/[id]/cancel` | POST | `admin` | `admin` |  |
| `/api/patch/operations/[id]/logs` | GET | `sessione` | `auth` |  |
| `/api/patch/probe` | POST | `admin` | `admin` |  |
| `/api/patch/software` | GET | `sessione` | `auth` |  |
| `/api/patch/software/[softwareKey]` | GET | `sessione` | `auth` |  |
| `/api/patch/uninstall` | POST | `admin` | `admin` |  |
| `/api/physical-devices/[id]/hosts` | GET | `auth` | `auth` |  |
| `/api/physical-devices/audit` | GET | `auth` | `auth` |  |
| `/api/physical-devices/link` | POST | `admin` | `admin` |  |
| `/api/physical-devices/unlink` | POST | `admin` | `admin` |  |
| `/api/reset` | POST | `admin` | `admin` |  |
| `/api/scan-config` | GET | `auth` | `auth` |  |
| `/api/scans/history` | GET | `sessione` | `auth` |  |
| `/api/scans/progress/[jobId]` | GET | `auth` | `auth` |  |
| `/api/scans/trigger` | POST | `admin` | `admin` |  |
| `/api/search` | GET | `sessione` | `auth` |  |
| `/api/services` | GET | `auth` | `auth` |  |
| `/api/services` | POST | `admin` | `admin` |  |
| `/api/services/[id]` | DELETE | `admin` | `admin` |  |
| `/api/services/[id]` | GET | `auth` | `auth` |  |
| `/api/services/[id]` | PUT | `admin` | `admin` |  |
| `/api/services/[id]/assets` | DELETE | `admin` | `admin` |  |
| `/api/services/[id]/assets` | GET | `auth` | `auth` |  |
| `/api/services/[id]/assets` | POST | `admin` | `admin` |  |
| `/api/settings` | GET | `auth` | `admin` | mascherata: chiavi dei segreti tolte per chi non è admin (SEC-5) |
| `/api/settings` | PUT | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/settings/hub-url` | GET | `auth` | `auth` |  |
| `/api/setup` | GET | `nessuna` | `auth` | pubblica: prima configurazione, prima che esista un utente |
| `/api/setup` | POST | `nessuna` | `admin` | pubblica: prima configurazione, prima che esista un utente |
| `/api/snmp-profiles` | GET | `auth` | `auth` |  |
| `/api/snmp-profiles` | POST | `admin` | `admin` |  |
| `/api/snmp-profiles/[id]` | DELETE | `admin` | `admin` |  |
| `/api/snmp-profiles/[id]` | GET | `auth` | `auth` |  |
| `/api/snmp-profiles/[id]` | PATCH | `admin` | `admin` |  |
| `/api/snmp-profiles/[id]` | PUT | `admin` | `admin` |  |
| `/api/snmp-profiles/oid-library` | GET | `auth` | `auth` |  |
| `/api/software` | GET | `auth` | `auth` |  |
| `/api/software-scans/[scanId]` | GET | `auth` | `auth` |  |
| `/api/software-scans/[scanId]/diff` | GET | `auth` | `auth` |  |
| `/api/software/[key]/hosts` | GET | `auth` | `auth` |  |
| `/api/ssh-terminal/token` | POST | `admin` | `admin` |  |
| `/api/status/changes` | GET | `auth` | `auth` |  |
| `/api/status/chart` | GET | `sessione` | `auth` |  |
| `/api/status/chart-detailed` | GET | `auth` | `auth` |  |
| `/api/sysobj-lookup` | GET | `auth` | `auth` |  |
| `/api/sysobj-lookup` | POST | `admin` | `admin` |  |
| `/api/sysobj-lookup/[id]` | DELETE | `admin` | `admin` |  |
| `/api/sysobj-lookup/[id]` | PUT | `admin` | `admin` |  |
| `/api/system-credentials` | GET | `auth` | `auth` |  |
| `/api/system-credentials` | POST | `admin` | `admin` |  |
| `/api/system-credentials/[id]` | DELETE | `admin` | `admin` |  |
| `/api/system-credentials/[id]` | GET | `auth` | `auth` |  |
| `/api/system-credentials/[id]` | PUT | `admin` | `admin` |  |
| `/api/system-credentials/[id]/reveal` | POST | `admin` | `admin` |  |
| `/api/system-credentials/[id]/test` | POST | `admin` | `admin` |  |
| `/api/system-credentials/bootstrap` | POST | `admin` | `admin` |  |
| `/api/system-credentials/dedup` | POST | `admin` | `admin` |  |
| `/api/system-credentials/seed-defaults` | POST | `admin` | `admin` |  |
| `/api/system-credentials/sync` | POST | `admin` | `admin` |  |
| `/api/system/promote` | DELETE | `admin` | `admin` |  |
| `/api/system/promote` | GET | `admin` | `auth` |  |
| `/api/system/promote` | POST | `admin` | `admin` |  |
| `/api/system/promote` | PUT | `admin` | `admin` |  |
| `/api/system/update` | GET | `auth` | `auth` |  |
| `/api/system/update` | POST | `admin` | `admin` |  |
| `/api/system/update-channel` | GET | `auth` | `auth` |  |
| `/api/system/update-channel` | PUT | `admin` | `admin` |  |
| `/api/tenant-agents` | GET | `auth` | `auth` |  |
| `/api/tenant-agents` | POST | `admin` | `admin` |  |
| `/api/tenant-agents/[id]` | DELETE | `admin` | `admin` |  |
| `/api/tenant-agents/[id]` | GET | `auth` | `auth` |  |
| `/api/tenant-agents/[id]` | PUT | `admin` | `admin` |  |
| `/api/tenant-agents/[id]/test` | POST | `admin` | `admin` |  |
| `/api/tenant-agents/[id]/token` | POST | `admin` | `admin` |  |
| `/api/tenant-agents/[id]/token/import` | POST | `admin` | `admin` |  |
| `/api/tenant/export` | POST | `admin` | `admin` |  |
| `/api/tenant/import` | POST | `admin` | `admin` |  |
| `/api/tenants` | GET | `auth` | `auth` |  |
| `/api/tenants` | POST | `superadmin` | `admin` |  |
| `/api/tenants/[id]` | DELETE | `superadmin` | `admin` |  |
| `/api/tenants/[id]` | GET | `auth` | `auth` |  |
| `/api/tenants/[id]` | PUT | `superadmin` | `admin` |  |
| `/api/tenants/[id]/agent` | GET | `auth` | `auth` |  |
| `/api/tenants/[id]/agent` | PUT | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/test` | POST | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/token` | POST | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/token/import` | POST | `admin` | `admin` |  |
| `/api/test-arp` | GET | `admin` | `admin` |  |
| `/api/test-snmp` | GET | `admin` | `admin` |  |
| `/api/tls` | GET | `admin-o-onboarding` | `auth` |  |
| `/api/tls` | POST | `admin-o-onboarding` | `admin-o-onboarding` |  |
| `/api/topology/links` | GET | `auth` | `auth` |  |
| `/api/topology/links` | POST | `admin` | `admin` |  |
| `/api/topology/links/[id]` | DELETE | `admin` | `admin` |  |
| `/api/topology/links/[id]` | PATCH | `admin` | `admin` |  |
| `/api/topology/maps` | GET | `auth` | `auth` |  |
| `/api/topology/maps` | POST | `admin` | `admin` |  |
| `/api/topology/maps/[id]` | DELETE | `admin` | `admin` |  |
| `/api/topology/maps/[id]` | GET | `auth` | `auth` |  |
| `/api/topology/maps/[id]` | PATCH | `admin` | `admin` |  |
| `/api/topology/maps/[id]` | PUT | `admin` | `admin` |  |
| `/api/topology/maps/[id]/nodes` | PUT | `admin` | `admin` |  |
| `/api/topology/model` | GET | `auth` | `auth` |  |
| `/api/topology/nodes/hidden` | PUT | `admin` | `admin` |  |
| `/api/topology/ports` | GET | `auth` | `auth` |  |
| `/api/topology/positions` | PUT | `admin` | `admin` |  |
| `/api/topology/primary` | DELETE | `admin` | `admin` |  |
| `/api/topology/primary` | PUT | `admin` | `admin` |  |
| `/api/topology/settings` | GET | `auth` | `auth` |  |
| `/api/topology/settings` | PUT | `admin` | `admin` |  |
| `/api/topology/settings/hypervisor` | GET | `auth` | `auth` |  |
| `/api/topology/settings/hypervisor` | PUT | `admin` | `admin` |  |
| `/api/user/preferences` | GET | `auth` | `auth` |  |
| `/api/user/preferences` | PUT | `auth` | `admin` | motivata: preferenze del proprio utente |
| `/api/users` | GET | `admin` | `auth` |  |
| `/api/users` | POST | `admin` | `admin` |  |
| `/api/users/[id]` | DELETE | `admin` | `admin` |  |
| `/api/users/[id]` | PUT | `admin` | `admin` |  |
| `/api/users/[id]/reset-password` | POST | `admin` | `admin` |  |
| `/api/version` | GET | `nessuna` | `auth` | pubblica: versione installata, letta dall'aggiornamento |
| `/api/vulnerabilities` | GET | `auth` | `auth` |  |
| `/api/vulnerabilities/[key]/hosts` | GET | `auth` | `auth` |  |
| `/api/winrm-setup/manual` | GET | `auth` | `auth` |  |
| `/api/winrm-setup/script` | GET | `auth` | `auth` |  |
