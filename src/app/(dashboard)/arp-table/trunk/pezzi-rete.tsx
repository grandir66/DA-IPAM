"use client";

// I pezzi della pagina «VLAN e indirizzi» comuni alla sonda trunk e ai collector (25/11/2026).
import type { ReactNode } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Etichetta, Legenda, Pannello } from "@/components/shared/console";
import { cn } from "@/lib/utils";
import type { TrunkReteMatrice } from "@/lib/trunk/sensore-trunk";
import type { TrunkMaschera } from "@/lib/trunk/reti";

const MASCHERA: Record<TrunkMaschera, { testo: string; classe: string; spiega: string }> = {
  dhcp: { testo: "✓ DHCP", classe: "bg-[#1F7A4D] text-white border-[#1F7A4D]", spiega: "Maschera annunciata dal DHCP" },
  dedotta: { testo: "≈ dedotta", classe: "bg-[#FFD400] text-[#0D2537] border-[#C9A800]", spiega: "/24 vicini con lo stesso gateway uniti" },
  incerta: { testo: "? incerta", classe: "border-dashed border-[#C9A800] text-foreground", spiega: "IP sparsi: la rete copre quelli visti, da confermare" },
  config: { testo: "✎ impostata", classe: "bg-[#0D2537] text-white border-[#0D2537] dark:bg-[#E7EAEB] dark:text-[#0D2537]", spiega: "Scritta a mano" },
};

