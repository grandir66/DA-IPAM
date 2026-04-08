#!/bin/bash
#
# DA-INVENT — Creazione guidata di un container LXC su Proxmox VE
#
# Eseguire sul nodo Proxmox (shell del nodo, non da dentro un CT) come root.
# Consigliato: copia lo script sul nodo (scp/git clone), poi:
#   chmod +x scripts/proxmox-lxc-install.sh && ./scripts/proxmox-lxc-install.sh
# (Non usare pipe da curl per questo wizard: richiede input interattivo.)
#
# Lo script:
#   - Chiede template OS, storage, risorse, bridge di rete (Ethernet o bridge già legato al Wi‑Fi sul host)
#   - Opzionale VLAN tag
#   - CT ID, hostname, password root
#   - IP statico o DHCP
#   - Opzione container privilegiato (consigliato per nmap/ping)
#   - Opzionale: clone repository e esecuzione di scripts/install.sh --systemd dentro al CT
#
# Variabili d'ambiente (opzionali):
#   DA_INVENT_CT_NAMESERVERS   — elenco nameserver separati da spazio (default: 1.1.1.1 8.8.8.8) se serve fix DNS nel CT
#   DA_INVENT_NO_CT_DNS_FIX=1  — non modificare /etc/resolv.conf nel CT (fallisce se il DNS non risolve già)
#
set -euo pipefail

# Repository predefinito (modificabile durante il wizard)
DEFAULT_GIT_URL="${DA_INVENT_GIT_URL:-https://github.com/grandir66/DA-IPAM.git}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() { echo -e "${RED}Errore:${NC} $*" >&2; exit 1; }
# Messaggi su stderr così $(comandi) ricevono solo valori “puliti” (es. tpl_pick=$(pick_template))
info() { echo -e "${GREEN}==>${NC} $*" >&2; }
warn() { echo -e "${YELLOW}Attenzione:${NC} $*" >&2; }

# Bridge Linux sul nodo (vmbr0, …)
bridge_exists() {
  [[ -n "${1:-}" ]] && ip link show "$1" >/dev/null 2>&1
}

# Validazione leggera IPv4 + CIDR (es. 192.168.1.10/24)
valid_ipv4_cidr() {
  [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]
}

