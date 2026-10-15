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
- [x] **Step 4:** `npx tsc --noEmit && npm run lint` → 0 errori. *(tsc completo + eslint sui file toccati, 12/10)*
- [x] **Step 5:** `git commit -m "feat(unifi): whitelist componente + campi config (kind/site/username)"`.

---

## Task 2: Mapping puro UniFi → DB (`unifi-map.ts`) — TDD

**Files:** Create `src/lib/integrations/unifi-map.ts`, `src/lib/integrations/__tests__/unifi-map.test.ts`.

**Interfaces:** Produces: `mapUnifiDeviceType(t)`, `mapUnifiDevice(d)`, `mapUnifiPorts(d)`, `mapUnifiLldp(d)` e il tipo `UnifiDevice`.

> **Già fatto nel passo 1 (12/10):** il tipo `UnifiDevice` (con `UnifiPort`, `UnifiLldpEntry`,
> `UnifiUplink`) e `parseStatDeviceResponse` stanno in `src/lib/integrations/unifi-device.ts`,
> coi **nomi dei campi del controller** e la `lldp_table` a livello di apparato. Il mapping li
> importa da lì e i test partono da `parseStatDeviceResponse(fixture)`: i test d'esempio qui
> sotto (LLDP dentro le porte, `lldp_chassis_id`) hanno la forma sbagliata — correzione 1.

- [x] **Step 1: test (falliscono)** — `unifi-map.test.ts` *(scritti sulla fixture vera, non su questo esempio: vedi l'esito sotto)*:
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
  const d = mapUnifiDevice({ mac: "aa:bb:cc:dd:ee:ff", model: "US8P60", name: "SW1", type: "usw", ip: "10.1.0.5", state: 1 });
  assert.equal(d.device_type, "switch");
  assert.equal(d.vendor, "ubiquiti");
  assert.equal(d.model, "US8P60");
  assert.equal(d.host, "10.1.0.5");
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
    { port_idx: 2, name: "Uplink", lldp_table: [{ lldp_chassis_id: "SW2", lldp_port_id: "2", lldp_mgmt_addr: "10.1.0.6" }] },
  ] } as any);
  assert.equal(n.length, 1);
  assert.equal(n[0].localPort, "2");
  assert.equal(n[0].remoteDevice, "SW2");
  assert.equal(n[0].remotePort, "2");
  assert.equal(n[0].protocol, "lldp");
  assert.equal(n[0].remoteIp, "10.1.0.6");
});

