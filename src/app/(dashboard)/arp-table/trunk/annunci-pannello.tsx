"use client";

/**
 * Elenco «Annunci» della pagina del trunk (tavola approvata da Riccardo il 10/11/2026): chi si
 * presenta da solo sul trunk con MNDP, Ubiquiti, CDP o LLDP. Una riga per apparato, non per
 * annuncio; aperta, le interfacce da cui si presenta. Sola lettura: sono dati, non rilievi.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Etichetta, Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ApparatoAnnunciato } from "@/lib/trunk/annunci";

type Stato = "tutti" | "non_in_ipam" | "non_apparato";

const NOME_PROTOCOLLO: Record<string, string> = { MNDP: "MNDP", UBNT: "Ubiquiti", CDP: "CDP", LLDP: "LLDP" };
const NOME_CATEGORIA: Record<string, string> = {
  "network.router": "router", "network.switch": "switch", "network.access_point": "access point", network: "apparato di rete",
};
const nomeVlan = (vid: number) => (vid === 0 ? "senza tag" : `VLAN ${vid}`);
const INTERFACCE_MOSTRATE = 12;

function Segmenti<T extends string>({ voci, scelta, onScegli, etichetta }: {
  voci: Array<{ valore: T; testo: string }>; scelta: T; onScegli: (v: T) => void; etichetta: string;
}) {
  return (
    <div role="group" aria-label={etichetta} className="inline-flex flex-wrap overflow-hidden rounded-lg border border-foreground/70">
      {voci.map((v, i) => (
        <button
          key={v.valore}
          type="button"
          aria-pressed={scelta === v.valore}
          onClick={() => onScegli(v.valore)}
          className={`h-8 px-3 text-sm ${i > 0 ? "border-l border-foreground/70" : ""} ${scelta === v.valore ? "bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}
        >
          {v.testo}
        </button>
      ))}
    </div>
  );
}

export function PannelloAnnunci() {
  const [apparati, setApparati] = useState<ApparatoAnnunciato[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [protocollo, setProtocollo] = useState<string>("tutti");
  const [stato, setStato] = useState<Stato>("tutti");
  const [cerca, setCerca] = useState("");
  const [aperti, setAperti] = useState<Set<string>>(new Set());

  const carica = useCallback(async () => {
    const r = await fetchJson<{ apparati: ApparatoAnnunciato[] }>("/api/trunk/annunci", { cache: "no-store" });
    if (r.ok) {
      setApparati(r.data.apparati);
      setErrore(null);
    } else setErrore(r.message);
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  const tutti = useMemo(() => apparati ?? [], [apparati]);
  const perProtocollo = useMemo(() => {
    const n: Record<string, number> = {};
    for (const a of tutti) for (const p of a.protocolli) n[p] = (n[p] ?? 0) + 1;
    return n;
  }, [tutti]);
  const nonInIpam = tutti.filter((a) => !a.host).length;
  const nonApparato = tutti.filter((a) => a.host && !a.apparato).length;

  const q = cerca.trim().toLowerCase();
  const visibili = tutti.filter((a) => {
    if (protocollo !== "tutti" && !a.protocolli.includes(protocollo)) return false;
    if (stato === "non_in_ipam" && a.host) return false;
    if (stato === "non_apparato" && (!a.host || a.apparato)) return false;
    if (!q) return true;
    return [a.nome, a.modello, a.versione, a.indirizzo, a.host?.ip, ...a.interfacce.map((i) => `${i.porta} ${i.indirizzo ?? ""}`)]
      .some((x) => (x ?? "").toLowerCase().includes(q));
  });

  const alterna = (chiave: string) =>
    setAperti((prev) => {
      const n = new Set(prev);
      if (n.has(chiave)) n.delete(chiave);
      else n.add(chiave);
      return n;
    });

  return (
    <Pannello
      titolo="Annunci"
      conteggio={tutti.length}
      sottotitolo="Chi si presenta da solo sul trunk"
      azioni={
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca nome, modello, indirizzo" aria-label="Cerca" className="h-8 w-64 pl-8" />
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmenti
            etichetta="Protocollo"
            scelta={protocollo}
            onScegli={setProtocollo}
            voci={[
              { valore: "tutti", testo: `Tutti ${tutti.length}` },
              ...["MNDP", "UBNT", "CDP", "LLDP"].map((p) => ({ valore: p, testo: `${NOME_PROTOCOLLO[p]} ${perProtocollo[p] ?? 0}` })),
            ]}
          />
          <Segmenti<Stato>
            etichetta="Stato in DA-IPAM"
            scelta={stato}
            onScegli={setStato}
            voci={[
              { valore: "tutti", testo: "Tutti" },
              { valore: "non_in_ipam", testo: `Non in DA-IPAM ${nonInIpam}` },
              { valore: "non_apparato", testo: `Non registrati come apparato ${nonApparato}` },
            ]}
          />
        </div>

        {errore ? (
          <LoadError what="gli annunci" message={errore} onRetry={() => void carica()} />
        ) : !apparati ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">Caricamento…</p>
        ) : tutti.length === 0 ? (
          <Vuoto titolo="Nessun annuncio finora" testo="Gli apparati che si annunciano (MikroTik, Ubiquiti, Cisco) compaiono qui entro un paio di minuti dalla lettura del sensore." />
        ) : visibili.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">Nessun apparato con questi filtri.</p>
        ) : (
          <Table fissa>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Apparato</TableHead>
                <TableHead className="w-40">Come</TableHead>
                <TableHead>Modello e versione</TableHead>
                <TableHead className="w-36">Interfacce</TableHead>
                <TableHead>In DA-IPAM</TableHead>
                <TableHead className="w-32">Vista</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibili.map((a) => {
                const aperto = aperti.has(a.chiave);
                return (
                  <Fragment key={a.chiave}>
                    <TableRow className="cursor-pointer" onClick={() => alterna(a.chiave)}>
                      <TableCell className="text-muted-foreground">
                        <button type="button" aria-expanded={aperto} aria-label={aperto ? `Chiudi ${a.nome}` : `Apri ${a.nome}`}>
                          {aperto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{a.nome}</div>
                        {a.categoria && <div className="text-[13px] text-muted-foreground">{NOME_CATEGORIA[a.categoria] ?? a.categoria}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {a.protocolli.map((p) => <Etichetta key={p}>{NOME_PROTOCOLLO[p] ?? p}</Etichetta>)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-[13px]">{a.modello ?? "—"}</div>
                        {a.versione && <div className="text-[13px] text-muted-foreground">{a.versione}</div>}
                      </TableCell>
                      <TableCell className="text-[13px]">
                        <span className="font-mono">{a.interfacce.length}</span>
                        <span className="text-muted-foreground">
                          {a.vlan.length === 1 ? ` · ${nomeVlan(a.vlan[0])}` : ` in ${a.vlan.length} VLAN`}
                        </span>
                      </TableCell>
                      <TableCell className="text-[13px]" onClick={(e) => e.stopPropagation()}>
                        {a.host ? (
                          <>
                            <Link href={`/hosts/${a.host.id}`} className="font-mono text-cian-testo underline-offset-2 hover:underline">
                              host {a.host.ip}
                            </Link>
                            <div className={a.apparato ? "text-muted-foreground" : "font-semibold"}>
                              {a.apparato ? "apparato registrato" : "▲ non è un apparato"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold">▲ non c&apos;è</div>
                            {a.indirizzo && <div className="font-mono text-muted-foreground">{a.indirizzo}</div>}
                          </>
                        )}
                      </TableCell>
                      <TableCell><TempoRelativo data={a.ultima_vista} /></TableCell>
                    </TableRow>
                    {aperto && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={6} className="bg-muted/40">
                          <div className="grid gap-x-6 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "minmax(0, 2fr) 7rem 6rem minmax(0, 1.2fr) 8rem" }}>
                            {a.interfacce.slice(0, INTERFACCE_MOSTRATE).map((i) => (
                              <Fragment key={`${i.porta}|${i.vid}`}>
                                <span className="truncate font-mono" title={i.porta}>{i.porta}</span>
                                <span>{nomeVlan(i.vid)}</span>
                                <span className="text-muted-foreground">{NOME_PROTOCOLLO[i.protocollo] ?? i.protocollo}</span>
                                <span className="font-mono">{i.indirizzo ?? "—"}</span>
                                <span className="text-muted-foreground"><TempoRelativo data={i.ultima_vista} /></span>
                              </Fragment>
                            ))}
                          </div>
                          {a.interfacce.length > INTERFACCE_MOSTRATE && (
                            <p className="mt-1 text-[13px] text-muted-foreground">altre {a.interfacce.length - INTERFACCE_MOSTRATE} interfacce</p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Pannello>
  );
}
