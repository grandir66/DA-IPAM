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
  echo "" >&2
  echo "$title" >&2
  echo "(tipo contenuto Proxmox: $content)" >&2
  echo "$raw" | nl -w2 -s') ' >&2
  local num
  read -r -p "Numero storage [1]: " num
  num="${num:-1}"
  local name
  name=$(echo "$raw" | sed -n "${num}p" | awk '{print $1}')
  [[ -n "$name" ]] || die "Selezione storage non valida."
  echo "$name"
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
  local s1 s2
  read -r -s -p "$msg: " s1
  echo ""
  read -r -s -p "Ripeti la password: " s2
  echo ""
  [[ "$s1" == "$s2" ]] || die "Le password non coincidono."
  [[ -n "$s1" ]] || die "Password vuota non consentita."
  echo "$s1"
}

list_bridges() {
  echo "Bridge rilevati sul nodo (usa quello a cui è collegata la LAN o il Wi‑Fi già configurato come bridge, es. vmbr0):"
  local found=0
  while read -r line; do
    [[ -z "$line" ]] && continue
    echo "  - $line"
    found=1
  done < <(ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2}' | sed 's/@.*//' || true)
  if [[ "$found" -eq 0 ]]; then
    warn "Nessun bridge rilevato via ip. Controlla /etc/network/interfaces (vmbr0, vmbr1, …)."
  fi
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

pick_template_storage() {
  pick_numbered_storage vztmpl "Storage per i template LXC (dove risiedono i .tar.zst / download pveam)"
}

# Se non ci sono template sullo storage: elenco da pveam available e scelta numerata → solo nome file .tar.*
pick_available_template_filename() {
  info "Aggiornamento indice template (pveam update)…"
  pveam update || true
  local avail
  avail=$(pveam available --section system 2>/dev/null | grep -E '\.(tar\.zst|tar\.gz|tar\.xz)(\s|$)' || true)
  if [[ -z "$(echo "$avail" | tr -d '[:space:]')" ]]; then
    die "Nessun template in 'pveam available'. Verifica la connessione Internet del nodo Proxmox."
  fi
  local filtered
  filtered=$(echo "$avail" | grep -iE 'debian|ubuntu' || echo "$avail")
  echo "" >&2
  echo "Template scaricabili (sezione system). Debian/Ubuntu consigliati per DA-INVENT:" >&2
  echo "$filtered" | nl -w3 -s') ' >&2
  echo "" >&2
  read -r -p "Numero riga del template da scaricare [1]: " num
  num="${num:-1}"
  local line
  line=$(echo "$filtered" | sed -n "${num}p")
  [[ -n "$line" ]] || die "Selezione template non valida."
  local tname
  tname=$(echo "$line" | grep -oE '[a-zA-Z0-9._+-]+\.(tar\.zst|tar\.gz|tar\.xz)' | tail -1)
  [[ -n "$tname" ]] || die "Impossibile ricavare il nome archivio dalla riga selezionata."
  echo "$tname"
}

pick_template() {
  local tpl_stor
  tpl_stor=$(pick_template_storage)
  info "Template disponibili su storage '$tpl_stor' (pveam list):"
  local lines
  lines=$(list_templates_on_storage "$tpl_stor")
  if [[ -z "$(echo "$lines" | tr -d '[:space:]')" ]]; then
    warn "Nessun template sullo storage '$tpl_stor'. Scelta da catalogo e download."
    local tname
    tname=$(pick_available_template_filename)
    info "Download su storage '$tpl_stor' (può richiedere alcuni minuti)…"
    pveam download "$tpl_stor" "$tname" || die "Download template fallito."
    echo "$tpl_stor|$tname"
    return
  fi

  echo "$lines" | nl -w2 -s') ' >&2
  local num
  read -r -p "Numero riga del template da usare [1]: " num
  num="${num:-1}"
  local file
  file=$(echo "$lines" | sed -n "${num}p" | awk '{print $1}')
  [[ -n "$file" ]] || die "Selezione template non valida."
  file=$(normalize_template_filename "$file")
  [[ -n "$file" ]] || die "Nome template non valido dopo normalizzazione."
  echo "$tpl_stor|$file"
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
  echo ""

  # --- OS / template ---
  info "1) Sistema operativo (template LXC)"
  warn "L'installer DA-INVENT nello script install.sh supporta Debian/Ubuntu (apt)."
  local tpl_pick tpl_storage ostemplate
  tpl_pick=$(pick_template)
  [[ "$tpl_pick" == *"|"* ]] || die "Selezione template non valida."
  tpl_storage="${tpl_pick%%|*}"
  ostemplate="${tpl_pick#*|}"
  [[ -n "$ostemplate" ]] || die "Nome file template vuoto."

  # --- CT ID ---
  local def_id
  def_id=$(suggest_ctid)
  local vmid
  vmid=$(prompt "$def_id" "2) ID numerico del container (VMID / CTID)")
  [[ "$vmid" =~ ^[0-9]+$ ]] || die "L'ID deve essere numerico."
  ctid_in_use "$vmid" && die "L'ID $vmid è già in uso."

  # --- Hostname ---
  local hostname
  hostname=$(prompt "da-invent" "3) Hostname del container")
  [[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die "Hostname non valido."

  # --- Resources ---
  local cores mem disk
  cores=$(prompt "2" "4) Numero di core CPU")
  mem=$(prompt "2048" "5) RAM (MiB)")
  disk=$(prompt "16" "6) Disco root (GB)")

  local storage
  storage=$(pick_storage)

  # --- Network ---
  info "7) Rete"
  list_bridges
  local bridge
  bridge=$(prompt "vmbr0" "   Nome bridge (es. vmbr0 per LAN, o il bridge dove hai messo il Wi‑Fi)")

  local vlan_ask
  vlan_ask=$(prompt "" "   VLAN tag (opzionale, Invio = nessuna)")
  local vlan=""
  if [[ -n "$vlan_ask" ]]; then
    [[ "$vlan_ask" =~ ^[0-9]+$ ]] || die "VLAN deve essere numerica."
    vlan="$vlan_ask"
  fi

  local ipmode
  echo ""
  echo "   Modalità indirizzo IP:"
  echo "     1) DHCP"
  echo "     2) Statico"
  read -r -p "   Scelta [1]: " ipmode
  ipmode="${ipmode:-1}"
  local static_ip="" static_gw=""
  if [[ "$ipmode" == "2" ]]; then
    read -r -p "   Indirizzo IPv4 con CIDR (es. 192.168.1.50/24): " static_ip
    read -r -p "   Gateway (es. 192.168.1.1): " static_gw
  fi
  local net0
  net0=$(build_net0 "$bridge" "$vlan" "$([[ "$ipmode" == "2" ]] && echo static || echo dhcp)" "$static_ip" "$static_gw")

  # --- Privileged (nmap) ---
  echo ""
  warn "Per scansioni nmap/ping affidabili, un container privilegiato è spesso necessario."
  local priv
  read -r -p "8) Container privilegiato? (s/n) [s]: " priv
  priv="${priv:-s}"
  local unpriv_flag="--unprivileged 1"
  local priv_label="no (unprivileged)"
  if [[ "$priv" =~ ^[sSyY] ]]; then
    unpriv_flag="--unprivileged 0"
    priv_label="sì (consigliato per nmap)"
  fi

  # --- Password ---
  echo ""
  info "9) Password utente root nel container"
  local rootpw
  rootpw=$(prompt_secret "Password root")

  # --- Create ---
  info "Creazione container $vmid (template ${tpl_storage}:vztmpl/${ostemplate})..."
  pct create "$vmid" "${tpl_storage}:vztmpl/${ostemplate}" \
    --hostname "$hostname" \
    --memory "$mem" \
    --cores "$cores" \
    --rootfs "${storage}:${disk}" \
    --net0 "$net0" \
    --onboot 1 \
    $unpriv_flag \
    --password "$rootpw"

  info "Avvio container..."
  pct start "$vmid"

  echo ""
  info "Container $vmid avviato (hostname: $hostname)."
  echo ""

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

    info "Aggiornamento pacchetti e installazione dipendenze base..."
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
  echo ""
  if [[ ! "$do_install" =~ ^[sSyY] ]]; then
    echo "Installazione manuale DA-INVENT nel CT:"
    echo "  pct enter $vmid"
    echo "  apt update && apt install -y git curl"
    echo "  git clone $DEFAULT_GIT_URL /opt/da-invent && cd /opt/da-invent"
    echo "  chmod +x scripts/install.sh && ./scripts/install.sh --systemd"
    echo ""
  fi
}

main "$@"