test("device senza MAC/port_table non crasha", () => {
  assert.doesNotThrow(() => mapUnifiPorts({ type: "usw" } as any));
  assert.doesNotThrow(() => mapUnifiLldp({ type: "usw" } as any));
});
```
- [x] **Step 2:** `node --import tsx --test src/lib/integrations/__tests__/unifi-map.test.ts` → FAIL (modulo assente).
- [x] **Step 3:** implementare `unifi-map.ts` (tipo `UnifiDevice` + le 4 funzioni; `port.up ? "up" : "down"`; `trunk_neighbor_name = port.lldp_table?.[0]?.lldp_chassis_id ?? null`; iterazioni con `?? []`).
- [x] **Step 4:** test → PASS. *(16/16; tre mutazioni viste cadere: indice per MAC, regola del sottotipo, porta letta dal vicino)*
- [x] **Step 5:** `git commit -m "feat(unifi): mapping puro controller→DB (device/porte/lldp) + test"`.

> **Esito del passo 2 (12/10), dove differisce da sopra.** Firme: `mapUnifiDeviceType(t)`,
> `mapUnifiDevice(d)` → `{ok:true, device} | {ok:false, reason}` (tipo ignoto o apparato senza IP:
> scartato col motivo, per gli `skipped` della sync), `buildUnifiMacIndex(devices)` (una volta per
> risposta), `mapUnifiPorts(d, index)`, `mapUnifiLldp(d, index)`: l'indice è obbligatorio perché il
> nome del vicino si risolve fra gli apparati della stessa risposta. L'apparato esce coi nomi delle
> colonne (`host`, `serial_number`, `firmware`, `model`) più `mac`; i vicini nella forma di
> `upsertNeighbors` (`localPort`, `remoteDevice`, `remotePort`, `remoteMac`, `remoteIp`, `remotePlatform`).
> - **MAC del vicino**: `chassis_id_subtype` sugli switch MANCA (c'è solo sugli AP); senza sottotipo
>   un `chassis_id` con forma di MAC vale come MAC, altrimenti nessun vicino degli switch avrebbe nome.
>   Forma del DB (`normalizeMacForStorage`, AA:BB:…): `upsertNeighbors` confronta `remote_mac = hosts.mac`.
> - **Porta remota**: `port_id` senza "local "; se è un MAC (il vicino non annuncia la porta) si legge
>   dalla voce LLDP del vicino che punta a noi (SW-1 porta 7 → AP-3 `eth0`), altrimenti `""`.
> - **IP del vicino**: primo di `mgmt_ips`, altrimenti l'IP dell'apparato risolto nella risposta;
>   `remotePlatform` = suo modello.
> - **Porte**: `Port <idx>` se senza nome; stato `disabled`/`up`/`down`/null (offline); velocità
>   `"1000 Mbps"` e PoE `delivering`/`searching`/`disabled` come la scansione SNMP; `is_trunk` anche per
>   uplink, LAG e porta con vicino LLDP (altrimenti la pagina dell'apparato non mostra il vicino).
>   VLAN, MAC singolo, host e peer principale restano null: li può riempire la sync.

---

## Task 3: Client API UniFi self-hosted (`unifi-api.ts`)

**Files:** Create `src/lib/integrations/unifi-api.ts`.

**Interfaces:** Produces: `createUnifiClient(cfg): UnifiClient` con `probe()` e `listDevices(): Promise<UnifiDevice[]>`.

- [x] **Step 1:** Leggere `src/lib/integrations/librenms-api.ts` (factory+probe) e `librenms-web-session.ts` (login cookie) come template.
- [x] **Step 2:** Implementare per `kind: "self_hosted"`: `POST ${url}/api/login` con `{username,password,remember:false}` (TLS self-signed → agent `rejectUnauthorized:false`), conservare cookie `unifises` + header `X-CSRF-Token` dalla risposta; poi `GET ${url}/api/s/${site}/stat/device` → `data.data` normalizzato in `UnifiDevice[]` (map dei campi grezzi: `mac,model,name,type,ip,state,version,serial,port_table,lldp_table`). `udm`/`cloud`: `throw new Error("backend non ancora implementato")` (fase D).
- [x] **Step 3:** `probe()` come LibreNMS: tenta login + 1 device; 401/403→auth, 5xx→server, ECONN/timeout→network.
- [x] **Step 4:** `npx tsc --noEmit && npm run lint`. (HTTP non unit-testato qui; verifica reale nel Task 4.)
- [x] **Step 5:** `git commit -m "feat(unifi): client controller self-hosted (session) + probe"`.

> **Esito del passo 1 (12/10), dove differisce da sopra:** `createUnifiClient(cfg, pinStore)` —
> il secondo argomento è obbligatorio (`unifiCertPinStore` da `config.ts`). Niente
> `rejectUnauthorized:false` nudo: correzione 5, impronta SPKI fissata al primo uso riuscito
> (`spkiPinFromDer` dell'edge), verificata sul socket che porta la richiesta; certificato diverso →
> `reason: "cert"`, «certificato del controller cambiato». Solo `https://`. Richieste ammesse:
> login, logout, `stat/device` (`isUnifiRequestAllowed`). `probe()` restituisce anche `devices`
> (numero) e, sul certificato cambiato, `presentedPin`/`expectedPin` per l'azione di rinnovo.
> HTTP provato su un controller finto TLS in locale (`unifi-api.test.ts`).

---

## Task 4: Sync engine (`unifi-sync.ts`) — pull → upsert

**Files:** Create `src/lib/integrations/unifi-sync.ts`. Usa (import statici): `getIntegrationConfig` da `@/lib/integrations/config`; `createUnifiClient` (T3); `mapUnifi*` (T2); da `@/lib/db`: `getNetworks, resolveMacToNetworkDevice, getNetworkDeviceByHost, createNetworkDevice, updateNetworkDevice, upsertSwitchPorts, upsertNeighbors`; `resolvePhysicalDevice`, `setNetworkDevicePhysicalDevice` da `@/lib/devices/identity-resolver`/`physical-device-db`.

