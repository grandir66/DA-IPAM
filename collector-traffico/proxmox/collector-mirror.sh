#!/bin/bash
# Hookscript Proxmox della VM collector di traffico (DA-IPAM, collector-traffico/).
# Copia sull'uplink il traffico delle VM verso la seconda scheda della VM (tap<vmid>i1).
# Parte a ogni avvio della VM (anche dopo un riavvio del nodo) e si toglie quando la VM si ferma.
# Tocca solo i filtri con le sue due priorita'; la VLAN di storage non si copia.
# Non deve mai fallire: un'uscita diversa da 0 in pre-start impedirebbe l'avvio della VM.
VMID="$1"; FASE="$2"
UPLINK=bond10
VLAN_FUORI=16
# 1 = stacca la scheda in copia dal bridge su cui e' dichiarata (nodi senza un bridge vuoto da darle)
STACCA=0
# Un nodo fatto diversamente lo dice qui, senza toccare lo script (es. DA-PX-05: UPLINK=bond25, VLAN_FUORI=, STACCA=1)
[ -r /etc/collector-mirror.conf ] && . /etc/collector-mirror.conf
TAP="tap${VMID}i1"
P_SALTA=4476; P_COPIA=4477

togli() {
  for v in ingress egress; do
    tc filter del dev "$UPLINK" "$v" pref "$P_COPIA" 2>/dev/null
    tc filter del dev "$UPLINK" "$v" pref "$P_SALTA" 2>/dev/null
  done
}

case "$FASE" in
  post-start)
    if [ ! -d "/sys/class/net/$TAP" ]; then
      logger -t collector-mirror "VM $VMID: $TAP non c'e', copia non attivata"; exit 0
    fi
    [ "$STACCA" = "1" ] && ip link set "$TAP" nomaster
    tc qdisc add dev "$UPLINK" clsact 2>/dev/null
    togli
    for v in ingress egress; do
      if [ -n "$VLAN_FUORI" ]; then
        tc filter add dev "$UPLINK" "$v" pref "$P_SALTA" protocol 802.1Q flower vlan_id "$VLAN_FUORI" action pass \
          || logger -t collector-mirror "VM $VMID: esclusione della VLAN $VLAN_FUORI ($v) non messa"
      fi
      tc filter add dev "$UPLINK" "$v" pref "$P_COPIA" matchall action mirred egress mirror dev "$TAP" \
        || logger -t collector-mirror "VM $VMID: filtro $v su $UPLINK non messo"
    done
    logger -t collector-mirror "VM $VMID: copia di $UPLINK verso $TAP attiva (VLAN esclusa: ${VLAN_FUORI:-nessuna})"
    ;;
  pre-stop|post-stop)
    togli
    logger -t collector-mirror "VM $VMID: copia di $UPLINK tolta"
    ;;
esac
exit 0
