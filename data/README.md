# Cartella dati locale

| File | Ruolo |
|------|--------|
| `ipam.empty.db` | **Solo repository Git** — database SQLite vuoto (schema + seed interni). Copiato in `ipam.db` alla prima esecuzione se questo non esiste. |
| `ipam.db` | **Mai in Git** — istanza in uso (reti, host, credenziali cifrate, …). Creato automaticamente se manca anche il template. |
| `ipam.db-wal`, `ipam.db-shm` | File WAL SQLite in uso; ignorati da Git. |

Per rigenerare il template dopo modifiche allo schema: `npm run db:empty` (solo sviluppo).
