"use client";

/**
 * Pagina unificata "Oggetto di rete" — `/objects/[hostId]`.
 *
 * Sostituisce le vecchie pagine separate /hosts/[id] e /devices/[id] che
 * mostravano viste parziali dello stesso oggetto fisico (stesso IP/MAC).
 *
 * Dal 21/10 (piano `scheda-apparato-per-tipo`) la pagina è la REGIA: carica host, apparato, asset e LibreNMS,
 * decide il tipo di scheda (`tipoScheda`) e le sue tab (`tabDelTipo`), e monta i componenti di
 * `src/components/scheda/` (intestazione, tab del tipo, tab comuni Sicurezza · Gestione · Storico).
 * Il contenuto di ogni tab sta lì: per aggiungere le tab di un tipo si guarda `tab-scheda.tsx`.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ruoliDaJson } from "@/lib/classification/canonico";
import { getClassificationLabel, DEVICE_CLASSIFICATIONS_ORDERED } from "@/lib/device-classifications";
import { isMacOsHost } from "@/lib/host-platform-detect";
import { runDeviceAcquisitionScan } from "@/lib/devices/device-scan-client";
import { porteDaJson, tabDaQuery } from "@/lib/scheda/panoramica";
import { tabDelTipo, tipoScheda, type TabId } from "@/lib/scheda/tipo-scheda";
import { AzioniScheda } from "@/components/scheda/azioni-scheda";
import type { ContestoScheda, LibreNmsStato, MembroCluster } from "@/components/scheda/contesto";
import type { DeviceFull } from "@/components/scheda/dati";
import { IntestazioneScheda, type VmSu } from "@/components/scheda/intestazione-scheda";
import type { VmSuNodo } from "@/lib/scheda/abbinamento-proxmox";
import type { RispostaAd, RispostaDipendenze } from "@/lib/devices/server-scheda";
import { TabScheda } from "@/components/scheda/tab-scheda";
import type { HostDetail, InventoryAsset } from "@/types";
// v0.2.646 audit perf UI9: i dialog modali (Promote/LinkIps/EditDevice) sono caricati on-demand
// (~100-300KB JS evitati al mount).
const RendiApparatoDialog = dynamic(() => import("@/components/devices/rendi-apparato-dialog").then((m) => ({ default: m.RendiApparatoDialog })), { ssr: false });
const LinkIpsDialog = dynamic(() => import("@/components/devices/link-ips-dialog").then((m) => ({ default: m.LinkIpsDialog })), { ssr: false });
const EditDeviceDialog = dynamic(() => import("@/components/devices/edit-device-dialog").then((m) => ({ default: m.EditDeviceDialog })), { ssr: false });

// ─── Page ───────────────────────────────────────────────────────────

export default function ObjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?tab= si legge una volta: il deep-link ?edit/?promote ripulisce l'URL e la tab non deve saltare.
  const [tabDaUrl] = useState(() => searchParams?.get("tab") ?? null);
  const hostId = typeof params.id === "string" ? Number(params.id) : NaN;
  const { data: session } = useSession();
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = sessionRole === "admin" || sessionRole === "superadmin";

  const [host, setHost] = useState<HostDetail | null>(null);
  const [device, setDevice] = useState<DeviceFull | null>(null);
  // F3.3: finestra «Rendi apparato» inline (no più redirect a /hosts/[id]?promote=1)
  const [promoteOpen, setPromoteOpen] = useState(false);
  // v0.2.599: modale edit device inline (no più redirect a /devices/[id], che era senza tab)
  const [editDeviceOpen, setEditDeviceOpen] = useState(false);
  // v0.2.600: test connessione (era solo su /devices/[id], ora /devices/[id] redirige qui)
  const [testingConnection, setTestingConnection] = useState(false);
  // Tab scelta a mano (null = quella dell'URL o la prima del tipo); i campi editabili stanno nella tab Gestione.
  const [tabScelta, setTabScelta] = useState<TabId | null>(null);
  // v0.2.632: custom classifications per-tenant
  const [customClassifications, setCustomClassifications] = useState<Array<{ slug: string; label: string; parent_slug: string }>>([]);
  useEffect(() => {
    void fetch("/api/classifications/custom", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setCustomClassifications(data.items ?? []))
      .catch(() => { /* ignore */ });
  }, []);
  const customLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customClassifications) m.set(c.slug, c.label);
    return m;
  }, [customClassifications]);
  const effectiveClassificationLabel = useCallback((slug: string) => customLabelMap.get(slug) ?? getClassificationLabel(slug), [customLabelMap]);
  const effectiveClassificationSlugs = useMemo(
    () => [...DEVICE_CLASSIFICATIONS_ORDERED, ...customClassifications.map((c) => c.slug)],
    [customClassifications]
  );
  // Multi-IP link manuale (v0.2.594+)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [clusterMembers, setClusterMembers] = useState<MembroCluster[]>([]);
  const [unlinkingHostId, setUnlinkingHostId] = useState<number | null>(null);
  const [asset, setAsset] = useState<InventoryAsset | null>(null);
  const [librenms, setLibrenms] = useState<LibreNmsStato | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(hostId) || hostId <= 0) {
      router.push("/discovery");
      return;
    }
    // v0.2.635 audit B1: try/catch globale + toast per errori di rete; senza
    // questo, un fetch falliva silenzioso → loading=false ma host=null → render
    // pagina bianca senza messaggio. Ora l'utente vede l'errore di rete e può
    // tornare a /discovery oppure ricaricare.
    try {
      let hRes: Response;
      try {
        hRes = await fetch(`/api/hosts/${hostId}`);
      } catch (e) {
        toast.error(`Errore di rete nel caricamento host: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!hRes.ok) {
        toast.error(`Host ${hostId} non trovato`);
        router.push("/discovery");
        return;
      }
      const h = (await hRes.json()) as HostDetail;
      setHost(h);
      // Apparato tolto (o mai esistito): la scheda torna a quella dell'host non gestito.
      if (!h.network_device?.id) setDevice(null);
      // v0.2.635 audit perf: i 3 fetch ausiliari (device + asset + librenms) sono
      // indipendenti tra loro e dall'host principale. Parallelizzo con allSettled
      // per ridurre la latency complessiva e tollerare fallimenti parziali.
      const auxResults = await Promise.allSettled([
        h.network_device?.id ? fetch(`/api/devices/${h.network_device.id}`) : Promise.resolve(null),
        fetch(`/api/inventory?host_id=${hostId}`),
        fetch(`/api/hosts/${hostId}/librenms`),
      ]);

      const [dRes, aRes, lnmsRes] = auxResults;

      if (dRes.status === "fulfilled" && dRes.value && dRes.value.ok) {
        try { setDevice((await dRes.value.json()) as DeviceFull); } catch { /* non critico */ }
      }
      if (aRes.status === "fulfilled" && aRes.value.ok) {
        try {
          const list = (await aRes.value.json()) as InventoryAsset[];
          if (Array.isArray(list) && list.length > 0) setAsset(list[0]);
        } catch { /* non critico */ }
      }
      if (lnmsRes.status === "fulfilled" && lnmsRes.value.ok) {
        try {
          const data = await lnmsRes.value.json();
          if (data) setLibrenms(data);
        } catch { /* non critico */ }
      }
    } catch (e) {
      // Catch difensivo per qualunque throw inaspettato lungo la catena.
      toast.error(`Errore caricamento dati host: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [hostId, router]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Carica gli host del cluster fisico (se esistono) — usato dalla sezione "IP collegati"
  const fetchClusterMembers = useCallback(async () => {
    if (!host?.physical_device_id) { setClusterMembers([]); return; }
    try {
      const r = await fetch(`/api/physical-devices/${host.physical_device_id}/hosts`, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json() as { hosts: MembroCluster[] };
        setClusterMembers(data.hosts ?? []);
      }
    } catch { /* non critico */ }
  }, [host?.physical_device_id]);

  useEffect(() => { void fetchClusterMembers(); }, [fetchClusterMembers]);

  // «VM n su <nodo>» in intestazione: se l'IP dell'host sta in una VM delle scansioni Proxmox salvate.
  // Un errore non è un «no»: la riga semplicemente non compare.
  const [vmSu, setVmSu] = useState<VmSu | null>(null);
  useEffect(() => {
    if (!Number.isFinite(hostId) || hostId <= 0) return;
    let vivo = true;
    fetch(`/api/hosts/${hostId}/proxmox-vm`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ vm: VmSuNodo | null }>) : null))
      .then((d) => {
        if (!vivo) return;
        setVmSu(d?.vm ? { vmid: d.vm.vmid, nodo: d.vm.nodo, ...(d.vm.nodoHostId != null && d.vm.nodoHostId !== hostId ? { href: `/objects/${d.vm.nodoHostId}` } : {}) } : null);
      })
      .catch(() => { if (vivo) setVmSu(null); });
    return () => { vivo = false; };
  }, [hostId]);

  // Server Windows e Linux: dipendenze NIS2 e Active Directory decidono se compaiono le tab «Dipendenze» e
  // «Active Directory» (e i rilievi della Panoramica). Due GET leggere, solo per i server; un errore non è un «no»:
  // la tab semplicemente non compare.
  const [dipendenze, setDipendenze] = useState<RispostaDipendenze | null>(null);
  const [ad, setAd] = useState<RispostaAd | null>(null);
  const eServer = device?.vendor === "windows" || device?.vendor === "linux";
  useEffect(() => {
    setDipendenze(null);
    setAd(null);
    if (!eServer || !Number.isFinite(hostId) || hostId <= 0) return;
    let vivo = true;
    const leggi = <T,>(url: string, metti: (d: T | null) => void) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .then((d) => { if (vivo) metti(d); })
        .catch(() => { if (vivo) metti(null); });
    void leggi<RispostaDipendenze>(`/api/hosts/${hostId}/dipendenze`, setDipendenze);
    if (device?.vendor === "windows") void leggi<RispostaAd>(`/api/hosts/${hostId}/ad`, setAd);
    return () => { vivo = false; };
  }, [hostId, eServer, device?.vendor]);

  // v0.2.607: runtime summary memoizzato. DEVE stare prima di qualsiasi early
  // return (loading / !host) per non violare le rules of hooks (React #310).
  // Credenziali assegnate (tappa 5): le prove si rileggono quando la tabella dei binding cambia.
  const [versioneBinding, setVersioneBinding] = useState(0);
  // «Usata adesso» si ricalcola quando i binding cambiano nella tabella (non al primo caricamento).
  const bindingCaricati = useRef(false);
  const ricaricaUsataAdesso = useCallback(() => {
    if (!bindingCaricati.current) {
      bindingCaricati.current = true;
      return;
    }
    void fetchAll();
  }, [fetchAll]);
  // Identità stabile: la tabella lo mette fra le dipendenze di un effetto, e un'arrow nuova a ogni render lo rifarebbe in ciclo.
  const alCambioBinding = useCallback(() => {
    setVersioneBinding((v) => v + 1);
    ricaricaUsataAdesso();
  }, [ricaricaUsataAdesso]);

  const runtimeSummary = useMemo(() => {
    const { tcp, udp } = porteDaJson(host?.open_ports);
    const validatedCreds = (host?.host_credentials ?? []).filter((hc) => hc.validated === 1);
    return { tcpPorts: tcp, udpPorts: udp, validatedCreds };
  }, [host?.open_ports, host?.host_credentials]);

  // v0.2.601: deep-link da menù tre-puntini / link esterni:
  //   ?edit=1     → auto-apri EditDeviceDialog (richiede device gestito)
  //   ?promote=1  → auto-apri RendiApparatoDialog (richiede host non gestito)
  // Pulisce la query subito dopo per non rifarlo a ogni re-render.
  useEffect(() => {
    if (!host) return;
    const editFlag = searchParams?.get("edit");
    const promoteFlag = searchParams?.get("promote");
    if (editFlag === "1" && device && !editDeviceOpen) {
      setEditDeviceOpen(true);
      router.replace(`/objects/${host.id}`);
    } else if (promoteFlag === "1" && !device && !promoteOpen) {
      setPromoteOpen(true);
      router.replace(`/objects/${host.id}`);
    }
  }, [host?.id, device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUnlinkHost(targetHostId: number) {
    if (!confirm("Scollegare questo IP dal device fisico?")) return;
    setUnlinkingHostId(targetHostId);
    try {
      const r = await fetch("/api/physical-devices/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: targetHostId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.error || "Errore unlink");
        return;
      }
      toast.success("IP scollegato");
      void fetchAll();
      void fetchClusterMembers();
    } finally {
      setUnlinkingHostId(null);
    }
  }

  async function handleUpdateAll() {
    if (!host?.network_device?.id || !device) {
      toast.error("Promuovi prima l'host a device per eseguire 'Aggiorna tutto'");
      return;
    }
    setRefreshing(true);
    try {
      const scanResult = await runDeviceAcquisitionScan(device.id, device);
      if (!scanResult.ok) {
        toast.error(scanResult.error ?? "Errore scan");
        return;
      }
      toast.success(scanResult.message ?? "Scan completato");

      if (device.vendor === "windows" || device.vendor === "linux") {
        toast.info("Inventario software in corso...");
        const sr = await fetch(`/api/devices/${device.id}/software-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const sd = (await sr.json()) as { status?: string; appsCount?: number; errorMessage?: string };
        if (sr.ok && sd.status === "ok") {
          toast.success(`Software: ${sd.appsCount ?? 0} applicazioni`);
        } else {
          toast.error(sd.errorMessage ?? "Software scan fallito");
        }
      }
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }

  // v0.2.604: salvataggio inline di seriale / numero inventario / note (tab Gestione).
  async function saveHostField(patch: Record<string, unknown>) {
    if (!host) return;
    try {
      const res = await fetch(`/api/hosts/${host.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore salvataggio");
        return;
      }
      toast.success("Salvato", { duration: 1500 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    }
  }

  async function handleTestConnection() {
    if (!device) return;
    setTestingConnection(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/test`);
      const data = await res.json();
      if (data.success) {
        // /api/devices/[id]/test usa runDeviceConnectionTest che PROVA effettivamente
        // le credenziali (SSH/SNMP/WinRM/API). Esponiamo il risultato concreto.
        const msg = data.message
          || (data.proxmox_api_ok && data.proxmox_ssh_ok ? "Credenziali OK (API + SSH)"
            : data.proxmox_api_ok ? "Credenziali OK (solo API Proxmox)"
            : data.proxmox_ssh_ok ? "Credenziali OK (solo SSH)"
            : `Credenziali OK via ${device.protocol}`);
        toast.success(msg);
      } else {
        toast.error(data.error || `Credenziali rifiutate via ${device.protocol}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nel test credenziali");
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleCreateAsset() {
    if (!host) return;
    try {
      const r = await fetch("/api/inventory/bulk-from-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: [host.id] }),
      });
      const data = (await r.json()) as { message?: string };
      if (r.ok) {
        toast.success(data.message ?? "Asset creato");
        await fetchAll();
      } else {
        toast.error("Errore creazione asset");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handleTogliApparato() {
    if (!device) return;
    if (!confirm(`Togliere l'apparato "${device.name}" dalla gestione? L'host resta in Discovery e si può rendere di nuovo apparato.`)) return;
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nel togliere l'apparato");
        return;
      }
      toast.success("Apparato tolto dalla gestione");
      await fetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Caricamento...
      </div>
    );
  }
  if (!host) return null;

  const displayName = host.custom_name || host.hostname || host.dns_reverse || host.ip;
  const classificationLabel = host.classification ? effectiveClassificationLabel(host.classification) : null;
  const isManaged = !!device;
  const isAsset = !!asset;
  const isWindowsOrLinux = device?.vendor === "windows" || device?.vendor === "linux";
  const isMacPlatform =
    device?.vendor === "apple" ||
    isMacOsHost({
      os_info: host.os_info,
      inferred_os_family: host.inferred_os_family,
      device_manufacturer: host.device_manufacturer,
      model: host.model,
      vendor: host.vendor,
    });

  // Tipo di scheda dalla classificazione (non da device_type) e tab del tipo.
  const tipo = tipoScheda({
    gestito: isManaged,
    classification: device?.classification ?? host.classification ?? null,
    device_type: device?.device_type ?? null,
    vendor: device?.vendor ?? null,
    scan_target: device?.scan_target ?? null,
  });
  // Il ruolo DC si riconosce anche dall'OU in AD o dalla scansione (server_roles può essere vuoto).
  const ruoliDichiarati: string[] = ruoliDaJson(device?.server_roles);
  const ruoli: string[] = ad?.dc && !ruoliDichiarati.includes("dc") ? [...ruoliDichiarati, "dc"] : ruoliDichiarati;
  const haAd = !!ad && (ad.computer !== null || ad.rilievi !== null);
  const haDipendenze = (dipendenze?.servizi.length ?? 0) > 0;
  const tabs = tabDelTipo(tipo, { ruoli, haAd, haDipendenze });
  const dalUrl = tabDaQuery(tabDaUrl, tabs);
  const attiva: TabId = tabScelta && tabs.includes(tabScelta) ? tabScelta : dalUrl.tab;

  const ctx: ContestoScheda = {
    host,
    hostId,
    device,
    asset,
    librenms,
    tipo,
    ruoli,
    isAdmin,
    isManaged,
    isAsset,
    isWindowsOrLinux,
    isMacPlatform,
    displayName,
    classificationLabel,
    runtimeSummary,
    clusterMembers,
    vmSu,
    ad,
    dipendenze,
    unlinkingHostId,
    versioneBinding,
    alCambioBinding,
    etichettaClassificazione: effectiveClassificationLabel,
    slugsClassificazione: effectiveClassificationSlugs,
    ricarica: fetchAll,
    apriTab: setTabScelta,
    apriCollegaIp: () => setLinkDialogOpen(true),
    scollegaIp: handleUnlinkHost,
    salvaCampoHost: saveHostField,
    creaAsset: handleCreateAsset,
    ...(dalUrl.sotto && attiva === "dettagli" ? { sottoTabDettagli: dalUrl.sotto } : {}),
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <IntestazioneScheda
        host={host}
        device={device}
        tipo={tipo}
        ruoli={ruoli}
        vmSu={vmSu}
        azioni={
          <AzioniScheda
            gestito={isManaged}
            haAsset={isAsset}
            isAdmin={isAdmin}
            aggiornando={refreshing}
            provando={testingConnection}
            titoloAggiorna={device?.device_type === "hypervisor" || device?.scan_target === "proxmox"
              ? "Scan Proxmox VE (API + SSH): nodi cluster, VM/CT, storage"
              : "Test connessione → query SNMP/ARP → inventario software"}
            onAggiorna={handleUpdateAll}
            onProva={handleTestConnection}
            onRendiApparato={() => setPromoteOpen(true)}
            onModifica={() => setEditDeviceOpen(true)}
            onCreaAsset={handleCreateAsset}
            onTogli={handleTogliApparato}
          />
        }
      />

      <TabScheda ctx={ctx} tabs={tabs} attiva={attiva} onCambia={setTabScelta} />

      {/* Spazio in fondo per scroll comodo */}
      <div className="h-8" />

      {/* F3.3: modale promozione inline — niente più redirect cross-pagina. */}
      {host && !isManaged && (
        <RendiApparatoDialog
          hosts={[host as HostDetail]}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          onCreated={() => { setPromoteOpen(false); fetchAll(); }}
        />
      )}

      {/* v0.2.594+: modale link manuale multi-IP allo stesso physical_device */}
      {host && (
        <LinkIpsDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          anchorHostId={host.id}
          anchorHostLabel={host.hostname || host.ip}
          onLinked={() => { void fetchAll(); void fetchClusterMembers(); }}
        />
      )}

      {/* v0.2.599: modale edit device inline (sostituisce navigazione a /devices/[id]).
          /devices/[id] resta accessibile direct, ma il pulsante "Modifica device"
          della scheda asset ora apre questo dialog → niente più perdita dei tab. */}
      {device && (
        <EditDeviceDialog
          device={device}
          open={editDeviceOpen}
          onOpenChange={setEditDeviceOpen}
          onSaved={() => { setEditDeviceOpen(false); void fetchAll(); }}
        />
      )}

    </div>
  );
}
