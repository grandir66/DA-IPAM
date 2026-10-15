#!/bin/bash
# DA-IPAM — firewall dell'interfaccia NetBird (wt0). Tappa C1 NetBird/DA-Link.
#
# Uso: firewall-wt0.sh [--stampa | --applica | --togli]
#   --stampa   (predefinito, prova a vuoto) scrive il ruleset nftables, non tocca niente
#   --applica  lo carica in modo atomico con `nft -f` e rilegge la tabella (root)
#   --togli    toglie la tabella `inet dalink` (root)
#
# Configurazione: /etc/dalink/firewall.env (altro percorso con DALINK_FW_CONF), letta
# riga per riga, MAI eseguita:
#   DALINK_FW_EDGE=si|no        obbligatoria: l'istanza contiene lo Scanner-Edge?
#   DALINK_FW_SORGENTI=…        facoltativa: indirizzi o reti dentro 100.64.0.0/10
#                               (centrali e admins) da cui accettare; separati da
#                               spazi o virgole. Senza, la barriera è la policy NetBird.
#
# Cosa fa (spec NetBird §12 «DA-IPAM», §4.3 R5, rischio 10, decisione 22):
# - una tabella propria `inet dalink`, catena sull'input: lascia passare tutto ciò che
#   non arriva da wt0; su wt0 accetta le connessioni già aperte e le porte 22 e 443,
#   più 6443 con l'edge; poi scarta.
# - Restringe soltanto: in nftables l'accept di una catena non scavalca le altre, quindi
#   questa tabella non apre niente che UFW o NetBird chiudono, e sopravvive a
#   `ufw --force reset`.
# - Le porte stanno qui nel codice, non in configurazione: una porta Wazuh (1514, 1515,
#   55000, 9200, dashboard) non si può aggiungere da un file.
set -u
set -f  # niente espansione dei nomi di file: i valori del file non diventano percorsi

CONF="${DALINK_FW_CONF:-/etc/dalink/firewall.env}"
IFACE="wt0"
TABELLA="inet dalink"
WAZUH_VIETATE="1514 1515 55000 9200 5601"

errore() {
  echo "firewall-wt0: $*" >&2
  exit 1
}

MODO="stampa"
if [ $# -gt 1 ]; then
  errore "una sola opzione: --stampa, --applica o --togli"
fi
case "${1:-}" in
  "" | --stampa) MODO="stampa" ;;
  --applica) MODO="applica" ;;
  --togli) MODO="togli" ;;
  *) errore "opzione sconosciuta: $1 (ammesse: --stampa, --applica, --togli)" ;;
esac

# Valore di una chiave del file di configurazione: ultima riga che la definisce,
# virgolette esterne tolte. Il file non si esegue mai.
valore_conf() {
  local chiave="$1" riga val=""
  while IFS= read -r riga || [ -n "$riga" ]; do
    riga="${riga#"${riga%%[![:space:]]*}"}"
    case "$riga" in
      "#"* | "") continue ;;
      "$chiave="*) val="${riga#*=}" ;;
    esac
  done < "$CONF"
  val="${val%"${val##*[![:space:]]}"}"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  printf '%s' "$val"
}

# Un indirizzo o una rete IPv4 dentro 100.64.0.0/10 (la rete NetBird).
sorgente_valida() {
  local s="$1" ip pref="" o1 o2 o3 o4 resto
  case "$s" in
    */*) ip="${s%/*}"; pref="${s#*/}" ;;
    *) ip="$s" ;;
  esac
  case "$ip" in
    *[!0-9.]* | "") return 1 ;;
  esac
  o1="${ip%%.*}"; resto="${ip#*.}"
  o2="${resto%%.*}"; resto="${resto#*.}"
  o3="${resto%%.*}"; o4="${resto#*.}"
  [ "$o1.$o2.$o3.$o4" = "$ip" ] || return 1
  for o in "$o1" "$o2" "$o3" "$o4"; do
    case "$o" in "" | *[!0-9]*) return 1 ;; esac
    [ "${#o}" -le 3 ] || return 1
    [ "$o" -le 255 ] || return 1
  done
  [ "$o1" -eq 100 ] || return 1
  [ "$o2" -ge 64 ] && [ "$o2" -le 127 ] || return 1
  if [ -n "$pref" ]; then
    case "$pref" in "" | *[!0-9]*) return 1 ;; esac
    [ "${#pref}" -le 2 ] || return 1
    [ "$pref" -ge 10 ] && [ "$pref" -le 32 ] || return 1
  fi
  return 0
}

