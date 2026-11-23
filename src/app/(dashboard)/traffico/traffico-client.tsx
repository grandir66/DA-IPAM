"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { BarraStato, Etichetta, Pannello, SchedePagina, TempoRelativo, TesseraNumero, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import type { AnomaliaTraffico, StatoAnomalia } from "@/lib/traffico/anomalie";
import { fraseAnomalia, GRAVITA, macAnomalia, NOME_TIPO, protoPorta, TIPI } from "@/lib/traffico/frasi";
import type { NomeDiIp, QuadroTraffico } from "@/lib/traffico/quadro";
import { cn } from "@/lib/utils";
import { CLASSE_GRAVITA, Indirizzo, SegnoGravita } from "./pezzi";
import { CollectorEControlli } from "./collector-controlli";
import { Insieme } from "./insieme";
import { RetiViste } from "./reti-viste";
import { Esterno } from "./esterno";
import { CosaNonVa } from "./cosa-non-va";

interface Dati {
  anomalie: AnomaliaTraffico[];
  totale: number;
  pagina: number;
  perPagina: number;
  nomi: Record<string, NomeDiIp>;
  quadro: QuadroTraffico;
}
type Scheda = "insieme" | "esterno" | "nonva" | "anomalie" | "reti" | "collector";
type FiltroStato = StatoAnomalia | "";

const NOME_STATO: Record<StatoAnomalia, string> = { nuova: "Nuove", vista: "Viste", normale: "Normali" };
const TUTTI = "tutti";

