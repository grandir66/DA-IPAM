/**
 * Script di install dell'AGENTE Wazuh per Linux / macOS (equivalente del
 * "Deploy new agent" del dashboard Wazuh). Punta al manager configurato
 * (getWazuhConfig). L'agente auto-arruola via authd :1515 e connette via :1514.
 *
 * Linux: repo apt/yum/dnf/zypper + `WAZUH_MANAGER` → installa l'ultima 4.x
 * (come il dashboard). macOS: .pkg versionato (≤ manager, così non va in 403
 * come l'URL MSI generico su Windows).
 */

/** Versione pkg macOS pinnata (≤ manager da-wazuh). */
const WAZUH_MACOS_PKG_VERSION = "4.14.5-1";

// hostname (con dot) o IPv4 — no injection nello script.
const SAFE_MANAGER_RE =
  /^(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d))$/;

export type WazuhAgentPlatform = "linux" | "macos";

export function isWazuhAgentPlatform(p: string): p is WazuhAgentPlatform {
  return p === "linux" || p === "macos";
}

export function buildWazuhAgentScript(platform: WazuhAgentPlatform, managerHost: string): string {
  const mgr = managerHost.trim();
  if (!SAFE_MANAGER_RE.test(mgr)) {
    throw new Error(`Manager Wazuh non valido: ${managerHost}`);
  }

  if (platform === "macos") {
    return `#!/bin/sh
# Wazuh Agent (macOS) — manager ${mgr}
set -e
if [ "$(id -u)" -ne 0 ]; then echo "Esegui come root: sudo sh questo-script.sh"; exit 1; fi
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  PKG="wazuh-agent-${WAZUH_MACOS_PKG_VERSION}.arm64.pkg"
else
  PKG="wazuh-agent-${WAZUH_MACOS_PKG_VERSION}.intel64.pkg"
fi
echo ">>> Download $PKG"
curl -so /tmp/wazuh-agent.pkg "https://packages.wazuh.com/4.x/macos/$PKG"
echo "WAZUH_MANAGER='${mgr}'" > /tmp/wazuh_envs
echo ">>> Install"
installer -pkg /tmp/wazuh-agent.pkg -target /
rm -f /tmp/wazuh-agent.pkg /tmp/wazuh_envs
/Library/Ossec/bin/wazuh-control start
echo ">>> OK — agente installato, manager ${mgr}. Comparira' in da-wazuh entro ~1 min."
`;
  }

  // Linux: apt / yum / dnf / zypper. Installa l'ultima 4.x (come il dashboard).
  return `#!/bin/sh
# Wazuh Agent (Linux) — manager ${mgr}
set -e
if [ "$(id -u)" -ne 0 ]; then echo "Esegui come root/sudo"; exit 1; fi
MGR='${mgr}'
if command -v apt-get >/dev/null 2>&1; then
  echo ">>> APT"
  curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
  chmod 644 /usr/share/keyrings/wazuh.gpg
  echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list
  apt-get update
  # Recupera uno stato dpkg interrotto (E: dpkg was interrupted) da operazioni apt
  # precedenti sull'host, altrimenti apt-get install rifiuta di procedere. Non
  # distruttivo: completa solo i configure lasciati a metà.
  dpkg --configure -a || true
  apt-get install -f -y || true
  WAZUH_MANAGER="$MGR" apt-get install -y wazuh-agent
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  echo ">>> YUM/DNF"
  rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH
  cat > /etc/yum.repos.d/wazuh.repo <<'REPO'
[wazuh]
gpgcheck=1
gpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH
enabled=1
name=Wazuh repository
baseurl=https://packages.wazuh.com/4.x/yum/
protect=1
REPO
  if command -v dnf >/dev/null 2>&1; then PM=dnf; else PM=yum; fi
  WAZUH_MANAGER="$MGR" $PM install -y wazuh-agent
elif command -v zypper >/dev/null 2>&1; then
  echo ">>> ZYPPER"
  rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH
  cat > /etc/zypp/repos.d/wazuh.repo <<'REPO'
[wazuh]
gpgcheck=1
gpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH
enabled=1
name=Wazuh repository
baseurl=https://packages.wazuh.com/4.x/yum/
REPO
  WAZUH_MANAGER="$MGR" zypper --non-interactive install wazuh-agent
else
  echo "Package manager non supportato (apt/yum/dnf/zypper)"; exit 1
fi
systemctl daemon-reload 2>/dev/null || true
systemctl enable wazuh-agent 2>/dev/null || true
systemctl start wazuh-agent 2>/dev/null || service wazuh-agent start 2>/dev/null || true
echo ">>> OK — Wazuh agent installato, manager $MGR. Comparira' in da-wazuh entro ~1 min."
`;
}
