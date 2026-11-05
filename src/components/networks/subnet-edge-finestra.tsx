"use client";

/**
 * Scansione a finestra nel pannello VA Scan della rete (05/11/2026, Task 9).
 *
 * Tre pezzi, montati da `subnet-edge-scan-panel.tsx`:
 * - `useFinestra`: legge lo stato dalla sonda; ogni 30 secondi, solo a pannello aperto; si ferma alla
 *   chiusura; una risposta vecchia non copre una nuova; una lettura fallita si dice;
 * - `FinestraImpostazioni`: fascia, giorni, ripetizione, IP per gruppo, tentativi, profilo, stima;
 * - `FinestraAvanzamento`: barra, sei conteggi, gruppo in corso, stato, rapporti, elenco degli IP.
 *
 * Stati sempre con segno e parola (○ ▶ ✓ ▲ ✕ ◐), testo da 13 px: lo stato si legge anche senza i colori.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/shared/load-error";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import type { EdgeScanProfile, EdgeTargetingMode } from "@/lib/vuln/edge-subnet-bridge";
import {
  MINUTI_GRUPPO,
  SONDA_DA_AGGIORNARE,
  STATI_IP,
  barraAvanzamento,
  dalleItaliano,
  giornoItaliano,
  giornoOraItaliano,
  meseItaliano,
  oraItaliana,
  oreDellaFascia,
  passaLaMezzanotte,
  righeStato,
  stimaFinestra,
  testoDistanzaRitento,
  type DatiFinestra,
  type EsitoElencoIp,
  type IpFinestra,
  type PassaggioSonda,
  type RigaStato,
  type StatoFinestra,
  type StatoIp,
  type TonoStato,
} from "@/lib/vuln/finestra";

const INTERVALLO_LETTURA_MS = 30_000;
const RIGHE_PER_PAGINA = 50;

const PROFILI: Record<EdgeScanProfile, string> = { fast: "Veloce", balanced: "Bilanciato", deep: "Approfondito" };
const GIORNI: Array<{ n: number; nome: string }> = [
  { n: 1, nome: "Lun" },
  { n: 2, nome: "Mar" },
  { n: 3, nome: "Mer" },
  { n: 4, nome: "Gio" },
  { n: 5, nome: "Ven" },
  { n: 6, nome: "Sab" },
  { n: 0, nome: "Dom" },
];

// ── Lettura periodica ───────────────────────────────────────────────────────────────────────────

export interface FinestraLettura {
  /** L'ultimo stato letto bene (anche «da_aggiornare»: è una risposta della sonda). `null` finché non ne arriva uno. */
  dati: StatoFinestra | null;
  /** Lettura fallita: si dice. I `dati` restano quelli dell'ultima lettura riuscita, se ce n'è. */
  errore: string | null;
  /** Istante dell'ultima lettura riuscita. */
  lettaAt: number | null;
  caricando: boolean;
  rileggi: () => Promise<void>;
  /** Dopo un salvataggio o una cancellazione la risposta è già lo stato nuovo: lo si prende senza rileggere. */
  imposta: (s: StatoFinestra) => void;
}

/**
 * `attivo` = pannello aperto. Chiuso: niente intervallo, la richiesta in volo si annulla e la sua
 * risposta, se arrivasse, si scarta. Ogni lettura annulla la precedente e una risposta di una lettura
 * annullata non si guarda: vale solo l'ultima partita.
 */
