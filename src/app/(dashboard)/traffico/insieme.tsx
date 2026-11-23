"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { Etichetta, Pannello, TempoRelativo, TesseraNumero, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte, protoPorta } from "@/lib/traffico/frasi";
import type { InsiemeTraffico, Servizio, Vista } from "@/lib/traffico/insieme";
import { Indirizzo } from "./pezzi";
import { Andamento } from "./andamento";

const TUTTE = "tutte";
const PERIODI: { giorni: number; testo: string }[] = [
  { giorni: 0, testo: "Ultima ora" },
  { giorni: 1, testo: "Oggi" },
  { giorni: 7, testo: "7 giorni" },
  { giorni: 30, testo: "30 giorni" },
];
const NOME_VISTA: Record<Vista, string> = { reti: "Fra reti", host: "Per host", coppie: "Per coppia" };
const PAROLE_RETE: Record<string, string> = { esterno: "Fuori dalla rete", diffusione: "A tutti (diffusione)", nessuna: "Rete non censita" };

function Servizi({ servizi }: { servizi: Servizio[] }) {
  if (servizi.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {servizi.map((s) => (
        <span key={`${s.proto}/${s.porta}`} className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[13px]" title={formattaByte(s.byte)}>
          {protoPorta(s.proto, s.porta)}
        </span>
      ))}
    </span>
  );
}

