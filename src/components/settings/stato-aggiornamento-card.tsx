"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import {
  commitBreve,
  decidiSeguito,
  INTERVALLO_SEGUITO_MS,
  nomeFase,
  valutaAvanzamento,
  type Avanzamento,
  type RispostaStatoAggiornamento,
} from "@/lib/aggiornamento-stato";

const URL_STATO = "/api/system/update?action=aggiornamento";

/** Dopo un aggiornamento riuscito la pagina si ricarica: il codice nuovo è un'altra app. */
const RICARICA_DOPO_MS = 3_000;

function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso); // ISO con fuso (toISOString del server), non una data del DB
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

/** L'esito del tentativo in parole: «riuscito» con avvisi non è un riuscito pulito (19/10, F04). */
function etichettaEsito(t: { esito: string | null; fase: string | null; avvisi: string[] }): string {
  if (t.esito === "in_corso") return `in corso: ${nomeFase(t.fase)}`;
  if (t.esito === "pronto_non_avviato") return "build pronta, non avviata";
  if (t.esito === "riuscito" && t.avvisi.length > 0) return "riuscito, con avvisi";
  return t.esito ?? "sconosciuto";
}

function testoAvanzamento(a: Avanzamento): string {
  switch (a.tipo) {
    case "in_attesa":
      return "In attesa che il servizio d'aggiornamento parta…";
    case "in_corso":
      return `In corso: ${nomeFase(a.fase)}…`;
    case "riuscito":
      return a.nota ? `Aggiornamento riuscito (${a.nota}).` : "Aggiornamento riuscito.";
    case "nessuna_novita":
      return "Nessuna novità sul canale: l'app è già aggiornata.";
    case "fallito":
      return a.nonAvviata
        ? `Aggiornamento non avviato: ${a.messaggio}.`
        : `Aggiornamento non riuscito: ${a.messaggio}. L'app è rimasta sulla versione di prima.`;
  }
}

/**
 * Stato dell'aggiornamento automatico (data/aggiornamento.json): codice scaricato
 * e avviato, ultimo tentativo con fase ed esito. Con `richiestoIl` segue
 * l'aggiornamento chiesto da «Aggiorna ora», anche attraverso il riavvio.
 */
