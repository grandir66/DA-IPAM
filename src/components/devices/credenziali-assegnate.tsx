"use client";

/**
 * Scheda apparato e liste (tappa 5, 21/10): le credenziali che il motore usa davvero con l'esito
 * dell'ultima prova, il badge «senza credenziale provata», la classificazione «scelta a mano»
 * (lucchetto) con «Torna automatica» e i ruoli del server. Stati con segno e parola, mai solo
 * il colore: Riccardo è daltonico.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { BadgeAvviso, BadgeEsito, type StatoEsito } from "@/components/devices/rendi-apparato-esito";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { righeAssegnate, senzaCredenzialeProvata, type BindingPerEsito } from "@/lib/devices/credenziali-assegnate";
import { nomeFonteUsata, type UsataAdesso } from "@/lib/devices/usata-adesso";
import { ETICHETTE_RUOLI, RUOLI_SERVER, type RuoloServer } from "@/lib/classification/canonico";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Lucchetto chiuso, disegnato (niente emoji): accanto a una parola resta leggibile a 12-14 px. */
export function LucchettoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/** «scelta a mano» (scheda) o «a mano» (liste, piccolo): grigio con lucchetto e parola. */
export function BadgeAMano({ piccolo = false, className }: { piccolo?: boolean; className?: string }) {
  return (
    <span
      title="Classificazione scelta a mano: le scansioni non la cambiano"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold leading-tight",
        piccolo ? "px-1.5 py-0 text-[13px]" : "min-h-[26px] border-2 px-2.5 py-0.5 text-[13px]",
        STILE_STATO.da_verificare.classi,
        className,
      )}
    >
      <LucchettoIcon />
      {piccolo ? "a mano" : "scelta a mano"}
    </span>
  );
}

/** «▲ senza credenziale provata»; `corto` per le liste. */
export function BadgeSenzaProva({ corto = false }: { corto?: boolean }) {
  return (
    <BadgeAvviso className={corto ? "min-h-0 px-1.5 py-0" : undefined}>
      {corto ? "senza cred. provata" : "senza credenziale provata"}
    </BadgeAvviso>
  );
}

const STATO_BADGE: Record<"riuscita" | "rifiutata" | "non_provata", StatoEsito> = {
  riuscita: "riuscita",
  rifiutata: "rifiutata",
  non_provata: "non_provata",
};

export function CredenzialiAssegnate({
  deviceId,
  usate,
  versione,
  versioneSnmp,
  onSenzaProva,
  onCambia,
}: {
  deviceId: number;
  usate: readonly UsataAdesso[];
  /** Cambia quando la tabella dei binding sotto è stata modificata: si rileggono le prove. */
  versione: number;
  /** «v2c» se l'apparato parla SNMP a community e la versione è nota. */
  versioneSnmp?: string | null;
  onSenzaProva?: (senza: boolean) => void;
  onCambia?: () => void;
}) {
  const [bindings, setBindings] = useState<BindingPerEsito[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inProva, setInProva] = useState<number | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<BindingPerEsito[]>(`/api/devices/${deviceId}/credentials`, { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setBindings(r.data);
    onSenzaProva?.(senzaCredenzialeProvata(r.data));
  }, [deviceId, onSenzaProva]);

  useEffect(() => {
    void carica();
  }, [carica, versione]);

  async function provaAdesso(bindingId: number) {
    setInProva(bindingId);
    const r = await fetchJson<{ success?: boolean; message?: string; hint?: string }>(`/api/devices/${deviceId}/credentials`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: "test", binding_id: bindingId }),
    });
    setInProva(null);
    if (!r.ok) toast.error(`Errore nella prova: ${r.message}`);
    else if (r.data.success) toast.success(r.data.message ?? "Prova riuscita");
    else toast.error(r.data.message ?? "Prova non riuscita", r.data.hint ? { description: r.data.hint } : undefined);
    await carica();
  }

  if (errore) return <LoadError what="le credenziali assegnate" message={errore} onRetry={() => void carica()} />;
  if (!bindings) return <p className="text-sm text-muted-foreground">Carico le credenziali…</p>;

  const righe = righeAssegnate(usate, bindings, nomeFonteUsata, versioneSnmp);
  const senza = senzaCredenzialeProvata(bindings);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Key className="h-3.5 w-3.5" />
          Credenziali assegnate
        </p>
        {senza && <BadgeSenzaProva />}
      </div>
      <p className="text-[13px] text-muted-foreground">Quelle che il motore usa davvero su questo apparato, non la catena della rete.</p>
      {righe.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessuna credenziale assegnata.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] font-semibold text-muted-foreground">
                <th className="py-1.5 pr-3">Credenziale</th>
                <th className="py-1.5 pr-3">Per</th>
                <th className="py-1.5 pr-3">Ultimo esito</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.key} className="border-b last:border-0 align-middle">
                  <td className="py-2 pr-3 font-medium">
                    <span className="flex items-center gap-1.5">
                      {r.bindingId != null && <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {r.nome}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="block">{r.per}</span>
                    <span className="block text-[13px] text-muted-foreground">{r.nota}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <BadgeEsito esito={{ stato: inProva === r.bindingId && r.bindingId != null ? "in_corso" : STATO_BADGE[r.esito], quando: r.testedAt }} />
                  </td>
                  <td className="py-2 text-right">
                    <span className="inline-flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={r.bindingId == null || inProva != null}
                        title={r.bindingId == null ? "Nessuna credenziale dell'archivio da provare" : undefined}
                        onClick={() => r.bindingId != null && void provaAdesso(r.bindingId)}
                      >
                        Prova adesso
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={onCambia}>
                        Cambia
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {senza && <p className="text-[13px] text-muted-foreground">Resta finché una prova non riesce. Compare anche nelle liste.</p>}
    </div>
  );
}

