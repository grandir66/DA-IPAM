#!/bin/bash
# DA-IPAM — filtro degli accessi all'installazione (Protezione, tappa 2; ADR 0041).
#
# Uso: da-ipam-accessi.sh <comando>
#   anteprima        (predefinito, prova a vuoto) scrive il ruleset nftables, non tocca niente
#   minima           scrive il ruleset della politica minima (solo NetBird e «sempre ammessi»)
#   stato            dice se la tabella è caricata, in che modo, e se c'è una prova in corso
#   osserva          carica le regole che CONTANO e basta: non scarta mai niente (root)
#   prova <secondi>  carica le regole che chiudono e arma il ritorno automatico (30-600 s) (root)
#   conferma         disarma il ritorno e tiene le regole caricate come «ultime buone» (root)
#   annulla          rimette subito le regole di prima della prova (root)
#   spegni           toglie la tabella e l'ultima buona: sblocco dalla console (root)
#   avvio            all'accensione: ricarica le ultime buone; se nft le rifiuta, la minima (root)
#   esche-anteprima  scrive la tabella delle esche, non tocca niente
#   esche            applica /etc/da-ipam/esche.conf: tabella `inet daipam_esche` e servizio; senza esche li toglie (root)
#   blocca <ip> <s>  scarta tutto ciò che arriva da un indirizzo per <s> secondi (60-604800) (root)
#   sblocca <ip>     toglie il blocco (root)
#   bloccati         elenca gli indirizzi bloccati con il tempo che resta
#
# Configurazione: /etc/da-ipam/accessi.conf (altro percorso con DAIPAM_ACCESSI_CONF), scritta da
# DA-IPAM, letta riga per riga e MAI eseguita. Ogni valore si rivalida qui da capo:
#   ACCESSI_SEMPRE=…    indirizzi o reti sempre ammessi a tutto (oltre a NetBird, che è nel codice)
#   ACCESSI_WEB=…       chi apre la pagina web (80, 443)
#   ACCESSI_SSH=…       chi arriva a SSH (22)
#   ACCESSI_CONSOLE=…   chi apre le console dei moduli (6443, 7443, 8443, 9443)
#   ACCESSI_DATI=…      chi consegna dati ai moduli (syslog, trap, NetFlow, agenti, proxy Zabbix 10051)
# Un gruppo vale: un elenco di indirizzi IPv4/IPv6 separati da virgole o spazi; vuoto = nessuno
# (restano i «sempre ammessi»); la parola `tutti` = aperto a chiunque, scritto apposta.
#
# Cosa fa:
# - una tabella propria `inet daipam_accessi`, catena sul PREROUTING a priorità mangle + 5: prima del
#   DNAT di Docker (dstnat, -100), dove il pacchetto ha ancora la porta vera, e prima di `inet dalink`
#   (mangle + 10). Le porte pubblicate dai container NON passano dalla catena INPUT: per questo qui.
# - Restringe soltanto: un accept di questa catena non scavalca le altre tabelle. NetBird (`wt0`)
#   passa e lo governa `inet dalink`; Docker, `lo`, le connessioni già aperte, ICMP e DHCP passano;
#   si tocca solo ciò che è diretto a questa macchina (`fib daddr type local`). Le uscite non si filtrano.
# - Si guardano solo i TENTATIVI DI APRIRE una connessione: un pacchetto TCP che non è un SYN, o un UDP verso una
#   porta alta, passa. Sono le risposte alle scansioni a pacchetti grezzi che partono da questa macchina (nmap -sS,
#   naabu): il conntrack non le conosce, e il 26/11 sull'hub sono finite a migliaia fra chi «resterebbe fuori»
#   (256 indirizzi su ognuna di quattro porte alte). Lo scanner le legge comunque prima del filtro: non erano un
#   danno per la scansione, erano rumore nell'elenco e nei contatori.
# - Le porte dei gruppi stanno qui nel codice, non in configurazione. Una porta diretta alla macchina
#   che non è in nessun gruppo, a filtro chiuso, non risponde (chiuso di serie).
# - Chi resta fuori finisce nei set `fuori4`/`fuori6` (indirizzo e porta, 7 giorni): in «osserva»
#   dicono chi resterebbe fuori, a filtro chiuso chi ci ha provato.
set -u
set -f  # niente espansione dei nomi di file: i valori del file non diventano percorsi

