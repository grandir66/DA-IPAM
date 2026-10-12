# Integrazione controller UniFi — Implementation Plan (MVP: config + sync self-hosted)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una integrazione UniFi che fa **pull dal controller** (self-hosted) e **arricchisce il DB** del tenant — switch/AP in `network_devices`, porte in `switch_ports`, adiacenze LLDP in `device_neighbors` — così la mappa `/topology` si popola da sola.

**Architecture:** Struttura copiata da LibreNMS (config hub-level `settings`, client, sync, cron, trigger, UI card), direzione dati da Wazuh (`syncWazuhForTenant`: pull esterno → upsert nel tenant DB). Logica pura di mapping in `src/lib/integrations/unifi-map.ts` (TDD). Questo MVP = fasi **A+B** della spec (backend self_hosted + sync); UDM/cloud (D), scheduler (C) e UI (E) sono task finali o piani successivi.

**Tech Stack:** Next 16 / React 19 / better-sqlite3 (tenant) / Zod v4 / node:test. HTTP via `src/lib/integrations/http-pool.ts`; cookie/session come `librenms-web-session.ts`.

**Spec:** `docs/superpowers/specs/2026-10-12-unifi-controller-integration-design.md`

## Global Constraints

- **`db-tenant` import SOLO statico** in `unifi-sync.ts` (presidiato da `no-dynamic-db-tenant-import.test.ts`; incidente 2026-09-02). Import `getNetworks/upsertHost/createNetworkDevice/...` in testa.
- La sync gira **dentro `withTenant`** (cron) o `withTenantFromSession` (manuale). La **config sta nell'hub** (`getIntegrationConfig("unifi")`), non nel tenant DB.
- **Upsert in transazione, no N+1**: seguire `upsertSwitchPorts`/`upsertNeighbors` (DELETE+INSERT in `d.transaction`, Set FK pre-caricati).
- **Dedup**: host su `(network_id, ip)`; fisico via `resolvePhysicalDevice` (serial 100 / MAC 80 / mac_set 70 / sysname 30, `MIN_CONFIDENCE=60`). `network_devices` non ha upsert → `resolveMacToNetworkDevice`/`getNetworkDeviceByHost` poi `create/updateNetworkDevice`.
- **Secret cifrati** (`encrypt`/`safeDecrypt`, `ENCRYPTION_KEY`); auth `requireAdmin` su PUT/sync; Zod v4 `.issues`; `JSON.parse` in try-catch; testi UI in italiano.
- Post-modifica: `npm run lint && npx tsc --noEmit && npm run build && npm test`; poi `npm run version:release && git push`.

## Review Focus

- **Device UniFi senza MAC/serial** → nessun `physical_device` fittizio, nessun crash; si crea/aggiorna comunque il `network_device`. → test in T2/T4.
- **`port_table` senza `lldp_table`** → nessun vicino inventato; porte comunque upsertate. → test in T2.
- **Stesso chassis già in `hosts`** (AP/switch) → dedup via `physical_device_id`, niente doppione dev/host. → verifica in T4 + conteggio reale.
- **Contesto tenant perso** (import dinamico di db-tenant) → scrittura nel DB sbagliato: vietato, import statici. → coperto da `no-dynamic-db-tenant-import.test.ts`.
- **Device_type UniFi sconosciuto** (es. `uxg`, `udm`) → mappato a `router` o skip, mai CHECK violation su `network_devices.device_type`. → test in T2.


## Correzioni prima di eseguire (integrazione col piano di miglioramento, 12/10 sera)

Questo piano è la **tappa 2** di `docs/superpowers/specs/2026-10-12-piano-miglioramento-design.md`
e si esegue com'è, con queste correzioni. **`dev` arriva da solo all'appliance di DTS in
15 minuti**: niente si accende da solo, e ciò che tocca il database si prova prima su una copia.