function giornoBreve(s: string): string {
  return parseDbDate(s).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

export function TrafficoClient({ iniziale, admin }: { iniziale: Dati; admin: boolean }) {
  const [dati, setDati] = useState<Dati>(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [scheda, setScheda] = useState<Scheda>("insieme");
  const [stato, setStato] = useState<FiltroStato>("nuova");
  const [gravita, setGravita] = useState(0);
  const [tipo, setTipo] = useState<string>(TUTTI);
  const [pagina, setPagina] = useState(1);
  const primo = useRef(true);
  const [reteScelta, setReteScelta] = useState<string | undefined>(undefined);
  const [senzaNome, setSenzaNome] = useState(0);

  const contaSenzaNome = useCallback(async () => {
    const r = await fetchJson<{ reti: { nome: string | null }[] }>("/api/traffico/reti-viste?giorni=7", { cache: "no-store" });
    if (r.ok) setSenzaNome(r.data.reti.filter((x) => x.nome === null).length);
  }, []);
  useEffect(() => { void contaSenzaNome(); }, [contaSenzaNome]);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (stato) q.set("stato", stato);
    if (gravita) q.set("gravita", String(gravita));
    if (tipo !== TUTTI) q.set("tipo", tipo);
    const r = await fetchJson<Dati>(`/api/traffico/anomalie?${q.toString()}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [pagina, stato, gravita, tipo]);

  useEffect(() => {
    // la prima pagina arriva già dal server
    if (primo.current) { primo.current = false; return; }
    void carica();
  }, [carica]);

  const segna = async (id: number, nuovo: "vista" | "normale") => {
    const r = await fetchJson<{ ok: boolean }>(`/api/traffico/anomalie/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stato: nuovo }),
    });
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(nuovo === "normale" ? "Segnata come normale: non verrà più segnalata" : "Segnata come vista");
    await carica();
  };

  const q = dati.quadro;
  const daGuardare = q.nuove.alta + q.nuove.media;
  const filtro = <T,>(v: T, set: (v: T) => void) => () => { set(v); setPagina(1); };
  const pagine = Math.max(1, Math.ceil(dati.totale / dati.perPagina));
  const soloAdmin = admin ? undefined : "Serve un amministratore";

  return (
    <div className="space-y-4">
      {q.collector.length === 0 ? (
        <Vuoto
          titolo="Nessun collector registrato"
          testo="Il collector è la macchina che ascolta la copia del traffico dello switch. Finché non ce n'è uno, qui non arriva niente."
          azione={admin ? <Button size="sm" onClick={() => setScheda("collector")}>Registra un collector</Button> : undefined}
        />
      ) : (
        <div className="space-y-2">
          {q.collector.map((c) => (
            <BarraStato
              key={c.id}
              acceso={c.attivo}
              titolo={`${c.nome}${c.sede ? ` · ${c.sede}` : ""}`}
              dettagli={[
                c.ultimo_contatto ? `ultimo contatto ${parseDbDate(c.ultimo_contatto).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "mai sentito",
                c.copertura === null ? "copertura —" : `copertura ${(c.copertura * 100).toFixed(c.copertura >= 0.9995 ? 0 : 1)}%`,
                ...(c.motore ? [`${c.profilo === "avanzato" ? "sonda avanzata" : "sonda leggera"} · ${c.motore === "zeek" ? "Zeek" : "pmacct"}${c.versione_motore ? ` ${c.versione_motore}` : ""}`] : []),
                ...(c.freno === 1 ? ["▲ Zeek fermo per il disco pieno"] : []),
                ...(c.ultimo_errore ? [`✕ ${c.ultimo_errore}`] : []),
                ...(c.ultimo_buco ? [`▲ dati persi il ${giornoBreve(c.ultimo_buco)}`] : []),
              ]}
            />
          ))}
        </div>
      )}

      {q.apprendimento.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#C9A800] bg-card px-4 py-2.5 text-sm" role="status">
          <span className="font-semibold" title="Nei primi 14 giorni di una rete si impara chi parla con chi: collegamenti e porte nuove non vengono segnalati. Il resto sì.">
            In apprendimento
          </span>
          {q.apprendimento.map((r) => (
            <span key={r.network_id} className="flex items-center gap-1.5">
              <Etichetta tono="ruolo" mono={false}>{r.nome}</Etichetta>
              {r.cidr && <span className="font-mono text-[13px]">{r.cidr}</span>}
              <span className="text-[13px] text-muted-foreground">fino al {giornoBreve(r.fino_al)}</span>
            </span>
          ))}
        </div>
      )}

      <SchedePagina<Scheda>
        etichetta="Traffico"
        scelta={scheda}
        onScegli={setScheda}
        voci={[
          { valore: "insieme", titolo: "Chi parla con chi", descrizione: "Il traffico sulla rete intera: fra reti, per host, per coppia." },
          { valore: "esterno", titolo: "Verso l'esterno", descrizione: "Con chi fuori parlano gli host: per nome, paese e fornitore." },
          { valore: "nonva", titolo: "Cosa non va", descrizione: "Chi bussa a vuoto, i servizi che non rispondono, i servizi lenti." },
          {
            valore: "anomalie", titolo: "Anomalie", descrizione: "Quello che è uscito dall'abitudine o è passato in chiaro.",
            segnale: daGuardare > 0 ? <span className={cn("ml-1.5 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold", CLASSE_GRAVITA[q.nuove.alta > 0 ? 3 : 2])}>{GRAVITA[q.nuove.alta > 0 ? 3 : 2].segno} {daGuardare}</span> : undefined,
          },
          {
            valore: "reti", titolo: "Reti viste", descrizione: "Indirizzi interni che parlano fuori dalle subnet censite: a ogni rete si può dare un nome.",
            segnale: senzaNome > 0 ? <span className="ml-1.5 rounded-md border bg-muted px-1.5 py-0.5 text-[13px] font-semibold" title="Reti senza nome negli ultimi 7 giorni">{senzaNome}</span> : undefined,
          },
          ...(admin ? [{ valore: "collector" as const, titolo: "Collector e controlli", descrizione: "Le macchine che ascoltano e i controlli accesi, rete per rete." }] : []),
        ]}
      />

      {scheda === "insieme" ? (
        <Insieme key={reteScelta ?? "tutte"} conCollector={q.collector.length > 0} reteIniziale={reteScelta} />
      ) : scheda === "esterno" ? (
        <Esterno admin={admin} />
      ) : scheda === "nonva" ? (
        <CosaNonVa />
      ) : scheda === "reti" ? (
        <RetiViste admin={admin} onVediCoppie={(chiave) => { setReteScelta(chiave); setScheda("insieme"); }} onCambio={() => void contaSenzaNome()} />
      ) : scheda === "collector" && admin ? (
        <CollectorEControlli onCambio={() => void carica()} />
      ) : (
        <>
        <div className="grid grid-cols-3 gap-3">
          <TesseraNumero titolo="Gravità alta" valore={q.nuove.alta} qualifica={GRAVITA[3].segno} nota="nuove, da guardare per prime" />
          <TesseraNumero titolo="Gravità media" valore={q.nuove.media} qualifica={GRAVITA[2].segno} nota="nuove" />
          <TesseraNumero titolo="Gravità bassa" valore={q.nuove.bassa} qualifica={GRAVITA[1].segno} nota="nuove" />
        </div>
        <Pannello
          titolo="Anomalie"
          conteggio={dati.totale}
          sottotitolo="Le più gravi e recenti in alto. «È normale» insegna l'abitudine: quella coppia non torna più."
          corpoClassName="p-0"
          azioni={
            <>
              {(["nuova", "vista", "normale", ""] as FiltroStato[]).map((s) => (
                <Button key={s || "tutte"} size="sm" variant={stato === s ? "default" : "outline"} onClick={filtro(s, setStato)}>
                  {s ? NOME_STATO[s] : "Tutte"}
                </Button>
              ))}
              <span aria-hidden className="h-6 w-px bg-border" />
              {[0, 3, 2, 1].map((g) => (
                <Button key={g} size="sm" variant={gravita === g ? "default" : "outline"} onClick={filtro(g, setGravita)}>
                  {g ? `${GRAVITA[g].segno} ${GRAVITA[g].testo}` : "Ogni gravità"}
                </Button>
              ))}
              <span aria-hidden className="h-6 w-px bg-border" />
              <Select value={tipo} onValueChange={(v) => { setTipo(v ?? TUTTI); setPagina(1); }}>
                <SelectTrigger className="h-7 w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TUTTI}>Ogni tipo</SelectItem>
                  {TIPI.map((t) => <SelectItem key={t} value={t}>{NOME_TIPO[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Pagination inTesta page={pagina} totalPages={pagine} onPageChange={setPagina} total={dati.totale} />
            </>
          }
        >
          {errore !== null ? (
            <div className="p-3"><LoadError what="le anomalie del traffico" message={errore} onRetry={() => void carica()} /></div>
          ) : dati.anomalie.length === 0 ? (
            <div className="p-3">
              <Vuoto
                titolo={stato === "nuova" && !gravita && tipo === TUTTI ? "Nessuna anomalia nuova" : "Niente con questi filtri"}
                testo={q.collector.length === 0 ? "Senza un collector non arriva traffico da valutare." : "IPAM legge i collector ogni 5 minuti: quello che esce dall'abitudine compare qui."}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravità</TableHead>
                  <TableHead>Cosa è successo</TableHead>
                  <TableHead>Chi</TableHead>
                  <TableHead>Verso chi</TableHead>
                  <TableHead>Porta</TableHead>
                  <TableHead>Prima volta</TableHead>
                  <TableHead>Ultima volta</TableHead>
                  <TableHead className="text-right">Volte</TableHead>
                  {stato === "" && <TableHead>Stato</TableHead>}
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dati.anomalie.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><SegnoGravita gravita={a.gravita} /></TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <span className="block font-medium">{fraseAnomalia(a)}</span>
                      <span className="text-[13px] text-muted-foreground">{NOME_TIPO[a.tipo] ?? a.tipo}</span>
                      {macAnomalia(a) && <span className="block font-mono text-[13px]">{macAnomalia(a)}</span>}
                    </TableCell>
                    <TableCell><Indirizzo ip={a.client} nomi={dati.nomi} /></TableCell>
                    <TableCell><Indirizzo ip={a.server} nomi={dati.nomi} /></TableCell>
                    <TableCell className="font-mono">{protoPorta(a.proto, a.porta)}</TableCell>
                    <TableCell><TempoRelativo data={a.prima_vista} /></TableCell>
                    <TableCell><TempoRelativo data={a.ultima_vista} /></TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{a.conteggio}</TableCell>
                    {stato === "" && <TableCell>{a.stato}</TableCell>}
                    <TableCell className="space-x-1.5 text-right whitespace-nowrap">
                      {a.stato === "nuova" && (
                        <Button size="sm" variant="outline" disabled={!admin} title={soloAdmin ?? "L'ho guardata: resta in elenco fra le viste"} onClick={() => void segna(a.id, "vista")}>
                          Vista
                        </Button>
                      )}
                      {a.stato !== "normale" && (
                        <Button size="sm" variant="outline" disabled={!admin} title={soloAdmin ?? "Questo traffico è voluto: non segnalarlo più"} onClick={() => void segna(a.id, "normale")}>
                          È normale
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Pannello>
        </>
      )}
    </div>
  );
}
