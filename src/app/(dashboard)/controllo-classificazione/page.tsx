"use client";

/**
 * Controllo classificazione (Riccardo, 12/11/2026): la classe scritta contro la migliore possibile. L'elenco dei
 * rilievi è il centro della pagina; si spuntano le proposte e si applicano. Le regole stanno in
 * src/lib/classification/controllo.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IntestazionePagina, Pannello, Vuoto } from "@/components/shared/console";
import { getClassificationLabel } from "@/lib/device-classifications";
import { ETICHETTA_FAMIGLIA, type Famiglia, type Rilievo, type Sicurezza } from "@/lib/classification/controllo";

interface Voce {
  host_id: number;
  network_id: number | null;
  ip: string;
  nome: string | null;
  vendor: string | null;
  classe_adesso: string | null;
  a_mano: boolean;
  rilievo: Rilievo;
}

const ORDINE: Famiglia[] = ["nome_contro_classe", "forma_non_funzione", "senza_classe", "sistema_non_credibile", "stesso_apparato"];
const PESO: Record<Sicurezza, number> = { alta: 0, media: 1, bassa: 2 };
/** Forma oltre al testo: tre, due, un pallino pieno. */
const SEGNO: Record<Sicurezza, string> = { alta: "●●●", media: "●●○", bassa: "●○○" };
const chiave = (v: Voce) => `${v.host_id}:${v.rilievo.famiglia}`;

