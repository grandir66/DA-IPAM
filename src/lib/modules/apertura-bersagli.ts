/**
 * Quali interfacce prova la verifica «apertura per il browser» di ciascun modulo,
 * e con quale URL (passo 4b, 16/10/2026). Gli URL vengono dalle STESSE funzioni
 * che usano la Launchpad e il viewer: si prova quello che il browser apre davvero.
 *
 * Chiamata solo per moduli accesi (`verificaAperturaModulo` in `health.ts`
 * controlla prima `off`): qui nessun interruttore.
 */
import { getTenantDb } from "@/lib/db-tenant";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { applianceHostPubblici, isInternalIntegrationUrl } from "@/lib/integrations/public-url";
import {
  resolveEdgeBrowserUrl,
  resolveIntegrationBrowserUrl,
  resolveWazuhBrowserUrl,
} from "@/lib/integrations/public-url-server";
import {
  librenmsAutologinCookieHeader,
  librenmsAutologinEnabled,
  librenmsHostAllineabili,
  librenmsSvuotaSessioniAccesso,
} from "@/lib/integrations/librenms-proxy-auth";
import { allineaHostLibreNMS } from "@/lib/integrations/librenms-accesso";
import { getMeshConfig } from "@/lib/integrations/meshcentral/config";
import { listControllerViews } from "@/lib/controllers/service";
import { senzaUrl, verificaApertura, type VerificaApertura } from "./apertura-browser";
import type { ModuleKey } from "./registry";

interface Bersaglio {
  etichetta: string;
  url: string | null | undefined;
  modo: "scheda" | "riquadro";
  /** Testo quando l'URL manca. */
  senzaUrl: string;
}

async function prova(b: Bersaglio, origine: string | null): Promise<VerificaApertura> {
  const url = b.url?.trim() ?? "";
  if (!url) return senzaUrl(b.etichetta, "", b.modo, b.senzaUrl);
  if (isInternalIntegrationUrl(url)) {
    return senzaUrl(
      b.etichetta,
      url,
      b.modo,
      `L'indirizzo ${url} è interno (rete Docker o loopback): il browser non lo raggiunge. ${b.senzaUrl}`,
    );
  }
  return verificaApertura({ etichetta: b.etichetta, url, modo: b.modo, loginProprio: true, origineDaIpam: origine });
}

function hostDi(origine: string | null): string | null {
  if (!origine) return null;
  try {
    return new URL(origine).hostname;
  } catch {
    return null;
  }
}

// ── LibreNMS: interfaccia + accesso automatico ───────────────────────────────

async function accessoAutomaticoLibreNMS(browserUrl: string, origine: string | null): Promise<VerificaApertura> {
  const etichetta = "Accesso automatico a LibreNMS (admin)";
  const base = { etichetta, url: browserUrl, modo: "scheda" as const };
  const host = allineaHostLibreNMS(browserUrl, hostDi(origine), librenmsHostAllineabili());
  if (!host.ok) {
    return {
      ...base,
      esito: "login_richiesto",
      problemi: ["login_richiesto"],
      spiegazione:
        `DA-IPAM è aperto come ${host.hostDaIpam} e LibreNMS sta su ${host.hostLibreNMS}: il cookie ` +
        `dell'accesso automatico resta sul primo nome e LibreNMS chiede il login. Apri DA-IPAM come ${host.hostLibreNMS}.`,
    };
  }
  const cookie = await librenmsAutologinCookieHeader();
  if (!cookie) {
    return {
      ...base,
      esito: "login_richiesto",
      problemi: ["login_richiesto"],
      spiegazione:
        "LibreNMS rifiuta il login automatico con la password admin salvata (la risposta riporta al login): " +
        "verificala in Impostazioni → Moduli → LibreNMS.",
    };
  }
  const v = await verificaApertura({
    etichetta,
    url: host.url,
    modo: "scheda",
    loginProprio: false,
    cookie,
    ignoraCertificato: true,
  });
  // La sessione in cache non apre più LibreNMS: via dalla cache, la prossima
  // apertura rifà il login invece di riusarla fino a 45 minuti.
  if (v.esito === "login_richiesto") librenmsSvuotaSessioniAccesso();
  const note: string[] = [];
  if (host.cambiato) note.push(`L'accesso automatico porta a LibreNMS come ${new URL(host.url).host}, il nome con cui è aperto DA-IPAM.`);
  if (v.certificato && v.certificato.erroreCatena) {
    note.push("Il login automatico avviene senza verificare il certificato di LibreNMS (autofirmato dell'appliance): confronta l'impronta qui sopra.");
  }
  return note.length ? { ...v, spiegazione: `${v.spiegazione} ${note.join(" ")}` } : v;
}