export function useFinestra(networkId: number, attivo: boolean): FinestraLettura {
  const [dati, setDati] = useState<StatoFinestra | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [lettaAt, setLettaAt] = useState<number | null>(null);
  const [caricando, setCaricando] = useState(false);
  const richiesta = useRef<AbortController | null>(null);

  const rileggi = useCallback(async () => {
    richiesta.current?.abort();
    const ac = new AbortController();
    richiesta.current = ac;
    setCaricando(true);
    try {
      const res = await fetchJson<StatoFinestra>(`/api/networks/${networkId}/edge-scan/finestra`, { signal: ac.signal });
      if (ac.signal.aborted) return; // risposta vecchia: ne è partita una più nuova, o il pannello si è chiuso
      if (!res.ok) {
        setErrore(res.message);
      } else if (res.data.stato === "errore") {
        setErrore(res.data.messaggio);
      } else {
        setDati(res.data);
        setErrore(null);
        setLettaAt(Date.now());
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      if (!ac.signal.aborted) setErrore(e instanceof Error ? e.message : "Lettura non riuscita");
    } finally {
      if (!ac.signal.aborted) setCaricando(false);
    }
  }, [networkId]);

  const imposta = useCallback((s: StatoFinestra) => {
    richiesta.current?.abort();
    setCaricando(false);
    if (s.stato === "errore") {
      setErrore(s.messaggio);
      return;
    }
    setDati(s);
    setErrore(null);
    setLettaAt(Date.now());
  }, []);

  useEffect(() => {
    if (!attivo) return;
    void rileggi();
    const id = setInterval(() => void rileggi(), INTERVALLO_LETTURA_MS);
    return () => {
      clearInterval(id);
      richiesta.current?.abort();
    };
  }, [attivo, rileggi]);

  return { dati, errore, lettaAt, caricando, rileggi, imposta };
}

// ── Pezzi comuni ───────────────────────────────────────────────────────────────────────────────

const CLASSI_TONO: Record<TonoStato, string> = {
  neutro: "border-muted-foreground/50 bg-muted/60 text-foreground",
  attenzione: "border-warning-foreground/40 bg-warning/25 text-foreground",
  guasto: "border-destructive bg-destructive/10 text-foreground",
};

/** Una riga di stato: segno e parola nel testo, fondo e bordo per il tono. */
export function RigaMessaggio({ riga, className }: { riga: RigaStato; className?: string }) {
  return (
    <div
      role={riga.tono === "guasto" ? "alert" : "status"}
      className={cn("rounded-lg border px-3 py-2 text-sm", CLASSI_TONO[riga.tono], className)}
    >
      {riga.testo}
    </div>
  );
}

const ETICHETTA_CAMPO = "text-[13px] font-semibold";
const NOTA = "text-[13px] text-muted-foreground";

function Campo({ titolo, children, nota }: { titolo: string; children: ReactNode; nota?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className={ETICHETTA_CAMPO}>{titolo}</p>
      {children}
      {nota && <div className={NOTA}>{nota}</div>}
    </div>
  );
}

function Scelta({
  scelta,
  onClick,
  disabled,
  children,
  className,
}: {
  scelta: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={scelta ? "default" : "outline"}
      aria-pressed={scelta}
      onClick={onClick}
      disabled={disabled}
      className={cn("text-sm", scelta && "font-semibold", className)}
    >
      {children}
    </Button>
  );
}

// ── Impostazioni ───────────────────────────────────────────────────────────────────────────────

export interface ConteggiIp {
  full_subnet: number | null;
  found_ips: number | null;
  populated_24: number | null;
}

interface ImpostazioniProps {
  networkId: number;
  lettura: FinestraLettura;
  targetingMode: EdgeTargetingMode;
  conteggi: ConteggiIp;
  assessmentEnabled: boolean;
  assessmentProfileId: string | null;
  /** Errore di scelta dell'assessment (profilo mancante): se c'è, non si salva. */
  assessmentError: string | null;
  disabled?: boolean;
  /** La rete ha un orario fisso acceso: salvare la finestra lo spegne, e prima si chiede. */
  orarioAttivo: boolean;
  /** Dopo «Torna a orario fisso»: il pannello cambia modo. */
  onTornatoAOrario: () => void;
}

interface Modulo {
  giorni: number[];
  dalle: string;
  alle: string;
  ripeti: "mese" | "settimana";
  ipPerGruppo: string;
  tentativi: string;
  profile: EdgeScanProfile;
}

const MODULO_INIZIALE: Modulo = {
  giorni: [1, 2, 3],
  dalle: "08:00",
  alle: "20:00",
  ripeti: "mese",
  ipPerGruppo: "10",
  tentativi: "3",
  profile: "balanced",
};

function profiloDi(p: string): EdgeScanProfile {
  return p === "fast" || p === "deep" ? p : "balanced";
}

function intero(testo: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(testo.trim())) return null;
  const n = Number(testo);
  return n >= min && n <= max ? n : null;
}

