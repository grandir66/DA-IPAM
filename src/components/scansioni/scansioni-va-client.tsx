"use client";

/**
 * Pagina Scansioni VA (tavola approvata il 06/11/2026): 1 Profilo → 2 Reti → 3 Quando.
 * Le impostazioni restano della singola rete: la pagina le scrive su tutte quelle scelte, e il
 * pannello VA Scan della rete continua a servire per ritoccarne una sola.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Loader2, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  BarraStato,
  IntestazionePagina,
  InCorso,
  Pannello,
  TesseraNumero,
  VoceSelezionabile,
  Vuoto,
} from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { ScheduleBuilder, type ScheduleBuilderValue } from "@/components/networks/schedule-builder";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { SONDA_DA_AGGIORNARE, type InvioFinestra } from "@/lib/vuln/finestra";
import type { EdgeTargetingMode } from "@/lib/vuln/edge-subnet-bridge";
import {
  AMBITI,
  conteggi,
  cosaCambia,
  type Cambio,
  type EsitoRete,
  type IdVoce,
  type ModoScansione,
  type QuadroScansioni,
  type ReteScansione,
  type VoceRisolta,
} from "@/lib/vuln/scansioni-va-regole";

const MODI: Array<{ id: ModoScansione; nome: string }> = [
  { id: "immediata", nome: "Immediata" },
  { id: "pianificata", nome: "Pianificata" },
  { id: "finestra", nome: "A finestra" },
];
const GIORNI = [
  { n: 1, nome: "Lun" },
  { n: 2, nome: "Mar" },
  { n: 3, nome: "Mer" },
  { n: 4, nome: "Gio" },
  { n: 5, nome: "Ven" },
  { n: 6, nome: "Sab" },
  { n: 0, nome: "Dom" },
];
const INVII: Array<{ id: InvioFinestra; nome: string }> = [
  { id: "passaggio", nome: "A fine passaggio" },
  { id: "fascia", nome: "A fine fascia" },
  { id: "gruppo", nome: "A ogni gruppo" },
];
/** Dove si configura Edge. */
const DOVE_EDGE = "/settings?tab=moduli";
const campo = "h-9 rounded-md border bg-background px-2.5 text-sm";

function dataBreve(v: string | null): string {
  if (!v) return "—";
  return parseDbDate(v).toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Stato con segno e fondo pieno, mai la sola tinta. */
function Stato({ tono, children }: { tono: "ok" | "in_corso" | "avviso" | "spento"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[13px] font-semibold",
        tono === "ok" && "border-foreground bg-card text-foreground",
        tono === "in_corso" && "border-[#0D2537] bg-[#0D2537] text-white",
        tono === "avviso" && "border-[#0D2537] bg-[#FFD400] text-[#0D2537]",
        tono === "spento" && "border-muted-foreground bg-muted text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ColonnaCambio({ c }: { c: Cambio }) {
  if (c.tono === "nessuno") return <span className="text-[13px] text-muted-foreground">{c.testo}</span>;
  return <Stato tono={c.tono === "in_corso" ? "in_corso" : "avviso"}>{c.testo}</Stato>;
}

function VoceProfilo({ v, scelta, onScegli, bloccata }: { v: VoceRisolta; scelta: boolean; onScegli: () => void; bloccata: boolean }) {
  const riga = (nome: string, valore: React.ReactNode, mono = false) => (
    <span className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{nome}</span>
      <span className={cn("text-right", mono && "font-mono")}>{valore}</span>
    </span>
  );
  const contenuto = (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {scelta && <span aria-hidden>✓</span>}
        {v.nome}
        {v.autorizzazione && <Stato tono="avviso">▲ Autorizzazione</Stato>}
      </span>
      <span className="min-h-10 text-sm leading-snug">{v.serve}</span>
      {riga("Greenbone", v.greenboneNome)}
      {riga("Moduli", v.moduliNome ?? "—")}
      {riga("Tempo /24", v.tempo, true)}
    </span>
  );
  if (bloccata) {
    return (
      <div className="rounded-xl border-2 border-dashed border-muted-foreground bg-muted p-3 text-sm" aria-disabled>
        {contenuto}
        <div className="mt-2"><Stato tono="spento">✕ Non c&apos;è su questa sonda</Stato></div>
      </div>
    );
  }
  return <VoceSelezionabile scelta={scelta} onScegli={onScegli}>{contenuto}</VoceSelezionabile>;
}

function EsitoLancio({ esiti, onRiprova, occupato }: { esiti: EsitoRete[]; onRiprova: (ids: number[]) => void; occupato: boolean }) {
  const falliti = esiti.filter((e) => e.esito === "errore");
  return (
    <Pannello
      titolo="Esito"
      conteggio={`${esiti.length - falliti.length} su ${esiti.length}`}
      azioni={falliti.length > 0 ? (
        <Button size="sm" variant="outline" disabled={occupato} onClick={() => onRiprova(falliti.map((f) => f.id))}>
          <RotateCw className="size-4" /> Riprova su {falliti.length === 1 ? "1 rete" : `${falliti.length} reti`}
        </Button>
      ) : undefined}
    >
      <ul className="flex flex-col gap-1.5">
        {esiti.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-3 py-1.5 text-sm">
            <span className="font-medium">{e.nome}</span>
            {e.esito === "avviata" && <Stato tono="ok">✓ Avviata</Stato>}
            {e.esito === "salvata" && <Stato tono="ok">✓ Salvata{e.motivo ? `: ${e.motivo}` : ""}</Stato>}
            {e.esito === "saltata" && <Stato tono="spento">● {e.motivo}</Stato>}
            {e.esito === "errore" && <Stato tono="avviso">▲ {e.motivo ?? "Non riuscita"}</Stato>}
          </li>
        ))}
      </ul>
    </Pannello>
  );
}