CONF="${DAIPAM_ACCESSI_CONF:-/etc/da-ipam/accessi.conf}"
BUONE="${DAIPAM_ACCESSI_BUONE:-/etc/da-ipam/accessi.nft}"
STATO_DIR="${DAIPAM_ACCESSI_RUN:-/run/da-ipam-accessi}"
TABELLA="inet daipam_accessi"
UNITA_RITORNO="da-ipam-accessi-ritorno"
SCHEDA_NETBIRD="wt0"

PORTE_WEB="80, 443"
PORTE_SSH="22"
PORTE_CONSOLE="6443, 7443, 8443, 9443"
PORTE_DATI_TCP="514, 1514, 1515, 4443, 10051"
PORTE_DATI_UDP="162, 514, 2055, 6343"
# Mai dentro un gruppo: servono solo dentro la macchina (le chiude `inet dalink`, e qui restano fuori da tutto).
PORTE_VIETATE="3001 8080"

# Le esche: elenco CHIUSO nome:porta-finta:porta-alta, lo stesso di scripts/esche/da-ipam-esche.mjs (una prova li confronta).
ESCHE_CONF="${DAIPAM_ESCHE_CONF:-/etc/da-ipam/esche.conf}"
ESCHE_NOTE="ftp:21:20021 telnet:23:20023 smb:445:20445 ssh:2222:22222 mysql:3306:23306 rdp:3389:23389 web:8081:28081"
TABELLA_ESCHE="inet daipam_esche"
TABELLA_BLOCCO="inet daipam_blocco"

errore() {
  echo "da-ipam-accessi: $*" >&2
  exit 1
}

# Valore di una chiave del file: ultima riga che la definisce, virgolette esterne tolte. Mai eseguito.
valore_conf() {
  local chiave="$1" riga val=""
  [ -f "$CONF" ] || { printf ''; return 0; }
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

# Indirizzo o rete IPv4. Niente reti più larghe di /8: «tutti» si scrive con la parola, non con 0.0.0.0/0.
ipv4_valido() {
  local s="$1" ip pref="" o o1 o2 o3 o4 resto
  case "$s" in
    */*) ip="${s%/*}"; pref="${s#*/}" ;;
    *) ip="$s" ;;
  esac
  case "$ip" in *[!0-9.]* | "") return 1 ;; esac
  o1="${ip%%.*}"; resto="${ip#*.}"
  o2="${resto%%.*}"; resto="${resto#*.}"
  o3="${resto%%.*}"; o4="${resto#*.}"
  [ "$o1.$o2.$o3.$o4" = "$ip" ] || return 1
  for o in "$o1" "$o2" "$o3" "$o4"; do
    case "$o" in "" | *[!0-9]*) return 1 ;; esac
    [ "${#o}" -le 3 ] || return 1
    [ "$o" -le 255 ] || return 1
  done
  [ "$o1" -ne 0 ] || return 1
  if [ "${s#*/}" != "$s" ]; then
    case "$pref" in "" | *[!0-9]*) return 1 ;; esac
    [ "${#pref}" -le 2 ] || return 1
    [ "$pref" -ge 8 ] && [ "$pref" -le 32 ] || return 1
  fi
  return 0
}

