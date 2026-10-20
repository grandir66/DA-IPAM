"use client";

/**
 * «Verifica» di un modulo su due righe distinte: «API» (la sonda di sempre) e
 * «Apertura per il browser» (passo 4b, 16/10/2026): certificato, nome, date,
 * login, riquadro bloccato, con la spiegazione e, finché non c'è la CA interna
 * di DA-Link, l'impronta SHA-256 da confrontare quando si accetta il certificato.
 */
import { useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";
import type { AperturaModulo, ModuleHealth, ModuleHealthVerdict } from "@/lib/modules/health";
import type { EsitoApertura, VerificaApertura } from "@/lib/modules/apertura-browser";
import type { ModuleKey } from "@/lib/modules/registry";
import { useUrlPerBrowser } from "@/components/shared/url-per-browser";

// Copia client-safe di ETICHETTA_ESITO / ESITI_CERTIFICATO (il motore importa node:tls).
const ETICHETTA: Record<EsitoApertura, string> = {
  ok: "Si apre",
  certificato_non_fidato: "Certificato non fidato",
  nome_errato: "Nome del certificato errato",
  scaduto: "Certificato scaduto",
  login_richiesto: "Chiede il login",
  iframe_bloccato: "Riquadro bloccato",
  risposta_api: "Risponde un'API, non l'interfaccia",
  errore_http: "Errore HTTP",
  non_raggiungibile: "Non raggiungibile",
  senza_url: "Nessun indirizzo",
};
const DI_CERTIFICATO: readonly EsitoApertura[] = ["certificato_non_fidato", "nome_errato", "scaduto"];

const VERDETTO_API: Record<ModuleHealthVerdict, { testo: string; classe: string }> = {
  ok: { testo: "Connesso", classe: "bg-emerald-500" },
  degraded: { testo: "Degradato", classe: "bg-amber-500" },
  fail: { testo: "Non connesso", classe: "bg-red-500" },
  off: { testo: "Spento", classe: "bg-muted-foreground/40" },
  unverified: { testo: "Locale, non verificato", classe: "bg-primary/50" },
};

function classeEsito(e: EsitoApertura): string {
  if (e === "ok") return "bg-emerald-500";
  if (DI_CERTIFICATO.includes(e)) return "bg-amber-500";
  return "bg-red-500";
}

/** Elenco degli esiti di apertura: riusato dalla pagina del modulo e dalla sessione RMM. */
export function EsitiApertura({ verifiche }: { verifiche: VerificaApertura[] }) {
  // Il certificato da accettare è quello del nome che il browser aprirà (21/10).
  const perBrowser = useUrlPerBrowser();
  return (
    <ul className="space-y-3">
      {verifiche.map((v) => (
        <li key={`${v.etichetta}|${v.url}`} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${classeEsito(v.esito)}`} />
            <span className="text-sm font-medium">{v.etichetta}</span>
            <span className="text-xs text-muted-foreground">— {ETICHETTA[v.esito]}</span>
            {v.problemi.length > 1 ? (
              <span className="text-xs text-muted-foreground">
                (anche: {v.problemi.slice(1).map((p) => ETICHETTA[p]).join(", ")})
              </span>
            ) : null}
          </div>
          {v.url ? <code className="block text-xs text-muted-foreground break-all">{v.url}</code> : null}
          <p className="text-xs text-muted-foreground">{v.spiegazione}</p>
          {v.certificato ? (
            <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium">
                {v.problemi.some((p) => DI_CERTIFICATO.includes(p)) ? (
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                )}
                Certificato {v.certificato.autofirmato ? "autofirmato" : `emesso da ${v.certificato.emittente || "—"}`}
              </div>
              <div>
                Impronta SHA-256: <code className="break-all">{v.certificato.impronta256}</code>
              </div>
              <div className="text-muted-foreground">
                Nomi: {v.certificato.nomi.length ? v.certificato.nomi.join(", ") : v.certificato.soggetto || "—"} · valido
                fino al {new Date(v.certificato.validoAl).toLocaleDateString("it-IT")}
              </div>
            </div>
          ) : null}
          {v.istruzioneCertificato ? (
            <div className="space-y-1.5">
              <p className="text-xs">{v.istruzioneCertificato}</p>
              <a href={perBrowser(v.url)} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Apri e accetta il certificato
                </Button>
              </a>
            </div>
          ) : null}
          {v.originiAmmesse?.length ? (
            <p className="text-xs text-muted-foreground">
              Origini ammesse dall&apos;interfaccia: {v.originiAmmesse.join(", ")}
              {v.origineDaIpam ? ` · DA-IPAM è aperto come ${v.origineDaIpam}` : ""}
            </p>
          ) : null}
          {v.originiDaAmmettere?.length ? (
            <p className="text-xs">
              Da ammettere: <code className="break-all">{v.originiDaAmmettere.join(" ")}</code>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Chiede la verifica di apertura per un modulo, con l'origine della pagina corrente. */
export async function chiediApertura(
  moduleKey: ModuleKey,
): Promise<{ ok: true; apertura: AperturaModulo } | { ok: false; message: string }> {
  const origine = typeof window !== "undefined" ? window.location.origin : "";
  const r = await fetchJson<{ apertura: AperturaModulo }>(
    `/api/modules/${moduleKey}/apertura?origine=${encodeURIComponent(origine)}`,
  );
  return r.ok ? { ok: true, apertura: r.data.apertura } : { ok: false, message: r.message };
}

/**
 * Riquadro «Verifica» nella pagina di configurazione del modulo: due righe
 * distinte, API e apertura per il browser. `isAdmin`: la riga API usa la
 * verifica forzata (POST, solo admin); per gli altri resta solo l'apertura.
 */
export function VerificaModulo({ moduleKey, isAdmin }: { moduleKey: ModuleKey; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [api, setApi] = useState<ModuleHealth | null>(null);
  const [apertura, setApertura] = useState<AperturaModulo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  async function verifica() {
    setBusy(true);
    setErrore(null);
    try {
      if (isAdmin) {
        const r = await fetchJson<{ health?: ModuleHealth[] }>("/api/modules/health", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: moduleKey }),
        });
        setApi(r.ok ? (r.data.health?.find((h) => h.key === moduleKey) ?? null) : null);
        if (!r.ok) setErrore(`API: ${r.message}`);
      }
      const a = await chiediApertura(moduleKey);
      if (a.ok) setApertura(a.apertura);
      else setErrore((prev) => (prev ? `${prev} · ` : "") + `Apertura: ${a.message}`);
    } finally {
      setBusy(false);
    }
  }

  const verdetto = api?.verdict ?? apertura?.verdettoApi ?? null;
  const dettaglio = api?.detail ?? apertura?.dettaglioApi ?? null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Verifica: API e apertura per il browser
        </div>
        <Button size="sm" variant="outline" onClick={() => void verifica()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          {busy ? "Verifico…" : "Verifica"}
        </Button>
      </div>
      {errore ? <p className="text-xs text-destructive">{errore}</p> : null}
      {verdetto ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-44 shrink-0 font-medium">API</span>
            <span className={`h-2 w-2 rounded-full shrink-0 ${VERDETTO_API[verdetto].classe}`} />
            <span className="text-xs text-muted-foreground">
              {VERDETTO_API[verdetto].testo}
              {dettaglio ? ` — ${dettaglio}` : ""}
            </span>
          </div>
        </div>
      ) : null}
      {apertura ? (
        <div className="flex gap-2 text-sm">
          <span className="w-44 shrink-0 font-medium">Apertura per il browser</span>
          <div className="min-w-0 flex-1">
            {apertura.stato === "spento" ? (
              <p className="text-xs text-muted-foreground">Modulo spento: nessuna verifica, nessuna chiamata.</p>
            ) : apertura.stato === "senza_interfaccia" ? (
              <p className="text-xs text-muted-foreground">Il modulo non ha un&apos;interfaccia propria da aprire.</p>
            ) : (
              <EsitiApertura verifiche={apertura.verifiche} />
            )}
          </div>
        </div>
      ) : !busy ? (
        <p className="text-xs text-muted-foreground">
          Prova l&apos;indirizzo che usa il browser, non solo l&apos;API: certificato, nome, scadenza, login e riquadro.
        </p>
      ) : null}
    </div>
  );
}