1. **Dati di prova con la forma vera.** La misura su DTS ha contato `lldp_table` **a livello
   di dispositivo** (72 su 74); i test del Task 2 lo leggono dentro ogni porta, con campi
   `lldp_chassis_id` / `lldp_port_id` / `lldp_mgmt_addr` scritti a mano. **Prima del Task 2**:
   una risposta vera di `stat/device` presa in sola lettura con l'account `map`, anonimizzata
   (MAC, IP, nomi, seriali), salvata come fixture in `src/lib/integrations/__tests__/fixtures/`;
   i test si scrivono su quella. Altrimenti la prova passa e la sync vera non trova vicini.
2. **Vicino LLDP anche per MAC.** Il `chassis_id` degli apparati UniFi di solito è un MAC: va in
   `remote_mac` (normalizzato come fa `macToHex`), non solo in `remote_device_name`. La mappa
   oggi abbina solo per nome e IP (`topology/match.ts`): l'abbinamento per MAC è nella tappa 5,
   ma il dato si salva giusto da subito.
3. **Funzioni del database da `@/lib/db-tenant`**, import statico. `upsertNeighbors`,
   `createNetworkDevice`, `updateNetworkDevice`, `getNetworkDeviceByHost`, `getNetworks` hanno
   due copie divergenti (`db.ts` e `db-tenant.ts`, NUC-2): il codice nuovo non passa dal facade.
4. **Guardia "zero sospetto".** `upsertSwitchPorts` e `upsertNeighbors` cancellano e
   riscrivono: se il controller restituisce zero porte o zero vicini per un apparato che ne
   aveva, si salta la sostituzione e lo si segnala in `errors[]`. Una risposta vuota per errore
   non deve cancellare dati buoni. Test dedicato nel Task 4.
5. **Certificato del controller fissato al primo uso** (stesso schema del `cert_pin` dell'edge),
   invece di accettare qualunque certificato. Task 3.
6. **Migrazione del job (Task 6).** Lo schema c'è già: ricostruzioni `scheduled_jobs_v2…v7` in
   `db-tenant.ts`. La v8 aggiunge `unifi_sync`, con un elenco **identico** a quello di
   `db-tenant-schema.ts` (test che confronta i due). Si prova su una copia di un database tenant
   vero prima del push.
7. **Prima sincronizzazione = scrittura su dati di un cliente.** Il Task 4, passo 4, si fa prima
   su una **copia locale** del database del tenant DTS (controller letto in sola lettura),
   contando prima e dopo; poi sull'appliance, con backup del database del tenant e conferma di
   Riccardo.
8. **Salute e stato**: una voce nel registry dei moduli con la sonda (= test-connection), così
   compare in "Stato moduli". Credenziali solo nella configurazione `integration_unifi_*`,
   nessuna voce nel vault (MOD-22).
9. **ADR**: la decisione di prodotto è l'ADR 0004 (DA-IPAM è l'appliance). Il Task 8 scrive le
   scelte tecniche come **ADR 0005**.
10. **Fuori da questo piano**: client e Omada (tappa 4, nel catalogo, dopo le fondamenta della
    tappa 3); backend UDM e cloud (fase D) quando un cliente li usa.

---

## Task 1: Whitelist `unifi` + campi config

**Files:** Modify `src/lib/integrations/types.ts`, `src/lib/integrations/config.ts`, `src/app/api/integrations/[component]/route.ts`.

**Interfaces:** Produces: `IntegrationComponent` include `"unifi"`; `getIntegrationConfig("unifi")`/`setIntegrationConfig("unifi", …)` accettano `kind/url/site/username/password/apiToken`.

- [x] **Step 1:** In `types.ts` aggiungere `"unifi"` a `IntegrationComponent` e i campi `kind`/`site` a `ComponentConfig` (o un `UnifiConfig` esteso).
- [x] **Step 2:** In `config.ts` aggiungere `unifi` a `DEFAULTS` e gestire le chiavi `integration_unifi_kind` (plain), `integration_unifi_site` (plain), `integration_unifi_username` (plain), `integration_unifi_password` (secret), oltre a url/apiToken già generici.
- [x] **Step 3:** In `api/integrations/[component]/route.ts` aggiungere `"unifi"` a `VALID_COMPONENTS` ed estendere lo schema Zod del PUT con `kind` (`z.enum(["self_hosted","udm","cloud"])`), `site`, `username`.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → 0 errori.
- [x] **Step 5:** `git commit -m "feat(unifi): whitelist componente + campi config (kind/site/username)"`.

