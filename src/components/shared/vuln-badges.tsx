import { Badge } from "@/components/ui/badge";
import { SOURCE_BADGE_STYLE, nvdCveUrl } from "@/lib/severity-style";

export function CveLink({ cve }: { cve: string | null | undefined }) {
  if (!cve) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={nvdCveUrl(cve)}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline font-mono text-xs"
    >
      {cve}
    </a>
  );
}

export function SourcesBadges({ sources }: { sources: string[] | undefined | null }) {
  if (!sources || sources.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((src) => (
        <Badge
          key={src}
          className={`text-[10px] px-1.5 py-0 ${SOURCE_BADGE_STYLE[src] ?? "bg-slate-600 text-white"}`}
        >
          {src}
        </Badge>
      ))}
    </div>
  );
}

/** Ciò che serve ai badge: la forma di `ExploitInfo` dell'archivio dei feed (lato server). */
export interface ExploitUi {
  kev: boolean;
  kev_data: string | null;
  ransomware: boolean;
  edb: number;
  edb_verificati: number;
  epss: number | null;
  epss_percentile: number | null;
}

function dataIt(iso: string | null): string {
  if (!iso) return "";
  const [a, m, g] = iso.split("-");
  return a && m && g ? `${g}/${m}/${a}` : iso;
}

/** EPSS in percentuale: «97,1%», «0,4%»; null = la CVE non è nel feed. */
export function formatEpss(epss: number | null | undefined): string {
  if (epss == null) return "—";
  return `${(epss * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Da 10% in su l'EPSS si scrive in grassetto: è il punto da cui conviene guardarla. */
export function EpssCell({ epss }: { epss: number | null | undefined }) {
  return (
    <span className={`font-mono text-xs ${epss != null && epss >= 0.1 ? "font-semibold" : "text-muted-foreground"}`}>
      {formatEpss(epss)}
    </span>
  );
}

const TRIANGOLO = (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1 11 10H1z" fill="currentColor" />
  </svg>
);
const QUADRATO = (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/**
 * Exploit noti di una vulnerabilità (22/10): «Sfruttata» (CISA KEV) pieno scuro con triangolo,
 * «R» se usata dai ransomware, «Exploit pubblico» (Exploit-DB) chiaro bordato con quadrato.
 * Luminanza e forma diverse, non solo il colore: Riccardo è daltonico.
 */
export function ExploitBadges({ exploit, compatto = false }: { exploit: ExploitUi | null | undefined; compatto?: boolean }) {
  if (!exploit || (!exploit.kev && exploit.edb === 0)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const misura = compatto ? "text-[13px] h-5 px-1.5" : "text-[13px] h-[22px] px-2";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {exploit.kev && (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-semibold whitespace-nowrap bg-red-950 text-white ring-1 ring-red-300/60 ${misura}`}
          title={`Sfruttata in attacchi reali: nel catalogo CISA KEV${exploit.kev_data ? ` dal ${dataIt(exploit.kev_data)}` : ""}`}
        >
          {TRIANGOLO}Sfruttata
        </span>
      )}
      {exploit.ransomware && (
        <span
          className={`inline-flex items-center rounded-md font-bold bg-red-950 text-white ring-1 ring-red-300/60 ${misura}`}
          title="Usata in campagne ransomware (CISA KEV)"
        >
          R
        </span>
      )}
      {exploit.edb > 0 && (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-semibold whitespace-nowrap bg-white text-red-950 border-2 border-red-950 ${misura}`}
          title={`Exploit pubblici in Exploit-DB: ${exploit.edb}${exploit.edb_verificati ? `, di cui ${exploit.edb_verificati} verificati` : ""}`}
        >
          {QUADRATO}Exploit pubblico{exploit.edb > 1 ? ` ×${exploit.edb}` : ""}
        </span>
      )}
    </div>
  );
}
