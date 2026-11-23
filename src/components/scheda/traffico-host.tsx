"use client";

/**
 * Riquadro «Con chi parla» della scheda (tab Sicurezza): le coppie viste dai collector di traffico negli ultimi
 * 7 giorni e i nomi chiesti. Senza dati non compare (come Wazuh): niente collector, niente riquadro.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { TempoRelativo } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte, protoPorta } from "@/lib/traffico/frasi";
import type { CoppiaHost, NomeHost } from "@/lib/traffico/lettura";
import type { IdentitaDiIp } from "@/lib/traffico/identita";
import type { NomeDiIp } from "@/lib/traffico/quadro";
import type { ServiziDiHost } from "@/lib/traffico/connessioni";
import { Riquadro } from "./riquadro";

interface Risposta { parlaCon: CoppiaHost[]; gliParlano: CoppiaHost[]; nomi: NomeHost[]; host: Record<string, NomeDiIp>; identita?: IdentitaDiIp[]; mac_censito?: string | null; servizi?: ServiziDiHost }

const NOME_FONTE: Record<string, string> = { arp: "ARP", dhcp: "DHCP", mdns: "mDNS", netbios: "NetBIOS", ssdp: "SSDP", lldp: "LLDP", cdp: "CDP" };

/** Come l'indirizzo si è annunciato alla rete: un MAC per riga, il più recente in alto. */
function Presentazione({ righe, censito }: { righe: IdentitaDiIp[]; censito: string | null }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
        Come si presenta in rete <span className="font-mono font-normal text-muted-foreground">{righe.length}</span>
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MAC</TableHead><TableHead>Nome annunciato</TableHead><TableHead>Tipo dichiarato</TableHead>
              <TableHead>Fonti</TableHead><TableHead>VLAN</TableHead><TableHead>Prima volta</TableHead><TableHead>Ultima volta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {righe.map((r, i) => (
              <TableRow key={r.mac}>
                <TableCell className="font-mono font-semibold">
                  {r.mac.toUpperCase()}
                  {i === 0 && censito && censito.toLowerCase() !== r.mac && (
                    <span className="ml-2 rounded-md border border-[#C9A800] bg-[#FFD400] px-1.5 py-0.5 font-sans text-[13px] font-semibold text-[#0D2537]" title={`In IPAM questo indirizzo ha il MAC ${censito.toUpperCase()}`}>▲ diverso dal censito</span>
                  )}
                </TableCell>
                <TableCell>{r.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-xs whitespace-normal">{r.tipo || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{r.fonti.split(",").map((f) => NOME_FONTE[f] ?? f).join(", ")}</TableCell>
                <TableCell className="font-mono">{r.vlan > 0 ? r.vlan : "—"}</TableCell>
                <TableCell><TempoRelativo data={r.prima_vista} /></TableCell>
                <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Altro({ ip, host }: { ip: string; host: Record<string, NomeDiIp> }) {
  if (ip === "esterno") return <span>fuori dalla rete</span>;
  if (ip === "diffusione") return <span>a tutti (diffusione)</span>;
  const h = host[ip];
  if (!h) return <span className="font-mono font-semibold">{ip}</span>;
  return (
    <Link href={`/objects/${h.id}`} className="font-semibold text-cian-testo underline-offset-2 hover:underline">
      {h.nome ? <>{h.nome} <span className="font-mono text-[13px] font-normal text-muted-foreground">{ip}</span></> : <span className="font-mono">{ip}</span>}
    </Link>
  );
}

function Coppie({ titolo, righe, host }: { titolo: string; righe: CoppiaHost[]; host: Record<string, NomeDiIp> }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
        {titolo} <span className="font-mono font-normal text-muted-foreground">{righe.length}</span>
      </p>
      {righe.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nessuno negli ultimi 7 giorni.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Host</TableHead><TableHead>Porta</TableHead><TableHead className="text-right">Volume</TableHead><TableHead>Ultima volta</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((c) => (
                <TableRow key={`${c.altro}|${c.proto}|${c.porta}`}>
                  <TableCell><Altro ip={c.altro} host={host} />{c.altro === "esterno" && c.esterni > 0 && <span className="text-[13px] text-muted-foreground"> · {c.esterni} indirizzi</span>}</TableCell>
                  <TableCell className="font-mono">{protoPorta(c.proto, c.porta)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(c.byte)}</TableCell>
                  <TableCell><TempoRelativo data={c.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Le porte usate nel traffico contro quelle che IPAM sa aperte dalle scansioni (tappa 5, approvata il 23/11). */
function ServiziUsati({ s }: { s: ServiziDiHost }) {
  const etichetta = (p: { proto: string; porta: number; servizio: string | null }) => `${p.proto}/${p.porta}${p.servizio ? ` ${p.servizio}` : ""}`;
  const gruppi: { titolo: string; voci: { chiave: string; testo: string; nota?: string }[]; classe: string; segno?: string; spiega?: string }[] = [
    { titolo: "Usati e noti", classe: "border bg-muted", voci: s.usate_note.map((p) => ({ chiave: `${p.proto}/${p.porta}`, testo: etichetta(p), nota: `${p.client} client` })) },
    { titolo: "Usati ma non noti a IPAM", segno: "!", classe: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]", spiega: "qualcuno li usa e la scansione non li conosce",
      voci: s.usate_non_note.map((p) => ({ chiave: `${p.proto}/${p.porta}`, testo: etichetta(p), nota: `${p.client} client` })) },
    { titolo: "Aperti, mai usati", classe: "border border-dashed border-foreground/50", spiega: "nel traffico che passa da un collector",
      voci: s.aperte_mai_usate.map((p) => ({ chiave: `${p.proto}/${p.porta}`, testo: etichetta(p) })) },
  ];
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">Servizi usati · ultimi {s.giorni} giorni</p>
      <div className="grid gap-3 lg:grid-cols-3">
        {gruppi.map((g) => (
          <div key={g.titolo}>
            <p className="mb-1 text-[13px] font-semibold">
              {g.segno && <span aria-hidden className="mr-1">{g.segno}</span>}{g.titolo} <span className="font-mono font-normal text-muted-foreground">{g.voci.length}</span>
              {g.spiega && <span className="block font-normal text-muted-foreground">{g.spiega}</span>}
            </p>
            {g.voci.length === 0 ? <span className="text-[13px] text-muted-foreground">—</span> : (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {g.voci.map((v) => (
                  <span key={v.chiave} className={`rounded-md px-1.5 py-0.5 font-mono text-[13px] ${g.classe}`} title={v.nota}>
                    {g.segno && <span aria-hidden className="mr-0.5 font-sans font-bold">{g.segno}</span>}{v.testo}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrafficoHost({ ip }: { ip: string }) {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetchJson<Risposta>(`/api/traffico/host/${encodeURIComponent(ip)}`)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
      })
      .catch(() => { if (vivo) setErrore("Server non raggiungibile"); });
    return () => { vivo = false; };
  }, [ip, tentativo]);

  if (errore !== null) {
    return <Riquadro titolo="Con chi parla"><LoadError what="il traffico dell'host" message={errore} onRetry={() => setTentativo((t) => t + 1)} /></Riquadro>;
  }
  const identita = dati?.identita ?? [];
  const programmi = (dati?.nomi ?? []).filter((n) => n.tipo === "software");
  const nomiChiesti = (dati?.nomi ?? []).filter((n) => n.tipo !== "software");
  if (dati === null || (dati.parlaCon.length === 0 && dati.gliParlano.length === 0 && dati.nomi.length === 0 && identita.length === 0)) return null;
  return (
    <Riquadro titolo="Con chi parla · ultimi 7 giorni" azione={<Link href="/traffico" className="text-[13px] font-semibold text-cian-testo underline-offset-2 hover:underline">Anomalie del traffico ›</Link>}>
      {identita.length > 0 && <Presentazione righe={identita} censito={dati.mac_censito ?? null} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Coppie titolo="Parla con" righe={dati.parlaCon} host={dati.host} />
        <Coppie titolo="Gli parlano" righe={dati.gliParlano} host={dati.host} />
      </div>
      {dati.servizi && (dati.servizi.usate_note.length + dati.servizi.usate_non_note.length + dati.servizi.aperte_mai_usate.length) > 0 && <ServiziUsati s={dati.servizi} />}
      {programmi.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
            Programmi dichiarati <span className="font-mono font-normal text-muted-foreground">{programmi.length}</span>
          </p>
          <p className="mb-1.5 text-[13px] text-muted-foreground">La versione che il programma dice di sé nei saluti in chiaro, non una verifica.</p>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {programmi.map((n) => (
              <span key={n.nome} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[13px]" title={`${n.conteggio} volte`}>{n.nome}</span>
            ))}
          </div>
        </div>
      )}
      {nomiChiesti.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
            Nomi chiesti <span className="font-mono font-normal text-muted-foreground">{nomiChiesti.length}</span>
          </p>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {nomiChiesti.map((n) => (
              <span key={`${n.tipo}|${n.nome}`} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[13px]" title={`${n.tipo === "dns" ? "chiesto al DNS" : "nel saluto TLS"} · ${n.conteggio} volte`}>
                <span className="font-sans font-semibold">{n.tipo === "dns" ? "DNS" : "TLS"}</span> {n.nome}
              </span>
            ))}
          </div>
        </div>
      )}
    </Riquadro>
  );
}
