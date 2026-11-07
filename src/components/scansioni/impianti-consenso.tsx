"use client";

/**
 * Consenso e registro degli impianti (tavola approvata il 07/11/2026, oggetti 24 e 26).
 * Il pulsante pieno è rosso: dire sì qui può fermare una produzione.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { dataRegistro, dettaglioRegistro, eventoRegistro, profiloRegistro, type ReteScansione } from "@/lib/vuln/scansioni-va-regole";
import type { RigaRegistro } from "@/lib/vuln/registro-impianti";
import { Stato } from "./stato-va";

const INDIRIZZO = "/api/vulnerabilities/consenso-impianti";
const ORE = [4, 12, 24];

export function RiquadroConsenso({ rete, nome, onChiudi, onFatto }: { rete: ReteScansione; nome: string; onChiudi: () => void; onFatto: () => void }) {
  const [ips, setIps] = useState<string[] | null>(null);
  const [riferimento, setRiferimento] = useState("");
  const [ore, setOre] = useState(4);
  const [sa, setSa] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetchJson<{ ips: string[] }>(`${INDIRIZZO}?rete=${rete.id}`).then((r) => {
      if (!vivo) return;
      if (r.ok) setIps(r.data.ips);
      else setErrore(r.message);
    });
    return () => {
      vivo = false;
    };
  }, [rete.id]);

  const registra = async () => {
    setOccupato(true);
    setErrore(null);
    const r = await fetchJson(INDIRIZZO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: rete.id, riferimento, ore, consapevole: sa }),
    });
    setOccupato(false);
    if (r.ok) onFatto();
    else setErrore(r.message);
  };

  const pronto = !!ips?.length && riferimento.trim().length >= 3 && sa && !occupato;
  return (
    <Dialog open onOpenChange={(v) => !v && onChiudi()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Consenso per {rete.nome}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p>Una scansione può fermare PLC e HMI. Se un impianto smette di rispondere, Edge ferma il giro e blocca la rete. Vale solo per il lancio immediato, e solo Greenbone: nuclei e moduli restano fuori dagli impianti.</p>
          <div>
            <strong>Impianti{ips ? ` (${ips.length})` : ""}:</strong>
            {ips ? (
              <div className="mt-1 max-h-28 overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-[13px]">{ips.join(", ") || "nessuno"}</div>
            ) : !errore && <Loader2 className="ml-2 inline size-4 animate-spin" />}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
            <label className="flex flex-col gap-1">
              Autorizzazione scritta del cliente
              <Input value={riferimento} maxLength={500} placeholder="Mail, ticket o firma: chi e quando" onChange={(e) => setRiferimento(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              Vale per
              <select className="h-9 rounded-md border bg-background px-2.5 text-sm" value={ore} onChange={(e) => setOre(Number(e.target.value))}>
                {ORE.map((o) => <option key={o} value={o}>{o} ore</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={sa} onCheckedChange={(v) => setSa(v === true)} />
            Il cliente sa che la produzione può fermarsi, e c&apos;è qualcuno sul posto
          </label>
          {errore && <p role="alert"><Stato tono="avviso">▲ {errore}</Stato></p>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-muted-foreground">Registrato a nome di {nome}</span>
            <Button variant="outline" onClick={onChiudi}>Annulla</Button>
            <Button disabled={!pronto} className="bg-[#8E1B20] text-white hover:bg-[#8E1B20]/90" onClick={() => void registra()}>
              {occupato && <Loader2 className="size-4 animate-spin" />} Registra il consenso
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RegistroImpianti() {
  const [righe, setRighe] = useState<RigaRegistro[] | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const leggi = useCallback(async () => {
    const r = await fetchJson<{ righe: RigaRegistro[]; avviso: string | null }>(INDIRIZZO);
    if (r.ok) {
      setRighe(r.data.righe);
      setAvviso(r.data.avviso);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, []);
  useEffect(() => {
    void leggi();
  }, [leggi]);

  return (
    <Pannello
      titolo="Registro impianti"
      sottotitolo="Consensi e scansioni in ordine di tempo. Non si cancella."
      corpoClassName="p-0"
      azioni={<a href={`${INDIRIZZO}?formato=csv`} className="text-sm font-semibold text-cian-testo hover:underline">Esporta CSV</a>}
    >
      {errore && <LoadError what="il registro" message={errore} onRetry={() => void leggi()} />}
      {avviso && <p className="px-3 py-2 text-sm"><Stato tono="avviso">▲ Copia locale, la sonda non ha risposto: {avviso}</Stato></p>}
      {righe && righe.length === 0 && <Vuoto titolo="Registro vuoto" testo="Compaiono qui le scansioni sulle reti con impianti e i consensi." />}
      {righe && righe.length > 0 && (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left text-[13px]">
              <tr>
                {["Quando", "Rete", "Evento", "Chi", "Scansione", "Impianti", "Profilo", "Dettaglio"].map((t) => (
                  <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => {
                const e = eventoRegistro(r.evento);
                return (
                  <tr key={r.id} className="border-b align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{dataRegistro(r.at)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5" title={r.cidr}>{r.rete}</td>
                    <td className="whitespace-nowrap px-3 py-1.5"><Stato tono={e.tono}>{e.segno} {e.nome}</Stato></td>
                    <td className="px-3 py-1.5">{r.chi}</td>
                    <td className="px-3 py-1.5 font-mono text-[13px]">{r.scan_id ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-[13px]" title={r.ips || undefined}>{r.impianti}</td>
                    <td className="px-3 py-1.5">{profiloRegistro(r.profilo)}</td>
                    <td className="px-3 py-1.5">{dettaglioRegistro(r.dettaglio) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Pannello>
  );
}
