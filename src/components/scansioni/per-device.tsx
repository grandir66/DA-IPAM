"use client";

/**
 * Scheda «Per device» della pagina Scansioni VA (tavola approvata il 06/11/2026, oggetti 2-22):
 * 1 Rete → 2 Famiglie → 3 Device → 4 Lancio. Qui non si decide niente: famiglie, profili e conferme
 * vengono dal server, e il lancio rilegge tutto dal database. Le rotte sono `proposte-va` della rete.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InCorso, Pannello, TesseraNumero, VoceSelezionabile, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import type { EsitoGruppiAperti, GruppoAperto } from "@/lib/vuln/proposta/gruppi-aperti";
import type { EsitoLancio } from "@/lib/vuln/proposta/lancio";
import type { RigaFamiglia } from "@/lib/vuln/proposta/quadro";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import type { ContoProposte, RigaProposta } from "@/lib/vuln/proposta/store";
import { parolaEsito, type TonoStato } from "@/lib/vuln/proposta/testi-esito";
import type { QuadroScansioni, ReteScansione } from "@/lib/vuln/scansioni-va-regole";
import { Stato } from "./stato-va";

interface RispostaProposte {
  proposte: RigaProposta[];
  famiglie: RigaFamiglia[];
  aggiornata_il: string | null;
}

/** Ogni quanto si rilegge a che punto sono i gruppi, solo mentre ce n'è uno aperto. */
const OGNI_MS = 15000;
const DOVE_EDGE = "/settings?tab=moduli";
const campo = "h-8 rounded-md border bg-background px-2 text-sm";