# Indirizzo o rete IPv6: solo cifre esadecimali e due punti, almeno due «:», prefisso 16-128.
# La forma fine la controlla nft al caricamento (`nft -c`): qui si ferma tutto ciò che non è un indirizzo.
ipv6_valido() {
  local s="$1" ip pref="" senza
  case "$s" in
    */*) ip="${s%/*}"; pref="${s#*/}" ;;
    *) ip="$s" ;;
  esac
  case "$ip" in *[!0-9a-fA-F:]* | "") return 1 ;; esac
  [ "${#ip}" -le 39 ] || return 1
  senza="${ip//:/}"
  [ $(( ${#ip} - ${#senza} )) -ge 2 ] || return 1
  case "$ip" in *:::*) return 1 ;; esac
  if [ "${s#*/}" != "$s" ]; then
    case "$pref" in "" | *[!0-9]*) return 1 ;; esac
    [ "${#pref}" -le 3 ] || return 1
    [ "$pref" -ge 16 ] && [ "$pref" -le 128 ] || return 1
  fi
  return 0
}

# Legge un gruppo: riempie V4, V6 (elenchi per nft) e APERTO (si|no).
V4=""; V6=""; APERTO="no"
leggi_gruppo() {
  local chiave="$1" grezzo s
  V4=""; V6=""; APERTO="no"
  grezzo="$(valore_conf "$chiave" | tr ',' ' ')"
  for s in $grezzo; do
    if [ "$s" = "tutti" ]; then
      [ "$chiave" != "ACCESSI_SEMPRE" ] || errore "ACCESSI_SEMPRE non può valere «tutti»"
      APERTO="si"
    elif ipv4_valido "$s"; then
      if [ -n "$V4" ]; then V4="$V4, $s"; else V4="$s"; fi
    elif ipv6_valido "$s"; then
      if [ -n "$V6" ]; then V6="$V6, $s"; else V6="$s"; fi
    else
      errore "${chiave}: «${s}» non è un indirizzo né una rete ammessa"
    fi
  done
}

un_set() { # nome tipo elementi
  if [ -n "$3" ]; then
    printf '\tset %s {\n\t\ttype %s\n\t\tflags interval\n\t\telements = { %s }\n\t}\n' "$1" "$2" "$3"
  else
    printf '\tset %s {\n\t\ttype %s\n\t\tflags interval\n\t}\n' "$1" "$2"
  fi
}

# La catena di un gruppo: chi è nell'elenco passa; gli altri si segnano in `fuori*`, si contano e,
# a filtro chiuso, si scartano. In «osserva» la riga finale non c'è: il pacchetto prosegue.
catena_gruppo() { # nome aperto verdetto
  printf '\tchain g_%s {\n' "$1"
  if [ "$2" = "si" ]; then
    printf '\t\tcounter accept comment "aperto a tutti"\n'
  else
    # «altre» non ha un elenco: sono le porte fuori da ogni gruppo (trovato da `nft -c` il 25/11).
    [ "$1" = "altre" ] || printf '\t\tip saddr @%s4 accept\n\t\tip6 saddr @%s6 accept\n' "$1" "$1"
    printf '\t\tmeta nfproto ipv4 update @fuori4 { ip saddr . th dport }\n'
    printf '\t\tmeta nfproto ipv6 update @fuori6 { ip6 saddr . th dport }\n'
    printf '\t\tcounter %s\n' "$3"
  fi
  printf '\t}\n'
}

# genera_ruleset <modo>: osserva | acceso | minima
genera_ruleset() {
  local modo="$1" verdetto="drop" p
  case "$modo" in
    osserva) verdetto="accept comment \"osserva: resterebbe fuori\"" ;;
    acceso | minima) ;;
    *) errore "modo sconosciuto: $modo" ;;
  esac
  for p in $PORTE_VIETATE; do
    case ", $PORTE_WEB, $PORTE_SSH, $PORTE_CONSOLE, $PORTE_DATI_TCP," in *", $p,"*) errore "porta interna $p dentro un gruppo: vietato" ;; esac
  done

  local s4 s6 w4="" w6="" wa="no" h4="" h6="" ha="no" c4="" c6="" ca="no" d4="" d6="" da="no"
  leggi_gruppo ACCESSI_SEMPRE; s4="$V4"; s6="$V6"
  if [ "$modo" != "minima" ]; then
    leggi_gruppo ACCESSI_WEB; w4="$V4"; w6="$V6"; wa="$APERTO"
    leggi_gruppo ACCESSI_SSH; h4="$V4"; h6="$V6"; ha="$APERTO"
    leggi_gruppo ACCESSI_CONSOLE; c4="$V4"; c6="$V6"; ca="$APERTO"
    leggi_gruppo ACCESSI_DATI; d4="$V4"; d6="$V6"; da="$APERTO"
  fi

  # Le porte delle esche accese restano aperte a tutti anche a filtro chiuso: sono lì per farsi toccare.
  local riga_esche=""
  leggi_esche
  if [ -n "$ESCHE_PORTE" ] && [ "$modo" != "minima" ]; then riga_esche="tcp dport { $ESCHE_PORTE } accept comment \"esche\""; fi

  printf 'table %s\ndelete table %s\ntable %s {\n' "$TABELLA" "$TABELLA" "$TABELLA"
  printf '\tcomment "da-ipam-accessi modo=%s"\n' "$modo"
  un_set sempre4 ipv4_addr "$s4"; un_set sempre6 ipv6_addr "$s6"
  un_set web4 ipv4_addr "$w4"; un_set web6 ipv6_addr "$w6"
  un_set ssh4 ipv4_addr "$h4"; un_set ssh6 ipv6_addr "$h6"
  un_set console4 ipv4_addr "$c4"; un_set console6 ipv6_addr "$c6"
  un_set dati4 ipv4_addr "$d4"; un_set dati6 ipv6_addr "$d6"
  printf '\tset fuori4 {\n\t\ttype ipv4_addr . inet_service\n\t\tsize 4096\n\t\tflags dynamic,timeout\n\t\ttimeout 7d\n\t}\n'
  printf '\tset fuori6 {\n\t\ttype ipv6_addr . inet_service\n\t\tsize 4096\n\t\tflags dynamic,timeout\n\t\ttimeout 7d\n\t}\n'
  catena_gruppo web "$wa" "$verdetto"
  catena_gruppo ssh "$ha" "$verdetto"
  catena_gruppo console "$ca" "$verdetto"
  catena_gruppo dati "$da" "$verdetto"
  catena_gruppo altre no "$verdetto"
  cat <<EOF
	chain ingresso {
		type filter hook prerouting priority mangle + 5; policy accept;
		iifname "lo" accept
		iifname "$SCHEDA_NETBIRD" accept
		iifname "docker*" accept
		iifname "br-*" accept
		fib daddr type != local accept
		ct state established,related accept
		meta l4proto { icmp, ipv6-icmp } accept
		udp dport { 68, 546 } accept
		udp dport 51820 accept
		ip saddr @sempre4 accept
		ip6 saddr @sempre6 accept
		tcp flags & (fin | syn | rst | ack) != syn accept
		udp dport >= 32768 accept${riga_esche:+
		$riga_esche}
		tcp dport { $PORTE_WEB } jump g_web
		tcp dport { $PORTE_SSH } jump g_ssh
		tcp dport { $PORTE_CONSOLE } jump g_console
		tcp dport { $PORTE_DATI_TCP } jump g_dati
		udp dport { $PORTE_DATI_UDP } jump g_dati
		meta l4proto { tcp, udp } jump g_altre
	}
}
EOF
}

