#!/bin/bash
# Prova vera del firewall wt0 (tappa C1), su Linux, come root, in spazi di rete usa e
# getta: niente cambia sulla rete della macchina, e gli spazi si cancellano alla fine.
#
# Uso: sudo bash scripts/dalink/prova-firewall-netns.sh [cartella-uscita]
#
# Due spazi collegati da una coppia veth: lato istanza l'interfaccia si chiama `wt0`
# (100.100.0.1), lato «fuori» due indirizzi NetBird, uno ammesso (100.100.0.2) e uno
# no (100.100.0.3). Sull'istanza ascoltano 443 e 1514 (Wazuh). Si prova:
#   - dalla sorgente ammessa la 443 passa;
#   - da un altro indirizzo NetBird la 443 non passa;
#   - la 1514 non passa mai; la 6443 non passa senza edge;
#   - la 22 passa il firewall (risposta «rifiutata» del kernel: nessuno ascolta);
#   - senza sorgenti dichiarate, la 443 passa da tutti e due e la 1514 da nessuno.
# Se si indica una cartella, ci si salva l'uscita vera di `nft -j list table inet dalink`
# per le prove di DA-IPAM (con e senza sorgenti).
set -euo pipefail

QUI="$(cd "$(dirname "$0")" && pwd)"
USCITA="${1:-}"
[ "$(id -u)" -eq 0 ] || { echo "serve root" >&2; exit 2; }
for c in ip nft python3; do command -v "$c" >/dev/null || { echo "manca $c" >&2; exit 2; }; done

IST="dalink-prova-ist-$$"
FUORI="dalink-prova-fuori-$$"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dalink-prova.XXXXXX")"
pulisci() {
  ip netns pids "$IST" 2>/dev/null | xargs -r kill 2>/dev/null || true
  ip netns del "$IST" 2>/dev/null || true
  ip netns del "$FUORI" 2>/dev/null || true
  rm -rf "$TMP"
}
trap pulisci EXIT

ip netns add "$IST"
ip netns add "$FUORI"
# Nomi temporanei e poi rinomina: la macchina può avere già un wt0 suo (NetBird vero).
ip link add "dlka$$" type veth peer name "dlkb$$"
ip link set "dlka$$" netns "$IST"
ip link set "dlkb$$" netns "$FUORI"
ip -n "$IST" link set "dlka$$" name wt0
ip -n "$FUORI" link set "dlkb$$" name fuori
ip -n "$IST" addr add 100.100.0.1/16 dev wt0
ip -n "$FUORI" addr add 100.100.0.2/16 dev fuori
ip -n "$FUORI" addr add 100.100.0.3/16 dev fuori
for ns in "$IST" "$FUORI"; do ip -n "$ns" link set lo up; done
ip -n "$IST" link set wt0 up
ip -n "$FUORI" link set fuori up

ip netns exec "$IST" python3 - <<'EOF' &
import socket, threading
def ascolta(porta):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", porta)); s.listen(8)
    while True:
        c, _ = s.accept(); c.close()
for p in (443, 1514, 6443):
    threading.Thread(target=ascolta, args=(p,), daemon=True).start()
threading.Event().wait()
EOF
sleep 1

# Esito di una connessione da `sorgente` alla porta: aperta | rifiutata | scartata
prova() {
  ip netns exec "$FUORI" python3 - "$1" "$2" <<'EOF'
import socket, sys
s = socket.socket(); s.settimeout(2); s.bind((sys.argv[1], 0))
try:
    s.connect(("100.100.0.1", int(sys.argv[2]))); print("aperta")
except ConnectionRefusedError:
    print("rifiutata")
except (socket.timeout, TimeoutError):
    print("scartata")
EOF
}

FALLITE=0
atteso() {
  local esito
  esito="$(prova "$1" "$2")"
  if [ "$esito" = "$3" ]; then
    echo "ok    da $1 alla $2: $esito"
  else
    echo "FALLITA da $1 alla $2: $esito (atteso $3)"
    FALLITE=$((FALLITE + 1))
  fi
}

carica() {
  printf '%s' "$1" > "$TMP/fw.env"
  DALINK_FW_CONF="$TMP/fw.env" bash "$QUI/firewall-wt0.sh" --stampa > "$TMP/r.nft"
  ip netns exec "$IST" nft -f "$TMP/r.nft"
}

echo "== con sorgente dichiarata (100.100.0.2), senza edge"
carica $'DALINK_FW_EDGE=no\nDALINK_FW_SORGENTI=100.100.0.2\n'
[ -n "$USCITA" ] && ip netns exec "$IST" nft -j list table inet dalink > "$USCITA/nft-dalink-sorgenti.json"
atteso 100.100.0.2 443 aperta
atteso 100.100.0.3 443 scartata
atteso 100.100.0.2 1514 scartata
atteso 100.100.0.2 6443 scartata
atteso 100.100.0.2 22 rifiutata

echo "== senza sorgenti, con edge (anche ricaricando sopra la tabella di prima)"
carica $'DALINK_FW_EDGE=si\n'
[ -n "$USCITA" ] && ip netns exec "$IST" nft -j list table inet dalink > "$USCITA/nft-dalink-edge.json"
atteso 100.100.0.2 443 aperta
atteso 100.100.0.3 443 aperta
atteso 100.100.0.3 6443 aperta
atteso 100.100.0.3 1514 scartata

echo "== prove fallite: $FALLITE"
[ "$FALLITE" -eq 0 ]
