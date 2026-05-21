"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventoryAsset, InventoryAssetInput, AssetAssignee, Location } from "@/types";

const CATEGORIE = ["Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante", "VM", "Licenza", "Access Point", "Router", "Other"];
const STATI = ["Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato"];
const CLASSIFICAZIONI = ["Pubblico", "Interno", "Confidenziale", "Riservato"];

interface InventoryNis2SchedaProps {
  form: Partial<InventoryAssetInput>;
  setForm: React.Dispatch<React.SetStateAction<Partial<InventoryAssetInput>>>;
  assignees: AssetAssignee[];
  locations: Location[];
}

/** Scheda unica NIS2: tutti i campi rilevanti per compliance. */
export function InventoryNis2Scheda({ form, setForm, assignees, locations }: InventoryNis2SchedaProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Identificazione</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Asset tag</Label><Input value={form.asset_tag ?? ""} onChange={(e) => setForm((f) => ({ ...f, asset_tag: e.target.value || null }))} /></div>
          <div><Label>Serial number</Label><Input value={form.serial_number ?? ""} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value || null }))} /></div>
          <div><Label>Hostname</Label><Input value={form.hostname ?? ""} onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value || null }))} /></div>
          <div><Label>Nome / descrizione</Label><Input value={form.nome_prodotto ?? ""} onChange={(e) => setForm((f) => ({ ...f, nome_prodotto: e.target.value || null }))} /></div>
          <div><Label>Categoria</Label>
            <Select value={form.categoria ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, categoria: (v || null) as InventoryAsset["categoria"] }))}>
              <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {CATEGORIE.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Marca</Label><Input value={form.marca ?? ""} onChange={(e) => setForm((f) => ({ ...f, marca: e.target.value || null }))} /></div>
          <div className="col-span-2"><Label>Modello</Label><Input value={form.modello ?? ""} onChange={(e) => setForm((f) => ({ ...f, modello: e.target.value || null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ubicazione</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Sede</Label><Input value={form.sede ?? ""} onChange={(e) => setForm((f) => ({ ...f, sede: e.target.value || null }))} /></div>
          <div><Label>Reparto</Label><Input value={form.reparto ?? ""} onChange={(e) => setForm((f) => ({ ...f, reparto: e.target.value || null }))} /></div>
          <div><Label>Ubicazione</Label>
            <Select value={form.location_id != null ? String(form.location_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, location_id: v === "none" ? null : Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {locations.map((loc) => <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Posizione fisica</Label><Input value={form.posizione_fisica ?? ""} onChange={(e) => setForm((f) => ({ ...f, posizione_fisica: e.target.value || null }))} /></div>
          <div><Label>IP</Label><Input value={form.ip_address ?? ""} onChange={(e) => setForm((f) => ({ ...f, ip_address: e.target.value || null }))} /></div>
          <div><Label>VLAN</Label><Input type="number" value={form.vlan ?? ""} onChange={(e) => setForm((f) => ({ ...f, vlan: e.target.value ? Number(e.target.value) : null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Responsabilità</CardTitle></CardHeader>
        <CardContent>
          <div><Label>Proprietario business</Label>
            <Select value={form.asset_assignee_id != null ? String(form.asset_assignee_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, asset_assignee_id: v === "none" ? null : Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nessuno</SelectItem>
                {assignees.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}{a.email ? ` (${a.email})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ciclo di vita</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Stato operativo</Label>
            <Select value={form.stato ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, stato: (v || null) as InventoryAsset["stato"] }))}>
              <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {STATI.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Fine supporto (EOL)</Label><Input type="date" value={form.fine_supporto ?? ""} onChange={(e) => setForm((f) => ({ ...f, fine_supporto: e.target.value || null }))} /></div>
          <div><Label>Data acquisto</Label><Input type="date" value={form.data_acquisto ?? ""} onChange={(e) => setForm((f) => ({ ...f, data_acquisto: e.target.value || null }))} /></div>
          <div><Label>Data installazione</Label><Input type="date" value={form.data_installazione ?? ""} onChange={(e) => setForm((f) => ({ ...f, data_installazione: e.target.value || null }))} /></div>
          <div><Label>Data dismissione</Label><Input type="date" value={form.data_dismissione ?? ""} onChange={(e) => setForm((f) => ({ ...f, data_dismissione: e.target.value || null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Software e rete</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Sistema operativo</Label><Input value={form.sistema_operativo ?? ""} onChange={(e) => setForm((f) => ({ ...f, sistema_operativo: e.target.value || null }))} /></div>
          <div><Label>Versione OS</Label><Input value={form.versione_os ?? ""} onChange={(e) => setForm((f) => ({ ...f, versione_os: e.target.value || null }))} /></div>
          <div><Label>Firmware</Label><Input value={form.firmware_version ?? ""} onChange={(e) => setForm((f) => ({ ...f, firmware_version: e.target.value || null }))} /></div>
          <div><Label>MAC</Label><Input value={form.mac_address ?? ""} onChange={(e) => setForm((f) => ({ ...f, mac_address: e.target.value || null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Compliance NIS2</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="nis2_in_scope" checked={!!form.in_scope_nis2} onChange={(e) => setForm((f) => ({ ...f, in_scope_nis2: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_in_scope">In scope NIS2</Label>
          </div>
          <div><Label>Classificazione dati</Label>
            <Select value={form.classificazione_dati ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, classificazione_dati: (v || null) as InventoryAsset["classificazione_dati"] }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {CLASSIFICAZIONI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Ultimo audit</Label><Input type="date" value={form.ultimo_audit ?? ""} onChange={(e) => setForm((f) => ({ ...f, ultimo_audit: e.target.value || null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Misure di protezione</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Label>Antivirus / EDR</Label><Input value={form.antivirus ?? ""} onChange={(e) => setForm((f) => ({ ...f, antivirus: e.target.value || null }))} placeholder="Es. ESET, CrowdStrike..." /></div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_crypto" checked={!!form.crittografia_disco} onChange={(e) => setForm((f) => ({ ...f, crittografia_disco: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_crypto">Crittografia disco</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_mdr" checked={!!form.gestito_da_mdr} onChange={(e) => setForm((f) => ({ ...f, gestito_da_mdr: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_mdr">Gestito da MDR</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Note e remediation</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={4} value={form.note_tecniche ?? ""} onChange={(e) => setForm((f) => ({ ...f, note_tecniche: e.target.value || null }))} placeholder="Eccezioni, rischio residuo, piano di remediation..." />
        </CardContent>
      </Card>
    </div>
  );
}