export function FinestraImpostazioni({
  networkId,
  lettura,
  targetingMode,
  conteggi,
  assessmentEnabled,
  assessmentProfileId,
  assessmentError,
  disabled,
  orarioAttivo,
  onTornatoAOrario,
}: ImpostazioniProps) {
  const dati = lettura.dati?.stato === "ok" ? lettura.dati : null;
  const salvata = dati?.finestra ?? null;
  const [m, setM] = useState<Modulo>(MODULO_INIZIALE);
  const [toccato, setToccato] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [rifiuto, setRifiuto] = useState<string | null>(null);
  /** Avviso della sonda o di IPAM dopo un salvataggio riuscito: resta a schermo finché non si cambia qualcosa. */
  const [avvisoSalvataggio, setAvvisoSalvataggio] = useState<string | null>(null);

  // Il modulo parte da ciò che la sonda ha salvato, finché nessuno lo ha toccato.
  const chiaveSalvata = salvata ? `${salvata.aggiornata_at}|${salvata.dalle}|${salvata.alle}|${salvata.giorni.join(",")}` : null;
  useEffect(() => {
    if (toccato || !salvata) return;
    setM({
      giorni: salvata.giorni,
      dalle: salvata.dalle,
      alle: salvata.alle,
      ripeti: salvata.ripeti,
      ipPerGruppo: String(salvata.ip_per_gruppo),
      tentativi: String(salvata.tentativi),
      profile: profiloDi(salvata.profile),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `salvata` cambia identità a ogni lettura: conta il suo contenuto
  }, [chiaveSalvata, toccato]);

  const cambia = (parte: Partial<Modulo>) => {
    setToccato(true);
    setRifiuto(null);
    setAvvisoSalvataggio(null);
    setM((v) => ({ ...v, ...parte }));
  };

  const ipPerGruppo = intero(m.ipPerGruppo, 1, 20);
  const tentativi = intero(m.tentativi, 1, 10);
  const ore = oreDellaFascia(m.dalle, m.alle);

  // Gli IP della stima. Con «solo IP che rispondono» e nessun host noto la sonda scansiona tutta la rete.
  const ripiegaSullaRete = targetingMode === "found_ips" && conteggi.found_ips === 0;
  const ipStima = ripiegaSullaRete ? conteggi.full_subnet : conteggi[targetingMode];

  const stima = useMemo(() => {
    if (ipStima === null || ipPerGruppo === null || ore === null) return null;
    return stimaFinestra({ ip: ipStima, ipPerGruppo, minutiGruppo: MINUTI_GRUPPO[m.profile], oreCiclo: ore });
  }, [ipStima, ipPerGruppo, ore, m.profile]);

  const erroriModulo: string[] = [];
  if (m.giorni.length === 0) erroriModulo.push("Scegli almeno un giorno.");
  if (ore === null) erroriModulo.push("Scrivi gli orari come HH:MM.");
  else if (ore < 1) erroriModulo.push("La fascia deve durare almeno 1 ora.");
  if (ipPerGruppo === null) erroriModulo.push("Gli IP per gruppo vanno da 1 a 20.");
  if (tentativi === null) erroriModulo.push("I tentativi vanno da 1 a 10.");
  const eventualeErrore = assessmentError ?? erroriModulo[0] ?? null;

  async function salva() {
    if (eventualeErrore || ipPerGruppo === null || tentativi === null) {
      toast.error(eventualeErrore ?? "Controlla i campi della finestra");
      return;
    }
    if (orarioAttivo && !confirm("Spegne l'orario fisso di questa rete: da qui in poi la scansione segue solo la finestra. Continuare?")) return;
    setSalvando(true);
    setRifiuto(null);
    setAvvisoSalvataggio(null);
    try {
      const res = await fetchJson<{ ok: boolean; avviso: string | null; finestra: StatoFinestra }>(
        `/api/networks/${networkId}/edge-scan/finestra`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            giorni: m.giorni,
            dalle: m.dalle,
            alle: m.alle,
            ripeti: m.ripeti,
            ip_per_gruppo: ipPerGruppo,
            tentativi,
            profile: m.profile,
            targeting_mode: targetingMode,
            assessment_enabled: assessmentEnabled,
            assessment_profile_id: assessmentEnabled ? assessmentProfileId : null,
          }),
        },
      );
      if (!res.ok) {
        // Il motivo della sonda (400, 409) arriva intero: si mostra qui e resta a schermo.
        setRifiuto(res.message);
        if (res.body && typeof res.body === "object" && (res.body as { daAggiornare?: boolean }).daAggiornare) {
          lettura.imposta({ stato: "da_aggiornare" });
        }
        toast.error("Finestra non salvata");
        return;
      }
      setToccato(false);
      lettura.imposta(res.data.finestra);
      toast.success("Finestra salvata: la pianificazione a orario fisso di questa rete è spenta");
      if (res.data.avviso) {
        setAvvisoSalvataggio(res.data.avviso);
        toast.warning(res.data.avviso);
      }
    } finally {
      setSalvando(false);
    }
  }

  async function tornaAOrario() {
    if (!confirm("Cancellare la finestra? La sonda ferma il gruppo in corso e annulla il passaggio. La pianificazione a orario fisso resta spenta finché non la salvi.")) return;
    setSalvando(true);
    setRifiuto(null);
    try {
      const res = await fetchJson<{ ok: boolean; finestra: StatoFinestra }>(`/api/networks/${networkId}/edge-scan/finestra`, { method: "DELETE" });
      if (!res.ok) {
        setRifiuto(res.message); // 409: il gruppo non si ferma. Il motivo resta qui, la finestra pure.
        toast.error("Finestra non cancellata");
        return;
      }
      lettura.imposta(res.data.finestra);
      setToccato(false);
      toast.success("Finestra cancellata. Imposta e salva l'orario fisso per pianificare di nuovo.");
      onTornatoAOrario();
    } finally {
      setSalvando(false);
    }
  }

  // Stati della sonda che impediscono di impostare.
  if (lettura.dati === null) {
    if (lettura.errore) {
      return <LoadError what="la finestra dalla sonda" message={lettura.errore} onRetry={() => void lettura.rileggi()} />;
    }
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Lettura della finestra dalla sonda…
      </p>
    );
  }
  if (lettura.dati.stato === "da_aggiornare") {
    return <RigaMessaggio riga={{ tono: "neutro", testo: `● ${SONDA_DA_AGGIORNARE}` }} />;
  }
  if (lettura.dati.stato === "sonda_assente") {
    return <RigaMessaggio riga={{ tono: "guasto", testo: `✕ ${lettura.dati.messaggio}` }} />;
  }

  const stimaTesto = (() => {
    if (ipStima === null) return null;
    const parola = targetingMode === "found_ips" && !ripiegaSullaRete ? "IP noti" : "IP";
    if (ipStima === 0) return { tono: "neutro" as const, testo: "● Nessun IP da scansionare in questa rete." };
    if (stima === null) return { tono: "neutro" as const, testo: "● Completa i campi per vedere la stima." };
    const ripiego = ripiegaSullaRete ? " Nessun host noto: la sonda scansiona tutta la rete." : "";
    if (stima.basta) {
      return {
        tono: "ok" as const,
        testo: `✓ ${ipStima} ${parola} → circa ${stima.gruppi} gruppi, circa ${Math.max(1, Math.round(stima.ore))} ore: basta 1 giorno.${ripiego}`,
      };
    }
    return {
      tono: "attenzione" as const,
      testo: `▲ Non basta: ${ipStima} ${parola} in ${PROFILI[m.profile]}, servono circa ${stima.cicli} cicli.${ripiego}`,
    };
  })();

  return (
    <div className="space-y-4">
      {lettura.errore && (
        <RigaMessaggio
          riga={{ tono: "guasto", testo: `✕ Lettura dalla sonda non riuscita: ${lettura.errore}${lettura.lettaAt ? ` Quello che vedi è del ${oraItaliana(new Date(lettura.lettaAt).toISOString().slice(0, 19).replace("T", " "))}.` : ""}` }}
        />
      )}

      <Campo
        titolo="Fascia oraria, ora italiana"
        nota={
          m.dalle === m.alle ? undefined : ore !== null && passaLaMezzanotte(m.dalle, m.alle) ? (
            <>● Passa la mezzanotte: finisce alle {m.alle} del giorno dopo.</>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`fin-dalle-${networkId}`} className="text-sm">dalle</Label>
          <Input id={`fin-dalle-${networkId}`} type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={m.dalle} onChange={(e) => cambia({ dalle: e.target.value.trim() })} aria-invalid={oreDellaFascia(m.dalle, m.alle) === null || undefined} className="h-9 w-24 font-mono text-sm" disabled={salvando || disabled} />
          <Label htmlFor={`fin-alle-${networkId}`} className="text-sm">alle</Label>
          <Input id={`fin-alle-${networkId}`} type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={m.alle} onChange={(e) => cambia({ alle: e.target.value.trim() })} aria-invalid={oreDellaFascia(m.dalle, m.alle) === null || undefined} className="h-9 w-24 font-mono text-sm" disabled={salvando || disabled} />
        </div>
        {m.dalle === m.alle && m.dalle !== "" && (
          <RigaMessaggio riga={{ tono: "attenzione", testo: "▲ «Dalle» e «alle» sono uguali: la fascia dura 24 ore." }} />
        )}
      </Campo>

      <Campo titolo="Giorni">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Giorni">
          {GIORNI.map((g) => (
            <Scelta
              key={g.n}
              scelta={m.giorni.includes(g.n)}
              onClick={() => cambia({ giorni: m.giorni.includes(g.n) ? m.giorni.filter((x) => x !== g.n) : [...m.giorni, g.n].sort((a, b) => a - b) })}
              disabled={salvando || disabled}
              className="px-2.5"
            >
              {g.nome}
            </Scelta>
          ))}
        </div>
      </Campo>

      <Campo titolo="Ripeti" nota="Un passaggio nuovo parte solo quando è finito il precedente.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ripeti">
          <Scelta scelta={m.ripeti === "mese"} onClick={() => cambia({ ripeti: "mese" })} disabled={salvando || disabled}>
            {m.ripeti === "mese" ? "✓ " : ""}Ogni mese
          </Scelta>
          <Scelta scelta={m.ripeti === "settimana"} onClick={() => cambia({ ripeti: "settimana" })} disabled={salvando || disabled}>
            {m.ripeti === "settimana" ? "✓ " : ""}Ogni settimana
          </Scelta>
        </div>
      </Campo>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo titolo="IP per gruppo" nota="Da 1 a 20. Un gruppo alla volta.">
          <Input
            type="number" min={1} max={20} inputMode="numeric" value={m.ipPerGruppo}
            onChange={(e) => cambia({ ipPerGruppo: e.target.value })}
            aria-invalid={ipPerGruppo === null || undefined}
            className="h-9 w-20 font-mono text-sm" disabled={salvando || disabled} aria-label="IP per gruppo"
          />
        </Campo>
        <Campo
          titolo="Tentativi"
          nota={`Da 1 a 10.${testoDistanzaRitento(m.dalle, m.alle) ? ` Almeno ${testoDistanzaRitento(m.dalle, m.alle)} fra un tentativo e l'altro.` : ""}`}
        >
          <Input
            type="number" min={1} max={10} inputMode="numeric" value={m.tentativi}
            onChange={(e) => cambia({ tentativi: e.target.value })}
            aria-invalid={tentativi === null || undefined}
            className="h-9 w-20 font-mono text-sm" disabled={salvando || disabled} aria-label="Tentativi"
          />
        </Campo>
        <Campo titolo="Profilo">
          <Select value={m.profile} onValueChange={(v) => cambia({ profile: profiloDi(String(v)) })} disabled={salvando || disabled}>
            <SelectTrigger className="h-9 w-full text-sm" aria-label="Profilo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROFILI) as EdgeScanProfile[]).map((p) => (
                <SelectItem key={p} value={p}>{PROFILI[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>

      <Campo titolo="Stima">
        {stimaTesto ? (
          <div
            role="status"
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              stimaTesto.tono === "ok" ? STILE_STATO.ok.classi : stimaTesto.tono === "attenzione" ? STILE_STATO.attenzione.classi : CLASSI_TONO.neutro,
            )}
          >
            {stimaTesto.testo}
          </div>
        ) : (
          <p className={NOTA}>● Il numero di IP di questa rete non è noto: la stima si fa dopo il primo salvataggio.</p>
        )}
      </Campo>

      {avvisoSalvataggio && <RigaMessaggio riga={{ tono: "attenzione", testo: `▲ ${avvisoSalvataggio}` }} />}
      {(eventualeErrore || rifiuto) && <RigaMessaggio riga={{ tono: "guasto", testo: `✕ ${rifiuto ?? eventualeErrore}` }} />}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void salva()} disabled={salvando || disabled || !!eventualeErrore}>
          {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Salva la finestra
        </Button>
        {salvata && (
          <Button type="button" variant="outline" className="text-destructive" onClick={() => void tornaAOrario()} disabled={salvando || disabled}>
            Torna a orario fisso
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Avanzamento ────────────────────────────────────────────────────────────────────────────────

interface InfoStato {
  segno: string;
  nome: string;
  plurale: string;
  classi: string;
}

const STATI: Record<StatoIp, InfoStato> = {
  da_fare: { segno: "○", nome: "Da fare", plurale: "Da fare", classi: "border-muted-foreground bg-muted text-foreground" },
  in_prova: { segno: "▶", nome: "In prova", plurale: "In prova", classi: "border-cian-testo bg-selezione text-cian-testo" },
  finito: { segno: "✓", nome: "Finito", plurale: "Finiti", classi: STILE_STATO.ok.classi },
  non_risponde: { segno: "▲", nome: "Non risponde", plurale: "Non rispondono", classi: STILE_STATO.attenzione.classi },
  assente: { segno: "✕", nome: "Assente", plurale: "Assenti", classi: "border-muted-foreground bg-muted-foreground text-card" },
  non_finito: { segno: "◐", nome: "Non finito", plurale: "Non finiti", classi: "border-foreground/50 bg-warning/20 text-foreground" },
};

function Chip({ stato }: { stato: StatoIp }) {
  const s = STATI[stato];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[13px] font-semibold", s.classi)}>
      <span aria-hidden>{s.segno}</span>
      {s.nome}
    </span>
  );
}

function conteggio(p: PassaggioSonda, stato: StatoIp): number {
  switch (stato) {
    case "da_fare": return p.da_fare;
    case "in_prova": return p.in_prova;
    case "finito": return p.finiti;
    case "non_risponde": return p.non_rispondono;
    case "assente": return p.assenti;
    case "non_finito": return p.non_finiti;
  }
}

function Barra({ percento, etichetta, alta, colore }: { percento: number; etichetta: string; alta?: boolean; colore: string }) {
  return (
    <div
      role="img"
      aria-label={etichetta}
      className={cn("mt-1.5 overflow-hidden rounded-sm border border-muted-foreground/60 bg-muted", alta ? "h-3.5" : "h-2")}
    >
      <div className={cn("h-full", colore)} style={{ width: `${Math.max(0, Math.min(100, percento))}%` }} />
    </div>
  );
}

/** Ultimi IP del gruppo in corso: «10.50.0.3 · .4 · .9» come nella tavola, l'indirizzo intero solo il primo. */
function ipDelGruppo(csv: string): string {
  const ip = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (ip.length === 0) return "—";
  const [primo, ...altri] = ip;
  const prefisso = primo.slice(0, primo.lastIndexOf(".") + 1);
  return [primo, ...altri.map((x) => (x.startsWith(prefisso) ? `.${x.slice(prefisso.length)}` : x))].join(" · ");
}

export function FinestraAvanzamento({ networkId, lettura }: { networkId: number; lettura: FinestraLettura }) {
  const d = lettura.dati;
  if (d === null || d.stato !== "ok" || d.finestra === null) return null;
  return <AvanzamentoOk networkId={networkId} dati={d} lettura={lettura} />;
}

function AvanzamentoOk({ networkId, dati, lettura }: { networkId: number; dati: DatiFinestra & { stato: "ok" }; lettura: FinestraLettura }) {
  const p = dati.passaggio;
  const adesso = new Date();
  const righe = righeStato(dati, adesso);

  if (p === null) {
    return (
      <section className="space-y-3 rounded-xl border bg-card p-3.5" aria-label="Avanzamento">
        <p className="text-sm font-semibold">Nessun passaggio ancora</p>
        <p className={NOTA}>Il primo si apre alla prossima apertura della fascia.</p>
        {righe.map((r) => <RigaMessaggio key={r.testo} riga={r} />)}
      </section>
    );
  }

  const barra = barraAvanzamento(p);
  const gruppoIp = dati.gruppo ? dati.gruppo.ip.split(",").filter((x) => x.trim()).length : 0;
  return (
    <section className="space-y-4 rounded-xl border bg-card p-3.5" aria-label="Avanzamento">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <span className="text-xl font-bold">{barra.finiti} di {barra.su} finiti</span>
          <span className={NOTA}>
            Passaggio di {meseItaliano(p.iniziato_at)} · iniziato {giornoItaliano(p.iniziato_at)}
            {barra.usciti > 0 && ` · ${barra.usciti} IP usciti, non contano fra i mancanti`}
          </span>
        </div>
        <Barra percento={barra.percento} etichetta={`${barra.finiti} su ${barra.su}, ${barra.percento} per cento`} alta colore="bg-[var(--host-online)]" />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {STATI_IP.map((s) => (
          <div key={s} className={cn("flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-[13px]", STATI[s].classi)}>
            <span><span aria-hidden>{STATI[s].segno}</span> {STATI[s].plurale}</span>
            <b className="font-mono text-xl font-bold leading-tight tabular-nums">{conteggio(p, s)}</b>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className={ETICHETTA_CAMPO}>Gruppo in corso</p>
          {dati.gruppo ? (
            <>
              <p className="text-sm">
                {gruppoIp} IP · partito alle {oraItaliana(dati.gruppo.partito_at)}
                {dati.gruppo.percento !== null ? ` · ${dati.gruppo.percento}%` : " · avanzamento non ancora noto"}
              </p>
              <p className="font-mono text-[13px] text-muted-foreground">{ipDelGruppo(dati.gruppo.ip)}</p>
              {dati.gruppo.percento !== null && <Barra percento={dati.gruppo.percento} etichetta={`${dati.gruppo.percento} per cento`} colore="bg-cian-testo" />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nessun gruppo in corso.</p>
          )}
          <p className={cn(NOTA, "mt-1")}>
            Gruppi fatti: {p.gruppi_fatti}
            {p.durata_media_min !== null && ` · durata media ${p.durata_media_min} min`}
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <p className={ETICHETTA_CAMPO}>Stato</p>
            <div className="mt-1 space-y-1.5">
              {righe.length === 0 ? <p className="text-sm text-muted-foreground">Tutto regolare.</p> : righe.map((r) => <RigaMessaggio key={r.testo} riga={r} />)}
            </div>
          </div>
          <div>
            <p className={ETICHETTA_CAMPO}>Rapporti</p>
            <p className="text-sm">
              {p.rapporti_inviati} inviati a Vulcan · {p.rapporti_in_coda} in coda
              {p.rapporti_arresi > 0 && (
                <span className={cn("ml-2 inline-flex h-6 items-center rounded-md border px-2 text-[13px] font-semibold", STILE_STATO.attenzione.classi)}>
                  ▲ {p.rapporti_arresi} non arrivati
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <ElencoIp networkId={networkId} passaggio={p} tentativiMax={dati.finestra?.tentativi ?? 0} lettaAt={lettura.lettaAt} />
    </section>
  );
}

type FiltroIp = StatoIp | "tutti";

function ElencoIp({ networkId, passaggio, tentativiMax, lettaAt }: { networkId: number; passaggio: PassaggioSonda; tentativiMax: number; lettaAt: number | null }) {
  const [filtro, setFiltro] = useState<FiltroIp>("tutti");
  const [pagina, setPagina] = useState(0);
  const [esito, setEsito] = useState<EsitoElencoIp | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Ogni giro (filtro, pagina, rilettura) annulla quello prima: la risposta di un giro annullato non si guarda.
  useEffect(() => {
    const ac = new AbortController();
    const q = new URLSearchParams({ limit: String(RIGHE_PER_PAGINA), offset: String(pagina * RIGHE_PER_PAGINA) });
    if (filtro !== "tutti") q.set("stato", filtro);
    void (async () => {
      try {
        const res = await fetchJson<EsitoElencoIp>(`/api/networks/${networkId}/edge-scan/finestra/ip?${q}`, { signal: ac.signal });
        if (ac.signal.aborted) return; // una richiesta più nuova è già partita (o il pannello si è chiuso)
        if (!res.ok) setErrore(res.message);
        else if (res.data.stato === "errore") setErrore(res.data.messaggio);
        else if (res.data.stato === "da_aggiornare") setErrore(SONDA_DA_AGGIORNARE);
        else {
          setEsito(res.data);
          setErrore(null);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (!ac.signal.aborted) setErrore(e instanceof Error ? e.message : "Lettura non riuscita");
      }
    })();
    return () => ac.abort();
  }, [networkId, filtro, pagina, lettaAt, passaggio.id]);

  const adesso = new Date();
  const righe: IpFinestra[] = esito?.stato === "ok" ? esito.ip : [];
  const totale = esito?.stato === "ok" ? esito.totale : 0;
  const da = totale === 0 ? 0 : pagina * RIGHE_PER_PAGINA + 1;
  const a = Math.min(totale, (pagina + 1) * RIGHE_PER_PAGINA);

  const scegli = (f: FiltroIp) => {
    setFiltro(f);
    setPagina(0);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(ETICHETTA_CAMPO, "mr-1.5")}>Indirizzi</span>
        <Button type="button" variant={filtro === "tutti" ? "default" : "outline"} aria-pressed={filtro === "tutti"} className="text-[13px]" onClick={() => scegli("tutti")}>
          Tutti {passaggio.totale}
        </Button>
        {STATI_IP.map((s) => (
          <Button key={s} type="button" variant={filtro === s ? "default" : "outline"} aria-pressed={filtro === s} className="text-[13px]" onClick={() => scegli(s)}>
            {STATI[s].plurale} {conteggio(passaggio, s)}
          </Button>
        ))}
      </div>

      {errore && (
        <RigaMessaggio riga={{ tono: "guasto", testo: `✕ Elenco degli IP non letto: ${errore}${esito ? " Si vedono le righe dell'ultima lettura riuscita." : ""}` }} />
      )}

      <div className="max-h-[360px] overflow-y-auto rounded-lg border">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-sidebar text-sidebar-foreground">
            <tr>
              {["IP", "Stato", "Tentativi", "Ultimo tentativo", "Prossimo tentativo"].map((h) => (
                <th key={h} className="px-2.5 py-1.5 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {esito === null && !errore ? (
              <tr><td colSpan={5} className="px-2.5 py-3 text-muted-foreground">Lettura degli indirizzi…</td></tr>
            ) : righe.length === 0 ? (
              <tr><td colSpan={5} className="px-2.5 py-3 text-muted-foreground">{errore ? "—" : "Nessun indirizzo in questo stato."}</td></tr>
            ) : (
              righe.map((r) => (
                <tr key={r.ip} className="border-t">
                  <td className="px-2.5 py-1.5 font-mono font-semibold">{r.ip}</td>
                  <td className="px-2.5 py-1.5"><Chip stato={r.stato} /></td>
                  <td className="px-2.5 py-1.5">{r.tentativi} di {tentativiMax}</td>
                  <td className="px-2.5 py-1.5">{r.ultimo_tentativo_at ? giornoOraItaliano(r.ultimo_tentativo_at, adesso) : "—"}</td>
                  <td className="px-2.5 py-1.5">
                    {r.prossimo_da ? dalleItaliano(r.prossimo_da, adesso) : r.stato === "da_fare" ? "al prossimo gruppo" : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={NOTA}>Assente = non ha mai risposto. Non finito = risponde, ma Greenbone non lo ha chiuso entro i tentativi.</span>
        {totale > RIGHE_PER_PAGINA && (
          <span className="flex items-center gap-2 text-[13px]">
            <span className="font-mono">{da}–{a} di {totale}</span>
            <Button type="button" variant="outline" className="text-[13px]" disabled={pagina === 0} onClick={() => setPagina((v) => v - 1)}>Precedenti</Button>
            <Button type="button" variant="outline" className="text-[13px]" disabled={a >= totale} onClick={() => setPagina((v) => v + 1)}>Successivi</Button>
          </span>
        )}
      </div>
    </div>
  );
}