export function StatoAggiornamentoCard({
  richiestoIl,
  onFine,
}: {
  /** Ora (del server) in cui è stato premuto «Aggiorna ora» in questa pagina, o null. */
  richiestoIl: string | null;
  onFine: () => void;
}) {
  const [dati, setDati] = useState<RispostaStatoAggiornamento | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [avanzamento, setAvanzamento] = useState<Avanzamento | null>(null);
  const [avvisoSeguito, setAvvisoSeguito] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFineRef = useRef(onFine);
  useEffect(() => {
    onFineRef.current = onFine;
  }, [onFine]);

  const carica = useCallback(async () => {
    const r = await fetchJson<RispostaStatoAggiornamento>(URL_STATO, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
    return r;
  }, []);

  /**
   * Un aggiornamento già in corso all'apertura della pagina (dal banner, da
   * un'altra scheda, dal timer) si segue lo stesso.
   */
  const [inCorsoDa, setInCorsoDa] = useState<string | null>(null);
  const seguitoDa = richiestoIl ?? inCorsoDa;

  useEffect(() => {
    void carica().then((r) => {
      if (!r.ok) return;
      const t = r.data.stato.ultimoTentativo;
      const da = r.data.richiestaInAttesa ?? (t?.esito === "in_corso" ? t.iniziatoIl : null);
      if (da) setInCorsoDa(da);
    });
  }, [carica]);

  // Segue l'aggiornamento chiesto: rilegge lo stato finché non finisce.
  useEffect(() => {
    if (!seguitoDa) return;
    let attivo = true;
    let erroriDiFila = 0;
    const inizio = Date.now();
    setAvanzamento({ tipo: "in_attesa" });
    setAvvisoSeguito(null);

    const giro = async () => {
      const r = await carica();
      if (!attivo) return;
      const a = r.ok ? valutaAvanzamento(r.data.stato, seguitoDa) : null;
      if (a) setAvanzamento(a);
      const d = decidiSeguito({
        status: r.ok ? 200 : r.status,
        avanzamento: a,
        erroriDiFila,
        trascorsiMs: Date.now() - inizio,
      });
      if (d.azione === "continua") {
        erroriDiFila = d.erroriDiFila;
        setAvvisoSeguito(erroriDiFila > 0 ? "Il servizio non risponde: è normale durante il riavvio." : null);
        timerRef.current = setTimeout(() => void giro(), INTERVALLO_SEGUITO_MS);
        return;
      }
      switch (d.motivo) {
        case "riuscito":
          toast.success("Aggiornamento riuscito: la pagina si ricarica.");
          // Niente onFine: chiuderebbe il seguito e con lui questo timer.
          timerRef.current = setTimeout(() => window.location.reload(), RICARICA_DOPO_MS);
          return;
        case "fallito":
          toast.error("Aggiornamento non riuscito: l'app è rimasta sulla versione di prima.");
          break;
        case "nessuna_novita":
          toast.info("Nessuna novità: l'app è già aggiornata.");
          break;
        case "sessione":
          setAvvisoSeguito("Sessione scaduta: accedi di nuovo per vedere com'è finito l'aggiornamento.");
          break;
        case "irraggiungibile":
          setAvvisoSeguito(
            "Il servizio non risponde da 5 minuti. Ricarica la pagina più tardi; sul server: journalctl -u " +
              (dati?.unita ?? "<servizio>-update"),
          );
          break;
        case "tempo":
          setAvvisoSeguito("L'aggiornamento dura da più di 30 minuti: ricarica la pagina per vederne lo stato.");
          break;
      }
      setInCorsoDa(null);
      onFineRef.current();
    };

    timerRef.current = setTimeout(() => void giro(), INTERVALLO_SEGUITO_MS);
    return () => {
      attivo = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `dati` serve solo al testo dell'avviso: non deve far ripartire il seguito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguitoDa, carica]);

  if (errore && !dati) {
    return <LoadError what="lo stato dell'aggiornamento" message={errore} onRetry={() => void carica()} />;
  }

  const stato = dati?.stato;
  const t = stato?.ultimoTentativo ?? null;
  const daAvviare =
    dati?.commitScaricato && stato?.commitAvviato && dati.commitScaricato !== stato.commitAvviato && t?.esito !== "in_corso";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-5 w-5" />
          Stato dell&apos;aggiornamento
        </CardTitle>
        <CardDescription>
          Ogni aggiornamento (dal timer o da «Aggiorna ora») costruisce in una cartella separata e passa alla
          build nuova solo se l&apos;app risponde dopo il riavvio; altrimenti torna alla versione di prima.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {avanzamento && (
          <div
            className={`rounded-md border p-3 flex items-start gap-2 ${
              avanzamento.tipo === "fallito"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : avanzamento.tipo === "riuscito" || avanzamento.tipo === "nessuna_novita"
                  ? "border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-400"
                  : "border-sky-500/40 bg-sky-500/5"
            }`}
          >
            {avanzamento.tipo === "in_attesa" || avanzamento.tipo === "in_corso" ? (
              <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />
            ) : avanzamento.tipo === "fallito" ? (
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            )}
            <div>
              <p>{testoAvanzamento(avanzamento)}</p>
              {avvisoSeguito && <p className="text-xs text-muted-foreground mt-1">{avvisoSeguito}</p>}
            </div>
          </div>
        )}
        {errore && dati && <p className="text-xs text-destructive">Ultima lettura non riuscita: {errore}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Riga etichetta="Codice scaricato">
            <span className="font-mono">{commitBreve(dati?.commitScaricato)}</span>
          </Riga>
          <Riga etichetta="Avviato con salute buona">
            <span className="font-mono">{commitBreve(stato?.commitAvviato)}</span>
            {stato?.ultimoSuccesso && (
              <span className="block text-xs text-muted-foreground">{quando(stato.ultimoSuccesso.il)}</span>
            )}
          </Riga>
          <Riga etichetta="Ultimo controllo">
            <span>{quando(stato?.ultimoControllo?.il)}</span>
          </Riga>
        </div>
        {daAvviare && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Il codice scaricato non è quello in esecuzione: il prossimo aggiornamento lo costruisce e lo avvia.
          </p>
        )}

        {t && (
          <div className="border-t pt-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Ultimo tentativo</span>
              <span className="font-mono">{commitBreve(t.commit)}</span>
              <Badge
                variant={t.esito === "fallito" || t.esito === "interrotto" || t.esito === "pronto_non_avviato" ? "destructive" : "secondary"}
              >
                {etichettaEsito(t)}
              </Badge>
              {t.tentativi && t.tentativi > 1 && (
                <span className="text-xs text-muted-foreground">tentativo {t.tentativi}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Iniziato {quando(t.iniziatoIl)}
              {t.finitoIl ? ` · finito ${quando(t.finitoIl)}` : ""}
            </p>
            {t.messaggio && <p className="text-xs">{t.messaggio}</p>}
            {t.avvisi.length > 0 && (
              <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5">
                {t.avvisi.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {dati && !dati.unita && (
          <p className="text-xs text-muted-foreground">
            Questa istanza non gira come servizio di systemd: «Aggiorna ora» non è disponibile, sul server si usa{" "}
            <code>bash scripts/update.sh --restart</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Riga({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{etichetta}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
