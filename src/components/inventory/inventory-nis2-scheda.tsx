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
import { AddableSelect } from "@/components/shared/addable-select";

const CATEGORIE = ["Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante", "VM", "Licenza", "Access Point", "Router", "Other"];
const STATI = ["Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato"];
const CLASSIFICAZIONI = ["Pubblico", "Interno", "Confidenziale", "Riservato"];

const NIS2_CATEGORIE: { value: string; label: string }[] = [
  { value: "workstation", label: "Workstation utente" },
  { value: "server", label: "Server" },
  { value: "rete", label: "Apparato di rete" },
  { value: "storage", label: "Storage" },
  { value: "mobile", label: "Dispositivo mobile" },
  { value: "iot", label: "IoT / OT" },
  { value: "supporto_rimovibile", label: "Supporto rimovibile" },
  { value: "servizio_cloud", label: "Servizio cloud" },
  { value: "applicazione", label: "Applicazione" },
  { value: "altro", label: "Altro" },
];

const NIS2_CRITICITA: { value: string; label: string }[] = [
  { value: "bassa", label: "Bassa" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Critica" },
];

const NIS2_DATI_TRATTATI: { value: string; label: string }[] = [
  { value: "nessuno", label: "Nessuno" },
  { value: "personali", label: "Personali" },
  { value: "sensibili", label: "Sensibili (art. 9 GDPR)" },
  { value: "finanziari", label: "Finanziari" },
  { value: "sanitari", label: "Sanitari" },
  { value: "infrastruttura_critica", label: "Infrastruttura critica" },
  { value: "altro", label: "Altro" },
];

interface InventoryNis2SchedaProps {
  form: Partial<InventoryAssetInput>;
  setForm: React.Dispatch<React.SetStateAction<Partial<InventoryAssetInput>>>;
  assignees: AssetAssignee[];
  locations: Location[];
  refetchAssignees?: () => void | Promise<void>;
  refetchLocations?: () => void | Promise<void>;
}

/** Scheda unica NIS2: tutti i campi rilevanti per compliance. */
export function InventoryNis2Scheda({ form, setForm, assignees, locations, refetchAssignees, refetchLocations }: InventoryNis2SchedaProps) {
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
            <AddableSelect
              value={form.location_id ?? null}
              onChange={(v) => setForm((f) => ({ ...f, location_id: v }))}
              options={locations.map((loc) => ({ id: loc.id, label: loc.name, extra: loc.address ?? undefined }))}
              entityLabel="ubicazione"
              createApiUrl="/api/locations"
              extraFields={[{ key: "address", label: "Indirizzo", placeholder: "Via X, Città" }]}
              onCreated={() => refetchLocations?.()}
            />
          </div>
          <div><Label>Posizione fisica</Label><Input value={form.posizione_fisica ?? ""} onChange={(e) => setForm((f) => ({ ...f, posizione_fisica: e.target.value || null }))} /></div>
          <div><Label>IP</Label><Input value={form.ip_address ?? ""} onChange={(e) => setForm((f) => ({ ...f, ip_address: e.target.value || null }))} /></div>
          <div><Label>VLAN</Label><Input type="number" value={form.vlan ?? ""} onChange={(e) => setForm((f) => ({ ...f, vlan: e.target.value ? Number(e.target.value) : null }))} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Responsabilità</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><Label>Business owner</Label>
            <AddableSelect
              value={form.business_owner_id ?? null}
              onChange={(v) => setForm((f) => ({ ...f, business_owner_id: v }))}
              options={assignees.map((a) => ({ id: a.id, label: a.name, extra: a.email ?? undefined }))}
              entityLabel="assegnatario"
              createApiUrl="/api/asset-assignees"
              extraFields={[{ key: "email", label: "Email", placeholder: "nome@dominio.it", type: "email" }, { key: "phone", label: "Telefono" }]}
              onCreated={() => refetchAssignees?.()}
            />
            <p className="text-[11px] text-muted-foreground mt-1">Chi ha la responsabilità decisionale (business).</p>
          </div>
          <div><Label>Technical owner</Label>
            <AddableSelect
              value={form.technical_owner_id ?? null}
              onChange={(v) => setForm((f) => ({ ...f, technical_owner_id: v }))}
              options={assignees.map((a) => ({ id: a.id, label: a.name, extra: a.email ?? undefined }))}
              entityLabel="assegnatario"
              createApiUrl="/api/asset-assignees"
              extraFields={[{ key: "email", label: "Email", placeholder: "nome@dominio.it", type: "email" }, { key: "phone", label: "Telefono" }]}
              onCreated={() => refetchAssignees?.()}
            />
            <p className="text-[11px] text-muted-foreground mt-1">Chi gestisce tecnicamente l&apos;asset (IT/sysadmin).</p>
          </div>
          <div className="col-span-2 pt-2 border-t">
            <Label className="text-xs text-muted-foreground">Proprietario business (legacy / pre-NIS2)</Label>
            <AddableSelect
              value={form.asset_assignee_id ?? null}
              onChange={(v) => setForm((f) => ({ ...f, asset_assignee_id: v }))}
              options={assignees.map((a) => ({ id: a.id, label: a.name, extra: a.email ?? undefined }))}
              entityLabel="assegnatario"
              createApiUrl="/api/asset-assignees"
              extraFields={[{ key: "email", label: "Email", placeholder: "nome@dominio.it", type: "email" }, { key: "phone", label: "Telefono" }]}
              onCreated={() => refetchAssignees?.()}
            />
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
          <div><Label>Categoria NIS2</Label>
            <Select value={form.categoria_nis2 ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, categoria_nis2: (v || null) as InventoryAsset["categoria_nis2"] }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {NIS2_CATEGORIE.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Criticità</Label>
            <Select value={form.criticita_nis2 ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, criticita_nis2: (v || null) as InventoryAsset["criticita_nis2"] }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {NIS2_CRITICITA.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Impatto in caso di compromissione.</p>
          </div>
          <div><Label>Dati trattati</Label>
            <Select value={form.dati_trattati ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, dati_trattati: (v || null) as InventoryAsset["dati_trattati"] }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {NIS2_DATI_TRATTATI.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
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
          <div><Label>Ultima review NIS2</Label><Input type="date" value={form.data_review_nis2 ?? ""} onChange={(e) => setForm((f) => ({ ...f, data_review_nis2: e.target.value || null }))} /></div>
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
          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="nis2_supporto_rimovibile" checked={!!form.supporto_rimovibile} onChange={(e) => setForm((f) => ({ ...f, supporto_rimovibile: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_supporto_rimovibile">Supporto rimovibile (USB / SD / disco esterno)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist protezione (NIS2 art. 21)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_backup" checked={!!form.backup_configurato} onChange={(e) => setForm((f) => ({ ...f, backup_configurato: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_backup">Backup configurato</Label>
          </div>
          <div>
            <Label className="text-xs">Ultimo test restore</Label>
            <Input type="date" value={form.backup_ultimo_test ?? ""} onChange={(e) => setForm((f) => ({ ...f, backup_ultimo_test: e.target.value || null }))} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_patching" checked={!!form.patching_automatico} onChange={(e) => setForm((f) => ({ ...f, patching_automatico: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_patching">Patching automatico</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_mfa" checked={!!form.mfa_admin} onChange={(e) => setForm((f) => ({ ...f, mfa_admin: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_mfa">MFA su accessi admin</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_log" checked={!!form.log_centralizzati} onChange={(e) => setForm((f) => ({ ...f, log_centralizzati: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_log">Log centralizzati (SIEM)</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_hardening" checked={!!form.hardening_baseline} onChange={(e) => setForm((f) => ({ ...f, hardening_baseline: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_hardening">Hardening baseline applicato</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_dr" checked={!!form.dr_plan_documentato} onChange={(e) => setForm((f) => ({ ...f, dr_plan_documentato: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_dr">Disaster recovery plan documentato</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="nis2_ir" checked={!!form.incident_response_documentata} onChange={(e) => setForm((f) => ({ ...f, incident_response_documentata: e.target.checked ? 1 : 0 }))} className="rounded" />
            <Label htmlFor="nis2_ir">Incident response procedurato</Label>
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
