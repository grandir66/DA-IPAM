# Headwind MDM — contratto REST verificato (runtime)

> Estratto da un'istanza **reale** `headwindmdm/hmdm:0.1.8` (Swagger 2.0, `info.version 0.0.2`),
> installata e ispezionata su 192.168.99.50:8088 il 2026-06-26.
> Spec OpenAPI completa archiviata in [hmdm-swagger-0.1.8.json](hmdm-swagger-0.1.8.json)
> (scaricabile live da `GET /rest/swagger.json`, pubblico, no auth).

Base path REST: **`/rest`** (es. `http://host:port/rest/...`). Pannello su `/`.

## Autenticazione ⚠️ (verificato a runtime — 3 gotcha critici)

- `POST /rest/public/jwt/login` — body `{"login": "...", "password": "<MD5_HEX>"}`.
  **Il campo `password` NON è il plaintext: è l'MD5 (hex lowercase) della password** — il web UI fa
  l'MD5 in JS prima di inviare. Verifica server: `SHA1(md5 + "5YdSYHyg2U")` case-insensitive
  (`PasswordUtil.getHashFromMd5`). Inviare il plaintext → **401**.
- Risposta: `{"id_token": "<JWT>"}` — il token è in **`id_token`** (non `authToken`/`token`).
- Header successivi: `Authorization: Bearer <id_token>`.
- **Paginazione `pageNum` è 1-based**: `pageNum:0` → 500 `OFFSET must not be negative`. Iniziare da 1.
- Risposta search: `{"status":"OK","data":{"devices":{...,"items":[...]}, "configurations":{...}}}`.

### Reset/imposta password admin via DB (utile in lab)

```sql
-- dbhash = SHA1( md5_lowercase(plaintext) + '5YdSYHyg2U' ) uppercase
UPDATE users SET password='<dbhash>', lastloginfail=0, passwordreset=false WHERE login='admin';
```
`passwordreset` è BOOLEAN (`false`, non `0`). `lastloginfail` va azzerato per togliere il lockout.
Istanza test: admin / `Domarc2026xZ`.

## Endpoint usati dal connettore DA-IPAM

| Scopo | Metodo + path | Ritorna |
|---|---|---|
| Lista device (paginata) | `POST /rest/private/devices/search` | `PaginatedDataDeviceView` (lista `DeviceView`) |
| Device singolo per id | `GET /rest/private/devices/{id}` | `DeviceView` |
| Device per number | `GET /rest/private/devices/number/{number}` | `DeviceView` |
| **Inventario ricco + app** | `GET /rest/plugins/deviceinfo/deviceinfo/private/{deviceNumber}` | `DeviceInfoView` |
| Search inventario plugin | `POST /rest/plugins/deviceinfo/deviceinfo/private/search/device` | lista DeviceInfo |
| Summary | `GET /rest/private/summary/devices` | conteggi |

`DeviceSearchRequest` (body della search) campi utili: `value` (testo), `pageNum`, `pageSize`,
`sortBy`, `sortDir`, `groupId`, `configurationId`, `onlineLaterMillis`, `enrollmentDateFromMillis`.

## Modelli (proprietà reali)

**DeviceView** (risultato di `/private/devices/search`):
`id, number, oldNumber, description, imei, phone, serial, androidVersion, configurationId,
custom1, custom2, custom3, groups, enrollTime, lastUpdate, launcherPkg, launcherVersion,
kioskMode, mdmMode, publicIp, statusCode, info`
→ NB: **`model` NON è qui** (sta nel blob `info` o nel plugin). `info` è una **stringa JSON
serializzata** col `DeviceInfo` → va parsata in try/catch.

**DeviceInfoView** (plugin deviceinfo, `/{deviceNumber}`):
`deviceId, serial, imei, model, androidVersion, batteryLevel, phone, mdmMode, kioskMode,
defaultLauncher, applications[], files[], permissions[]`
→ qui c'è **`model`** + la **lista app completa**.

**DeviceInfoApplication** (elemento di `applications[]`):
`applicationName, applicationPkg, versionInstalled, versionRequired, versionValid`

**DeviceInfo** (blob `info` completo, se si preferisce parsarlo invece del plugin):
`serial, model, imei, imei2, phone, phone2, iccid, iccid2, imsi, imsi2, deviceId, androidVersion,
cpu, batteryLevel, batteryCharging, mdmMode, kioskMode, launcherType, launcherPackage,
defaultLauncher, applications[], files[], permissions[], location, custom1-3`

## Mapping → DA-IPAM (definitivo)

| DA-IPAM | Headwind | Fonte chiamata |
|---|---|---|
| hmdm_device_id | `DeviceView.number` (id univoco) | search |
| serial | `serial` | search o plugin |
| model | `DeviceInfoView.model` (o `info`→DeviceInfo.model) | **plugin** |
| os_family | costante `'android'` | — |
| os_version | `androidVersion` | search |
| imei / imei2 / phone | `imei` / (info)`imei2` / `phone` | search/plugin |
| battery_level / cpu | `batteryLevel` / (info)`cpu` | plugin/info |
| user_profile | `description` o `custom1..3` (config `user_field`) | search |
| last_seen_at | `lastUpdate` (epoch ms → ISO) | search |
| enroll time | `enrollTime` | search |
| apps[].package_name | `DeviceInfoApplication.applicationPkg` | plugin |
| apps[].app_name | `applicationName` | plugin |
| apps[].version_name | `versionInstalled` | plugin |

**Merge host first-class**: chiave `serial` → `imei` → `number` (Headwind NON espone MAC).
**Non disponibili** da Headwind: manufacturer, security_patch, storage, MAC → restano null.

## Flow connettore (per device, per sync)

1. `POST /private/devices/search` paginato → DeviceView[].
2. Per ciascuno: `GET /plugins/deviceinfo/deviceinfo/private/{number}` → DeviceInfoView (model+apps).
   (richiede il **plugin `deviceinfo` abilitato** lato Headwind.)
3. Map + dedup snapshot_sha256 + diff/history + merge host.

## Istanza di test

`http://192.168.99.50:8088` (HTTP-only, porta dedicata, Postgres interno, niente certbot).
Compose: `/opt/hmdm-test/hmdm-docker/docker-compose.http.yml` sulla VM 100. MQTT/device port 31000.
Da rimuovere quando non serve più (`docker compose -f docker-compose.http.yml down -v`).
