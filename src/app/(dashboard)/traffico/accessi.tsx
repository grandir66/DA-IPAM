"use client";

/**
 * Tappa 7, ZONA ROSSA (approvata da Riccardo il 23/11): chi accede a cosa, coi nomi utente.
 * Solo amministratori; la scheda c'è solo a interruttore acceso. Niente export, niente copia in blocco.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ElencoAccessi } from "@/lib/traffico/accessi";
import { Indirizzo } from "./pezzi";

type Risposta = ({ acceso: true } & ElencoAccessi) | { acceso: false };

const PERIODI: { giorni: number; testo: string }[] = [
  { giorni: 1, testo: "Oggi" },
  { giorni: 7, testo: "7 giorni" },
  { giorni: 30, testo: "30 giorni" },
  { giorni: 90, testo: "90 giorni" },
];
const NOME_PROTOCOLLO: Record<string, string> = { kerberos: "Kerberos", smb: "SMB", ldap: "LDAP" };
const numero = (n: number): string => n.toLocaleString("it-IT");

/** Lo stato dell'interruttore, per la pagina: null finché non si sa (o per chi non è amministratore). */
export function useAccessiAccesi(admin: boolean): [boolean | null, () => void] {
  const [acceso, setAcceso] = useState<boolean | null>(null);
  const [giro, setGiro] = useState(0);
  useEffect(() => {
    if (!admin) return;
    let vivo = true;
    void fetchJson<Risposta>("/api/traffico/accessi?giorni=1", { cache: "no-store" }).then((r) => { if (vivo && r.ok) setAcceso(r.data.acceso); });
    return () => { vivo = false; };
  }, [admin, giro]);
  return [acceso, () => setGiro((g) => g + 1)];
}

/** Riquadro dell'interruttore, nella scheda «Collector e controlli». */
export function InterruttoreAccessi({ onCambio }: { onCambio: () => void }) {
  const [acceso, setAcceso] = useState<boolean | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inInvio, setInInvio] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<Risposta>("/api/traffico/accessi?giorni=1", { cache: "no-store" });
    if (r.ok) { setAcceso(r.data.acceso); setErrore(null); } else setErrore(r.message);
  }, []);
  useEffect(() => { void carica(); }, [carica]);

  const cambia = async (v: boolean) => {
    setInInvio(true);
    const r = await fetchJson<{ ok: boolean }>("/api/traffico/accessi", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceso: v }) });
    setInInvio(false);
    if (!r.ok) { toast.error(r.message); return; }
    setAcceso(v);
    toast.success(v ? "Accessi con nome utente accesi" : "Accessi con nome utente spenti");
    onCambio();
  };

  return (
    <Pannello titolo="Accessi con nome utente" sottotitolo="Dati personali: spento di serie.">
      {errore !== null ? <LoadError what="l'interruttore degli accessi" message={errore} onRetry={() => void carica()} /> : (
        <div className="flex items-start gap-3">
          <Switch checked={acceso === true} disabled={acceso === null || inInvio} onCheckedChange={(v) => void cambia(v)} aria-label="Accessi con nome utente" />
          <div className="text-sm">
            <p className="font-semibold">{acceso ? "Acceso: IPAM legge gli accessi dai collector" : "Spento: IPAM non legge gli accessi"}</p>
            <p className="text-muted-foreground">
              Dal traffico in copia: chi si è presentato con quale nome utente (Kerberos, SMB, LDAP), da dove, verso quale server e se è
              andata bene. Mai password. Visibili solo agli amministratori, tenuti 90 giorni, mai negli export.
              Serve anche, su ogni collector, <span className="font-mono">ACCESSI=1</span> in <span className="font-mono">/etc/collector-traffico/collector.env</span>.
            </p>
          </div>
        </div>
      )}
    </Pannello>
  );
}

