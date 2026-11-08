"use client";

/**
 * Pannello 4 «Quando» della scheda «Per device» (Passo 6, tavola oggetti 27-29 approvata l'08/11/2026).
 * Adesso = il lancio di sempre. Pianificata = DA-IPAM lancia all'ora fissata i gruppi spuntati nella colonna
 * «Lancia», con i device confermati in quel momento. Una sola pianificazione per rete: se c'è quella «Un profilo
 * solo» si dice prima di salvare, e si salva solo spegnendola.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pannello } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import type { Frequenza, Pianificazione } from "@/lib/vuln/proposta/pianificazione";
import { quandoInParole } from "@/lib/vuln/proposta/pianificazione-parole";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import { Stato } from "./stato-va";

const campo = "h-8 rounded-md border bg-background px-2 text-sm";
const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

interface Risposta {
  pianificazione: Pianificazione | null;
  un_profilo: string | null;
  spenta?: string | null;
}

function istante(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { timeZone: FUSO_UTENTI, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function QuandoDevice({ reteId, nomeRete, scelte, nomiFamiglie, nDevice, amministratore, manca, occupato, onAdesso, fuori }: {
  reteId: number;
  nomeRete: string;
  /** I gruppi spuntati nella colonna «Lancia», con almeno un device confermato. */
  scelte: Famiglia[];
  /** Il nome di ogni famiglia, dalla scheda (le regole delle proposte stanno sul server). */
  nomiFamiglie: Record<string, string>;
  nDevice: number;
  amministratore: boolean;
  /** Perché il lancio non si può fare (solo lettura, Edge spento, niente confermato); null = si può. */
  manca: string | null;
  occupato: boolean;
  onAdesso: () => void;
  fuori: React.ReactNode;
}) {
  const [modo, setModo] = useState<"adesso" | "pianificata">("adesso");
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [frequenza, setFrequenza] = useState<Frequenza>("settimanale");
  const [giorno, setGiorno] = useState(0);
  const [ora, setOra] = useState("02:00");
  const [conflitto, setConflitto] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const [nota, setNota] = useState<string | null>(null);

  const leggi = useCallback(async () => {
    const r = await fetchJson<Risposta>(`/api/networks/${reteId}/pianificazione-device`);
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setDati(r.data);
    const p = r.data.pianificazione;
    if (p) {
      setFrequenza(p.frequenza);
      setGiorno(p.giorno ?? (p.frequenza === "mensile" ? 1 : 0));
      setOra(p.ora);
      if (p.attiva) setModo("pianificata");
    }
  }, [reteId]);

  useEffect(() => {
    setDati(null);
    setConflitto(null);
    setNota(null);
    setModo("adesso");
    void leggi();
  }, [leggi]);

  const salva = async (sostituisci: boolean) => {
    setLavoro(true);
    setNota(null);
    const r = await fetchJson<Risposta & { un_profilo?: string }>(`/api/networks/${reteId}/pianificazione-device`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ famiglie: scelte, frequenza, giorno: frequenza === "giornaliera" ? null : giorno, ora, sostituisci }),
    });
    setLavoro(false);
    if (!r.ok) {
      // 409: la rete ha una pianificazione «Un profilo solo». Si mostra l'avviso e si aspetta la scelta.
      if (r.status === 409) setConflitto(dati?.un_profilo ?? "pianificazione esistente");
      else setNota(r.message);
      return;
    }
    setConflitto(null);
    setDati(r.data);
    setNota(r.data.spenta ? `Salvata. Spenta la pianificazione «Un profilo solo» (${r.data.spenta}).` : "Salvata.");
  };

  const spegni = async () => {
    setLavoro(true);
    const r = await fetchJson<Risposta>(`/api/networks/${reteId}/pianificazione-device`, { method: "DELETE" });
    setLavoro(false);
    if (r.ok) {
      await leggi();
      setNota("Pianificazione spenta.");
    } else setNota(r.message);
  };

  const p = dati?.pianificazione ?? null;
  const nomi = scelte.map((f) => (nomiFamiglie[f] ?? f)).join(", ");
  const gruppi = scelte.length === 1 ? "1 gruppo" : `${scelte.length} gruppi`;

  return (
    <Pannello
      numero={4}
      titolo="Quando"
      sottotitolo={modo === "adesso" ? "Parte adesso. Edge fa un gruppo alla volta, gli altri restano in coda." : "All'ora fissata DA-IPAM lancia i gruppi con i device confermati in quel momento."}
      azioni={
        <span className="flex gap-2" role="group" aria-label="Quando lanciare">
          {(["adesso", "pianificata"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn("min-h-8 rounded-md border-2 border-foreground px-3 text-sm font-semibold", modo === m ? "bg-foreground text-background" : "bg-card")}
            >
              {m === "adesso" ? "Adesso" : "Pianificata"}
            </button>
          ))}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {errore && <p className="text-sm">Pianificazione non letta: {errore}</p>}
        {p && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
            {p.attiva ? <Stato tono="ok">✓ Pianificata</Stato> : <Stato tono="spento">● Spenta</Stato>}
            <span className="text-[15px]">{quandoInParole(p)} · {p.famiglie.map((f) => (nomiFamiglie[f] ?? f)).join(", ")}</span>
            <span className="text-sm text-muted-foreground">
              {p.attiva && p.prossima_il ? `prossima: ${istante(p.prossima_il)}` : null}
              {p.ultima_il ? `${p.attiva && p.prossima_il ? " · " : ""}ultima: ${istante(p.ultima_il)}` : null}
            </span>
            {p.ultimo_esito && (
              <Stato tono={p.ultimo_tono === "errore" ? "errore" : p.ultimo_tono === "avviso" ? "avviso" : p.ultimo_tono === "spento" ? "spento" : "ok"}>
                {p.ultimo_tono === "errore" ? "✕" : p.ultimo_tono === "avviso" ? "▲" : p.ultimo_tono === "spento" ? "●" : "✓"} {p.ultimo_esito}
              </Stato>
            )}
            <span className="flex-1" />
            {amministratore && p.attiva && <Button size="sm" variant="outline" disabled={lavoro} onClick={() => void spegni()}>Spegni</Button>}
          </div>
        )}

        {modo === "adesso" ? (
          <div className="flex flex-wrap items-center gap-3">
            {fuori}
            <span className="flex-1" />
            <span className="text-[15px]"><strong>{gruppi}</strong> · {nDevice} device</span>
            <Button size="lg" disabled={manca !== null || occupato} title={manca ?? undefined} onClick={onAdesso}>
              {occupato && <Loader2 className="size-4 animate-spin" />}
              {manca ?? `Avvia ${gruppi} su ${nomeRete}`}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">Frequenza
                <select className={campo} value={frequenza} disabled={!amministratore} onChange={(e) => {
                  const f = e.target.value as Frequenza;
                  setFrequenza(f);
                  setGiorno(f === "mensile" ? 1 : 0);
                }}>
                  <option value="settimanale">Settimanale</option>
                  <option value="giornaliera">Ogni giorno</option>
                  <option value="mensile">Mensile</option>
                </select>
              </label>
              {frequenza === "settimanale" && (
                <label className="flex items-center gap-2 text-sm">Giorno
                  <select className={campo} value={giorno} disabled={!amministratore} onChange={(e) => setGiorno(Number(e.target.value))}>
                    {GIORNI.map((g, i) => <option key={g} value={i}>{g}</option>)}
                  </select>
                </label>
              )}
              {frequenza === "mensile" && (
                <label className="flex items-center gap-2 text-sm">Giorno del mese
                  <select className={campo} value={giorno} disabled={!amministratore} onChange={(e) => setGiorno(Number(e.target.value))}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">Ora
                <input type="time" className={cn(campo, "font-mono")} value={ora} disabled={!amministratore} onChange={(e) => setOra(e.target.value)} />
              </label>
              <span className="flex-1" />
              <span className="text-[15px]"><strong>{gruppi}</strong>{nomi ? ` · ${nomi}` : ""} · {nDevice} device oggi</span>
              <Button size="lg" disabled={manca !== null || lavoro || !/^\d{2}:\d{2}$/.test(ora)} title={manca ?? undefined} onClick={() => void salva(false)}>
                {lavoro && <Loader2 className="size-4 animate-spin" />}
                {manca ?? `Salva la pianificazione su ${nomeRete}`}
              </Button>
            </div>
            {conflitto && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border-2 border-foreground bg-[#FFF6CC] px-3 py-2 text-sm text-[#0D2537]" role="alert">
                <Stato tono="avviso">▲ Attenzione</Stato>
                <span>{nomeRete} ha già una pianificazione «Un profilo solo»: <strong>{conflitto}</strong>. Salvando questa, quella si spegne.</span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" onClick={() => setConflitto(null)}>Annulla</Button>
                <Button size="sm" disabled={lavoro} onClick={() => void salva(true)}>Spegni quella e salva questa</Button>
              </div>
            )}
          </>
        )}
        {nota && <p className="text-sm">{nota}</p>}
      </div>
    </Pannello>
  );
}