**Interfaces:** Produces: `syncUnifiForTenant(): Promise<UnifiSyncResult>` (`{added,updated,portsUpserted,neighborsUpserted,skipped,errors[]}`).

- [x] **Step 1:** Leggere `src/lib/integrations/wazuh-sync.ts` (`syncWazuhForTenant`) come template direzionale (pull→upsert, match per IP/MAC) e `librenms-sync.ts` per struttura errori/probe.
- [x] **Step 2:** Implementare: `cfg = getIntegrationConfig("unifi")`; se `mode!=="external"` return skip. `client = createUnifiClient(cfg)`; `const p = await client.probe(); if(!p.ok) return {…errors:[p.message]}`. `devices = await client.listDevices()`. Per ogni device (dentro la transazione per-device o batch): `mapUnifiDeviceType` (skip se null); trovare il `network_device` esistente (`resolveMacToNetworkDevice(mac)` → `getNetworkDeviceByHost(ip)`) → `updateNetworkDevice` o `createNetworkDevice(mapUnifiDevice(d))`; `resolvePhysicalDevice` + `setNetworkDevicePhysicalDevice`; `upsertSwitchPorts(id, mapUnifiPorts(d))`; `upsertNeighbors(id, mapUnifiLldp(d))`. Accumulare conteggi/errori, **non lanciare**.
- [x] **Step 3:** `npx tsc --noEmit && npm run lint && npm test` (incl. `no-dynamic-db-tenant-import.test.ts` verde). *(tsc completo, eslint sui file toccati, prove mirate UniFi + `no-dynamic-db-tenant-import` + `host-status-by-ip`; `npm test` completo non lanciato per la memoria della macchina, 12/10)*
- [ ] **Step 4: verifica reale su DTS** (tenant 71734) — *da fare, correzione 7: prima su una copia locale del DB del tenant, poi sull'appliance con backup e conferma di Riccardo*: configurare `integration_unifi_*` (kind self_hosted, url `https://10.0.1.222:8443`, site `3oumjv0i`, user `map` dal vault), lanciare la sync e **contare** `network_devices`/`device_neighbors`/`switch_ports` prima/dopo (attesi ~74 device, molte adiacenze). Poi aprire `/topology` → mappa piena.
- [x] **Step 5:** `git commit -m "feat(unifi): sync engine pull→upsert (device/porte/adiacenze)"`.