genera_ruleset() {
  [ -f "$CONF" ] || errore "manca la configurazione $CONF (DALINK_FW_EDGE=si|no)"
  [ -r "$CONF" ] || errore "configurazione $CONF non leggibile"

  local edge sorgenti_grezze porte s elenco="" filtro=""
  edge="$(valore_conf DALINK_FW_EDGE)"
  case "$edge" in
    si) porte="22, 443, 6443" ;;
    no) porte="22, 443" ;;
    *) errore "DALINK_FW_EDGE deve valere si o no (l'istanza contiene lo Scanner-Edge?)" ;;
  esac

  sorgenti_grezze="$(valore_conf DALINK_FW_SORGENTI | tr ',' ' ')"
  for s in $sorgenti_grezze; do
    sorgente_valida "$s" || errore "sorgente non ammessa: «$s» (solo indirizzi o reti dentro 100.64.0.0/10)"
    if [ -n "$elenco" ]; then elenco="$elenco, $s"; else elenco="$s"; fi
  done
  if [ -n "$elenco" ]; then filtro="ip saddr { $elenco } "; fi

  # Difesa in più: le porte sono fisse, ma se un giorno qualcuno le cambia qui
  # una porta Wazuh deve fermare tutto.
  for w in $WAZUH_VIETATE; do
    case ", $porte," in *", $w,"*) errore "porta Wazuh $w fra quelle aperte: vietato (spec R5)" ;; esac
  done

  cat <<EOF
table $TABELLA
delete table $TABELLA
table $TABELLA {
	chain ingresso_wt0 {
		type filter hook input priority filter - 10; policy accept;
		iifname != "$IFACE" accept
		ct state established,related accept
		ct state invalid drop
		${filtro}tcp dport { $porte } accept
		counter drop
	}
}
EOF
}

case "$MODO" in
  stampa)
    RULESET="$(genera_ruleset)" || exit 1
    printf '%s\n' "$RULESET"
    ;;
  applica)
    [ "$(id -u)" -eq 0 ] || errore "--applica vuole root"
    command -v nft >/dev/null 2>&1 || errore "nft non installato (apt-get install nftables)"
    RULESET="$(genera_ruleset)" || exit 1
    TMP="$(mktemp "${TMPDIR:-/tmp}/dalink-fw.XXXXXX")" || errore "mktemp fallito"
    trap 'rm -f "$TMP"' EXIT
    printf '%s\n' "$RULESET" > "$TMP"
    nft -f "$TMP" || errore "nft ha rifiutato il ruleset: niente è cambiato"
    nft list table $TABELLA >/dev/null 2>&1 || errore "tabella $TABELLA assente dopo il caricamento"
    echo "firewall-wt0: tabella $TABELLA caricata (porte su $IFACE: $(printf '%s' "$RULESET" | sed -n 's/.*tcp dport { \(.*\) } accept.*/\1/p'))"
    ;;
  togli)
    [ "$(id -u)" -eq 0 ] || errore "--togli vuole root"
    command -v nft >/dev/null 2>&1 || errore "nft non installato"
    if nft list table $TABELLA >/dev/null 2>&1; then
      nft delete table $TABELLA || errore "nft non ha tolto la tabella $TABELLA"
      echo "firewall-wt0: tabella $TABELLA tolta"
    else
      echo "firewall-wt0: tabella $TABELLA già assente"
    fi
    ;;
esac
