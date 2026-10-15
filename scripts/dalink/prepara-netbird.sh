#!/bin/bash
# DA-IPAM — prepara l'istanza a entrare in NetBird (tappa C1 NetBird/DA-Link).
#
# Uso: prepara-netbird.sh [--applica] --edge si|no [--sorgenti "IP_O_RETE …"] [--chiave-da-stdin]
#
#   (senza --applica)   prova a vuoto: dice cosa farebbe, non tocca niente
#   --applica           esegue (root)
#   --edge si|no        obbligatoria: l'istanza contiene lo Scanner-Edge? (porta 6443 su wt0)
#   --sorgenti "…"      facoltativa: indirizzi o reti NetBird (100.64.0.0/10) da cui accettare
#   --chiave-da-stdin   legge la chiave d'ingresso NetBird (monouso) da UNA riga di stdin
#                       e fa entrare l'istanza. Mai come argomento: `ps` la leggerebbe.
#
# Il modo normale di entrare è il comando che DA-Link mostra una volta (scrive
# /etc/dalink/oggetto.env e fa `netbird up` da sé). Questo script lo PREPARA e lo
# VERIFICA; --chiave-da-stdin serve a chi installa senza incollare quel comando
# (Deploy-Appliance, tappa G1), e vuole oggetto.env già scritto.
#
# Passi (spec NetBird §5.1, §12 «DA-IPAM», rischio 1):
#   1. client NetBird dal repository firmato pkgs.netbird.io, se manca; nftables se manca;
#   2. Tailscale presente → `tailscale set --netfilter-mode=off` (senza, le sue regole
#      scartano il traffico NetBird appena tailscaled si riavvia: misurato il 14/10);
#   3. /etc/dalink/firewall.env (600, copia di riserva se c'era) e servizio
#      dalink-firewall (abilitato, avviato: carica la tabella prima di NetBird);
#   4. con --chiave-da-stdin: chiave in un file 600, `netbird up --setup-key-file`,
#      file distrutto con shred in ogni caso;
#   5. verifica: tabella caricata, oggetto.env con permessi 600, interfaccia wt0.
set -u
set -f

QUI="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${DALINK_APP_DIR:-$(cd "$QUI/../.." && pwd)}"
DALINK_DIR="${DALINK_DIR:-/etc/dalink}"
SYSTEMD_DIR="${DALINK_SYSTEMD_DIR:-/etc/systemd/system}"
MANAGEMENT_URL="https://netbird.domarc.it"

errore() {
  echo "prepara-netbird: $*" >&2
  exit 1
}
passo() { echo ">>> $*"; }

APPLICA=0
EDGE=""
SORGENTI=""
CHIAVE_STDIN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --applica) APPLICA=1 ;;
    --edge) [ $# -ge 2 ] || errore "--edge vuole si o no"; EDGE="$2"; shift ;;
    --sorgenti) [ $# -ge 2 ] || errore "--sorgenti vuole un elenco"; SORGENTI="$2"; shift ;;
    --chiave-da-stdin) CHIAVE_STDIN=1 ;;
    *) errore "opzione sconosciuta: $1" ;;
  esac
  shift
done
case "$EDGE" in
  si | no) ;;
  *) errore "--edge si|no è obbligatoria: l'istanza contiene lo Scanner-Edge?" ;;
esac

# La chiave si legge per prima, da stdin, e non si stampa mai.
CHIAVE=""
if [ "$CHIAVE_STDIN" -eq 1 ]; then
  IFS= read -r CHIAVE || true
  CHIAVE="${CHIAVE%$'\r'}"
  case "$CHIAVE" in
    "" | *[!A-Za-z0-9_-]*) errore "chiave d'ingresso assente o con caratteri non ammessi (nessun comando eseguito)" ;;
  esac
  [ "${#CHIAVE}" -ge 10 ] && [ "${#CHIAVE}" -le 200 ] || errore "chiave d'ingresso di lunghezza non plausibile (nessun comando eseguito)"
fi

# Il nome del nodo viene da oggetto.env (scritto da DA-Link): letto, mai eseguito.
NODO=""
if [ -f "$DALINK_DIR/oggetto.env" ]; then
  NODO="$(sed -n 's/^[[:space:]]*DALINK_NODO=[[:space:]]*\([0-9]\{3,8\}-ipam\)[[:space:]]*$/\1/p' "$DALINK_DIR/oggetto.env" | tail -1)"
fi
if [ "$CHIAVE_STDIN" -eq 1 ] && [ -z "$NODO" ]; then
  errore "manca $DALINK_DIR/oggetto.env con DALINK_NODO=<codice>-ipam: prima va scritto (DA-Link), poi la chiave"
fi

# Configurazione del firewall: si genera e si valida con lo script vero, a vuoto.
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/dalink-prepara.XXXXXX")" || errore "mktemp fallito"
CHIAVE_FILE=""
pulisci() {
  if [ -n "$CHIAVE_FILE" ] && [ -f "$CHIAVE_FILE" ]; then shred -u "$CHIAVE_FILE" 2>/dev/null || rm -f "$CHIAVE_FILE"; fi
  rm -rf "$TMPD"
}
trap pulisci EXIT
{
  echo "# Scritto da DA-IPAM scripts/dalink/prepara-netbird.sh — firewall di wt0"
  echo "DALINK_FW_EDGE=$EDGE"
  [ -n "$SORGENTI" ] && echo "DALINK_FW_SORGENTI=$SORGENTI"
} > "$TMPD/firewall.env"
DALINK_FW_CONF="$TMPD/firewall.env" bash "$QUI/firewall-wt0.sh" --stampa > "$TMPD/ruleset.nft" ||
  errore "configurazione del firewall non valida: niente è cambiato"

