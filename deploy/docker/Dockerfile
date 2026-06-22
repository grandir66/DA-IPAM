# DA-IPAM — immagine appliance (parità comportamentale con hub systemd)
#
# Build (dalla root repo):
#   docker build -f deploy/docker/Dockerfile -t appliance/da-ipam:latest .
#
# Runtime: ENCRYPTION_KEY e AUTH_SECRET obbligatori da compose (.env host).
# Segreti persistiti in /data/.env.local (volume), non nel layer immagine.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DA_INVENT_CONTAINER=1 \
    DA_INVENT_DATA_DIR=/data \
    DA_INVENT_APP_DIR=/opt/da-ipam \
    DA_INVENT_HOST=0.0.0.0 \
    DA_INVENT_PORT=3001 \
    PORT=3001 \
    AUTH_TRUST_HOST=true

# Tool di rete per scan + Python bridge WinRM/WMI/SSH
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl sqlite3 \
      iputils-ping nmap iproute2 snmp \
      python3 python3-venv python3-dev python3-pip \
      libffi-dev libkrb5-dev gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/da-ipam

COPY --from=builder /build /opt/da-ipam

ENV HOME=/root \
    WINRM_VENV=/root/.da-invent-venv \
    WINRM_PYTHON=/root/.da-invent-venv/bin/python3 \
    SSH_PYTHON=/root/.da-invent-venv/bin/python3

RUN chmod +x /opt/da-ipam/deploy/docker/setup-winrm-venv.sh \
    && WINRM_VENV=/root/.da-invent-venv /opt/da-ipam/deploy/docker/setup-winrm-venv.sh

# Nessun .env.local nell'immagine — solo volume /data
RUN rm -f /opt/da-ipam/.env.local /opt/da-ipam/.env \
    && mkdir -p /data /opt/da-ipam/logs \
    && rm -rf /opt/da-ipam/data \
    && ln -sf /data /opt/da-ipam/data \
    && chmod +x /opt/da-ipam/deploy/docker/entrypoint.sh

VOLUME ["/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3001/api/health | grep -q '"status":"ok"'

ENTRYPOINT ["/opt/da-ipam/deploy/docker/entrypoint.sh"]
CMD ["npm", "start"]