> **Esito del passo 3 (12/10), dove differisce da sopra.** `syncUnifiForTenant(opts?)` in
> `src/lib/integrations/unifi-sync.ts` (`opts.source` sostituisce il controller nelle prove) →
> `{tenantCode, total, added, updated, skipped, skippedReasons, portsUpserted, neighborsUpserted, errors}`.
> Non lancia; senza contesto tenant non legge nemmeno il controller; ricontrolla il contesto dopo
> l'attesa della rete; integrazione spenta o zero apparati dal controller → niente scritto, detto in `errors`.
> - **Una sola lettura**: `probe()` e `listDevices()` fanno la stessa sequenza login → stat/device →
>   logout; la sync chiama solo `listDevices()`, il cui errore arriva già classificato come nella sonda.
> - **Funzioni DB** solo da `@/lib/db-tenant` (correzione 3). Nuove lì: `getNetworkDeviceKnownMacs`,
>   `getPhysicalDeviceAnchors`, `getPortAndNeighborCountsByDevice`, `linkNetworkDeviceToPhysicalDevice`,
>   `runInTenantTransaction`. **Non** `resolvePhysicalDevice`/`physical-device-db.ts`: il primo CREA un
>   record quando non trova (a DTS `physical_devices` è vuota: sarebbero 74 record fittizi), il secondo
>   passa da `getDb()` del facade, che risolve il tenant con un `require` di db-tenant.
> - **Abbinamento** seriale → MAC noti (host collegato o con lo stesso IP, identità fisica) → IP; per IP
>   solo se nessun MAC lo smentisce e l'apparato è `ubiquiti`/`other`, altrimenti «IP conteso»: saltato,
>   detto in `errors`. Senza il seriale la seconda sync scambiava per conteso un apparato creato da lei se
>   l'host della rete ha un MAC diverso da quello del controller (prova dedicata). Trovato per seriale o
>   MAC a un IP diverso → spostato all'IP del controller. Già censito: si aggiornano i fatti (vendor,
>   tipo, modello, firmware, seriale), non le scelte (nome, protocollo, credenziali, `enabled`).
> - **Nuovi apparati spenti** (`enabled=0`, `use_for_arp_poll=0`, `protocol=api`): il poll ARP gira su
>   ogni `network_device` abilitato e per un ubiquiti `api` userebbe SNMP con community «public»
>   (`getDeviceCommunityString`, timeout di 10 s a richiesta) su ognuno dei 74 apparati. In topologia
>   compaiono lo stesso (grigi, «unknown»). Si aggancia `host_id` all'host con lo stesso IP (niente doppioni).
> - **Per apparato una transazione** (scheda + identità + porte + vicini): un errore annulla solo
>   quell'apparato. Guardia «zero sospetto» (correzione 4) su porte e vicini, detta in `errors`.
> - Prove: `__tests__/unifi-sync.test.ts`, 19, tenant temporaneo + fixture vera; viste fallire senza
>   modulo e sulle mutazioni (guardia porte, guardia vicini, contesto, conflitto per MAC, abbinamento per
>   MAC e per seriale, nati spenti, integrazione spenta, identità per MAC).
> - **Hub delle prove**: assegnato in testa al file, `DA_IPAM_HUB_DB_PATH` arrivava dopo gli `import`
>   e le prove scrivevano in `DA_INVENT_DATA_DIR/hub.db`, condiviso fra i processi paralleli (e, senza
>   quella variabile, il vero hub). Ora `__tests__/support/hub-isolato.ts`, importato per primo, anche
>   in `unifi-config.test.ts`. Restano col vecchio schema `wazuh-config.test.ts` e `wazuh-alerts-sync.test.ts`.

---

## Task 5: Trigger manuale + test-connection

**Files:** Create `src/app/api/integrations/unifi/sync/route.ts`, `src/app/api/integrations/unifi/test-connection/route.ts`.

- [x] **Step 1:** `sync/route.ts`: `POST` come `librenms/sync/route.ts` — `withTenantFromSession` → `requireAdmin` → `syncUnifiForTenant()` → json.
- [x] **Step 2:** `test-connection/route.ts`: `GET` `requireAuth` → `createUnifiClient(getIntegrationConfig("unifi")).probe()` → json `{ok, reason?, message?}`.
- [x] **Step 3:** `npx tsc --noEmit && npm run lint && npm run build`. *(tsc completo una volta a fine passo + eslint sui file toccati; build esclusa in questo giro, 12/10)*
- [x] **Step 4:** `git commit -m "feat(unifi): rotte sync manuale + test-connection"`.

> **Esito (12/10, passo 4).** Dove differisce dal testo sopra:
> - **Auth per prima** in entrambe: `requireAdmin()` prima di `withTenantFromSession` (un
>   viewer riceve 403 prima di qualunque risoluzione del tenant).
> - **test-connection è `requireAdmin`, non `requireAuth`**: manda al controller le
>   credenziali salvate e al primo collegamento riuscito **fissa l'impronta del certificato**
>   nella configurazione (`integration_unifi_cert_pin`), cioè scrive configurazione; stesso
>   livello del PUT. Stessa scelta delle sonde `test-snmp`/`test-arp` (audit SEC-9). Resta
>   `GET` come da spec, con `Cache-Control: no-store`; non tocca il tenant, quindi niente
>   `withTenantFromSession`. Gira anche a integrazione spenta (si prova prima di accendere).
>   *Revisione del ramo (12/10): diventata `POST`. Ha effetti (credenziali al controller,
>   fiducia nel certificato al primo uso) e un `GET` partirebbe da un link seguito con la
>   sessione aperta (cookie SameSite=Lax).*
> - La logica sta in `src/lib/integrations/unifi-sync.ts`, così si prova senza la sessione:
>   `probeUnifiController(opts?)` (config salvata + `unifiCertPinStore`, non lancia) e
>   `unifiSyncFailure(result)` (motivo se il giro non ha letto o scritto niente, altrimenti
>   `null`), che la rotta usa per `ok` e il job per fallire (Task 6).
> - Risposta della sync: `{ ok, ...UnifiSyncResult }`, sempre 200 col resoconto.
> - Le due rotte sono nel contratto di `src/lib/__tests__/api-auth-guards.test.ts`.

