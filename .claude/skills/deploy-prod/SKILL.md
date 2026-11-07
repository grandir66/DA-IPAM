---
name: deploy-prod
description: Deploy DA-INVENT in produzione (VM 533, Proxmox PX-04) — GitOps stile, git pull + build + restart
---

# Deploy produzione (Proxmox VM 533)

DA-INVENT gira sulla **VM 533**, dal 19/10 sul nodo `DA-PX-03` (prima `DA-PX-04`, `192.168.40.4`: da lì `pvesh` raggiunge il cluster). SSH diretto: `ssh root@192.168.4.8`.
A partire dal 2026-05-12 `/opt/da-invent` è un **git repo** (GitOps).

**Dal 25/10 il servizio è `da-ipam`, non `da-invent`** (`/opt/da-invent` è un collegamento a `/opt/da-ipam`). Il timer `da-ipam-update` scarica il ramo `dev` ogni 15 minuti, ricostruisce e riavvia: **un push su `dev` è un deploy sull'hub**. Prima di un lavoro a servizio fermo si ferma il timer (07/11: 0.9.996 è arrivata da sola).

```text
Host hub:       192.168.4.8 (VM 533)
SSH:            ssh -J root@192.168.40.4 root@192.168.4.8
App path:       /opt/da-invent  (git repo, branch feature/remote-agents o main)
Service:        systemctl status da-ipam
DB tenant:      /opt/da-invent/data/tenants/<tenantId>.db
DB hub:         /opt/da-invent/data/hub.db
.env:           /opt/da-invent/.env.local  (contiene ENCRYPTION_KEY — NON commitato)
Venv pywinrm:   /root/.da-invent-venv  (Kerberos)
Backup safety:  /opt/da-invent.pre-gitops/  (snapshot pre-conversione GitOps, rimuovere dopo 7gg di stabilità)
```

## Comando standard — deploy ultimo HEAD su current branch

```bash
ssh -J root@192.168.40.4 root@192.168.4.8 \
  "cd /opt/da-invent && git fetch && git reset --hard origin/\$(git rev-parse --abbrev-ref HEAD) && npm ci && npm run build && systemctl restart da-ipam"
```

Spiegazione:

- `git fetch` aggiorna refs dal remote
- `git reset --hard origin/<current-branch>` allinea local a remote (sovrascrive
  cambi locali — accettabile perché .env.local, data/, .next/, node_modules/
  sono gitignored e non vengono toccati)
- `npm ci` reinstalla node_modules deterministici se package-lock cambia
- `npm run build` rigenera .next (lento, 2-5 min)
- `systemctl restart` riavvia il service

## Comando rapido (solo restart, senza build)

```bash
ssh -J root@192.168.40.4 root@192.168.4.8 "systemctl restart da-ipam && sleep 4 && systemctl is-active da-ipam"
```

## Verifica post-deploy

```bash
ssh -J root@192.168.40.4 root@192.168.4.8 \
  "curl -fsSk https://localhost/api/version && echo && systemctl is-active da-ipam && cd /opt/da-invent && git log --oneline -3"
```

Output atteso: `{"version":"0.2.X","name":"da-invent"}` + `active` + 3 commit più recenti.

## Cambio branch (es. da main a feature/remote-agents)

```bash
ssh -J root@192.168.40.4 root@192.168.4.8 \
  "cd /opt/da-invent && git fetch && git checkout feature/remote-agents && git reset --hard origin/feature/remote-agents && npm ci && npm run build && systemctl restart da-ipam"
```

## Deploy a tag specifico (rollback / pinning)

```bash
ssh -J root@192.168.40.4 root@192.168.4.8 \
  "cd /opt/da-invent && git fetch --tags && git checkout v0.2.426 && npm ci && npm run build && systemctl restart da-ipam"
```

## Comandi diagnostici frequenti

```bash
# Shell sulla VM
ssh -J root@192.168.40.4 root@192.168.4.8

# Log servizio in tempo reale
ssh -J root@192.168.40.4 root@192.168.4.8 "journalctl -u da-ipam -n 100 --no-pager -f"

# Stato git produzione
ssh -J root@192.168.40.4 root@192.168.4.8 "cd /opt/da-invent && git log --oneline -10 && git status -sb"

# Query SQLite read-only (hub)
ssh -J root@192.168.40.4 root@192.168.4.8 "sqlite3 /opt/da-invent/data/hub.db 'SELECT code, ragione_sociale FROM tenants;'"

# Verifica backup nightly
ssh -J root@192.168.40.4 root@192.168.4.8 "ls -lh /var/backups/da-invent/\$(date +%F)/"
```

## Migrazione schema DB

Lo schema viene applicato all'avvio dal codice (`db-hub-schema.ts`,
`db-tenant-schema.ts`) tramite `applyMigrations()` idempotente.

Per ALTER irreversibili o cambi che potrebbero perdere dati:

1. Backup manuale: `POST /api/admin/backup-now` (auth admin)
2. Annota la procedura in `docs/adr/`
3. Esegui il deploy normale — lo schema si auto-applica

## Quando NON usare questa skill

- **Modifica .env.local in produzione**: non si fa via skill. SSH manuale,
  edit con `vi`, restart. Documenta la modifica.
- **Restore DB**: usa [docs/playbooks/DR.md](../../../docs/playbooks/DR.md).
- **Rotazione ENCRYPTION_KEY**: usa [docs/playbooks/CHANGE-ENCRYPTION-KEY.md](../../../docs/playbooks/CHANGE-ENCRYPTION-KEY.md).
- **Setup nuovo hub da zero**: usa [docs/playbooks/DEPLOY-NEW-HUB.md](../../../docs/playbooks/DEPLOY-NEW-HUB.md).
