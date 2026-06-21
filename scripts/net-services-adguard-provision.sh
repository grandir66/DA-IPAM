#!/usr/bin/env bash
# Provision AdGuard Home systemd unit + config (idempotente).
# Usato da net-services.sh e dal bridge al primo toggle adblock.
# Target: VM net-services (ADR-0007). Unbound su 127.0.0.1:5335, AdGuard LAN :53.
set -euo pipefail

AGH_BIN="/usr/local/bin/AdGuardHome"
AGH_DIR="/etc/AdGuardHome"
AGH_CONF="${AGH_DIR}/AdGuardHome.yaml"
UNIT="/etc/systemd/system/adguardhome.service"
UNBOUND_SNIPPET="/etc/unbound/unbound.conf.d/10-net-services-listen.conf"
LAN_IP="${NET_SERVICES_LAN_IP:-}"

if [ ! -x "${AGH_BIN}" ]; then
  echo "[adguard-provision] ERROR: ${AGH_BIN} non trovato — eseguire net-services install packages"
  exit 1
fi

if [ -z "${LAN_IP}" ]; then
  LAN_IP="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
fi

mkdir -p "${AGH_DIR}"
chmod 755 "${AGH_DIR}"

# Unbound: solo loopback :5335 (AdGuard upstream). Idempotente.
cat > "${UNBOUND_SNIPPET}" <<EOF
# Managed by net-services — do not edit manually (DA-IPAM / bridge)
server:
    interface: 127.0.0.1@5335
    access-control: 127.0.0.0/8 allow
    do-not-query-localhost: no
    hide-identity: yes
    hide-version: yes
EOF
chmod 644 "${UNBOUND_SNIPPET}"

if systemctl is-active --quiet unbound.service 2>/dev/null; then
  systemctl reload-or-restart unbound.service || systemctl restart unbound.service
fi

# Config AdGuard (schema v29) — API admin su loopback :3000, DNS su tutte le interfacce :53
if [ ! -f "${AGH_CONF}" ]; then
  cat > "${AGH_CONF}" <<EOF
http:
  address: 127.0.0.1:3000
  port: 3000
users: []
dns:
  bind_hosts:
    - 0.0.0.0
  port: 53
  upstream_dns:
    - 127.0.0.1:5335
  bootstrap_dns:
    - 1.1.1.1:53
    - 8.8.8.8:53
  protection_enabled: true
  filtering_enabled: true
  filters:
    - enabled: true
      url: https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt
      name: AdGuard DNS filter
      id: 1
    - enabled: true
      url: https://adguardteam.github.io/HostlistsRegistry/assets/filter_2.txt
      name: AdGuard Tracking Protection
      id: 2
schema_version: 29
EOF
  chmod 600 "${AGH_CONF}"
fi

cat > "${UNIT}" <<EOF
[Unit]
Description=AdGuard Home — DNS filtering frontend (net-services)
Documentation=https://github.com/AdguardTeam/AdGuardHome
After=network-online.target unbound.service
Wants=network-online.target
Conflicts=systemd-resolved.service

[Service]
Type=simple
WorkingDirectory=${AGH_DIR}
ExecStart=${AGH_BIN} --no-check-update -c ${AGH_CONF} -w ${AGH_DIR}
Restart=on-failure
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "[adguard-provision] OK — unit ${UNIT}, unbound @5335, LAN ${LAN_IP:-*}"