/** Scheda «Accessi» della pagina Traffico. */
export function Accessi() {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorni, setGiorni] = useState(7);
  const [cerca, setCerca] = useState("");
  const [scritto, setScritto] = useState("");
  const [pagina, setPagina] = useState(1);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ giorni: String(giorni), pagina: String(pagina) });
    if (cerca) q.set("cerca", cerca);
    const r = await fetchJson<Risposta>(`/api/traffico/accessi?${q.toString()}`, { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, [giorni, cerca, pagina]);
  useEffect(() => { void carica(); }, [carica]);

  const cercaOra = (e: FormEvent) => { e.preventDefault(); setCerca(scritto.trim()); setPagina(1); };
  const elenco = dati && dati.acceso ? dati : null;
  const pagine = elenco ? Math.max(1, Math.ceil(elenco.totale / elenco.perPagina)) : 1;

  return (
    <Pannello
      titolo="Accessi"
      conteggio={elenco?.totale}
      sottotitolo="Chi si è presentato con quale nome utente, da dove e verso quale server."
      corpoClassName="p-0"
      azioni={
        <>
          {PERIODI.map((p) => (
            <Button key={p.giorni} size="sm" variant={giorni === p.giorni ? "default" : "outline"} onClick={() => { setGiorni(p.giorni); setPagina(1); }}>{p.testo}</Button>
          ))}
          <span aria-hidden className="h-6 w-px bg-border" />
          <form onSubmit={cercaOra} className="flex items-center gap-1.5">
            <Input value={scritto} onChange={(e) => setScritto(e.target.value)} placeholder="Utente, dominio, indirizzo" aria-label="Cerca un utente, un dominio o un indirizzo" className="h-7 w-56" />
            <Button type="submit" size="sm" variant="outline">Cerca</Button>
            {cerca && <Button type="button" size="sm" variant="outline" onClick={() => { setCerca(""); setScritto(""); setPagina(1); }}>Togli</Button>}
          </form>
          <Pagination inTesta page={pagina} totalPages={pagine} onPageChange={setPagina} total={elenco?.totale ?? 0} />
        </>
      }
    >
      <div className="flex items-center gap-2 border-b border-[#C9A800] bg-[#FFD400] px-3.5 py-2 text-sm font-semibold text-[#0D2537]" role="note">
        <span aria-hidden>▲</span>
        <span>Dati personali: visibili solo agli amministratori, tenuti 90 giorni.</span>
      </div>
      {errore !== null ? (
        <div className="p-3"><LoadError what="gli accessi" message={errore} onRetry={() => void carica()} /></div>
      ) : dati === null ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">Carico gli accessi…</p>
      ) : !elenco ? (
        <div className="p-3"><Vuoto titolo="Accessi spenti" testo="Si accendono nella scheda «Collector e controlli»." /></div>
      ) : elenco.totale === 0 ? (
        <div className="p-3"><Vuoto titolo={cerca ? "Niente con questa ricerca" : "Nessun accesso nel periodo"} testo="Gli accessi arrivano dai collector con ACCESSI=1 nella loro configurazione." /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utente</TableHead><TableHead>Dominio</TableHead><TableHead>Da</TableHead><TableHead>Verso</TableHead><TableHead>Protocollo</TableHead>
              <TableHead className="text-right">Riusciti</TableHead><TableHead className="text-right">Falliti</TableHead><TableHead>Prima volta</TableHead><TableHead>Ultima volta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {elenco.righe.map((r) => (
              <TableRow key={`${r.utente}|${r.dominio}|${r.client}|${r.server}|${r.protocollo}`}>
                <TableCell className="max-w-xs font-semibold break-all whitespace-normal">{r.utente}</TableCell>
                <TableCell>{r.dominio || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Indirizzo ip={r.client} nomi={elenco.nomi} /></TableCell>
                <TableCell><Indirizzo ip={r.server} nomi={elenco.nomi} /></TableCell>
                <TableCell>{NOME_PROTOCOLLO[r.protocollo] ?? r.protocollo}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{numero(r.riusciti)}</TableCell>
                <TableCell className="text-right">
                  {r.falliti > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#8E1B20] bg-[#8E1B20] px-1.5 py-0.5 font-mono text-[13px] font-semibold text-white tabular-nums"><span aria-hidden className="font-sans">✕</span>{numero(r.falliti)}</span>
                  ) : <span className="font-mono tabular-nums">0</span>}
                </TableCell>
                <TableCell><TempoRelativo data={r.prima_vista} /></TableCell>
                <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Pannello>
  );
}
