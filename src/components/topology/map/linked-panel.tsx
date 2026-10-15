"use client";

/**
 * Il pannello a destra (400 px), al clic su un oggetto: chi è, tutti i suoi
 * indirizzi, a cosa è collegato e cosa c'è attaccato alle sue porte. Solo dati:
 * le azioni stanno nel menu del tasto destro (spec §11.2). Si chiude con ✕ (la
 * mappa prende tutto lo spazio) e si riapre dalla barra («◂ Dettagli»). In
 * fondo, gli oggetti della mappa che non esistono più, con «Togli» (non sono
 * sulla mappa, il tasto destro non li raggiunge).
 */
import { Fragment } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseDbDate } from "@/lib/db-date";
import { SOURCE_WORDS, altriCaviDi, linkWords, seenWords, vmPortWords } from "@/lib/topology/edge-look";
import { nodeClass } from "@/lib/topology/identity";
import { LINK_SOURCE_RANK, type LinkSource, type MapLink, type MapNode, type MapVm } from "@/lib/topology/model-types";
import { isRunning, vmSummary } from "@/lib/topology/vm-nodes";
import type { TopologyStatus } from "@/lib/topology/types";
import { TopoIcon, typeLabel } from "./topology-icons";
import type { ModelData } from "./use-topology-data";

const MAX = 200;
/** Le fonti in parole stanno con la logica pura delle linee (anche «dalle VM», spec §12.5). */
export const FONTE: Readonly<Record<LinkSource, string>> = SOURCE_WORDS;
const STATO: Record<TopologyStatus, string> = { ok: "✓ raggiungibile", warning: "◆ avviso", fail: "▲ giù", unknown: "? stato sconosciuto" };

