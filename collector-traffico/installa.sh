#!/usr/bin/env bash
# Installa il collector di traffico su una Debian 12 pulita.
# Uso (da root):  bash /opt/collector-traffico/installa.sh [--profilo avanzato|leggero] <scheda in mirror> [nome]
# Rilanciarlo aggiorna codice e servizi; gettone, certificato e archivio restano. Rilanciarlo con un altro
# profilo cambia profilo senza toccare l'archivio (il cursore di IPAM non si rompe).
# Profilo di serie: avanzato (Zeek), se la VM ha almeno 2 vCPU e 1900 MB; altrimenti leggero (pmacctd), e lo dice.
set -euo pipefail

ZEEK_VERSIONE=9.0.1-0
ZEEK_REPO=https://download.opensuse.org/repositories/security:/zeek/Debian_12/
PROFILO=avanzato
CHIESTO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profilo) PROFILO="${2:-}"; CHIESTO=1; shift 2 ;;
    --profilo=*) PROFILO="${1#*=}"; CHIESTO=1; shift ;;
    *) break ;;
  esac
done
case "$PROFILO" in avanzato|leggero) ;; *) echo "Profilo sconosciuto: $PROFILO (avanzato o leggero)." >&2; exit 1 ;; esac

SCHEDA="${1:-}"
NOME="${2:-$(hostname)}"
QUI="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/collector-traffico
DATI=/var/lib/collector-traffico
APP=/opt/collector-traffico

[ "$(id -u)" = "0" ] || { echo "Va lanciato da root." >&2; exit 1; }
[ -n "$SCHEDA" ] || { echo "Uso: bash $0 <scheda in mirror> [nome]" >&2; exit 1; }
[ -d "/sys/class/net/$SCHEDA" ] || { echo "La scheda $SCHEDA non esiste (ip -br link)." >&2; exit 1; }
if ip -4 -o addr show dev "$SCHEDA" | grep -q inet; then
  echo "La scheda $SCHEDA ha un indirizzo: quella in mirror non deve averne." >&2; exit 1
fi

CPU=$(nproc)
RAM_MB=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024 ))
if [ "$PROFILO" = avanzato ] && { [ "$CPU" -lt 2 ] || [ "$RAM_MB" -lt 1900 ]; }; then
  echo "ATTENZIONE: $CPU vCPU e $RAM_MB MB, il profilo avanzato ne vuole 2 e 1900: installo il profilo leggero." >&2
  [ -n "$CHIESTO" ] && echo "(il profilo avanzato era stato chiesto: portare la VM a 2 vCPU e 2 GB e rilanciare)" >&2
  PROFILO=leggero
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q pmacct tcpdump python3 openssl curl
if [ "$PROFILO" = avanzato ]; then
  # Repository del progetto Zeek. La chiave in .asc: apt la legge senza gpg (che una Debian minima non ha).
  echo "deb $ZEEK_REPO /" > /etc/apt/sources.list.d/zeek.list
  curl -fsSL "${ZEEK_REPO}Release.key" -o /etc/apt/trusted.gpg.d/zeek.asc
  apt-get update -q
  apt-get install -y -q "zeek-lts-core=$ZEEK_VERSIONE"
  apt-mark hold zeek-lts-core >/dev/null
fi
# Il pacchetto accende i suoi servizi generici: qui si usa solo il nostro.
systemctl disable --now pmacctd.service nfacctd.service sfacctd.service uacctd.service 2>/dev/null || true

id collector >/dev/null 2>&1 || useradd --system --home-dir "$DATI" --shell /usr/sbin/nologin collector
install -d -m 750 -o root -g collector "$CONF"
install -d -m 750 -o collector -g collector "$DATI" "$DATI/in" "$DATI/zeek"

