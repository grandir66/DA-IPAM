"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { InCorso, Legenda, Pannello, SchedePagina, TesseraNumero, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { CellaMatrice, ConteggiSegmentazione, ProvaSegmentazione, VistaServizio } from "@/lib/segmentazione/db";
import type { StatoGiroSeg } from "@/lib/segmentazione/giro";

interface Dati {
  celle: CellaMatrice[];
  conteggi: ConteggiSegmentazione;
  servizi: VistaServizio[];
  giro: StatoGiroSeg | null;
}

type Scheda = "matrice" | "servizi";

const ESITO: Record<string, { segno: string; testo: string; classe: string }> = {
  raggiunto: { segno: "●", testo: "raggiunto", classe: "border-[#1F7A4D] bg-[#1F7A4D] text-white" },
  chiuso: { segno: "■", testo: "chiuso", classe: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]" },
  filtrato: { segno: "▲", testo: "filtrato", classe: "border-[#8E1B20] bg-[#8E1B20] text-white" },
  senza_rotta: { segno: "○", testo: "senza rotta", classe: "border-border bg-muted text-muted-foreground" },
};

function BadgeEsito({ esito }: { esito: string }) {
  const e = ESITO[esito] ?? ESITO.filtrato;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold", e.classe)}>
      <span aria-hidden>{e.segno}</span>
      {e.testo}
    </span>
  );
}