function quando(s: string): string {
  const d = parseDbDate(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

/** Le parole «visto oggi / non visto da N g» stanno con la logica pura delle linee. */
export const visto = seenWords;

interface Props {
  model: ModelData;
  nodeId: string | null;
  /** Passo passo, admin, con una mappa scelta. */
  canEditMap: boolean;
  visible: ReadonlySet<string>;
  /** I collegamenti come li vede questa mappa (tree.links: principale, ridondanza), per id. */
  viewLinks: ReadonlyMap<string, MapLink>;
  /** Oggetti della mappa che non esistono più. */
  missing: string[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  /** Chiude il pannello (la scelta si ricorda); l'oggetto resta scelto. */
  onClose: () => void;
}

export function LinkedPanel(p: Props) {
  const { model } = p;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const n = p.nodeId ? byId.get(p.nodeId) : undefined;
  return (
    <aside className="relative w-[400px] shrink-0 overflow-auto border-l border-border bg-card px-3.5 py-3 text-[13px]">
      {!n && (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-muted-foreground">
            {p.nodeId ? `Oggetto non più presente: ${p.nodeId}` : "Nessun oggetto scelto: un clic su un oggetto della mappa ne mostra i dettagli."}
          </p>
          <CloseButton onClose={p.onClose} />
        </div>
      )}
      {n && <Detail {...p} n={n} byId={byId} />}
      {p.missing.length > 0 && (
        <section className="mt-4 border-t border-border pt-3">
          <h3 className="mb-1 font-semibold">Oggetti della mappa che non esistono più ({p.missing.length})</h3>
          <ul className="space-y-1">
            {p.missing.map((id) => (
              <li key={id} className="flex items-center gap-2">
                <span className="flex-1">non più presente: {id}</span>
                {p.canEditMap && (
                  <Button size="xs" variant="outline" className="text-[13px]" onClick={() => p.onRemove(id)}>Togli</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Chiudi i dettagli" title="Chiudi i dettagli: la mappa prende tutto lo spazio">
      <X />
    </Button>
  );
}

function Detail(p: Props & { n: MapNode; byId: Map<string, MapNode> }) {
  const { n, model, byId } = p;
  const links = model.links
    .filter((l) => l.a === n.id || l.b === n.id)
    .map((l) => p.viewLinks.get(l.id) ?? l)
    .sort((a, b) => Number(a.stale) - Number(b.stale) || LINK_SOURCE_RANK[a.source] - LINK_SOURCE_RANK[b.source] || (a.id < b.id ? -1 : 1));
  const other = (l: MapLink) => (l.a === n.id ? l.b : l.a);
  const mine = (l: MapLink) => (l.a === n.id ? l.aPort : l.bPort);
  const theirs = (l: MapLink) => (l.a === n.id ? l.bPort : l.aPort);
  const ports = model.portClients.filter((pc) => pc.nodeId === n.id);
  const rows = ports.flatMap((pc) => pc.clients.map((c, i) => ({ port: pc.port, first: i === 0, c })));
  const infraHost = n.kind === "host" && nodeClass(n) !== "client";

  return (
    <>
      <div className="flex items-start gap-2">
        <TopoIcon type={n.type} size={26} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold break-words">{n.name}</h2>
          {n.dnsName && <p className="break-words" title="Il nome è quello del nodo Proxmox; nel DNS l'apparato ha questo nome">DNS: {n.dnsName}</p>}
          <p className="text-muted-foreground">
            {typeLabel(n.type)}
            {n.id.startsWith("vm:")
              ? " · non è un oggetto censito (letta dalla scansione dell'hypervisor)"
              : <>{n.kind === "host" && " · host, non un apparato censito"} · {STATO[model.status[n.id] ?? "unknown"]}</>}
            {n.hidden && " · nascosto dalla mappa"}
          </p>
        </div>
        <CloseButton onClose={p.onClose} />
      </div>
      {n.aliases.length > 0 && <p className="mt-1">si annuncia come {n.aliases.join(", ")}</p>}
      {n.addresses.length > 0 && (
        <ul className="mt-1.5">
          {n.addresses.map((a) => (
            <li key={a.ip}>
              {a.ip}
              {a.virtual && <span className="text-muted-foreground"> · virtuale VRRP</span>}
            </li>
          ))}
        </ul>
      )}

      {infraHost && <p className="mt-1.5">Host che è infrastruttura: si può promuovere ad apparato (tasto destro).</p>}
      <VmSections n={n} vms={model.vms} byId={byId} onSelect={p.onSelect} />

      <h3 className="mt-4 mb-1 font-semibold">Collegato a ({links.length})</h3>
      {links.length === 0 ? (
        <p className="text-muted-foreground">Nessun collegamento rilevato.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-1 font-semibold">oggetto</th><th className="pr-1 font-semibold">porte</th>
              <th className="pr-1 font-semibold">fonte</th><th />
            </tr>
          </thead>
          <tbody>
            {links.slice(0, MAX).map((l) => {
              const o = byId.get(other(l));
              const vmWords = vmPortWords(l, (id) => byId.get(id)?.name ?? id);
              return (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="py-1 pr-1">
                    <button type="button" className="text-left underline" onClick={() => p.onSelect(other(l))}>{o?.name ?? other(l)}</button>
                    <div className="text-muted-foreground">{o ? typeLabel(o.type) : ""}{o?.kind === "host" ? " (host)" : ""}</div>
                  </td>
                  <td className="py-1 pr-1 [overflow-wrap:anywhere]"><Porta s={mine(l)} /> → <Porta s={theirs(l)} /></td>
                  <td className="py-1 pr-1">
                    {l.sources.map((s) => FONTE[s]).join(" + ")}
                    <div className={l.stale ? "font-semibold" : "text-muted-foreground"}>{visto(l)}</div>
                    {vmWords && <div>{vmWords}</div>}
                    {linkWords(l).map((w) => <div key={w}>{w}</div>)}
                    {l.altriCavi && l.altriCavi.length > 0 && (
                      <div className="mt-1">
                        <div className="font-semibold">Altri cavi visti fra questi due oggetti</div>
                        <ul>
                          {altriCaviDi(l, n.id).map((c, k) => (
                            <li key={k}>
                              <Porta s={c.mia} /> → <Porta s={c.sua} /> · {c.fonti}{c.visto ? ` · visto ${quando(c.visto)}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                  <td className="py-1 whitespace-nowrap">
                    {p.visible.has(other(l)) ? <span className="font-semibold">✓ nella mappa</span> : <span className="text-muted-foreground">fuori</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {links.length > MAX && <p className="mt-1 text-muted-foreground">+ altri {links.length - MAX}</p>}
      {rows.length > 0 && (
        <>
          <h3 className="mt-4 mb-1 font-semibold">Porte con dispositivi attaccati ({ports.length} porte, {rows.length} MAC)</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-1 font-semibold">porta</th><th className="pr-1 font-semibold">MAC</th><th className="font-semibold">cosa c&apos;è</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX).map(({ port, first, c }) => (
                <tr key={`${port}|${c.mac}`} className={first ? "border-t border-border align-top" : "align-top"}>
                  <td className="py-0.5 pr-1">{first ? port : ""}</td>
                  <td className="py-0.5 pr-1 font-mono">{c.mac}</td>
                  <td className="py-0.5">
                    {c.nodeId ? (
                      <button type="button" className="text-left underline" onClick={() => p.onSelect(c.nodeId as string)}>{c.name ?? c.ip ?? c.nodeId}</button>
                    ) : (
                      [c.name, c.ip].filter(Boolean).join(" · ") || <span className="text-muted-foreground">sconosciuto</span>
                    )}
                    {c.stale && <div className="text-muted-foreground">visto l&apos;ultima volta {quando(c.lastSeen)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX && <p className="mt-1 text-muted-foreground">+ altri {rows.length - MAX}</p>}
        </>
      )}
    </>
  );
}

/** Se l'oggetto è una VM: stato, IP, su quale hypervisor. Se è un hypervisor: le sue VM. */
function VmSections({ n, vms, byId, onSelect }: { n: MapNode; vms: MapVm[]; byId: Map<string, MapNode>; onSelect: (id: string) => void }) {
  const me = vms.find((v) => v.id === n.id || v.nodeId === n.id);
  const mine = vms.filter((v) => v.hypervisorNodeId === n.id).sort((a, b) => a.name.localeCompare(b.name, "it"));
  // Una VM si apre dal suo oggetto censito, o dal suo nodo «vm:» se è nella pagina.
  const target = (v: MapVm): string | null => v.nodeId ?? (byId.has(v.id) ? v.id : null);
  return (
    <>
      {me && (
        <section className="mt-3">
          <h3 className="mb-1 font-semibold">Macchina virtuale{me.name !== n.name ? ` «${me.name}»` : ""}</h3>
          <p>
            {isRunning(me.status) ? "▶ accesa" : `■ spenta (${me.status || "stato non letto"})`}
            {me.ips.length > 0 && ` · ${me.ips.join(", ")}`}
          </p>
          {me.hypervisorNodeId && (
            <p>
              gira su{" "}
              <button type="button" className="underline" onClick={() => onSelect(me.hypervisorNodeId as string)}>
                {byId.get(me.hypervisorNodeId)?.name ?? me.hypervisorNodeId}
              </button>
            </p>
          )}
          {me.scannedAt && <p className="text-muted-foreground">letta il {quando(me.scannedAt)}</p>}
        </section>
      )}
      {mine.length > 0 && (
        <section className="mt-3">
          <h3 className="mb-1 font-semibold">VM ({vmSummary(mine).label})</h3>
          <table className="w-full border-collapse">
            <tbody>
              {mine.slice(0, MAX).map((v) => {
                const t = target(v);
                return (
                  <tr key={v.id} className="border-t border-border align-top">
                    <td className="py-0.5 pr-1 whitespace-nowrap">{isRunning(v.status) ? "▶ accesa" : "■ spenta"}</td>
                    <td className="py-0.5 pr-1 [overflow-wrap:anywhere]">
                      {t ? <button type="button" className="text-left underline" onClick={() => onSelect(t)}>{v.name}</button> : v.name}
                    </td>
                    <td className="py-0.5 [overflow-wrap:anywhere]">{v.ips.join(", ") || <span className="text-muted-foreground">IP non noto</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mine.length > MAX && <p className="mt-1 text-muted-foreground">+ altre {mine.length - MAX}</p>}
          {mine[0]?.scannedAt && <p className="mt-1 text-muted-foreground">lette il {quando(mine[0].scannedAt)}</p>}
        </section>
      )}
    </>
  );
}

/**
 * Un nome di porta che va a capo dopo «/» e «,» («bridge/ether3», «ether1-2.5,bridge»),
 * non a metà parola: prima con `break-all` si leggeva «bridg / e/ether3» (Task 12).
 */
function Porta({ s }: { s: string | null | undefined }) {
  if (!s) return <>?</>;
  const parts = s.split(/(?<=[/,])/);
  return <>{parts.map((x, i) => <Fragment key={i}>{i > 0 && <wbr />}{x}</Fragment>)}</>;
}
