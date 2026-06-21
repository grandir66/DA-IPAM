/**
 * URL download ufficiali GLPI Agent (GitHub releases).
 * Aggiornare GLPI_AGENT_VERSION ad ogni bump release.
 */
export const GLPI_AGENT_VERSION = "1.17";

const BASE = `https://github.com/glpi-project/glpi-agent/releases/download/${GLPI_AGENT_VERSION}`;

export interface GlpiDownloadEntry {
  id: string;
  label: string;
  url: string;
  note?: string;
}

export interface GlpiClientDownloads {
  version: string;
  releasesPage: string;
  documentation: string;
  windows: GlpiDownloadEntry[];
  linux: GlpiDownloadEntry[];
  macos: GlpiDownloadEntry[];
}

export function getGlpiClientDownloads(): GlpiClientDownloads {
  return {
    version: GLPI_AGENT_VERSION,
    releasesPage: `https://github.com/glpi-project/glpi-agent/releases/tag/${GLPI_AGENT_VERSION}`,
    documentation: "https://glpi-agent.readthedocs.io/en/latest/installation/",
    windows: [
      {
        id: "msi-x64",
        label: "Windows MSI (x64)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}-x64.msi`,
        note: "Consigliato — installazione silenziosa via script",
      },
      {
        id: "zip-x64",
        label: "Windows portable (x64 zip)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}-x64.zip`,
      },
    ],
    linux: [
      {
        id: "linux-installer",
        label: "Installer universale (.pl)",
        url: `${BASE}/glpi-agent-${GLPI_AGENT_VERSION}-linux-installer.pl`,
        note: "Debian/Ubuntu/RHEL — consigliato",
      },
      {
        id: "deb-inventory",
        label: "Debian/Ubuntu .deb (solo Inventory)",
        url: `${BASE}/glpi-agent_${GLPI_AGENT_VERSION}-1_all.deb`,
      },
      {
        id: "rpm-inventory",
        label: "RPM (solo Inventory)",
        url: `${BASE}/glpi-agent-${GLPI_AGENT_VERSION}-1.noarch.rpm`,
      },
      {
        id: "appimage",
        label: "AppImage x86_64",
        url: `${BASE}/glpi-agent-${GLPI_AGENT_VERSION}-x86_64.AppImage`,
      },
    ],
    macos: [
      {
        id: "pkg-arm64",
        label: "macOS Apple Silicon (.pkg)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}_arm64.pkg`,
      },
      {
        id: "pkg-x86_64",
        label: "macOS Intel (.pkg)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}_x86_64.pkg`,
      },
      {
        id: "dmg-arm64",
        label: "macOS Apple Silicon (.dmg)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}_arm64.dmg`,
      },
      {
        id: "dmg-x86_64",
        label: "macOS Intel (.dmg)",
        url: `${BASE}/GLPI-Agent-${GLPI_AGENT_VERSION}_x86_64.dmg`,
      },
    ],
  };
}

export type InventoryInstallPlatform = "windows" | "linux" | "macos";
