---
name: deploy-prod
description: Aggiornare DA-INVENT sul container LXC 333 (Proxmox 192.168.40.4) — pull, build, restart
---

# Deploy produzione (Proxmox LXC 333)

DA-INVENT gira in container LXC `333` su nodo Proxmox `DA-PX-04` (`192.168.40.4`).

```text
App path: /opt/da-invent
Service:  systemctl status da-invent
DB tenant: /opt/da-invent/data/tenants/<tenantId>.db
DB hub:    /opt/da-invent/data/hub.db
.env:      /opt/da-invent/.env.local  (contiene ENCRYPTION_KEY)
Venv:      /root/.da-invent-venv  (pywinrm + gssapi/Kerberos)
```

## Comando standard

```bash
# Aggiornamento atomico: pull + build + restart
ssh root@192.168.40.4 "pct exec 333 -- bash -lc 'cd /opt/da-invent && git pull && npm run build && systemctl restart da-invent'"

# Verifica versione attiva
ssh root@192.168.40.4 "pct exec 333 -- bash -lc 'cat /opt/da-invent/VERSION && systemctl is-active da-invent'"
```

Comandi diagnostici frequenti:

```bash
# Shell nel container
ssh root@192.168.40.4 "pct exec 333 -- bash -lc '<comando>'"

# Push file fixato (es. dopo dev)
scp file.py root@192.168.40.4:/tmp/x && \
  ssh root@192.168.40.4 "pct push 333 /tmp/x /opt/da-invent/src/lib/devices/file.py"

# Log servizio
ssh root@192.168.40.4 "pct exec 333 -- journalctl -u da-invent -n 200 --no-pager"

# Query sqlite read-only (hub o tenant)
ssh root@192.168.40.4 "pct exec 333 -- sqlite3 /opt/da-invent/data/tenants/70791.db 'SELECT ...'"
```

## Quando NON usare

- Non usare per applicare migrazioni schema: lo schema viene applicato all'avvio dal codice (`db-hub-schema.ts`/`db-tenant-schema.ts`). Se serve un ALTER irreversibile su DB tenant in prod → backup prima e operazione manuale documentata in ADR.
- Non usare per "ripristinare" un DB tenant: usare `scripts/pull-db-from-pct.sh` / `restore-local-db.sh` lato dev.

## Anti-regressione

- **Mai** `git push --force` su `main`: prod fa `git pull`, si rompe.
- **Mai** scrivere credenziali in chiaro su disco nel container (usare sempre encrypt via `src/lib/crypto.ts`).
- Per debug read-only o non distruttivi (SSH, pct exec, sqlite SELECT, restart servizio, push file fixato) **procedere senza chiedere conferma all'utente** (regola operativa CLAUDE.md).
- Per azioni distruttive **chiedere prima**: modifiche DB hub, DROP tabelle, distruzione container, modifiche rete, push su `main`, scrittura credenziali in chiaro.
- Dopo deploy verificare: `systemctl is-active da-invent` = `active`, `curl -sk https://localhost:3001/api/health` dentro il container.
