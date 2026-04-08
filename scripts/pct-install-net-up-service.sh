#!/bin/bash
# Installa nel CT LXC l'unità systemd permanente per alzare eth0/ens3/enp0s3 a ogni boot.
# Uso sul nodo Proxmox (root), dal clone del repo:
#   ./scripts/pct-install-net-up-service.sh 1011
#
set -euo pipefail

VMID="${1:-}"
if [[ -z "$VMID" ]]; then
  echo "Uso: $0 <VMID>" >&2
  exit 1
fi
command -v pct >/dev/null 2>&1 || { echo "Eseguire sul nodo Proxmox (pct non trovato)." >&2; exit 1; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCR="$ROOT/deploy/lxc-net-up/da-invent-ensure-net-up.sh"
UNIT="$ROOT/deploy/lxc-net-up/da-invent-net-up.service"
if [[ ! -f "$SCR" || ! -f "$UNIT" ]]; then
  echo "File mancanti in deploy/lxc-net-up/ (clone completo del repo richiesto)." >&2
  exit 1
fi

if ! pct config "$VMID" >/dev/null 2>&1; then
  echo "CT $VMID non trovato." >&2
  exit 1
fi

echo "=== Installazione da-invent-net-up nel CT $VMID ==="
pct exec "$VMID" -- install -d /usr/local/sbin /etc/systemd/system
pct exec "$VMID" -- bash -c 'cat > /usr/local/sbin/da-invent-ensure-net-up.sh' < "$SCR"
pct exec "$VMID" -- chmod 755 /usr/local/sbin/da-invent-ensure-net-up.sh
pct exec "$VMID" -- bash -c 'cat > /etc/systemd/system/da-invent-net-up.service' < "$UNIT"
pct exec "$VMID" -- systemctl daemon-reload
pct exec "$VMID" -- systemctl enable da-invent-net-up.service
pct exec "$VMID" -- systemctl start da-invent-net-up.service
echo "OK. Verifica: pct exec $VMID -- systemctl status da-invent-net-up.service --no-pager"
