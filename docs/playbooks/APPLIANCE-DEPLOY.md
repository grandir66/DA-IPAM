# Playbook — Deploy appliance Docker (parità hub systemd)

Distribuzione **deterministica** di DA-IPAM in container: stesso comportamento del hub
VM `192.168.4.8` (systemd + `/opt/da-invent/.env.local`), senza doppie chiavi né segreti
nel layer immagine.

---

## Parità hub ↔ container

| Aspetto | Hub VM (systemd) | Appliance Docker |
|---------|------------------|------------------|
| Fonte segreti | `/opt/da-invent/.env.local` | `/opt/appliance-stack/.env` **sul host** |
| Caricamento | `EnvironmentFile=` systemd | `environment:` + `env_file:` compose |
| Persistenza | file su disco VM | volume `ipam_data` → `/data/.env.local` |
| Path effettivo app | `.env.local` in cwd | symlink `/opt/da-ipam/.env.local` → `/data/.env.local` |
| Chiavi random al boot | solo primo `install.sh` | **mai** (fail-fast se manca ENCRYPTION_KEY) |
| Verifica | manuale / health | `GET /api/health` + `scripts/verify-appliance-health.sh` |
| Scan rete | nmap/ping nativi | `network_mode: host` + `CAP_NET_RAW` |

---

## Artefatti nel repository

| File | Ruolo |
|------|--------|
| `deploy/docker/Dockerfile` | Immagine canonica (Node 22, tool scan, no `.env.local` in image) |
| `deploy/docker/entrypoint.sh` | Fail-fast segreti, symlink volume, migrazione stale |
| `deploy/docker/compose.da-ipam.example.yml` | Fragmento compose pronto |
| `src/lib/env-secrets.ts` | Runtime → file segreti (mai il contrario) |
| `src/lib/encryption-key-health.ts` | Probe decrypt credenziali |
| `scripts/appliance-env-init.sh` | Init `.env` host idempotente |
| `scripts/verify-appliance-health.sh` | Smoke test post-deploy |
| `scripts/appliance-integrate-fix.sh` | Allinea token Edge/LibreNMS/Net-Services + compose + DB (da PVE) |

---

## Prima installazione

```bash
# 1. Segreti sul host (una volta)
sudo bash scripts/appliance-env-init.sh /opt/appliance-stack/.env
# → salvare ENCRYPTION_KEY in vault

# 2. Integrare compose (vedi deploy/docker/compose.da-ipam.example.yml)
cd /opt/appliance-stack
docker compose build da-ipam
docker compose up -d da-ipam

# 3. Verifica determinismo
bash scripts/verify-appliance-health.sh http://127.0.0.1:3001
```

Atteso in log container:

```text
[entrypoint] DA-IPAM container — secrets=/data/.env.local data=/data
[env-secrets] File segreti aggiornato: /data/.env.local
[encryption-key] OK — N/N credenziali decifrabili (fingerprint=…)
```

Atteso JSON health:

```json
{
  "status": "ok",
  "deploy_mode": "container",
  "encryption_key": {
    "configured": true,
    "credentials_decryptable": true
  }
}
```

---

## Regole distribuzione OEM

1. **`ENCRYPTION_KEY` solo in `.env` host** — non rigenerare su upgrade se `/data` esiste.
2. **Non montare** un `.env.local` custom nel container con chiave diversa.
3. **Backup**: volume `/data` + chiave in vault **separato**.
4. **Rebuild immagine** (`docker compose build`) non tocca segreti né DB.
5. **Rotazione chiave**: solo via [CHANGE-ENCRYPTION-KEY.md](./CHANGE-ENCRYPTION-KEY.md).

---

## Recovery lab (mismatch pre-fix)

Se credenziali cifrate con vecchia chiave `.env.local` del container:

1. Recupera quella chiave (fingerprint / decrypt test).
2. Impostala in `/opt/appliance-stack/.env` come `ENCRYPTION_KEY`.
3. `docker compose up -d da-ipam` — entrypoint + `env-secrets` allineano `/data/.env.local`.
4. `verify-appliance-health.sh` → `credentials_decryptable: true`.

---

## Upgrade rolling

```bash
cd /opt/appliance-stack
# NON modificare .env
docker compose build da-ipam
docker compose up -d da-ipam
bash scripts/verify-appliance-health.sh
```

---

## Riferimenti

- Hub systemd: `deploy/da-invent.service`, `scripts/install.sh`
- Rotazione chiave: [CHANGE-ENCRYPTION-KEY.md](./CHANGE-ENCRYPTION-KEY.md)
- DR: [DR.md](./DR.md)