# Le esche accese nel file: ESCHE_PORTE (per le regole del filtro) e ESCHE_MAPPA (porta finta : porta alta).
ESCHE_PORTE=""; ESCHE_MAPPA=""
leggi_esche() {
  local grezzo n voce trovata
  ESCHE_PORTE=""; ESCHE_MAPPA=""
  [ -f "$ESCHE_CONF" ] || return 0
  grezzo="$(CONF="$ESCHE_CONF" valore_conf ESCHE | tr ',' ' ')"
  for n in $grezzo; do
    trovata=""
    for voce in $ESCHE_NOTE; do
      if [ "${voce%%:*}" = "$n" ]; then trovata="${voce#*:}"; fi
    done
    [ -n "$trovata" ] || errore "esca sconosciuta: «${n}»"
    case ", $ESCHE_PORTE," in *", ${trovata%%:*},"*) continue ;; esac
    if [ -n "$ESCHE_PORTE" ]; then ESCHE_PORTE="$ESCHE_PORTE, ${trovata%%:*}"; ESCHE_MAPPA="$ESCHE_MAPPA, ${trovata%%:*} : ${trovata#*:}"
    else ESCHE_PORTE="${trovata%%:*}"; ESCHE_MAPPA="${trovata%%:*} : ${trovata#*:}"; fi
  done
}

