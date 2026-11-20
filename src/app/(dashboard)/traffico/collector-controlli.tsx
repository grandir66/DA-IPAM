"use client";

/**
 * Scheda «Collector e controlli» della pagina Traffico (solo amministratori): le macchine che ascoltano
 * (aggiungere, spegnere, togliere) e i controlli sul contenuto, accesi o spenti rete per rete.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { TipoFatto } from "@/lib/traffico/anomalie";
import { fraseAnomalia, NOME_TIPO } from "@/lib/traffico/frasi";
import type { CollectorTraffico } from "@/lib/traffico/lettura";

interface Controlli {
  tipi: TipoFatto[];
  spenti: { network_id: number; tipo: TipoFatto }[];
  reti: { id: number; nome: string; cidr: string }[];
}
const VUOTO = { nome: "", sede: "", url: "", gettone: "", impronta: "" };
const JSON_TESTA = { "Content-Type": "application/json" };

export function CollectorEControlli({ onCambio }: { onCambio: () => void }) {
  const [collector, setCollector] = useState<CollectorTraffico[] | null>(null);
  const [controlli, setControlli] = useState<Controlli | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState(VUOTO);
  const [aperto, setAperto] = useState(false);
  const [inInvio, setInInvio] = useState(false);
  const [rete, setRete] = useState<string>("");

  const carica = useCallback(async () => {
    const [c, k] = await Promise.all([
      fetchJson<{ collector: CollectorTraffico[] }>("/api/traffico/collector", { cache: "no-store" }),
      fetchJson<Controlli>("/api/traffico/controlli", { cache: "no-store" }),
    ]);
    if (!c.ok) { setErrore(c.message); return; }
    if (!k.ok) { setErrore(k.message); return; }
    setCollector(c.data.collector);
    setControlli(k.data);
    setErrore(null);
    setRete((r) => r || (k.data.reti[0] ? String(k.data.reti[0].id) : ""));
  }, []);

  useEffect(() => { void carica(); }, [carica]);

  const dopo = async () => { await carica(); onCambio(); };

  const registra = async () => {
    setInInvio(true);
    const r = await fetchJson<{ id: number }>("/api/traffico/collector", { method: "POST", headers: JSON_TESTA, body: JSON.stringify(nuovo) });
    setInInvio(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Collector registrato: la prima lettura parte entro 5 minuti");
    setNuovo(VUOTO);
    setAperto(false);
    await dopo();
  };

  const accendi = async (c: CollectorTraffico, attivo: boolean) => {
    const r = await fetchJson<{ ok: boolean }>(`/api/traffico/collector/${c.id}`, { method: "PATCH", headers: JSON_TESTA, body: JSON.stringify({ attivo }) });
    if (!r.ok) { toast.error(r.message); return; }
    await dopo();
  };

  const togli = async (c: CollectorTraffico) => {
    if (!window.confirm(`Togliere il collector «${c.nome}»? Si cancellano anche le coppie di traffico che ha portato. Le anomalie restano.`)) return;
    const r = await fetchJson<{ ok: boolean }>(`/api/traffico/collector/${c.id}`, { method: "DELETE" });
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Collector tolto");
    await dopo();
  };

  const cambiaControllo = async (tipo: TipoFatto, acceso: boolean) => {
    const r = await fetchJson<{ ok: boolean }>("/api/traffico/controlli", {
      method: "PUT", headers: JSON_TESTA, body: JSON.stringify({ network_id: Number(rete), tipo, acceso }),
    });
    if (!r.ok) { toast.error(r.message); return; }
    await carica();
  };

  if (errore !== null) return <LoadError what="i collector e i controlli" message={errore} onRetry={() => void carica()} />;
  if (collector === null || controlli === null) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const spenti = new Set(controlli.spenti.map((s) => `${s.network_id}|${s.tipo}`));
  const campo = (k: keyof typeof VUOTO, segnaposto: string, tipo = "text", classe = "") => (
    <Input
      type={tipo}
      aria-label={segnaposto}
      placeholder={segnaposto}
      autoComplete="off"
      className={classe}
      value={nuovo[k]}
      onChange={(e) => setNuovo((n) => ({ ...n, [k]: e.target.value }))}
    />
  );

  return (
    <div className="space-y-4">
      <Pannello
        numero={1}
        titolo="Collector"
        conteggio={collector.length}
        sottotitolo="IPAM li legge ogni 5 minuti. Indirizzo, gettone e impronta li stampa l'installazione del collector."
        corpoClassName="p-0"
        azioni={<Button size="sm" variant={aperto ? "outline" : "default"} onClick={() => setAperto((a) => !a)}>{aperto ? "Annulla" : "Registra un collector"}</Button>}
      >
        {aperto && (
          <div className="grid gap-2 border-b p-3 md:grid-cols-2 xl:grid-cols-6">
            {campo("nome", "Nome (es. collector-sede)")}
            {campo("sede", "Sede")}
            {campo("url", "https://indirizzo:8477", "text", "font-mono")}
            {campo("gettone", "Gettone", "password", "font-mono")}
            {campo("impronta", "Impronta SHA-256 del certificato", "text", "font-mono")}
            <Button disabled={inInvio || !nuovo.nome || !nuovo.url || !nuovo.gettone || !nuovo.impronta} onClick={() => void registra()}>
              {inInvio ? "Provo il collegamento…" : "Prova e registra"}
            </Button>
          </div>
        )}
        {collector.length === 0 ? (
          <div className="p-3"><Vuoto titolo="Nessun collector" testo="Si installa con collector-traffico/installa.sh su una macchina con una scheda in copia dallo switch, poi si registra qui." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead><TableHead>Sede</TableHead><TableHead>Indirizzo</TableHead>
                <TableHead>Ultimo contatto</TableHead><TableHead>Ultimo errore</TableHead>
                <TableHead>Acceso</TableHead><TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collector.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold">{c.nome}</TableCell>
                  <TableCell>{c.sede || "—"}</TableCell>
                  <TableCell className="font-mono">{c.url.replace(/^https:\/\//, "")}</TableCell>
                  <TableCell><TempoRelativo data={c.ultimo_contatto} /></TableCell>
                  <TableCell className="max-w-sm whitespace-normal">{c.ultimo_errore ?? "—"}</TableCell>
                  <TableCell><Switch checked={c.attivo} aria-label={`Collector ${c.nome} acceso`} onCheckedChange={(v) => void accendi(c, v)} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="destructive" onClick={() => void togli(c)}>Togli</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>

      <Pannello
        numero={2}
        titolo="Controlli sul contenuto"
        conteggio={controlli.tipi.length}
        sottotitolo="Accesi di serie. Si spengono per una rete dove quel traffico è voluto. Del contenuto si salva il fatto, mai il valore."
        azioni={
          <Select value={rete} onValueChange={(v) => setRete(v ?? "")}>
            <SelectTrigger className="h-7 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {controlli.reti.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.cidr ? `${r.nome} · ${r.cidr}` : r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {controlli.tipi.map((t) => {
            const acceso = !spenti.has(`${rete}|${t}`);
            return (
              <label key={t} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{NOME_TIPO[t] ?? t}</span>
                  <span className="text-[13px] text-muted-foreground">{fraseAnomalia({ tipo: t, client: "", server: "", dettaglio: {} })}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[13px]">
                  {acceso ? "acceso" : "spento"}
                  <Switch checked={acceso} disabled={rete === ""} onCheckedChange={(v) => void cambiaControllo(t, v)} />
                </span>
              </label>
            );
          })}
        </div>
      </Pannello>
    </div>
  );
}
