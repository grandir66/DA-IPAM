# Vulnerabilities (Scanner-Edge) — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `edge` nel registry) che gestisce
dentro DA-IPAM i findings CVE prodotti dall'appliance **Scanner-Edge**
(Greenbone CE / OpenVAS + nuclei). DA-IPAM non esegue lo scan: lo lancia e ne
importa i risultati tramite il client edge, archiviandoli nel DB tenant per
correlarli con gli host dell'inventario. La pagina nativa è `/vulnerabilities`.

L'appliance Scanner-Edge esiste anche standalone (integrazione con DA-Vul-can):
dentro DA-IPAM la gestione findings è nativa, mentre la connessione all'edge è
solo configurazione (tabella tenant `vuln_scanners`). La UI edge completa
(Greenbone, scan, reti) resta raggiungibile come `externalUiUrl` su porta `:6443`.

## Funzioni principali

- **Pairing scanner-edge con TOFU + SPKI pinning**: al primo "Test connessione"
  DA-IPAM legge `/api/v1/cert/info` via TLS senza verifica CA, calcola il pin
  SPKI (RFC 7469 `sha256/<base64>`) e — dopo conferma — lo salva in
  `vuln_scanners.cert_pin`. Ogni chiamata HTTPS successiva verifica il pin;
  mismatch → fail (sospetto MITM o edge sostituito). HTTP plaintext supportato
  per backward-compat (pinning saltato).
- **Sync incrementale findings**: `runVulnSync()` legge il singolo scanner
  abilitato, chiama `GET /api/v1/scans?since=...` e `GET /api/v1/cve?since=...`
  paginato, inserisce le scan run (`vuln_scan_runs`, idempotente su
  `UNIQUE(scanner_id, edge_scan_id)`) e i findings append-only (`vuln_findings`).
- **Match host**: ogni finding viene correlato a `hosts` su `(ip, network_id)`;
  match singolo assegna `host_id`, ambiguità/zero match → `host_id NULL`.
- **Auto-disable**: dopo 5 errori consecutivi il cron disabilita lo scanner
  (`enabled=0`, `auto_disabled_at`) per evitare retry muti.
- **Lancio scan da rete**: avvio scan edge per una rete via
  `/api/networks/[id]/edge-scan`; spinta degli host noti verso l'edge
  (`pushHostsToEdge` / edge-subnet-bridge) per il targeting.
- **Vista findings**: aggregazione per CVE/NVT con severità e CVSS nella pagina
  `/vulnerabilities` e per singolo host.

## Come si usa

1. **Configurazione**: in `/settings?tab=moduli#module-edge` si compila la card
   edge (o si importa il JSON dell'installer): `base_url` + token. Token cifrato
   AES-GCM (`token_encrypted`).
2. **Test connessione**: pairing TOFU; accettazione del pin SPKI.
3. **Scan**: dalla pagina rete (`/networks`) → "edge-scan" si lancia uno scan
   sulla subnet; gli host noti vengono spinti all'edge.
4. **Sync**: il cron (`vuln_sync`) importa periodicamente scan finite e findings;
   sync manuale via `/api/integrations/scanner-edge/sync`.
5. **Consultazione**: i CVE compaiono in `/vulnerabilities` e nella scheda host
   (`/hosts/[id]/vulnerabilities`).

## Architettura e integrazioni

- DA-IPAM gira in **systemd** (non Docker). Lo Scanner-Edge è un'appliance a sé
  (FastAPI + Greenbone CE in Docker) raggiunta via HTTPS con SPKI pinning.
- Trasporto raw `node:https` / `node:tls` (no undici, no dipendenze extra) per
  poter controllare `checkServerIdentity` e il pinning.
- Storage tutto sul **DB tenant** (`vuln_scanners`, `vuln_scan_runs`,
  `vuln_findings`); nessuno stato sull'hub.
- Lo scheduler cron invoca `runVulnSync()` in contesto `withTenant`.
- Connessione gestita come configurazione del modulo; lo stato (installed /
  configured / enabled) è calcolato in `resolveModules()`.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `edge` (native, `/vulnerabilities`).
- `src/lib/vuln/scanner-edge-client.ts` — client HTTP/HTTPS con TOFU + SPKI pinning.
- `src/lib/vuln/sync-job.ts` — `runVulnSync()`, sync incrementale findings.
- `src/lib/vuln/edge-scanner-db.ts` — `getActiveEdgeScanner()` (singleton tenant).
- `src/lib/vuln/edge-subnet-bridge.ts` — push host noti all'edge.
- `src/lib/vuln/edge-schedule-store.ts`, `edge-credentials-bridge.ts`, `cron-builder.ts`.
- `src/app/(dashboard)/vulnerabilities/page.tsx` + `vulnerabilities-list-client.tsx`.
- `src/app/api/vulnerabilities/route.ts` + `[key]/hosts/route.ts`.
- `src/app/api/networks/[id]/edge-scan/route.ts` — lancio scan per rete.
- `src/app/api/integrations/scanner-edge/{route,test,sync}.ts`.
- `src/lib/db-tenant-schema.ts` — tabelle `vuln_scanners`, `vuln_scan_runs`, `vuln_findings`.