export default function ControlloClassificazionePage() {
  const [voci, setVoci] = useState<Voce[] | null>(null);
  const [righe, setRighe] = useState(0);
  const [famiglia, setFamiglia] = useState<Famiglia | "">("");
  const [soloProposte, setSoloProposte] = useState(true);
  const [spuntate, setSpuntate] = useState<Set<string>>(new Set());
  const [occupato, setOccupato] = useState(false);
  /** Rete scelta da chi arriva dalla pagina di una subnet (`?rete=<id>`); letta dopo il montaggio. */
  const [rete, setRete] = useState<number | null>(null);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("rete");
    if (r && /^\d+$/.test(r)) setRete(Number(r));
  }, []);

  const carica = useCallback(async () => {
    try {
      const r = await fetch("/api/hosts/controllo-classificazione");
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { righe: number; voci: Voce[] };
      setVoci(d.voci);
      setRighe(d.righe);
      setSpuntate(new Set());
    } catch {
      toast.error("Il controllo non ha risposto");
      setVoci([]);
    }
  }, []);
  useEffect(() => { void carica(); }, [carica]);

  const conteggi = useMemo(() => {
    const m = new Map<Famiglia, { tutte: number; proposte: number }>();
    for (const v of voci ?? []) {
      if (rete !== null && v.network_id !== rete) continue;
      const c = m.get(v.rilievo.famiglia) ?? { tutte: 0, proposte: 0 };
      c.tutte++;
      if (v.rilievo.proposta) c.proposte++;
      m.set(v.rilievo.famiglia, c);
    }
    return m;
  }, [voci, rete]);

  const visibili = useMemo(() => (voci ?? [])
    .filter((v) => (rete === null || v.network_id === rete) && (!famiglia || v.rilievo.famiglia === famiglia) && (!soloProposte || v.rilievo.proposta !== null))
    .sort((a, b) => ORDINE.indexOf(a.rilievo.famiglia) - ORDINE.indexOf(b.rilievo.famiglia)
      || PESO[a.rilievo.sicurezza] - PESO[b.rilievo.sicurezza]
      || (a.rilievo.proposta ?? "").localeCompare(b.rilievo.proposta ?? "")
      || a.ip.localeCompare(b.ip, undefined, { numeric: true })), [voci, famiglia, soloProposte, rete]);

  /** Spuntabili in blocco: con una proposta e non scelte a mano (quelle si spuntano una per una). */
  const inBlocco = useMemo(() => visibili.filter((v) => v.rilievo.proposta !== null && !v.a_mano), [visibili]);
  const tutteSpuntate = inBlocco.length > 0 && inBlocco.every((v) => spuntate.has(chiave(v)));

  function spunta(v: Voce, si: boolean) {
    setSpuntate((prima) => {
      const s = new Set(prima);
      if (si) s.add(chiave(v)); else s.delete(chiave(v));
      return s;
    });
  }

  async function invia(corpo: unknown): Promise<Record<string, number> | null> {
    setOccupato(true);
    try {
      const r = await fetch("/api/hosts/controllo-classificazione", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = (await r.json().catch(() => ({}))) as Record<string, number> & { error?: string };
      if (!r.ok) { toast.error(d.error ?? "Non salvato"); return null; }
      return d;
    } catch {
      toast.error("Non salvato: il server non ha risposto");
      return null;
    } finally {
      setOccupato(false);
    }
  }

  async function applica() {
    const scelte = (voci ?? []).filter((v) => spuntate.has(chiave(v)) && v.rilievo.proposta !== null);
    // Una riga può avere più rilievi: vale la prima proposta spuntata.
    const perHost = new Map<number, string>();
    for (const v of scelte) if (!perHost.has(v.host_id)) perHost.set(v.host_id, v.rilievo.proposta as string);
    const d = await invia({ azione: "applica", voci: [...perHost].map(([host_id, classe]) => ({ host_id, classe })) });
    if (d) { toast.success(`${d.scritte} righe classificate`); await carica(); }
  }

  async function ricalcola() {
    const d = await invia({ azione: "ricalcola" });
    if (d) { toast.success(`Ricalcolate ${d.righe} righe: ${d.cambiate} hanno cambiato classe`); await carica(); }
  }

  const nSpuntate = spuntate.size;

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Controllo classificazione"
        sottotitolo={voci ? `${righe} righe in archivio, ${new Set(voci.map((v) => v.host_id)).size} con qualcosa da guardare. Le proposte applicate valgono come scelta a mano.` : "Lettura in corso…"}
        azioni={
          <>
            <Button variant="outline" size="sm" disabled={occupato} onClick={() => void ricalcola()} title="Rilancia il riconoscimento di oggi su tutte le righe. Le scelte a mano non cambiano.">
              Ricalcola col motore di oggi
            </Button>
            <Button size="sm" disabled={occupato || nSpuntate === 0} onClick={() => void applica()}>
              {nSpuntate === 0 ? "Applica alle righe spuntate" : `Applica a ${nSpuntate} righe`}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {rete !== null && (
          <Button variant="outline" size="sm" onClick={() => setRete(null)} title="Stai guardando una rete sola: mostra tutte le reti">
            Solo questa rete ✕
          </Button>
        )}
        <Button variant={famiglia === "" ? "default" : "outline"} size="sm" onClick={() => setFamiglia("")}>Tutti</Button>
        {ORDINE.filter((f) => conteggi.has(f)).map((f) => (
          <Button key={f} variant={famiglia === f ? "default" : "outline"} size="sm" onClick={() => setFamiglia(f)}>
            {ETICHETTA_FAMIGLIA[f]} · {soloProposte ? conteggi.get(f)?.proposte : conteggi.get(f)?.tutte}
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <Checkbox checked={soloProposte} onCheckedChange={(v) => setSoloProposte(v === true)} />
          Solo le righe con una proposta
        </label>
      </div>

      <Pannello titolo="Rilievi" conteggio={visibili.length} corpoClassName="p-0">
        {voci === null ? (
          <p className="p-4 text-[13px] text-muted-foreground">Lettura in corso…</p>
        ) : visibili.length === 0 ? (
          <div className="p-4">
            <Vuoto titolo="Niente da guardare qui" testo={soloProposte ? "Nessuna proposta per questo filtro. Togli «Solo le righe con una proposta» per vedere anche i rilievi senza proposta." : "Il controllo non ha trovato rilievi."} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label="Spunta tutte le proposte"
                      checked={tutteSpuntate}
                      onCheckedChange={(v) => setSpuntate(v === true ? new Set(inBlocco.map(chiave)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Indirizzo</th>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Produttore</th>
                  <th className="px-3 py-2 font-medium">Adesso</th>
                  <th className="px-3 py-2 font-medium">Proposta</th>
                  <th className="px-3 py-2 font-medium">Sicurezza</th>
                  <th className="px-3 py-2 font-medium">Perché</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map((v) => (
                  <tr key={chiave(v)} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5">
                      {v.rilievo.proposta !== null && (
                        <Checkbox aria-label={`Spunta ${v.ip}`} checked={spuntate.has(chiave(v))} onCheckedChange={(s) => spunta(v, s === true)} />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                      <Link className="underline-offset-2 hover:underline" href={`/hosts/${v.host_id}`}>{v.ip}</Link>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-1.5" title={v.nome ?? ""}>{v.nome ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5 text-muted-foreground" title={v.vendor ?? ""}>{v.vendor ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {v.classe_adesso ? getClassificationLabel(v.classe_adesso) : "—"}
                      {v.a_mano && <span className="ml-1.5 rounded border px-1 text-[13px] font-semibold" title="Scelta a mano: non entra in «Spunta tutte»">A MANO</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{v.rilievo.proposta ? getClassificationLabel(v.rilievo.proposta) : "?"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5" title={`Sicurezza ${v.rilievo.sicurezza}`}>
                      <span className="mr-1.5 tracking-tight">{SEGNO[v.rilievo.sicurezza]}</span>{v.rilievo.sicurezza}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{v.rilievo.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Pannello>
    </div>
  );
}