export const PREFISSI = [16, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

export const nomeVlan = (vid: number) => (vid === 0 ? "Nativa" : `VLAN ${vid}`);
export function fa(iso: string | null): string {
  if (!iso) return "mai";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "adesso";
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

export function ipNumero(ip: string): number {
  return ip.split(".").reduce((a, p) => a * 256 + (Number(p) || 0), 0);
}

export const silenziosi = (x: TrunkReteMatrice) => x.ip.filter((i) => !i.passivo && i.attivo).length;
export const nuoviIn = (x: TrunkReteMatrice, giorni: number) => x.serie.slice(-giorni).reduce((a, g) => a + g.nuovi, 0);
export const nuoviOggi = (x: TrunkReteMatrice) => x.serie[x.serie.length - 1]?.nuovi ?? 0;

export function Barra({ ascolto, silenziosi: sil }: { ascolto: number; silenziosi: number }) {
  const tot = ascolto + sil;
  return (
    <div className="flex h-1.5 min-w-14 overflow-hidden rounded-full bg-muted" title={`${ascolto} in ascolto, ${sil} silenziosi`}>
      {tot > 0 && <div className="bg-primary" style={{ width: `${(ascolto / tot) * 100}%` }} />}
      {tot > 0 && <div className="bg-[#0D2537] dark:bg-[#C8D3DA]" style={{ width: `${(sil / tot) * 100}%` }} />}
    </div>
  );
}

export function BadgeMaschera({ m }: { m: TrunkMaschera }) {
  const s = MASCHERA[m];
  return (
    <span title={s.spiega} className={cn("inline-block whitespace-nowrap rounded-md border-[1.5px] px-1.5 text-[13px] font-semibold leading-[21px]", s.classe)}>
      {s.testo}
    </span>
  );
}

/** Senza `onGiro` e `onMaschera` (i collector: ascoltano soltanto) quelle due azioni non ci sono. */
export function Dettaglio({ rete, giorni, inIpam, giroDisabilitato, portaDisabilitata, onGiro, onPorta, onMaschera, perche: percheDetto, azioni, etichetta }: {
  rete: TrunkReteMatrice; giorni: string[]; inIpam: boolean; giroDisabilitato?: boolean; portaDisabilitata: boolean;
  onGiro?: () => void; onPorta?: () => void; onMaschera?: (prefisso: number | null) => void;
  /** Da dove viene la maschera, se non lo dice già il suo tipo. */
  perche?: string;
  azioni?: ReactNode;
  /** Come si chiama la VLAN qui: per i collector la 0 è «senza tag», non la nativa di un trunk. */
  etichetta?: string;
}) {
  const sil = silenziosi(rete);
  const gw = rete.gateway_ip ? rete.ip.find((i) => i.ip === rete.gateway_ip) : undefined;
  const prefisso = Number(rete.cidr.split("/")[1]);
  const perche: Record<TrunkMaschera, string> = {
    dhcp: "annunciata dal DHCP",
    dedotta: rete.blocchi.length > 1 ? `dedotta: ${rete.blocchi.length} blocchi vicini con lo stesso gateway` : "dedotta dagli IP visti",
    incerta: `IP sparsi in ${rete.blocchi.length} blocchi: confermala prima di portarla in DA-IPAM`,
    config: `scritta a mano (dedotta: ${rete.dedotta})`,
  };
  return (
    <Pannello numero={3} titolo={`Rete ${rete.cidr}`} conteggio={rete.ip.length} azioni={<Etichetta tono="marca">{etichetta ?? nomeVlan(rete.vid)}</Etichetta>}>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <Dato nome="Gateway" valore={`${rete.gateway_ip ?? "—"}${gw?.vendor ? ` · ${gw.vendor}` : ""}`} />
        <Dato nome="Indirizzi" valore={onGiro ? `${rete.ip.length} (${sil} silenziosi)` : String(rete.ip.length)} />
        <Dato nome="Nuovi in 7 giorni" valore={`+${nuoviIn(rete, 7)}`} />
        <Dato nome="Maschera" valore={`/${prefisso}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <BadgeMaschera m={rete.maschera} />
        <span>{percheDetto ?? perche[rete.maschera]}</span>
        {onMaschera && rete.maschera !== "dhcp" && (
          <label className="ml-1 flex items-center gap-1.5">
            correggi
            <select value={prefisso} onChange={(e) => onMaschera(Number(e.target.value))}
              className="h-8 rounded-md border bg-card px-2 font-mono text-[13px] text-foreground">
              {[...new Set([...PREFISSI, prefisso])].sort((a, b) => a - b).map((p) => <option key={p} value={p}>/{p}</option>)}
            </select>
          </label>
        )}
        {onMaschera && rete.maschera === "config" && (
          <Button size="sm" variant="outline" onClick={() => onMaschera(null)}>Torna alla dedotta</Button>
        )}
      </div>

      <p className="mt-4 mb-1 text-[13px] font-bold uppercase tracking-wider text-cian-testo">IP conosciuti negli ultimi {giorni.length} giorni</p>
      <Grafico rete={rete} giorni={giorni} />

      <p className="mt-4 text-[13px] font-bold uppercase tracking-wider text-cian-testo">Occupazione</p>
      <Occupazione rete={rete} />

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onGiro && (
          <Button size="sm" variant="outline" className="border-[#C9A800]" disabled={giroDisabilitato} onClick={onGiro}
            title="Trova gli apparati che non parlano: stampanti, PLC, telecamere">
            <Zap className="h-4 w-4" /> Giro ARP
          </Button>
        )}
        {azioni}
        {inIpam ? <Etichetta mono={false}>✓ in DA-IPAM</Etichetta> : (
          <Button size="sm" onClick={onPorta} disabled={portaDisabilitata} className="text-[#0D2537]" title={rete.maschera === "incerta" ? "La maschera è incerta: correggila prima" : undefined}>
            Porta in DA-IPAM
          </Button>
        )}
      </div>
    </Pannello>
  );
}

function Dato({ nome, valore }: { nome: string; valore: string }) {
  return (
    <div>
      <div className="text-[13px] text-muted-foreground">{nome}</div>
      <div className="font-mono text-[15px] font-semibold">{valore}</div>
    </div>
  );
}

/** Linea = IP conosciuti (cumulato), barre gialle = nuovi quel giorno. */
function Grafico({ rete, giorni }: { rete: TrunkReteMatrice; giorni: string[] }) {
  const W = 560, H = 160, pl = 34, pb = 22, pt = 22;
  const serie = rete.serie;
  const max = Math.max(1, ...serie.map((g) => g.noti));
  const top = Math.ceil(max / 10) * 10;
  const bw = (W - pl - 8) / Math.max(serie.length, 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / top);
  const cx = (k: number) => pl + bw * k + bw / 2;
  const punti = serie.map((g, k) => `${cx(k).toFixed(1)},${y(g.noti).toFixed(1)}`).join(" ");
  const ultimo = serie.length ? serie[serie.length - 1] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="IP conosciuti per giorno">
        {[0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - 6} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray={t ? "3 3" : undefined} />
            <text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize={12} className="fill-muted-foreground font-mono">{t}</text>
          </g>
        ))}
        {serie.map((g, k) => (
          <g key={g.giorno}>
            {g.nuovi > 0 && (
              <rect x={cx(k) - bw * 0.3} y={y(g.nuovi)} width={bw * 0.6} height={y(0) - y(g.nuovi)} rx={2} fill="#FFD400" stroke="#C9A800">
                <title>{`${g.giorno}: ${g.nuovi} nuovi`}</title>
              </rect>
            )}
            {(k % 2 === 1 || k === serie.length - 1) && (
              <text x={cx(k)} y={H - 6} textAnchor="middle" fontSize={12} className="fill-muted-foreground font-mono">{g.giorno.slice(8, 10)}</text>
            )}
          </g>
        ))}
        {serie.length > 1 && <polyline points={punti} fill="none" stroke="#00A7E7" strokeWidth={2.2} strokeLinejoin="round" />}
        {ultimo && (
          <>
            <circle cx={cx(serie.length - 1)} cy={y(ultimo.noti)} r={4} fill="#00A7E7" />
            <text x={cx(serie.length - 1) - 8} y={y(ultimo.noti) - 8} textAnchor="end" fontSize={13} fontWeight={600} className="fill-foreground font-mono">{ultimo.noti}</text>
          </>
        )}
      </svg>
      <Legenda voci={[
        { classe: "bg-primary", testo: "IP conosciuti (cumulato)" },
        { classe: "bg-[#FFD400] border-[#C9A800]", testo: "nuovi quel giorno" },
        { classe: "bg-card", testo: `dal ${giorni[0]?.slice(8, 10) ?? ""}/${giorni[0]?.slice(5, 7) ?? ""}` },
      ]} />
    </div>
  );
}

/** Una griglia da 64 caselle per ogni /24 (o per la rete, se più piccola). */
function Occupazione({ rete }: { rete: TrunkReteMatrice }) {
  const prefisso = Number(rete.cidr.split("/")[1]);
  const perIp = new Map(rete.ip.map((i) => [i.ip, i]));
  const base24 = (c: string) => c.split("/")[0].split(".").slice(0, 3).join(".");
  const blocchi = prefisso >= 24
    ? [{ base: ipNumero(rete.cidr.split("/")[0]), dim: 2 ** (32 - prefisso) }]
    : [...new Set([...rete.blocchi.map(base24), ...rete.ip.map((i) => i.ip.split(".").slice(0, 3).join("."))])]
      .sort((a, b) => ipNumero(`${a}.0`) - ipNumero(`${b}.0`))
      .slice(0, 8)
      .map((b) => ({ base: ipNumero(`${b}.0`), dim: 256 }));
  const nIp = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join(".");
  return (
    <div>
      {blocchi.map(({ base, dim }) => {
        const passo = Math.max(1, Math.round(Math.min(dim, 256) / 64));
        return (
          <div key={base}>
            <div className="mt-2 mb-1 font-mono text-[13px] text-muted-foreground">
              {nIp(base)}/{dim === 256 ? 24 : prefisso} · una casella = {passo === 1 ? "1 indirizzo" : `${passo} indirizzi`}
            </div>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(64, minmax(0, 1fr))" }}>
              {Array.from({ length: 64 }, (_, c) => {
                if (c * passo >= dim) return <i key={c} className="block aspect-square rounded-[2px] bg-muted opacity-25" />;
                let tipo: "vuoto" | "ascolto" | "giro" | "gw" = "vuoto";
                for (let k = 0; k < passo; k++) {
                  const ip = nIp(base + c * passo + k);
                  const x = perIp.get(ip);
                  if (ip === rete.gateway_ip && x) { tipo = "gw"; break; }
                  if (x) tipo = x.passivo ? "ascolto" : tipo === "ascolto" ? "ascolto" : "giro";
                }
                return (
                  <i key={c} title={passo === 1 ? nIp(base + c) : undefined} className={cn("block aspect-square rounded-[2px]", {
                    vuoto: "bg-muted", ascolto: "bg-primary", giro: "bg-[#0D2537] dark:bg-[#C8D3DA]", gw: "bg-[#FFD400] outline outline-1 outline-[#C9A800]",
                  }[tipo])} />
                );
              })}
            </div>
          </div>
        );
      })}
      <Legenda className="mt-2" voci={[
        { classe: "bg-primary", testo: "in ascolto" },
        { classe: "bg-[#0D2537] dark:bg-[#C8D3DA]", testo: "silenzioso" },
        { classe: "bg-[#FFD400] border-[#C9A800]", testo: "gateway" },
        { classe: "bg-muted", testo: "mai visto" },
      ]} />
    </div>
  );
}