export function ScansioniVaClient() {
  const { data: session } = useSession();
  const ruolo = (session?.user as { role?: string } | undefined)?.role;
  const amministratore = ruolo === "admin" || ruolo === "superadmin";

  const [quadro, setQuadro] = useState<QuadroScansioni | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  const [voce, setVoce] = useState<IdVoce>("bilanciato");
  const [ambito, setAmbito] = useState<EdgeTargetingMode>("full_subnet");
  const [modo, setModo] = useState<ModoScansione>("immediata");
  const [scelte, setScelte] = useState<Set<number>>(new Set());
  const [cerca, setCerca] = useState("");
  const [syncHosts, setSyncHosts] = useState(true);
  const [syncCredenziali, setSyncCredenziali] = useState(true);
  const [autorizzazione, setAutorizzazione] = useState(false);
  const [piano, setPiano] = useState<ScheduleBuilderValue>({ frequency: "weekly", at: "02:00", daysOfWeek: [0], dayOfMonth: 1 });
  const [dalle, setDalle] = useState("22:00");
  const [alle, setAlle] = useState("06:00");
  const [giorni, setGiorni] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ripeti, setRipeti] = useState<"settimana" | "mese">("settimana");
  const [invio, setInvio] = useState<InvioFinestra>("fascia");
  const [ipPerGruppo, setIpPerGruppo] = useState("8");
  const [tentativi, setTentativi] = useState("3");

  const [lanciando, setLanciando] = useState(false);
  const [rifiuto, setRifiuto] = useState<string | null>(null);
  const [esiti, setEsiti] = useState<EsitoRete[] | null>(null);

  const leggi = useCallback(async () => {
    setCaricamento(true);
    const r = await fetchJson<QuadroScansioni>("/api/vulnerabilities/scansioni");
    if (r.ok) {
      setQuadro(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
    setCaricamento(false);
  }, []);
  useEffect(() => {
    void leggi();
  }, [leggi]);

  const voceScelta = quadro?.voci.find((v) => v.id === voce) ?? null;
  const conCambio = useMemo(() => {
    const s = { modo, assessmentId: voceScelta?.assessmentId ?? null };
    return (quadro?.reti ?? []).map((r) => ({ r, c: cosaCambia(r, s) }));
  }, [quadro, modo, voceScelta]);
  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return q ? conCambio.filter(({ r }) => `${r.nome} ${r.cidr} ${r.vlan ?? ""}`.toLowerCase().includes(q)) : conCambio;
  }, [conCambio, cerca]);
  const sceglibili = conCambio.filter(({ c }) => !c.blocca);
  // Una rete scelta che intanto è entrata in scansione esce dal conto: la casella è spenta.
  const scelteValide = sceglibili.filter(({ r }) => scelte.has(r.id));
  const reteCambiate = scelteValide.filter(({ c }) => c.tocca).map(({ r }) => r.nome);
  const hostScelti = scelteValide.reduce((t, { r }) => t + r.hostOnline, 0);
  const tutte = sceglibili.length > 0 && scelteValide.length === sceglibili.length;
  const numeri = quadro ? conteggi(quadro.reti) : null;

  const quante = scelteValide.length === 1 ? "1 rete" : `${scelteValide.length} reti`;
  const nomeAmbito = AMBITI.find((a) => a.id === ambito)?.nome ?? "";
  const azione = `${modo === "immediata" ? "Avvia" : "Salva"} su ${quante}`;
  const manca: string | null = !amministratore
    ? "Solo lettura"
    : !voceScelta?.assessmentId
      ? "Scegli un profilo"
      : scelteValide.length === 0
        ? "Scegli almeno una rete"
        : voceScelta.autorizzazione && !autorizzazione
          ? "Manca la conferma dell'autorizzazione"
          : modo === "finestra" && !quadro?.finestraDisponibile
            ? SONDA_DA_AGGIORNARE
            : modo === "finestra" && giorni.length === 0
              ? "Scegli almeno un giorno"
              : modo === "pianificata" && piano.frequency === "weekly" && piano.daysOfWeek.length === 0
                ? "Scegli almeno un giorno"
                : null;

  const lancia = async (ids: number[]) => {
    if (!voceScelta?.assessmentId) return;
    setLanciando(true);
    setRifiuto(null);
    const comune = {
      modo,
      voce,
      ambito,
      reti: ids,
      assessment_id: voceScelta.assessmentId,
      autorizzazione: voceScelta.autorizzazione ? autorizzazione : undefined,
    };
    const corpo =
      modo === "immediata"
        ? { ...comune, sync_hosts: syncHosts, sync_credentials: syncCredenziali }
        : modo === "pianificata"
          ? {
              ...comune,
              frequency: piano.frequency,
              at_time: piano.at,
              days_of_week: piano.frequency === "weekly" ? piano.daysOfWeek : undefined,
              day_of_month: piano.frequency === "monthly" ? piano.dayOfMonth : undefined,
            }
          : {
              ...comune,
              giorni,
              dalle,
              alle,
              ripeti,
              invio,
              ip_per_gruppo: Number(ipPerGruppo),
              tentativi: Number(tentativi),
            };
    const r = await fetchJson<{ esiti: EsitoRete[] }>("/api/vulnerabilities/scansioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (r.ok) {
      setEsiti(r.data.esiti);
      setScelte(new Set(r.data.esiti.filter((e) => e.esito === "errore").map((e) => e.id)));
      await leggi();
    } else {
      setRifiuto(r.message);
    }
    setLanciando(false);
  };

  const cambiaRete = (id: number) => {
    setScelte((v) => {
      const n = new Set(v);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const intestazione = (
    <IntestazionePagina
      titolo="Scansioni VA"
      sottotitolo="Si parte dal profilo, poi si scelgono le reti."
      azioni={<Link href="/vulnerabilities" className="text-sm text-cian-testo hover:underline">Rapporti in Vulnerabilità ›</Link>}
    />
  );

  if (!quadro) {
    return (
      <div className="flex flex-col gap-3">
        {intestazione}
        {errore
          ? <LoadError what="le scansioni VA" message={errore} onRetry={() => void leggi()} />
          : <InCorso titolo="Lettura dalla sonda" dettaglio="Profili e stato delle reti" />}
      </div>
    );
  }

  const edge = quadro.edge;
  if (edge.stato === "spento") {
    return (
      <div className="flex flex-col gap-3">
        {intestazione}
        <BarraStato acceso={false} titolo="Edge" />
        <Vuoto
          titolo="Le scansioni VA partono da Edge"
          testo="Accendilo per lanciarle da qui."
          azione={<Link href={DOVE_EDGE} className="text-sm font-semibold text-cian-testo hover:underline">Vai al modulo Edge ›</Link>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {intestazione}
      <BarraStato
        acceso={edge.stato === "acceso"}
        titolo="Edge"
        dettagli={[edge.nome, edge.versione, edge.stato === "non_risponde" ? "non risponde" : null].filter((d): d is string => !!d)}
        azioni={
          <Button size="sm" variant="ghost" disabled={caricamento} onClick={() => void leggi()}>
            {caricamento ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Rileggi
          </Button>
        }
      />
      {errore && <LoadError what="lo stato aggiornato" message={errore} onRetry={() => void leggi()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Reti scelte" valore={scelteValide.length} qualifica={`su ${quadro.reti.length}`} />
        <TesseraNumero
          titolo="In corso"
          valore={numeri?.inCorso ?? null}
          qualifica={numeri?.inCoda ? `${numeri.inCoda} in coda` : undefined}
          nota="Edge fa una scansione alla volta"
        />
        <TesseraNumero titolo="Pianificate" valore={numeri?.pianificate ?? null} />
        <TesseraNumero titolo="A finestra" valore={numeri?.aFinestra ?? null} />
      </div>

      <Pannello
        numero={1}
        titolo="Profilo"
        sottotitolo="Cosa cercare e quanto a fondo."
        piede={quadro.altriProfili > 0
          ? `${quadro.altriProfili === 1 ? "Un altro profilo della sonda" : `Altri ${quadro.altriProfili} profili della sonda`} non sta qui: si sceglie dal pannello VA Scan della rete.`
          : undefined}
      >
        {quadro.catalogoErrore && <LoadError what="i profili dalla sonda" message={quadro.catalogoErrore} onRetry={() => void leggi()} />}
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {quadro.voci.map((v) => (
            <VoceProfilo
              key={v.id}
              v={v}
              scelta={voce === v.id}
              bloccata={!v.assessmentId}
              onScegli={() => {
                setVoce(v.id);
                setAutorizzazione(false);
              }}
            />
          ))}
        </div>
        {voceScelta?.autorizzazione && (
          <label className="mt-3 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Checkbox checked={autorizzazione} onCheckedChange={(v) => setAutorizzazione(v === true)} />
            Ho l&apos;autorizzazione scritta del cliente per queste reti
          </label>
        )}
      </Pannello>

      <Pannello
        numero={2}
        titolo="Reti"
        conteggio={`${scelteValide.length} scelte`}
        sottotitolo={`${hostScelti.toLocaleString("it-IT")} host online`}
        corpoClassName="p-0"
        azioni={
          <>
            <span className="inline-flex" role="group" aria-label="Quali indirizzi">
              {AMBITI.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={ambito === a.id}
                  onClick={() => setAmbito(a.id)}
                  className={cn(
                    "min-h-9 border px-3 text-sm",
                    i === 0 && "rounded-l-md",
                    i === AMBITI.length - 1 && "rounded-r-md",
                    i > 0 && "-ml-px",
                    ambito === a.id ? "border-[#0D2537] bg-[#0D2537] font-semibold text-white" : "bg-card",
                  )}
                >
                  {a.nome}
                </button>
              ))}
            </span>
            <span className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="Cerca una rete" placeholder="Cerca una rete" className="h-9 w-52 pl-8" value={cerca} onChange={(e) => setCerca(e.target.value)} />
            </span>
          </>
        }
      >
        {quadro.reti.length === 0 ? (
          <Vuoto titolo="Nessuna rete" testo="Le reti si aggiungono dalla pagina Reti." />
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-[13px]">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label="Scegli tutte le reti"
                      checked={tutte}
                      onCheckedChange={(v) => setScelte(v === true ? new Set(sceglibili.map(({ r }) => r.id)) : new Set())}
                    />
                  </th>
                  {["Rete", "CIDR", "VLAN", "Host online", "Ultima VA", "Piano attuale", "Profilo attuale", "Cosa cambia"].map((t) => (
                    <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map(({ r, c }) => (
                  <RigaRete key={r.id} r={r} c={c} scelta={scelte.has(r.id) && !c.blocca} onCambia={() => cambiaRete(r.id)} voci={quadro.voci} />
                ))}
                {visibili.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">Nessuna rete corrisponde alla ricerca.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Pannello>

      <Pannello
        numero={3}
        titolo="Quando"
        azioni={
          <span className="inline-flex gap-2" role="group" aria-label="Quando">
            {MODI.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={modo === m.id}
                onClick={() => setModo(m.id)}
                className={cn(
                  "min-h-10 rounded-lg border-2 border-[#0D2537] px-4 text-sm font-semibold dark:border-foreground",
                  modo === m.id ? "bg-[#0D2537] text-white" : "bg-card",
                )}
              >
                {m.nome}
              </button>
            ))}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {modo === "immediata" && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span>Edge ne fa una alla volta: le altre restano in coda e partono da sole.</span>
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={syncHosts} onCheckedChange={(v) => setSyncHosts(v === true)} /> Sync host online da IPAM prima dello scan
              </label>
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={syncCredenziali} onCheckedChange={(v) => setSyncCredenziali(v === true)} /> Trasferisci credenziali subnet allo scanner
              </label>
            </div>
          )}
          {modo === "pianificata" && (
            <div className="max-w-2xl">
              <ScheduleBuilder value={piano} onChange={setPiano} />
              <p className="mt-2 text-[13px] text-muted-foreground">Stessa ora su tutte le reti scelte: Edge le mette in coda.</p>
            </div>
          )}
          {modo === "finestra" && (quadro.finestraDisponibile ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="inline-flex items-center gap-2">dalle <input aria-label="dalle" className={cn(campo, "w-20 font-mono")} value={dalle} onChange={(e) => setDalle(e.target.value)} /></label>
              <label className="inline-flex items-center gap-2">alle <input aria-label="alle" className={cn(campo, "w-20 font-mono")} value={alle} onChange={(e) => setAlle(e.target.value)} /></label>
              <span className="inline-flex items-center gap-1" role="group" aria-label="Giorni">
                {GIORNI.map((g) => {
                  const on = giorni.includes(g.n);
                  return (
                    <button
                      key={g.n}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGiorni(on ? giorni.filter((x) => x !== g.n) : [...giorni, g.n])}
                      className={cn("h-9 min-w-10 rounded-md border text-[13px]", on ? "border-[#0D2537] bg-[#0D2537] font-semibold text-white" : "bg-card")}
                    >
                      {g.nome}
                    </button>
                  );
                })}
              </span>
              <label className="inline-flex items-center gap-2">Ripeti
                <select className={campo} value={ripeti} onChange={(e) => setRipeti(e.target.value as "settimana" | "mese")}>
                  <option value="settimana">Ogni settimana</option>
                  <option value="mese">Ogni mese</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2">Invio a Vulcan
                <select className={campo} value={invio} onChange={(e) => setInvio(e.target.value as InvioFinestra)}>
                  {INVII.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2">IP per gruppo <input aria-label="IP per gruppo" type="number" min={1} max={20} className={cn(campo, "w-16 font-mono")} value={ipPerGruppo} onChange={(e) => setIpPerGruppo(e.target.value)} /></label>
              <label className="inline-flex items-center gap-2">Tentativi <input aria-label="Tentativi" type="number" min={1} max={10} className={cn(campo, "w-16 font-mono")} value={tentativi} onChange={(e) => setTentativi(e.target.value)} /></label>
            </div>
          ) : (
            <Stato tono="spento">● {SONDA_DA_AGGIORNARE}</Stato>
          ))}

          {reteCambiate.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Stato tono="avviso">▲ Cambia ciò che è salvato su</Stato> {reteCambiate.join(", ")}
            </p>
          )}
          {rifiuto && <p role="alert" className="text-sm font-semibold"><Stato tono="avviso">▲ {rifiuto}</Stato></p>}

          <div className="flex flex-wrap items-center justify-end gap-4">
            <span className="text-[15px]"><strong>{voceScelta?.nome}</strong> · {quante} · {nomeAmbito}</span>
            <Button
              size="lg"
              disabled={manca !== null || lanciando || edge.stato !== "acceso"}
              title={manca ?? undefined}
              onClick={() => void lancia(scelteValide.map(({ r }) => r.id))}
            >
              {lanciando && <Loader2 className="size-4 animate-spin" />}
              {manca === "Solo lettura" ? "Solo lettura" : azione}
            </Button>
          </div>
        </div>
      </Pannello>

      {esiti && <EsitoLancio esiti={esiti} occupato={lanciando} onRiprova={(ids) => void lancia(ids)} />}
    </div>
  );
}

function RigaRete({ r, c, scelta, onCambia, voci }: { r: ReteScansione; c: Cambio; scelta: boolean; onCambia: () => void; voci: VoceRisolta[] }) {
  const profilo = voci.find((v) => v.assessmentId === r.assessmentId)?.moduliNome?.split(",")[0] ?? r.assessmentId ?? "—";
  const ultima = r.sonda === "errore" ? "non letta" : r.ultimaVa ? dataBreve(r.ultimaVa) : "mai";
  return (
    <tr className={cn("border-b", scelta && "bg-selezione", c.blocca && "text-muted-foreground")}>
      <td className="px-3 py-1.5">
        <Checkbox aria-label={r.nome} checked={scelta} disabled={c.blocca} onCheckedChange={onCambia} />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">
        <Link href={`/networks/${r.id}`} className="hover:underline">{r.nome}</Link>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{r.cidr}</td>
      <td className="px-3 py-1.5 font-mono text-[13px]">{r.vlan ?? "—"}</td>
      <td className="px-3 py-1.5 font-mono text-[13px]">{r.hostOnline}</td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{ultima}</td>
      <td className="px-3 py-1.5">{r.piano?.testo ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-1.5">{profilo}</td>
      <td className="whitespace-nowrap px-3 py-1.5"><ColonnaCambio c={c} /></td>
    </tr>
  );
}
