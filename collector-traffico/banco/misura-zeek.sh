#!/bin/bash
# Misura di Zeek sul banco (PX-NAS). Gira sul nodo; la VM 109 e' 192.168.99.89, il carico parte dal CT 110.
VM="ssh -o BatchMode=yes root@192.168.99.89"
T=${1:-100}
$VM 'pkill -x zeek 2>/dev/null; rm -rf /var/lib/zeek-prova; mkdir -p /var/lib/zeek-prova; cd /var/lib/zeek-prova; nohup /opt/zeek/bin/zeek -C -i ens19 local misc/stats misc/capture-loss LogAscii::use_json=T Stats::report_interval=30sec CaptureLoss::watch_interval=30sec >zeek.out 2>&1 & sleep 8; pgrep -x zeek >/dev/null && echo "zeek avviato" || { echo "ZEEK NON PARTE"; tail -5 zeek.out; }'
$VM 'pgrep -x zeek >/dev/null' || exit 1
pgrep -x iperf3 >/dev/null || iperf3 -s -D
pct exec 110 -- ethtool -K eth0 tso off gso off 2>/dev/null
leggi() { $VM 'p=$(pgrep -x zeek); set -- $(cat /proc/$p/stat); echo "$((${14}+${15})) $(awk "/VmRSS/{print \$2}" /proc/$p/status) $(cat /sys/class/net/ens19/statistics/rx_packets) $(cat /sys/class/net/ens19/statistics/rx_dropped) $(cat /sys/class/net/ens19/statistics/rx_missed_errors) $(du -sk /var/lib/zeek-prova | cut -f1)"'; }
riga() { # nome, 6 numeri prima, 6 dopo, secondi
  local n="$1"; shift
  echo "$n | cpu $(( ($7-$1) / ${13} ))% di una vCPU | RSS $(( $8/1024 )) MB | pacchetti/s $(( ($9-$3)/${13} )) | scartati scheda $(( ${10}-$4 )) persi $(( ${11}-$5 )) | registri +$(( ${12}-$6 )) KB"
}
A=$(leggi); sleep 30; B=$(leggi); riga "fermo (30 s)" $A $B 30
for L in 50 100 200; do
  A=$(leggi); pct exec 110 -- iperf3 -c 192.168.99.1 -b ${L}M -t $T >/dev/null 2>&1; B=$(leggi)
  riga "${L} Mbit/s un flusso" $A $B $T
done
A=$(leggi)
N=$(pct exec 110 -- bash -c "for k in 1 2 3 4 5 6 7 8; do ( n=0; fine=\$((SECONDS+$T)); while [ \$SECONDS -lt \$fine ]; do curl -s -m 2 -o /dev/null http://192.168.99.222/ && n=\$((n+1)); dig +short +tries=1 +time=1 prova\$n.banco.test @192.168.99.254 >/dev/null 2>&1; done; echo \$n ) & done; wait" | paste -sd+ | bc)
B=$(leggi); riga "connessioni HTTP+DNS ($N in $T s)" $A $B $T
$VM 'cd /var/lib/zeek-prova; echo "-- registri"; wc -l *.log | sort -n | tail -20; echo "-- stats: ricevuti/scartati da zeek per intervallo"; grep -o "\"pkts_proc\":[0-9]*,\"bytes_recv\":[0-9]*,\"pkts_dropped\":[0-9]*,\"pkts_link\":[0-9]*" stats.log | tr "\n" " " | fold -w 200; echo; echo "-- capture_loss %"; grep -o "\"percent_lost\":[0-9.]*" capture_loss.log | cut -c16-22 | tr "\n" " "; echo; echo "-- weird"; grep -o "\"name\":\"[a-zA-Z_]*\"" weird.log | sort | uniq -c | sort -rn | head -6; ethtool -k ens19 2>/dev/null | grep -E "generic-receive|large-receive" ; echo "-- avvisi di zeek"; tail -3 zeek.out; wc -l reporter.log 2>/dev/null; free -m | sed -n 2p; du -sh /opt/zeek'
