#!/bin/bash
# Cattura di prova per la sonda avanzata (piano 2026-11-23-sonda-avanzata-zeek, Task 1).
# Gira sul nodo PX-NAS, con accanto il codice del collector in tar, traffico.py e server-finti.py:
#   git archive origin/dev collector-traffico > collector-traffico.tar
#   scp collector-traffico.tar collector-traffico/banco/{cattura-zeek.sh,traffico.py,server-finti.py} root@192.168.99.1:/root/cattura-zeek/
# Installa il collector col profilo avanzato (installa.sh, come su una VM vera), fa il traffico di prova, guarda
# cosa arriva nell'archivio, poi rilegge la stessa copia con Zeek senza e con i filtri.
#   ssh root@192.168.99.1 bash /root/cattura-zeek/cattura-zeek.sh
# VM 109 = 192.168.99.89 (collector-banco, ens19 in mirror); CT 110 = banco-carico; CT 103 = banco-sim.
# Snapshot della VM prima, ripristino dopo. I valori «segreti» sono inventati: prova-utente, Prova-Segreto-7731,
# comunita-di-prova-7731. Risultato in /root/cattura-zeek/esito/{grezzi,filtrati,vivo.txt,zeek.txt}.
# SOLO_SSH=1: solo i 40 accessi SSH falliti, dal contenitore 103 verso il 110 (OpenSSH 9.2: quello di 103 è
# OpenSSH 10 e con PerSourcePenalties rifiuta chi sbaglia prima dell'autenticazione), niente rilettura né dati di prova.
set -u
SOLO_SSH=${SOLO_SSH:-0}
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

echo "== collector col profilo avanzato, con installa.sh (dal tar accanto: git archive origin/dev collector-traffico)"
scp -q -o BatchMode=yes "$QUI/collector-traffico.tar" root@$VMIP:/root/ || exit 1
$VM "systemctl stop collector-traffico collector-ascolto pmacctd-collector 2>/dev/null; rm -rf /root/src/collector-traffico; mkdir -p /root/src
  tar -x -C /root/src -f /root/collector-traffico.tar && bash /root/src/collector-traffico/installa.sh --profilo avanzato ens19 collector-banco >/root/installa.out 2>&1
  echo installa=\$?; grep -E 'ATTENZIONE|profilo' /root/installa.out | tail -3; sleep 5
  for u in zeek-collector collector-traffico collector-ascolto pmacctd-collector zeek-freno.timer; do echo \"\$u \$(systemctl is-active \$u)\"; done
  grep ^PROFILO /etc/collector-traffico/collector.env" | tee "$ESITO/installa.txt"
grep -q "^zeek-collector active" "$ESITO/installa.txt" || { echo "ZEEK NON PARTE"; exit 1; }
$VM "/opt/zeek/bin/zeek -a /opt/collector-traffico/zeek/sonda.zeek >/root/a.out 2>&1; echo esito-a=\$?; tail -5 /root/a.out; ls /opt/zeek/share/zeek/policy/frameworks/conn 2>&1 | head -2" > "$ESITO/zeek.txt" 2>&1
grep -q "esito-a=0" "$ESITO/zeek.txt" || { echo "sonda.zeek NON SI CARICA:"; cat "$ESITO/zeek.txt"; exit 1; }
INIZIO=$(date -u +"%Y-%m-%d %H:%M:%S")
$VM "mkdir -p /root/zc; cd /root/zc; nohup tcpdump -i ens19 -s 0 -U -w cattura.pcap >/dev/null 2>&1 & sleep 2; echo cattura-avviata"

if [ "$SOLO_SSH" = 1 ]; then
  echo "== 40 accessi SSH falliti da banco-sim (103) verso banco-carico (110)"
  # SSH_ASKPASS e non sshpass: il 103 non risolve i nomi (apt non va) e un sshpass mancante faceva fallire in silenzio
  pct exec 103 -- sh -c 'printf "#!/bin/sh\necho Sbagliata-0000\n" > /tmp/pw.sh; chmod +x /tmp/pw.sh; n=0
    for i in $(seq 40); do SSH_ASKPASS=/tmp/pw.sh SSH_ASKPASS_REQUIRE=force DISPLAY=x setsid -w ssh -n -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -o ConnectTimeout=3 utente-ssh@192.168.99.88 true 2>/tmp/ssh.err
      grep -q "Permission denied" /tmp/ssh.err && n=$((n+1)); sleep 0.3; done
    echo "ssh-fatto: rifiutati $n su 40"; rm -f /tmp/pw.sh /tmp/ssh.err'
  echo "== attesa della rotazione e del giro del collector (6 minuti e mezzo)"
  sleep 390
  $VM "pkill -INT tcpdump; cd /var/lib/collector-traffico; python3 -c \"