---

## Task 6: Scheduler `unifi_sync`

**Files:** Modify `src/lib/db-tenant-schema.ts` (CHECK `scheduled_jobs.job_type`), `src/lib/cron/jobs.ts`.

- [x] **Step 1:** Verificare come viene creato un record `librenms_sync` (API con validazione lato codice vs seed) → decidere migration. Aggiungere `'unifi_sync'` al CHECK di `scheduled_jobs.job_type`; se serve, migration idempotente (ricreazione tabella guardata) in `getTenantDb`.
- [x] **Step 2:** `jobs.ts`: import statico `import { syncUnifiForTenant } from "@/lib/integrations/unifi-sync";` + `case "unifi_sync": await syncUnifiForTenant(); break;`.
- [x] **Step 3:** `npx tsc --noEmit && npm run lint && npm run build && npm test`. *(tsc completo una volta a fine passo, eslint sui file toccati, prove mirate; build e `npm test` completo esclusi in questo giro, 12/10)*
- [x] **Step 4:** `git commit -m "feat(unifi): job schedulato unifi_sync"`.

> **Esito (12/10, passo 4).**
> - **Come nasce `librenms_sync`: da nessuna parte.** Nessun seed, nessuna rotta: lo schema
>   `ScheduledJobSchema` di `POST /api/jobs` ammette solo i job di rete, e nessun codice
>   inserisce `librenms_sync`. Per `unifi_sync` lo stesso: **nessun record si crea da solo**
>   (provato: né la configurazione né la sync né l'apertura del DB lo creano). Il modo di
>   attivarlo arriva col Task 7 (vedi la nota lì).
> - **Un solo elenco dei tipi**: `src/lib/scheduled-job-types.ts` (`SCHEDULED_JOB_TYPES`,
>   `SCHEDULED_JOB_TYPES_CHECK_SQL`, `ScheduledJobType`). Ne derivano il CHECK di
>   `db-tenant-schema.ts`, quello della v8 e `ScheduledJob["job_type"]` /
>   `ScheduledJobInput["job_type"]` in `@/types`: non possono divergere.
> - **Migrazione v8** = `migrateScheduledJobsV8(db)` esportata da `db-tenant.ts`, chiamata in
>   `getTenantDb` dopo la v7 (stesso try/catch e log). Rispetto alle v2…v7: colonne copiate
>   per nome, contatore AUTOINCREMENT conservato, indice `idx_scheduled_jobs_enabled_next`
>   ricreato subito (nelle v2…v7 spariva fino al riavvio), tutto in una transazione (una
>   copia che non riesce lascia la tabella com'era).
> - **Il job fallisce davvero**: `case "unifi_sync"` lancia se `unifiSyncFailure(result)` dà un
>   motivo (niente letto o niente scritto), così lo scheduler lo conta fra i falliti. Il
>   motivo non porta nomi e IP degli apparati (finisce nel log); il log del giro riuscito
>   porta solo i conteggi.
> - Prove: `src/lib/__tests__/scheduled-jobs-v8.test.ts` (6: schema = costante, v8 = schema e
>   tabella uguale a una nuova, idempotenza, **DB tenant vero col CHECK della v7 e righe
>   dentro aperto con `getTenantDb`**, copia per nome, transazione) e
>   `src/lib/cron/__tests__/unifi-sync-job.test.ts` (2, via `runJob`, senza rete).
> - Etichetta «Sincronizzazione controller UniFi» nell'elenco job delle impostazioni.
> - Resta (correzione 6): provare la v8 su una **copia** di un DB tenant vero (DTS) prima del
>   push.

---

## Task 7: UI — UnifiCard in impostazioni

**Files:** Create `src/components/settings/unifi-card.tsx`; Modify `src/components/settings/modules-tab.tsx`.

- [x] **Step 1:** Leggere `integration-card.tsx` (load/save/test/sync) e `WazuhCard` (card custom) come template.
- [x] **Step 2:** `UnifiCard` ("use client"): `load()` da `GET /api/integrations/unifi`; selettore `kind`; campi url/site/username/password o api_token condizionati; `Salva` (PUT poi `load()`); `Test` (test-connection); `Sincronizza` (POST sync). Testi in italiano, `@base-ui` (`render={<…/>}`).

> **Nota dal Task 6 (12/10):** oggi **nessuna strada crea il job `unifi_sync`** (come
> `librenms_sync`; `POST /api/jobs` non lo ammette). Se la sync automatica serve, la card
> deve avere un comando esplicito «Sincronizzazione automatica» che crea o aggiorna **un
> solo** job per tenant (`network_id` NULL), idempotente come `seedMeshSyncJobForTenant`, con
> un intervallo minimo ragionevole (un login sul controller a ogni giro) e
> `reloadTenantScheduler` dopo. `test-connection` è **admin** e restituisce
> `{ ok, devices, certPin, certPinRecorded }` o `{ ok:false, reason, message, presentedPin?,
> expectedPin? }`: con `reason: "cert"` la card mostra le due impronte. La sync risponde
> `{ ok, ...UnifiSyncResult }`: mostrare `errors[]` e `skippedReasons`.
- [x] **Step 3:** Aggiungere `<UnifiCard/>` in `modules-tab.tsx` (sezione dedicata).
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint && npm run build`; verifica visiva della card. *(12/10, passo 5: tsc completo una volta e eslint sui file toccati, verdi; la vista è resa sul server nelle prove. Restano build e verifica a schermo: una volta per tappa, sul dev)*
- [x] **Step 5:** `git commit -m "feat(unifi): card configurazione integrazione in impostazioni"`.

> **Esito (12/10, passo 5) — Task 7 e correzione 8.** Dove differisce dal testo sopra:
> - **Card** `src/components/settings/unifi-card.tsx`, sezione propria `#module-unifi` nel tab
>   Moduli, dopo Network Services (fonte di dati, non dashboard esterna; niente import JSON).
>   `UnifiCardView` disegna senza stato né rete; la parte pura (modulo, corpo del PUT, testi
>   degli esiti) sta in `unifi-card-model.ts`. Modalità «Disattivata» di default; i campi
>   cambiano col tipo (self-hosted/UDM: indirizzo, site, utente, password; cloud: chiave API e
>   site), con l'avviso «non ancora supportato» per UDM e cloud. Password e chiave in sola
>   scrittura («Impostata: lascia vuoto per non cambiarla»).
> - **Prova e sync usano la configurazione salvata**: restano ferme finché il modulo ha
>   modifiche non salvate, e lo dicono. «Sincronizza ora» compare solo a integrazione attiva.
>   Esito della sync in colonne (letti, aggiunti, aggiornati, porte, vicini, saltati), motivi
>   dei saltati ed errori uno per riga.
> - **Certificato**: stato dell'impronta fissata; «Dimentica il certificato» (DELETE) e, sul
>   «certificato cambiato», le due impronte e «Accetta la nuova impronta» (POST con l'impronta
>   presentata e quella vista fissata: se nel frattempo è cambiata → 409). Entrambe con
>   conferma. Rotta nuova `src/app/api/integrations/unifi/cert-pin/route.ts`, admin (nel
>   contratto di `api-auth-guards.test.ts`); logica in `acceptUnifiCertPin` (config.ts).
> - **Correzione 8**: voce `unifi` «Controller UniFi» nel registry (accesso nativo, apre
>   `/topology`, console del controller come interfaccia esterna) e sonda in `health.ts`, così
>   compare in «Stato moduli». Spenta = `configured:false` → «Non configurato», non un errore.
>   La sonda (`src/lib/integrations/unifi-health.ts`) è il test di connessione con tre
>   differenze: **non fissa mai l'impronta** (senza impronta non contatta il controller: la
>   password non parte verso un certificato mai visto, e il verdetto è «degradato: collegamento
>   mai provato»); **tiene il risultato 5 minuti** (niente login sul controller del cliente a
>   ogni apertura della dashboard; «Verifica» o configurazione cambiata rileggono, la notifica
>   disco che forza `only: "appliance"` no); **tetto di 8 s** come le altre sonde. Credenziali
>   solo da `integration_unifi_*`, niente vault.
> - `/api/modules/health` accetta i moduli di `PROBED_MODULE_KEYS` (health.ts), non più una
>   copia dell'elenco; `/api/modules/[key]/repair` accetta `unifi` con i suggerimenti
>   `reconfigure_unifi` e `check_unifi_cert`. Icona `Network` nella griglia del Launchpad.
> - **Sync automatica: non attivabile dalla card** (fuori dal compito di questo passo). Il job
>   `unifi_sync` esiste ma nessuna strada lo crea (vedi la nota dal Task 6); la card dice «per
>   ora la sincronizzazione parte solo a mano».
> - Prove: `unifi-cert-pin.test.ts` (5), `unifi-health.test.ts` (10),
>   `modules/__tests__/unifi-module.test.ts` (6, tenant temporaneo; l'unico indirizzo
>   contattato è 127.0.0.1:1, chiuso), `components/settings/__tests__/unifi-card.test.ts` (16,
>   vista resa con `renderToStaticMarkup` sulla forma vera delle risposte).

---

## Task 8: ADR + rilascio

- [x] **Step 1:** `docs/adr/0005-unifi-controller-integration.md` (template 0000; la 0004 è la decisione di prodotto, correzione 9): decisione, alternative (SNMP-only, per-tenant table), conseguenze.
- [ ] **Step 2:** Gate completo `npm run lint && npx tsc --noEmit && npm run build && npm test`. *(12/10, passo 6: `npm test` con `DA_INVENT_DATA_DIR` temporanea → 1274 prove, 1273 verdi, 0 rosse, 1 saltata (golden del codec, preesistente); `npx tsc --noEmit` → 0 errori. Restano `npm run lint` sull'intero repo e `npm run build`, da fare prima del merge in `dev`)* *(12/10 sera, dopo la revisione del ramo — 14 rilievi: corretti offline, abbinamento per seriale con `host_id`, IP del vicino, non adottati, fixture, password al cambio d'indirizzo, impronta senza sovrascritture, prova in POST, sonda UniFi fuori dalla notifica disco, prova della v8 su vincoli e indici; rimandati nell'ADR 0005 uplink, due scrittori, tenant del controller. `npm test` → 1291 prove, 1290 verdi, 0 rosse, 1 saltata; `npx tsc --noEmit` → 0 errori; eslint sui file toccati verde)*
- [ ] **Step 3:** `npm run version:release && git push origin dev`. *(non fatto: il ramo resta locale finché la verifica su copia del DB DTS — correzione 7, Task 4 passo 4 — non è fatta)*
- [ ] **Step 4:** Aggiornare `CONTEXT.md` di DA-IPAM (feature UniFi) e il `CONTEXT.md` DTS. *(12/10: `CONTEXT.md` di DA-IPAM aggiornato (§6), CHANGELOG in `[Non rilasciato]`, riga della tappa 2 nel §9 del piano di miglioramento. Il `CONTEXT.md` DTS resta da fare dopo la prima sync vera)*

## Self-review

- **Copertura spec**: config+whitelist (T1) ✓ · client self-hosted (T3) ✓ · mapping puro (T2, TDD) ✓ · sync pull→upsert (T4) ✓ · trigger+test (T5) ✓ · scheduler (T6) ✓ · UI (T7) ✓. **Fuori MVP**: UDM/cloud (fase D), client Wi-Fi→hosts, rifinitura mappa (piano topologia).
- **Review Focus**: device senza MAC/serial (T2/T4) · porte senza LLDP (T2) · dedup dev/host via physical (T4) · import statico (test esistente) · device_type ignoto (T2).
- **Placeholder**: le note "leggere il template X" sono indicazioni di pattern, non buchi; il mapping (cuore testabile) è completo.