# La tabella delle esche: porta le porte finte alle porte alte del servizio, solo per ciò che arriva da fuori
# ed è diretto a questa macchina. NetBird, Docker e la macchina stessa non ci passano.
genera_esche() {
  leggi_esche
  printf 'table %s\ndelete table %s\n' "$TABELLA_ESCHE" "$TABELLA_ESCHE"
  [ -n "$ESCHE_PORTE" ] || return 0
  cat <<EOF
table $TABELLA_ESCHE {
	chain porta {
		type nat hook prerouting priority dstnat - 5; policy accept;
		iifname "lo" return
		iifname "$SCHEDA_NETBIRD" return
		iifname "docker*" return
		iifname "br-*" return
		fib daddr type local tcp dport { $ESCHE_PORTE } counter redirect to :tcp dport map { $ESCHE_MAPPA }
	}
}
EOF
}

# Un'esca non prende mai una porta vera: se la porta finta o quella alta è già di un altro servizio, ci si ferma.
controlla_porte_esche() {
  local voce finta alta chi
  command -v ss >/dev/null 2>&1 || return 0
  for voce in $ESCHE_NOTE; do
    finta="${voce#*:}"; alta="${finta#*:}"; finta="${finta%%:*}"
    case ", $ESCHE_PORTE," in *", $finta,"*) ;; *) continue ;; esac
    if [ -n "$(ss -H -tln "sport = :$finta" 2>/dev/null)" ]; then errore "la porta $finta è già di un servizio vero: l'esca «${voce%%:*}» non si accende"; fi
    chi="$(ss -H -tlnp "sport = :$alta" 2>/dev/null)"
    case "$chi" in "" | *'"node"'* | *'"MainThread"'*) ;; *) errore "la porta alta $alta è già occupata da un altro servizio" ;; esac
  done
}

installa_servizio_esche() {
  local unita="/etc/systemd/system/da-ipam-esche.service" qui app modello nodo
  qui="$(cd "$(dirname "$0")" && pwd)" || errore "non trovo la cartella dello script"
  app="$(cd "$qui/../.." && pwd)" || errore "non trovo la cartella dell'app"
  modello="$app/deploy/da-ipam-esche.service"
  [ -f "$modello" ] || errore "modello dell'unità assente: $modello"
  [ -f "$app/scripts/esche/da-ipam-esche.mjs" ] || errore "servizio delle esche assente in $app/scripts/esche"
  nodo="$(command -v node)" || errore "node non trovato: il servizio delle esche non parte"
  case "$app$nodo" in *[!A-Za-z0-9_./-]*) errore "percorso non adatto a un'unità: $app $nodo" ;; esac
  sed -e "s|@APP_DIR@|$app|g" -e "s|@NODE@|$nodo|g" "$modello" > "$unita" || errore "non ho scritto $unita"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable da-ipam-esche.service >/dev/null 2>&1 || true
  systemctl restart da-ipam-esche.service || errore "il servizio delle esche non parte: journalctl -u da-ipam-esche"
}

# Indirizzo singolo (niente reti) che si può bloccare: non NetBird, non questa macchina, non il gateway.
bloccabile() {
  local ip="$1" o1 o2 resto
  case "$ip" in */*) errore "si blocca un indirizzo, non una rete: «${ip}»" ;; esac
  if ipv4_valido "$ip"; then
    o1="${ip%%.*}"; resto="${ip#*.}"; o2="${resto%%.*}"
    if [ "$o1" -eq 100 ] && [ "$o2" -ge 64 ] && [ "$o2" -le 127 ]; then errore "«${ip}» è della rete NetBird/DA-Link: non si blocca mai"; fi
    [ "$o1" -ne 127 ] || errore "«${ip}» è la macchina stessa"
  elif ipv6_valido "$ip"; then
    [ "$ip" != "::1" ] || errore "«${ip}» è la macchina stessa"
  else
    errore "«${ip}» non è un indirizzo"
  fi
  if command -v ip >/dev/null 2>&1; then
    if ip -o addr show 2>/dev/null | grep -q -F " $ip/"; then errore "«${ip}» è un indirizzo di questa macchina: non si blocca"; fi
    if ip route show default 2>/dev/null | grep -q -F "via $ip "; then errore "«${ip}» è il gateway di questa macchina: non si blocca"; fi
  fi
}

genera_blocco() {
  cat <<EOF
table $TABELLA_BLOCCO {
	set bloccati4 {
		type ipv4_addr
		size 1024
		flags timeout
	}
	set bloccati6 {
		type ipv6_addr
		size 1024
		flags timeout
	}
	chain blocco {
		type filter hook prerouting priority mangle + 3; policy accept;
		iifname "lo" accept
		iifname "$SCHEDA_NETBIRD" accept
		iifname "docker*" accept
		iifname "br-*" accept
		ip saddr @bloccati4 counter drop
		ip6 saddr @bloccati6 counter drop
	}
}
EOF
}

vuole_root() { [ "$(id -u)" -eq 0 ] || errore "«${1}» vuole root"; }
vuole_nft() { command -v nft >/dev/null 2>&1 || errore "nft non installato (apt-get install nftables)"; }

# Carica un ruleset già generato, in modo atomico, e rilegge la tabella.
carica() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/daipam-accessi.XXXXXX")" || errore "mktemp fallito"
  printf '%s\n' "$1" > "$tmp"
  if ! nft -f "$tmp"; then rm -f "$tmp"; return 1; fi
  rm -f "$tmp"
  nft list table $TABELLA >/dev/null 2>&1
}

modo_caricato() {
  nft list table $TABELLA 2>/dev/null | sed -n 's/.*comment "da-ipam-accessi modo=\([a-z]*\)".*/\1/p' | head -n 1
}

