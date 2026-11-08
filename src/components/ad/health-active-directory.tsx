"use client";

/**
 * Health di Active Directory (punteggio, findings, matrice dei privilegi, ACL, topologia, ADCS e
 * probe dei DC, esportazione, invio a Vulcan). Era la scheda «Health» della pagina Active Directory;
 * dall'08/11/2026 è la scheda «Health AD» di «Sicurezza del dominio» (Riccardo: le due voci del menu
 * in una, senza perdere niente). Contenuto spostato tale e quale; il dominio lo sceglie chi la ospita.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { parseDbDate } from "@/lib/db-date";
import type { StatoInvioAd } from "@/lib/vulcan/quadro";
import { SEVERITY_STYLE } from "@/lib/severity-style";
import type { AclExtras, AclObjectKind, InterestingAce } from "@/lib/ad/health/acl/types";
import {
  formatRightsIt,
  OBJECT_KIND_LABEL_IT,
  shortDnName,
  shortSid,
  summarizeAclRisk,
  type AclRiskBucketId,
  type AclRiskSeverity,
} from "@/lib/ad/health/acl/risk-summary";
import {
  actionableFindings,
  countBySeverity,
  getRuleGuide,
  groupFindingsForUi,
} from "@/lib/ad/health/rule-catalog";
import type {
  HealthFinding,
  HealthScore,
  HealthSeverity,
  PrivilegeMatrix,
  PrivilegeMembershipKind,
} from "@/lib/ad/health/types";

const ACL_KIND_ORDER: AclObjectKind[] = [
  "domain",
  "adminsdholder",
  "ou",
  "group",
  "user",
  "computer",
];

function aclRiskSeverityClass(sev: AclRiskSeverity): string {
  if (sev === "critical") {
    return "border-red-500/40 bg-red-500/5";
  }
  if (sev === "high") {
    return "border-amber-500/40 bg-amber-500/5";
  }
  return "border-border bg-muted/30";
}

function aclRiskSeverityBadge(sev: AclRiskSeverity): string {
  if (sev === "critical") return "Critico";
  if (sev === "high") return "Alto";
  return "Medio";
}

function sortAclAces(aces: InterestingAce[]): InterestingAce[] {
  const kindRank = (k: AclObjectKind) => ACL_KIND_ORDER.indexOf(k);
  const severity = (a: InterestingAce) => {
    if (a.rights.some((r) => r.startsWith("DCSync") || r === "GenericAll")) return 0;
    if (a.rights.some((r) => r === "WriteDacl" || r === "WriteOwner")) return 1;
    return 2;
  };
  return [...aces].sort((a, b) => {
    const k = kindRank(a.objectKind) - kindRank(b.objectKind);
    if (k !== 0) return k;
    const s = severity(a) - severity(b);
    if (s !== 0) return s;
    return shortDnName(a.objectDn).localeCompare(shortDnName(b.objectDn));
  });
}

interface AdHealthRun {
  id: number;
  integrationId: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "error";
  errorMessage: string | null;
  scoreGlobal: number | null;
  engineVersion: string;
}

/** Il dominio di cui mostrare la Health: id e se l'integrazione è accesa. */
export interface IntegrazioneHealth {
  id: number;
  enabled: number;
}

