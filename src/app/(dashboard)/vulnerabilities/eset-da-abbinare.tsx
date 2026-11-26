"use client";

/**
 * «N macchine ESET da abbinare» (17/11/2026, oggetto approvato da Riccardo): le postazioni che ESET
 * conosce ma che non si sono agganciate a un host per MAC, seriale o nome. Finché restano qui non
 * danno rilievi né software. Da qui un amministratore le aggancia a mano (IP o nome dell'host) o
 * dice che non sono fra gli host. Se la lettura da DA-Link è spenta e non c'è niente, non compare.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Macchina { uuid: string; nome: string; hostname: string | null; ip_locale: string | null; seriale: string | null; console: string | null; motivo: string; a_mano: boolean }
interface Stato {
  acceso: boolean;
  macchine: number;
  agganciate: number;
  giro: { finito: string | null; esito: string; dettaglio: string | null } | null;
  da_abbinare: Macchina[];
}
const CONSOLE: Record<string, string> = { edr: "EDR/XDR", mdr: "MDR" };

export function EsetDaAbbinare({ alCambio }: { alCambio: () => void }) {
  const [stato, setStato] = useState<Stato | null>(null);
  const [aperto, setAperto] = useState(false);
  const [host, setHost] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);

  const leggi = useCallback(async () => {
    try {
      const r = await fetch("/api/eset", { cache: "no-store" });
      if (r.ok) setStato((await r.json()) as Stato);
    } catch {
      /* la pagina dei rilievi vive anche senza questa riga */
    }
  }, []);
  useEffect(() => {
    void leggi();
  }, [leggi]);

  const manda = async (uuid: string, corpo: Record<string, string>) => {
    setInCorso(uuid);
    setErrore(null);
    try {
      const r = await fetch("/api/eset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = (await r.json()) as Stato & { error?: string };
      if (!r.ok) setErrore(r.status === 403 ? "Serve un amministratore per agganciare le macchine." : (j.error ?? "Non riuscito."));
      else {
        setStato(j);
        alCambio();
      }
    } catch {
      setErrore("Non riuscito: il server non ha risposto.");
    } finally {
      setInCorso(null);
    }
  };

  if (!stato || (!stato.acceso && stato.macchine === 0)) return null;
  const n = stato.da_abbinare.length;
  return (
    <>
      <p role="status" className="text-[13px]">
        ESET: {stato.macchine} macchine lette da DA-Link, {stato.agganciate} agganciate a un host
        {stato.giro && stato.giro.esito === "errore" ? ` · ultima lettura non riuscita: ${stato.giro.dettaglio ?? ""}` : ""}
        {n > 0 && (
          <>
            {" · "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setAperto(true)}>
              {n} {n === 1 ? "macchina ESET da abbinare" : "macchine ESET da abbinare"}
            </button>
          </>
        )}
      </p>
      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Macchine ESET da abbinare</DialogTitle>
            <DialogDescription>
              ESET le conosce, ma nessun host ha lo stesso MAC, seriale o nome. Finché restano qui i loro rilievi e il loro software non compaiono.
              Scrivi l&apos;IP o il nome dell&apos;host a cui corrispondono, oppure segna che non sono fra gli host.
            </DialogDescription>
          </DialogHeader>
          {errore && <p role="alert" className="text-[13px] font-semibold">✕ {errore}</p>}
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Macchina</TableHead>
                  <TableHead>Servizio</TableHead>
                  <TableHead>IP in ESET</TableHead>
                  <TableHead>Seriale</TableHead>
                  <TableHead>Perché non è agganciata</TableHead>
                  <TableHead>Host</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stato.da_abbinare.map((m) => (
                  <TableRow key={m.uuid}>
                    <TableCell className="text-[13px] font-medium">{m.nome}</TableCell>
                    <TableCell className="text-[13px]">{CONSOLE[m.console ?? ""] ?? "—"}</TableCell>
                    <TableCell className="text-[13px] font-mono">{m.ip_locale ?? "—"}</TableCell>
                    <TableCell className="text-[13px] font-mono">{m.seriale ?? "—"}</TableCell>
                    <TableCell className="text-[13px]">{m.motivo}</TableCell>
                    <TableCell>
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (host[m.uuid]?.trim()) void manda(m.uuid, { azione: "abbina", uuid: m.uuid, host: host[m.uuid].trim() });
                        }}
                      >
                        <Input
                          aria-label={`IP o nome dell'host per ${m.nome}`}
                          placeholder="IP o nome dell'host"
                          className="h-8 w-44 text-[13px]"
                          value={host[m.uuid] ?? ""}
                          onChange={(e) => setHost((h) => ({ ...h, [m.uuid]: e.target.value }))}
                        />
                        <Button type="submit" size="sm" disabled={inCorso === m.uuid || !host[m.uuid]?.trim()}>Abbina</Button>
                        {m.a_mano ? (
                          <Button type="button" size="sm" variant="outline" disabled={inCorso === m.uuid} onClick={() => void manda(m.uuid, { azione: "automatico", uuid: m.uuid })}>
                            Riprova in automatico
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="outline" disabled={inCorso === m.uuid} onClick={() => void manda(m.uuid, { azione: "non_presente", uuid: m.uuid })}>
                            Non è fra gli host
                          </Button>
                        )}
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
