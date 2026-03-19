"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CredentialAssignmentFields } from "@/components/shared/credential-assignment-fields";
import { Pagination } from "@/components/shared/pagination";
import { Plus, Trash2, Network, Key, Scan, X, Search, Router } from "lucide-react";
import { toast } from "sonner";
import type { NetworkWithStats } from "@/types";

interface NetworkWithRouter extends NetworkWithStats {
  router_id?: number | null;
}

interface Credential {
  id: number;
  name: string;
  credential_type: string;
}

interface NetworksListClientProps {
  initialNetworks: (NetworkWithStats & { router_id?: number | null })[];
  routers: { id: number; name: string; host: string }[];
}

const ROUTER_VENDOR_OPTIONS = [
  { value: "mikrotik", label: "MikroTik" },
  { value: "ubiquiti", label: "Ubiquiti" },
  { value: "cisco", label: "Cisco" },
  { value: "hp", label: "HP / Aruba" },
  { value: "omada", label: "TP-Link Omada" },
  { value: "stormshield", label: "Stormshield" },
  { value: "linux", label: "Linux" },
  { value: "other", label: "Altro" },
] as const;

const ROUTER_PROTOCOL_OPTIONS = [
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" },
  { value: "api", label: "API REST" },
] as const;

export function NetworksListClient({ initialNetworks, routers: initialRouters }: NetworksListClientProps) {
  const router = useRouter();
  const [networks, setNetworks] = useState<NetworkWithRouter[]>(initialNetworks as NetworkWithRouter[]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [assignCredentialId, setAssignCredentialId] = useState<string | null>(null);
  const [assignSnmpCredentialId, setAssignSnmpCredentialId] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const pageSize = 25;

  const [routersList, setRoutersList] = useState(initialRouters);
  const [newNetworkRouterId, setNewNetworkRouterId] = useState<string>("");
  const [quickRouterOpen, setQuickRouterOpen] = useState(false);
  const [quickRouterVendor, setQuickRouterVendor] = useState<string>("mikrotik");
  const [quickRouterProtocol, setQuickRouterProtocol] = useState<string>("ssh");
  const [quickRouterCredId, setQuickRouterCredId] = useState<string | null>(null);
  const [quickRouterSnmpId, setQuickRouterSnmpId] = useState<string | null>(null);
  const [quickRouterSaving, setQuickRouterSaving] = useState(false);
  const quickRouterFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setRoutersList(initialRouters);
  }, [initialRouters]);

  const refreshRoutersList = useCallback(async () => {
    try {
      const res = await fetch("/api/devices?type=router");
      if (!res.ok) return;
      const data = (await res.json()) as { id: number; name: string; host: string }[];
      setRoutersList(data.map((d) => ({ id: d.id, name: d.name, host: d.host })));
    } catch {
      toast.error("Impossibile aggiornare l'elenco router");
    }
  }, []);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, []);

  const refreshNetworks = useCallback(async (p?: number, s?: string) => {
    const currentPage = p ?? page;
    const currentSearch = s ?? search;
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) });
      if (currentSearch) params.set("search", currentSearch);
      const res = await fetch(`/api/networks?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setNetworks(json.data);
        setTotalPages(json.totalPages);
        setPage(json.page);
      }
    } catch {
      toast.error("Impossibile aggiornare l'elenco");
    }
  }, [page, search, pageSize]);

  useEffect(() => {
    refreshNetworks(1, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handlePageChange = useCallback((newPage: number) => {
    refreshNetworks(newPage, search);
  }, [refreshNetworks, search]);

  const handleSearchSubmit = useCallback(() => {
    setSearch(searchInput);
  }, [searchInput]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === networks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(networks.map((n) => n.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedWithRouter = networks.filter((n) => selectedIds.has(n.id) && n.router_id);
  const selectedWithoutRouter = selectedIds.size - selectedWithRouter.length;

  async function handleBulkAssign() {
    if (selectedIds.size === 0) return;
    const hasCred = assignCredentialId && assignCredentialId !== "none";
    const hasSnmpCred = assignSnmpCredentialId && assignSnmpCredentialId !== "none";
    if (!hasCred && !hasSnmpCred) {
      toast.error("Seleziona almeno una credenziale SSH o SNMP registrata");
      return;
    }
    setAssignSaving(true);
    try {
      const body: Record<string, unknown> = {
        network_ids: Array.from(selectedIds),
      };
      if (assignCredentialId && assignCredentialId !== "none") {
        body.credential_id = Number(assignCredentialId);
      }
      if (assignSnmpCredentialId && assignSnmpCredentialId !== "none") {
        body.snmp_credential_id = Number(assignSnmpCredentialId);
      }
      const res = await fetch("/api/networks/bulk-assign-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setAssignDialogOpen(false);
        setAssignCredentialId(null);
        setAssignSnmpCredentialId(null);
        clearSelection();
      } else {
        toast.error(data.error || "Errore nell'assegnazione");
      }
    } catch {
      toast.error("Errore nell'assegnazione");
    }
    setAssignSaving(false);
  }

  async function handleBulkScan() {
    if (selectedIds.size === 0) return;
    setScanning(true);
    try {
      const res = await fetch("/api/networks/bulk-scan-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        refreshNetworks();
      } else {
        toast.error(data.error || "Errore nella scansione");
      }
    } catch {
      toast.error("Errore nella scansione");
    }
    setScanning(false);
  };

  function resetQuickRouterForm() {
    setQuickRouterVendor("mikrotik");
    setQuickRouterProtocol("ssh");
    setQuickRouterCredId(null);
    setQuickRouterSnmpId(null);
  }

  async function handleQuickRouterSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("qr_name") ?? "").trim();
    const host = String(fd.get("qr_host") ?? "").trim();
    const username = String(fd.get("username") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const portRaw = String(fd.get("port") ?? "").trim();
    const community = String(fd.get("community_string") ?? "").trim();

    if (!name || !host) {
      toast.error("Nome e indirizzo IP del router sono obbligatori");
      return;
    }

    const hasCred = quickRouterCredId && quickRouterCredId !== "none";
    const hasSnmpCred = quickRouterSnmpId && quickRouterSnmpId !== "none";
    const proto = quickRouterProtocol;

    if (proto === "ssh" || proto === "api") {
      if (!hasCred && (!username || !password)) {
        toast.error("Seleziona una credenziale dall'archivio oppure username e password");
        return;
      }
    }
    if (proto === "snmp_v2" || proto === "snmp_v3") {
      if (!hasSnmpCred && !community) {
        toast.error("Per SNMP serve una credenziale SNMP registrata oppure la community");
        return;
      }
    }

    const portNum = portRaw ? Number(portRaw) : undefined;
    const body: Record<string, unknown> = {
      name,
      host,
      device_type: "router",
      vendor: quickRouterVendor,
      protocol: proto,
      credential_id: hasCred ? Number(quickRouterCredId) : null,
      snmp_credential_id: hasSnmpCred ? Number(quickRouterSnmpId) : null,
      username: hasCred ? undefined : username || undefined,
      password: hasCred ? undefined : password || undefined,
      community_string: community || undefined,
      port: portNum && !Number.isNaN(portNum) ? portNum : undefined,
    };

    setQuickRouterSaving(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Errore nella creazione del router");
        return;
      }
      const newId = data.id as number;
      toast.success("Router aggiunto");
      await refreshRoutersList();
      setNewNetworkRouterId(String(newId));
      setQuickRouterOpen(false);
      resetQuickRouterForm();
      form.reset();
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setQuickRouterSaving(false);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body = {
      cidr: formData.get("cidr"),
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      gateway: formData.get("gateway") || undefined,
      vlan_id: formData.get("vlan_id") ? Number(formData.get("vlan_id")) : undefined,
      location: formData.get("location") || undefined,
      dns_server: formData.get("dns_server") || undefined,
      snmp_community: formData.get("snmp_community") || undefined,
      router_id: newNetworkRouterId && newNetworkRouterId !== "" ? Number(newNetworkRouterId) : undefined,
    };

    const res = await fetch("/api/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nella creazione");
      return;
    }

    toast.success("Rete creata con successo");
    setDialogOpen(false);
    setNewNetworkRouterId("");
    refreshNetworks();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare la rete "${name}" e tutti gli host associati?`)) return;

    const res = await fetch(`/api/networks/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Rete eliminata");
      refreshNetworks();
    } else {
      toast.error("Errore nell'eliminazione");
    }
  }

  return (
    <div className="space-y-6">
      {selectedIds.size > 0 && (
        <Card size="sm">
          <CardContent className="py-3 flex items-center justify-between gap-4">
            <CardDescription>
              {selectedIds.size} rete{selectedIds.size !== 1 ? "i" : ""} selezionata{selectedIds.size !== 1 ? "e" : ""}
              {selectedWithoutRouter > 0 && (
                <span className="text-amber-600 dark:text-amber-500 ml-1">
                  ({selectedWithoutRouter} senza router, ignorate)
                </span>
              )}
            </CardDescription>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAssignDialogOpen(true)}>
                <Key className="h-4 w-4 mr-2" />
                Assegna credenziali
              </Button>
              <Button variant="outline" size="sm" onClick={handleBulkScan} disabled={scanning}>
                <Scan className="h-4 w-4 mr-2" />
                {scanning ? "Scansione..." : "Scansiona dispositivi"}
              </Button>
              <Button variant="ghost" size="icon" onClick={clearSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assegna credenziali alle reti selezionate</DialogTitle>
            <CardDescription>
              Assegna credenziali SSH e/o SNMP ai router/switch delle {selectedIds.size} reti selezionate. Stessa maschera usata per dispositivi e subnet.
            </CardDescription>
          </DialogHeader>
          <div className="space-y-4">
            <CredentialAssignmentFields
              credentials={credentials}
              credentialId={assignCredentialId}
              snmpCredentialId={assignSnmpCredentialId}
              onCredentialIdChange={setAssignCredentialId}
              onSnmpCredentialIdChange={setAssignSnmpCredentialId}
              sshFilter="ssh_api"
              credentialPlaceholder="Nessuna"
              snmpPlaceholder="Nessuna"
              idPrefix="subnet-assign"
            />
            <Button onClick={handleBulkAssign} disabled={assignSaving} className="w-full">
              {assignSaving ? "Applicazione..." : "Applica"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Subnet</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Gestisci le subnet monitorate</p>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cerca per nome, CIDR, posizione..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearchSubmit(); }}
              className="pl-8"
            />
          </div>
          {search && (
            <Button variant="ghost" size="icon-sm" onClick={() => { setSearchInput(""); setSearch(""); }}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (open) setNewNetworkRouterId("");
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Aggiungi Rete
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova Rete</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cidr">Rete (IP/Subnet)</Label>
                <Input id="cidr" name="cidr" required placeholder="192.168.1.0/24" className="font-mono" />
                <p className="text-xs text-muted-foreground">Es. 192.168.1.0/24</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" name="name" required placeholder="LAN Ufficio" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gateway">Gateway</Label>
                  <Input id="gateway" name="gateway" placeholder="192.168.1.1" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrizione</Label>
                <Input id="description" name="description" placeholder="Descrizione opzionale" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vlan_id">VLAN ID</Label>
                  <Input id="vlan_id" name="vlan_id" type="number" placeholder="100" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Posizione</Label>
                  <Input id="location" name="location" placeholder="Sede principale" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dns_server">Server DNS</Label>
                <Input id="dns_server" name="dns_server" placeholder="192.168.1.1" className="font-mono" />
                <p className="text-xs text-muted-foreground">DNS per forward/reverse lookup di questa rete. Vuoto = DNS di sistema</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="snmp_community">Community SNMP (default)</Label>
                  <Input id="snmp_community" name="snmp_community" placeholder="es. public, privata" className="font-mono" />
                  <p className="text-xs text-muted-foreground">Usata per scansioni nmap su questa rete se il profilo non ne specifica una</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-net-router">Router ARP (default)</Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Select value={newNetworkRouterId || "none"} onValueChange={(v) => setNewNetworkRouterId(v === "none" ? "" : v)}>
                      <SelectTrigger id="new-net-router" className="flex-1 bg-background">
                        <SelectValue placeholder="Nessuno" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nessuno</SelectItem>
                        {routersList.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.name} ({r.host})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        resetQuickRouterForm();
                        setQuickRouterOpen(true);
                      }}
                    >
                      <Router className="h-4 w-4 mr-2" />
                      Aggiungi router
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Router per la tabella ARP della subnet. Se non è ancora registrato, usare &quot;Aggiungi router&quot;.
                  </p>
                </div>
              </div>
              <Button type="submit" className="w-full">Crea Rete</Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={quickRouterOpen}
          onOpenChange={(open) => {
            setQuickRouterOpen(open);
            if (!open) {
              resetQuickRouterForm();
              quickRouterFormRef.current?.reset();
            }
          }}
        >
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Router className="h-5 w-5" />
                Nuovo router (ARP)
              </DialogTitle>
            </DialogHeader>
            <form ref={quickRouterFormRef} onSubmit={handleQuickRouterSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="qr_name">Nome</Label>
                <Input id="qr_name" name="qr_name" required placeholder="Router principale" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qr_host">Indirizzo IP</Label>
                <Input id="qr_host" name="qr_host" required placeholder="192.168.1.1" className="font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={quickRouterVendor} onValueChange={setQuickRouterVendor}>
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTER_VENDOR_OPTIONS.map((v) => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Protocollo</Label>
                  <Select value={quickRouterProtocol} onValueChange={setQuickRouterProtocol}>
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTER_PROTOCOL_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <CredentialAssignmentFields
                credentials={credentials}
                credentialId={quickRouterCredId}
                snmpCredentialId={quickRouterSnmpId}
                onCredentialIdChange={setQuickRouterCredId}
                onSnmpCredentialIdChange={setQuickRouterSnmpId}
                sshFilter="ssh_api"
                credentialPlaceholder="Nessuna (inline)"
                snmpPlaceholder="Nessuna"
                showInlineCreds
                inlinePasswordPlaceholder="Obbligatoria se senza archivio"
                showPortAndCommunity
                portDefaultValue={quickRouterProtocol.startsWith("snmp") ? 161 : 22}
                communityPlaceholder="SNMP community"
                idPrefix="quick-router"
              />
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setQuickRouterOpen(false)}>
                  Annulla
                </Button>
                <Button type="submit" disabled={quickRouterSaving}>
                  {quickRouterSaving ? "Salvataggio…" : "Crea router"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {networks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Network className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nessuna rete configurata</p>
            <p className="text-sm text-muted-foreground mt-1">Clicca &quot;Aggiungi Rete&quot; per iniziare</p>
          </CardContent>
        </Card>
      ) : (
        <Card size="sm" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={networks.length > 0 && selectedIds.size === networks.length}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Seleziona tutte"
                  />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>VLAN</TableHead>
                <TableHead>Posizione</TableHead>
                <TableHead className="text-center">Host</TableHead>
                <TableHead className="text-center">Online</TableHead>
                <TableHead className="text-center">Offline</TableHead>
                <TableHead>Ultima Scansione</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {networks.map((net) => (
                <TableRow
                  key={net.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/networks/${net.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(net.id)}
                      onCheckedChange={() => toggleSelect(net.id)}
                      aria-label={`Seleziona ${net.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{net.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">{net.cidr}</Badge>
                  </TableCell>
                  <TableCell>{net.vlan_id ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{net.location || "—"}</TableCell>
                  <TableCell className="text-center">{net.total_hosts}</TableCell>
                  <TableCell className="text-center text-success font-medium">{net.online_count}</TableCell>
                  <TableCell className="text-center text-destructive font-medium">{net.offline_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {net.last_scan ? new Date(net.last_scan).toLocaleString("it-IT") : "Mai"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive/60 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(net.id, net.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
    </div>
  );
}
