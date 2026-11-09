"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Etichetta, Legenda, Pannello, TesseraNumero, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ConteggiIdentita, PropostaIdentita } from "@/lib/servizi-rete/identita";

const TIPO: Record<string, { segno: "■" | "◆" | "●" | "◇"; testo: string; classe: string }> = {
  ssh_hostkey: { segno: "■", testo: "chiave SSH", classe: "border-primary/40 bg-primary/10 text-cian-testo" },
  tls_cert: { segno: "◆", testo: "certificato TLS", classe: "border-primary/40 bg-primary/10 text-cian-testo" },
  snmp_engine_id: { segno: "●", testo: "engineID SNMP", classe: "border-primary/40 bg-primary/10 text-cian-testo" },
  ntlm_computer: { segno: "◇", testo: "nome Windows", classe: "border-primary/40 bg-primary/10 text-cian-testo" },
};

interface Dati {
  righe: PropostaIdentita[];
  conteggi: ConteggiIdentita;
}

function Impronta({ valore }: { valore: string }) {
  const corto = /^[0-9a-f]{16,}$/i.test(valore) ? `${valore.slice(0, 16)}…` : valore;
  return (
    <span className="font-mono text-[13px]" title={valore}>
      {corto}
    </span>
  );
}

export function IdentitaClient({ iniziale, admin }: { iniziale: Dati; admin: boolean }) {
  const [dati, setDati] = useState<Dati>(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<number | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<Dati>("/api/identita", { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const decidi = async (id: number, esito: "confermato" | "rifiutato") => {
    setInCorso(id);
    const r = await fetchJson<PropostaIdentita>("/api/identita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, esito }),
    });
    setInCorso(null);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success(esito === "confermato" ? "Collegati come stesso apparato" : "Proposta rifiutata");
    await carica();
  };

  const raccogli = async () => {
    const r = await fetchJson<{ prove: number; proposte: number }>("/api/identita", { method: "PUT" });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success(`Prove ${r.data.prove >= 0 ? "+" : ""}${r.data.prove} · proposte nuove ${r.data.proposte}`);
    await carica();
  };

  const c = dati.conteggi;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Da confermare" valore={c.proposte} nota="stessa impronta forte su due IP" />
        <TesseraNumero titolo="Collegati" valore={c.confermati} nota="confermati da una persona" />
        <TesseraNumero titolo="Rifiutati" valore={c.rifiutati} nota="non si ripropongono da soli" />
        <TesseraNumero titolo="Prove" valore={c.prove} nota="impronte SSH, TLS, SNMP, nome Windows, nomi del trunk" />
      </div>

      <Pannello
        titolo="Stesso apparato, da confermare"
        conteggio={dati.righe.length}
        sottotitolo="Due IP con la stessa chiave SSH, lo stesso certificato, lo stesso engineID SNMP o lo stesso nome Windows (NTLM). Conferma li collega; rifiuto no. Nessuna fusione da sola."
        azioni={
          admin ? (
            <Button size="sm" variant="outline" onClick={() => void raccogli()}>
              Raccogli le prove
            </Button>
          ) : null
        }
        piede={
          <Legenda
            voci={Object.values(TIPO).map((t) => ({
              classe: t.classe,
              testo: `${t.segno} ${t.testo}`,
            }))}
          />
        }
      >
        {errore ? (
          <LoadError what="le proposte di identità" message={errore} onRetry={() => void carica()} />
        ) : dati.righe.length === 0 ? (
          <Vuoto
            titolo="Nessuna proposta"
            testo="Le sonde e i profili devono aver letto la stessa impronta su due IP. Un rifiuto non torna da solo."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Primo IP</TableHead>
                <TableHead>Secondo IP</TableHead>
                <TableHead>Prova</TableHead>
                <TableHead>Impronta</TableHead>
                {admin && <TableHead className="w-48">Decisione</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.righe.map((r) => {
                const t = TIPO[r.tipo] ?? { segno: "–", testo: r.tipo, classe: "border-border bg-muted" };
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-mono font-semibold">{r.ip_a}</div>
                      <div className="text-[13px] text-muted-foreground">{r.nome_a ?? r.rete_a ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono font-semibold">{r.ip_b}</div>
                      <div className="text-[13px] text-muted-foreground">{r.nome_b ?? r.rete_b ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <Etichetta className={t.classe}>
                        {t.segno} {t.testo}
                      </Etichetta>
                    </TableCell>
                    <TableCell>
                      <Impronta valore={r.valore} />
                    </TableCell>
                    {admin && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={inCorso !== null} onClick={() => void decidi(r.id, "confermato")}>
                            Collega
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={inCorso !== null}
                            onClick={() => void decidi(r.id, "rifiutato")}
                          >
                            Non è lo stesso
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
