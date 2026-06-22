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
| WinRM Windows | `/root/.da-invent-venv` + pywinrm | stesso path in immagine Docker + `WINRM_PYTHON` |

---

## Checklist installazione completa (stato verificato)

Ogni nuova installazione deve superare **tutti** i punti:

1. **Segreti** — `ENCRYPTION_KEY` e `AUTH_SECRET` generati una sola volta, persistiti su volume/disco.
2. **Python WinRM** — venv in `/root/.da-invent-venv` con `pywinrm`, `paramiko`, `impacket` (script `scripts/setup-winrm-venv.sh`).
3. **Hub systemd** — `./scripts/install.sh --systemd` oppure `bash scripts/hub-install.sh` su host esistente.
4. **Appliance Docker** — immagine buildata con `deploy/docker/Dockerfile` (Python incluso nel runtime, non solo builder).
5. **Verifica** — `bash scripts/verify-install.sh --url http://127.0.0.1:3001` (hub) o `bash scripts/verify-appliance-health.sh http://127.0.0.1:3001 appliance-ipam` (container).

Problemi evitati da questa checklist:

| Problema | Causa | Fix installer |
|----------|--------|----------------|
| `[PYWINRM_MISSING] Python non trovato` | Runtime Docker senza Python/venv | Dockerfile + entrypoint + `setup-winrm-venv.sh` |
| Scan software Windows assente | pywinrm non installato | `install.sh` / `hub-install.sh` / `update.sh` |
| Profilo device Mac errato (UPS) | vendor `other` + classificazione notebook | UI v0.2.717+ (Apple / Notebook Mac) |
| Software GLPI sparisce post-promozione | `host_id` agent non collegato | API promote + `linkInvAgentEndpointToHost` |

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
| `scripts/setup-winrm-venv.sh` | Venv Python WinRM/WMI/SSH (`/root/.da-invent-venv`) — hub + Docker |
| `scripts/verify-install.sh` | Smoke test venv + health HTTP |
| `scripts/verify-appliance-health.sh` | Smoke test post-deploy (health + WinRM) |
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

# 3. Verifica determinismo (health + WinRM venv)
bash scripts/verify-appliance-health.sh http://127.0.0.1:3001 appliance-ipam
# oppure senza nome container se curl da host raggiunge :3001:
# bash scripts/verify-install.sh --url http://127.0.0.1:3001
```

Atteso in log container:

```text
[setup-winrm-venv] OK — /root/.da-invent-venv/bin/python3 (pywinrm 0.5.0)
[entrypoint] DA-IPAM container — secrets=/data/.env.local data=/data winrm=/root/.da-invent-venv/bin/python3
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
bash scripts/verify-appliance-health.sh http://127.0.0.1:3001 appliance-ipam
```

---

## Riferimenti

- Hub systemd: `deploy/da-invent.service`, `scripts/install.sh`
- Rotazione chiave: [CHANGE-ENCRYPTION-KEY.md](./CHANGE-ENCRYPTION-KEY.md)
- DR: [DR.md](./DR.md)
