#!/bin/bash
# Cattura di prova per la sonda avanzata (piano 2026-11-23-sonda-avanzata-zeek, Task 1).
# Gira sul nodo PX-NAS, con accanto sonda.zeek e traffico.py (stessa cartella):
#   scp collector-traffico/zeek/sonda.zeek collector-traffico/banco/{cattura-zeek.sh,traffico.py,server-finti.py} root@192.168.99.1:/root/cattura-zeek/
#   ssh root@192.168.99.1 bash /root/cattura-zeek/cattura-zeek.sh
# VM 109 = 192.168.99.89 (collector-banco, ens19 in mirror); CT 110 = banco-carico; CT 103 = banco-sim.
# Snapshot della VM prima, ripristino dopo. I valori «segreti» sono inventati: prova-utente, Prova-Segreto-7731,
# comunita-di-prova-7731. Risultato in /root/cattura-zeek/esito/{grezzi,filtrati,vivo.txt,zeek.txt}.
set -u
QUI=$(cd "$(dirname "$0")" && pwd)
VMID=109
VMIP=192.168.99.89
SNAP=pre-zeek-cattura-$(date +%Y%m%d)
ZEEK_VERSIONE=9.0.1-0
VM="ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new root@$VMIP"
ESITO=$QUI/esito
rm -rf "$ESITO"; mkdir -p "$ESITO"

aspetta_vm() { for _ in $(seq 60); do $VM true 2>/dev/null && return 0; sleep 3; done; echo "VM non risponde"; return 1; }
mirror() { # $1 = veth da copiare; toglie la copia dall'altro
  local da=$1 via=$2
  tc filter del dev "$via" ingress 2>/dev/null; tc filter del dev "$via" egress 2>/dev/null; tc qdisc del dev "$via" clsact 2>/dev/null
  tc qdisc add dev "$da" clsact 2>/dev/null
  tc filter add dev "$da" ingress matchall action mirred egress mirror dev tap${VMID}i1
  tc filter add dev "$da" egress matchall action mirred egress mirror dev tap${VMID}i1
}

ripristina() {
  echo "== ripristino"
  pct exec 110 -- rm -f /tmp/traffico.py /tmp/pw.sh
  pct exec 103 -- sh -c 'pkill -f server-finti.py; pkill -f "s_server -accept 4443"; rm -f /tmp/server-finti.py /tmp/server-finti.log /tmp/zc-k.pem /tmp/zc-c.pem' 2>/dev/null
  mirror veth103i0 veth110i0
  qm stop $VMID
  qm rollback $VMID "$SNAP"
  qm start $VMID
  sleep 5; ip link set tap${VMID}i1 nomaster
  aspetta_vm && $VM 'systemctl is-active collector-traffico collector-ascolto pmacctd-collector; test -d /opt/zeek && echo "ZEEK ANCORA LI" || echo "VM come prima"'
  qm delsnapshot $VMID "$SNAP"
  qm config $VMID | grep -E '^(cores|memory)'
}

echo "== snapshot $SNAP e VM a 2 vCPU / 2 GB"
qm snapshot $VMID "$SNAP" --description "prima della cattura Zeek (DA-IPAM, piano sonda avanzata)" || exit 1
# da qui in poi, qualunque uscita rimette il banco com'era
trap ripristina EXIT
qm shutdown $VMID --timeout 60 || qm stop $VMID
qm set $VMID --cores 2 --memory 2048 >/dev/null
qm start $VMID
sleep 5; ip link set tap${VMID}i1 nomaster
aspetta_vm || exit 1
# Durante la cattura si copia banco-carico (veth110i0): tutto il suo traffico, una volta sola.
mirror veth110i0 veth103i0
pct exec 110 -- ethtool -K eth0 tso off gso off 2>/dev/null

echo "== Zeek $ZEEK_VERSIONE sulla VM"
$VM "systemctl stop collector-traffico collector-ascolto pmacctd-collector 2>/dev/null
  set -e
  echo 'deb http://download.opensuse.org/repositories/security:/zeek/Debian_12/ /' > /etc/apt/sources.list.d/zeek.list
  # .asc: apt legge la chiave in chiaro, sulla VM non serve gpg (che non c'e')
  curl -fsSL https://download.opensuse.org/repositories/security:zeek/Debian_12/Release.key -o /etc/apt/trusted.gpg.d/zeek.asc
  apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y zeek-lts-core=$ZEEK_VERSIONE >/dev/null
  /opt/zeek/bin/zeek --version
  mkdir -p /root/zc/vivo" || { echo "INSTALLAZIONE FALLITA"; exit 1; }
scp -q -o BatchMode=yes "$QUI/sonda.zeek" root@$VMIP:/root/zc/

echo "== controllo dello script e nomi dei campi"
$VM "cd /root/zc; /opt/zeek/bin/zeek -a sonda.zeek >a.out 2>&1; e=\$?; tail -20 a.out; echo esito-a=\$e
  P=/opt/zeek/share/zeek
  echo '-- connessioni lunghe:'; ls \$P/policy/frameworks/conn/ 2>&1
  echo '-- ldap:'; ls \$P/base/protocols/ldap/ 2>&1; grep -nE '^\s+[a-z_]+:.*&log' \$P/base/protocols/ldap/main.zeek 2>&1 | head -40
  grep -n 'LOG' \$P/base/protocols/ldap/main.zeek | head
  echo '-- krb:'; grep -nE '^\s+[a-z_]+:.*&log' \$P/base/protocols/krb/main.zeek | head -30
  echo '-- ntlm:'; grep -nE '^\s+[a-z_]+:.*&log' \$P/base/protocols/ntlm/main.zeek | head -20
  echo '-- ftp:'; grep -nE '^\s+[a-z_]+:.*&log' \$P/base/protocols/ftp/info.zeek 2>/dev/null | head -20
  echo '-- s7/bacnet:'; ls \$P/base/protocols/ | tr '\n' ' '" > "$ESITO/zeek.txt" 2>&1
