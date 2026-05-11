---
scope: Database access layer
applies_to: src/lib/db.ts, src/lib/db-tenant.ts, src/lib/db-hub.ts, src/lib/db-legacy.ts, src/lib/db-*-schema.ts
---

# DB access — regole

## Tre file da tenere allineati

Modifiche a una funzione DB → controllare presenza/firma in **tutti e tre**:

- `src/lib/db-tenant.ts` — versione "vera" multi-tenant, usa `db()` via AsyncLocalStorage
- `src/lib/db.ts` — facade backward-compat, usa `getDb()` con fallback a DEFAULT tenant
- `src/lib/db-legacy.ts` — solo per codice legacy che non ha ancora la separazione hub/tenant

Hub-only (utenti, registro tenant, profili template): solo `src/lib/db-hub.ts`.

## Hub vs Tenant — regola di separazione

| Hub DB (`hub.db`) | Tenant DB (`CLIENTE.db`) |
|-------------------|--------------------------|
| Utenti, autenticazione | Reti, host, scan history |
| Registro tenant | Network devices, credenziali |
| Settings globali | ARP entries, MAC port entries |
| Profili template SNMP/nmap/fingerprint | DHCP leases, inventario, scheduled jobs |

Se aggiungi una tabella: scrivere un test mentale "questo dato è uguale per tutti i tenant?" → SI = hub, NO = tenant.

## PRAGMA — non rimuovere

Configurate in `db.ts`/`db-tenant.ts`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
```

## Schema changes (no migration framework)

Modificare il file `*-schema.ts` e aggiungere `ALTER TABLE IF NOT EXISTS` inline idempotente:

```ts
db.exec(`CREATE TABLE IF NOT EXISTS my_table (...)`);
try { db.exec(`ALTER TABLE my_table ADD COLUMN new_col TEXT`); } catch { /* già presente */ }
```

Lo schema viene applicato all'avvio del processo. Nessun tool di migrazione, nessun versioning di schema.

## Performance — anti-pattern

- **N+1**: mai `getXxxById()` dentro `.map()` o loop. Creare `getXxxsByYWithJoin()` con JOIN nello stesso file.
- **DELETE + INSERT** logicamente atomici → SEMPRE dentro `db.transaction(() => { ... })()` (es. `upsertArpEntries`).
- **Result set senza LIMIT** per UI → usare versione paginata `getXxxPaginated(offset, limit)`.
- **Subquery correlate** ripetute → meglio CTE / JOIN esplicito.

## Indici critici (da non rimuovere)

- `idx_hosts_network_ip` — upsertHost
- `idx_network_devices_host` — getNetworkDeviceByHost
- `idx_arp_entries_mac_timestamp` — risoluzione MAC ordinata
- `idx_mac_port_entries_device_mac` — vista porte switch

Per nuove query con WHERE/JOIN su colonne non indicizzate → aggiungere l'indice nello schema.

## CIDR overlap

`createNetwork()` ha già check overlap automatico. Non bypassare con `INSERT` raw.
