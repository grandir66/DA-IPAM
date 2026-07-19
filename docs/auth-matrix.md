# Matrice auth API — DA-IPAM

> Generato da `scripts/audit-api-auth.ts` · 2026-07-19 · analisi euristica, i FLAG vanno confermati.

## Riepilogo

- Route file analizzati: **268**
- Endpoint (metodo×route): **399**

Modello: `withTenantFromSession` impone l'autenticazione (401 senza sessione) ma **non il ruolo**. Quindi una *lettura* `session-only` è protetta quanto `auth`. Il rischio è: **mutazioni** senza ruolo admin, e **letture sensibili** (credenziali/segreti/trigger) che dovrebbero essere admin.

- 🔴 **FLAG (mutazione senza requireAdmin, o nessuna guardia): 11**
  - mutazioni (POST/PUT/PATCH/DELETE) eseguibili da viewer: **6**
  - endpoint `none` (nessuna guardia rilevata, non pubblici): **7**
- 🟡 **REVIEW (letture sensibili da valutare admin + POST): 9**

Distribuzione guardia attuale: `superadmin`=0 · `admin`=237 · `auth`=99 · `session-only`=50 · `none`=13

## 🔴 FLAG — da correggere (Wave 1)

| Route | Metodo | Attuale | Target | Nota |
|---|---|---|---|---|
| `/api/integrations/inventory-agent/install/linux.sh` | GET | `none` | `auth` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/integrations/inventory-agent/install/macos.sh` | GET | `none` | `auth` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/integrations/inventory-agent/install/windows.ps1` | GET | `none` | `auth` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/integrations/meshcentral/host-status` | POST | `auth` | `admin` | mutazione eseguibile da viewer → requireAdmin |
| `/api/integrations/wazuh/host-status` | POST | `auth` | `admin` | mutazione eseguibile da viewer → requireAdmin |
| `/api/inventory/ingest` | GET | `none` | `auth` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/inventory/ingest` | POST | `none` | `admin` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/networks/export-csv` | POST | `auth` | `admin` | mutazione eseguibile da viewer → requireAdmin |
| `/api/onboarding/complete` | POST | `none` | `admin` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/onboarding/status` | GET | `none` | `auth` | NESSUNA guardia rilevata (verifica: helper interno?) |
| `/api/user/preferences` | PUT | `auth` | `admin` | mutazione eseguibile da viewer → requireAdmin |

## 🟡 REVIEW — letture sensibili da valutare (Wave 1)

