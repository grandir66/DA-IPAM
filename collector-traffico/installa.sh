#!/usr/bin/env bash
# Installa il collector di traffico su una Debian 12 pulita.
# Uso (da root):  bash /opt/collector-traffico/installa.sh <scheda in mirror> [nome]
# Rilanciarlo aggiorna codice e servizi; gettone, certificato e archivio restano.
set -euo pipefail

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

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q pmacct tcpdump python3 openssl
# Il pacchetto accende i suoi servizi generici: qui si usa solo il nostro.
systemctl disable --now pmacctd.service nfacctd.service sfacctd.service uacctd.service 2>/dev/null || true

id collector >/dev/null 2>&1 || useradd --system --home-dir "$DATI" --shell /usr/sbin/nologin collector
install -d -m 750 -o root -g collector "$CONF"
install -d -m 750 -o collector -g collector "$DATI" "$DATI/in"

if [ "$QUI" != "$APP" ]; then
  install -d "$APP"
  cp -R "$QUI/collector" "$APP/"
  cp "$QUI/pmacctd.conf" "$QUI"/*.service "$QUI/installa.sh" "$APP/"
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
# Flussi esportati da switch e firewall, oltre al mirror: no | netflow (UDP 2055) | sflow (UDP 6343)
FLUSSI=no
ENV
else
  sed -i "s/^MIRROR_IF=.*/MIRROR_IF=$SCHEDA/" "$CONF/collector.env"
fi
chmod 640 "$CONF/collector.env"; chgrp collector "$CONF/collector.env"

install -m 644 "$APP/collector-traffico.service" "$APP/pmacctd-collector.service" "$APP/collector-ascolto.service" \
  "$APP/nfacctd-collector.service" "$APP/sfacctd-collector.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q collector-traffico.service pmacctd-collector.service collector-ascolto.service
systemctl restart pmacctd-collector.service collector-traffico.service collector-ascolto.service

# NetFlow e sFlow: spenti di serie, si accende solo quello scritto in FLUSSI.
FLUSSI="$(sed -n 's/^FLUSSI=//p' "$CONF/collector.env" | tail -1)"
systemctl disable -q --now nfacctd-collector.service sfacctd-collector.service 2>/dev/null || true
case "$FLUSSI" in
  netflow) systemctl enable -q --now nfacctd-collector.service ;;
  sflow) systemctl enable -q --now sfacctd-collector.service ;;
esac

echo
echo "Collector installato. Nome: $NOME · scheda in mirror: $SCHEDA · porta: 8477"
echo "Impronta SHA-256 del certificato (da dare a IPAM):"
openssl x509 -in "$CONF/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2
echo "Il gettone sta in $CONF/gettone (non viene stampato)."
