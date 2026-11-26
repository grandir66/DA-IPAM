#!/bin/bash
# Prova di proxmox/collector-mirror.sh nel modo BRIDGE (25/11/2026), da root su un Linux, in uno spazio di rete isolato:
# un bridge finto, tre «VM», una esclusa, un «router» con una VLAN esclusa. Non tocca nessuna rete vera.
# Uso:  bash prova-mirror-bridge.sh /percorso/collector-mirror.sh
set -u
SCRIPT="$(readlink -f "${1:?percorso di collector-mirror.sh}")"
N=provamirror$$; T="$(mktemp -d "${TMPDIR:-/tmp}/provamirror.XXXXXX")"; ROTTE=0
pulisci() { for n in $N $N-a $N-b $N-c $N-r $N-s; do ip netns del $n 2>/dev/null; done; rm -rf "$T"; }
trap pulisci EXIT
es() { ip netns exec "$@"; }
ok() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "ROTTA $1: atteso $3, visto $2"; ROTTE=$((ROTTE + 1)); fi; }
for n in $N $N-a $N-b $N-c $N-r $N-s; do ip netns add $n; es $n ip link set lo up; done
printf 'BRIDGE=br0\nVM_FUORI="301"\nVLAN_FUORI="230 16"\nSTACCA=1\n' > "$T/conf"
es $N ip link add br0 type bridge vlan_filtering 1
es $N ip link set br0 up
vm() { # spazio, porta, indirizzo
  es $N ip link add "$2" type veth peer name eth0 netns "$1"
  es $N ip link set "$2" master br0 up
  [ -n "$3" ] && es "$1" ip addr add "$3" dev eth0
  es "$1" ip link set eth0 up
}
vm $N-a tap10i0 10.9.0.1/24; vm $N-b fwpr20p0 10.9.0.2/24; vm $N-c fwpr301p0 10.9.0.3/24; vm $N-r tap3010i0 ""
es $N bridge vlan add dev tap3010i0 vid 230
es $N-r ip link add link eth0 name eth0.230 type vlan id 230
es $N-r ip addr add 10.9.0.9/24 dev eth0; es $N-r ip addr add 10.8.0.9/24 dev eth0.230; es $N-r ip link set eth0.230 up
vm $N-s tap999i1 ""
SCR() { es $N env COLLECTOR_MIRROR_CONF="$T/conf" bash "$SCRIPT" 999 "$1"; }
conta() { # comando in "$@" dopo il filtro; quanti pacchetti arrivano alla sonda
  local f="$1"; shift
  es $N-s timeout 4 tcpdump -nn -i eth0 "$f" > "$T/v" 2>/dev/null & local p=$!
  sleep 1; "$@" >/dev/null 2>&1; wait $p; grep -c . "$T/v"
}
pinga() { es "$1" ping -c5 -i0.2 -W1 "$2"; }
pinga $N-a 10.9.0.2 >/dev/null; pinga $N-c 10.9.0.1 >/dev/null
SCR post-start
ok "fra due VM ogni pacchetto una volta (5 richieste + 5 risposte)" "$(conta icmp pinga $N-a 10.9.0.2)" 10
ok "la scheda della sonda e' staccata dal bridge" "$(es $N ip -o link show tap999i1 | grep -c 'master br0')" 0
ok "della VM esclusa si vede solo l'altra meta'" "$(conta icmp pinga $N-c 10.9.0.1)" 5
ok "VM 3010 non e' la 301: la sua porta si copia" "$(conta 'icmp and src 10.9.0.9' pinga $N-r 10.9.0.2)" 5
es $N-r ip neigh replace 10.8.0.5 lladdr 02:00:00:00:00:05 dev eth0.230
ok "la VLAN esclusa non si copia" "$(conta 'net 10.8.0.0/24 or (vlan and net 10.8.0.0/24)' pinga $N-r 10.8.0.5)" 0
pingar() { es $N-a ping -c5 -i0.2 -W1 10.9.0.77; es $N-a ping -c5 -i0.2 -W1 10.9.0.2; }
es $N-b ip addr add 10.9.0.77/32 dev eth0
ok "prima di escludere una rete la si vede" "$(conta 'icmp and host 10.9.0.77' pingar)" 10
printf 'RETI_FUORI="10.9.0.77/32"\n' >> "$T/conf"; SCR post-start
ok "rete esclusa: ne' richieste ne' risposte" "$(conta 'icmp and host 10.9.0.77' pingar)" 0
es $N bridge vlan add dev tap3010i0 vid 240
es $N-r ip link add link eth0 name eth0.240 type vlan id 240; es $N-r ip addr add 10.7.0.9/24 dev eth0.240; es $N-r ip link set eth0.240 up
es $N-r ip neigh replace 10.7.0.5 lladdr 02:00:00:00:00:06 dev eth0.240
ok "una VLAN qualunque si vede" "$(conta 'vlan and net 10.7.0.0/24' pinga $N-r 10.7.0.5)" 5
es $N-r ip addr add 10.9.0.77/32 dev lo
ok "rete esclusa dentro un'altra VLAN: non si vede" "$(conta 'vlan and host 10.9.0.77' es $N-r ping -I 10.9.0.77 -c5 -i0.2 -W1 10.7.0.5)" 0
ok "col resto che si vede come prima" "$(conta 'icmp and host 10.9.0.2' pingar)" 10
MB() { es $N-b timeout 6 bash -c 'nc -l -p 9999 >/dev/null 2>&1 || python3 -c "
import socket;s=socket.socket();s.setsockopt(1,2,1);s.bind((\"\",9999));s.listen();c=s.accept()[0]
while c.recv(65536):pass"' & sleep 0.5; es $N-a python3 -c "
import socket;s=socket.create_connection(('10.9.0.2',9999));s.sendall(b'x'*4000000);s.close()"; }
BYTE="$(conta 'tcp and src 10.9.0.1 and dst port 9999' MB >/dev/null; grep -o 'length [0-9]*' "$T/v" | awk '{t+=$2} END{print (t>3999000 && t<4001000) ? "si" : "no:" t}')"
ok "4 MB fra due VM: contati una volta" "$BYTE" si
es $N ip link del tap10i0
es $N ip link add tap10i0 type veth peer name eth0 netns $N-a; es $N ip link set tap10i0 master br0 up
es $N-a ip addr add 10.9.0.1/24 dev eth0; es $N-a ip link set eth0 up; pinga $N-a 10.9.0.2 >/dev/null
ok "VM ripartita, prima del riallineamento: manca la sua meta'" "$(conta icmp pinga $N-a 10.9.0.2)" 5
SCR riallinea
ok "dopo il riallineamento: tutto" "$(conta icmp pinga $N-a 10.9.0.2)" 10
PRIMA="$(es $N tc filter show dev fwpr20p0 ingress pref 4477)"; SCR riallinea
ok "riallineare due volte non rimette i filtri a posto" "$([ "$PRIMA" = "$(es $N tc filter show dev fwpr20p0 ingress pref 4477)" ] && echo si)" si
sed -i 's/VM_FUORI="301"/VM_FUORI="301 20"/' "$T/conf"; SCR riallinea
ok "una VM esclusa dopo si toglie al riallineamento" "$(conta icmp pinga $N-a 10.9.0.2)" 5
es $N ip link del tap999i1; vm $N-s tap999i1 ""; SCR riallinea
ok "scheda della sonda rinata: si ricopia verso quella nuova" "$(conta icmp pinga $N-a 10.9.0.2)" 5
SCR pre-stop
ok "fermata la sonda non resta nessun filtro" "$(for p in tap10i0 fwpr20p0 tap3010i0 fwpr301p0; do es $N tc filter show dev $p ingress; done | grep -c .)" 0
es $N ip link del tap999i1; SCR riallinea
ok "senza la sonda il riallineamento non mette niente" "$(es $N tc filter show dev tap10i0 ingress | grep -c .)" 0
ok "le VM si parlano come prima" "$(pinga $N-a 10.9.0.2 | grep -c 'bytes from')" 5
[ $ROTTE = 0 ] && echo "TUTTE VERDI"; exit $ROTTE
