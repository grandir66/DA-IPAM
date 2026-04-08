#!/bin/bash
# Attiva la NIC principale nel CT LXC (Proxmox net0 → di solito eth0).
# Chiamato da da-invent-net-up.service a ogni avvio.
command -v ip >/dev/null 2>&1 || exit 0
for dev in eth0 ens3 enp0s3; do
  if ip link show "$dev" &>/dev/null; then
    ip link set "$dev" up 2>/dev/null || true
    exit 0
  fi
done
exit 0
