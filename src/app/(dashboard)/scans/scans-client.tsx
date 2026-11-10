"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import {
  IntestazionePagina,
  Pannello,
  VoceSelezionabile,
  Vuoto,
  InCorso,
  Etichetta,
} from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { formatPortsDisplay } from "@/lib/utils";
import { useEAdmin } from "@/hooks/use-e-admin";
import { useGiri } from "@/components/shared/giri-context";
import { etichettaGiro } from "@/lib/scanner/giri";
import {
  FASI_GIRO,
  PROFILI_GIRO,
  PROFILI_GIRO_UI,
  TIPI_GIRO,
  TIPI_GIRO_UI,
  type FaseGiro,
  type ProfiloGiro,
  type TipoGiro,
} from "@/lib/scanner/profili-giro-ui";
import type { ScanHistory } from "@/types";

interface EsitoLancio {
  avvii: Array<{ network_id: number | null; job_id: string | null; messaggio: string }>;
  saltati: Array<{ network_id: number | null; motivo: string }>;
}

interface Rete {
  id: number;
  name: string;
  cidr: string;
}

const SCANS_LIMIT = 200;
const FASI_UI: Record<FaseGiro, string> = {
  host: "Host (ICMP)",
  porte: "Porte TCP",
  udp: "Porte UDP",
  sonde: "Sonde e identità",
};