if [ "$QUI" != "$APP" ]; then
  install -d "$APP"
  cp -R "$QUI/collector" "$QUI/zeek" "$APP/"
  cp "$QUI"/*.conf "$QUI"/*.service "$QUI"/*.timer "$QUI/installa.sh" "$APP/"
fi
find "$APP" -name __pycache__ -type d -prune -exec rm -rf {} +
install -m 644 "$APP/pmacctd.conf" "$APP/nfacctd.conf" "$APP/sfacctd.conf" "$CONF/"

if [ ! -s "$CONF/gettone" ]; then
  (umask 077; python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$CONF/gettone")
fi
chown collector:collector "$CONF/gettone"; chmod 600 "$CONF/gettone"

if [ ! -s "$CONF/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$NOME" \
    -keyout "$CONF/chiave.pem" -out "$CONF/cert.pem" 2>/dev/null
fi
chown collector:collector "$CONF/chiave.pem" "$CONF/cert.pem"; chmod 600 "$CONF/chiave.pem"; chmod 644 "$CONF/cert.pem"

if [ ! -f "$CONF/collector.env" ]; then
  cat > "$CONF/collector.env" <<ENV
MIRROR_IF=$SCHEDA
NOME=$NOME
# Reti interne in più oltre a quelle private, separate da virgola (es. 100.64.0.0/10)
RETI_INTERNE=
# 1 se lo switch copia entrata e uscita e ogni pacchetto arriva due volte
MIRROR_DOPPIO=0
# Macchine che scandiscono la rete per mestiere (IPAM, Zabbix), separate da virgola: il loro traffico non si conta
SONDE_NOTE=
# Flussi esportati da switch e firewall, oltre al mirror: no | netflow (UDP 2055) | sflow (UDP 6343)
FLUSSI=no
# avanzato = Zeek; leggero = pmacctd. Si cambia rilanciando installa.sh --profilo
PROFILO=$PROFILO
# ZONA ROSSA: 1 = legge i nomi utente degli accessi (Kerberos, SMB, LDAP). Spento di serie: lo accende Riccardo a mano
ACCESSI=0
ENV
else
  sed -i "s/^MIRROR_IF=.*/MIRROR_IF=$SCHEDA/" "$CONF/collector.env"
  if grep -q '^PROFILO=' "$CONF/collector.env"; then
    sed -i "s/^PROFILO=.*/PROFILO=$PROFILO/" "$CONF/collector.env"
  else
    printf '# avanzato = Zeek; leggero = pmacctd. Si cambia rilanciando installa.sh --profilo\nPROFILO=%s\n' "$PROFILO" >> "$CONF/collector.env"
  fi
  grep -q '^SONDE_NOTE=' "$CONF/collector.env" || printf '# Macchine che scandiscono la rete per mestiere (IPAM, Zabbix), separate da virgola\nSONDE_NOTE=\n' >> "$CONF/collector.env"
  # un archivio di prima della tappa 7: la riga si aggiunge spenta; un valore già scritto non si tocca mai
  grep -q '^ACCESSI=' "$CONF/collector.env" || printf '# ZONA ROSSA: 1 = legge i nomi utente degli accessi. Spento di serie\nACCESSI=0\n' >> "$CONF/collector.env"
fi
chmod 640 "$CONF/collector.env"; chgrp collector "$CONF/collector.env"

install -m 644 "$APP/collector-traffico.service" "$APP/pmacctd-collector.service" "$APP/collector-ascolto.service" \
  "$APP/nfacctd-collector.service" "$APP/sfacctd-collector.service" "$APP/zeek-collector.service" \
  "$APP/zeek-freno.service" "$APP/zeek-freno.timer" /etc/systemd/system/
systemctl daemon-reload
if [ "$PROFILO" = avanzato ]; then
  systemctl disable -q --now pmacctd-collector.service 2>/dev/null || true
  systemctl enable -q collector-traffico.service zeek-collector.service collector-ascolto.service zeek-freno.timer
  systemctl restart zeek-collector.service collector-traffico.service collector-ascolto.service zeek-freno.timer
else
  systemctl disable -q --now zeek-collector.service zeek-freno.timer 2>/dev/null || true
  rm -f "$DATI/zeek-freno"
  systemctl enable -q collector-traffico.service pmacctd-collector.service collector-ascolto.service
  systemctl restart pmacctd-collector.service collector-traffico.service collector-ascolto.service
fi

# NetFlow e sFlow: spenti di serie, si accende solo quello scritto in FLUSSI.
FLUSSI="$(sed -n 's/^FLUSSI=//p' "$CONF/collector.env" | tail -1)"
systemctl disable -q --now nfacctd-collector.service sfacctd-collector.service 2>/dev/null || true
case "$FLUSSI" in
  netflow) systemctl enable -q --now nfacctd-collector.service ;;
  sflow) systemctl enable -q --now sfacctd-collector.service ;;
esac

echo
echo "Collector installato. Nome: $NOME · scheda in mirror: $SCHEDA · porta: 8477 · profilo: $PROFILO"
echo "Impronta SHA-256 del certificato (da dare a IPAM):"
openssl x509 -in "$CONF/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2
echo "Il gettone sta in $CONF/gettone (non viene stampato)."