function dataBreve(v: string): string {
  return parseDbDate(v).toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statoRete(r: ReteScansione, c: ContoProposte | undefined): { testo: string; tono: TonoStato } {
  if (r.attivita === "in_corso") return { testo: "▶ In corso", tono: "in_corso" };
  if (r.attivita === "in_coda") return { testo: "● In coda", tono: "ok" };
  if (!c || c.totale === 0) return { testo: "● Senza proposta", tono: "spento" };
  if (c.daRivedere > 0) return { testo: `▲ ${c.daRivedere} da rivedere`, tono: "avviso" };
  if (c.confermate === 0) return { testo: "▲ Da confermare", tono: "avviso" };
  return { testo: `✓ ${c.confermate} confermati`, tono: "ok" };
}

function statoFamiglia(f: RigaFamiglia): { testo: string; tono: TonoStato } {
  if (f.fuori === "mai") return { testo: "✕ Mai scansionati", tono: "errore" };
  if (f.fuori === "chiarire") return { testo: "▲ Fuori finché non si chiarisce", tono: "avviso" };
  if (f.confermati === 0) return { testo: "● Da confermare", tono: "spento" };
  if (f.confermati < f.device) return { testo: `▲ ${f.confermati} su ${f.device}`, tono: "avviso" };
  return { testo: "✓ Pronto", tono: "ok" };
}

function statoDevice(r: RigaProposta): { testo: string; tono: TonoStato } {
  if (r.famiglia === "impianti") return { testo: "✕ Fuori", tono: "errore" };
  if (r.famiglia === "da_chiarire") return { testo: "▲ Da chiarire", tono: "avviso" };
  if (r.da_rivedere) return { testo: "▲ Da rivedere", tono: "avviso" };
  if (r.stato === "confermato") return { testo: "✓ Confermato", tono: "ok" };
  if (r.stato === "escluso") return { testo: "● Escluso", tono: "spento" };
  return { testo: "● Proposto", tono: "spento" };
}

const PAROLE_APERTO: Record<GruppoAperto["stato"], { testo: string; tono: TonoStato }> = {
  in_corso: { testo: "▶ In corso", tono: "in_corso" },
  in_coda: { testo: "● In coda", tono: "ok" },
  finito: { testo: "✓ Finito", tono: "ok" },
  errore: { testo: "✕ In errore", tono: "errore" },
  sconosciuto: { testo: "▲ Non più sulla sonda", tono: "avviso" },
};

function GruppiAperti({ gruppi }: { gruppi: GruppoAperto[] }) {
  return (
    <Pannello titolo="Gruppi di questa rete" conteggio={`${gruppi.length}`} sottotitolo="Edge ne fa uno alla volta." corpoClassName="p-0">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted text-left text-[13px]">
          <tr>{["Gruppo", "Device", "Stato", "Avanzamento"].map((t) => <th key={t} className="px-3 py-2 font-semibold">{t}</th>)}</tr>
        </thead>
        <tbody>
          {gruppi.map((g) => (
            <tr key={g.scan_id} className="border-b">
              <td className="px-3 py-1.5 font-semibold">{g.nome}</td>
              <td className="px-3 py-1.5 font-mono text-[13px]">{g.device}</td>
              <td className="px-3 py-1.5" title={g.messaggio ?? undefined}><Stato tono={PAROLE_APERTO[g.stato].tono}>{PAROLE_APERTO[g.stato].testo}</Stato></td>
              <td className="px-3 py-1.5 font-mono text-[13px]">
                {g.stato === "in_corso" && g.percento !== null ? `${g.percento}%` : g.stato === "in_corso" && g.finiti !== null ? `${g.finiti} su ${g.device}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Pannello>
  );
}

function EsitoGruppi({ esito, nomeRete, nomi, occupato, onRiprova }: { esito: EsitoLancio; nomeRete: string; nomi: Partial<Record<Famiglia, string>>; occupato: boolean; onRiprova: (f: Famiglia[]) => void }) {
  const righe = esito.gruppi.map((g) => ({ g, p: parolaEsito(g.esito) }));
  const partiti = righe.filter(({ g }) => g.esito.stato === "lanciato").length;
  const daRifare = righe.filter(({ p }) => p.azione === "riprova").map(({ g }) => g.famiglia);
  const tolti = [
    ...esito.tolti.map((t) => ({ ip: t.ip, chi: "DA-IPAM", motivo: t.motivo })),
    ...esito.gruppi.flatMap((g) =>
      "ip_tolti" in g.esito ? g.esito.ip_tolti.map((ip) => ({ ip, chi: "Edge", motivo: "Freno degli impianti: tolto dalla sonda prima di partire." })) : [],
    ),
  ];
  return (
    <>
      <Pannello
        titolo={`Esito del lancio su ${nomeRete}`}
        conteggio={`${partiti} su ${righe.length}`}
        corpoClassName="p-0"
        azioni={daRifare.length > 0 ? (
          <Button size="sm" variant="outline" disabled={occupato} onClick={() => onRiprova(daRifare)}>
            Riprova su {daRifare.length === 1 ? "1 gruppo" : `${daRifare.length} gruppi`}
          </Button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted text-left text-[13px]">
              <tr>{["Gruppo", "Device", "Esito", "Scansione", "Cosa è successo", ""].map((t) => <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>)}</tr>
            </thead>
            <tbody>
              {righe.map(({ g, p }) => (
                <tr key={g.famiglia} className="border-b">
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{nomi[g.famiglia] ?? g.famiglia}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{g.ips.length}</td>
                  <td className="px-3 py-1.5"><Stato tono={p.tono}>{p.parola}</Stato></td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{p.scan ?? "—"}</td>
                  <td className="px-3 py-1.5">{p.testo}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {p.azione === "edge" && <Link href={DOVE_EDGE} className="text-sm font-semibold text-cian-testo hover:underline">Vai al modulo Edge ›</Link>}
                  </td>
                </tr>
              ))}
              {righe.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Nessun gruppo partito.</td></tr>}
            </tbody>
          </table>
        </div>
      </Pannello>
      {(tolti.length > 0 || esito.avvisi.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {tolti.length > 0 && (
            <Pannello titolo="Tolti dal lancio" conteggio={`${tolti.length}`} sottotitolo="Confermati, ma non scansionati." corpoClassName="p-0">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted text-left text-[13px]">
                  <tr>{["IP", "Chi l'ha tolto", "Perché"].map((t) => <th key={t} className="px-3 py-2 font-semibold">{t}</th>)}</tr>
                </thead>
                <tbody>
                  {tolti.map((t) => (
                    <tr key={`${t.chi}-${t.ip}`} className="border-b">
                      <td className="px-3 py-1.5 font-mono text-[13px]">{t.ip}</td>
                      <td className="px-3 py-1.5">{t.chi}</td>
                      <td className="px-3 py-1.5">{t.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Pannello>
          )}
          {esito.avvisi.length > 0 && (
            <Pannello titolo="Avvisi" sottotitolo="Il gruppo è partito, ma con meno controlli.">
              <ul className="flex flex-col gap-1.5 text-sm">{esito.avvisi.map((a) => <li key={a}>{a}</li>)}</ul>
            </Pannello>
          )}
        </div>
      )}
    </>
  );
}

function RigaDevice({ r, amministratore, profonditaFissa, occupato, onScegli, onRiapri, onVoce }: {
  r: RigaProposta;
  amministratore: boolean;
  profonditaFissa: boolean;
  occupato: boolean;
  onScegli: (stato: "confermato" | "escluso") => void;
  onRiapri: () => void;
  onVoce: (voce: "veloce" | "bilanciato") => void;
}) {
  const s = statoDevice(r);
  const attiva = r.famiglia !== "impianti" && r.famiglia !== "da_chiarire";
  const bottone = (acceso: boolean) => cn("min-h-7 rounded border px-2.5 text-[13px] font-semibold", acceso ? "border-[#0D2537] bg-[#0D2537] text-white" : "border-muted-foreground bg-card");
  return (
    <tr className={cn("border-b", !attiva && "bg-muted/40")}>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{r.ip}</td>
      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{r.nome ?? "—"}</td>
      <td className="min-w-56 px-3 py-1.5">{r.motivo}</td>
      <td className="px-3 py-1.5">{r.con_web ? "✓" : "—"}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {!attiva ? "—" : profonditaFissa || !amministratore ? (r.voce === "veloce" ? "Veloce" : "Bilanciato") : (
          <select
            aria-label={`Profondità di ${r.ip}`}
            className={campo}
            disabled={occupato || !!r.da_rivedere}
            value={r.voce === "veloce" ? "veloce" : "bilanciato"}
            onChange={(e) => onVoce(e.target.value === "veloce" ? "veloce" : "bilanciato")}
          >
            <option value="bilanciato">Bilanciato</option>
            <option value="veloce">Veloce</option>
          </select>
        )}
      </td>
      <td className="px-3 py-1.5"><Stato tono={s.tono}>{s.testo}</Stato></td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          {attiva && amministratore && (r.da_rivedere ? (
            <button type="button" disabled={occupato} className={bottone(false)} onClick={onRiapri}>Prendi il nuovo tipo</button>
          ) : (
            <>
              <button type="button" disabled={occupato} aria-pressed={r.stato === "confermato"} className={bottone(r.stato === "confermato")} onClick={() => onScegli("confermato")}>Conferma</button>
              <button type="button" disabled={occupato} aria-pressed={r.stato === "escluso"} className={bottone(r.stato === "escluso")} onClick={() => onScegli("escluso")}>Escludi</button>
            </>
          ))}
          <Link href={`/hosts/${r.host_id}`} className="text-[13px] text-cian-testo hover:underline">Cambia tipo ›</Link>
        </span>
      </td>
    </tr>
  );
}

export function PerDevice({ quadro, amministratore, onRileggi }: { quadro: QuadroScansioni; amministratore: boolean; onRileggi: () => Promise<void> }) {
  const [conti, setConti] = useState<Record<number, ContoProposte>>({});
  const [reteId, setReteId] = useState<number | null>(null);
  const [dati, setDati] = useState<RispostaProposte | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [famiglia, setFamiglia] = useState<Famiglia | null>(null);
  const [spente, setSpente] = useState<Set<Famiglia>>(new Set());
  const [cerca, setCerca] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [rifiuto, setRifiuto] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [esito, setEsito] = useState<EsitoLancio | null>(null);
  const [gruppiAperti, setGruppiAperti] = useState<GruppoAperto[]>([]);
  const [apertiDetto, setApertiDetto] = useState<string | null>(null);
  const [erroreConti, setErroreConti] = useState<string | null>(null);
  const reteCorrente = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inLettura = useRef(false);

  const leggiConti = useCallback(async () => {
    const r = await fetchJson<{ conti: Record<number, ContoProposte> }>("/api/vulnerabilities/proposte-reti");
    if (!r.ok) {
      setErroreConti(r.message);
      return;
    }
    setErroreConti(null);
    setConti(r.data.conti);
    setReteId((v) => v ?? quadro.reti.find((n) => (r.data.conti[n.id]?.totale ?? 0) > 0)?.id ?? quadro.reti[0]?.id ?? null);
  }, [quadro.reti]);

  const leggiAperti = useCallback(async (id: number) => {
    if (inLettura.current) return; // un giro lento non ne accavalla un altro
    inLettura.current = true;
    const r = await fetchJson<EsitoGruppiAperti>(`/api/networks/${id}/proposte-va/gruppi`);
    inLettura.current = false;
    if (reteCorrente.current !== id) return;
    // Un guasto di passaggio non svuota il riquadro e non ferma i giri: resta l'ultimo stato letto, e si dice.
    if (!r.ok) setApertiDetto(r.message);
    else if (r.data.stato === "errore") setApertiDetto(r.data.messaggio);
    else if (r.data.stato === "da_aggiornare") setApertiDetto("Questa sonda non dice ancora a che punto sono i gruppi: va aggiornata.");
    else {
      setApertiDetto(null);
      setGruppiAperti(r.data.gruppi);
    }
  }, []);

  const leggi = useCallback(async (id: number) => {
    const r = await fetchJson<RispostaProposte>(`/api/networks/${id}/proposte-va`);
    if (reteCorrente.current !== id) return;
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, []);

  useEffect(() => {
    void leggiConti();
  }, [leggiConti]);

  useEffect(() => {
    reteCorrente.current = reteId;
    setDati(null);
    setFamiglia(null);
    setSpente(new Set());
    setEsito(null);
    setGruppiAperti([]);
    setApertiDetto(null);
    setRifiuto(null);
    setNota(null);
    setErrore(null);
    if (reteId === null) return;
    void leggi(reteId);
    void leggiAperti(reteId);
  }, [reteId, leggi, leggiAperti]);

  const haAperti = gruppiAperti.some((g) => g.stato === "in_corso" || g.stato === "in_coda");
  useEffect(() => {
    if (!haAperti || reteId === null) return;
    timer.current = setInterval(() => void leggiAperti(reteId), OGNI_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [haAperti, reteId, leggiAperti]);

  const rete = quadro.reti.find((r) => r.id === reteId) ?? null;
  const famiglie = useMemo(() => dati?.famiglie ?? [], [dati]);
  const famigliaVista = famiglie.find((f) => f.famiglia === famiglia) ?? famiglie[0] ?? null;
  const proposte = useMemo(() => dati?.proposte ?? [], [dati]);
  const device = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return proposte.filter((r) => r.famiglia === famigliaVista?.famiglia && (!q || `${r.ip} ${r.nome ?? ""}`.toLowerCase().includes(q)));
  }, [proposte, famigliaVista, cerca]);

  const inLancio = famiglie.filter((f) => !f.fuori && f.confermati > 0 && !spente.has(f.famiglia));
  const nInLancio = inLancio.reduce((t, f) => t + f.confermati, 0);
  const somma = (k: "esclusi" | "inAttesa" | "daRivedere") => famiglie.reduce((t, f) => t + f[k], 0);
  const conteggio = (f: Famiglia) => famiglie.find((x) => x.famiglia === f)?.device ?? 0;

  const dopoScelta = async (corpo: Record<string, unknown>) => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<RispostaProposte & { rifiutate?: number[]; riaperte?: number }>(`/api/networks/${id}/proposte-va`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (reteCorrente.current !== id) {
      setOccupato(false);
      return;
    }
    if (r.ok) {
      setDati(r.data);
      if (r.data.rifiutate?.length) setRifiuto(`${r.data.rifiutate.length} device non confermati: lo stato è cambiato, rileggi la proposta.`);
      const chiesti = Array.isArray(corpo.host_ids) ? corpo.host_ids.length : 0;
      if (corpo.stato === "riapri" && (r.data.riaperte ?? 0) < chiesti) setRifiuto(`${chiesti - (r.data.riaperte ?? 0)} device non aggiornati: non sono online.`);
      await leggiConti();
    } else {
      setRifiuto(r.message);
    }
    setOccupato(false);
  };

  const rigenera = async () => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<RispostaProposte & { scritte: number; daRivedere: number }>(`/api/networks/${id}/proposte-va`, { method: "POST" });
    if (reteCorrente.current !== id) {
      setOccupato(false);
      return;
    }
    if (r.ok) {
      setDati(r.data);
      setNota(`Proposta rigenerata: ${r.data.scritte} righe scritte, ${r.data.daRivedere} da rivedere.`);
      await leggiConti();
    } else {
      setRifiuto(r.message);
    }
    setOccupato(false);
  };

  const ricognizione = async () => {
    if (reteId === null) return;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<{ id: string }>("/api/scans/sequenza", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: reteId, sequenza: "ricognizione" }),
    });
    if (r.ok) setNota("Ricognizione avviata: a fine giro usa «Rigenera proposta».");
    else setRifiuto(r.message);
    setOccupato(false);
  };

  const lancia = async (scelte: Famiglia[]) => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<EsitoLancio>(`/api/networks/${id}/proposte-va/lancia?famiglie=${scelte.join(",")}`, { method: "POST" });
    if (reteCorrente.current === id) {
      if (r.ok) setEsito(r.data);
      else setRifiuto(r.status === 502 ? `Nessun gruppo partito. ${r.message}` : r.message);
      await leggiAperti(id);
    }
    await Promise.all([leggiConti(), onRileggi()]);
    setOccupato(false);
  };

  const manca = !amministratore ? "Solo lettura" : quadro.edge.stato !== "acceso" ? "Edge non risponde" : inLancio.length === 0 ? "Conferma almeno un device" : null;
  const senzaProposta = dati !== null && dati.proposte.length === 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Device online" valore={dati ? proposte.length : null} qualifica={rete?.nome} />
        <TesseraNumero titolo="Confermati" valore={dati ? nInLancio : null} />
        <TesseraNumero titolo="Restano fuori" valore={dati ? proposte.length - nInLancio : null} />
        <TesseraNumero titolo="Gruppi aperti" valore={gruppiAperti.filter((g) => g.stato === "in_corso" || g.stato === "in_coda").length} nota="Edge fa una scansione alla volta" />
      </div>

      {haAperti && <GruppiAperti gruppi={gruppiAperti} />}
      {apertiDetto && <p className="text-sm"><Stato tono="avviso">▲ Gruppi aperti: {apertiDetto}</Stato></p>}
      {erroreConti && <LoadError what="l'elenco delle reti" message={erroreConti} onRetry={() => void leggiConti()} />}

      <div className="grid gap-3 lg:grid-cols-12">
        <Pannello numero={1} titolo="Rete" className="lg:col-span-3">
          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
            {quadro.reti.map((r) => {
              const s = statoRete(r, conti[r.id]);
              return (
                <VoceSelezionabile key={r.id} scelta={r.id === reteId} onScegli={() => { if (!occupato) setReteId(r.id); }}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">{r.nome}</span>
                    <span className="font-mono text-[13px]">{r.cidr}</span>
                  </span>
                  <span className="mt-1 block"><Stato tono={s.tono}>{s.testo}</Stato></span>
                </VoceSelezionabile>
              );
            })}
            {quadro.reti.length === 0 && <Vuoto titolo="Nessuna rete" testo="Le reti si aggiungono dalla pagina Reti." />}
          </div>
        </Pannello>

        <Pannello
          numero={2}
          titolo="Famiglie"
          className="lg:col-span-9"
          sottotitolo="Una riga per tipo di device: si sceglie quali gruppi lanciare."
          corpoClassName="p-0"
          piede={famiglie.some((f) => f.scesa) ? "▼ vuol dire scesa rispetto alla proposta: basta un device con una scelta più bassa e scende tutto il gruppo." : undefined}
          azioni={
            <>
              {dati?.aggiornata_il && <span className="text-sm text-muted-foreground">Proposta del <span className="font-mono text-[13px]">{dataBreve(dati.aggiornata_il)}</span></span>}
              {amministratore && <Button size="sm" variant="outline" disabled={occupato || reteId === null} onClick={() => void ricognizione()}>{senzaProposta ? "Avvia ricognizione" : "Rifai ricognizione"}</Button>}
              {amministratore && <Button size="sm" variant="outline" disabled={occupato || reteId === null} onClick={() => void rigenera()}>Rigenera proposta</Button>}
            </>
          }
        >
          {errore && <LoadError what="la proposta" message={errore} onRetry={() => reteId !== null && void leggi(reteId)} />}
          {!errore && dati === null && reteId !== null && <InCorso titolo="Lettura della proposta" />}
          {senzaProposta && (
            <Vuoto titolo="Questa rete non ha ancora una proposta" testo="Prima la ricognizione delicata: costruttori dal router, poi solo porte aperte. A fine giro: Rigenera proposta." />
          )}
          {famiglie.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted text-left text-[13px]">
                  <tr>{["Lancia", "Famiglia", "Device", "Confermati", "Greenbone", "Nuclei", "Moduli", "Stato"].map((t) => <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>)}</tr>
                </thead>
                <tbody>
                  {famiglie.map((f) => {
                    const s = statoFamiglia(f);
                    const vista = f.famiglia === famigliaVista?.famiglia;
                    return (
                      <tr key={f.famiglia} className={cn("cursor-pointer border-b", vista && "bg-selezione", !vista && f.fuori && "bg-muted/40")} onClick={() => setFamiglia(f.famiglia)}>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Lancia il gruppo ${f.nome}`}
                            checked={!f.fuori && f.confermati > 0 && !spente.has(f.famiglia)}
                            disabled={!amministratore || !!f.fuori || f.confermati === 0}
                            onCheckedChange={(v) => setSpente((p) => {
                              const n = new Set(p);
                              if (v === true) n.delete(f.famiglia);
                              else n.add(f.famiglia);
                              return n;
                            })}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-semibold"><button type="button" className="font-semibold hover:underline" aria-pressed={vista} onClick={() => setFamiglia(f.famiglia)}>{f.nome}</button></td>
                        <td className="px-3 py-1.5 font-mono text-[13px]">{f.device}</td>
                        <td className="px-3 py-1.5 font-mono text-[13px]">{f.fuori ? "—" : f.confermati}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.greenbone}{f.scesa ? " ▼" : ""}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.nuclei}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.moduli}</td>
                        <td className="px-3 py-1.5"><Stato tono={s.tono}>{s.testo}</Stato></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      {nota && <p className="text-sm"><Stato tono="ok">● {nota}</Stato></p>}
      {rifiuto && <p role="alert" className="text-sm"><Stato tono="avviso">▲ {rifiuto}</Stato></p>}

      {famigliaVista && (
        <Pannello
          numero={3}
          titolo={`Device di ${famigliaVista.nome}`}
          conteggio={`${famigliaVista.device}`}
          sottotitolo={famigliaVista.fuori === "mai"
            ? "Si elencano per sapere chi è rimasto fuori. Nessun pacchetto da Greenbone, nuclei o moduli."
            : famigliaVista.fuori === "chiarire"
              ? "Non partono finché non si dice cosa sono."
              : `${famigliaVista.confermati} confermati`}
          corpoClassName="p-0"
          azioni={
            <>
              {amministratore && !famigliaVista.fuori && famigliaVista.daRivedere > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={occupato}
                  onClick={() => void dopoScelta({ host_ids: proposte.filter((r) => r.famiglia === famigliaVista.famiglia && r.da_rivedere).map((r) => r.host_id), stato: "riapri" })}
                >
                  Prendi i {famigliaVista.daRivedere} nuovi tipi
                </Button>
              )}
              {amministratore && !famigliaVista.fuori && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={occupato}
                  onClick={() => {
                    const ids = proposte.filter((r) => r.famiglia === famigliaVista.famiglia && r.stato !== "escluso" && !r.da_rivedere).map((r) => r.host_id);
                    if (ids.length > 0) void dopoScelta({ host_ids: ids, stato: "confermato" });
                  }}
                >
                  Conferma tutti
                </Button>
              )}
              <span className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input aria-label="Cerca un device" placeholder="Cerca IP o nome" className="h-9 w-52 pl-8" value={cerca} onChange={(e) => setCerca(e.target.value)} />
              </span>
            </>
          }
        >
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-[13px]">
                <tr>{["IP", "Nome", "Perché questa famiglia", "Web", "Profondità", "Stato", "Azioni"].map((t) => <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>)}</tr>
              </thead>
              <tbody>
                {device.map((r) => (
                  <RigaDevice
                    key={r.host_id}
                    r={r}
                    amministratore={amministratore}
                    profonditaFissa={r.famiglia === "periferiche"}
                    occupato={occupato}
                    onScegli={(stato) => void dopoScelta({ host_ids: [r.host_id], stato })}
                    onRiapri={() => void dopoScelta({ host_ids: [r.host_id], stato: "riapri" })}
                    onVoce={(voce) => void dopoScelta({ host_ids: [r.host_id], stato: r.stato === "escluso" ? "escluso" : "confermato", voce })}
                  />
                ))}
                {device.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Nessun device corrisponde alla ricerca.</td></tr>}
              </tbody>
            </table>
          </div>
        </Pannello>
      )}

      {famiglie.length > 0 && (
        <Pannello numero={4} titolo="Lancio" sottotitolo="Parte adesso. Edge fa un gruppo alla volta, gli altri restano in coda.">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Restano fuori:
              {conteggio("impianti") > 0 && <Stato tono="errore">✕ {conteggio("impianti")} impianti</Stato>}
              {conteggio("da_chiarire") > 0 && <Stato tono="avviso">▲ {conteggio("da_chiarire")} da chiarire</Stato>}
              {somma("daRivedere") > 0 && <Stato tono="avviso">▲ {somma("daRivedere")} da rivedere</Stato>}
              {somma("esclusi") > 0 && <Stato tono="spento">● {somma("esclusi")} esclusi</Stato>}
              {somma("inAttesa") > 0 && <Stato tono="spento">● {somma("inAttesa")} non confermati</Stato>}
            </span>
            <span className="flex-1" />
            <span className="text-[15px]"><strong>{inLancio.length === 1 ? "1 gruppo" : `${inLancio.length} gruppi`}</strong> · {nInLancio} device</span>
            <Button size="lg" disabled={manca !== null || occupato} title={manca ?? undefined} onClick={() => void lancia(inLancio.map((f) => f.famiglia))}>
              {occupato && <Loader2 className="size-4 animate-spin" />}
              {manca ?? `Avvia ${inLancio.length === 1 ? "1 gruppo" : `${inLancio.length} gruppi`} su ${rete?.nome ?? ""}`}
            </Button>
          </div>
        </Pannello>
      )}

      {esito && <EsitoGruppi esito={esito} nomeRete={rete?.nome ?? ""} nomi={Object.fromEntries(famiglie.map((f) => [f.famiglia, f.nome]))} occupato={occupato} onRiprova={(f) => void lancia(f)} />}
    </>
  );
}