export function ScansClient() {
  const admin = useEAdmin();
  const { giri, apri } = useGiri();
  const [tipo, setTipo] = useState<TipoGiro>("discovery");
  const [profilo, setProfilo] = useState<ProfiloGiro>("standard");
  const [fasi, setFasi] = useState<FaseGiro[]>([...FASI_GIRO]);
  const [confermaCompleto, setConfermaCompleto] = useState(false);
  const [proveFabbrica, setProveFabbrica] = useState(false);
  const [reti, setReti] = useState<Rete[]>([]);
  const [scelte, setScelte] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avvio, setAvvio] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [n, h] = await Promise.all([
      fetchJson<Rete[] | { data: Rete[] }>("/api/networks"),
      fetchJson<ScanHistory[]>(`/api/scans/history?limit=${SCANS_LIMIT}`),
    ]);
    if (n.ok) {
      const grezzo = n.data;
      const lista = Array.isArray(grezzo) ? grezzo : grezzo.data;
      setReti(Array.isArray(lista) ? lista.map((r) => ({ id: r.id, name: r.name, cidr: r.cidr })) : []);
    } else setError(n.message);
    if (h.ok) setHistory(Array.isArray(h.data) ? h.data : []);
    else if (!n.ok) setError(h.message);
    else setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const serveRete = tipo === "discovery" || tipo === "controlli";
  const motivoBlocco = useMemo(() => {
    if (!admin) return "Solo un amministratore può lanciare un giro";
    if (serveRete && scelte.size === 0) return "Scegli almeno una rete";
    if (profilo === "completo" && !confermaCompleto) return "Completo chiede conferma: tutte le 65.535 porte TCP";
    if (avvio) return "Un avvio è già in corso";
    return null;
  }, [admin, serveRete, scelte.size, profilo, confermaCompleto, avvio]);

  async function avvia() {
    if (motivoBlocco) return;
    setAvvio("Avvio…");
    const r = await fetchJson<EsitoLancio>("/api/scans/lancia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo,
        profilo,
        network_ids: [...scelte],
        fasi: profilo === "su_misura" ? fasi : undefined,
        conferma_completo: profilo === "completo" ? true : undefined,
        prove_fabbrica: (tipo === "discovery" || tipo === "controlli") && proveFabbrica ? true : undefined,
      }),
    });
    if (!r.ok) {
      toast.error(r.message);
      setAvvio(null);
      return;
    }
    const n = r.data.avvii.length;
    toast.success(n === 1 ? r.data.avvii[0]!.messaggio : `${n} giri avviati`);
    for (const s of r.data.saltati) toast.message(s.motivo);
    // Apre il pannello di avanzamento (ScanProgress, globale) per ogni giro appena avviato.
    for (const a of r.data.avvii) if (a.job_id) apri(a.job_id);
    setAvvio(null);
    void load();
  }

  const giriInCorso = giri.filter((g) => g.status === "running");

  function toggleRete(id: number) {
    setScelte((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Scansioni di rete"
        sottotitolo="Scegli il tipo e il profilo, poi la rete. I findings si vedono dopo il giro."
        azioni={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/vulnerabilities" />}>
            Vedi i findings
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Pannello numero={1} titolo="Tipo" className="lg:col-span-6" sottotitolo="Cosa fa questo giro">
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPI_GIRO.map((t) => (
              <VoceSelezionabile key={t} scelta={tipo === t} onScegli={() => setTipo(t)}>
                <p className="font-semibold">{TIPI_GIRO_UI[t].nome}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{TIPI_GIRO_UI[t].riga}</p>
              </VoceSelezionabile>
            ))}
          </div>
        </Pannello>
        <Pannello numero={2} titolo="Profilo" className="lg:col-span-6" sottotitolo="Quante porte e a che ritmo">
          <div className="grid gap-2 sm:grid-cols-2">
            {PROFILI_GIRO.map((p) => (
              <VoceSelezionabile
                key={p}
                scelta={profilo === p}
                onScegli={() => {
                  setProfilo(p);
                  if (p !== "completo") setConfermaCompleto(false);
                }}
              >
                <p className="font-semibold">{PROFILI_GIRO_UI[p].nome}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{PROFILI_GIRO_UI[p].riga}</p>
              </VoceSelezionabile>
            ))}
          </div>
          {profilo === "completo" && (
            <label className="mt-3 flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confermaCompleto}
                onChange={(e) => setConfermaCompleto(e.target.checked)}
              />
              <span>Confermo: tutte le 65.535 porte TCP. Non parte dai giri automatici.</span>
            </label>
          )}
          {profilo === "su_misura" && (
            <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
              {FASI_GIRO.map((f) => (
                <label key={f} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={fasi.includes(f)}
                    onChange={() =>
                      setFasi((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
                    }
                  />
                  {FASI_UI[f]}
                </label>
              ))}
            </div>
          )}
        </Pannello>
      </div>

      {serveRete && (
        <Pannello numero={3} titolo="Reti" conteggio={reti.length} sottotitolo="Solo le reti già in inventario">
          {loading ? (
            <p className="p-3 text-[13px] text-muted-foreground">Caricamento…</p>
          ) : reti.length === 0 ? (
            <Vuoto titolo="Nessuna rete" testo="Censisci una subnet, poi torna qui." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {reti.map((r) => (
                <VoceSelezionabile key={r.id} scelta={scelte.has(r.id)} onScegli={() => toggleRete(r.id)}>
                  <p className="font-semibold">{r.name}</p>
                  <p className="font-mono text-[13px] text-muted-foreground">{r.cidr}</p>
                </VoceSelezionabile>
              ))}
            </div>
          )}
        </Pannello>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!!motivoBlocco} title={motivoBlocco ?? undefined} onClick={() => void avvia()}>
          Avvia {TIPI_GIRO_UI[tipo].nome} · {PROFILI_GIRO_UI[profilo].nome}
        </Button>
        {avvio && <InCorso titolo={avvio} />}
      </div>
      {serveRete && (
        <label className="flex items-start gap-2 rounded-xl border border-[#C9A800] bg-[#FFD400]/10 p-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={proveFabbrica}
            onChange={(e) => setProveFabbrica(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-semibold">
              Prove invasive
              <Etichetta tono="ruolo">▲ invasiva</Etichetta>
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Login di fabbrica (FTP, admin/admin, MySQL/MSSQL/Postgres), EternalBlue, IPMI (cipher zero e RAKP), SNMP in scrittura e Jenkins Script Console. Mai nei giri automatici; al massimo 6 tentativi di login per host. Da concordare col cliente.
            </span>
          </span>
        </label>
      )}

      {giriInCorso.length > 0 && (
        <Pannello titolo="Giri in corso" conteggio={giriInCorso.length} sottotitolo="Avanzamento dal vivo; clic su «Apri» per il dettaglio">
          <div className="space-y-2 p-1">
            {giriInCorso.map((g) => {
              const pct = g.total > 0 ? Math.round((g.scanned / g.total) * 100) : null;
              return (
                <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{g.etichetta ?? etichettaGiro(g.scan_type)}</span>
                    <span className="ml-2 text-[13px] text-muted-foreground">{g.phase}</span>
                  </span>
                  {pct != null && <span className="font-mono text-[13px] tabular-nums">{pct}%</span>}
                  <Button size="sm" variant="outline" onClick={() => apri(g.id)}>Apri</Button>
                </div>
              );
            })}
          </div>
        </Pannello>
      )}

      <Pannello titolo="Storico" conteggio={history.length} sottotitolo="Gli ultimi giri di questa installazione">
        {error ? (
          <LoadError what="lo storico" message={error} onRetry={() => void load()} />
        ) : history.length === 0 ? (
          <Vuoto titolo="Nessuna scansione eseguita" testo="Lancia un giro qui sopra." />
        ) : (
          <Table fissa>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Risultato</TableHead>
                <TableHead>Porte aperte</TableHead>
                <TableHead>Durata</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell>
                    <Etichetta>{scan.scan_type}</Etichetta>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{scan.status}</TableCell>
                  <TableCell className="font-mono text-[13px]">{formatPortsDisplay(scan.ports_open)}</TableCell>
                  <TableCell>
                    {scan.duration_ms ? `${(scan.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {parseDbDate(scan.timestamp).toLocaleString("it-IT")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