/** Il traffico sulla rete intera: fra reti, per host, per coppia. */
export function Insieme({ conCollector, reteIniziale }: { conCollector: boolean; reteIniziale?: string }) {
  const [dati, setDati] = useState<InsiemeTraffico | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorni, setGiorni] = useState(1);
  const [vista, setVista] = useState<Vista>(reteIniziale ? "coppie" : "reti");
  const [rete, setRete] = useState(reteIniziale ?? TUTTE);
  const [verso, setVerso] = useState<{ da: string; a: string } | null>(null);
  const [cerca, setCerca] = useState("");
  const [scritto, setScritto] = useState("");
  const [pagina, setPagina] = useState(1);
  const [hostAndamento, setHostAndamento] = useState<string | null>(null);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ giorni: String(giorni), vista, pagina: String(pagina) });
    if (rete !== TUTTE) q.set("rete", rete);
    if (verso) { q.set("da", verso.da); q.set("a", verso.a); }
    if (cerca) q.set("cerca", cerca);
    const r = await fetchJson<InsiemeTraffico>(`/api/traffico/insieme?${q.toString()}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [giorni, vista, rete, verso, cerca, pagina]);

  useEffect(() => { void carica(); }, [carica]);

  const nomeRete = (chiave: string): { nome: string; cidr: string } => {
    const r = dati?.reti_censite.find((x) => x.chiave === chiave);
    return r ? { nome: r.nome, cidr: r.cidr } : { nome: PAROLE_RETE[chiave] ?? "Rete tolta dal censimento", cidr: "" };
  };
  const Rete = ({ chiave }: { chiave: string }) => {
    const r = nomeRete(chiave);
    return (
      <span className="block">
        <span className="block font-semibold">{r.nome}</span>
        {r.cidr && <span className="font-mono text-[13px] text-muted-foreground">{r.cidr}</span>}
      </span>
    );
  };
  const cambia = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };
  const cercaOra = (e: FormEvent) => { e.preventDefault(); setCerca(scritto.trim()); setPagina(1); };
  const apriVerso = (da: string, a: string) => { setVerso({ da, a }); setVista("coppie"); setPagina(1); };

  const t = dati?.tessere;
  const quota = t && t.byte > 0 ? Math.round((t.byte_esterno / t.byte) * 100) : null;
  const pagine = dati ? Math.max(1, Math.ceil(dati.totale / dati.perPagina)) : 1;
  const periodo = PERIODI.find((p) => p.giorni === giorni)?.testo.toLowerCase() ?? "";
  const filtrato = rete !== TUTTE || verso !== null || cerca !== "";
  const numero = (n: number): string => n.toLocaleString("it-IT");
  const dalle = dati?.dalle ? new Date(`${dati.dalle.replace(" ", "T")}Z`).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
  const diCosa = hostAndamento ? `Host ${dati?.nomi[hostAndamento]?.nome ?? hostAndamento}` : rete !== TUTTE ? nomeRete(rete).nome : "Tutta la rete";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <TesseraNumero titolo="Host che parlano" valore={t?.host ?? null} nota="indirizzi interni visti nel periodo" />
        <TesseraNumero titolo="Coppie" valore={t?.coppie ?? null} nota="chi ha aperto un collegamento verso chi" />
        <TesseraNumero titolo="Volume" valore={t ? formattaByte(t.byte) : null} nota={t ? `${numero(t.pacchetti)} pacchetti · ${numero(t.flussi)} connessioni` : "tutto il traffico contato"} />
        <TesseraNumero titolo="Verso l'esterno" valore={quota === null ? null : `${quota}%`} qualifica={t ? formattaByte(t.byte_esterno) : undefined} nota="del volume, da o verso fuori" />
      </div>

      {conCollector && <Andamento rete={rete === TUTTE ? null : rete} host={hostAndamento} descrizione={diCosa} onTogliHost={() => setHostAndamento(null)} />}

      <Pannello
        titolo="Chi parla con chi"
        conteggio={dati?.totale}
        sottotitolo={
          (dalle ? `Dalle ${dalle}. ` : "") + (vista === "reti" ? "Una riga per verso: la rete di chi apre il collegamento e la rete di chi risponde."
            : vista === "host" ? "Una riga per host: quanti ne contatta, da quanti è contattato, cosa offre."
              : "Una riga per collegamento e servizio, i più pesanti in alto.")
        }
        corpoClassName="p-0"
        azioni={
          <>
            {PERIODI.map((p) => (
              <Button key={p.giorni} size="sm" variant={giorni === p.giorni ? "default" : "outline"} onClick={() => cambia(setGiorni)(p.giorni)}>{p.testo}</Button>
            ))}
            <span aria-hidden className="h-6 w-px bg-border" />
            {(Object.keys(NOME_VISTA) as Vista[]).map((v) => (
              <Button key={v} size="sm" variant={vista === v ? "default" : "outline"} onClick={() => cambia(setVista)(v)}>{NOME_VISTA[v]}</Button>
            ))}
            <span aria-hidden className="h-6 w-px bg-border" />
            <Select value={rete} onValueChange={(v) => cambia(setRete)(v ?? TUTTE)}>
              <SelectTrigger className="h-7 w-56" aria-label="Rete"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TUTTE}>Tutte le reti</SelectItem>
                {(dati?.reti_censite ?? []).filter((r) => !r.oggetto).map((r) => <SelectItem key={r.chiave} value={r.chiave}>{r.nome} · {r.cidr}</SelectItem>)}
                {Object.entries(PAROLE_RETE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                {(dati?.reti_censite ?? []).some((r) => r.oggetto) && (
                  <SelectGroup>
                    <SelectLabel>Reti con nome, non censite</SelectLabel>
                    {(dati?.reti_censite ?? []).filter((r) => r.oggetto).map((r) => <SelectItem key={r.chiave} value={r.chiave}>{r.nome} · {r.cidr}</SelectItem>)}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            <form onSubmit={cercaOra} className="flex items-center gap-1.5">
              <Input value={scritto} onChange={(e) => setScritto(e.target.value)} placeholder="Host, indirizzo o porta" aria-label="Cerca un host, un indirizzo o una porta" className="h-7 w-48" />
              <Button type="submit" size="sm" variant="outline">Cerca</Button>
            </form>
            <Pagination inTesta page={pagina} totalPages={pagine} onPageChange={setPagina} total={dati?.totale ?? 0} />
          </>
        }
        piede={dati?.troncato ? "Le coppie del periodo sono moltissime: i numeri sono calcolati sulle 50.000 più pesanti." : undefined}
      >
        {(verso || cerca) && (
          <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2 text-sm">
            {verso && (
              <>
                <Etichetta tono="ruolo" mono={false}>{nomeRete(verso.da).nome} → {nomeRete(verso.a).nome}</Etichetta>
                <Button size="sm" variant="outline" onClick={() => { setVerso(null); setVista("reti"); setPagina(1); }}>Torna alle reti</Button>
              </>
            )}
            {cerca && (
              <>
                <Etichetta mono={false}>cerca: {cerca}</Etichetta>
                <Button size="sm" variant="outline" onClick={() => { setCerca(""); setScritto(""); setPagina(1); }}>Togli la ricerca</Button>
              </>
            )}
          </div>
        )}
        {errore !== null ? (
          <div className="p-3"><LoadError what="il traffico" message={errore} onRetry={() => void carica()} /></div>
        ) : dati === null ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">Carico il traffico…</p>
        ) : dati.totale === 0 ? (
          <div className="p-3">
            <Vuoto
              titolo={filtrato ? "Niente con questi filtri" : `Nessun traffico contato (${periodo})`}
              testo={conCollector ? "IPAM legge i collector ogni 5 minuti: le coppie compaiono qui dopo il primo giro." : "Senza un collector registrato non arriva traffico."}
            />
          </div>
        ) : vista === "reti" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Da</TableHead>
                <TableHead>Verso</TableHead>
                <TableHead className="text-right">Host</TableHead>
                <TableHead className="text-right">Coppie</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Pacchetti</TableHead>
                <TableHead className="text-right">Connessioni</TableHead>
                <TableHead>Servizi principali</TableHead>
                <TableHead className="text-right">Dettaglio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.reti.map((r) => (
                <TableRow key={`${r.da}>${r.a}`}>
                  <TableCell><Rete chiave={r.da} /></TableCell>
                  <TableCell><Rete chiave={r.a} /></TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.host}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.coppie}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(r.byte)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(r.pacchetti)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(r.flussi)}</TableCell>
                  <TableCell><Servizi servizi={r.servizi} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => apriVerso(r.da, r.a)}>Vedi le coppie</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : vista === "host" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead className="text-right">Ne contatta</TableHead>
                <TableHead className="text-right">Lo contattano</TableHead>
                <TableHead className="text-right">Volume aperto da lui</TableHead>
                <TableHead className="text-right">Volume verso di lui</TableHead>
                <TableHead className="text-right">Pacchetti</TableHead>
                <TableHead className="text-right">Connessioni</TableHead>
                <TableHead className="text-right" title="Indirizzi esterni diversi contattati: sono almeno tanti">Esterni</TableHead>
                <TableHead>Servizi che offre</TableHead>
                <TableHead className="text-right">Andamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.host.map((h) => (
                <TableRow key={h.ip}>
                  <TableCell><Indirizzo ip={h.ip} nomi={dati.nomi} /></TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{h.contatta}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{h.contattato_da}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(h.byte_client)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(h.byte_server)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(h.pacchetti)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(h.flussi)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{h.esterni > 0 ? `almeno ${numero(h.esterni)}` : "—"}</TableCell>
                  <TableCell><Servizi servizi={h.servizi} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={hostAndamento === h.ip ? "default" : "outline"} onClick={() => { setHostAndamento(h.ip); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Andamento</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chi</TableHead>
                <TableHead>Verso chi</TableHead>
                <TableHead>Servizio</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Pacchetti</TableHead>
                <TableHead className="text-right">Connessioni</TableHead>
                <TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.coppie.map((c) => (
                <TableRow key={`${c.client}>${c.server}>${c.proto}/${c.porta}`}>
                  <TableCell><Indirizzo ip={c.client} nomi={dati.nomi} /></TableCell>
                  <TableCell><Indirizzo ip={c.server} nomi={dati.nomi} /></TableCell>
                  <TableCell className="font-mono">{protoPorta(c.proto, c.porta)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(c.byte)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(c.pacchetti)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(c.flussi)}</TableCell>
                  <TableCell><TempoRelativo data={c.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>

      {dati !== null && dati.nomi_chiesti.length > 0 && (
        <Pannello titolo="Nomi più chiesti" conteggio={dati.nomi_chiesti.length} sottotitolo={dalle ? `Nomi visti dalle ${dalle}; le volte sono quelle di tutta la giornata.` : `Dalle richieste DNS e dall'inizio delle connessioni cifrate (${periodo}).`} corpoClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Visto in</TableHead>
                <TableHead className="text-right">Volte</TableHead>
                <TableHead className="text-right">Host che lo chiedono</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.nomi_chiesti.map((n) => (
                <TableRow key={`${n.tipo}:${n.nome}`}>
                  <TableCell className="font-mono">{n.nome}</TableCell>
                  <TableCell>{n.tipo === "dns" ? "richiesta DNS" : "connessione cifrata"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{n.conteggio.toLocaleString("it-IT")}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{n.host}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Pannello>
      )}
    </div>
  );
}
