#!/bin/bash
# Una giornata della sonda avanzata su un collector vero (piano 2026-11-23-sonda-avanzata-zeek, Task 5).
# Gira SULLA VM del collector, lanciato con:
#   systemd-run --unit giornata-zeek bash /root/src/collector-traffico/banco/giornata-zeek.sh
# Ogni 10 minuti scrive una riga in /root/giornata-zeek.log (CPU e RAM di Zeek, disco, scartati, freno, memoria);
# dopo 24 ore scrive il riepilogo e si ferma. Condizioni di ritorno del piano: disco oltre il 50%, un registro
# scartato, Zeek ucciso per memoria → rimette il profilo leggero (archivio intatto) e lo scrive. Il ritorno allo
# snapshot, se serve, si fa poi dal nodo: da qui non si può.
set -u
DATI=/var/lib/collector-traffico
LOG=/root/giornata-zeek.log
INSTALLA=/root/src/collector-traffico/installa.sh
OGNI=600
GIRI=144
HZ=$(getconf CLK_TCK)
INIZIO=$(date -u +"%Y-%m-%d %H:%M:%S")

tick() { local p; p=$(systemctl show -p MainPID --value zeek-collector); [ "$p" -gt 0 ] 2>/dev/null || { echo "0 0"; return; }
  set -- $(cut -d' ' -f14,15 /proc/$p/stat 2>/dev/null) ; echo "$(( ${1:-0} + ${2:-0} )) $(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null || echo 0)"; }
stato() { sqlite3 -readonly -cmd ".timeout 5000" "$DATI/collector.db" "select coalesce((select valore from stato where chiave='$1'),'0')" 2>/dev/null || echo "?"; }
ritorna() {
  echo "$(date -u +%H:%M) RITORNO AL LEGGERO: $1" >> "$LOG"
  bash "$INSTALLA" --profilo leggero ens19 "$(sed -n 's/^NOME=//p' /etc/collector-traffico/collector.env)" >> "$LOG" 2>&1
  echo "$(date -u +%H:%M) profilo leggero rimesso, giornata interrotta" >> "$LOG"
  exit 1
}

command -v sqlite3 >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q sqlite3 >/dev/null
OOM0=$(journalctl -k --no-pager 2>/dev/null | grep -c -i "out of memory")
RIAVVII0=$(systemctl show -p NRestarts --value zeek-collector)
echo "inizio $INIZIO UTC · ora cpu%(una vCPU) rss_MB disco% zeek_MB db_MB scartati freno mem_libera_MB copertura_visti/persi" > "$LOG"
read -r T0 _ <<< "$(tick)"
CPU_SOMMA=0; CPU_MAX=0; RSS_MAX=0; DISCO_MAX=0; N=0
for g in $(seq "$GIRI"); do
  sleep "$OGNI"
  read -r T RSS <<< "$(tick)"
  CPU=$(( (T - T0) * 100 / (HZ * OGNI) )); [ "$T" -lt "$T0" ] && CPU=0; T0=$T
  DISCO=$(df --output=pcent "$DATI" | tail -1 | tr -dc 0-9)
  ZMB=$(( $(du -sk "$DATI/zeek" | cut -f1) / 1024 )); DBMB=$(( $(du -sk "$DATI"/collector.db* | awk '{s+=$1} END{print s}') / 1024 ))
  SCART=$(stato zeek_scartati); FRENO=$(stato freno); MEM=$(( $(awk '/MemAvailable/{print $2}' /proc/meminfo) / 1024 ))
  echo "$(date -u +%H:%M) $CPU $(( RSS / 1024 )) $DISCO $ZMB $DBMB $SCART $FRENO $MEM $(stato pacchetti_visti)/$(stato pacchetti_persi)" >> "$LOG"
  N=$((N + 1)); CPU_SOMMA=$((CPU_SOMMA + CPU)); [ "$CPU" -gt "$CPU_MAX" ] && CPU_MAX=$CPU
  [ $((RSS / 1024)) -gt "$RSS_MAX" ] && RSS_MAX=$((RSS / 1024)); [ "$DISCO" -gt "$DISCO_MAX" ] && DISCO_MAX=$DISCO
  [ "$DISCO" -gt 50 ] && ritorna "disco al $DISCO%"
  # un archivio occupato dà «?»: non è un registro scartato, si riguarda al giro dopo
  [ "$SCART" -gt 0 ] 2>/dev/null && ritorna "registri scartati: $SCART"
  [ "$(journalctl -k --no-pager 2>/dev/null | grep -c -i "out of memory")" -gt "$OOM0" ] && ritorna "il kernel ha ucciso un processo per memoria"
  [ "$(systemctl show -p NRestarts --value zeek-collector)" -gt "$RIAVVII0" ] && echo "$(date -u +%H:%M) attenzione: Zeek riavviato da systemd" >> "$LOG"
done
{
  echo "FINE $(date -u +"%Y-%m-%d %H:%M:%S") UTC · giri $N · CPU di Zeek media $((CPU_SOMMA / (N > 0 ? N : 1)))% massimo $CPU_MAX% di una vCPU · RSS massimo $RSS_MAX MB · disco massimo $DISCO_MAX%"
  echo "righe dall'inizio della giornata (avanzato) e nelle 24 ore prima (leggero):"
  for t in "coppia inizio" "esterno inizio" "connessione inizio" "fatto visto" "nome visto"; do
    set -- $t
    echo "  $1: $(sqlite3 -readonly "$DATI/collector.db" "select count(*) from $1 where $2 >= '$INIZIO'") contro $(sqlite3 -readonly "$DATI/collector.db" "select count(*) from $1 where $2 >= datetime('$INIZIO','-1 day') and $2 < '$INIZIO'")"
  done
} >> "$LOG"