/**
 * Classificazione dell'apparato: se è «scelta a mano» lo dice (lucchetto) e offre «Torna automatica»
 * (POST /api/classificazione/automatica: toglie il blocco, il valore resta fino alla prossima scansione).
 * Per i server mostra i ruoli, modificabili qui.
 */
export function ClassificazioneApparato({
  deviceId,
  classificazione,
  etichetta,
  aMano,
  ruoli,
  eServer,
  onCambiata,
}: {
  deviceId: number;
  classificazione: string;
  etichetta: string;
  aMano: boolean;
  ruoli: RuoloServer[];
  eServer: boolean;
  onCambiata: () => void;
}) {
  const [occupato, setOccupato] = useState(false);

  async function tornaAutomatica() {
    setOccupato(true);
    const r = await fetchJson<{ success: boolean }>("/api/classificazione/automatica", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ deviceId }),
    });
    setOccupato(false);
    if (!r.ok) {
      toast.error(`Errore: ${r.message}`);
      return;
    }
    toast.success("Classificazione automatica: la prossima scansione la rilegge");
    onCambiata();
  }

  async function alternaRuolo(ruolo: RuoloServer) {
    const prossimi = ruoli.includes(ruolo) ? ruoli.filter((x) => x !== ruolo) : [...ruoli, ruolo];
    setOccupato(true);
    // La classificazione si rimanda uguale: la rotta scrive i ruoli solo insieme ad essa (e la segna a mano).
    const r = await fetchJson<unknown>(`/api/devices/${deviceId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ classification: classificazione, server_roles: prossimi }),
    });
    setOccupato(false);
    if (!r.ok) {
      toast.error(`Errore: ${r.message}`);
      return;
    }
    onCambiata();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Classificazione</span>
        <span className="text-sm font-semibold">{etichetta}</span>
        {aMano && <BadgeAMano />}
        {aMano && (
          <Button type="button" size="sm" variant="outline" disabled={occupato} onClick={() => void tornaAutomatica()}>
            Torna automatica
          </Button>
        )}
      </div>
      {aMano && <p className="text-[13px] text-muted-foreground">Le scansioni non la cambiano. Vale anche sull&apos;IP nella subnet.</p>}
      {eServer && (
        <fieldset className="space-y-1.5">
          <legend className="text-[13px] font-semibold text-muted-foreground">Ruoli del server</legend>
          <div className="flex flex-wrap gap-2">
            {RUOLI_SERVER.map((r) => {
              const attivo = ruoli.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={attivo}
                  disabled={occupato}
                  onClick={() => void alternaRuolo(r)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border-2 px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60",
                    attivo ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]" : "border-[#B8C4CC] bg-background text-foreground hover:bg-muted",
                  )}
                >
                  <span aria-hidden>{attivo ? "✓" : "+"}</span>
                  {ETICHETTE_RUOLI[r]}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
