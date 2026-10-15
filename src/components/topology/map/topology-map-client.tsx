"use client";

/**
 * La pagina Topologia (spec 2026-10-12 §10-§11, prototipo approvato il 13/10):
 * «Tutto automatico» (tutta la rete dalla testa, si ricalcola da sola) e
 * mappe «Passo passo» salvate (solo gli oggetti scelti). Qui vivono lo stato
 * della pagina (modo, mappa, oggetto scelto, barra dei dettagli) e le
 * scritture; albero e disposizione sono la logica pura di src/lib/topology.
 * Fase 2b (spec §11.2-§11.5): gli oggetti entrano trascinandoli dall'elenco, le
 * azioni stanno nel menu del tasto destro, la barra di destra si chiude,
 * «Collega a…» apre il dialogo delle porte, gli hypervisor si espandono con le
 * loro VM (stato della pagina, non salvato) e una VM entra in una mappa.
 * Spec §12: ogni mappa ha il suo orientamento (letto dalla vista, cambiato da un
 * admin), i ritocchi si salvano con l'orientamento in cui sono fatti e «Riordina»
 * toglie solo quelli; le ridondanze sono a richiesta («Mostra ridondanze»,
 * ricordato per chi guarda).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { IGNORA_SI_ANNULLA, testiIgnoraCavo } from "@/lib/topology/ignored-links";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nodeClass } from "@/lib/topology/identity";
import {
  addableLinked, connectRefusal, edgeMenuItems, findManualOverride, isUncensusedVmId, nodeMenuItems, primaryTarget, refreshVmDeviceIds, vmMenuItems,
  type EdgeMenuKey, type NodeMenuKey,
} from "@/lib/topology/map-menus";
import { computeMapView } from "@/lib/topology/map-compute";
import { ELENCO_KEY, elencoAperto, printHref, salvaElenco } from "@/lib/topology/map-screen";
import type { MapLink, MapOrientation, MapVm } from "@/lib/topology/model-types";
import { isRunning, vmSummary } from "@/lib/topology/vm-nodes";
import { missingNeighbors } from "@/lib/topology/tree";
import { dragTweaks, type SavedTweak } from "@/lib/topology/tree-layout";
import {
  clearPrimary, createManualLink, deleteManualLink, fetchLinkOverrides, ignoreLink, patchManualLink, refreshProxmoxScan, setMapOrientation, setPrimary,
} from "./api";
import { ConnectDialog, type ConnectRequest } from "./connect-dialog";
import { EdgeMenuContent } from "./edge-context-menu";
import { FONTE, LinkedPanel, visto } from "./linked-panel";
import { MapCanvas, type MenuTarget } from "./map-canvas";
import { MapToolbar, NameDialog, type Mode } from "./map-toolbar";
import { NodeMenuContent, VmMenuContent } from "./node-context-menu";
import { DRAG_MIME, ObjectList } from "./object-list";
import { TopologyIconDefs } from "./topology-icons";
import { useTopologyData, type MapRow } from "./use-topology-data";

/** Barra dei dettagli aperta o chiusa: si ricorda per chi guarda, in questo browser. */
const DETAILS_KEY = "da-ipam.topologia.dettagli";

function readDetailsOpen(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_KEY) !== "chiusa";
  } catch {
    return true; // storage non disponibile (navigazione privata, bloccato): aperta, come prima
  }
}

function writeDetailsOpen(open: boolean): void {
  try {
    window.localStorage.setItem(DETAILS_KEY, open ? "aperta" : "chiusa");
  } catch {
    // storage non disponibile: la scelta vale solo per questa visita
  }
}

/** «Mostra ridondanze» (spec §12.5): spento di base, ricordato per chi guarda, in questo browser. */
const REDUNDANT_KEY = "da-ipam.topologia.ridondanze";

