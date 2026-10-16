# Attribution v2 — Fase 4b: protocolli nuovi Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §7.4. Esegue con superpowers:subagent-driven-development.

**Goal:** Aggiungere i protocolli che sbloccano l'inventario dove oggi non arriviamo, in ordine di rapporto valore/costo: **Redfish/IPMI** (BMC: modello, seriale, firmware del server ospite — l'host `ILOSGH942WX1N` della spec oggi è `unknown`), **SNMP v3 completo authPriv** (apparati enterprise dove v2c è disabilitato per policy; oggi v3 non è nemmeno validato), **ONVIF** (telecamere: modello, firmware).

**Architecture:** Ogni protocollo è un modulo in `src/lib/protocols/` che espone i **tre estrattori richiesti dalla spec** — `validate()` (test credenziale), `extractEvidence()` (evidenze di attribuzione, funzione pura sul risultato), `extractInventory()` (dati per l'inventario) — e si innesta nei punti già esistenti: `credential_validate` per la validazione, gli emettitori per le evidenze, i collettori device per l'inventario.

**Tech Stack:** `net-snmp` (già in deps, supporta v3), `fetch`/`https` nativo per Redfish e ONVIF, `fast-xml-parser` (già in deps) per ONVIF SOAP.

## Global Constraints — sicurezza operativa (VINCOLANTI)

- **Ogni tentativo autenticato passa dal gate anti-lockout esistente** (`CredentialRunBudget` + `shouldAttemptCredential` + `recordCredentialFailure`/`recordCredentialSuccess`): nessun protocollo nuovo può bypassarlo. Vale anche per Redfish/ONVIF, che hanno account locali con blocco dopo N tentativi.
- **Nessuno sweep**: i protocolli nuovi si attivano solo su host **selezionati** (validazione) o su device già promossi (inventario). Mai su intere subnet.
- **Nessun segreto nei log** (chiavi SNMPv3, password BMC): messaggi d'errore sanificati.
- Credenziali sempre cifrate a riposo; `safeDecrypt` nei percorsi non critici.
- TS strict, no `any`; DB in `db-tenant.ts` **e** `db.ts`; testi in italiano; Zod v4.
- Gate per task: `npm run lint && npx tsc --noEmit && npm test`; gate completi in **worktree isolato**.
- Regola della spec §7.4: un protocollo entra solo se fornisce tutti e tre gli estrattori. Chi non li ha, resta fuori.

---

### Task 1: Redfish (BMC iLO/iDRAC/XClarity)

**Files:** create `src/lib/protocols/redfish.ts` + `src/lib/protocols/__tests__/redfish.test.ts`; modify `src/lib/attribution/probe-evidence.ts` (o nuovo `credential-evidence`), `src/lib/scanner/discovery.ts` (ramo credential_validate).

```ts
export interface RedfishInfo {
  manufacturer: string | null; model: string | null; serialNumber: string | null;
  biosVersion: string | null; bmcFirmware: string | null; powerState: string | null;
  healthStatus: string | null; hostName: string | null; sku: string | null;
}
export async function redfishValidate(ip: string, user: string, pass: string, opts?: { port?: number; timeoutMs?: number }): Promise<{ ok: boolean; error?: string }>;
export async function redfishFetchInfo(ip: string, user: string, pass: string, opts?: { port?: number; timeoutMs?: number }): Promise<RedfishInfo | null>;
export function redfishEvidence(info: RedfishInfo): EvidenceInput[];  // PURA
/** Rilevazione senza credenziali: GET /redfish/v1/ è anonimo su quasi tutti i BMC. */
export async function redfishDetect(ip: string, opts?: { port?: number; timeoutMs?: number }): Promise<{ present: boolean; vendorHint: string | null }>;
```
- HTTPS su 443 (fallback 8443), `rejectUnauthorized: false` (i BMC hanno certificati self-signed), Basic Auth, timeout 8 s, max 256 KB per risposta.
- Percorso: `GET /redfish/v1/` (service root, anonimo) → `GET /redfish/v1/Systems` → primo membro → campi. `GET /redfish/v1/Managers/…` per il firmware BMC.
- **Evidenze** (source `redfish` — **da aggiungere a `AttributionSource`**, phase `credential_validate`): un BMC che risponde è per definizione un server → `category=compute.server` **0.95 autoritativa** (dichiarativo: è ciò che Redfish descrive); `vendor` da `manufacturer` via `vendorSlug` 0.95; `os` NON emesso (il BMC non conosce l'OS ospite in modo affidabile). `model`/`serialNumber` in `raw_value`.
- `redfishDetect` senza credenziali entra fra i probe passivi della Fase 3 (host con 443 aperta): se il service root risponde, emette già `compute.server` a 0.9 anche senza credenziali.
- Test: `redfishEvidence` tabellare (HPE/Dell/Lenovo, campi mancanti, manufacturer placeholder); parsing del JSON di service root e Systems con fixture reali abbreviate; nessuna eccezione su JSON malformato.

### Task 2: SNMP v3 completo (authPriv)

**Files:** modify `src/lib/db-hub-schema.ts` o `db-tenant-schema.ts` (colonne credenziali v3), `src/lib/scanner/snmp-query.ts`, `src/lib/scanner/discovery.ts`; create `src/lib/protocols/__tests__/snmpv3.test.ts`.

- Oggi esiste solo `authNoPriv` senza `privKey` (spec §7.1). Aggiungere alla tabella `credentials` (ALTER idempotente): `encrypted_auth_key`, `auth_protocol` (`MD5|SHA|SHA224|SHA256|SHA384|SHA512`), `encrypted_priv_key`, `priv_protocol` (`DES|AES|AES192|AES256`), `security_level` (`noAuthNoPriv|authNoPriv|authPriv`).
- `net-snmp` supporta v3: costruire la sessione con `createV3Session(target, user)` passando authProtocol/privProtocol dal record.
- `snmpValidateV3(ip, credentialId)`: query `sysDescr.0`; successo → `recordCredentialSuccess`, fallimento → `recordCredentialFailure` (passa dal gate anti-lockout: i BMC e gli apparati bloccano l'utente SNMP dopo ripetuti fallimenti di autenticazione).
- Le evidenze restano quelle SNMP esistenti (sysObjectID/sysDescr): nessun emettitore nuovo, ma ora raggiungibili su apparati dove v2c è chiuso.
- UI credenziali: il form deve permettere di inserire i campi v3 quando `credential_type = 'snmp'` e `security_level != 'noAuthNoPriv'`; i campi chiave sono write-only (mai restituiti in GET).
- Test: costruzione dei parametri di sessione per ogni combinazione auth/priv (funzione pura `buildV3Options`); rifiuto di combinazioni incoerenti (authPriv senza privKey → errore parlante, nessun tentativo di rete).

### Task 3: ONVIF (telecamere)

**Files:** create `src/lib/protocols/onvif.ts` + test; modify gli emettitori e il ramo credential_validate.

```ts
export interface OnvifInfo { manufacturer: string | null; model: string | null; firmwareVersion: string | null; serialNumber: string | null; hardwareId: string | null }
export async function onvifGetDeviceInformation(ip: string, user: string | null, pass: string | null, opts?: { port?: number; timeoutMs?: number }): Promise<OnvifInfo | null>;
export function onvifEvidence(info: OnvifInfo): EvidenceInput[];  // PURA
```
- SOAP `GetDeviceInformation` su `http://<ip>/onvif/device_service` (porta 80, fallback 8000/8080), con WS-Security UsernameToken **digest** quando ci sono credenziali; molte camere rispondono anche anonime.
- Evidenze (source `onvif`, da aggiungere al vocabolario): `category=av.camera` **0.95 autoritativa** (è la definizione stessa del servizio ONVIF), vendor da `manufacturer`, modello/firmware in `raw_value`.
- Test: parsing SOAP con fixture reali abbreviate (Hikvision, Dahua, Axis); risposta di errore SOAP → null; XML malformato → null senza eccezioni; `onvifEvidence` tabellare.

### Task 4: Integrazione, UI e verifica

- Registrare i nuovi `protocol_type` dove serve: `host_credentials.protocol_type` e `device_credential_bindings.protocol_type` hanno un CHECK (`ssh|snmp|winrm|api`) → estenderlo con `redfish|ipmi|onvif` con il pattern di rebuild già usato per `scan_history` (migrazione versionata, idempotente, `INSERT SELECT` completo).
- `resolveCredentialFor` deve conoscere i nuovi protocolli (union `CredProtocol`).
- La vista di **copertura credenziali** (§7.6) deve mappare categoria → protocollo pertinente: `compute.server` con BMC → `redfish`; `av.camera` → `onvif`; `network.*` → `snmp`; `compute.workstation` → `winrm`.
- Verifica finale in worktree, release, deploy VM 533; poi test reale contro i dispositivi disponibili sulla rete (l'host HPE con iLO e le eventuali camere), documentando cosa risponde davvero.

## Fuori scope (dichiarato)
- **SMB/WMI con credenziali**: richiede un bridge nuovo (impacket o simile) e un canale di esecuzione remota; il valore è già in parte coperto dal probe SMB2 anonimo della Fase 3 (build Windows senza credenziali). Rimandato con motivazione esplicita.
- **NETCONF/RESTCONF**, **Telnet**, **chiave privata SSH**, **HTTP/REST generico con token**: coda lunga, valore inferiore al costo in questa fase.
- **API vendor** (UniFi/Omada/Proxmox/vSphere/firewall): parte esiste già (`src/lib/proxmox/`, `src/lib/devices/acquisition/mikrotik.ts`); l'unificazione sotto i tre estrattori è un lavoro a sé.