---

## Task 2: Mapping puro UniFi → DB (`unifi-map.ts`) — TDD

**Files:** Create `src/lib/integrations/unifi-map.ts`, `src/lib/integrations/__tests__/unifi-map.test.ts`.

**Interfaces:** Produces: `mapUnifiDeviceType(t)`, `mapUnifiDevice(d)`, `mapUnifiPorts(d)`, `mapUnifiLldp(d)` e il tipo `UnifiDevice`.

- [ ] **Step 1: test (falliscono)** — `unifi-map.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapUnifiDeviceType, mapUnifiDevice, mapUnifiPorts, mapUnifiLldp } from "@/lib/integrations/unifi-map";

test("tipo: usw→switch, uap→access_point, ugw/udm/uxg→router, ignoto→null", () => {
  assert.equal(mapUnifiDeviceType("usw"), "switch");
  assert.equal(mapUnifiDeviceType("uap"), "access_point");
  assert.equal(mapUnifiDeviceType("ugw"), "router");
  assert.equal(mapUnifiDeviceType("udm"), "router");
  assert.equal(mapUnifiDeviceType("uxg"), "router");
  assert.equal(mapUnifiDeviceType("boh"), null);
});

test("device: campi base + vendor ubiquiti", () => {
  const d = mapUnifiDevice({ mac: "aa:bb:cc:dd:ee:ff", model: "US8P60", name: "SW1", type: "usw", ip: "172.17.0.5", state: 1 });
  assert.equal(d.device_type, "switch");
  assert.equal(d.vendor, "ubiquiti");
  assert.equal(d.model, "US8P60");
  assert.equal(d.host, "172.17.0.5");
  assert.equal(d.mac, "aa:bb:cc:dd:ee:ff");
});

test("porte: da port_table; senza lldp nessun trunk_neighbor", () => {
  const ports = mapUnifiPorts({ mac: "x", type: "usw", port_table: [
    { port_idx: 1, name: "Port 1", up: true, speed: 1000 },
    { port_idx: 2, name: "Uplink", up: true, lldp_table: [{ lldp_chassis_id: "SW2", lldp_port_id: "2" }] },
  ] } as any);
  assert.equal(ports.length, 2);
  assert.equal(ports[0].port_index, 1);
  assert.equal(ports[0].status, "up");
  assert.equal(ports[0].trunk_neighbor_name, null);
  assert.equal(ports[1].trunk_neighbor_name, "SW2");
});

test("lldp: adiacenze dal lldp_table di porta", () => {
  const n = mapUnifiLldp({ mac: "x", type: "usw", port_table: [
    { port_idx: 2, name: "Uplink", lldp_table: [{ lldp_chassis_id: "SW2", lldp_port_id: "2", lldp_mgmt_addr: "172.17.0.6" }] },
  ] } as any);
  assert.equal(n.length, 1);
  assert.equal(n[0].localPort, "2");
  assert.equal(n[0].remoteDevice, "SW2");
  assert.equal(n[0].remotePort, "2");
  assert.equal(n[0].protocol, "lldp");
  assert.equal(n[0].remoteIp, "172.17.0.6");
});

test("device senza MAC/port_table non crasha", () => {
  assert.doesNotThrow(() => mapUnifiPorts({ type: "usw" } as any));
  assert.doesNotThrow(() => mapUnifiLldp({ type: "usw" } as any));
});
```
- [ ] **Step 2:** `node --import tsx --test src/lib/integrations/__tests__/unifi-map.test.ts` → FAIL (modulo assente).
- [ ] **Step 3:** implementare `unifi-map.ts` (tipo `UnifiDevice` + le 4 funzioni; `port.up ? "up" : "down"`; `trunk_neighbor_name = port.lldp_table?.[0]?.lldp_chassis_id ?? null`; iterazioni con `?? []`).
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5:** `git commit -m "feat(unifi): mapping puro controller→DB (device/porte/lldp) + test"`.

