"use client";

/**
 * «Esche»: i finti servizi che l'installazione presenta alla rete (Protezione, tappa 5; tavola del 25/11, oggetto
 * 15). Si scelgono qui e si applicano con un pulsante solo; finché non si preme «Applica» niente cambia.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BarraStato, Pannello, Vuoto } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Segno } from "@/components/protezione/pezzi";
import { ESCHE, NOMI_ESCHE, type ConfEsche, type NomeEsca } from "@/lib/protezione/esche-elenco";

interface Quadro {
  conf: ConfEsche;
  attivo: boolean | null;
  disponibile: boolean;
  motivo: string | null;
}

export function EscheClient({ contatti }: { contatti: Partial<Record<number, { quanti: number; indirizzi: number }>> }) {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [bozza, setBozza] = useState<ConfEsche | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    try {
      const r = await fetch("/api/protezione/esche", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Stato non letto");
      setQuadro(d);
      setBozza(d.conf);
      setErrore(null);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Stato non letto");
    }
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  if (errore && !quadro) return <Vuoto titolo="Stato delle esche non letto" testo={errore} />;
  if (!quadro || !bozza) return <Vuoto titolo="Lettura in corso…" />;

  const cambiata = JSON.stringify({ ...bozza, accese: [...bozza.accese].sort() }) !== JSON.stringify({ ...quadro.conf, accese: [...quadro.conf.accese].sort() });
  const scambia = (n: NomeEsca) => setBozza({ ...bozza, accese: bozza.accese.includes(n) ? bozza.accese.filter((x) => x !== n) : [...bozza.accese, n] });
  const applica = async () => {
    setInCorso(true);
    try {
      const r = await fetch("/api/protezione/esche", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bozza) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) toast.success(String(d.messaggio ?? "Fatto"));
      else toast.error(String(d.messaggio ?? d.error ?? "Non riuscito"));
      await carica();
    } finally {
      setInCorso(false);
    }
  };
  const accese = quadro.conf.accese.length;

  return (
    <>
      <BarraStato
        acceso={accese > 0 && quadro.attivo === true}
        titolo="Esche"
        stato={accese === 0 ? "spente" : quadro.attivo === false ? "accese, ma il servizio è fermo" : `accese · ${accese}`}
        dettagli={[quadro.conf.lente ? "risposte lente" : "risposte normali", "servizio a parte, senza privilegi", "le password provate non si conservano mai"]}
        azioni={
          <>
            <Button variant="outline" disabled={inCorso || !quadro.disponibile} onClick={() => setBozza({ ...bozza, lente: !bozza.lente })}>
              {bozza.lente ? "Risposte lente: sì" : "Risposte lente: no"}
            </Button>
            <Button disabled={inCorso || !quadro.disponibile || !cambiata} onClick={() => void applica()}>Applica</Button>
          </>
        }
      />
      {!quadro.disponibile && <Vuoto titolo="Le esche non si possono accendere da questa macchina" testo={quadro.motivo ?? ""} />}
      <Pannello
        titolo="Finti servizi presentati alla rete"
        conteggio={NOMI_ESCHE.length}
        sottotitolo="Nessuno ha un motivo buono per collegarsi a queste porte: chi lo fa compare in «Tentativi»."
        corpoClassName="p-0"
        piede={cambiata ? "▲ Le scelte sono cambiate: premi «Applica» per renderle vere." : "Un'esca non prende mai una porta già usata da un servizio vero: in quel caso «Applica» si rifiuta e dice quale."}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Esca</TableHead>
              <TableHead>Porta</TableHead>
              <TableHead>Cosa fa</TableHead>
              <TableHead>Adesso</TableHead>
              <TableHead>Contatti (24 ore)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {NOMI_ESCHE.map((n) => {
              const vera = quadro.conf.accese.includes(n);
              const scelta = bozza.accese.includes(n);
              const c = contatti[ESCHE[n].porta];
              return (
                <TableRow key={n}>
                  <TableCell className="font-semibold">{ESCHE[n].nome}</TableCell>
                  <TableCell className="font-mono">{ESCHE[n].porta}/tcp</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{ESCHE[n].cosa}</TableCell>
                  <TableCell>{vera ? <Segno tono="pieno" segno="●">accesa</Segno> : <Segno tono="vuoto" segno="○">spenta</Segno>}</TableCell>
                  <TableCell className="font-mono">{c ? `${c.quanti} da ${c.indirizzi}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-2">
                      {scelta !== vera && <Segno tono="avviso" segno="▲">{scelta ? "da accendere" : "da spegnere"}</Segno>}
                      <Button size="sm" variant={scelta ? "outline" : "default"} disabled={inCorso || !quadro.disponibile} onClick={() => scambia(n)}>{scelta ? "Spegni" : "Accendi"}</Button>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Pannello>
    </>
  );
}
