"use client";

/**
 * «Nuovo job» nella pagina Schedulazioni (Riccardo, 11/11/2026: i job stavano in due posti, qui e in Impostazioni →
 * «Job schedulati»; la gestione viene tutta qui). È la finestra che stava in Impostazioni, con gli stessi campi e la
 * stessa rotta (`POST /api/jobs`). I job «Lettura apparati» continuano a nascere da Discovery.
 */
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";

const TIPI_PESANTI = new Set(["fast_scan", "ping_sweep"]);

const INTERVALLI = [
  { value: "5", label: "Ogni 5 minuti" },
  { value: "15", label: "Ogni 15 minuti" },
  { value: "30", label: "Ogni 30 minuti" },
  { value: "60", label: "Ogni ora" },
  { value: "360", label: "Ogni 6 ore" },
  { value: "1440", label: "Ogni 24 ore" },
];

export function NuovoJob({ onCreato }: { onCreato: () => void }) {
  const [aperta, setAperta] = useState(false);
  const [tipo, setTipo] = useState("known_host_check");
  const [reti, setReti] = useState<Array<{ id: number; name: string; cidr: string }>>([]);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    if (!aperta) return;
    void fetchJson<Array<{ id: number; name: string; cidr: string }>>("/api/networks").then((r) => { if (r.ok) setReti(r.data); });
  }, [aperta]);

  async function crea(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setInvio(true);
    const r = await fetchJson<unknown>("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network_id: f.get("network_id") ? Number(f.get("network_id")) : null,
        job_type: f.get("job_type"),
        interval_minutes: Number(f.get("interval_minutes")),
      }),
    });
    setInvio(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Job schedulato creato");
    setAperta(false);
    onCreato();
  }

  return (
    <Dialog open={aperta} onOpenChange={setAperta}>
      <DialogTrigger render={<Button size="sm" className="min-h-9 text-[14px]" />}>
        <Plus className="mr-2 h-4 w-4" />Nuovo job
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuovo job schedulato</DialogTitle>
        </DialogHeader>
        <form onSubmit={crea} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select name="job_type" value={tipo} onValueChange={(v) => setTipo(v ?? "known_host_check")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="known_host_check">Monitoraggio host registrati (consigliato)</SelectItem>
                <SelectItem value="arp_poll">ARP Poll (passivo via SNMP switch)</SelectItem>
                <SelectItem value="snmp_scan">SNMP Scan</SelectItem>
                <SelectItem value="dns_resolve">DNS Resolve</SelectItem>
                <SelectItem value="cleanup">Pulizia tabelle MAC</SelectItem>
                <SelectItem value="ping_sweep">Ping Sweep (scan completo subnet)</SelectItem>
                <SelectItem value="fast_scan">Scoperta veloce subnet</SelectItem>
                <SelectItem value="nmap_scan">Nmap Scan</SelectItem>
              </SelectContent>
            </Select>
            {TIPI_PESANTI.has(tipo) && (
              <p className="text-[13px] leading-snug">
                <b className="font-semibold">▲ Tipo pesante:</b> scansiona tutti gli IP della subnet. Su reti grandi (da /22 in su) può saturare la CPU:
                per un giro periodico meglio «Monitoraggio host registrati», e questo di notte o con intervallo di almeno 12 ore.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Rete (facoltativa per la pulizia)</Label>
            <Select name="network_id">
              <SelectTrigger><SelectValue placeholder="Tutte le reti" /></SelectTrigger>
              <SelectContent>
                {reti.map((n) => (
                  <SelectItem key={n.id} value={String(n.id)}>{n.name} ({n.cidr})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Intervallo</Label>
            <Select name="interval_minutes" defaultValue="60">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVALLI.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={invio}>Crea job</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