---

## Task 3: Client API UniFi self-hosted (`unifi-api.ts`)

**Files:** Create `src/lib/integrations/unifi-api.ts`.

**Interfaces:** Produces: `createUnifiClient(cfg): UnifiClient` con `probe()` e `listDevices(): Promise<UnifiDevice[]>`.

- [ ] **Step 1:** Leggere `src/lib/integrations/librenms-api.ts` (factory+probe) e `librenms-web-session.ts` (login cookie) come template.
- [ ] **Step 2:** Implementare per `kind: "self_hosted"`: `POST ${url}/api/login` con `{username,password,remember:false}` (TLS self-signed → agent `rejectUnauthorized:false`), conservare cookie `unifises` + header `X-CSRF-Token` dalla risposta; poi `GET ${url}/api/s/${site}/stat/device` → `data.data` normalizzato in `UnifiDevice[]` (map dei campi grezzi: `mac,model,name,type,ip,state,version,serial,port_table,lldp_table`). `udm`/`cloud`: `throw new Error("backend non ancora implementato")` (fase D).
- [ ] **Step 3:** `probe()` come LibreNMS: tenta login + 1 device; 401/403→auth, 5xx→server, ECONN/timeout→network.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint`. (HTTP non unit-testato qui; verifica reale nel Task 4.)
- [ ] **Step 5:** `git commit -m "feat(unifi): client controller self-hosted (session) + probe"`.

---

## Task 4: Sync engine (`unifi-sync.ts`) — pull → upsert

**Files:** Create `src/lib/integrations/unifi-sync.ts`. Usa (import statici): `getIntegrationConfig` da `@/lib/integrations/config`; `createUnifiClient` (T3); `mapUnifi*` (T2); da `@/lib/db`: `getNetworks, resolveMacToNetworkDevice, getNetworkDeviceByHost, createNetworkDevice, updateNetworkDevice, upsertSwitchPorts, upsertNeighbors`; `resolvePhysicalDevice`, `setNetworkDevicePhysicalDevice` da `@/lib/devices/identity-resolver`/`physical-device-db`.

**Interfaces:** Produces: `syncUnifiForTenant(): Promise<UnifiSyncResult>` (`{added,updated,portsUpserted,neighborsUpserted,skipped,errors[]}`).

- [ ] **Step 1:** Leggere `src/lib/integrations/wazuh-sync.ts` (`syncWazuhForTenant`) come template direzionale (pull→upsert, match per IP/MAC) e `librenms-sync.ts` per struttura errori/probe.
- [ ] **Step 2:** Implementare: `cfg = getIntegrationConfig("unifi")`; se `mode!=="external"` return skip. `client = createUnifiClient(cfg)`; `const p = await client.probe(); if(!p.ok) return {…errors:[p.message]}`. `devices = await client.listDevices()`. Per ogni device (dentro la transazione per-device o batch): `mapUnifiDeviceType` (skip se null); trovare il `network_device` esistente (`resolveMacToNetworkDevice(mac)` → `getNetworkDeviceByHost(ip)`) → `updateNetworkDevice` o `createNetworkDevice(mapUnifiDevice(d))`; `resolvePhysicalDevice` + `setNetworkDevicePhysicalDevice`; `upsertSwitchPorts(id, mapUnifiPorts(d))`; `upsertNeighbors(id, mapUnifiLldp(d))`. Accumulare conteggi/errori, **non lanciare**.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint && npm test` (incl. `no-dynamic-db-tenant-import.test.ts` verde).
- [ ] **Step 4: verifica reale su DTS** (tenant 71734): configurare `integration_unifi_*` (kind self_hosted, url `https://172.16.1.222:8443`, site `3oumjv0i`, user `map` dal vault), lanciare la sync e **contare** `network_devices`/`device_neighbors`/`switch_ports` prima/dopo (attesi ~74 device, molte adiacenze). Poi aprire `/topology` → mappa piena.
- [ ] **Step 5:** `git commit -m "feat(unifi): sync engine pull→upsert (device/porte/adiacenze)"`.

