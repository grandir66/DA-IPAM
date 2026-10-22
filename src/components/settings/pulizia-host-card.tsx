"use client";

import { useCallback, useEffect, useState } from "react";
import { Eraser } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { Candidato } from "@/lib/hosts/pulizia";
import type { RigaArchivio } from "@/lib/hosts/pulizia-archivio";
import {
  dataOra, leggiRispostaApplica, macLeggibile, motivoLeggibile, scadenzaArchivio, soloData,
  type HostNominato, type RispostaApplica,
} from "@/lib/hosts/pulizia-testi";

interface Anteprima {
  candidati: Candidato[];
  esclusi: Array<{ id: number; ip: string; nome: string; perche: string }>;
  /** Righe d'archivio oltre i 90 giorni che lo stesso «Applica» cancella per sempre. */
  scadute: Array<{ id: number; ip: string; nome: string }>;
  giorni: number;
  giorniArchivio: number;
}
interface Archivio { righe: RigaArchivio[]; totale: number }

const GIORNI_ARCHIVIO_DEFAULT = 90;

function ElencoNomi({ titolo, host }: { titolo: string; host: HostNominato[] }) {
  if (host.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium">{titolo} ({host.length})</p>
      <ul className="text-sm text-muted-foreground list-disc pl-5">
        {host.map((h) => (
          <li key={h.id}>
            <span className="font-mono">{h.ip || "—"}</span> {h.nome}
            {h.perche && <span className="font-medium text-foreground"> — {h.perche}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EsitoApplica({ esito }: { esito: Exclude<RispostaApplica, { tipo: "illeggibile" }> }) {
  const titolo =
    esito.tipo === "ok" ? "Pulizia eseguita"
      : esito.tipo === "archivio_scaduto_fallito" ? "Host archiviati, ma l'archivio scaduto non è stato cancellato"
        : esito.tipo === "interrotta" ? "Archiviazione interrotta a metà"
          : "Non è stato archiviato niente";
  return (
    <div role="status" className="rounded-md border p-3 space-y-2">
      <p className="text-sm font-semibold">{titolo}</p>
      {esito.tipo === "rifiutata" && <p className="text-sm">{esito.messaggio}</p>}
      {esito.tipo !== "rifiutata" && (
        <>
          {(esito.tipo === "archivio_scaduto_fallito" || esito.tipo === "interrotta") && <p className="text-sm">{esito.messaggio}</p>}
          <ElencoNomi titolo="Archiviati" host={esito.archiviati} />
          {esito.tipo === "interrotta" && <ElencoNomi titolo="Non archiviati, ancora fra gli host" host={esito.nonArchiviati} />}
          <ElencoNomi titolo="Non più candidati, lasciati dove sono" host={esito.nonPiuCandidati} />
          {esito.tipo === "ok" && <ElencoNomi titolo="Cancellati dall'archivio perché scaduti" host={esito.cancellatiDallArchivio} />}
        </>
      )}
    </div>
  );
}

/** Impostazioni → Sistema → «Pulizia degli host assenti» (solo amministratori; piano 2026-10-20, Task 6). */
export function PuliziaHostCard() {

  const [anteprima, setAnteprima] = useState<Anteprima | null>(null);
  const [erroreAnteprima, setErroreAnteprima] = useState<string | null>(null);
  const [caricaAnteprima, setCaricaAnteprima] = useState(false);

  const [archivio, setArchivio] = useState<Archivio | null>(null);
  const [erroreArchivio, setErroreArchivio] = useState<string | null>(null);

  const [confermaAperta, setConfermaAperta] = useState(false);
  const [numero, setNumero] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [esito, setEsito] = useState<Exclude<RispostaApplica, { tipo: "illeggibile" }> | null>(null);

  const [daRecuperare, setDaRecuperare] = useState<RigaArchivio | null>(null);
  const [recuperaInCorso, setRecuperaInCorso] = useState(false);
  const [motivoRifiuto, setMotivoRifiuto] = useState<string | null>(null);

  const caricaArchivio = useCallback(async () => {
    const r = await fetchJson<Archivio>("/api/hosts/archivio");
    if (r.ok) { setArchivio(r.data); setErroreArchivio(null); } else setErroreArchivio(r.message);
  }, []);
  const mostraAnteprima = useCallback(async () => {
    setCaricaAnteprima(true);
    // L'esito dell'ultimo «Archivia» non resta sopra un'anteprima nuova, che lo smentirebbe.
    setEsito(null);
    const r = await fetchJson<Anteprima>("/api/hosts/pulizia");
    if (r.ok) { setAnteprima(r.data); setErroreAnteprima(null); } else setErroreAnteprima(r.message);
    setCaricaAnteprima(false);
  }, []);

  useEffect(() => {
    // Caricamenti iniziali: i setState stanno dopo l'await, non nel corpo dell'effetto.
    void caricaArchivio();
    // Arrivo dalla dashboard (#pulizia-host): la scheda compare dopo la scelta della scheda, l'àncora da sola non basta.
    if (window.location.hash === "#pulizia-host") document.getElementById("pulizia-host")?.scrollIntoView({ block: "start" });
  }, [caricaArchivio]);

  const candidati = anteprima?.candidati ?? [];

  async function archivia() {
    if (!anteprima) return;
    setInCorso(true);
    try {
      const res = await fetch("/api/hosts/pulizia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: candidati.map((c) => c.id), conferma: Number(numero) }),
      });
      const letto = leggiRispostaApplica(res.status, await res.json().catch(() => null));
      setConfermaAperta(false);
      setNumero("");
      if (letto.tipo === "illeggibile") {
        toast.error("Risposta non leggibile dal server: controlla l'archivio prima di riprovare");
      } else {
        setEsito(letto);
      }
      setAnteprima(null);
      await caricaArchivio();
    } catch {
      toast.error("Server non raggiungibile: non so se gli host sono stati archiviati, controlla l'archivio");
    } finally {
      setInCorso(false);
    }
  }

  async function recupera() {
    if (!daRecuperare) return;
    setRecuperaInCorso(true);
    setMotivoRifiuto(null);
    try {
      const res = await fetch(`/api/hosts/archivio/${daRecuperare.id}/recupera`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; motivo?: string; error?: string } | null;
      if (res.ok && body?.ok) {
        toast.success(`${daRecuperare.nome} è tornato fra gli host`);
        setDaRecuperare(null);
        await caricaArchivio();
      } else {
        setMotivoRifiuto(body?.motivo ?? body?.error ?? "Recupero non riuscito");
      }
    } catch {
      setMotivoRifiuto("Server non raggiungibile: non so se l'host è tornato, controlla l'archivio");
    } finally {
      setRecuperaInCorso(false);
    }
  }

  const giorniArchivio = anteprima?.giorniArchivio ?? GIORNI_ARCHIVIO_DEFAULT;
  const n = candidati.length;
  const scadute = anteprima?.scadute ?? [];
  const k = scadute.length;

  return (
    <Card id="pulizia-host">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Eraser className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Pulizia degli host assenti</CardTitle>
        </div>
        <CardDescription>
          Host offline da oltre {anteprima?.giorni ?? 60} giorni e vecchi IP di un MAC che ha cambiato indirizzo. Gli archiviati
          spariscono da liste, conteggi e mappa; si recuperano per {giorniArchivio} giorni, poi si cancellano.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Accendere e spegnere si fa da Opzioni (22/10), con la conferma all'accensione: qui lo stato e il rimando. */}
        <RigheRimando ids={["job.pulizia_host"]} />

        <div>
          <Button type="button" variant="outline" onClick={() => void mostraAnteprima()} disabled={caricaAnteprima}>
            {caricaAnteprima ? "Calcolo in corso…" : anteprima ? "Aggiorna anteprima" : "Mostra anteprima"}
          </Button>
        </div>

        {esito && <EsitoApplica esito={esito} />}

        {erroreAnteprima !== null && <LoadError what="l'anteprima della pulizia" message={erroreAnteprima} onRetry={() => void mostraAnteprima()} />}

        {anteprima && (
          <section className="space-y-3" aria-label="Anteprima">
            <h3 className="text-sm font-semibold border-b pb-1">
              Anteprima: {n === 0 ? "nessun host da archiviare" : `${n} host da archiviare`}
            </h3>
            {n > 0 && (
              <Table fissa>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead><TableHead>Nome</TableHead><TableHead>MAC</TableHead>
                    <TableHead>Ultima vista</TableHead><TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidati.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-[13px]">{c.ip}</TableCell>
                      <TableCell className="text-[13px]">{c.nome}</TableCell>
                      <TableCell className="font-mono text-[13px]">{c.mac ?? "—"}</TableCell>
                      <TableCell className="text-[13px]">{dataOra(c.ultimaVista)}</TableCell>
                      <TableCell className="text-[13px]">
                        {motivoLeggibile(c.motivo, c.dettaglio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {anteprima.esclusi.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">{anteprima.esclusi.length} esclusi</summary>
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow><TableHead>IP</TableHead><TableHead>Nome</TableHead><TableHead>Perché</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {anteprima.esclusi.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-[13px]">{e.ip}</TableCell>
                        <TableCell className="text-[13px]">{e.nome}</TableCell>
                        <TableCell className="text-[13px]">{e.perche}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            )}
            {n > 0 && (
              <Button type="button" onClick={() => { setNumero(""); setConfermaAperta(true); }}>
                Archivia questi {n} host…
              </Button>
            )}
          </section>
        )}

        <section className="space-y-3" aria-label="Archivio">
          <h3 className="text-sm font-semibold border-b pb-1">Archivio ({archivio?.totale ?? "…"})</h3>
          {erroreArchivio !== null ? (
            <LoadError what="l'archivio degli host" message={erroreArchivio} onRetry={() => void caricaArchivio()} />
          ) : archivio === null ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : archivio.righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun host in archivio.</p>
          ) : (
            <>
              <Table fissa>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead><TableHead>Nome</TableHead><TableHead>MAC</TableHead><TableHead>Motivo</TableHead>
                    <TableHead>Archiviato il</TableHead><TableHead>Cancellato il</TableHead><TableHead>Di nuovo in rete</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivio.righe.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-[13px]">{r.ip}</TableCell>
                      <TableCell className="text-[13px]">{r.nome}</TableCell>
                      <TableCell className="font-mono text-[13px]">{macLeggibile(r.macHex)}</TableCell>
                      <TableCell className="text-[13px]">{motivoLeggibile(r.motivo, r.dettaglio)}</TableCell>
                      <TableCell className="text-[13px]">{soloData(r.archiviatoIl)}</TableCell>
                      <TableCell className="text-[13px]">{soloData(scadenzaArchivio(r.archiviatoIl, giorniArchivio))}</TableCell>
                      <TableCell className="text-[13px]">
                        {r.diNuovoInRete ? <Badge variant="outline" className="text-[13px] font-mono">{r.diNuovoInRete}</Badge> : "—"}
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="outline" size="sm" className="text-[13px]" onClick={() => { setMotivoRifiuto(null); setDaRecuperare(r); }}>
                          Recupera
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {archivio.totale > archivio.righe.length && (
                <p className="text-sm text-muted-foreground">Mostrati {archivio.righe.length} di {archivio.totale}</p>
              )}
            </>
          )}
        </section>
      </CardContent>

      <Dialog open={confermaAperta} onOpenChange={(o) => { if (!inCorso) setConfermaAperta(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Archivia {n} host{k > 0 && ` e cancella per sempre ${k === 1 ? "1 riga d'archivio scaduta" : `${k} righe d'archivio scadute`}`}
            </DialogTitle>
            <DialogDescription>
              Spariscono da liste, conteggi e mappa. Per {giorniArchivio} giorni li puoi recuperare dall&apos;archivio.
            </DialogDescription>
          </DialogHeader>
          {k > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                In archivio da oltre {giorniArchivio} giorni, si cancellano e non si recuperano più:
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
                {scadute.map((r) => <li key={r.id}><span className="font-mono">{r.ip}</span> {r.nome}</li>)}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="pulizia-conferma" className="text-sm font-medium">Scrivi {n} per confermare</label>
            <Input id="pulizia-conferma" inputMode="numeric" autoComplete="off" value={numero} onChange={(e) => setNumero(e.target.value.trim())} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfermaAperta(false)} disabled={inCorso}>Annulla</Button>
            <Button type="button" onClick={() => void archivia()} disabled={inCorso || numero !== String(n)}>
              {inCorso ? "Archiviazione…" : "Archivia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={daRecuperare !== null} onOpenChange={(o) => { if (!o && !recuperaInCorso) setDaRecuperare(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recupera {daRecuperare?.nome}</DialogTitle>
            <DialogDescription>Torna con nome, note e classificazione. Lo storico di scansioni e stati non torna.</DialogDescription>
          </DialogHeader>
          {motivoRifiuto && <p role="alert" className="text-sm font-medium">Non recuperato: {motivoRifiuto}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDaRecuperare(null)} disabled={recuperaInCorso}>Annulla</Button>
            <Button type="button" onClick={() => void recupera()} disabled={recuperaInCorso}>
              {recuperaInCorso ? "Recupero…" : "Recupera"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
