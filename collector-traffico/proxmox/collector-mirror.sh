#!/bin/bash
# Hookscript Proxmox della VM collector di traffico (DA-IPAM, collector-traffico/).
# Copia il traffico delle VM verso la seconda scheda della VM (tap<vmid>i1). Due modi, uno per nodo:
#   UPLINK  copia entrata e uscita della scheda fisica del nodo (nodi Dalton);
#   BRIDGE  copia cio' che entra nel bridge da ogni sua porta (25/11/2026, DA-PX-OVH: le VM stanno su un bridge senza
#           schede fisiche). Ogni pacchetto entra da una porta sola, quindi si conta una volta, anche fra due VM del nodo.
# Parte a ogni avvio della VM (anche dopo un riavvio del nodo) e si toglie quando la VM si ferma. Col BRIDGE le porte
# nascono e muoiono con le VM: la fase «riallinea», chiamata ogni minuto da collector-mirror.timer, copre quelle nuove.
# Tocca solo i filtri con le sue priorita' (4475-4477); la VLAN di storage non si copia.
# Non deve mai fallire: un'uscita diversa da 0 in pre-start impedirebbe l'avvio della VM.
VMID="$1"; FASE="$2"
UPLINK=bond10
# VLAN da non copiare, separate da spazio
VLAN_FUORI=16
# col BRIDGE: le VM da non copiare, separate da spazio (le loro VLAN vanno anche in VLAN_FUORI: il router le rivede)
BRIDGE=
VM_FUORI=
# col BRIDGE: le reti da non copiare da nessuna porta (le altre VM che parlano con quelle escluse), separate da spazio
RETI_FUORI=
# 1 = stacca la scheda in copia dal bridge su cui e' dichiarata (nodi senza un bridge vuoto da darle)
STACCA=0
# Un nodo fatto diversamente lo dice qui, senza toccare lo script (es. DA-PX-05: UPLINK=bond25, VLAN_FUORI=, STACCA=1)
CONF="${COLLECTOR_MIRROR_CONF:-/etc/collector-mirror.conf}"
[ -r "$CONF" ] && . "$CONF"
case "$VMID" in ''|*[!0-9]*) exit 0 ;; esac
TAP="tap${VMID}i1"
P_RETI=4475; P_SALTA=4476; P_COPIA=4477
dillo() { logger -t collector-mirror "VM $VMID: $*"; }

# Le porte da copiare e in quali versi.
if [ -n "$BRIDGE" ]; then VERSI="ingress"; else VERSI="ingress egress"; fi
porte() {
  if [ -z "$BRIDGE" ]; then echo "$UPLINK"; return; fi
  local p v fuori
  for p in /sys/class/net/"$BRIDGE"/brif/*; do
    [ -e "$p" ] || continue
    p="${p##*/}"; fuori=
    [ "$p" = "$TAP" ] && continue
    # tap301i0, fwpr301p0, veth301i0: il numero della VM sta in mezzo, e 301 non deve prendere la 3010
    for v in $VM_FUORI; do
      case "$p" in "tap${v}i"[0-9]*|"fwpr${v}p"[0-9]*|"veth${v}i"[0-9]*) fuori=1 ;; esac
    done
    [ -n "$fuori" ] || echo "$p"
  done
}
# Le porte del nodo su cui ci sono filtri nostri: anche una uscita dal bridge o messa in VM_FUORI va ripulita.
coperte() {
  if [ -z "$BRIDGE" ]; then echo "$UPLINK"; return; fi
  local p
  for p in /sys/class/net/*; do
    p="${p##*/}"
    tc filter show dev "$p" ingress pref "$P_COPIA" 2>/dev/null | grep -q mirred && echo "$p"
  done
}
togli() {
  local v
  for v in $VERSI; do
    tc filter del dev "$1" "$v" pref "$P_COPIA" 2>/dev/null
    tc filter del dev "$1" "$v" pref "$P_SALTA" 2>/dev/null
    [ -n "$BRIDGE" ] && tc filter del dev "$1" "$v" pref "$P_RETI" 2>/dev/null
  done
}
togli_tutto() { local p; for p in $(coperte); do togli "$p"; done; }

metti() {
  local v l lato esito=0
  tc qdisc add dev "$1" clsact 2>/dev/null
  togli "$1"
  for v in $VERSI; do
    for l in $VLAN_FUORI; do
      tc filter add dev "$1" "$v" pref "$P_SALTA" protocol 802.1Q flower vlan_id "$l" action pass \
        || { dillo "esclusione della VLAN $l ($v) su $1 non messa"; esito=1; }
    done
    if [ -n "$BRIDGE" ]; then
      for l in $RETI_FUORI; do
        for lato in src_ip dst_ip; do
          tc filter add dev "$1" "$v" pref "$P_RETI" protocol ip flower "$lato" "$l" action pass \
            || { dillo "esclusione della rete $l su $1 non messa"; esito=1; }
          # anche instradata dentro un'altra VLAN (DA-PX-OVH: la 230 che parla con la 240 passa etichettata 240)
          tc filter add dev "$1" "$v" pref "$P_SALTA" protocol 802.1Q flower vlan_ethtype ipv4 "$lato" "$l" action pass \
            || { dillo "esclusione della rete $l etichettata su $1 non messa"; esito=1; }
        done
      done
    fi
    # senza l'esclusione non si copia: meglio non vedere che vedere cio' che si e' detto di non guardare
    if [ -n "$BRIDGE" ] && [ "$esito" = 1 ]; then togli "$1"; return 1; fi
    tc filter add dev "$1" "$v" pref "$P_COPIA" matchall action mirred egress mirror dev "$TAP" \
      || { dillo "filtro $v su $1 non messo"; esito=1; }
  done
  return $esito
}

case "$FASE" in
  post-start)
    if [ ! -d "/sys/class/net/$TAP" ]; then
      dillo "$TAP non c'e', copia non attivata"; exit 0
    fi
    [ "$STACCA" = "1" ] && ip link set "$TAP" nomaster
    togli_tutto
    quante=0
    for p in $(porte); do metti "$p" && quante=$((quante + 1)); done
    if [ -n "$BRIDGE" ]; then
      dillo "copia di $quante porte di $BRIDGE verso $TAP attiva (VM escluse: ${VM_FUORI:-nessuna}, VLAN escluse: ${VLAN_FUORI:-nessuna}, reti escluse: ${RETI_FUORI:-nessuna})"
    else
      dillo "copia di $UPLINK verso $TAP attiva (VLAN esclusa: ${VLAN_FUORI:-nessuna})"
    fi
    ;;
  riallinea)
    # solo col BRIDGE, solo se la VM e' accesa; non tocca le porte gia' a posto, quindi non perde pacchetti
    { [ -n "$BRIDGE" ] && [ -d "/sys/class/net/$TAP" ]; } || exit 0
    [ "$STACCA" = "1" ] && [ -e "/sys/class/net/$TAP/master" ] && ip link set "$TAP" nomaster
    giuste=" $(porte | tr '\n' ' ') "
    for p in $(coperte); do
      case "$giuste" in *" $p "*) ;; *) togli "$p"; dillo "copia di $p tolta" ;; esac
    done
    for p in $giuste; do
      tc filter show dev "$p" ingress pref "$P_COPIA" 2>/dev/null | grep -q "to device $TAP)" \
        || { metti "$p" && dillo "porta nuova $p: copia attiva"; }
    done
    ;;
  pre-stop|post-stop)
    togli_tutto
    dillo "copia di ${BRIDGE:-$UPLINK} tolta"
    ;;
esac
exit 0
