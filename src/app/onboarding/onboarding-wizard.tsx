"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const ROUTER_VENDORS = [
  { value: "mikrotik", label: "MikroTik" },
  { value: "ubiquiti", label: "Ubiquiti" },
  { value: "cisco", label: "Cisco" },
  { value: "stormshield", label: "Stormshield" },
  { value: "other", label: "Altro" },
] as const;

const STEPS = [
  { title: "Router / gateway", desc: "ARP e, se supportato, DHCP" },
  { title: "DNS", desc: "Risoluzione nomi per le subnet" },
  { title: "Credenziali", desc: "SNMP, SSH, Windows, Linux" },
  { title: "Active Directory", desc: "Dominio e sincronizzazione (opz.)" },
  { title: "Prima subnet", desc: "Rete da analizzare" },
];

async function putSetting(key: string, value: string): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : "Errore salvataggio impostazioni");
  }
}

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [routerDeviceId, setRouterDeviceId] = useState<number | null>(null);
  const [routerName, setRouterName] = useState("Router principale");
  const [routerHost, setRouterHost] = useState("");
  const [routerVendor, setRouterVendor] = useState<string>("mikrotik");
  const [routerProtocol, setRouterProtocol] = useState<"ssh" | "snmp_v2">("ssh");
  const [routerUser, setRouterUser] = useState("");
  const [routerPass, setRouterPass] = useState("");
  const [routerCommunity, setRouterCommunity] = useState("public");

  const [defaultDns, setDefaultDns] = useState("");

  const [credSnmp, setCredSnmp] = useState({ enabled: true, name: "SNMP — scansione", community: "public" });
  const [credSsh, setCredSsh] = useState({ enabled: false, name: "SSH — host Linux", user: "", pass: "" });
  const [credWin, setCredWin] = useState({ enabled: false, name: "Windows — WinRM", user: "", pass: "" });
  const [credLinux, setCredLinux] = useState({ enabled: false, name: "Linux — rilevamento", user: "", pass: "" });
  const [credIds, setCredIds] = useState<{ snmp?: number; ssh?: number; windows?: number; linux?: number }>({});

  const [adEnabled, setAdEnabled] = useState(false);
  const [adCreated, setAdCreated] = useState(false);
  const [adForm, setAdForm] = useState({
    name: "Dominio principale",
    dc_host: "",
    domain: "",
    base_dn: "",
    username: "",
    password: "",
    use_ssl: true,
    port: 636,
  });

  const [netName, setNetName] = useState("LAN principale");
  const [netCidr, setNetCidr] = useState("192.168.1.0/24");
  const [netGateway, setNetGateway] = useState("");
  const [netDns, setNetDns] = useState("");
  const [attachSnmp, setAttachSnmp] = useState(true);
  const [attachSsh, setAttachSsh] = useState(true);
  const [attachWin, setAttachWin] = useState(true);
  const [attachLinux, setAttachLinux] = useState(true);

  const finishAndExit = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
      window.location.assign("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  }, []);

  const saveRouter = useCallback(async () => {
    if (!routerHost.trim()) {
      setRouterDeviceId(null);
      return;
    }
    if (routerDeviceId != null) {
      return;
    }
    if (routerProtocol === "ssh" && (!routerUser.trim() || !routerPass)) {
      toast.error("Per SSH inserire utente e password del router.");
      throw new Error("validation");
    }
    if (routerProtocol === "snmp_v2" && !routerCommunity.trim()) {
      toast.error("Inserire la community SNMP.");
      throw new Error("validation");
    }
    const body: Record<string, unknown> = {
      name: routerName.trim() || "Router",
      host: routerHost.trim(),
      device_type: "router",
      vendor: routerVendor,
      protocol: routerProtocol,
    };
    if (routerProtocol === "ssh") {
      body.username = routerUser.trim();
      body.password = routerPass;
      // Anche con protocollo primario SSH, invia la community SNMP per permettere
      // scansioni porte, LLDP/CDP, STP e vendor profile (es. MikroTik via SNMP)
      if (routerCommunity.trim()) {
        body.community_string = routerCommunity.trim();
      }
    } else {
      body.community_string = routerCommunity.trim();
    }
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Creazione router fallita");
    }
    const created = (await res.json()) as { id: number };
    setRouterDeviceId(created.id);
    toast.success("Router registrato.");
  }, [routerDeviceId, routerName, routerHost, routerVendor, routerProtocol, routerUser, routerPass, routerCommunity]);

  const saveCredentials = useCallback(async () => {
    const next: typeof credIds = { ...credIds };
    let createdAny = false;

    const postCred = async (name: string, type: string, user?: string, pass?: string) => {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          credential_type: type,
          username: user,
          password: pass,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Errore creazione credenziale");
      }
      return ((await res.json()) as { id: number }).id;
    };

    if (credSnmp.enabled && credSnmp.community.trim() && next.snmp === undefined) {
      next.snmp = await postCred(credSnmp.name.trim() || "SNMP", "snmp", undefined, credSnmp.community.trim());
      createdAny = true;
    }
    if (credSsh.enabled && credSsh.user.trim() && credSsh.pass && next.ssh === undefined) {
      next.ssh = await postCred(credSsh.name.trim() || "SSH", "ssh", credSsh.user.trim(), credSsh.pass);
      createdAny = true;
    }
    if (credWin.enabled && credWin.user.trim() && credWin.pass && next.windows === undefined) {
      next.windows = await postCred(credWin.name.trim() || "Windows", "windows", credWin.user.trim(), credWin.pass);
      createdAny = true;
    }
    if (credLinux.enabled && credLinux.user.trim() && credLinux.pass && next.linux === undefined) {
      next.linux = await postCred(credLinux.name.trim() || "Linux", "linux", credLinux.user.trim(), credLinux.pass);
      createdAny = true;
    }

    setCredIds(next);

    if (next.windows !== undefined) {
      await putSetting("host_windows_credential_id", String(next.windows));
    }
    if (next.linux !== undefined) {
      await putSetting("host_linux_credential_id", String(next.linux));
    }

    if (createdAny) {
      toast.success("Credenziali salvate.");
    }
  }, [credSnmp, credSsh, credWin, credLinux, credIds]);

  const saveAd = useCallback(async () => {
    if (!adEnabled) return;
    if (adCreated) return;
    if (!adForm.dc_host.trim() || !adForm.domain.trim() || !adForm.base_dn.trim() || !adForm.username.trim() || !adForm.password) {
      toast.error("Compila tutti i campi obbligatori per Active Directory.");
      throw new Error("validation");
    }
    const res = await fetch("/api/ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: adForm.name.trim() || "Active Directory",
        dc_host: adForm.dc_host.trim(),
        domain: adForm.domain.trim(),
        base_dn: adForm.base_dn.trim(),
        username: adForm.username.trim(),
        password: adForm.password,
        use_ssl: adForm.use_ssl,
        port: adForm.port,
        enabled: true,
        winrm_credential_id: credIds.windows ?? null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Errore integrazione AD");
    }
    setAdCreated(true);
    toast.success("Integrazione Active Directory creata. I lease DHCP Microsoft saranno disponibili dopo la sincronizzazione dalla pagina Active Directory.");
  }, [adEnabled, adCreated, adForm, credIds.windows]);

  const saveNetwork = useCallback(async () => {
    if (!netName.trim() || !netCidr.trim()) {
      toast.error("Nome e CIDR della rete sono obbligatori.");
      throw new Error("validation");
    }
    const dnsMerged = netDns.trim() || defaultDns.trim();
    const body: Record<string, unknown> = {
      name: netName.trim(),
      cidr: netCidr.trim(),
      description: "",
      gateway: netGateway.trim() || "",
      dns_server: dnsMerged || null,
      router_id: routerDeviceId ?? undefined,
    };
    if (attachSnmp && credIds.snmp !== undefined) {
      body.snmp_credential_ids = [credIds.snmp];
    }
    if (attachSsh && credIds.ssh !== undefined) {
      body.ssh_credential_ids = [credIds.ssh];
    }
    if (attachWin && credIds.windows !== undefined) {
      body.windows_credential_ids = [credIds.windows];
    }
    if (attachLinux && credIds.linux !== undefined) {
      body.linux_credential_ids = [credIds.linux];
    }

    const res = await fetch("/api/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Errore creazione rete");
    }
    const net = (await res.json()) as { id: number };
    toast.success("Rete creata.");
    await fetch("/api/onboarding/complete", { method: "POST" });
    window.location.assign(`/networks/${net.id}`);
  }, [
    netName,
    netCidr,
    netGateway,
    netDns,
    defaultDns,
    routerDeviceId,
    credIds,
    attachSnmp,
    attachSsh,
    attachWin,
    attachLinux,
  ]);

  const goNext = async () => {
    setBusy(true);
    try {
      if (step === 0) {
        if (routerHost.trim()) {
          await saveRouter();
        } else {
          setRouterDeviceId(null);
        }
      }
      if (step === 1 && defaultDns.trim()) {
        await putSetting("default_network_dns", defaultDns.trim());
      }
      if (step === 2) {
        await saveCredentials();
      }
      if (step === 3) {
        await saveAd();
      }
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (e) {
      if (e instanceof Error && e.message !== "validation") {
        toast.error(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const onSubmitLast = async () => {
    setBusy(true);
    try {
      await saveNetwork();
    } catch (e) {
      if (e instanceof Error && e.message !== "validation") {
        toast.error(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // Prefill DNS from step 2 when entering step 5
  const dnsForNetwork = netDns || defaultDns;

  return (
    <Card className="w-full max-w-lg border-border/80 shadow-lg">
      <CardHeader className="text-center space-y-3 pb-2">
        <div className="flex justify-center rounded-md bg-[#0D2537] px-6 py-4">
          <img src="/logo-white.png" alt="DA-INVENT" className="h-12 w-auto max-w-[260px] object-contain" />
        </div>
        <CardTitle className="text-xl">Configurazione iniziale</CardTitle>
        <CardDescription>
          Passo {step + 1} di {STEPS.length}: {STEPS[step].title}
        </CardDescription>
        <p className="text-xs text-muted-foreground">{STEPS[step].desc}</p>
        <div className="flex gap-1 justify-center pt-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-primary" : i < step ? "w-2 bg-primary/60" : "w-2 bg-muted"}`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {step === 0 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Il router viene usato per la cache ARP e, se il vendor è supportato, per importare i lease DHCP. Potrai associarlo alla subnet al passo finale.
            </p>
            <div className="space-y-2">
              <Label htmlFor="rname">Nome</Label>
              <Input id="rname" value={routerName} onChange={(e) => setRouterName(e.target.value)} placeholder="Router principale" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rhost">IP o hostname del router</Label>
              <Input
                id="rhost"
                value={routerHost}
                onChange={(e) => setRouterHost(e.target.value)}
                placeholder="192.168.1.1 — lascia vuoto per saltare"
              />
            </div>
            {routerHost.trim() ? (
              <>
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={routerVendor} onValueChange={(v) => v && setRouterVendor(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROUTER_VENDORS.map((v) => (
                        <SelectItem key={v.value} value={v.value}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Accesso</Label>
                  <Select
                    value={routerProtocol}
                    onValueChange={(v) => v && setRouterProtocol(v as "ssh" | "snmp_v2")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="snmp_v2">SNMP v2 (community)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {routerProtocol === "ssh" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label>Utente SSH</Label>
                        <Input value={routerUser} onChange={(e) => setRouterUser(e.target.value)} autoComplete="off" />
                      </div>
                      <div className="space-y-2">
                        <Label>Password SSH</Label>
                        <Input type="password" value={routerPass} onChange={(e) => setRouterPass(e.target.value)} autoComplete="new-password" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Community SNMP (per scansione porte, LLDP, STP)</Label>
                      <Input value={routerCommunity} onChange={(e) => setRouterCommunity(e.target.value)} placeholder="public" />
                      <p className="text-xs text-muted-foreground">
                        Necessaria per rilevare porte, LLDP/CDP, Spanning Tree e dati vendor via SNMP.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label>Community SNMP</Label>
                    <Input value={routerCommunity} onChange={(e) => setRouterCommunity(e.target.value)} />
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              DNS usato per le query dalla subnet (risoluzione forward/reverse durante le scansioni). Sarà proposto come predefinito per la prima rete.
            </p>
            <div className="space-y-2">
              <Label htmlFor="dns">Server DNS (solo IP)</Label>
              <Input id="dns" value={defaultDns} onChange={(e) => setDefaultDns(e.target.value)} placeholder="es. 192.168.1.1 o DNS interno" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-sm max-h-[55vh] overflow-y-auto pr-1">
            <p className="text-muted-foreground">
              Credenziali archiviate per provare automaticamente SNMP, SSH e accesso host Windows/Linux durante le analisi. Potrai modificarle in Impostazioni.
            </p>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="csnmp" checked={credSnmp.enabled} onCheckedChange={(c) => setCredSnmp((x) => ({ ...x, enabled: !!c }))} />
                <Label htmlFor="csnmp">SNMP (community)</Label>
              </div>
              {credSnmp.enabled && (
                <>
                  <Input
                    placeholder="Nome etichetta"
                    value={credSnmp.name}
                    onChange={(e) => setCredSnmp((x) => ({ ...x, name: e.target.value }))}
                  />
                  <Input
                    placeholder="Community"
                    value={credSnmp.community}
                    onChange={(e) => setCredSnmp((x) => ({ ...x, community: e.target.value }))}
                  />
                </>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="cssh" checked={credSsh.enabled} onCheckedChange={(c) => setCredSsh((x) => ({ ...x, enabled: !!c }))} />
                <Label htmlFor="cssh">SSH</Label>
              </div>
              {credSsh.enabled && (
                <>
                  <Input placeholder="Nome" value={credSsh.name} onChange={(e) => setCredSsh((x) => ({ ...x, name: e.target.value }))} />
                  <Input placeholder="Utente" value={credSsh.user} onChange={(e) => setCredSsh((x) => ({ ...x, user: e.target.value }))} />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={credSsh.pass}
                    onChange={(e) => setCredSsh((x) => ({ ...x, pass: e.target.value }))}
                  />
                </>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="cwin" checked={credWin.enabled} onCheckedChange={(c) => setCredWin((x) => ({ ...x, enabled: !!c }))} />
                <Label htmlFor="cwin">Windows (WinRM)</Label>
              </div>
              {credWin.enabled && (
                <>
                  <Input placeholder="Nome" value={credWin.name} onChange={(e) => setCredWin((x) => ({ ...x, name: e.target.value }))} />
                  <Input placeholder="Utente (dominio\\utente o UPN)" value={credWin.user} onChange={(e) => setCredWin((x) => ({ ...x, user: e.target.value }))} />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={credWin.pass}
                    onChange={(e) => setCredWin((x) => ({ ...x, pass: e.target.value }))}
                  />
                </>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="clin" checked={credLinux.enabled} onCheckedChange={(c) => setCredLinux((x) => ({ ...x, enabled: !!c }))} />
                <Label htmlFor="clin">Linux (SSH rilevamento)</Label>
              </div>
              {credLinux.enabled && (
                <>
                  <Input placeholder="Nome" value={credLinux.name} onChange={(e) => setCredLinux((x) => ({ ...x, name: e.target.value }))} />
                  <Input placeholder="Utente" value={credLinux.user} onChange={(e) => setCredLinux((x) => ({ ...x, user: e.target.value }))} />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={credLinux.pass}
                    onChange={(e) => setCredLinux((x) => ({ ...x, pass: e.target.value }))}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Checkbox id="aden" checked={adEnabled} onCheckedChange={(c) => setAdEnabled(!!c)} />
              <Label htmlFor="aden">Collega un dominio Active Directory</Label>
            </div>
            {adEnabled ? (
              <div className="space-y-2">
                <Input placeholder="Nome integrazione" value={adForm.name} onChange={(e) => setAdForm((f) => ({ ...f, name: e.target.value }))} />
                <Input placeholder="Host DC (es. dc.corp.local)" value={adForm.dc_host} onChange={(e) => setAdForm((f) => ({ ...f, dc_host: e.target.value }))} />
                <Input placeholder="Dominio (es. corp.local)" value={adForm.domain} onChange={(e) => setAdForm((f) => ({ ...f, domain: e.target.value }))} />
                <Input placeholder="Base DN (es. DC=corp,DC=local)" value={adForm.base_dn} onChange={(e) => setAdForm((f) => ({ ...f, base_dn: e.target.value }))} />
                <Input placeholder="Utente LDAP" value={adForm.username} onChange={(e) => setAdForm((f) => ({ ...f, username: e.target.value }))} />
                <Input
                  type="password"
                  placeholder="Password"
                  value={adForm.password}
                  onChange={(e) => setAdForm((f) => ({ ...f, password: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                  <Checkbox id="adssl" checked={adForm.use_ssl} onCheckedChange={(c) => setAdForm((f) => ({ ...f, use_ssl: !!c, port: c ? 636 : 389 }))} />
                  <Label htmlFor="adssl">LDAPS (consigliato)</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dopo la configurazione, dalla pagina Active Directory potrai sincronizzare computer, utenti e — se usi DHCP Microsoft — anche i lease.
                  {credIds.windows ? " È stata collegata la credenziale Windows creata al passo precedente per WinRM ove necessario." : ""}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Puoi aggiungere Active Directory in seguito dal menu dedicato.</p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Crea la prima subnet da analizzare usando router, DNS e credenziali già impostati. Potrai avviare scansioni dalla scheda rete.
            </p>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={netName} onChange={(e) => setNetName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>CIDR</Label>
              <Input value={netCidr} onChange={(e) => setNetCidr(e.target.value)} placeholder="192.168.1.0/24" />
            </div>
            <div className="space-y-2">
              <Label>Gateway (opz.)</Label>
              <Input value={netGateway} onChange={(e) => setNetGateway(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>DNS per questa subnet</Label>
              <Input value={netDns || defaultDns} onChange={(e) => setNetDns(e.target.value)} placeholder={defaultDns || "es. 192.168.1.1"} />
            </div>
            {routerDeviceId ? (
              <p className="text-xs text-muted-foreground">Router associato: ID {routerDeviceId} (collegato automaticamente).</p>
            ) : (
              <p className="text-xs text-muted-foreground">Nessun router associato: potrai collegarlo modificando la rete.</p>
            )}
            <div className="space-y-2 rounded-lg border p-2">
              <p className="text-xs font-medium">Collega credenziali alla rete (tentativi in ordine)</p>
              {credIds.snmp !== undefined && (
                <div className="flex items-center gap-2">
                  <Checkbox id="an1" checked={attachSnmp} onCheckedChange={(c) => setAttachSnmp(!!c)} />
                  <Label htmlFor="an1">SNMP</Label>
                </div>
              )}
              {credIds.ssh !== undefined && (
                <div className="flex items-center gap-2">
                  <Checkbox id="an2" checked={attachSsh} onCheckedChange={(c) => setAttachSsh(!!c)} />
                  <Label htmlFor="an2">SSH</Label>
                </div>
              )}
              {credIds.windows !== undefined && (
                <div className="flex items-center gap-2">
                  <Checkbox id="an3" checked={attachWin} onCheckedChange={(c) => setAttachWin(!!c)} />
                  <Label htmlFor="an3">Windows</Label>
                </div>
              )}
              {credIds.linux !== undefined && (
                <div className="flex items-center gap-2">
                  <Checkbox id="an4" checked={attachLinux} onCheckedChange={(c) => setAttachLinux(!!c)} />
                  <Label htmlFor="an4">Linux (host)</Label>
                </div>
              )}
              {credIds.snmp === undefined &&
                credIds.ssh === undefined &&
                credIds.windows === undefined &&
                credIds.linux === undefined && (
                  <p className="text-xs text-muted-foreground">Nessuna credenziale creata al passo 3: potrai assegnarle dopo.</p>
                )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          {step < 4 ? (
            <div className="flex gap-2 justify-between">
              <Button type="button" variant="outline" size="sm" onClick={goBack} disabled={step === 0 || busy}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Indietro
              </Button>
              <Button type="button" size="sm" onClick={goNext} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Avanti
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button type="button" onClick={onSubmitLast} disabled={busy} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Crea rete e apri analisi
              </Button>
              <Button type="button" variant="secondary" onClick={finishAndExit} disabled={busy}>
                Salta creazione rete e vai alla dashboard
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" className="text-xs text-muted-foreground" onClick={finishAndExit} disabled={busy}>
            Esci dalla configurazione guidata (completa più tardi)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
