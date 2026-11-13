"use client";

/**
 * Cosa vede il cliente (Riccardo, 13/11/2026: «apparati, famiglie»). Solo in «Componi», solo amministratori.
 * Ogni cambio si salva subito; la pagina si rilegge. Un apparato nascosto sparisce per il cliente da elenco,
 * conti, frase, problemi e KPI.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pannello } from "@/components/shared/console";
import type { FamigliaGestita } from "@/lib/cliente/monitoring";

async function salva(corpo: { tipo: "famiglia" | "host"; chiave: string; visibile: boolean; nomeCliente?: string | null }): Promise<boolean> {
  try {
    const r = await fetch("/api/vista-cliente/monitoring/visibilita", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (r.ok) return true;
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    toast.error(d?.error ?? "Non salvato");
  } catch {
    toast.error("Non salvato: il server non risponde");
  }
  return false;
}

function RigaApparato({ o, famigliaVisibile }: { o: FamigliaGestita["oggetti"][number]; famigliaVisibile: boolean }) {
  const router = useRouter();
  const [nome, setNome] = useState(o.nomeCliente ?? "");
  const [visibile, setVisibile] = useState(o.visibile);
  async function cambia(v: boolean) {
    setVisibile(v);
    if (await salva({ tipo: "host", chiave: o.hostid, visibile: v, nomeCliente: nome })) router.refresh();
    else setVisibile(!v);
  }
  async function rinomina() {
    if ((o.nomeCliente ?? "") === nome.trim()) return;
    if (await salva({ tipo: "host", chiave: o.hostid, visibile, nomeCliente: nome })) router.refresh();
  }
  return (
    <li className="flex flex-wrap items-center gap-3 border-t py-1.5 text-sm">
      <Switch checked={visibile} onCheckedChange={(v) => void cambia(v)} aria-label={`${visibile ? "Nascondi" : "Mostra"} ${o.nomeZabbix} al cliente`} />
      <span className={`w-64 min-w-0 truncate ${visibile && famigliaVisibile ? "" : "text-muted-foreground line-through"}`}>{o.nomeZabbix}</span>
      <Input
        className="h-8 max-w-xs"
        placeholder="Nome per il cliente (facoltativo)"
        value={nome}
        maxLength={80}
        onChange={(e) => setNome(e.target.value)}
        onBlur={() => void rinomina()}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </li>
  );
}

export function GestioneVisibilita({ famiglie }: { famiglie: FamigliaGestita[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("");
  const f = filtro.trim().toLowerCase();
  return (
    <Pannello
      titolo="Cosa vede il cliente"
      sottotitolo="Famiglie e apparati nascosti spariscono per il cliente anche da conti, problemi e KPI. Il nome per il cliente sostituisce quello di Zabbix."
      azioni={<Input className="h-8 w-56" placeholder="Filtra gli apparati" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
      className="nascosto-stampa"
    >
      <div className="space-y-4">
        {famiglie.map((fam) => {
          const oggetti = f ? fam.oggetti.filter((o) => `${o.nomeZabbix} ${o.nomeCliente ?? ""}`.toLowerCase().includes(f)) : fam.oggetti;
          if (f && oggetti.length === 0) return null;
          return (
            <section key={fam.codice}>
              <div className="flex items-center gap-3">
                <Switch
                  checked={fam.visibile}
                  onCheckedChange={async (v) => { if (await salva({ tipo: "famiglia", chiave: fam.codice, visibile: v })) router.refresh(); }}
                  aria-label={`${fam.visibile ? "Nascondi" : "Mostra"} la famiglia ${fam.etichetta} al cliente`}
                />
                <h3 className={`text-sm font-bold ${fam.visibile ? "" : "text-muted-foreground line-through"}`}>{fam.etichetta}</h3>
                <span className="text-[13px] text-muted-foreground">
                  {fam.oggetti.length} apparati{fam.visibile ? `, ${fam.oggetti.filter((o) => !o.visibile).length} nascosti` : " · famiglia nascosta"}
                </span>
              </div>
              <ul className="mt-1 pl-12">
                {oggetti.map((o) => <RigaApparato key={o.hostid} o={o} famigliaVisibile={fam.visibile} />)}
              </ul>
            </section>
          );
        })}
      </div>
    </Pannello>
  );
}