# L'unità che ricarica le regole all'accensione: la installa lo script stesso la prima volta che servono
# (osserva, conferma), dal modello in deploy/. Se non ci riesce lo dice e va avanti: le regole sono già caricate.
assicura_avvio() {
  local unita="/etc/systemd/system/da-ipam-accessi.service" qui modello app
  [ -d /etc/systemd/system ] || return 0
  qui="$(cd "$(dirname "$0")" && pwd)" || return 0
  app="$(cd "$qui/../.." && pwd)" || return 0
  modello="$app/deploy/da-ipam-accessi.service"
  [ -f "$modello" ] || { echo "da-ipam-accessi: modello dell'unità assente ($modello): al riavvio le regole non tornano" >&2; return 0; }
  case "$app" in *[!A-Za-z0-9_./-]*) echo "da-ipam-accessi: percorso dell'app non adatto a un'unità: $app" >&2; return 0 ;; esac
  if [ ! -f "$unita" ] || ! grep -q -F "$app/scripts/accessi/da-ipam-accessi.sh avvio" "$unita"; then
    sed "s|@APP_DIR@|$app|g" "$modello" > "$unita" || return 0
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  systemctl enable da-ipam-accessi.service >/dev/null 2>&1 || echo "da-ipam-accessi: unità d'avvio non abilitata: al riavvio le regole non tornano" >&2
}

disarma() { systemctl stop "$UNITA_RITORNO.timer" "$UNITA_RITORNO.service" >/dev/null 2>&1 || true; }