# IPv4 senza maschera
valid_ipv4_addr() {
  [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

# pveam list stampa la prima colonna come "local:vztmpl/debian-12-standard_….tar.zst".
# pct create vuole "<storage>:vztmpl/<solo-nome-file>": estraiamo solo il nome archivio.
normalize_template_filename() {
  local raw="$1"
  [[ -n "$raw" ]] || { echo ""; return; }
  if [[ "$raw" == *":vztmpl/"* ]]; then
    echo "${raw#*:vztmpl/}"
  elif [[ "$raw" == vztmpl/* ]]; then
    echo "${raw#vztmpl/}"
  else
    echo "$raw"
  fi
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Esegui come root sul nodo Proxmox (es. ssh root@pve)."
}

require_proxmox() {
  command -v pct >/dev/null 2>&1 || die "Comando 'pct' non trovato. Questo script va eseguito su Proxmox VE."
  command -v pveam >/dev/null 2>&1 || die "Comando 'pveam' non trovato."
  command -v pvesm >/dev/null 2>&1 || die "Comando 'pvesm' non trovato."
}

# Elenco righe dati da pvesm status (salta intestazione).
pvesm_data_lines() {
  local content="$1"
  pvesm status -content "$content" 2>/dev/null | tail -n +2 || true
}

# Sceglie uno storage per tipo contenuto Proxmox (vztmpl, rootdir, …) da menu numerato.
pick_numbered_storage() {
  local content="$1"
  local title="$2"
  local raw
  raw=$(pvesm_data_lines "$content")
  if [[ -z "$(echo "$raw" | tr -d '[:space:]')" ]]; then
    die "Nessuno storage con contenuto '$content'. Aggiungine uno in Datacenter → Storage (es. local per vztmpl, local-lvm per rootdir)."
  fi
  while true; do
    echo "" >&2
    echo "$title" >&2
    echo "(tipo contenuto Proxmox: $content)" >&2
    echo "$raw" | nl -w2 -s') ' >&2
    local num name
    read -r -p "Numero storage [1]: " num
    num="${num:-1}"
    name=$(echo "$raw" | sed -n "${num}p" | awk '{print $1}')
    if [[ -n "$name" ]]; then
      echo "$name"
      return 0
    fi
    warn "Selezione non valida: scegli un numero dall'elenco."
  done
}

prompt() {
  # $1 default, $2 messaggio
  local def="$1"
  local msg="$2"
  local val
  read -r -p "$msg [${def}]: " val
  echo "${val:-$def}"
}

prompt_secret() {
  local msg="$1"
  local attempt max=12
  for ((attempt = 1; attempt <= max; attempt++)); do
    local s1 s2
    read -r -s -p "$msg: " s1
    echo ""
    read -r -s -p "Ripeti la password: " s2
    echo ""
    if [[ -z "$s1" ]]; then
      warn "Password vuota. Riprova ($attempt/$max)."
      continue
    fi
    if [[ "$s1" != "$s2" ]]; then
      warn "Le password non coincidono. Riprova ($attempt/$max)."
      continue
    fi
    echo "$s1"
    return 0
  done
  die "Troppi tentativi errati sulla password root. Rilancia lo script quando vuoi."
}

get_bridge_names() {
  ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -v '^[[:space:]]*$' || true
}

# Menu numerato dei bridge Linux sul nodo; fallback manuale se nessuno rilevato.
pick_bridge() {
  local raw
  raw=$(get_bridge_names)
  if [[ -z "$(echo "$raw" | tr -d '[:space:]')" ]]; then
    warn "Nessun bridge rilevato (ip link type bridge). Inserisci il nome manualmente (es. vmbr0)."
    read -r -p "Nome bridge: " bridge
    [[ -n "${bridge:-}" ]] || die "Nome bridge obbligatorio."
    echo "$bridge"
    return
  fi
  while true; do
    echo "" >&2
    echo "Bridge di rete rilevati (scegli quello collegato a LAN o Wi‑Fi bridge-ato sul host):" >&2
    echo "$raw" | nl -w2 -s') ' >&2
    echo " 0) Inserisci manualmente il nome del bridge (es. vmbr0)" >&2
    echo "" >&2
    local num name
    read -r -p "Numero bridge [1] (0 = manuale): " num
    num="${num:-1}"
    if [[ "$num" == "0" ]]; then
      read -r -p "Nome bridge: " name
      if [[ -z "${name:-}" ]]; then
        warn "Nome bridge obbligatorio."
        continue
      fi
      echo "$name"
      return 0
    fi
    name=$(echo "$raw" | sed -n "${num}p")
    if [[ -n "$name" ]]; then
      echo "$name"
      return 0
    fi
    warn "Selezione non valida: scegli un numero dall'elenco o 0 per inserimento manuale."
  done
}

ctid_in_use() {
  local id="$1"
  pct config "$id" >/dev/null 2>&1
}

suggest_ctid() {
  local id=100
  while ctid_in_use "$id"; do
    id=$((id + 1))
  done
  echo "$id"
}

list_templates_on_storage() {
  local stor="$1"
  # Esclude righe "listing..." e intestazioni; mantieni solo archivi template
  pveam list "$stor" 2>/dev/null | grep -v '^listing' | grep -E '\.(tar\.zst|tar\.gz|tar\.xz)(\s|$)' || true
}

# Rimuove codici colore ANSI (pveam available può usare colori in TTY).
strip_ansi_line() {
  printf '%s' "$1" | sed 's/\x1b\[[0-9;]*m//g'
}

# Dalla riga di "pveam available" estrae SOLO il nome file .tar.* (ultimo campo che termina così).
# Non usare grep -oE su tutta la riga: può matchare sottostringhe errate (es. solo "standard_…_amd64.tar.zst").
extract_template_filename_from_pveam_line() {
  local raw="$1"
  [[ -n "$raw" ]] || { echo ""; return; }
  local line
  line=$(strip_ansi_line "$raw")
  local tname
  tname=$(echo "$line" | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i ~ /\.tar\.(zst|gz|xz)$/) fname = $i
    }
    END { print fname }
  }')
  if [[ -n "$tname" ]]; then
    echo "$tname"
    return
  fi
  # Fallback: ultimo token che assomiglia a un archivio template
  echo "$line" | grep -oE '[^[:space:]]+\.(tar\.zst|tar\.gz|tar\.xz)' | tail -n 1
}

pick_template_storage() {
  pick_numbered_storage vztmpl "Storage per i template LXC (dove risiedono i .tar.zst / download pveam)"
}

# Se non ci sono template sullo storage: elenco da pveam available e scelta numerata → solo nome file .tar.*
pick_available_template_filename() {
  info "Aggiornamento indice template (pveam update)…"
  if ! pveam update; then
    warn "pveam update non è riuscito (rete/DNS?). L'indice template potrebbe essere obsoleto e il download fallire."
  fi
  local avail
  avail=$(pveam available --section system 2>/dev/null | grep -E '\.(tar\.zst|tar\.gz|tar\.xz)' || true)
  if [[ -z "$(echo "$avail" | tr -d '[:space:]')" ]]; then
    die "Nessun template in 'pveam available'. Verifica la connessione Internet del nodo Proxmox e che il nodo risolva download.proxmox.com."
  fi
  local filtered
  filtered=$(echo "$avail" | grep -iE 'debian|ubuntu' || echo "$avail")
  echo "" >&2
  echo "Template scaricabili (sezione system). Debian/Ubuntu consigliati per DA-INVENT:" >&2
  echo " (Su Proxmox VE 7 alcuni template Ubuntu recenti possono mancare: in quel caso usa Debian 12 o aggiorna a PVE 8+.)" >&2
  echo "$filtered" | nl -w3 -s') ' >&2
  echo "" >&2
  while true; do
    local num line tname
    read -r -p "Numero riga del template da scaricare [1]: " num
    num="${num:-1}"
    line=$(echo "$filtered" | sed -n "${num}p")
    if [[ -z "$line" ]]; then
      warn "Selezione non valida: nessuna riga corrispondente. Riprova."
      continue
    fi
    tname=$(extract_template_filename_from_pveam_line "$line")
    if [[ -z "$tname" ]]; then
      warn "Impossibile ricavare il nome file .tar.* dalla riga. Scegli un altro numero."
      continue
    fi
    if ! echo "$avail" | grep -qF "$tname"; then
      warn "Nome estratto '$tname' insolito rispetto al catalogo; potresti aver scelto la riga sbagliata."
    fi
    echo "$tname"
    return 0
  done
}

pick_template() {
  local tpl_stor
  tpl_stor=$(pick_template_storage)
  info "Template disponibili su storage '$tpl_stor' (pveam list):"
  local lines
  lines=$(list_templates_on_storage "$tpl_stor")
  if [[ -z "$(echo "$lines" | tr -d '[:space:]')" ]]; then
    warn "Nessun template sullo storage '$tpl_stor'. Scelta da catalogo e download."
    while true; do
      local tname
      tname=$(pick_available_template_filename)
      info "Download su storage '$tpl_stor' (può richiedere alcuni minuti)…"
      info "Template: $tname"
      if pveam download "$tpl_stor" "$tname"; then
        echo "$tpl_stor|$tname"
        return 0
      fi
      echo "" >&2
      warn "Download fallito (nome errato, rete, o template non più sul mirror)."
      echo "    Suggerimento: pveam update && pveam available --section system | grep -E 'debian|ubuntu'" >&2
      local again
      read -r -p "Riprova con un altro template dalla lista? (S/n): " again
      [[ "$again" =~ ^[nN] ]] && die "Download template annullato. Rilancia lo script quando preferisci."
    done
  fi

  while true; do
    echo "$lines" | nl -w2 -s') ' >&2
    local num file
    read -r -p "Numero riga del template da usare [1]: " num
    num="${num:-1}"
    file=$(echo "$lines" | sed -n "${num}p" | awk '{print $1}')
    if [[ -z "$file" ]]; then
      warn "Selezione non valida. Riprova."
      continue
    fi
    file=$(normalize_template_filename "$file")
    if [[ -z "$file" ]]; then
      warn "Nome template non valido dopo normalizzazione. Riprova."
      continue
    fi
    echo "$tpl_stor|$file"
    return 0
  done
}

pick_storage() {
  pick_numbered_storage rootdir "Storage per il disco root del container"
}

build_net0() {
  local bridge="$1"
  local tag="$2"
  local mode="$3"
  local ip="$4"
  local gw="$5"

  local net="name=eth0,bridge=${bridge}"
  if [[ -n "$tag" && "$tag" != "0" ]]; then
    net+=",tag=${tag}"
  fi
  if [[ "$mode" == "dhcp" ]]; then
    net+=",ip=dhcp"
  else
    [[ -n "$ip" ]] || die "Indirizzo IP/CIDR obbligatorio per rete statica (es. 192.168.1.50/24)."
    net+=",ip=${ip}"
    [[ -n "$gw" ]] && net+=",gw=${gw}"
  fi
  echo "$net"
}

# True se il CT risolve almeno un mirror dei repository (apt).
ct_dns_can_resolve_repos() {
  local vmid="$1"
  pct exec "$vmid" -- bash -c 'getent hosts archive.ubuntu.com >/dev/null 2>&1 || getent hosts deb.debian.org >/dev/null 2>&1'
}

# Sostituisce /etc/resolv.conf con nameserver espliciti (tipico fix LXC senza DNS funzionante).
# NS da DA_INVENT_CT_NAMESERVERS o default Cloudflare + Google.
apply_ct_dns_public_resolv() {
  local vmid="$1"
  local ns_list="${DA_INVENT_CT_NAMESERVERS:-1.1.1.1 8.8.8.8}"
  pct exec "$vmid" -- env NS_LIST="$ns_list" bash -ce '
set -e
if getent hosts archive.ubuntu.com >/dev/null 2>&1; then exit 0; fi
if getent hosts deb.debian.org >/dev/null 2>&1; then exit 0; fi
if [[ -L /etc/resolv.conf ]]; then
  rm -f /etc/resolv.conf
elif [[ -f /etc/resolv.conf ]]; then
  cp -a /etc/resolv.conf /etc/resolv.conf.da-invent-orig.bak 2>/dev/null || true
fi
: > /etc/resolv.conf
for ns in $NS_LIST; do
  printf "nameserver %s\n" "$ns" >> /etc/resolv.conf
done
chmod 644 /etc/resolv.conf
'
}

# Prima di apt nel CT: verifica DNS; opzionalmente chiede e applica resolv.conf con DNS pubblici.
ensure_ct_dns_for_apt() {
  local vmid="$1"
  if ct_dns_can_resolve_repos "$vmid"; then
    return 0
  fi
  warn "Il container non risolve i nomi Internet (es. archive.ubuntu.com): apt non può scaricare i pacchetti."
  warn "Spesso succede se manca il gateway, il bridge non ha accesso alla LAN o /etc/resolv.conf nel CT è vuoto/errato."
  if [[ "${DA_INVENT_NO_CT_DNS_FIX:-}" == "1" ]]; then
    die "DNS non funzionante nel CT e DA_INVENT_NO_CT_DNS_FIX=1 impedisce la correzione automatica. Entra con: pct enter $vmid — verifica ping al gateway, poi imposta nameserver (es. echo nameserver 1.1.1.1 >> /etc/resolv.conf) o usa il DNS della tua LAN."
  fi
  local fix="S"
  if [[ -t 0 ]]; then
    read -r -p "Impostare nel CT /etc/resolv.conf con DNS pubblici (${DA_INVENT_CT_NAMESERVERS:-1.1.1.1 8.8.8.8})? [S/n]: " fix
    fix="${fix:-S}"
  fi
  if [[ "$fix" =~ ^[nN] ]]; then
    die "Senza DNS risolvibile, apt fallirà. Correggi la rete del CT o rilancia accettando il fix DNS."
  fi
  info "Applicazione nameserver nel CT (backup in /etc/resolv.conf.da-invent-orig.bak se presente)…"
  apply_ct_dns_public_resolv "$vmid"
  if ! ct_dns_can_resolve_repos "$vmid"; then
    die "DNS ancora non funzionante nel CT. Dal nodo verifica: ping al gateway dalla LAN, firewall, e 'pct exec $vmid -- ping -c1 1.1.1.1'. Se il ping a IP funziona ma non i nomi, controlla solo resolv.conf / systemd-resolved nel CT."
  fi
  info "DNS nel CT: OK (test archive.ubuntu.com / deb.debian.org)."
}

# --- Wizard: input ripetuti fino a validazione (senza uscire dallo script) ---

wizard_ask_identity() {
  local def_id
  def_id=$(suggest_ctid)
  while true; do
    read -r -p "2) ID numerico del container (VMID / CTID) [${def_id}]: " vmid
    vmid="${vmid:-$def_id}"
    if ! [[ "$vmid" =~ ^[0-9]+$ ]]; then
      warn "L'ID deve contenere solo cifre."
      continue
    fi
    if ctid_in_use "$vmid"; then
      warn "L'ID $vmid è già in uso da un altro CT/VM. VMID libero suggerito: $(suggest_ctid)"
      continue
    fi
    break
  done
  while true; do
    read -r -p "3) Hostname del container [da-invent]: " hostname
    hostname="${hostname:-da-invent}"
    if [[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]]; then
      break
    fi
    warn "Hostname non valido (lettere, cifre, trattino; lunghezza DNS)."
  done
}

wizard_ask_resources() {
  while true; do
    cores=$(prompt "2" "4) Numero di core CPU")
    [[ "$cores" =~ ^[0-9]+$ ]] && [[ "$cores" -ge 1 ]] && break
    warn "Indica un numero intero ≥ 1."
  done
  while true; do
    mem=$(prompt "2048" "5) RAM (MiB)")
    [[ "$mem" =~ ^[0-9]+$ ]] && [[ "$mem" -ge 128 ]] && break
    warn "RAM: numero intero ≥ 128 (MiB)."
  done
  while true; do
    disk=$(prompt "16" "6) Disco root (GB)")
    [[ "$disk" =~ ^[0-9]+$ ]] && [[ "$disk" -ge 4 ]] && break
    warn "Disco: numero intero ≥ 4 (GB)."
  done
  storage=$(pick_storage)
}

wizard_ask_network() {
  info "7) Rete — bridge (menu numerato)"
  while true; do
    bridge=$(pick_bridge)
    if bridge_exists "$bridge"; then
      break
    fi
    warn "Interfaccia bridge '$bridge' non trovata su questo nodo (verifica con: ip link). Riprova la scelta."
  done

  while true; do
    vlan_ask=$(prompt "" "   VLAN tag (opzionale, Invio = nessuna)")
    vlan=""
    if [[ -z "$vlan_ask" ]]; then
      break
    fi
    if [[ "$vlan_ask" =~ ^[0-9]+$ ]]; then
      vlan="$vlan_ask"
      break
    fi
    warn "VLAN deve essere un numero o vuoto."
  done

  while true; do
    echo ""
    echo "   Modalità indirizzo IP:"
    echo "     1) DHCP"
    echo "     2) Statico"
    read -r -p "   Scelta [1]: " ipmode
    ipmode="${ipmode:-1}"
    static_ip=""
    static_gw=""
    if [[ "$ipmode" == "2" ]]; then
      while true; do
        read -r -p "   Indirizzo IPv4 con CIDR (es. 192.168.1.50/24): " static_ip
        if valid_ipv4_cidr "$static_ip"; then
          break
        fi
        warn "Formato atteso: x.x.x.x/nn (es. 192.168.1.50/24)."
      done
      while true; do
        read -r -p "   Gateway (es. 192.168.1.1, Invio = nessuno): " static_gw
        if [[ -z "$static_gw" ]]; then
          break
        fi
        if valid_ipv4_addr "$static_gw"; then
          break
        fi
        warn "Gateway deve essere un IPv4 valido o vuoto."
      done
    elif [[ "$ipmode" == "1" ]]; then
      break
    else
      warn "Scelta non valida: usa 1 (DHCP) o 2 (statico)."
      continue
    fi
    break
  done

  net0=$(build_net0 "$bridge" "$vlan" "$([[ "$ipmode" == "2" ]] && echo static || echo dhcp)" "$static_ip" "$static_gw")
}

wizard_ask_privileged() {
  echo ""
  warn "Per scansioni nmap/ping affidabili, un container privilegiato è spesso necessario."
  read -r -p "8) Container privilegiato? (s/n) [s]: " priv
  priv="${priv:-s}"
  unpriv_flag="--unprivileged 1"
  priv_label="no (unprivileged)"
  if [[ "$priv" =~ ^[sSyY] ]]; then
    unpriv_flag="--unprivileged 0"
    priv_label="sì (consigliato per nmap)"
  fi
}

main() {
  require_root
  require_proxmox

  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║     DA-INVENT — Wizard creazione LXC su Proxmox VE         ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Note sulla rete / Wi‑Fi:"
  echo "  Il container si collega solo a un bridge Linux (vmbr0, vmbr1, …)."
  echo "  Se usi il Wi‑Fi sul Proxmox, deve essere già configurato come bridge"
  echo "  nel host (stesso nome che scegli qui). LXC non seleziona wlan direttamente."
  echo "  Se dopo l'avvio apt nel CT segnala «Temporary failure resolving», è un problema"
  echo "  DNS/rete nel container: lo script può proporre DNS pubblici in /etc/resolv.conf."
  echo ""

  # --- OS / template + parametri CT (con ripetizione se pct create fallisce) ---
  info "1) Sistema operativo (template LXC)"
  warn "L'installer DA-INVENT nello script install.sh supporta Debian/Ubuntu (apt)."
  local tpl_pick tpl_storage ostemplate
  local vmid hostname cores mem disk storage net0 unpriv_flag priv_label rootpw
  local wiz_retry=full

  tpl_pick=$(pick_template)
  [[ "$tpl_pick" == *"|"* ]] || die "Selezione template non valida."
  tpl_storage="${tpl_pick%%|*}"
  ostemplate="${tpl_pick#*|}"
  [[ -n "$ostemplate" ]] || die "Nome file template vuoto."

  while true; do
    case $wiz_retry in
      full)
        wizard_ask_identity
        wizard_ask_resources
        wizard_ask_network
        wizard_ask_privileged
        echo ""
        info "9) Password utente root nel container"
        rootpw=$(prompt_secret "Password root")
        ;;
      v)
        wizard_ask_identity
        echo ""
        info "Password root (nuova o conferma)"
        rootpw=$(prompt_secret "Password root")
        ;;
      r)
        wizard_ask_network
        ;;
      t)
        tpl_pick=$(pick_template)
        [[ "$tpl_pick" == *"|"* ]] || { warn "Selezione template non valida."; wiz_retry=full; continue; }
        tpl_storage="${tpl_pick%%|*}"
        ostemplate="${tpl_pick#*|}"
        ;;
      w)
        wizard_ask_resources
        ;;
      p)
        wizard_ask_privileged
        ;;
      a)
        tpl_pick=$(pick_template)
        [[ "$tpl_pick" == *"|"* ]] || { warn "Selezione template non valida."; wiz_retry=full; continue; }
        tpl_storage="${tpl_pick%%|*}"
        ostemplate="${tpl_pick#*|}"
        wizard_ask_identity
        wizard_ask_resources
        wizard_ask_network
        wizard_ask_privileged
        echo ""
        info "9) Password utente root nel container"
        rootpw=$(prompt_secret "Password root")
        ;;
      *)
        warn "Scelta non valida: ripetizione completa dei parametri."
        wiz_retry=full
        continue
        ;;
    esac

    echo ""
    echo "--- Riepilogo ---"
    echo "  VMID:      $vmid"
    echo "  Hostname:  $hostname"
    echo "  Template:  ${tpl_storage}:vztmpl/${ostemplate}"
    echo "  Risorse:   $cores core, ${mem} MiB RAM, ${disk} GB su storage $storage"
    echo "  Rete:      $net0"
    echo "  Privilegi: $priv_label"
    echo ""
    local ok_sum
    read -r -p "Confermi e procedi con pct create? (S/n): " ok_sum
    ok_sum="${ok_sum:-S}"
    if [[ "$ok_sum" =~ ^[nN] ]]; then
      read -r -p "Cosa modificare? v=VMID/host  r=rete  t=template  w=risorse  p=privilegi  a=tutto  Invio=tutto: " wiz_retry
      wiz_retry="${wiz_retry:-full}"
      wiz_retry=$(printf '%s' "$wiz_retry" | tr '[:upper:]' '[:lower:]')
      continue
    fi

    info "Creazione container $vmid (template ${tpl_storage}:vztmpl/${ostemplate})..."
    local pct_log
    pct_log=$(mktemp)
    set +e
    pct create "$vmid" "${tpl_storage}:vztmpl/${ostemplate}" \
      --hostname "$hostname" \
      --memory "$mem" \
      --cores "$cores" \
      --rootfs "${storage}:${disk}" \
      --net0 "$net0" \
      --onboot 1 \
      $unpriv_flag \
      --password "$rootpw" >"$pct_log" 2>&1
    local pec=$?
    set -e
    if [[ $pec -eq 0 ]]; then
      rm -f "$pct_log"
      info "Avvio container..."
      pct start "$vmid"
      echo ""
      info "Container $vmid avviato (hostname: $hostname)."
      echo ""
      break
    fi
    warn "pct create fallito (codice $pec):"
    cat "$pct_log" >&2 || true
    rm -f "$pct_log"
    echo ""
    echo "Correggi i parametri e riprova (nessun CT creato):" >&2
    echo "  v = VMID / hostname      r = rete (bridge, VLAN, DHCP/static)" >&2
    echo "  t = altro template       w = core, RAM, disco, storage" >&2
    echo "  p = container privilegiato / unprivileged" >&2
    echo "  a = ricomincia da template + tutti i passi" >&2
    echo "  q = esci senza creare" >&2
    read -r -p "Scelta [v]: " wiz_retry
    wiz_retry="${wiz_retry:-v}"
    wiz_retry=$(printf '%s' "$wiz_retry" | tr '[:upper:]' '[:lower:]')
    if [[ "$wiz_retry" == "q" ]]; then
      exit 1
    fi
  done

  # --- Optional DA-INVENT install ---
  local do_install
  read -r -p "Installare DA-INVENT automaticamente dentro al CT? (s/n) [n]: " do_install
  do_install="${do_install:-n}"

  if [[ "$do_install" =~ ^[sSyY] ]]; then
    local giturl
    giturl=$(prompt "$DEFAULT_GIT_URL" "URL repository Git")
    info "Attesa avvio OS nel CT (max ~120s)..."
    local n=0
    until pct exec "$vmid" -- test -x /usr/bin/apt-get 2>/dev/null; do
      sleep 3
      n=$((n + 3))
      [[ "$n" -lt 120 ]] || { warn "Timeout: installa manualmente con pct enter $vmid"; exit 0; }
    done
    sleep 5

    ensure_ct_dns_for_apt "$vmid"

    info "Aggiornamento pacchetti e strumenti minimi per il clone Git (apt completo in install.sh)..."
    pct exec "$vmid" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq git curl ca-certificates"

    info "Clone, build e servizio systemd (può richiedere diversi minuti)..."
    pct exec "$vmid" -- env DA_INV_REPO="$giturl" bash -ce '
      set -e
      rm -rf /opt/da-invent
      git clone --depth 1 "$DA_INV_REPO" /opt/da-invent
      cd /opt/da-invent
      chmod +x scripts/install.sh
      ./scripts/install.sh --systemd
    ' || die "Installazione automatica fallita. Entra con: pct enter $vmid"

    info "Servizio systemd (se installato): pct exec $vmid -- systemctl status da-invent"
  fi

  echo ""
  echo -e "${GREEN}=== Riepilogo ===${NC}"
  echo "  VMID:       $vmid"
  echo "  Hostname:   $hostname"
  echo "  Rete:       $net0"
  echo "  Privilegi:  $priv_label"
  echo ""
  echo "Comandi utili:"
  echo "  pct enter $vmid              # shell root nel container"
  echo "  pct console $vmid            # console se necessario"
  echo "  ip del CT:   pct exec $vmid -- hostname -I"
  echo "  Aggiorna app: dal clone sul nodo: ./scripts/pct-update.sh $vmid"
  echo ""
  if [[ ! "$do_install" =~ ^[sSyY] ]]; then
    echo "Installazione manuale DA-INVENT nel CT:"
    echo "  pct enter $vmid"
    echo "  Opzione A — bootstrap (scarica repo + install.sh completo):"
    echo "    apt update && apt install -y curl ca-certificates"
    echo "    curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-linux.sh -o /tmp/da-bl.sh && bash /tmp/da-bl.sh"
    echo "  Opzione B — clone manuale:"
    echo "    apt update && apt install -y git curl ca-certificates"
    echo "    git clone $DEFAULT_GIT_URL /opt/da-invent && cd /opt/da-invent"
    echo "    chmod +x scripts/install.sh && ./scripts/install.sh --systemd"
    echo ""
  fi
}

main "$@"