grep -q "esito-a=0" "$ESITO/zeek.txt" || { echo "sonda.zeek NON SI CARICA:"; head -25 "$ESITO/zeek.txt"; exit 1; }

echo "== cattura e Zeek dal vivo (rotazione 5 min)"
$VM "cd /root/zc; nohup tcpdump -i ens19 -s 0 -U -w cattura.pcap >/dev/null 2>&1 &
  cd vivo; nohup /opt/zeek/bin/zeek -C -i ens19 ../sonda.zeek >zeek.out 2>&1 &
  sleep 8; pgrep -x zeek >/dev/null && echo zeek-vivo-ok"

echo "== server finti su banco-sim (103) e traffico da banco-carico (110)"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=prova.banco.test" -keyout /tmp/zc-k.pem -out /tmp/zc-c.pem 2>/dev/null
pct push 103 /tmp/zc-k.pem /tmp/zc-k.pem; pct push 103 /tmp/zc-c.pem /tmp/zc-c.pem
pct push 103 "$QUI/server-finti.py" /tmp/server-finti.py
pct push 110 "$QUI/traffico.py" /tmp/traffico.py
pct exec 103 -- sh -c 'nohup python3 /tmp/server-finti.py 192.168.99.223 >/tmp/server-finti.log 2>&1 &
  nohup openssl s_server -accept 4443 -tls1 -cipher "DEFAULT:@SECLEVEL=0" -cert /tmp/zc-c.pem -key /tmp/zc-k.pem -www >/dev/null 2>&1 &'
sleep 2
pct exec 110 -- python3 /tmp/traffico.py
pct exec 110 -- sh -c 'echo Q | openssl s_client -connect 192.168.99.223:4443 -tls1 -cipher "DEFAULT:@SECLEVEL=0" >/dev/null 2>&1; echo tls1-fatto
  dig +short +tries=1 +time=2 prova-zeek.banco.test @192.168.99.254 >/dev/null; dig +short +tries=1 +time=2 www.debian.org @192.168.99.254 >/dev/null; echo dns-fatto
  printf "#!/bin/sh\necho Sbagliata-0000\n" > /tmp/pw.sh; chmod +x /tmp/pw.sh
  for i in $(seq 40); do SSH_ASKPASS=/tmp/pw.sh SSH_ASKPASS_REQUIRE=force DISPLAY=x setsid -w ssh -n -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -o ConnectTimeout=3 utente-ssh@192.168.99.223 true >/dev/null 2>&1; done; echo ssh-fatto
  for i in $(seq 60); do curl -s -m 2 -o /dev/null "http://192.168.99.222/?id=1%27%20OR%20%271%27=%271&n=$i"; done; echo sqli-fatto'
pct exec 103 -- sh -c 'pkill -f server-finti.py; pkill -f "s_server -accept 4443"; rm -f /tmp/server-finti.py /tmp/server-finti.log /tmp/zc-k.pem /tmp/zc-c.pem'
rm -f /tmp/zc-k.pem /tmp/zc-c.pem

echo "== attesa della rotazione (6 minuti dall'avvio)"
sleep 330
$VM "pkill -INT -x zeek; sleep 3; pkill -INT tcpdump; sleep 1; cd /root/zc/vivo; ls -la; tail -5 zeek.out" > "$ESITO/vivo.txt" 2>&1

echo "== le due letture della stessa copia"
$VM 'cd /root/zc; mkdir -p grezzi filtrati
  # grezzi: niente filtri nostri e anche quelli di Zeek spenti (password catturate), per dimostrare che la prova le troverebbe
  G="/opt/zeek/bin/zeek -C -r ../cattura.pcap local base/protocols/ldap base/protocols/modbus misc/stats LogAscii::use_json=T HTTP::default_capture_password=T FTP::default_capture_password=T"
  ( cd grezzi; $G LDAP::default_capture_password=T >zeek.out 2>&1 || { echo "senza LDAP::default_capture_password" >zeek.out; rm -f *.log; $G >>zeek.out 2>&1; } )
  ( cd filtrati; /opt/zeek/bin/zeek -C -r ../cattura.pcap ../sonda.zeek Log::default_rotation_interval=0sec >zeek.out 2>&1 )
  for d in grezzi filtrati; do echo "-- $d"; wc -l $d/*.log | sort -n; tail -3 $d/zeek.out; done' >> "$ESITO/vivo.txt" 2>&1
scp -q -r -o BatchMode=yes root@$VMIP:/root/zc/grezzi root@$VMIP:/root/zc/filtrati "$ESITO/"
# la copia resta sul nodo (solo traffico del banco, valori inventati) per rileggerla con uno script cambiato; mai nel repo
scp -q -o BatchMode=yes root@$VMIP:/root/zc/cattura.pcap "$ESITO/"

ripristina
trap - EXIT
echo "== fatto: $ESITO"