COMANDO="${1:-anteprima}"
case "$COMANDO" in
  anteprima)
    [ $# -le 2 ] || errore "anteprima [osserva|acceso]"
    RULESET="$(genera_ruleset "${2:-acceso}")" || exit 1
    printf '%s\n' "$RULESET"
    ;;
  minima)
    RULESET="$(genera_ruleset minima)" || exit 1
    printf '%s\n' "$RULESET"
    ;;
  stato)
    vuole_nft
    M="$(modo_caricato)"
    echo "tabella=${M:-assente}"
    if systemctl is-active -q "$UNITA_RITORNO.timer" 2>/dev/null; then echo "prova=in_corso"; else echo "prova=no"; fi
    if [ -f "$BUONE" ]; then echo "ultime_buone=si"; else echo "ultime_buone=no"; fi
    ;;
  osserva)
    vuole_root osserva; vuole_nft
    RULESET="$(genera_ruleset osserva)" || exit 1
    disarma
    carica "$RULESET" || errore "nft ha rifiutato il ruleset: niente è cambiato"
    mkdir -p "$(dirname "$BUONE")" && printf '%s\n' "$RULESET" > "$BUONE"
    assicura_avvio
    echo "da-ipam-accessi: in osservazione (nessun pacchetto scartato)"
    ;;
  prova)
    vuole_root prova; vuole_nft
    SEC="${2:-}"
    case "$SEC" in "" | *[!0-9]*) errore "prova <secondi> (30-600)" ;; esac
    [ "${#SEC}" -le 3 ] && [ "$SEC" -ge 30 ] && [ "$SEC" -le 600 ] || errore "prova <secondi> (30-600)"
    command -v systemd-run >/dev/null 2>&1 || errore "systemd-run non c'è: senza ritorno automatico non si prova"
    RULESET="$(genera_ruleset acceso)" || exit 1
    mkdir -p "$STATO_DIR" || errore "non posso creare $STATO_DIR"
    disarma
    # Le regole di prima: la tabella com'è adesso, oppure il segno che non c'era.
    if nft list table $TABELLA > "$STATO_DIR/prima.nft.tmp" 2>/dev/null; then
      { printf 'table %s\ndelete table %s\n' "$TABELLA" "$TABELLA"; cat "$STATO_DIR/prima.nft.tmp"; } > "$STATO_DIR/prima.nft"
    else
      : > "$STATO_DIR/prima.nft"
    fi
    rm -f "$STATO_DIR/prima.nft.tmp"
    printf '%s\n' "$RULESET" > "$STATO_DIR/in-prova.nft"
    # PRIMA si arma il ritorno, POI si carica: se il caricamento chiude fuori anche noi, il ritorno parte lo stesso.
    systemd-run --quiet --unit="$UNITA_RITORNO" --on-active="${SEC}s" /bin/bash "$0" annulla \
      || errore "non sono riuscito ad armare il ritorno automatico: niente è cambiato"
    if ! carica "$RULESET"; then
      disarma
      errore "nft ha rifiutato il ruleset: niente è cambiato"
    fi
    echo "da-ipam-accessi: regole in prova per ${SEC}s; senza «conferma» tornano quelle di prima"
    ;;
  conferma)
    vuole_root conferma; vuole_nft
    [ -f "$STATO_DIR/in-prova.nft" ] || errore "nessuna prova in corso"
    systemctl is-active -q "$UNITA_RITORNO.timer" 2>/dev/null || errore "la prova è già scaduta: le regole di prima sono tornate"
    disarma
    mkdir -p "$(dirname "$BUONE")" && cp "$STATO_DIR/in-prova.nft" "$BUONE" || errore "non ho salvato le ultime buone in $BUONE"
    rm -f "$STATO_DIR/in-prova.nft" "$STATO_DIR/prima.nft"
    assicura_avvio
    echo "da-ipam-accessi: confermato, filtro acceso"
    ;;
  annulla)
    vuole_root annulla; vuole_nft
    if [ -s "$STATO_DIR/prima.nft" ]; then
      nft -f "$STATO_DIR/prima.nft" || nft delete table $TABELLA 2>/dev/null || true
      echo "da-ipam-accessi: tornate le regole di prima"
    else
      nft delete table $TABELLA 2>/dev/null || true
      echo "da-ipam-accessi: tabella tolta (prima non c'era)"
    fi
    rm -f "$STATO_DIR/in-prova.nft" "$STATO_DIR/prima.nft"
    ;;
  spegni)
    vuole_root spegni; vuole_nft
    disarma
    nft delete table $TABELLA 2>/dev/null || true
    rm -f "$BUONE" "$STATO_DIR/in-prova.nft" "$STATO_DIR/prima.nft"
    echo "da-ipam-accessi: filtro spento, tabella tolta. L'installazione NON è protetta."
    ;;
  avvio)
    vuole_root avvio; vuole_nft
    [ -f "$BUONE" ] || { echo "da-ipam-accessi: nessuna regola da caricare"; exit 0; }
    if nft -f "$BUONE"; then
      echo "da-ipam-accessi: ultime buone caricate ($(modo_caricato))"
    else
      # Guasto: né aperto a tutti né chiuso del tutto (ADR 0041). Esce 2: il servizio risulta fallito e si vede.
      RULESET="$(genera_ruleset minima 2>/dev/null)" || RULESET="$(CONF=/dev/null genera_ruleset minima)"
      carica "$RULESET" || errore "nft rifiuta anche la politica minima: nessun filtro caricato"
      echo "da-ipam-accessi: EMERGENZA, caricata la politica minima (solo NetBird e sempre ammessi)" >&2
      exit 2
    fi
    ;;
  esche-anteprima)
    RULESET="$(genera_esche)" || exit 1
    printf '%s\n' "$RULESET"
    ;;
  blocco-anteprima)
    genera_blocco
    ;;
  esche)
    vuole_root esche; vuole_nft
    RULESET="$(genera_esche)" || exit 1
    leggi_esche
    if [ -z "$ESCHE_PORTE" ]; then
      nft delete table $TABELLA_ESCHE 2>/dev/null || true
      systemctl disable --now da-ipam-esche.service >/dev/null 2>&1 || true
      echo "da-ipam-accessi: nessuna esca accesa, tabella e servizio tolti"
    else
      controlla_porte_esche
      # Il servizio gira con un'utenza senza privilegi: deve poter leggere il suo file (solo nomi di esche, niente
      # di riservato). La politica degli accessi accanto resta leggibile solo da root. Visto sul laboratorio il 26/11.
      chmod 755 "$(dirname "$ESCHE_CONF")" && chmod 644 "$ESCHE_CONF" || errore "non ho reso leggibile $ESCHE_CONF al servizio delle esche"
      installa_servizio_esche
      TMP="$(mktemp "${TMPDIR:-/tmp}/daipam-esche.XXXXXX")" || errore "mktemp fallito"
      printf '%s\n' "$RULESET" > "$TMP"
      if ! nft -f "$TMP"; then rm -f "$TMP"; errore "nft ha rifiutato la tabella delle esche"; fi
      rm -f "$TMP"
      echo "da-ipam-accessi: esche accese sulle porte $ESCHE_PORTE"
    fi
    # Se il filtro è caricato va rigenerato: le porte delle esche devono restare raggiungibili (o tornare chiuse).
    M="$(modo_caricato)"
    case "$M" in
      osserva | acceso)
        RULESET="$(genera_ruleset "$M")" || exit 1
        carica "$RULESET" || errore "filtro non rigenerato dopo il cambio delle esche"
        [ ! -f "$BUONE" ] || printf '%s\n' "$RULESET" > "$BUONE"
        ;;
    esac
    ;;
  blocca)
    vuole_root blocca; vuole_nft
    IPB="${2:-}"; SEC="${3:-}"
    [ -n "$IPB" ] || errore "blocca <indirizzo> <secondi>"
    case "$SEC" in "" | *[!0-9]*) errore "blocca <indirizzo> <secondi> (60-604800)" ;; esac
    [ "${#SEC}" -le 6 ] && [ "$SEC" -ge 60 ] && [ "$SEC" -le 604800 ] || errore "blocca <indirizzo> <secondi> (60-604800)"
    bloccabile "$IPB"
    if ! nft list table $TABELLA_BLOCCO >/dev/null 2>&1; then
      genera_blocco | nft -f - || errore "nft ha rifiutato la tabella del blocco"
    fi
    if ipv4_valido "$IPB"; then SETB="bloccati4"; else SETB="bloccati6"; fi
    nft delete element $TABELLA_BLOCCO "$SETB" "{ $IPB }" 2>/dev/null || true
    nft add element $TABELLA_BLOCCO "$SETB" "{ $IPB timeout ${SEC}s }" || errore "blocco non riuscito (elenco pieno?)"
    echo "da-ipam-accessi: ${IPB} bloccato per ${SEC}s"
    ;;
  sblocca)
    vuole_root sblocca; vuole_nft
    IPB="${2:-}"
    if ipv4_valido "$IPB"; then SETB="bloccati4"; elif ipv6_valido "$IPB"; then SETB="bloccati6"; else errore "sblocca <indirizzo>"; fi
    nft delete element $TABELLA_BLOCCO "$SETB" "{ $IPB }" 2>/dev/null || true
    echo "da-ipam-accessi: ${IPB} non è più bloccato"
    ;;
  bloccati)
    vuole_nft
    nft -j list table $TABELLA_BLOCCO 2>/dev/null || true
    ;;
  *) errore "comando sconosciuto: $COMANDO (anteprima, minima, stato, osserva, prova, conferma, annulla, spegni, avvio, esche-anteprima, esche, blocca, sblocca, bloccati)" ;;
esac
