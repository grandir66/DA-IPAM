"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DatoDettaglio, Etichetta, TempoRelativo, Vuoto } from "@/components/shared/console";
import { BottoneCopia } from "@/components/shared/copia";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";

const FONTE_OS: Record<string, string> = {
  ntlm: "NTLM, senza credenziali",
  snmp: "SNMP sysDescr",
  ssh: "banner SSH",
  archivio: "anagrafica",
};

const TIPO_CHIAVE: Record<string, string> = {
  ssh_hostkey: "chiave SSH",
  tls_cert: "certificato TLS",
  snmp_engine_id: "engineID SNMP",
  ntlm_computer: "nome Windows",
};

interface Servizio {
  porta: number;
  protocollo: string;
  nome: string | null;
  prodotto: string | null;
  versione: string | null;
  metodo: string | null;
}

interface Chiave {
  tipo: string;
  valore: string;
  fonte: string;
  porta: number | null;
  visto: string;
}

interface AltroIp {
  id: number;
  ip: string;
  rete: string | null;
}

interface Dati {
  id: number;
  ip: string;
  hostname: string | null;
  mac: string | null;
  vendor: string | null;
  os: string | null;
  os_fonte: string | null;
  dominio: string | null;
  ttl: number | null;
  servizi: Servizio[];
  chiavi: Chiave[];
  altri_ip: AltroIp[];
}

function corto(v: string): string {
  return /^[0-9a-f]{16,}$/i.test(v) ? `${v.slice(0, 16)}…` : v;
}

export function CassettoHost({ hostId, onClose }: { hostId: number | null; onClose: () => void }) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    if (hostId == null) {
      setDati(null);
      setErrore(null);
      return;
    }
    let vivo = true;
    setDati(null);
    setErrore(null);
    void (async () => {
      const r = await fetchJson<Dati>(`/api/hosts/${hostId}/prima-lettura`);
      if (!vivo) return;
      if (r.ok) setDati(r.data);
      else setErrore(r.message);
    })();
    return () => {
      vivo = false;
    };
  }, [hostId, tentativo]);

  return (
    <Sheet open={hostId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto" showCloseButton>
        <SheetHeader>
          <SheetTitle className="font-mono">
            {dati ? <BottoneCopia valore={dati.ip}>{dati.ip}</BottoneCopia> : "Host"}
          </SheetTitle>
          <SheetDescription>
            Prima lettura dalle sonde, senza credenziali. La scheda completa ha WinRM, SNMP e Wazuh.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {errore ? (
            <LoadError what="la prima lettura" message={errore} onRetry={() => setTentativo((n) => n + 1)} />
          ) : !dati ? (
            <p className="text-[13px] text-muted-foreground">Caricamento…</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 rounded-xl border p-3">
                <DatoDettaglio nome="Hostname" valore={dati.hostname ?? "—"} />
                <DatoDettaglio nome="Dominio" valore={dati.dominio ?? "—"} />
                <DatoDettaglio
                  nome="OS"
                  valore={
                    dati.os ? (
                      <span>
                        {dati.os}
                        {dati.os_fonte && (
                          <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                            {FONTE_OS[dati.os_fonte] ?? dati.os_fonte}
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <DatoDettaglio nome="TTL" valore={dati.ttl != null ? String(dati.ttl) : "—"} />
                <DatoDettaglio
                  nome="MAC"
                  valore={
                    dati.mac ? (
                      <span className="font-mono">
                        {dati.mac}
                        {dati.vendor ? <span className="font-sans text-muted-foreground"> · {dati.vendor}</span> : null}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                  mono
                />
              </dl>

              {dati.altri_ip.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[13px] font-semibold">Altri indirizzi della stessa macchina</p>
                  <ul className="space-y-1 text-[13px]">
                    {dati.altri_ip.map((a) => (
                      <li key={a.id}>
                        <Link href={`/objects/${a.id}`} className="font-mono hover:underline">
                          {a.ip}
                        </Link>
                        {a.rete ? <span className="text-muted-foreground"> · {a.rete}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[13px] font-semibold">Servizi ({dati.servizi.length})</p>
                {dati.servizi.length === 0 ? (
                  <Vuoto titolo="Nessun servizio" testo="Le sonde non hanno ancora letto una porta su questo IP." />
                ) : (
                  <Table fissa>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Porta</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Prodotto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dati.servizi.map((s) => (
                        <TableRow key={`${s.protocollo}-${s.porta}`}>
                          <TableCell className="font-mono">
                            {s.porta}/{s.protocollo}
                          </TableCell>
                          <TableCell>{s.nome ?? "—"}</TableCell>
                          <TableCell className="max-w-[180px] truncate">
                            {[s.prodotto, s.versione].filter(Boolean).join(" ") || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-semibold">Chiavi di identità ({dati.chiavi.length})</p>
                {dati.chiavi.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Nessuna impronta raccolta su questo IP.</p>
                ) : (
                  <ul className="space-y-2">
                    {dati.chiavi.map((k, i) => (
                      <li key={`${k.tipo}-${k.valore}-${i}`} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <Etichetta mono={false}>{TIPO_CHIAVE[k.tipo] ?? k.tipo}</Etichetta>
                        <BottoneCopia valore={k.valore}>
                          <span className="font-mono">{corto(k.valore)}</span>
                        </BottoneCopia>
                        <TempoRelativo data={k.visto} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        {dati && (
          <SheetFooter>
            <Button variant="default" size="sm" nativeButton={false} render={<Link href={`/objects/${dati.id}`} />}>
              Scheda completa
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