| Route | Metodo | Attuale | Nota |
|---|---|---|---|
| `/api/client-config/export` | GET | `auth` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/credentials` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/credentials/[id]` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/devices/[id]/credentials` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/export` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/hosts/[id]/credentials` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/integrations/[component]/test-connection` | GET | `auth` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/inventory/export` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |
| `/api/networks/[id]/credentials` | GET | `session-only` | lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST |

## Inventario completo

| Route | Metodo | Attuale | Target | Flag |
|---|---|---|---|---|
| `/api/integrations/inventory-agent/install/linux.sh` | GET | `none` | `auth` | 🔴 |
| `/api/integrations/inventory-agent/install/macos.sh` | GET | `none` | `auth` | 🔴 |
| `/api/integrations/inventory-agent/install/windows.ps1` | GET | `none` | `auth` | 🔴 |
| `/api/integrations/meshcentral/host-status` | POST | `auth` | `admin` | 🔴 |
| `/api/integrations/wazuh/host-status` | POST | `auth` | `admin` | 🔴 |
| `/api/inventory/ingest` | GET | `none` | `auth` | 🔴 |
| `/api/inventory/ingest` | POST | `none` | `admin` | 🔴 |
| `/api/networks/export-csv` | POST | `auth` | `admin` | 🔴 |
| `/api/onboarding/complete` | POST | `none` | `admin` | 🔴 |
| `/api/onboarding/status` | GET | `none` | `auth` | 🔴 |
| `/api/user/preferences` | PUT | `auth` | `admin` | 🔴 |
| `/api/ad` | GET | `session-only` | `auth` |  |
| `/api/ad` | POST | `admin` | `admin` |  |
| `/api/ad-setup/manual` | GET | `auth` | `auth` |  |
| `/api/ad/[id]` | DELETE | `admin` | `admin` |  |
| `/api/ad/[id]` | GET | `session-only` | `auth` |  |
| `/api/ad/[id]` | PUT | `admin` | `admin` |  |
| `/api/ad/[id]/computers` | GET | `session-only` | `auth` |  |
| `/api/ad/[id]/dhcp-leases` | GET | `session-only` | `auth` |  |
| `/api/ad/[id]/groups` | GET | `session-only` | `auth` |  |
| `/api/ad/[id]/sync` | GET | `session-only` | `auth` |  |
| `/api/ad/[id]/sync` | POST | `admin` | `admin` |  |
| `/api/ad/[id]/test` | POST | `admin` | `admin` |  |
| `/api/ad/[id]/users` | GET | `session-only` | `auth` |  |
| `/api/ad/kerberos` | GET | `session-only` | `auth` |  |
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
| `/api/asset-assignees` | GET | `session-only` | `auth` |  |
| `/api/asset-assignees` | POST | `admin` | `admin` |  |
| `/api/asset-assignees/[id]` | DELETE | `admin` | `admin` |  |
| `/api/asset-assignees/[id]` | GET | `session-only` | `auth` |  |
| `/api/asset-assignees/[id]` | PUT | `admin` | `admin` |  |
| `/api/auth/change-password` | POST | `none` | `public` |  |
| `/api/auth/select-tenant` | POST | `none` | `public` |  |
| `/api/backup` | GET | `admin` | `auth` |  |
| `/api/classifications/custom` | GET | `auth` | `auth` |  |
| `/api/classifications/custom` | POST | `admin` | `admin` |  |
| `/api/classifications/custom/[slug]` | DELETE | `admin` | `admin` |  |
| `/api/classifications/custom/[slug]` | GET | `auth` | `auth` |  |
| `/api/classifications/custom/[slug]` | PUT | `admin` | `admin` |  |
| `/api/client-config` | DELETE | `admin` | `admin` |  |
| `/api/client-config` | GET | `auth` | `auth` |  |
| `/api/client-config` | PUT | `admin` | `admin` |  |
| `/api/client-config/export` | GET | `auth` | `auth` | 🟡 |
| `/api/client-config/import` | POST | `admin` | `admin` |  |
| `/api/credentials` | GET | `session-only` | `auth` | 🟡 |
| `/api/credentials` | POST | `admin` | `admin` |  |
| `/api/credentials/[id]` | DELETE | `admin` | `admin` |  |
| `/api/credentials/[id]` | GET | `session-only` | `auth` | 🟡 |
| `/api/credentials/[id]` | PUT | `admin` | `admin` |  |
| `/api/credentials/[id]/test` | POST | `admin` | `admin` |  |
| `/api/credentials/[id]/test-snmp` | GET | `admin` | `auth` |  |
| `/api/custom-oui` | GET | `auth` | `auth` |  |
| `/api/custom-oui` | PUT | `admin` | `admin` |  |
| `/api/device-vendor-options` | GET | `session-only` | `auth` |  |
| `/api/devices` | GET | `session-only` | `auth` |  |
| `/api/devices` | POST | `admin` | `admin` |  |
| `/api/devices/[id]` | DELETE | `admin` | `admin` |  |
| `/api/devices/[id]` | GET | `session-only` | `auth` |  |
| `/api/devices/[id]` | PUT | `admin` | `admin` |  |
| `/api/devices/[id]/credentials` | GET | `session-only` | `auth` | 🟡 |
| `/api/devices/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/devices/[id]/mikrotik` | GET | `session-only` | `auth` |  |
| `/api/devices/[id]/mikrotik` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/proxmox-match` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/proxmox-scan` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/query` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/software-current` | GET | `auth` | `auth` |  |
| `/api/devices/[id]/software-scan` | POST | `admin` | `admin` |  |
| `/api/devices/[id]/software-scans` | GET | `auth` | `auth` |  |
| `/api/devices/[id]/test` | GET | `session-only` | `auth` |  |
| `/api/devices/bulk` | PATCH | `admin` | `admin` |  |
| `/api/devices/bulk` | POST | `admin` | `admin` |  |
| `/api/devices/bulk-scan` | POST | `admin` | `admin` |  |
| `/api/devices/detect-protocol` | POST | `admin` | `admin` |  |
| `/api/devices/test-provisional` | POST | `admin` | `admin` |  |
| `/api/dhcp-leases` | GET | `session-only` | `auth` |  |
| `/api/dhcp-leases` | POST | `admin` | `admin` |  |
| `/api/excluded-ips` | GET | `auth` | `auth` |  |
| `/api/export` | GET | `session-only` | `auth` | 🟡 |
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
| `/api/health` | GET | `none` | `public` |  |
| `/api/hosts` | GET | `session-only` | `auth` |  |
| `/api/hosts` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]` | DELETE | `admin` | `admin` |  |
| `/api/hosts/[id]` | GET | `session-only` | `auth` |  |
| `/api/hosts/[id]` | PUT | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | DELETE | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | GET | `session-only` | `auth` | 🟡 |
| `/api/hosts/[id]/credentials` | PATCH | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/hosts/[id]/fingerprint-explanation` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/inventory-agent` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/latency` | GET | `session-only` | `auth` |  |
| `/api/hosts/[id]/librenms` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/link-candidates` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/software-current` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/software-scan` | POST | `admin` | `admin` |  |
| `/api/hosts/[id]/software-scans` | GET | `auth` | `auth` |  |
| `/api/hosts/[id]/status-history` | GET | `session-only` | `auth` |  |
| `/api/hosts/[id]/vulnerabilities` | GET | `auth` | `auth` |  |
| `/api/hosts/bulk` | DELETE | `admin` | `admin` |  |
| `/api/hosts/bulk` | PATCH | `admin` | `admin` |  |
| `/api/hosts/bulk-update` | PATCH | `admin` | `admin` |  |
| `/api/hosts/discovery` | GET | `auth` | `auth` |  |
| `/api/integrations/[component]` | GET | `auth` | `auth` |  |
| `/api/integrations/[component]` | PUT | `admin` | `admin` |  |
| `/api/integrations/[component]/action` | POST | `admin` | `admin` |  |
| `/api/integrations/[component]/install` | POST | `admin` | `admin` |  |
| `/api/integrations/[component]/logs` | GET | `admin` | `auth` |  |
| `/api/integrations/[component]/test-connection` | GET | `auth` | `auth` | 🟡 |
| `/api/integrations/active` | GET | `auth` | `auth` |  |
| `/api/integrations/docker-status` | GET | `auth` | `auth` |  |
| `/api/integrations/install-docker` | POST | `admin` | `admin` |  |
| `/api/integrations/install-progress/[jobId]` | GET | `auth` | `auth` |  |
| `/api/integrations/inventory-agent` | GET | `auth` | `auth` |  |
| `/api/integrations/inventory-agent/install-script` | POST | `admin` | `admin` |  |
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
| `/api/integrations/meshcentral/host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/integrations/meshcentral/host/[hostId]/remote-session` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/host/[hostId]/run-command` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/install-script` | POST | `admin` | `admin` |  |
| `/api/integrations/meshcentral/nodes` | GET | `auth` | `auth` |  |
| `/api/integrations/scanner-edge` | DELETE | `admin` | `admin` |  |
| `/api/integrations/scanner-edge` | GET | `auth` | `auth` |  |
| `/api/integrations/scanner-edge` | PATCH | `admin` | `admin` |  |
| `/api/integrations/scanner-edge` | POST | `admin` | `admin` |  |
| `/api/integrations/scanner-edge/sync` | POST | `admin` | `admin` |  |
| `/api/integrations/scanner-edge/test` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/agents` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/agents/[agentId]` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/agents/[agentId]` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/config` | DELETE | `admin` | `admin` |  |
| `/api/integrations/wazuh/config` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/config` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/host-status` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/host/[hostId]` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/setup-script` | GET | `admin` | `auth` |  |
| `/api/integrations/wazuh/sync` | GET | `auth` | `auth` |  |
| `/api/integrations/wazuh/sync` | POST | `admin` | `admin` |  |
| `/api/integrations/wazuh/test` | POST | `admin` | `admin` |  |
| `/api/inventory` | GET | `session-only` | `auth` |  |
| `/api/inventory` | POST | `admin` | `admin` |  |
| `/api/inventory/[id]` | DELETE | `admin` | `admin` |  |
| `/api/inventory/[id]` | GET | `session-only` | `auth` |  |
| `/api/inventory/[id]` | PATCH | `admin` | `admin` |  |
| `/api/inventory/[id]/audit` | GET | `session-only` | `auth` |  |
| `/api/inventory/[id]/licenses` | GET | `session-only` | `auth` |  |
| `/api/inventory/[id]/services` | GET | `auth` | `auth` |  |
| `/api/inventory/[id]/sync-discovery` | POST | `admin` | `admin` |  |
| `/api/inventory/bulk` | PATCH | `admin` | `admin` |  |
| `/api/inventory/bulk-from-hosts` | POST | `admin` | `admin` |  |
| `/api/inventory/export` | GET | `session-only` | `auth` | 🟡 |
| `/api/inventory/gaps` | GET | `admin` | `auth` |  |
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
| `/api/licenses/[id]/seats` | GET | `session-only` | `auth` |  |
| `/api/licenses/[id]/seats` | POST | `admin` | `admin` |  |
| `/api/licenses/seats/[id]` | DELETE | `admin` | `admin` |  |
| `/api/locations` | GET | `admin` | `auth` |  |
| `/api/locations` | POST | `admin` | `admin` |  |
| `/api/locations/[id]` | DELETE | `admin` | `admin` |  |
| `/api/locations/[id]` | GET | `admin` | `auth` |  |
| `/api/locations/[id]` | PUT | `admin` | `admin` |  |
| `/api/mac-ip-mapping` | GET | `session-only` | `auth` |  |
| `/api/mdm/by-host/[hostId]` | GET | `auth` | `auth` |  |
| `/api/mdm/config` | GET | `admin` | `auth` |  |
| `/api/mdm/config` | PUT | `admin` | `admin` |  |
| `/api/mdm/sync` | POST | `admin` | `admin` |  |
| `/api/modules` | GET | `auth` | `auth` |  |
| `/api/modules/[key]/repair` | POST | `admin` | `admin` |  |
| `/api/modules/health` | GET | `admin` | `auth` |  |
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
| `/api/networks` | GET | `session-only` | `auth` |  |
| `/api/networks` | POST | `admin` | `admin` |  |
| `/api/networks/[id]` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]` | GET | `session-only` | `auth` |  |
| `/api/networks/[id]` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/apply-classifications` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/credentials` | GET | `session-only` | `auth` | 🟡 |
| `/api/networks/[id]/credentials` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/credentials` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | GET | `auth` | `auth` |  |
| `/api/networks/[id]/edge-scan` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/edge-scan` | PUT | `admin` | `admin` |  |
| `/api/networks/[id]/excluded-ips` | DELETE | `admin` | `admin` |  |
| `/api/networks/[id]/excluded-ips` | GET | `auth` | `auth` |  |
| `/api/networks/[id]/excluded-ips` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/refresh` | POST | `admin` | `admin` |  |
| `/api/networks/[id]/test-dns` | GET | `admin` | `auth` |  |
| `/api/networks/[id]/test-snmp` | GET | `admin` | `auth` |  |
| `/api/networks/bulk-assign-credential` | POST | `admin` | `admin` |  |
| `/api/networks/bulk-scan-devices` | POST | `admin` | `admin` |  |
| `/api/networks/with-credentials` | GET | `session-only` | `auth` |  |
| `/api/nmap-profiles` | DELETE | `admin` | `admin` |  |
| `/api/nmap-profiles` | GET | `admin` | `auth` |  |
| `/api/nmap-profiles` | POST | `admin` | `admin` |  |
| `/api/nmap-profiles` | PUT | `admin` | `admin` |  |
| `/api/onboarding/reset` | POST | `admin` | `admin` |  |
| `/api/patch/bootstrap` | POST | `admin` | `admin` |  |
| `/api/patch/cve` | GET | `session-only` | `auth` |  |
| `/api/patch/cve/[cveId]` | GET | `session-only` | `auth` |  |
| `/api/patch/cve/[cveId]/hosts` | GET | `session-only` | `auth` |  |
| `/api/patch/cve/[cveId]/match` | POST | `admin` | `admin` |  |
| `/api/patch/cve/[cveId]/match` | PUT | `admin` | `admin` |  |
| `/api/patch/device` | GET | `session-only` | `auth` |  |
| `/api/patch/device/[hostId]` | GET | `session-only` | `auth` |  |
| `/api/patch/install-meshagent` | POST | `admin` | `admin` |  |
| `/api/patch/install-wazuh` | GET | `session-only` | `auth` |  |
| `/api/patch/install-wazuh` | POST | `admin` | `admin` |  |
| `/api/patch/matcher/run` | POST | `admin` | `admin` |  |
| `/api/patch/operations` | GET | `session-only` | `auth` |  |
| `/api/patch/operations` | POST | `admin` | `admin` |  |
| `/api/patch/operations/[id]` | GET | `session-only` | `auth` |  |
| `/api/patch/operations/[id]/cancel` | POST | `admin` | `admin` |  |
| `/api/patch/operations/[id]/logs` | GET | `session-only` | `auth` |  |
| `/api/patch/probe` | POST | `admin` | `admin` |  |
| `/api/patch/software` | GET | `session-only` | `auth` |  |
| `/api/patch/software/[softwareKey]` | GET | `session-only` | `auth` |  |
| `/api/physical-devices/[id]/hosts` | GET | `auth` | `auth` |  |
| `/api/physical-devices/audit` | GET | `auth` | `auth` |  |
| `/api/physical-devices/link` | POST | `admin` | `admin` |  |
| `/api/physical-devices/unlink` | POST | `admin` | `admin` |  |
| `/api/reset` | POST | `admin` | `admin` |  |
| `/api/scan-config` | GET | `auth` | `auth` |  |
| `/api/scans/history` | GET | `session-only` | `auth` |  |
| `/api/scans/progress/[jobId]` | GET | `auth` | `auth` |  |
| `/api/scans/trigger` | POST | `admin` | `admin` |  |
| `/api/search` | GET | `session-only` | `auth` |  |
| `/api/services` | GET | `auth` | `auth` |  |
| `/api/services` | POST | `admin` | `admin` |  |
| `/api/services/[id]` | DELETE | `admin` | `admin` |  |
| `/api/services/[id]` | GET | `auth` | `auth` |  |
| `/api/services/[id]` | PUT | `admin` | `admin` |  |
| `/api/services/[id]/assets` | DELETE | `admin` | `admin` |  |
| `/api/services/[id]/assets` | GET | `auth` | `auth` |  |
| `/api/services/[id]/assets` | POST | `admin` | `admin` |  |
| `/api/settings` | GET | `auth` | `auth` |  |
| `/api/settings` | PUT | `admin` | `admin` |  |
| `/api/settings/hub-url` | GET | `auth` | `auth` |  |
| `/api/setup` | GET | `none` | `public` |  |
| `/api/setup` | POST | `none` | `public` |  |
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
| `/api/status/changes` | GET | `auth` | `auth` |  |
| `/api/status/chart` | GET | `session-only` | `auth` |  |
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
| `/api/tenants` | POST | `admin` | `admin` |  |
| `/api/tenants/[id]` | DELETE | `admin` | `admin` |  |
| `/api/tenants/[id]` | GET | `auth` | `auth` |  |
| `/api/tenants/[id]` | PUT | `admin` | `admin` |  |
| `/api/tenants/[id]/agent` | GET | `auth` | `auth` |  |
| `/api/tenants/[id]/agent` | PUT | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/test` | POST | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/token` | POST | `admin` | `admin` |  |
| `/api/tenants/[id]/agent/token/import` | POST | `admin` | `admin` |  |
| `/api/test-arp` | GET | `admin` | `auth` |  |
| `/api/test-snmp` | GET | `admin` | `auth` |  |
| `/api/tls` | GET | `admin` | `auth` |  |
| `/api/tls` | POST | `admin` | `admin` |  |
| `/api/user/preferences` | GET | `auth` | `auth` |  |
| `/api/users` | GET | `admin` | `auth` |  |
| `/api/users` | POST | `admin` | `admin` |  |
| `/api/users/[id]` | DELETE | `admin` | `admin` |  |
| `/api/users/[id]` | PUT | `admin` | `admin` |  |
| `/api/users/[id]/reset-password` | POST | `admin` | `admin` |  |
| `/api/version` | GET | `none` | `public` |  |
| `/api/vulnerabilities` | GET | `auth` | `auth` |  |
| `/api/vulnerabilities/[key]/hosts` | GET | `auth` | `auth` |  |
| `/api/winrm-setup/manual` | GET | `auth` | `auth` |  |
| `/api/winrm-setup/script` | GET | `auth` | `auth` |  |