import sqlite3; d = sqlite3.connect('collector.db')
print('fatti', d.execute(\\\"select tipo, client, server, porta, dettaglio from fatto where visto >= '$INIZIO' order by tipo\\\").fetchall())\"
    grep -h Password_Guessing zeek/notice*.log 2>/dev/null | wc -l; systemctl stop zeek-collector collector-traffico collector-ascolto" > "$ESITO/ssh.txt" 2>&1
  cat "$ESITO/ssh.txt"
  ripristina
  trap - EXIT
  exit 0
fi

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
  # 40 accessi SSH con password sbagliata (soglia di Zeek: 30). sshpass solo per la prova, tolto dopo.
  DEBIAN_FRONTEND=noninteractive apt-get -qq install -y sshpass >/dev/null 2>&1
  for i in $(seq 40); do sshpass -p Sbagliata-0000 ssh -n -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -o ConnectTimeout=3 utente-ssh@192.168.99.223 true >/dev/null 2>&1; sleep 0.3; done
  echo ssh-fatto; DEBIAN_FRONTEND=noninteractive apt-get -qq purge -y sshpass >/dev/null 2>&1
  for i in $(seq 60); do curl -s -m 2 -o /dev/null "http://192.168.99.222/?id=1%27%20OR%20%271%27=%271&n=$i"; done; echo sqli-fatto'
pct exec 103 -- sh -c 'pkill -f server-finti.py; pkill -f "s_server -accept 4443"; rm -f /tmp/server-finti.py /tmp/server-finti.log /tmp/zc-k.pem /tmp/zc-c.pem'
rm -f /tmp/zc-k.pem /tmp/zc-c.pem

echo "== attesa della rotazione e del giro del collector (6 minuti e mezzo)"
sleep 390
$VM "pkill -INT tcpdump; cd /var/lib/collector-traffico; ls zeek | head -30; ls zeek/scartati 2>/dev/null | wc -l
  python3 - <<'PY'
import sqlite3
d = sqlite3.connect('collector.db')
print('fatti', d.execute(\"select tipo, client, server, porta, dettaglio from fatto where visto >= '$INIZIO' order by tipo\").fetchall())
print('software', d.execute(\"select client, nome from nome where tipo = 'software' and visto >= datetime('$INIZIO', '-5 minutes')\").fetchall())
print('coppie', d.execute(\"select count(*), sum(byte_ritorno is not null) from coppia where inizio >= datetime('$INIZIO', '-5 minutes')\").fetchone())
print('stato', d.execute(\"select chiave, valore from stato where chiave in ('profilo','motore','versione_motore','freno','zeek_scartati','pacchetti_visti','pacchetti_persi')\").fetchall())
PY
  curl -sk -H @<(printf 'Authorization: Bearer %s' \"\$(cat /etc/collector-traffico/gettone)\") https://127.0.0.1:8477/v1/stato; echo
  journalctl -u zeek-collector -u collector-traffico --since '-10min' --no-pager | grep -iE 'error|fallit|traceback' | tail -5
  systemctl stop zeek-collector collector-traffico collector-ascolto" > "$ESITO/vivo.txt" 2>&1

echo "== le due letture della stessa copia"
$VM 'cd /root/zc; mkdir -p grezzi filtrati
  # grezzi: niente filtri nostri e anche quelli di Zeek spenti (password catturate), per dimostrare che la prova le troverebbe
  G="/opt/zeek/bin/zeek -C -r ../cattura.pcap local base/protocols/ldap base/protocols/modbus misc/stats LogAscii::use_json=T HTTP::default_capture_password=T FTP::default_capture_password=T"
  ( cd grezzi; $G LDAP::default_capture_password=T >zeek.out 2>&1 || { echo "senza LDAP::default_capture_password" >zeek.out; rm -f *.log; $G >>zeek.out 2>&1; } )
  ( cd filtrati; /opt/zeek/bin/zeek -C -r ../cattura.pcap /opt/collector-traffico/zeek/sonda.zeek Log::default_rotation_interval=0sec >zeek.out 2>&1 )
  for d in grezzi filtrati; do echo "-- $d"; wc -l $d/*.log | sort -n; tail -3 $d/zeek.out; done' >> "$ESITO/vivo.txt" 2>&1
scp -q -r -o BatchMode=yes root@$VMIP:/root/zc/grezzi root@$VMIP:/root/zc/filtrati "$ESITO/"
# la copia resta sul nodo (solo traffico del banco, valori inventati) per rileggerla con uno script cambiato; mai nel repo
scp -q -o BatchMode=yes root@$VMIP:/root/zc/cattura.pcap "$ESITO/"

ripristina
trap - EXIT
echo "== fatto: $ESITO"