function readShowRedundant(): boolean {
  try {
    return window.localStorage.getItem(REDUNDANT_KEY) === "mostra";
  } catch {
    return false; // storage non disponibile: spento, come di base
  }
}

function writeShowRedundant(show: boolean): void {
  try {
    window.localStorage.setItem(REDUNDANT_KEY, show ? "mostra" : "nascondi");
  } catch {
    // storage non disponibile: la scelta vale solo per questa visita
  }
}

export function TopologyMapClient({ isAdmin }: { isAdmin: boolean }) {
  return (
    <ReactFlowProvider>
      <TopologyMap isAdmin={isAdmin} />
    </ReactFlowProvider>
  );
}

function TopologyMap({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const rf = useReactFlow();
  const [mode, setMode] = useState<Mode>("auto");
  const [chosenMap, setChosenMap] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Le ridondanze (spec §12.5) sono a richiesta: con due switch centrali erano un groviglio di linee.
  const [showExtra, setShowExtra] = useState(false);
  const [centerKey, setCenterKey] = useState(1);
  /** Ritocchi appena fatti a schermo (il nodo trascinato e il suo ramo), finché il server non li restituisce. */
  const [pending, setPending] = useState<{ view: string; tweaks: SavedTweak[] } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  // L'elenco a sinistra si chiude per lasciare la larghezza alla mappa (spec §13.10.2); di base è aperto.
  const [listOpen, setListOpen] = useState(true);
  /** Oggetto trascinato senza una mappa scelta: si chiede il nome della mappa nuova. */
  const [newMapFor, setNewMapFor] = useState<string | null>(null);
  /** Oggetto appena aggiunto trascinandolo: il punto del rilascio diventa il suo ritocco quando compare. */
  const [pendingDrop, setPendingDrop] = useState<{ view: string; nodeId: string; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [ignoreAsk, setIgnoreAsk] = useState<MapLink | null>(null);
  /** Hypervisor con le VM mostrate: stato della pagina, non salvato (spec §11.5). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** «Collega a…» dal menu: il prossimo clic su un oggetto è l'arrivo. */
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connect, setConnect] = useState<ConnectRequest | null>(null);
  const toggleVms = useCallback((id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);
  const renamesSent = useRef<string | null>(null);

  const viewKey = mode === "auto" ? "auto" : chosenMap !== null ? String(chosenMap) : null;
  const { data, error, refreshError, reload, send } = useTopologyData(viewKey);
  const maps = useMemo(() => data?.maps.maps ?? [], [data]);

  useEffect(() => {
    setDetailsOpen(readDetailsOpen());
    setShowExtra(readShowRedundant());
    setListOpen(elencoAperto(() => window.localStorage.getItem(ELENCO_KEY)));
  }, []);
  const changeDetails = (open: boolean) => { setDetailsOpen(open); writeDetailsOpen(open); };
  const changeList = (open: boolean) => { setListOpen(open); salvaElenco((v) => window.localStorage.setItem(ELENCO_KEY, v), open); };
  const changeShowExtra = (show: boolean) => { setShowExtra(show); writeShowRedundant(show); };

  // La mappa scelta non c'è più (cancellata, anche da un altro) o non è ancora scelta: si passa alla prima.
  const effectiveMap = data ? (maps.some((m) => m.id === chosenMap) ? chosenMap : (maps[0]?.id ?? null)) : chosenMap;
  useEffect(() => {
    if (mode === "passo" && effectiveMap !== chosenMap) setChosenMap(effectiveMap);
  }, [mode, effectiveMap, chosenMap]);

  const view = data && data.viewKey === viewKey ? data.view : null;
  const viewLoading = !data || data.viewKey !== viewKey;
  const positionsView = mode === "auto" ? "auto" : `mappa:${chosenMap}`;
  /** L'orientamento salvato della mappa (spec §12.2): la vista lo porta sempre; finché carica, il predefinito. */
  const orientation: MapOrientation = view?.orientation ?? "lr";

  const d = useMemo(() => {
    if (!data) return null;
    // Un calcolo solo per schermo e stampa (map-compute.ts): stesso albero, stessa disposizione, stessi nomi.
    const auto = data.maps.auto;
    const own = pending && pending.view === viewKey ? pending.tweaks : null;
    const c = computeMapView(data.model, {
      auto: mode === "auto",
      members: view?.nodes ?? [],
      roots: view?.map?.roots ?? [],
      head: mode === "auto" ? (auto?.head_node ?? null) : null,
      tweaks: view?.tweaks ?? [],
      ownTweaks: own,
      expanded,
      orientation,
    });
    const { model, visible, roots, missing, head, tree, layout } = c;
    const headOrigin = mode === "auto" ? (c.headChosen ? `scelta da ${auto?.created_by ?? "un amministratore"}` : "proposta dal sistema") : "";
    const plus = new Map<string, number>();
    if (mode === "passo") {
      for (const id of visible) {
        const k = new Set(missingNeighbors(model, id, visible).map((l) => (l.a === id ? l.b : l.a))).size;
        if (k > 0) plus.set(id, k);
      }
    }
    // «▶ partenza» solo sulle partenze che fanno davvero da radice dell'albero.
    const starts = new Set(mode === "passo" ? roots.filter((r) => tree.roots.includes(r)) : []);
    const promoteIds = new Set(model.promote.map((p) => `host:${p.hostId}`));
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const vmsOf = new Map<string, MapVm[]>();
    for (const v of model.vms) if (v.hypervisorNodeId) vmsOf.set(v.hypervisorNodeId, [...(vmsOf.get(v.hypervisorNodeId) ?? []), v]);
    const vmInfo = new Map<string, { label: string; open: boolean }>();
    for (const [h, list] of vmsOf) if (visible.has(h)) vmInfo.set(h, { label: vmSummary(list).label, open: expanded.has(h) });
    const viewLinks = new Map(tree.links.map((l) => [l.id, l]));
    return {
      model, visible, roots, missing, head, headOrigin, tree, layout, plus, starts, promoteIds, byId, vmsOf, vmInfo, viewLinks,
      savedRoots: c.savedRoots, renames: c.renames, tweaks: c.tweaks,
    };
  }, [data, mode, view, pending, viewKey, expanded, orientation]);

  // Esc annulla «scegli l'oggetto di arrivo».
  useEffect(() => {
    if (!connectFrom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConnectFrom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectFrom]);

  const mapPath = `/api/topology/maps/${chosenMap}`;
  const canEditMap = isAdmin && mode === "passo" && chosenMap !== null && !viewLoading;

  /**
   * Gli id salvati di oggetti poi promossi o fusi si riscrivono sull'id canonico
   * alla prima modifica della mappa, non alla lettura (I5). Una volta per vista.
   */
  async function persistRenames(): Promise<boolean> {
    if (!d || d.renames.length === 0) return true;
    const key = `${positionsView}|${JSON.stringify(d.renames)}`;
    if (renamesSent.current === key) return true;
    const ok = (await send("/api/topology/positions", "PUT", { view: positionsView, rename: d.renames })).ok;
    if (ok) renamesSent.current = key;
    return ok;
  }
  async function move(nodeId: string, x: number, y: number) {
    if (!d || !viewKey || !(await persistRenames())) return;
    // Il ritocco vale nell'orientamento in cui è fatto (spec §12.2): senza, la rotta risponde 400.
    // Il nodo si porta dietro il suo ramo (spec §4/§11.2): i ritocchi già salvati dei discendenti si spostano dello
    // stesso scarto, nella stessa chiamata.
    const tweaks = dragTweaks(d.tree, d.layout, d.tweaks, nodeId, x, y, orientation);
    setPending({ view: viewKey, tweaks });
    await send("/api/topology/positions", "PUT", {
      view: positionsView, orientation, tweaks: tweaks.map((t) => ({ nodeId: t.nodeId, x: t.x, y: t.y, sig: t.sig })),
    });
    setPending(null);
  }

  // Il ritocco di un oggetto trascinato dall'elenco si salva quando l'oggetto è nella disposizione
  // (la firma è quella dell'albero nuovo); il punto del rilascio diventa il centro del riquadro.
  useEffect(() => {
    if (!pendingDrop || !d || pendingDrop.view !== viewKey) return;
    const ln = d.layout.nodes.get(pendingDrop.nodeId);
    if (!ln) return;
    setPendingDrop(null);
    if (ln.role === "box") void move(pendingDrop.nodeId, Math.round(pendingDrop.x - ln.w / 2), Math.round(pendingDrop.y - ln.h / 2));
    // `move` è ricreata a ogni render e legge `d` di questo render: basta ripartire quando cambiano i dati.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDrop, d, viewKey]);

  if (error) return <LoadError what="i dati della mappa" message={error} onRetry={() => void reload()} />;
  if (!data || !d) return <p className="text-sm text-muted-foreground">Caricamento della mappa…</p>;

  const changeMode = (m: Mode) => { setMode(m); setSelected(null); setConnectFrom(null); setCenterKey((k) => k + 1); };

  async function addNodes(ids: string[]): Promise<boolean> {
    if (chosenMap === null || ids.length === 0 || !(await persistRenames())) return false;
    return (await send(`${mapPath}/nodes`, "PUT", { add: ids, remove: [] })).ok;
  }
  async function removeNode(id: string) {
    if (chosenMap !== null && (await persistRenames())) await send(`${mapPath}/nodes`, "PUT", { add: [], remove: [id] });
  }
  async function setStart(id: string) {
    if (chosenMap === null || !d || !(await persistRenames())) return;
    if (!d.visible.has(id) && !(await addNodes([id]))) return;
    await send(mapPath, "PATCH", { roots: [...new Set([...d.savedRoots, id])] });
  }
  async function setHead(id: string) {
    if (await persistRenames()) await send("/api/topology/maps/auto", "PATCH", { head_node: id });
    setCenterKey((k) => k + 1);
  }
  async function insert(id: string): Promise<boolean> {
    setSelected(id);
    if (!(await addNodes([id])) || !d) return false;
    // Diventa una partenza se la mappa non ne ha, o se non è collegato a niente di ciò che c'è già.
    const linked = d.model.links.some((l) => (l.a === id && d.visible.has(l.b)) || (l.b === id && d.visible.has(l.a)));
    if (d.roots.length === 0 || (!linked && nodeClass(d.byId.get(id) ?? { type: "" }) !== "client")) {
      await send(mapPath, "PATCH", { roots: [...new Set([...d.savedRoots, id])] });
      if (d.roots.length === 0) setCenterKey((k) => k + 1);
    }
    return true;
  }
  /** «Verticale | Orizzontale» (admin): si salva sulla mappa, si ricarica e si ricentra sulla disposizione nuova. */
  async function changeOrientation(o: MapOrientation) {
    if (o === orientation || viewLoading || (mode === "passo" && chosenMap === null)) return;
    const r = await setMapOrientation(send, mode === "auto" ? "auto" : (chosenMap as number), o);
    if (r.ok) setCenterKey((k) => k + 1);
  }
  async function createMap(name: string, from?: { roots: string[]; nodes: string[] }): Promise<boolean> {
    const r = await send<MapRow>("/api/topology/maps", "POST", { name, roots: from?.roots ?? [], nodes: from?.nodes ?? [] });
    if (!r.ok) return false;
    setChosenMap(r.data.id);
    changeMode("passo");
    return true;
  }

  // ─── Trascinamento dall'elenco (spec §11.2) ────────────────────────────────
  const canDrop = isAdmin && mode === "passo" && (chosenMap === null || !viewLoading);
  /** Un oggetto rilasciato sulla mappa: entra nella mappa; senza mappa scelta si chiede il nome e la si crea. */
  async function dropNode(rawId: string, at: { x: number; y: number } | null) {
    if (!d || !canDrop) return;
    const id = d.model.canonical[rawId] ?? rawId;
    if (!d.byId.has(id)) return;
    if (chosenMap === null) { setNewMapFor(id); return; }
    if (d.visible.has(id)) { setSelected(id); return; }
    if ((await insert(id)) && at && viewKey) setPendingDrop({ view: viewKey, nodeId: id, x: at.x, y: at.y });
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canDrop || !e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  }
  function onDrop(e: DragEvent<HTMLDivElement>, flowShown: boolean) {
    setDragOver(false);
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id || !canDrop) return;
    e.preventDefault();
    void dropNode(id, flowShown ? rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) : null);
  }

  // ─── Menu del tasto destro (spec §11.2) ────────────────────────────────────
  const name = (id: string) => d.byId.get(id)?.name ?? id;
  function openDetails(id: string) {
    setSelected(id);
    changeDetails(true);
  }
  function onNodeAction(id: string, key: Exclude<NodeMenuKey, "addLinked">) {
    const n = d?.byId.get(id);
    if (!n) return;
    switch (key) {
      case "details": return openDetails(id);
      case "start": return void setStart(id);
      case "head": return void setHead(id);
      case "remove": return void removeNode(id);
      case "hide": return void send("/api/topology/nodes/hidden", "PUT", { node_id: id, hidden: !n.hidden });
      case "promote": return router.push(`/objects/${n.refId}?promote=1`);
      case "toggleVms": return toggleVms(id);
      case "refreshVms": return void refreshVms(id);
      case "connect": setConnectFrom(id); return;
      default: return;
    }
  }
  /** «Aggiorna VM»: rilegge la scansione Proxmox degli apparati che vedono quell'hypervisor (SSH: può metterci un po'). */
  async function refreshVms(id: string) {
    if (!d) return;
    const devices = refreshVmDeviceIds(d.model.vms, id);
    const t = toast.loading(`Lettura delle VM di «${name(id)}» in corso…`);
    let ok = 0;
    for (const dev of devices) if ((await refreshProxmoxScan(send, dev)).ok) ok++;
    toast.dismiss(t);
    if (ok > 0) toast.success(ok === devices.length ? "VM aggiornate" : `VM aggiornate da ${ok} letture su ${devices.length}`);
  }
  function openConnect(a: string, b: string) {
    setConnectFrom(null);
    if (a === b) return;
    const no = connectRefusal(a, b);
    if (no) { toast.error(no); return; }
    setConnect({ a, b, aName: name(a), bName: name(b), edit: null });
  }
  async function editPorts(link: MapLink) {
    if (!d) return;
    const rows = await fetchLinkOverrides();
    if (!rows.ok) { toast.error(`Errore: ${rows.message}`); return; }
    const o = findManualOverride(rows.data, link, d.model.canonical);
    if (!o) { toast.error("Errore: la correzione a mano di questa linea non c'è più (ricarico la mappa)"); void reload(); return; }
    // Il dialogo segue l'ordine della correzione salvata, così le porte restano sul loro capo.
    const a = d.model.canonical[o.a_node] ?? o.a_node, b = d.model.canonical[o.b_node] ?? o.b_node;
    setConnect({ a, b, aName: name(a), bName: name(b), edit: o });
  }
  function onVmAction(v: MapVm, key: "add" | "details") {
    if (key === "details") return openDetails(v.nodeId ?? (d?.byId.has(v.id) ? v.id : (v.hypervisorNodeId ?? v.id)));
    void addNodes([v.nodeId ?? v.id]);
  }
  async function onEdgeAction(link: MapLink, key: EdgeMenuKey) {
    if (!d) return;
    switch (key) {
      case "primary": await setPrimary(send, primaryTarget(link, d.tree)); return;
      case "unprimary": await clearPrimary(send, link.primaryFor ?? primaryTarget(link, d.tree).node_id); return;
      case "ignore": setIgnoreAsk(link); return;
      case "editPorts": await editPorts(link); return;
      case "remove": {
        const rows = await fetchLinkOverrides();
        if (!rows.ok) { toast.error(`Errore: ${rows.message}`); return; }
        const o = findManualOverride(rows.data, link, d.model.canonical);
        if (!o) { toast.error("Errore: la correzione a mano di questa linea non c'è più (ricarico la mappa)"); void reload(); return; }
        await deleteManualLink(send, o.id);
        return;
      }
      default: return;
    }
  }
  function renderMenu(t: MenuTarget, close: () => void): ReactNode {
    if (!d) return null;
    if (t.kind === "edge") {
      const l = t.link;
      return (
        <EdgeMenuContent
          title={`${name(l.a)} ↔ ${name(l.b)}`}
          detail={[`${l.aPort || "?"} → ${l.bPort || "?"}`, l.sources.map((s) => FONTE[s]).join(" + "), visto(l)].join(" · ")}
          items={edgeMenuItems(l, isAdmin)}
          onAction={(k) => { close(); void onEdgeAction(l, k); }}
        />
      );
    }
    if (t.kind === "vm") {
      const v = d.model.vms.find((x) => x.id === t.vmId);
      if (!v) return null;
      const host = v.hypervisorNodeId ? name(v.hypervisorNodeId) : null;
      return (
        <VmMenuContent
          title={v.name}
          detail={[isRunning(v.status) ? "▶ accesa" : "■ spenta", v.ips[0], host ? `su ${host}` : null, v.nodeId ? `è «${name(v.nodeId)}»` : null].filter(Boolean).join(" · ")}
          items={vmMenuItems({ canEditMap, inMap: d.visible.has(v.nodeId ?? v.id) })}
          onAction={(k) => { close(); onVmAction(v, k); }}
        />
      );
    }
    const n = d.byId.get(t.id);
    if (!n) return null;
    const addable = mode === "passo" && canEditMap ? addableLinked(d.model, n.id, d.visible) : [];
    const isHyper = nodeClass(n) === "hyper";
    const items = nodeMenuItems({
      mode, isAdmin, canEditMap, inMap: d.visible.has(n.id), isHead: n.id === d.head, isStart: d.roots.includes(n.id),
      isDevice: n.kind === "device", hidden: n.hidden, isHypervisor: isHyper, vmCount: d.vmsOf.get(n.id)?.length ?? 0,
      expanded: expanded.has(n.id), canRefreshVms: isHyper && refreshVmDeviceIds(d.model.vms, n.id).length > 0,
      infraHost: n.kind === "host" && nodeClass(n) !== "client", addableCount: addable.length, isUncensusedVm: isUncensusedVmId(n.id),
      ruolo: n.kind === "device" ? (n.ruolo ?? "") : null,
    });
    return (
      <NodeMenuContent
        title={n.name}
        items={items}
        addable={addable}
        onAction={(k) => { close(); onNodeAction(n.id, k); }}
        onAddLinked={(ids) => { close(); void addNodes(ids); }}
        ruolo={n.kind === "device" ? (n.ruolo ?? "") : null}
        onRole={(r) => { close(); void send("/api/topology/nodes/role", "PATCH", { node_id: n.id, role: r }); }}
      />
    );
  }

  const empty = (text: string) => <p className="max-w-[620px] p-8 text-[13px] leading-relaxed text-muted-foreground">{text}</p>;
  // I testi vuoti rimandano all'elenco a sinistra: se è chiuso, dicono come aprirlo (nessuna fascia sulla mappa, spec §13.10.2).
  const elencoChiuso = listOpen ? "" : " (l'elenco si apre con «Elenco ▸»)";
  let canvas: ReactNode;
  let flowShown = false;
  if (mode === "passo" && maps.length === 0) {
    canvas = empty(isAdmin ? `Nessuna mappa passo passo: trascina qui un oggetto dall'elenco a sinistra${elencoChiuso} (chiede il nome della mappa), oppure «Nuova mappa…».` : "Nessuna mappa passo passo salvata.");
  } else if (viewLoading && refreshError) {
    // La vista appena chiesta non è arrivata: niente da tenere a schermo, errore pieno.
    canvas = <div className="p-6"><LoadError what="la mappa scelta" message={refreshError.message} onRetry={() => void reload()} /></div>;
  } else if (viewLoading) {
    canvas = empty("Caricamento della mappa…");
  } else if (d.visible.size === 0) {
    canvas = empty(
      mode === "auto"
        ? `Nessun apparato con collegamenti: gli apparati da sistemare sono nell'elenco a sinistra${elencoChiuso}.`
        : isAdmin
          ? `Trascina qui dall'elenco a sinistra${elencoChiuso} un oggetto da cui partire: compare col segno +N, quanti apparati gli sono collegati ma non sono ancora nella mappa.`
          : "Questa mappa è vuota.",
    );
  } else {
    flowShown = true;
    canvas = (
      <MapCanvas
        model={d.model}
        tree={d.tree}
        layout={d.layout}
        selected={selected}
        showExtra={showExtra}
        draggable={isAdmin}
        plus={d.plus}
        starts={d.starts}
        promoteIds={d.promoteIds}
        centerOn={mode === "auto" ? d.head : (d.tree.roots[0] ?? null)}
        centerKey={centerKey}
        onSelect={setSelected}
        onMove={(id, x, y) => void move(id, x, y)}
        renderMenu={renderMenu}
        connectable={isAdmin}
        onConnect={openConnect}
        picking={connectFrom !== null}
        onPick={(id) => { if (connectFrom) openConnect(connectFrom, id); }}
        vmInfo={d.vmInfo}
        onToggleVms={toggleVms}
      />
    );
  }

  const panelShown = detailsOpen && (selected !== null || d.missing.length > 0);
  // Il dialogo dell'«Ignora» dice quale cavo (le porte) e che gli altri cavi fra i due oggetti restano (spec §13.9).
  const testiIgnora = ignoreAsk
    ? testiIgnoraCavo(name(ignoreAsk.a), ignoreAsk.aPort, name(ignoreAsk.b), ignoreAsk.bPort, ignoreAsk.sources.map((s) => FONTE[s]).join(" + "))
    : null;
  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <TopologyIconDefs />
      <MapToolbar
        mode={mode}
        onMode={changeMode}
        isAdmin={isAdmin}
        maps={maps}
        mapId={chosenMap}
        onMap={(id) => { setChosenMap(id); setSelected(null); setCenterKey((k) => k + 1); }}
        onCreate={(n) => createMap(n)}
        onRename={async (n) => (await send(mapPath, "PATCH", { name: n })).ok}
        onDelete={async () => {
          const ok = (await send(mapPath, "DELETE")).ok;
          if (ok) { setChosenMap(null); setSelected(null); setCenterKey((k) => k + 1); }
          return ok;
        }}
        headName={d.head ? (d.byId.get(d.head)?.name ?? d.head) : null}
        headOrigin={d.headOrigin}
        onCreateFromAuto={(n) => createMap(n, { roots: d.head ? [d.head] : [], nodes: [...d.visible] })}
        showExtra={showExtra}
        onShowExtra={changeShowExtra}
        orientation={viewLoading || (mode === "passo" && chosenMap === null) ? null : orientation}
        onOrientation={isAdmin ? (o) => void changeOrientation(o) : null}
        layoutWidth={flowShown ? d.layout.width : null}
        printHref={printHref(mode, chosenMap)}
        // «Riordina» toglie solo i ritocchi dell'orientamento a schermo: quelli dell'altro restano da parte (spec §12.2).
        canRiordina={(view?.tweaks ?? []).some((t) => t.orientation === orientation)}
        onRiordina={() => void send("/api/topology/positions", "PUT", { view: positionsView, clear: true, orientation, rename: d.renames })}
        refreshFailedAt={refreshError?.at ?? null}
        refreshMessage={refreshError?.message ?? null}
        onRetry={() => void reload()}
        listOpen={listOpen}
        onToggleList={() => changeList(!listOpen)}
        detailsOpen={detailsOpen}
        detailsAvailable={selected !== null || d.missing.length > 0}
        onToggleDetails={() => changeDetails(!detailsOpen)}
      />
      <div className="flex min-h-0 flex-1">
        {listOpen && (
          <ObjectList
            model={d.model}
            visible={d.visible}
            selected={selected}
            drag={!isAdmin ? "off" : mode === "auto" ? "auto" : "on"}
            onSelect={setSelected}
          />
        )}
        <div
          className={dragOver ? "relative min-w-0 flex-1 bg-card outline-2 -outline-offset-4 outline-dashed outline-foreground" : "relative min-w-0 flex-1 bg-card"}
          onDragOver={onDragOver}
          onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDragOver(false); }}
          onDrop={(e) => onDrop(e, flowShown)}
        >
          {canvas}
          {connectFrom && (
            <p role="status" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-foreground bg-card px-2.5 py-1 text-[13px]">
              <b>Collega «{name(connectFrom)}» a…</b> fai clic sull&apos;oggetto di arrivo ·{" "}
              <button type="button" className="underline" onClick={() => setConnectFrom(null)}>Annulla</button> (Esc)
            </p>
          )}
          {dragOver && (
            <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-foreground bg-card px-2.5 py-1 text-[13px] font-semibold">
              {chosenMap === null ? "Rilascia: si crea una mappa nuova con questo oggetto" : "Rilascia per aggiungerlo alla mappa"}
            </p>
          )}
        </div>
        {panelShown && (
          <LinkedPanel
            model={d.model}
            nodeId={selected}
            canEditMap={canEditMap}
            visible={d.visible}
            viewLinks={d.viewLinks}
            missing={d.missing}
            onSelect={setSelected}
            onRemove={(id) => void removeNode(id)}
            onClose={() => changeDetails(false)}
          />
        )}
      </div>

      <NameDialog
        open={newMapFor !== null}
        title="Nome della nuova mappa"
        hint={newMapFor ? `«${name(newMapFor)}» sarà il primo oggetto della mappa.` : undefined}
        initial=""
        onClose={() => setNewMapFor(null)}
        onSubmit={async (n) => {
          if (!newMapFor) return false;
          const ok = await createMap(n, { roots: [newMapFor], nodes: [newMapFor] });
          if (ok) setSelected(newMapFor);
          return ok;
        }}
      />
      <ConnectDialog
        request={connect}
        onClose={() => setConnect(null)}
        onCreate={async (body) => (await createManualLink(send, body)).ok}
        onPatch={async (id, body) => (await patchManualLink(send, id, body)).ok}
      />
      <Dialog open={ignoreAsk !== null} onOpenChange={(o) => { if (!o) setIgnoreAsk(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{testiIgnora?.titolo ?? ""}</DialogTitle></DialogHeader>
          <p className="text-[13px]">{testiIgnora?.testo ?? ""}</p>
          <p className="text-[13px]">{IGNORA_SI_ANNULLA}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreAsk(null)}>Annulla</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const l = ignoreAsk;
                if (!l) return;
                if ((await ignoreLink(send, { action: "ignore", a_node: l.a, a_port: l.aPort, b_node: l.b, b_port: l.bPort })).ok) setIgnoreAsk(null);
              }}
            >
              Ignora questo cavo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
