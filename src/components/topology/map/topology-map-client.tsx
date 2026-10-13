"use client";

/**
 * La pagina Topologia (spec 2026-10-12 §10, prototipo approvato il 13/10):
 * «Tutto automatico» (tutta la rete dalla testa, si ricalcola da sola) e
 * mappe «Passo passo» salvate (solo gli oggetti scelti). Qui vivono lo stato
 * della pagina (modo, mappa, oggetto scelto) e le scritture; albero e
 * disposizione sono la logica pura di src/lib/topology.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { LoadError } from "@/components/shared/load-error";
import { nodeClass } from "@/lib/topology/identity";
import { autoVisible, buildTree, missingNeighbors, proposeHead } from "@/lib/topology/tree";
import { layoutTree, structureSig, type SavedTweak } from "@/lib/topology/tree-layout";
import { LinkedPanel } from "./linked-panel";
import { MapCanvas } from "./map-canvas";
import { MapToolbar, type Mode } from "./map-toolbar";
import { ObjectList } from "./object-list";
import { TopologyIconDefs } from "./topology-icons";
import { useTopologyData, type MapRow } from "./use-topology-data";

export function TopologyMapClient({ isAdmin }: { isAdmin: boolean }) {
  return (
    <ReactFlowProvider>
      <TopologyMap isAdmin={isAdmin} />
    </ReactFlowProvider>
  );
}

function TopologyMap({ isAdmin }: { isAdmin: boolean }) {
  const [mode, setMode] = useState<Mode>("auto");
  const [chosenMap, setChosenMap] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [centerKey, setCenterKey] = useState(1);
  const [pending, setPending] = useState<{ view: string; tweak: SavedTweak } | null>(null);

  const viewKey = mode === "auto" ? "auto" : chosenMap !== null ? String(chosenMap) : null;
  const { data, error, refreshError, reload, send } = useTopologyData(viewKey);
  const maps = useMemo(() => data?.maps.maps ?? [], [data]);

  // La mappa scelta non c'è più (cancellata, anche da un altro) o non è ancora scelta: si passa alla prima.
  const effectiveMap = data ? (maps.some((m) => m.id === chosenMap) ? chosenMap : (maps[0]?.id ?? null)) : chosenMap;
  useEffect(() => {
    if (mode === "passo" && effectiveMap !== chosenMap) setChosenMap(effectiveMap);
  }, [mode, effectiveMap, chosenMap]);

  const view = data && data.viewKey === viewKey ? data.view : null;
  const viewLoading = !data || data.viewKey !== viewKey;
  const positionsView = mode === "auto" ? "auto" : `mappa:${chosenMap}`;

  const d = useMemo(() => {
    if (!data) return null;
    const model = data.model;
    const ids = new Set(model.nodes.map((n) => n.id));
    const auto = data.maps.auto;
    let visible: Set<string>;
    let roots: string[];
    let missing: string[] = [];
    let head: string | null = null;
    let headOrigin = "";
    if (mode === "auto") {
      visible = autoVisible(model);
      const chosen = auto?.head_node && ids.has(auto.head_node) ? auto.head_node : null;
      head = chosen ?? proposeHead(model);
      headOrigin = chosen ? `scelta da ${auto?.created_by ?? "un amministratore"}` : "proposta dal sistema";
      roots = head ? [head] : [];
    } else {
      const members = view?.nodes ?? [];
      visible = new Set(members.filter((id) => ids.has(id)));
      missing = members.filter((id) => !ids.has(id));
      roots = (view?.map?.roots ?? []).filter((r) => visible.has(r));
    }
    const tree = buildTree(model, visible, roots);
    const own = pending && pending.view === viewKey ? pending.tweak : null;
    const tweaks = [...(view?.tweaks ?? []).filter((t) => t.nodeId !== own?.nodeId), ...(own ? [own] : [])];
    const layout = layoutTree(model, tree, tweaks);
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
    return { model, visible, roots, missing, head, headOrigin, tree, layout, plus, starts, promoteIds, byId };
  }, [data, mode, view, pending, viewKey]);

  if (error) return <LoadError what="i dati della mappa" message={error} onRetry={() => void reload()} />;
  if (!data || !d) return <p className="text-sm text-muted-foreground">Caricamento della mappa…</p>;

  const mapPath = `/api/topology/maps/${chosenMap}`;
  const canEditMap = isAdmin && mode === "passo" && chosenMap !== null && !viewLoading;
  const changeMode = (m: Mode) => { setMode(m); setSelected(null); setCenterKey((k) => k + 1); };

  async function addNodes(ids: string[]): Promise<boolean> {
    if (chosenMap === null || ids.length === 0) return false;
    return (await send(`${mapPath}/nodes`, "PUT", { add: ids, remove: [] })).ok;
  }
  async function removeNode(id: string) {
    if (chosenMap !== null) await send(`${mapPath}/nodes`, "PUT", { add: [], remove: [id] });
  }
  async function setStart(id: string) {
    if (chosenMap === null) return;
    if (!d?.visible.has(id) && !(await addNodes([id]))) return;
    await send(mapPath, "PATCH", { roots: [...new Set([...(view?.map?.roots ?? []), id])] });
  }
  async function insert(id: string) {
    setSelected(id);
    if (!(await addNodes([id])) || !d) return;
    // Diventa una partenza se la mappa non ne ha, o se non è collegato a niente di ciò che c'è già.
    const linked = d.model.links.some((l) => (l.a === id && d.visible.has(l.b)) || (l.b === id && d.visible.has(l.a)));
    if (d.roots.length === 0 || (!linked && nodeClass(d.byId.get(id) ?? { type: "" }) !== "client")) {
      await send(mapPath, "PATCH", { roots: [...new Set([...(view?.map?.roots ?? []), id])] });
      if (d.roots.length === 0) setCenterKey((k) => k + 1);
    }
  }
  async function move(nodeId: string, x: number, y: number) {
    if (!d || !viewKey) return;
    const tweak: SavedTweak = { nodeId, x, y, sig: structureSig(d.tree, nodeId) };
    setPending({ view: viewKey, tweak });
    await send("/api/topology/positions", "PUT", { view: positionsView, tweaks: [tweak] });
    setPending(null);
  }
  async function createMap(name: string, from?: { roots: string[]; nodes: string[] }): Promise<boolean> {
    const r = await send<MapRow>("/api/topology/maps", "POST", { name, roots: from?.roots ?? [], nodes: from?.nodes ?? [] });
    if (!r.ok) return false;
    setChosenMap(r.data.id);
    changeMode("passo");
    return true;
  }

  const empty = (text: string) => <p className="max-w-[620px] p-8 text-[13px] leading-relaxed text-muted-foreground">{text}</p>;
  let canvas: ReactNode;
  if (mode === "passo" && maps.length === 0) {
    canvas = empty(isAdmin ? "Nessuna mappa passo passo: creane una con «Nuova mappa…»." : "Nessuna mappa passo passo salvata.");
  } else if (viewLoading && refreshError) {
    // La vista appena chiesta non è arrivata: niente da tenere a schermo, errore pieno.
    canvas = <div className="p-6"><LoadError what="la mappa scelta" message={refreshError.message} onRetry={() => void reload()} /></div>;
  } else if (viewLoading) {
    canvas = empty("Caricamento della mappa…");
  } else if (d.visible.size === 0) {
    canvas = empty(
      mode === "auto"
        ? "Nessun apparato con collegamenti: gli apparati da sistemare sono nell'elenco a sinistra."
        : isAdmin
          ? "Scegli dall'elenco a sinistra un oggetto da cui partire: compare qui col segno +N, quanti apparati gli sono collegati ma non sono ancora nella mappa."
          : "Questa mappa è vuota.",
    );
  } else {
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
      />
    );
  }

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
        onCreate={(name) => createMap(name)}
        onRename={async (name) => (await send(mapPath, "PATCH", { name })).ok}
        onDelete={async () => {
          const ok = (await send(mapPath, "DELETE")).ok;
          if (ok) { setChosenMap(null); setSelected(null); setCenterKey((k) => k + 1); }
          return ok;
        }}
        headName={d.head ? (d.byId.get(d.head)?.name ?? d.head) : null}
        headOrigin={d.headOrigin}
        onCreateFromAuto={(name) => createMap(name, { roots: d.head ? [d.head] : [], nodes: [...d.visible] })}
        showExtra={showExtra}
        onShowExtra={setShowExtra}
        canRiordina={(view?.tweaks.length ?? 0) > 0}
        onRiordina={() => void send("/api/topology/positions", "PUT", { view: positionsView, clear: true })}
        refreshFailedAt={refreshError?.at ?? null}
        refreshMessage={refreshError?.message ?? null}
        onRetry={() => void reload()}
      />
      <div className="flex min-h-0 flex-1">
        <ObjectList
          model={d.model}
          visible={d.visible}
          selected={selected}
          canInsert={canEditMap}
          onSelect={setSelected}
          onInsert={(id) => void insert(id)}
        />
        <div className="relative min-w-0 flex-1 bg-card">{canvas}</div>
        {(selected !== null || d.missing.length > 0) && (
          <LinkedPanel
            model={d.model}
            nodeId={selected}
            mode={mode}
            isAdmin={isAdmin}
            canEditMap={canEditMap}
            visible={d.visible}
            isHead={selected !== null && selected === d.head}
            isStart={selected !== null && d.roots.includes(selected)}
            missing={d.missing}
            onSelect={setSelected}
            onAdd={(ids) => void addNodes(ids)}
            onRemove={(id) => void removeNode(id)}
            onStart={(id) => void setStart(id)}
            onHead={(id) => { void send("/api/topology/maps/auto", "PATCH", { head_node: id }).then(() => setCenterKey((k) => k + 1)); }}
            onHide={(id, hidden) => void send("/api/topology/nodes/hidden", "PUT", { node_id: id, hidden })}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