if [ "$APPLICA" -eq 0 ]; then
  echo "=== Prova a vuoto (niente cambia; per eseguire: --applica) ==="
  command -v netbird >/dev/null 2>&1 && echo "- client NetBird già presente" || echo "- installerei il client NetBird da pkgs.netbird.io (repository firmato)"
  command -v nft >/dev/null 2>&1 || echo "- installerei nftables"
  command -v tailscale >/dev/null 2>&1 && echo "- metterei Tailscale con --netfilter-mode=off"
  echo "- scriverei $DALINK_DIR/firewall.env (edge: $EDGE${SORGENTI:+, sorgenti: $SORGENTI})"
  echo "- installerei e avvierei dalink-firewall.service; il ruleset sarebbe:"
  sed 's/^/    /' "$TMPD/ruleset.nft"
  if [ "$CHIAVE_STDIN" -eq 1 ]; then
    echo "- farei entrare $NODO in NetBird con la chiave letta da stdin (${#CHIAVE} caratteri, non mostrata)"
  else
    echo "- poi si incolla il comando emesso da DA-Link (chiave monouso e token)"
  fi
  exit 0
fi

[ "$(id -u)" -eq 0 ] || errore "--applica vuole root"

if ! command -v netbird >/dev/null 2>&1; then
  passo "Client NetBird dal repository firmato pkgs.netbird.io"
  apt-get install -y ca-certificates curl gnupg || errore "apt-get non ha installato i prerequisiti"
  curl -fsSL https://pkgs.netbird.io/debian/public.key | gpg --dearmor --yes -o /usr/share/keyrings/netbird-archive-keyring.gpg ||
    errore "chiave del repository NetBird non scaricata"
  echo "deb [signed-by=/usr/share/keyrings/netbird-archive-keyring.gpg] https://pkgs.netbird.io/debian stable main" \
    > /etc/apt/sources.list.d/netbird.list
  apt-get update || errore "apt-get update fallito"
  apt-get install -y netbird || errore "client NetBird non installato"
fi
if ! command -v nft >/dev/null 2>&1; then
  passo "nftables"
  apt-get install -y nftables || errore "nftables non installato"
fi

if command -v tailscale >/dev/null 2>&1; then
  passo "Tailscale: --netfilter-mode=off (convivenza con NetBird, rischio 1)"
  tailscale set --netfilter-mode=off || errore "tailscale set --netfilter-mode=off fallito: NetBird verrebbe scartato"
fi

passo "Firewall di wt0"
install -d -m 700 "$DALINK_DIR" || errore "cartella $DALINK_DIR non creata"
if [ -f "$DALINK_DIR/firewall.env" ]; then
  cp -p "$DALINK_DIR/firewall.env" "$DALINK_DIR/firewall.env.bak-$(date +%Y%m%d-%H%M%S)" || errore "copia di riserva di firewall.env non fatta"
fi
install -m 600 "$TMPD/firewall.env" "$DALINK_DIR/firewall.env" || errore "firewall.env non scritto"
sed "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/deploy/dalink-firewall.service" > "$TMPD/dalink-firewall.service" ||
  errore "unità dalink-firewall non preparata"
install -m 644 "$TMPD/dalink-firewall.service" "$SYSTEMD_DIR/dalink-firewall.service" || errore "unità dalink-firewall non installata"
systemctl daemon-reload || errore "systemctl daemon-reload fallito"
systemctl enable dalink-firewall.service || errore "dalink-firewall non abilitato"
systemctl restart dalink-firewall.service || errore "dalink-firewall non avviato: vedi journalctl -u dalink-firewall"

if [ "$CHIAVE_STDIN" -eq 1 ]; then
  passo "Ingresso in NetBird come $NODO"
  CHIAVE_FILE="$DALINK_DIR/netbird.key"
  (umask 077 && printf '%s\n' "$CHIAVE" > "$CHIAVE_FILE") || errore "file della chiave non scritto"
  CHIAVE=""
  netbird up --management-url "$MANAGEMENT_URL" --setup-key-file "$CHIAVE_FILE" --hostname "$NODO"
  ESITO=$?
  shred -u "$CHIAVE_FILE" 2>/dev/null || rm -f "$CHIAVE_FILE"
  CHIAVE_FILE=""
  [ "$ESITO" -eq 0 ] || errore "netbird up non riuscito (chiave scaduta o già usata? se ne emette un'altra in DA-Link)"
  systemctl enable netbird || errore "servizio netbird non abilitato all'avvio"
fi

passo "Verifica"
PROBLEMI=0
if nft list table inet dalink >/dev/null 2>&1; then echo "ok   tabella inet dalink caricata"; else echo "MALE tabella inet dalink assente"; PROBLEMI=1; fi
if [ -f "$DALINK_DIR/oggetto.env" ]; then
  if [ -n "$(find "$DALINK_DIR/oggetto.env" -perm 0600 2>/dev/null)" ]; then echo "ok   oggetto.env con permessi 600"
  else echo "MALE oggetto.env con permessi diversi da 600: DA-IPAM non lo userà"; PROBLEMI=1; fi
else
  echo "--   oggetto.env non c'è ancora: si incolla il comando emesso da DA-Link"
fi
if ip link show wt0 >/dev/null 2>&1; then echo "ok   interfaccia wt0 presente"; else echo "--   interfaccia wt0 non ancora presente"; fi
exit "$PROBLEMI"