---

## Task 5: Trigger manuale + test-connection

**Files:** Create `src/app/api/integrations/unifi/sync/route.ts`, `src/app/api/integrations/unifi/test-connection/route.ts`.

- [ ] **Step 1:** `sync/route.ts`: `POST` come `librenms/sync/route.ts` — `withTenantFromSession` → `requireAdmin` → `syncUnifiForTenant()` → json.
- [ ] **Step 2:** `test-connection/route.ts`: `GET` `requireAuth` → `createUnifiClient(getIntegrationConfig("unifi")).probe()` → json `{ok, reason?, message?}`.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint && npm run build`.
- [ ] **Step 4:** `git commit -m "feat(unifi): rotte sync manuale + test-connection"`.

---

## Task 6: Scheduler `unifi_sync`

**Files:** Modify `src/lib/db-tenant-schema.ts` (CHECK `scheduled_jobs.job_type`), `src/lib/cron/jobs.ts`.

- [ ] **Step 1:** Verificare come viene creato un record `librenms_sync` (API con validazione lato codice vs seed) → decidere migration. Aggiungere `'unifi_sync'` al CHECK di `scheduled_jobs.job_type`; se serve, migration idempotente (ricreazione tabella guardata) in `getTenantDb`.
- [ ] **Step 2:** `jobs.ts`: import statico `import { syncUnifiForTenant } from "@/lib/integrations/unifi-sync";` + `case "unifi_sync": await syncUnifiForTenant(); break;`.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint && npm run build && npm test`.
- [ ] **Step 4:** `git commit -m "feat(unifi): job schedulato unifi_sync"`.

---

## Task 7: UI — UnifiCard in impostazioni

**Files:** Create `src/components/settings/unifi-card.tsx`; Modify `src/components/settings/modules-tab.tsx`.

- [ ] **Step 1:** Leggere `integration-card.tsx` (load/save/test/sync) e `WazuhCard` (card custom) come template.
- [ ] **Step 2:** `UnifiCard` ("use client"): `load()` da `GET /api/integrations/unifi`; selettore `kind`; campi url/site/username/password o api_token condizionati; `Salva` (PUT poi `load()`); `Test` (test-connection); `Sincronizza` (POST sync). Testi in italiano, `@base-ui` (`render={<…/>}`).
- [ ] **Step 3:** Aggiungere `<UnifiCard/>` in `modules-tab.tsx` (sezione dedicata).
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint && npm run build`; verifica visiva della card.
- [ ] **Step 5:** `git commit -m "feat(unifi): card configurazione integrazione in impostazioni"`.

---

## Task 8: ADR + rilascio

- [ ] **Step 1:** `docs/adr/0005-unifi-controller-integration.md` (template 0000; la 0004 è la decisione di prodotto, correzione 9): decisione, alternative (SNMP-only, per-tenant table), conseguenze.
- [ ] **Step 2:** Gate completo `npm run lint && npx tsc --noEmit && npm run build && npm test`.
- [ ] **Step 3:** `npm run version:release && git push origin dev`.
- [ ] **Step 4:** Aggiornare `CONTEXT.md` di DA-IPAM (feature UniFi) e il `CONTEXT.md` DTS.

## Self-review

- **Copertura spec**: config+whitelist (T1) ✓ · client self-hosted (T3) ✓ · mapping puro (T2, TDD) ✓ · sync pull→upsert (T4) ✓ · trigger+test (T5) ✓ · scheduler (T6) ✓ · UI (T7) ✓. **Fuori MVP**: UDM/cloud (fase D), client Wi-Fi→hosts, rifinitura mappa (piano topologia).
- **Review Focus**: device senza MAC/serial (T2/T4) · porte senza LLDP (T2) · dedup dev/host via physical (T4) · import statico (test esistente) · device_type ignoto (T2).
- **Placeholder**: le note "leggere il template X" sono indicazioni di pattern, non buchi; il mapping (cuore testabile) è completo.