export function HealthActiveDirectory({ integrazione }: { integrazione: IntegrazioneHealth | null }) {
  const [healthRun, setHealthRun] = useState<AdHealthRun | null>(null);
  const [healthVulcan, setHealthVulcan] = useState<StatoInvioAd | { stato: "illeggibile" } | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [healthFindings, setHealthFindings] = useState<HealthFinding[]>([]);
  const [privilegeMatrix, setPrivilegeMatrix] = useState<PrivilegeMatrix | null>(null);
  const [aclExtras, setAclExtras] = useState<AclExtras | null>(null);
  const [aclFocusBucket, setAclFocusBucket] = useState<AclRiskBucketId | "all">("all");
  const [aclShowRaw, setAclShowRaw] = useState(false);
  const [winrmProbe, setWinrmProbe] = useState<{
    configured?: boolean;
    status?: string;
    lastHotfixAt?: string | null;
    cpasswordPaths?: string[];
    errorMessage?: string;
    durationMs?: number;
    hardening?: {
      ldapServerIntegrity?: number | null;
      ldapEnforceChannelBinding?: number | null;
      smbRequireSecuritySignature?: number | null;
      lmCompatibilityLevel?: number | null;
      wdigestUseLogonCredential?: number | null;
      spoolerRunning?: boolean | null;
    } | null;
  } | null>(null);
  const [phase5Meta, setPhase5Meta] = useState<{
    gpoCount?: number;
    siteCount?: number | null;
    subnetCount?: number | null;
    gmsaCount?: number | null;
  } | null>(null);
  const [phase6Meta, setPhase6Meta] = useState<{
    psoCount?: number | null;
    shadowCredentialCount?: number;
    adcsStatus?: string;
    templateCount?: number;
    esc1Count?: number;
    esc2Count?: number;
    esc1Names?: string[];
    esc2Names?: string[];
  } | null>(null);
  const [matrixEnabledOnly, setMatrixEnabledOnly] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthRunning, setHealthRunning] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!integrazione) {
      setHealthRun(null);
      setHealthVulcan(null);
      setHealthScore(null);
      setHealthFindings([]);
      setPrivilegeMatrix(null);
      setAclExtras(null);
      setWinrmProbe(null);
      setPhase5Meta(null);
      setPhase6Meta(null);
      return;
    }
    setHealthLoading(true);
    setExpandedFinding(null);
    try {
      const res = await fetch(`/api/ad/healthcheck?integrationId=${integrazione.id}`);
      if (!res.ok) throw new Error("Errore caricamento AD Health");
      const data = await res.json();
      setHealthRun(data.run ?? null);
      setHealthVulcan(data.vulcan ?? null);
      setHealthScore(data.score ?? null);
      setHealthFindings(Array.isArray(data.findings) ? data.findings : []);
      setPrivilegeMatrix(data.privilegeMatrix ?? null);
      setAclExtras(data.acl ?? null);
      setWinrmProbe(data.winrm ?? null);
      setPhase5Meta(data.phase5 ?? null);
      setPhase6Meta(data.phase6 ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
      setHealthRun(null);
      setHealthVulcan(null);
      setHealthScore(null);
      setHealthFindings([]);
      setPrivilegeMatrix(null);
      setAclExtras(null);
      setWinrmProbe(null);
      setPhase5Meta(null);
      setPhase6Meta(null);
    } finally {
      setHealthLoading(false);
    }
  }, [integrazione]);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const handleHealthcheck = async () => {
    if (!integrazione) return;
    setHealthRunning(true);
    try {
      const res = await fetch("/api/ad/healthcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integrazione.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore healthcheck");
      setHealthScore(data.score ?? null);
      setHealthFindings(Array.isArray(data.findings) ? data.findings : []);
      setPrivilegeMatrix(data.privilegeMatrix ?? null);
      setAclExtras(data.acl ?? null);
      setWinrmProbe(data.winrm ?? null);
      setPhase5Meta(data.phase5 ?? null);
      setPhase6Meta(data.phase6 ?? null);
      setExpandedFinding(null);
      toast.success(`Healthcheck completato (score ${data.score?.global ?? "—"})`);
      await fetchHealth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setHealthRunning(false);
    }
  };

  const handleExportHealth = () => {
    if (!healthRun?.id) return;
    window.open(`/api/ad/healthcheck/export?runId=${healthRun.id}`, "_blank");
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return parseDbDate(iso).toLocaleString("it-IT");
    } catch {
      return iso;
    }
  };

  const scoreTone = (n: number) => {
    if (n >= 70) return "text-red-600";
    if (n >= 40) return "text-orange-500";
    if (n >= 20) return "text-amber-600";
    return "text-green-600";
  };

  const matrixCellLabel = (kind: PrivilegeMembershipKind | null | undefined) => {
    if (!kind) return "·";
    if (kind === "direct") return "D";
    if (kind === "nested") return "N";
    return "P";
  };

  const matrixCellClass = (kind: PrivilegeMembershipKind | null | undefined) => {
    if (!kind) return "text-muted-foreground/40";
    if (kind === "direct") return "bg-red-500/15 text-red-700 dark:text-red-300 font-semibold";
    if (kind === "nested") return "bg-amber-500/15 text-amber-800 dark:text-amber-200 font-semibold";
    return "bg-orange-500/15 text-orange-800 dark:text-orange-200 font-semibold";
  };

  const matrixRows = privilegeMatrix
    ? privilegeMatrix.users.filter((u) => (matrixEnabledOnly ? u.enabled : true))
    : [];

  const aclRisk = useMemo(
    () => (aclExtras ? summarizeAclRisk(aclExtras.interestingAces) : null),
    [aclExtras],
  );

  const aclRows = aclExtras ? sortAclAces(aclExtras.interestingAces) : [];

  const aclBucketsVisible = aclRisk
    ? aclFocusBucket === "all"
      ? aclRisk.buckets
      : aclRisk.buckets.filter((b) => b.id === aclFocusBucket)
    : [];

  const findingGroups = useMemo(
    () => groupFindingsForUi(actionableFindings(healthFindings)),
    [healthFindings],
  );
  const findingSeverityCounts = useMemo(
    () => countBySeverity(healthFindings),
    [healthFindings],
  );

  const severityBadgeClass = (sev: HealthSeverity | string) =>
    SEVERITY_STYLE[sev] ?? "bg-muted text-foreground";

  const severityLabelIt = (sev: string) => {
    if (sev === "Critical") return "Critico";
    if (sev === "High") return "Alto";
    if (sev === "Medium") return "Medio";
    if (sev === "Low") return "Basso";
    return sev;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p>
          <span className="font-medium">AD Health Domarc (LDAP) — non è PingCastle.</span>{" "}
          Assessment basato su sync LDAP e regole Domarc; non esegue né sostituisce PingCastle.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={handleHealthcheck}
          disabled={healthRunning || !integrazione?.enabled}
        >
          {healthRunning ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Activity className="w-4 h-4 mr-2" />
          )}
          Esegui healthcheck
        </Button>
        <Button
          variant="outline"
          onClick={handleExportHealth}
          disabled={!healthRun?.id || healthRun.status !== "ok" || healthScore == null}
        >
          <Download className="w-4 h-4 mr-2" />
          Esporta JSON
        </Button>
        {healthRun && (
          <span className="text-xs text-muted-foreground ml-auto">
            Ultimo run: {formatDate(healthRun.finishedAt ?? healthRun.startedAt)}
            {" · "}
            <Badge
              variant={
                healthRun.status === "ok"
                  ? "default"
                  : healthRun.status === "error"
                    ? "destructive"
                    : "secondary"
              }
              className="align-middle"
            >
              {healthRun.status}
            </Badge>
            {healthRun.engineVersion && (
              <span className="ml-2">v{healthRun.engineVersion}</span>
            )}
          </span>
        )}
      </div>

      {healthRun && (
        <p className="text-[13px] text-muted-foreground">
          Invio a DA-Vul-can dell&apos;ultimo run ok:{" "}
          {healthVulcan === null && "mai accodato"}
          {healthVulcan?.stato === "spento" && "spento (nessun gettone dell'hub su questa istanza)"}
          {healthVulcan?.stato === "altro_cliente" && "non parte: questo non è il cliente dell'invio su questa istanza"}
          {healthVulcan?.stato === "in_coda" &&
            `in coda${healthVulcan.motivo ? ` — ultimo tentativo: ${healthVulcan.motivo}` : ""}`}
          {healthVulcan?.stato === "inviato" && `inviato il ${formatDate(healthVulcan.il)}`}
          {healthVulcan?.stato === "scartato" && `scartato: ${healthVulcan.motivo ?? "motivo non registrato"}`}
          {healthVulcan?.stato === "fallito" &&
            `fallito dopo i tentativi: ${healthVulcan.motivo ?? "motivo non registrato"} («Invia ora» in Cosa esce lo ritenta)`}
          {healthVulcan?.stato === "illeggibile" && "stato non leggibile (errore nel database)"}
        </p>
      )}
      {healthRun?.status === "running" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Healthcheck in corso… i dati sotto restano dell&apos;ultimo run completato, se disponibile.
        </p>
      )}
      {healthRun?.status === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm space-y-1">
          <p className="font-medium text-destructive">Ultimo run in errore</p>
          {healthRun.errorMessage && (
            <p className="text-destructive/90">{healthRun.errorMessage}</p>
          )}
          <p className="text-muted-foreground">
            Riesegui l&apos;healthcheck. Se vedi ancora findings/ACL sotto, sono dell&apos;ultimo run ok.
          </p>
        </div>
      )}

      {healthLoading ? (
        <SkeletonTable rows={3} columns={4} />
      ) : healthScore ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {(
            [
              ["Global", healthScore.global],
              ["Stale", healthScore.stale],
              ["Privileged", healthScore.privileged],
              ["Trust", healthScore.trust],
              ["Anomaly", healthScore.anomaly],
            ] as const
          ).map(([label, value]) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${scoreTone(value)}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Nessun healthcheck eseguito per questa integrazione.</p>
            <p className="text-sm mt-1">Clicca &quot;Esegui healthcheck&quot; per avviare l&apos;assessment.</p>
          </CardContent>
        </Card>
      )}

      {!healthLoading && findingGroups.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Findings — cosa fare</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Problemi raggruppati per area, con spiegazione e azione consigliata.
                  Espandi una riga per vedere gli oggetti coinvolti.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["Critical", "High", "Medium", "Low"] as const).map((sev) => {
                  const n = findingSeverityCounts[sev] ?? 0;
                  if (n === 0) return null;
                  return (
                    <Badge key={sev} className={severityBadgeClass(sev)}>
                      {severityLabelIt(sev)}: {n}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {findingGroups.map((group) => (
              <div key={group.axis} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <Badge variant="outline" className="text-[10px]">
                    {group.findings.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {group.findings.map((f) => {
                    const open = expandedFinding === f.ruleId;
                    const guide = getRuleGuide(f.ruleId);
                    return (
                      <div
                        key={f.ruleId}
                        className="rounded-lg border bg-card overflow-hidden"
                      >
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors"
                          onClick={() =>
                            setExpandedFinding(open ? null : f.ruleId)
                          }
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground mt-0.5 shrink-0">
                              {open ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-sm">
                                  {guide.titleIt}
                                </span>
                                <Badge className={severityBadgeClass(f.severity)}>
                                  {severityLabelIt(f.severity)}
                                </Badge>
                                {f.objectCount > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {f.objectCount} oggett{f.objectCount === 1 ? "o" : "i"}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {f.ruleId}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground leading-snug">
                                <span className="font-medium text-foreground/80">Perché: </span>
                                {guide.why}
                              </p>
                              <p className="text-xs leading-snug">
                                <span className="font-medium text-foreground/80">Cosa fare: </span>
                                {guide.fix}
                              </p>
                            </div>
                          </div>
                        </button>
                        {open && (
                          <div className="border-t bg-muted/20 px-3 py-2.5 space-y-2">
                            {f.description && (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground/80">Dettaglio engine: </span>
                                {f.description}
                              </p>
                            )}
                            {f.sampleDns.length > 0 ? (
                              <div>
                                <p className="text-xs font-medium mb-1">
                                  Oggetti coinvolti ({f.sampleDns.length}
                                  {f.objectCount > f.sampleDns.length
                                    ? ` di ${f.objectCount}`
                                    : ""}
                                  )
                                </p>
                                <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
                                  {f.sampleDns.map((dn) => (
                                    <li
                                      key={dn}
                                      className="truncate"
                                      title={dn}
                                    >
                                      <span className="font-medium">{shortDnName(dn)}</span>
                                      <span className="ml-2 font-mono text-muted-foreground">
                                        {dn}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Nessun oggetto in sample (finding a livello dominio/config).
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!healthLoading && healthScore && actionableFindings(healthFindings).length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nessun finding operativo per questo run.
        </p>
      )}

      {!healthLoading && privilegeMatrix && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <CardTitle className="text-base">Matrice privilegi</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Utenti con path verso gruppi amministrativi / elevati
                  (D=diretto, N=nested, P=primaryGroupID). Nested max depth 5.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={matrixEnabledOnly}
                  onCheckedChange={(v) => setMatrixEnabledOnly(v === true)}
                />
                Solo account abilitati
              </label>
            </div>
            {privilegeMatrix.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                Matrice troncata ai primi 500 utenti con privilegi.
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {matrixRows.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 pb-6">
                Nessun utente nelle colonne privilegiate (con il filtro attuale).
              </p>
            ) : (
              <div className="overflow-x-auto border-t">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left font-medium sticky left-0 bg-muted/50 z-10 min-w-[140px]">
                        Utente
                      </th>
                      {privilegeMatrix.groups.map((g) => (
                        <th
                          key={g.key}
                          className="p-2 text-center font-medium whitespace-nowrap"
                          title={`${g.displayName}${g.found ? "" : " (gruppo non trovato)"} — ${g.memberCount} enabled`}
                        >
                          <div className={g.found ? "" : "opacity-40"}>
                            {g.displayName.replace("Group Policy Creator Owners", "GPO Creators")}
                          </div>
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {g.memberCount}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((u) => (
                      <tr key={u.dn} className="border-t hover:bg-muted/20">
                        <td
                          className="p-2 font-mono sticky left-0 bg-background z-10"
                          title={u.dn}
                        >
                          <span className={u.enabled ? "" : "text-muted-foreground line-through"}>
                            {u.sam}
                          </span>
                        </td>
                        {privilegeMatrix.groups.map((g) => {
                          const kind = u.cells[g.key] ?? null;
                          const catena = u.paths?.[g.key];
                          const tip = kind
                            ? `${g.displayName}: ${kind}${catena?.length ? ` via ${catena.join(" → ")}` : ""}`
                            : undefined;
                          return (
                            <td
                              key={g.key}
                              className={`p-1 text-center ${matrixCellClass(kind)}`}
                              title={tip}
                            >
                              {matrixCellLabel(kind)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!healthLoading && (phase5Meta || phase6Meta || winrmProbe) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Topologia, ADCS e probe DC</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Inventario LDAP (GPO/Sites/ADCS), hardening WinRM sul DC se configurato.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {phase5Meta && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">GPO</div>
                  <div className="font-semibold">{phase5Meta.gpoCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Sites</div>
                  <div className="font-semibold">{phase5Meta.siteCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Subnets</div>
                  <div className="font-semibold">{phase5Meta.subnetCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">gMSA</div>
                  <div className="font-semibold">{phase5Meta.gmsaCount ?? "—"}</div>
                </div>
              </div>
            )}
            {phase6Meta && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Template ADCS</div>
                  <div className="font-semibold">{phase6Meta.templateCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">ESC1</div>
                  <div className="font-semibold text-destructive">
                    {phase6Meta.esc1Count ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">ESC2</div>
                  <div className="font-semibold">
                    {phase6Meta.esc2Count ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">PSO / Shadow</div>
                  <div className="font-semibold">
                    {phase6Meta.psoCount ?? "—"} / {phase6Meta.shadowCredentialCount ?? 0}
                  </div>
                </div>
              </div>
            )}
            {winrmProbe && (
              <div className="rounded-md border px-3 py-2 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">WinRM</span>
                  <Badge
                    variant={
                      winrmProbe.status === "ok"
                        ? "default"
                        : winrmProbe.status === "skipped"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {!winrmProbe.configured || winrmProbe.status === "skipped"
                      ? "Non configurato"
                      : winrmProbe.status === "ok"
                        ? "OK"
                        : "Non disponibile"}
                  </Badge>
                  {winrmProbe.durationMs != null && winrmProbe.status === "ok" && (
                    <span className="text-xs text-muted-foreground">
                      {(winrmProbe.durationMs / 1000).toFixed(1)} s
                    </span>
                  )}
                </div>
                {winrmProbe.lastHotfixAt && (
                  <p className="text-xs text-muted-foreground">
                    Ultimo hotfix DC:{" "}
                    {formatDate(winrmProbe.lastHotfixAt)}
                  </p>
                )}
                {winrmProbe.hardening && winrmProbe.status === "ok" && (
                  <ul className="text-xs text-muted-foreground pt-1 space-y-0.5">
                    <li>
                      LDAP signing:{" "}
                      {winrmProbe.hardening.ldapServerIntegrity == null
                        ? "—"
                        : winrmProbe.hardening.ldapServerIntegrity >= 2
                          ? `obbligatorio (${winrmProbe.hardening.ldapServerIntegrity})`
                          : `non obbligatorio (${winrmProbe.hardening.ldapServerIntegrity})`}
                    </li>
                    <li>
                      Channel binding:{" "}
                      {winrmProbe.hardening.ldapEnforceChannelBinding == null
                        ? "—"
                        : winrmProbe.hardening.ldapEnforceChannelBinding === 0
                          ? "disattivato (0)"
                          : `attivo (${winrmProbe.hardening.ldapEnforceChannelBinding})`}
                    </li>
                    <li>
                      SMB signing richiesto:{" "}
                      {winrmProbe.hardening.smbRequireSecuritySignature == null
                        ? "—"
                        : winrmProbe.hardening.smbRequireSecuritySignature === 0
                          ? "no"
                          : "sì"}
                    </li>
                    <li>
                      Compatibilità NTLM (LmCompat):{" "}
                      {winrmProbe.hardening.lmCompatibilityLevel ?? "—"}
                      {winrmProbe.hardening.lmCompatibilityLevel != null &&
                      winrmProbe.hardening.lmCompatibilityLevel < 3
                        ? " — consente NTLMv1"
                        : ""}
                    </li>
                    <li>
                      WDigest in memoria:{" "}
                      {winrmProbe.hardening.wdigestUseLogonCredential == null
                        ? "—"
                        : winrmProbe.hardening.wdigestUseLogonCredential === 1
                          ? "abilitato (rischio)"
                          : "disabilitato"}
                    </li>
                    <li>
                      Print Spooler:{" "}
                      {winrmProbe.hardening.spoolerRunning == null
                        ? "—"
                        : winrmProbe.hardening.spoolerRunning
                          ? "in esecuzione"
                          : "fermo"}
                    </li>
                  </ul>
                )}
                {winrmProbe.cpasswordPaths && winrmProbe.cpasswordPaths.length > 0 && (
                  <p className="text-xs text-destructive font-medium">
                    cpassword in SYSVOL: {winrmProbe.cpasswordPaths.length} path
                  </p>
                )}
                {winrmProbe.errorMessage && winrmProbe.status === "unavailable" && (
                  <p className="text-xs text-destructive">{winrmProbe.errorMessage}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!healthLoading && aclExtras && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <CardTitle className="text-base">Analisi permessi ACL</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Sintesi per tipo di rischio: cosa è pericoloso, perché, e chi lo può fare.
                </p>
              </div>
              <Badge
                variant={
                  aclExtras.meta.status === "ok"
                    ? "default"
                    : aclExtras.meta.status === "partial"
                      ? "secondary"
                      : "destructive"
                }
              >
                {aclExtras.meta.status === "ok"
                  ? "Completo"
                  : aclExtras.meta.status === "partial"
                    ? "Parziale"
                    : "Non disponibile"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Oggetti letti</div>
                <div className="font-semibold">{aclExtras.meta.objectsScanned}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">ACE critiche</div>
                <div className="font-semibold">{aclExtras.meta.interestingAceCount}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Categorie rischio</div>
                <div className="font-semibold">{aclRisk?.buckets.length ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Tempo collect</div>
                <div className="font-semibold">
                  {(aclExtras.meta.durationMs / 1000).toFixed(1)} s
                </div>
              </div>
            </div>
            {aclExtras.meta.errorMessage && (
              <p className="text-sm text-destructive">{aclExtras.meta.errorMessage}</p>
            )}

            {aclRisk && aclRisk.buckets.length > 0 ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {aclRisk.buckets.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() =>
                        setAclFocusBucket((cur) => (cur === b.id ? "all" : b.id))
                      }
                      className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${aclRiskSeverityClass(b.severity)} ${
                        aclFocusBucket === b.id ? "ring-2 ring-primary/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm">{b.title}</div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {aclRiskSeverityBadge(b.severity)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-snug">{b.why}</p>
                      <p className="text-xs mt-2">
                        <span className="font-semibold">{b.uniqueTrustees}</span> attori ·{" "}
                        <span className="font-semibold">{b.uniqueTargets}</span> oggetti ·{" "}
                        <span className="font-semibold">{b.aceCount}</span> ACE
                      </p>
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {aclFocusBucket === "all"
                        ? "Dettaglio per categoria"
                        : `Dettaglio: ${aclBucketsVisible[0]?.title ?? ""}`}
                    </p>
                    {aclFocusBucket !== "all" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setAclFocusBucket("all")}
                      >
                        Mostra tutte
                      </Button>
                    )}
                  </div>

                  {aclBucketsVisible.map((b) => (
                    <div key={b.id} className={`rounded-lg border p-3 space-y-2 ${aclRiskSeverityClass(b.severity)}`}>
                      <div>
                        <div className="font-medium text-sm">{b.title}</div>
                        <p className="text-xs text-muted-foreground mt-0.5">{b.why}</p>
                      </div>
                      <div className="space-y-2">
                        {b.entries.map((e) => (
                          <div
                            key={`${b.id}-${e.trusteeSid}`}
                            className="rounded-md bg-background/70 border px-2.5 py-2"
                          >
                            <div className="text-sm font-medium" title={e.trusteeSid}>
                              {e.trusteeLabel}
                              {e.trusteeSam && (
                                <span className="ml-2 text-[11px] font-mono text-muted-foreground font-normal">
                                  {shortSid(e.trusteeSid)}
                                </span>
                              )}
                            </div>
                            <ul className="mt-1.5 space-y-1">
                              {e.targets.map((t) => (
                                <li
                                  key={`${t.objectDn}-${t.rights.join(",")}`}
                                  className="text-xs text-muted-foreground flex flex-wrap gap-x-1.5"
                                >
                                  <span className="text-foreground font-medium" title={t.objectDn}>
                                    {t.objectLabel}
                                  </span>
                                  <span>({OBJECT_KIND_LABEL_IT[t.objectKind]})</span>
                                  <span>—</span>
                                  <span className="text-foreground">{formatRightsIt(t.rights)}</span>
                                  {t.inherited && (
                                    <span className="text-muted-foreground/80">· ereditato</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        {b.uniqueTrustees > b.entries.length && (
                          <p className="text-xs text-muted-foreground">
                            … e altri {b.uniqueTrustees - b.entries.length} attori in questa categoria
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setAclShowRaw((v) => !v)}
                  >
                    {aclShowRaw ? "Nascondi elenco grezzo" : `Mostra elenco grezzo (${aclRows.length})`}
                  </Button>
                  {aclShowRaw && (
                    <div className="mt-2 border rounded-lg overflow-x-auto max-h-80 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="p-2 text-left font-medium">Su cosa</th>
                            <th className="p-2 text-left font-medium">Chi</th>
                            <th className="p-2 text-left font-medium">Permesso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aclRows.slice(0, 120).map((a, i) => (
                            <tr key={`${a.objectDn}-${a.trusteeSid}-${i}`} className="border-t align-top">
                              <td className="p-2" title={a.objectDn}>
                                {shortDnName(a.objectDn)}
                                <div className="text-[11px] text-muted-foreground">
                                  {OBJECT_KIND_LABEL_IT[a.objectKind]}
                                </div>
                              </td>
                              <td className="p-2" title={a.trusteeSid}>
                                {a.trusteeSam ?? shortSid(a.trusteeSid)}
                              </td>
                              <td className="p-2 text-xs">{formatRightsIt(a.rights)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nessuna ACE critica da analizzare (o collect non disponibile).
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
