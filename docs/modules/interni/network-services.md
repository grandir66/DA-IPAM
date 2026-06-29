# Network Services (DNS / DHCP / AdGuard / Unbound) — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `network_services`) che porta dentro
DA-IPAM la gestione di **DNS, DHCP, AdGuard (ad-block), Unbound (resolver)**. La
UI nativa è `/network-services`. DA-IPAM non esegue direttamente i servizi:
parla con un **net-services bridge** (FastAPI ~300 LOC, ADR-0007) installato su
una VM dedicata che astrae i resolver/server sottostanti
(Unbound / AdGuard / PowerDNS / Kea). DA-IPAM consuma il bridge via REST con
Bearer token. È una **feature opzionale per tenant**.

## Funzioni principali

- **Feature flag + config cifrata**: stato su hub `tenant_features`
  (`feature_key='network_services'`), `config_json` cifrato AES-GCM con
  `{apiUrl, apiToken}`. `getNetServicesState()` ritorna `enabled` / `configured`.
  Backward-compat: fallback su env `NET_SERVICES_API_URL` / `..._TOKEN`.
- **Toggle servizi**: i 4 servizi sottostanti sono disabilitati di default;
  vengono attivati singolarmente via `POST /api/network-services/toggle/[service]`
  (resolver / adblock / dns / dhcp).
- **DHCP**: gestione subnet (`/dhcp/subnets`), reservation (`/dhcp/reservations`),
  lease (`/dhcp`) tramite Kea.
- **DNS autoritativo (PowerDNS)**: CRUD zone e record
  (`/dns/zones`, `/dns/zones/[zone]/records`), zone reverse, chain DNS.
- **Resolver (Unbound)**: forward zones (`/resolver/forwards`), upstream
  (`/resolver/upstream`), flush cache (`/resolver/cache/flush`).
- **Ad-block (AdGuard)**: regole (`/adblock/rules`), upstream (`/adblock/upstream`),
  flush cache (`/adblock/cache/flush`).
- **Setup / test**: wizard di setup (`/setup`), test connessione
  (`/test-connection`), stato bridge (`/status`).
- **Integrazione lease → host**: i lease DHCP alimentano l'inventario host
  (latency tipica ~60s via cron).

## Come si usa

1. **Provisioning bridge**: si crea la VM bridge (default IP `192.168.99.52/24`,
   bridge su `:8443` TLS) e si importa il JSON dell'installer.
2. **Installazione modulo**: card `/settings?tab=moduli#module-network_services`
   → la feature viene scritta su `tenant_features`, `apiUrl`/`apiToken` cifrati.
3. **Setup**: dalla pagina `/network-services` il wizard verifica la connessione
   al bridge.
4. **Attivazione servizi**: si abilitano singolarmente resolver / adblock / dns /
   dhcp; poi si gestiscono zone, record, subnet, reservation, regole dalla UI.

## Architettura e integrazioni

- DA-IPAM gira in **systemd**; il bridge è una **VM dedicata** separata.
- Trasporto via `node:https` con `rejectUnauthorized:false` (cert self-signed
  del bridge sulla rete interna), NON `fetch` (undici ignora `agent`).
- Tutte le chiamate al bridge sono autenticate con Bearer token cifrato at-rest.
- Sotto al bridge: Unbound (resolver), AdGuard (ad-block), PowerDNS (DNS auth),
  Kea (DHCP) — tutti gestiti dal bridge, non da DA-IPAM.
- Client factory `makeNetServicesClient(tenantCode)` legge la config dal tenant.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `network_services`.
- `src/lib/network-services/feature.ts` — feature flag + config cifrata.
- `src/lib/network-services/config.ts` — `getNetServicesConfig(tenantCode)`.
- `src/lib/network-services/client.ts` — thin client REST (`node:https`) verso il bridge.
- `src/lib/network-services/{dhcp-utils,dns-metrics,dns-ptr}.ts`.
- `src/app/(dashboard)/network-services/` — UI nativa.
- `src/app/api/network-services/**` — toggle, dhcp (subnets/reservations),
  dns (zones/records/reverse/chain), resolver (forwards/upstream/cache),
  adblock (rules/upstream/cache), setup, status, test-connection.