async function verificheLibreNMS(origine: string | null): Promise<VerificaApertura[]> {
  const cfg = getIntegrationConfig("librenms");
  const browserUrl = resolveIntegrationBrowserUrl("librenms", cfg.url);
  const interfaccia = prova(
    {
      etichetta: "Interfaccia LibreNMS (7443)",
      url: browserUrl,
      modo: "riquadro",
      senzaUrl: "Imposta l'URL per il browser di LibreNMS (nginx :7443) in Impostazioni → Moduli.",
    },
    origine,
  );
  if (!browserUrl || isInternalIntegrationUrl(browserUrl) || !librenmsAutologinEnabled()) return [await interfaccia];
  return Promise.all([interfaccia, accessoAutomaticoLibreNMS(browserUrl, origine)]);
}

// ── MeshCentral: console e sessione nel riquadro ─────────────────────────────

/**
 * Riquadro di MeshCentral bloccato: si dice che non è il certificato e quali
 * origini MeshCentral deve ammettere, cioè quella con cui è aperto DA-IPAM adesso
 * più quelle dichiarate dall'appliance. `allowedFramingOrigins` lo scrive
 * l'installatore (Deploy-Appliance `modules/meshcentral.sh`), non DA-IPAM.
 */
export function conOriginiDaAmmettere(v: VerificaApertura, hostAppliance: string[]): VerificaApertura {
  if (!v.problemi.includes("iframe_bloccato")) return v;
  const daAmmettere = [
    ...new Set([...(v.origineDaIpam ? [v.origineDaIpam] : []), ...hostAppliance.map((h) => `https://${h}`)]),
  ];
  return {
    ...v,
    originiDaAmmettere: daAmmettere,
    spiegazione:
      `${v.spiegazione} Non è il certificato: MeshCentral rifiuta di essere incorporato da questa origine. ` +
      `Sull'appliance, \`allowedFramingOrigins\` di MeshCentral deve contenere: ${daAmmettere.join(", ")} ` +
      "(lo scrive l'installatore dell'appliance).",
  };
}

async function verificheMeshCentral(origine: string | null): Promise<VerificaApertura[]> {
  const url = getMeshConfig()?.serverUrl ?? null;
  const v = await prova(
    {
      etichetta: "MeshCentral (console e sessione remota nel riquadro)",
      url,
      modo: "riquadro",
      senzaUrl: "MeshCentral acceso ma senza URL del server.",
    },
    origine,
  );
  return [conOriginiDaAmmettere(v, applianceHostPubblici())];
}

// ── Elenco per modulo ────────────────────────────────────────────────────────

/** Le verifiche di apertura di un modulo acceso, in parallelo. Mai lancia per un URL. */
export async function verificheAperturaDelModulo(
  key: ModuleKey,
  tenantCode: string,
  origine: string | null,
): Promise<VerificaApertura[]> {
  switch (key) {
    case "edge": {
      const row = getTenantDb(tenantCode)
        .prepare("SELECT base_url FROM vuln_scanners ORDER BY id LIMIT 1")
        .get() as { base_url: string } | undefined;
      return [
        await prova(
          {
            etichetta: "Interfaccia dello Scanner-Edge (6443)",
            url: row ? resolveEdgeBrowserUrl(row.base_url) : null,
            modo: "scheda",
            senzaUrl: "Nessun URL per il browser: manca la voce dell'edge nelle credenziali di sistema (Impostazioni → Moduli) e l'host pubblico dell'appliance.",
          },
          origine,
        ),
      ];
    }
    case "librenms":
      return verificheLibreNMS(origine);
    case "graylog": {
      const cfg = getIntegrationConfig("graylog");
      return [
        await prova(
          {
            etichetta: "Interfaccia Graylog (9443)",
            url: resolveIntegrationBrowserUrl("graylog", cfg.url),
            modo: "riquadro",
            senzaUrl: "Imposta l'URL per il browser di Graylog (nginx :9443) o la voce nelle credenziali di sistema (Impostazioni → Moduli).",
          },
          origine,
        ),
      ];
    }
    case "wazuh":
      return [
        await prova(
          {
            etichetta: "Dashboard Wazuh (8443)",
            url: resolveWazuhBrowserUrl(),
            modo: "scheda",
            senzaUrl: "Nessuna voce Wazuh nelle credenziali di sistema (Impostazioni → Moduli) e nessun host pubblico dell'appliance.",
          },
          origine,
        ),
      ];
    case "meshcentral":
      return verificheMeshCentral(origine);
    case "unifi": {
      const accesi = listControllerViews().filter((c) => c.enabled && c.kind !== "omada");
      return Promise.all(
        accesi.map((c) =>
          prova(
            { etichetta: `Console del controller «${c.name}»`, url: c.url, modo: "scheda", senzaUrl: "Controller senza URL." },
            origine,
          ),
        ),
      );
    }
    default:
      return [];
  }
}
