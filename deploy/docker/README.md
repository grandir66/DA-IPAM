# Docker appliance — build e runtime

Immagine ufficiale per stack `appliance-stack` (PX-NAS e distribuzione OEM).

## Build

Dalla **root del repository** DA-IPAM:

```bash
docker build -f deploy/docker/Dockerfile -t appliance/da-ipam:latest .
```

## Runtime (deterministico)

1. Host: `scripts/appliance-env-init.sh` → `/opt/appliance-stack/.env`
2. Compose: vedi `compose.da-ipam.example.yml`
3. Entrypoint: fail-fast se manca `ENCRYPTION_KEY`, symlink `/data/.env.local`
4. Boot app: `env-secrets.ts` allinea file volume ← runtime compose
5. Verifica: `scripts/verify-appliance-health.sh`

Documentazione completa: [docs/playbooks/APPLIANCE-DEPLOY.md](../../docs/playbooks/APPLIANCE-DEPLOY.md)