export function SegmentazioneClient({ iniziale, admin }: { iniziale: Dati; admin: boolean }) {
  const [dati, setDati] = useState<Dati>(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [scheda, setScheda] = useState<Scheda>("matrice");
  const [cella, setCella] = useState<{ s: number; b: number } | null>(null);
  const [dettaglio, setDettaglio] = useState<ProvaSegmentazione[] | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<Dati>("/api/segmentazione", { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, []);

  useEffect(() => {
    const inCorso = dati.giro?.inCorso === true;
    if (!inCorso) return;
    timer.current = setInterval(() => void carica(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [dati.giro?.inCorso, carica]);

  const avvia = async () => {
    const r = await fetchJson<{ avviato: boolean }>("/api/segmentazione/giro", { method: "POST" });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success("Giro avviato: da ogni VLAN si provano i servizi delle altre reti");
    await carica();
  };

  const apriCella = async (s: number, b: number) => {
    setCella({ s, b });
    const r = await fetchJson<{ righe: ProvaSegmentazione[] }>(`/api/segmentazione/cella?sorgente=${s}&bersaglio=${b}`);
    setDettaglio(r.ok ? r.data.righe : []);
  };

  const reti = useMemo(() => {
    const m = new Map<number, { nome: string; cidr: string }>();
    for (const c of dati.celle) {
      if (c.rete_sorgente) m.set(c.rete_sorgente, { nome: c.nome_sorgente ?? `rete ${c.rete_sorgente}`, cidr: c.cidr_sorgente ?? "" });
      if (c.rete_bersaglio) m.set(c.rete_bersaglio, { nome: c.nome_bersaglio ?? `rete ${c.rete_bersaglio}`, cidr: c.cidr_bersaglio ?? "" });
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [dati.celle]);

  const perCoppia = useMemo(() => {
    const m = new Map<string, CellaMatrice>();
    for (const c of dati.celle) m.set(`${c.rete_sorgente}:${c.rete_bersaglio}`, c);
    return m;
  }, [dati.celle]);

  const c = dati.conteggi;
  const giro = dati.giro;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Raggiunti" valore={c.raggiunti} qualifica={c.prove ? `${Math.round((c.raggiunti / c.prove) * 100)}%` : undefined} nota="la porta ha accettato la connessione" />
        <TesseraNumero titolo="Chiusi" valore={c.chiusi} nota="risposta RST: il servizio c'è, rifiuta" />
        <TesseraNumero titolo="Filtrati" valore={c.filtrati} nota="nessuna risposta: firewall o filtro" />
        <TesseraNumero titolo="Prove" valore={c.prove} nota={c.ultimo ? `ultimo giro ${c.ultimo.slice(0, 16)}` : "nessun giro ancora"} />
      </div>

      {giro?.inCorso && (
        <InCorso
          titolo="Misura in corso"
          percentuale={giro.totale ? (giro.fatte / giro.totale) * 100 : 0}
          dettaglio={`${giro.fatte} di ${giro.totale} VLAN sorgente`}
        />
      )}
      {giro && !giro.inCorso && giro.errore && <LoadError what="il giro della matrice" message={giro.errore} />}

      <SchedePagina<Scheda>
        etichetta="Matrice di segmentazione"
        scelta={scheda}
        onScegli={setScheda}
        voci={[
          { valore: "matrice", titolo: "Rete × rete", descrizione: "raggiunti / totale · chiusi · filtrati" },
          { valore: "servizi", titolo: "Servizio × rete sorgente", descrizione: "un servizio, da quali reti lo si tocca" },
        ]}
      />

      {errore ? (
        <LoadError what="la matrice di segmentazione" message={errore} onRetry={() => void carica()} />
      ) : scheda === "matrice" ? (
        <Pannello
          titolo="Quali reti raggiungono quali"
          sottotitolo="Clic su una cella per l'elenco. La diagonale è vuota: una rete non si misura verso sé stessa."
          azioni={
            admin ? (
              <Button size="sm" onClick={() => void avvia()} disabled={giro?.inCorso === true}>
                <Radar className="size-4" />
                Misura ora
              </Button>
            ) : null
          }
          piede={<Legenda voci={Object.values(ESITO).map((e) => ({ classe: e.classe, testo: `${e.segno} ${e.testo}` }))} />}
        >
          {reti.length === 0 ? (
            <Vuoto titolo="Nessuna misura" testo="Serve la sonda trunk, almeno due reti con VLAN e gateway, e i servizi già noti. Poi «Misura ora»." />
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-card">Da \ verso</TableHead>
                    {reti.map(([id, n]) => (
                      <TableHead key={id} className="font-mono text-[13px]" title={n.cidr}>
                        {n.nome}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reti.map(([sid, sn]) => (
                    <TableRow key={sid}>
                      <TableCell className="sticky left-0 z-10 bg-card font-semibold">{sn.nome}</TableCell>
                      {reti.map(([bid]) => {
                        if (sid === bid) return <TableCell key={bid} className="bg-muted/40 text-muted-foreground">—</TableCell>;
                        const cellaM = perCoppia.get(`${sid}:${bid}`);
                        if (!cellaM) return <TableCell key={bid} className="text-muted-foreground">·</TableCell>;
                        return (
                          <TableCell key={bid}>
                            <button
                              type="button"
                              className="rounded-md border px-2 py-1 text-left font-mono text-[13px] hover:bg-muted/60"
                              onClick={() => void apriCella(sid, bid)}
                            >
                              {cellaM.raggiunti}/{cellaM.totale}
                              <span className="block text-muted-foreground">
                                {cellaM.chiusi} chiusi · {cellaM.filtrati} filtrati
                              </span>
                            </button>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {cella && dettaglio && (
            <div className="border-t p-3">
              <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-cian-testo">Elenco della cella</p>
              {dettaglio.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Nessuna prova in questa cella.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Indirizzo</TableHead>
                      <TableHead>Porta</TableHead>
                      <TableHead>Esito</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dettaglio.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-mono font-semibold">{r.ip}</div>
                          {r.hostname && <div className="text-[13px] text-muted-foreground">{r.hostname}</div>}
                        </TableCell>
                        <TableCell className="font-mono">{r.porta}/tcp</TableCell>
                        <TableCell>
                          <BadgeEsito esito={r.esito} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </Pannello>
      ) : (
        <Pannello titolo="Servizio × rete sorgente" sottotitolo="Lo stesso servizio visto da ciascuna VLAN da cui si è misurato">
          {dati.servizi.length === 0 ? (
            <Vuoto titolo="Nessun servizio misurato" testo="Parte dopo il primo giro della matrice." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Servizio</TableHead>
                  <TableHead>Rete</TableHead>
                  <TableHead>Da dove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dati.servizi.map((s) => (
                  <TableRow key={`${s.ip}:${s.porta}`}>
                    <TableCell>
                      <div className="font-mono font-semibold">
                        {s.ip}:{s.porta}
                      </div>
                      {s.hostname && <div className="text-[13px] text-muted-foreground">{s.hostname}</div>}
                    </TableCell>
                    <TableCell className="text-[13px]">{s.rete_bersaglio ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {s.per_sorgente.map((p) => (
                          <span key={`${p.vlan}-${p.rete}`} className="inline-flex items-center gap-1">
                            <span className="font-mono text-[13px]">{p.rete ?? `VLAN ${p.vlan}`}</span>
                            <BadgeEsito esito={p.esito} />
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Pannello>
      )}
    </div>
  );
}
