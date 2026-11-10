"use client";

/**
 * Health di Active Directory: scheda «Health AD» di «Sicurezza del dominio».
 *
 * Rifatta il 10/11/2026 (Riccardo: «ricostruire la dashboard per ospitare tutto in modo
 * leggibile») sui mattoni di docs/STILE-UI.md. Prima era una colonna sola lunga decine di
 * schermate; ora: barra di stato, quattro numeri, e quattro sezioni in vista.
 *  - Rilievi: l'elenco è il centro; a sinistra le aree, che lo filtrano. I rilievi «da
 *    verificare» (fuori dal punteggio) si distinguono dai confermati col segno, non col colore.
 *  - Privilegi: la matrice utenti × gruppi amministrativi.
 *  - Permessi: le ACE pericolose, per tipo di rischio → chi, su cosa.
 *  - Copertura: cosa è stato letto davvero. Una regola muta non dice se il dato era a posto
 *    o non è stato letto: qui si vede.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Activity, ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import {
  BadgeGravita,
  BarraStato,
  Etichetta,
  InCorso,
  Legenda,
  LegendaGravita,
  Pannello,
  SchedePagina,
  TesseraNumero,
  VoceSelezionabile,
  Vuoto,
} from "@/components/shared/console";
import { cn } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";
import type { StatoInvioAd } from "@/lib/vulcan/quadro";
import type { AclExtras, InterestingAce } from "@/lib/ad/health/acl/types";
import {
  formatRightsIt,
  OBJECT_KIND_LABEL_IT,
  shortDnName,
  summarizeAclRisk,
  type AclRiskBucketId,
} from "@/lib/ad/health/acl/risk-summary";
import { actionableFindings, AXIS_LABEL_IT, getRuleGuide } from "@/lib/ad/health/rule-catalog";
import type {
  HealthAxis,
  HealthFinding,
  HealthScore,
  PrivilegeMatrix,
  PrivilegeMembershipKind,
} from "@/lib/ad/health/types";

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

interface ProbeWinrm {
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
}

interface Fase5 {
  gpoCount?: number;
  siteCount?: number | null;
  subnetCount?: number | null;
  gmsaCount?: number | null;
}

interface Fase6 {
  psoCount?: number | null;
  shadowCredentialCount?: number;
  adcsStatus?: string;
  templateCount?: number;
  esc1Count?: number;
  esc2Count?: number;
}

/** Cosa ha letto la raccolta LDAP; `null` in un campo = non letto. */
interface Copertura {
  infra: {
    dnsZones: number | null;
    dnsZonesAllowUpdateRead: number | null;
    dnsZonesAclRead: number | null;
    dnsWildcards: number | null;
    dsHeuristics: string | null;
    sysvolReplication: string | null;
    rodcs: number | null;
    dmsas: number | null;
    entraSyncedPrivileged: number | null;
  } | null;
  ldapCollectErrors: string[] | null;
  laps: {
    schemaPresent: boolean | null;
    validi: number;
    scaduti: number;
    nonImpostati: number;
    nonVerificabili: number;
  } | null;
}

interface DatiHealth {
  run: AdHealthRun | null;
  vulcan: StatoInvioAd | { stato: "illeggibile" } | null;
  score: HealthScore | null;
  findings: HealthFinding[];
  privilegeMatrix: PrivilegeMatrix | null;
  acl: AclExtras | null;
  winrm: ProbeWinrm | null;
  phase5: Fase5 | null;
  phase6: Fase6 | null;
  copertura: Copertura | null;
}

const VUOTO: DatiHealth = {
  run: null,
  vulcan: null,
  score: null,
  findings: [],
  privilegeMatrix: null,
  acl: null,
  winrm: null,
  phase5: null,
  phase6: null,
  copertura: null,
};

/** Il dominio di cui mostrare la Health: id e se l'integrazione è accesa. */
export interface IntegrazioneHealth {
  id: number;
  enabled: number;
}

type Sezione = "rilievi" | "privilegi" | "permessi" | "copertura";
type FiltroStato = "tutti" | "confermati" | "verificare";
type TipoSegno = "ok" | "attenzione" | "ignoto" | "assente";

const AREE: HealthAxis[] = ["privileged", "anomaly", "stale", "trust"];
const ORDINE_GRAVITA: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const SEGNO: Record<TipoSegno, { segno: string; classe: string }> = {
  ok: { segno: "✓", classe: "border-[#1F7A4D] bg-[#1F7A4D] text-white" },
  attenzione: { segno: "▲", classe: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]" },
  ignoto: { segno: "●", classe: "border-border bg-muted text-foreground" },
  assente: { segno: "–", classe: "border-dashed border-muted-foreground/60 bg-transparent text-muted-foreground" },
};

/** Stato = segno + fondo pieno + parola, mai la sola tinta (Riccardo è daltonico). */
function Segno({ tipo, children }: { tipo: TipoSegno; children: ReactNode }) {
  const s = SEGNO[tipo];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[13px] leading-none font-semibold whitespace-nowrap", s.classe)}>
      <span aria-hidden>{s.segno}</span>
      {children}
    </span>
  );
}

/** Un rilievo «da verificare» descrive un indizio o la raccolta: sta fuori dal punteggio (0 punti). */
function daVerificare(f: HealthFinding): boolean {
  return f.diagnostic === true || f.points === 0;
}

function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return parseDbDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function testoVulcan(v: DatiHealth["vulcan"]): string {
  if (v === null) return "Vulcan: mai accodato";
  switch (v.stato) {
    case "spento": return "Vulcan: invio spento";
    case "altro_cliente": return "Vulcan: non è il cliente dell'invio";
    case "in_coda": return `Vulcan: in coda${v.motivo ? ` (${v.motivo})` : ""}`;
    case "inviato": return `Vulcan: inviato ${quando(v.il)}`;
    case "scartato": return `Vulcan: scartato (${v.motivo ?? "motivo non registrato"})`;
    case "fallito": return `Vulcan: fallito (${v.motivo ?? "motivo non registrato"})`;
    default: return "Vulcan: stato non leggibile";
  }
}

/** Barra del rischio 0-100: la lunghezza dice quanto, il numero è scritto accanto. */
function BarraRischio({ valore }: { valore: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, valore))}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-[13px] font-bold tabular-nums">{valore}</span>
    </div>
  );
}

const CELLA_MATRICE: Record<PrivilegeMembershipKind, { lettera: string; classe: string; testo: string }> = {
  direct: { lettera: "D", classe: "bg-foreground text-background", testo: "D = membro diretto" },
  nested: { lettera: "N", classe: "bg-primary/30 text-foreground", testo: "N = tramite un gruppo annidato" },
  primary: { lettera: "P", classe: "bg-[#FFD400] text-[#0D2537]", testo: "P = gruppo primario" },
};

interface RigaCopertura {
  gruppo: string;
  voce: string;
  tipo: TipoSegno;
  esito: string;
  valore: string;
}

function numero(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("it-IT");
}

function righeCopertura(d: DatiHealth): RigaCopertura[] {
  const righe: RigaCopertura[] = [];
  const letto = (gruppo: string, voce: string, valore: string | null, nota?: string) =>
    righe.push(
      valore == null
        ? { gruppo, voce, tipo: "ignoto", esito: "non letto", valore: nota ?? "—" }
        : { gruppo, voce, tipo: "ok", esito: "letto", valore },
    );
  const conta = (gruppo: string, voce: string, n: number | null | undefined) =>
    letto(gruppo, voce, n == null ? null : numero(n));

  const infra = d.copertura?.infra ?? null;
  if (!infra) {
    righe.push({
      gruppo: "DNS, infrastruttura, Entra",
      voce: "Zone DNS, dSHeuristics, SYSVOL, RODC, dMSA, Entra",
      tipo: "assente",
      esito: "non registrato",
      valore: "Esecuzione precedente alla 0.9.1086: rilancia l'healthcheck",
    });
  } else {
    const z = infra.dnsZones;
    conta("DNS", "Zone DNS integrate in AD", z);
    letto("DNS", "Modo degli aggiornamenti dinamici", z == null || infra.dnsZonesAllowUpdateRead == null ? null : `${infra.dnsZonesAllowUpdateRead} zone su ${z}`);
    letto("DNS", "Delega (ACL) delle zone", z == null || infra.dnsZonesAclRead == null ? null : `${infra.dnsZonesAclRead} zone su ${z}`);
    conta("DNS", "Record jolly (*)", infra.dnsWildcards);
    letto("Infrastruttura", "dSHeuristics", infra.dsHeuristics == null ? null : infra.dsHeuristics === "" ? "vuoto (valori di serie)" : infra.dsHeuristics);
    letto(
      "Infrastruttura",
      "Replica di SYSVOL",
      infra.sysvolReplication == null
        ? null
        : infra.sysvolReplication === "dfsr"
          ? "DFSR"
          : infra.sysvolReplication === "frs"
            ? "FRS (da migrare)"
            : "migrazione a DFSR non conclusa",
    );
    conta("Infrastruttura", "Domain controller di sola lettura (RODC)", infra.rodcs);
    conta("Infrastruttura", "Account di servizio delegati (dMSA)", infra.dmsas);
    conta("Entra", "Account privilegiati con l'ancora di Entra Connect", infra.entraSyncedPrivileged);
  }

  if (d.phase5) {
    conta("Criteri e siti", "GPO", d.phase5.gpoCount);
    conta("Criteri e siti", "Siti", d.phase5.siteCount);
    conta("Criteri e siti", "Subnet dei siti", d.phase5.subnetCount);
    conta("Criteri e siti", "Account di servizio gestiti (gMSA)", d.phase5.gmsaCount);
  }
  if (d.phase6) {
    letto("Certificati e password", "Template di AD CS", d.phase6.adcsStatus === "ok" ? numero(d.phase6.templateCount ?? 0) : null, d.phase6.adcsStatus ?? "—");
    conta("Certificati e password", "Template da verificare per ESC1", d.phase6.esc1Count ?? 0);
    conta("Certificati e password", "Template da verificare per ESC2", d.phase6.esc2Count ?? 0);
    conta("Certificati e password", "Criteri password granulari (PSO)", d.phase6.psoCount);
    conta("Certificati e password", "Oggetti con shadow credentials", d.phase6.shadowCredentialCount ?? 0);
  }
  const laps = d.copertura?.laps ?? null;
  if (laps) {
    letto("Certificati e password", "Schema LAPS", laps.schemaPresent == null ? null : laps.schemaPresent ? "presente" : "assente", "non verificabile con questa utenza");
    righe.push({
      gruppo: "Certificati e password",
      voce: "Password LAPS dei computer",
      tipo: laps.nonVerificabili > 0 ? "ignoto" : "ok",
      esito: laps.nonVerificabili > 0 ? "in parte non letto" : "letto",
      valore: `${laps.validi} valide · ${laps.scaduti} scadute · ${laps.nonImpostati} non impostate · ${laps.nonVerificabili} non verificabili`,
    });
  }

  if (d.acl) {
    const m = d.acl.meta;
    righe.push({
      gruppo: "Permessi (ACL)",
      voce: "Descrittori di sicurezza",
      tipo: m.status === "ok" ? "ok" : m.status === "partial" ? "attenzione" : "ignoto",
      esito: m.status === "ok" ? "letto" : m.status === "partial" ? "parziale" : "non letto",
      valore:
        m.errorMessage ??
        `${numero(m.objectsScanned)} oggetti · ${numero(m.interestingAceCount)} ACE da guardare${m.truncated ? " · elenco troncato" : ""}${m.timedOut ? " · tempo scaduto" : ""}`,
    });
  }

  const w = d.winrm;
  if (w) {
    const g = "Domain controller (WinRM)";
    if (!w.configured || w.status === "skipped") {
      righe.push({ gruppo: g, voce: "Lettura del DC via WinRM", tipo: "assente", esito: "non configurato", valore: "Manca la credenziale WinRM del DC" });
    } else if (w.status !== "ok") {
      righe.push({ gruppo: g, voce: "Lettura del DC via WinRM", tipo: "ignoto", esito: "non letto", valore: w.errorMessage ?? "non disponibile" });
    } else {
      const h = w.hardening ?? {};
      letto(g, "Ultimo aggiornamento installato", w.lastHotfixAt ? quando(w.lastHotfixAt) : null);
      letto(g, "Firma LDAP", h.ldapServerIntegrity == null ? null : h.ldapServerIntegrity >= 2 ? "obbligatoria" : `non obbligatoria (${h.ldapServerIntegrity})`);
      letto(g, "Channel binding LDAP", h.ldapEnforceChannelBinding == null ? null : h.ldapEnforceChannelBinding === 0 ? "disattivato" : `attivo (${h.ldapEnforceChannelBinding})`);
      letto(g, "Firma SMB richiesta", h.smbRequireSecuritySignature == null ? null : h.smbRequireSecuritySignature === 0 ? "no" : "sì");
      letto(g, "Compatibilità NTLM (LmCompatibilityLevel)", h.lmCompatibilityLevel == null ? null : `${h.lmCompatibilityLevel}${h.lmCompatibilityLevel < 3 ? " (consente NTLMv1)" : ""}`);
      letto(g, "WDigest in memoria", h.wdigestUseLogonCredential == null ? null : h.wdigestUseLogonCredential === 1 ? "abilitato" : "disabilitato");
      letto(g, "Print Spooler", h.spoolerRunning == null ? null : h.spoolerRunning ? "in esecuzione" : "fermo");
      conta(g, "Password nelle GPO (cpassword in SYSVOL)", w.cpasswordPaths?.length ?? 0);
    }
  }
  return righe;
}

interface RigaAce {
  chiave: string;
  chi: string;
  chiSid: string;
  cosa: string;
  cosaDn: string;
  tipo: string;
  permesso: string;
  ereditato: boolean | null;
}

function righeGrezze(aces: InterestingAce[]): RigaAce[] {
  return aces.map((a, i) => ({
    chiave: `g-${i}`,
    chi: a.trusteeSam ?? a.trusteeSid,
    chiSid: a.trusteeSid,
    cosa: shortDnName(a.objectDn),
    cosaDn: a.objectDn,
    tipo: OBJECT_KIND_LABEL_IT[a.objectKind],
    permesso: formatRightsIt(a.rights),
    ereditato: null,
  }));
}

const TH = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";
const TD = "px-3 py-2 align-top";

export function HealthActiveDirectory({ integrazione }: { integrazione: IntegrazioneHealth | null }) {
  const [dati, setDati] = useState<DatiHealth>(VUOTO);
  const [caricamento, setCaricamento] = useState(false);
  const [inEsecuzione, setInEsecuzione] = useState(false);
  const [sezione, setSezione] = useState<Sezione>("rilievi");
  const [area, setArea] = useState<HealthAxis | "tutte">("tutte");
  const [filtroStato, setFiltroStato] = useState<FiltroStato>("tutti");
  const [cerca, setCerca] = useState("");
  const [aperto, setAperto] = useState<string | null>(null);
  const [soloAbilitati, setSoloAbilitati] = useState(true);
  const [rischioAcl, setRischioAcl] = useState<AclRiskBucketId | "grezzo" | null>(null);
  const [cercaAcl, setCercaAcl] = useState("");

  const carica = useCallback(async () => {
    if (!integrazione) {
      setDati(VUOTO);
      return;
    }
    setCaricamento(true);
    setAperto(null);
    try {
      const res = await fetch(`/api/ad/healthcheck?integrationId=${integrazione.id}`);
      if (!res.ok) throw new Error("La Health del dominio non si è caricata");
      const d = (await res.json()) as Partial<DatiHealth>;
      setDati({ ...VUOTO, ...d, findings: Array.isArray(d.findings) ? d.findings : [] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
      setDati(VUOTO);
    } finally {
      setCaricamento(false);
    }
  }, [integrazione]);

  useEffect(() => { carica(); }, [carica]);

  const esegui = async () => {
    if (!integrazione) return;
    setInEsecuzione(true);
    try {
      const res = await fetch("/api/ad/healthcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integrazione.id }),
      });
      const data = (await res.json()) as { error?: string; score?: HealthScore };
      if (!res.ok) throw new Error(data.error ?? "Healthcheck non riuscito");
      toast.success(`Healthcheck completato: rischio ${data.score?.global ?? "—"} su 100`);
      await carica();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setInEsecuzione(false);
    }
  };

  const { run, score, privilegeMatrix, acl } = dati;
  const rilievi = useMemo(() => actionableFindings(dati.findings), [dati.findings]);
  const confermati = useMemo(() => rilievi.filter((f) => !daVerificare(f)), [rilievi]);
  const indizi = rilievi.length - confermati.length;
  const perGravita = (sev: string) => confermati.filter((f) => f.severity === sev).length;

  const rilieviVisti = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return rilievi
      .filter((f) => area === "tutte" || f.axis === area)
      .filter((f) => filtroStato === "tutti" || (filtroStato === "verificare") === daVerificare(f))
      .filter((f) => {
        if (!q) return true;
        const g = getRuleGuide(f.ruleId);
        return `${g.titleIt} ${f.ruleId} ${g.why}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (ORDINE_GRAVITA[a.severity] ?? 9) - (ORDINE_GRAVITA[b.severity] ?? 9) || b.points - a.points);
  }, [rilievi, area, filtroStato, cerca]);

  const righeMatrice = privilegeMatrix ? privilegeMatrix.users.filter((u) => (soloAbilitati ? u.enabled : true)) : [];
  const privilegiati = privilegeMatrix ? privilegeMatrix.users.filter((u) => u.enabled).length : null;

  const sintesiAcl = useMemo(() => (acl ? summarizeAclRisk(acl.interestingAces) : null), [acl]);
  const rischioScelto = rischioAcl ?? sintesiAcl?.buckets[0]?.id ?? "grezzo";
  const righeAcl = useMemo<RigaAce[]>(() => {
    if (!acl || !sintesiAcl) return [];
    const tutte =
      rischioScelto === "grezzo"
        ? righeGrezze(acl.interestingAces)
        : (sintesiAcl.buckets.find((b) => b.id === rischioScelto)?.entries ?? []).flatMap((e) =>
            e.targets.map((t, i) => ({
              chiave: `${e.trusteeSid}-${t.objectDn}-${i}`,
              // Senza nome risolto l'etichetta è un SID accorciato («…-0»): meglio il SID intero.
              chi: e.trusteeLabel.startsWith("…") ? e.trusteeSid : e.trusteeLabel,
              chiSid: e.trusteeSid,
              cosa: t.objectLabel,
              cosaDn: t.objectDn,
              tipo: OBJECT_KIND_LABEL_IT[t.objectKind],
              permesso: formatRightsIt(t.rights),
              ereditato: t.inherited,
            })),
          );
    const q = cercaAcl.trim().toLowerCase();
    return q ? tutte.filter((r) => `${r.chi} ${r.cosa} ${r.permesso}`.toLowerCase().includes(q)) : tutte;
  }, [acl, sintesiAcl, rischioScelto, cercaAcl]);

  const copertura = useMemo(() => righeCopertura(dati), [dati]);
  const erroriRaccolta = dati.copertura?.ldapCollectErrors ?? null;
  const nonLetti = copertura.filter((r) => r.tipo !== "ok").length;

  const dettagliBarra = run
    ? [
        `ultima: ${quando(run.finishedAt ?? run.startedAt)}`,
        `esito: ${run.status === "ok" ? "riuscita" : run.status === "error" ? "in errore" : "in corso"}`,
        `motore ${run.engineVersion}`,
        testoVulcan(dati.vulcan),
      ]
    : ["mai eseguito"];

  return (
    <div className="space-y-4">
      <BarraStato
        acceso={Boolean(integrazione?.enabled)}
        titolo="Lettura del dominio via LDAP"
        dettagli={dettagliBarra}
        azioni={
          <>
            <Button onClick={esegui} disabled={inEsecuzione || !integrazione?.enabled} title={integrazione?.enabled ? undefined : "L'integrazione con il dominio è spenta"}>
              {inEsecuzione ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
              Esegui healthcheck
            </Button>
            <Button
              variant="outline"
              onClick={() => run?.id && window.open(`/api/ad/healthcheck/export?runId=${run.id}`, "_blank")}
              disabled={!run?.id || run.status !== "ok" || score == null}
              title={run?.status === "ok" ? undefined : "Serve un'esecuzione riuscita"}
            >
              <Download className="mr-2 h-4 w-4" />
              Esporta JSON
            </Button>
          </>
        }
      />

      {(inEsecuzione || run?.status === "running") && (
        <InCorso titolo="Healthcheck in corso" dettaglio="Dura circa due minuti. Sotto restano i dati dell'ultima esecuzione riuscita." />
      )}
      {run?.status === "error" && !inEsecuzione && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm">
          <Segno tipo="attenzione">ultima esecuzione in errore</Segno>
          <span>{run.errorMessage ?? "Motivo non registrato."}</span>
          <span className="text-muted-foreground">Sotto restano i dati dell&apos;ultima esecuzione riuscita.</span>
        </div>
      )}

      {caricamento ? (
        <SkeletonTable rows={4} columns={4} />
      ) : !score ? (
        <Vuoto
          titolo="Nessun healthcheck eseguito su questo dominio"
          testo="«Esegui healthcheck» legge il dominio in sola lettura via LDAP e impiega circa due minuti."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TesseraNumero titolo="Rischio del dominio" valore={score.global} qualifica="su 100" nota="più alto è peggio; solo i rilievi confermati" />
            <TesseraNumero
              titolo="Da sistemare"
              valore={confermati.length}
              qualifica={`${perGravita("Critical")} critici · ${perGravita("High")} alti`}
              nota="rilievi confermati, nel punteggio"
            />
            <TesseraNumero titolo="Da verificare" valore={indizi} nota="indizi e raccolte incomplete, fuori dal punteggio" />
            <TesseraNumero titolo="Account privilegiati" valore={privilegiati} qualifica="abilitati" nota="in almeno un gruppo amministrativo" />
          </div>

          <SchedePagina<Sezione>
            etichetta="Sezioni della Health AD"
            scelta={sezione}
            onScegli={setSezione}
            voci={[
              { valore: "rilievi", titolo: "Rilievi", descrizione: `${rilievi.length} cose da sistemare o verificare` },
              { valore: "privilegi", titolo: "Privilegi", descrizione: "Chi sta nei gruppi amministrativi" },
              { valore: "permessi", titolo: "Permessi", descrizione: `${numero(acl?.meta.interestingAceCount)} ACE pericolose, per tipo di rischio` },
              { valore: "copertura", titolo: "Copertura", descrizione: nonLetti > 0 ? `${nonLetti} voci non lette su ${copertura.length}` : "Cosa è stato letto dal dominio" },
            ]}
          />

          {sezione === "rilievi" && (
            <div className="grid gap-4 lg:grid-cols-12">
              <Pannello numero={1} titolo="Aree" sottotitolo="Scegli un'area per filtrare i rilievi" className="lg:col-span-3" corpoClassName="space-y-2 p-3">
                <VoceSelezionabile scelta={area === "tutte"} onScegli={() => setArea("tutte")}>
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    Tutte le aree
                    <span className="font-mono text-[13px] text-muted-foreground">{rilievi.length}</span>
                  </div>
                  <div className="mt-2"><BarraRischio valore={score.global} /></div>
                </VoceSelezionabile>
                {AREE.map((a) => (
                  <VoceSelezionabile key={a} scelta={area === a} onScegli={() => setArea(a)}>
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      {AXIS_LABEL_IT[a]}
                      <span className="font-mono text-[13px] text-muted-foreground">{rilievi.filter((f) => f.axis === a).length}</span>
                    </div>
                    <div className="mt-2"><BarraRischio valore={score[a as keyof HealthScore]} /></div>
                  </VoceSelezionabile>
                ))}
                <p className="pt-1 text-[13px] text-muted-foreground">La barra è il rischio dell&apos;area da 0 a 100.</p>
              </Pannello>

              <Pannello
                numero={2}
                titolo="Rilievi"
                conteggio={rilieviVisti.length}
                sottotitolo={area === "tutte" ? "Clic su una riga: perché conta, cosa fare, oggetti coinvolti" : AXIS_LABEL_IT[area]}
                className="lg:col-span-9"
                corpoClassName="p-0"
                azioni={
                  <>
                    {(
                      [
                        ["tutti", "Tutti"],
                        ["confermati", "Confermati"],
                        ["verificare", "Da verificare"],
                      ] as const
                    ).map(([v, t]) => (
                      <Button key={v} size="sm" variant={filtroStato === v ? "default" : "outline"} onClick={() => setFiltroStato(v)}>
                        {t}
                      </Button>
                    ))}
                    <Input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca titolo o sigla della regola" className="h-8 w-56 sm:w-64" />
                  </>
                }
                piede={
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <LegendaGravita />
                    <span className="flex items-center gap-2"><Segno tipo="ok">confermato</Segno> conta nel punteggio</span>
                    <span className="flex items-center gap-2"><Segno tipo="ignoto">da verificare</Segno> indizio o raccolta incompleta</span>
                  </div>
                }
              >
                {rilieviVisti.length === 0 ? (
                  <div className="p-3">
                    <Vuoto titolo="Nessun rilievo con questi filtri" testo="Togli il filtro dell'area, dello stato o la ricerca." />
                  </div>
                ) : (
                  <div className="max-h-[640px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 border-b bg-muted">
                        <tr>
                          <th className={cn(TH, "w-8")} />
                          <th className={TH}>Rilievo</th>
                          <th className={TH}>Gravità</th>
                          <th className={TH}>Stato</th>
                          <th className={cn(TH, "text-right")}>Oggetti</th>
                          <th className={cn(TH, "text-right")}>Punti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rilieviVisti.map((f) => {
                          const guida = getRuleGuide(f.ruleId);
                          const aperta = aperto === f.ruleId;
                          return [
                            <tr
                              key={f.ruleId}
                              className={cn("cursor-pointer border-b hover:bg-muted/40", aperta && "bg-selezione")}
                              onClick={() => setAperto(aperta ? null : f.ruleId)}
                            >
                              <td className={cn(TD, "text-muted-foreground")}>
                                {aperta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </td>
                              <td className={TD}>
                                <div className="font-semibold">{guida.titleIt}</div>
                                <div className="font-mono text-[13px] text-muted-foreground">
                                  {f.ruleId}
                                  {area === "tutte" && ` · ${AXIS_LABEL_IT[f.axis] ?? f.axis}`}
                                </div>
                              </td>
                              <td className={TD}><BadgeGravita gravita={f.severity} /></td>
                              <td className={TD}>
                                {daVerificare(f) ? <Segno tipo="ignoto">da verificare</Segno> : <Segno tipo="ok">confermato</Segno>}
                              </td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{f.objectCount > 0 ? f.objectCount : "—"}</td>
                              <td className={cn(TD, "text-right font-mono tabular-nums")}>{f.points > 0 ? f.points : "—"}</td>
                            </tr>,
                            aperta && (
                              <tr key={`${f.ruleId}-dettaglio`} className="border-b bg-muted/30">
                                <td />
                                <td colSpan={5} className="space-y-2 px-3 py-3">
                                  <p><span className="font-semibold">Perché conta: </span>{guida.why}</p>
                                  <p><span className="font-semibold">Cosa fare: </span>{guida.fix}</p>
                                  {f.description && <p className="text-[13px] text-muted-foreground"><span className="font-semibold">Dal motore: </span>{f.description}</p>}
                                  {f.sampleDns.length > 0 ? (
                                    <div>
                                      <p className="text-[13px] font-semibold">
                                        Oggetti coinvolti: {f.sampleDns.length}
                                        {f.objectCount > f.sampleDns.length ? ` mostrati su ${f.objectCount}` : ""}
                                      </p>
                                      <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-[13px]">
                                        {f.sampleDns.map((dn) => (
                                          <li key={dn} className="truncate" title={dn}>
                                            <span className="font-semibold">{shortDnName(dn)}</span>
                                            <span className="ml-2 font-mono text-muted-foreground">{dn}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : (
                                    <p className="text-[13px] text-muted-foreground">Riguarda il dominio o la sua configurazione, non singoli oggetti.</p>
                                  )}
                                </td>
                              </tr>
                            ),
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Pannello>
            </div>
          )}

          {sezione === "privilegi" &&
            (privilegeMatrix ? (
              <Pannello
                titolo="Matrice dei privilegi"
                conteggio={righeMatrice.length}
                sottotitolo="Una riga per utente, una colonna per gruppo amministrativo; sotto il nome del gruppo, i suoi membri abilitati"
                corpoClassName="p-0"
                azioni={
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={soloAbilitati} onCheckedChange={(v) => setSoloAbilitati(v === true)} />
                    Solo account abilitati
                  </label>
                }
                piede={
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <Legenda voci={Object.values(CELLA_MATRICE).map((c) => ({ classe: c.classe, testo: c.testo }))} />
                    <span>· = non è membro. Passa il mouse su una cella per la catena dei gruppi.</span>
                    {privilegeMatrix.truncated && <Segno tipo="attenzione">matrice troncata ai primi 500 utenti</Segno>}
                  </div>
                }
              >
                {righeMatrice.length === 0 ? (
                  <div className="p-3">
                    <Vuoto titolo="Nessun utente nei gruppi amministrativi" testo="Con «Solo account abilitati» spento si vedono anche i disabilitati." />
                  </div>
                ) : (
                  <div className="max-h-[640px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-20 border-b bg-muted">
                        <tr>
                          <th className={cn(TH, "sticky left-0 z-10 min-w-[160px] bg-muted")}>Utente</th>
                          {privilegeMatrix.groups.map((g) => (
                            <th key={g.key} className={cn(TH, "text-center", !g.found && "opacity-50")} title={g.found ? g.displayName : `${g.displayName}: gruppo non trovato`}>
                              <div className="whitespace-nowrap text-foreground">{g.displayName.replace("Group Policy Creator Owners", "GPO Creators")}</div>
                              <div className="font-mono font-normal">{g.memberCount}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {righeMatrice.map((u) => (
                          <tr key={u.dn} className="border-b">
                            <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-mono font-semibold" title={u.dn}>
                              <span className={u.enabled ? "" : "text-muted-foreground line-through"}>{u.sam}</span>
                            </td>
                            {privilegeMatrix.groups.map((g) => {
                              const tipo = u.cells[g.key] ?? null;
                              const catena = u.paths?.[g.key];
                              const cella = tipo ? CELLA_MATRICE[tipo] : null;
                              return (
                                <td key={g.key} className="px-1 py-1 text-center" title={cella ? `${g.displayName}: ${cella.testo.slice(4)}${catena?.length ? ` via ${catena.join(" → ")}` : ""}` : undefined}>
                                  {cella ? (
                                    <span className={cn("inline-flex h-6 w-7 items-center justify-center rounded-md font-mono text-[13px] font-bold", cella.classe)}>{cella.lettera}</span>
                                  ) : (
                                    <span className="text-muted-foreground/50">·</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Pannello>
            ) : (
              <Vuoto titolo="Matrice dei privilegi non disponibile" testo="L'ultima esecuzione riuscita non l'ha registrata: rilancia l'healthcheck." />
            ))}

          {sezione === "permessi" &&
            (acl && sintesiAcl ? (
              <div className="grid gap-4 lg:grid-cols-12">
                <Pannello
                  numero={1}
                  titolo="Tipi di rischio"
                  conteggio={sintesiAcl.buckets.length}
                  sottotitolo="Scegli un tipo per vedere chi e su cosa"
                  className="lg:col-span-4"
                  corpoClassName="space-y-2 p-3"
                  piede={
                    <span className="flex flex-wrap items-center gap-2">
                      Raccolta:
                      {acl.meta.status === "ok" ? <Segno tipo="ok">completa</Segno> : acl.meta.status === "partial" ? <Segno tipo="attenzione">parziale</Segno> : <Segno tipo="ignoto">non disponibile</Segno>}
                      <span className="font-mono">{numero(acl.meta.objectsScanned)} oggetti letti</span>
                    </span>
                  }
                >
                  {sintesiAcl.buckets.map((b) => (
                    <VoceSelezionabile key={b.id} scelta={rischioScelto === b.id} onScegli={() => setRischioAcl(b.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{b.title}</span>
                        <BadgeGravita gravita={b.severity === "critical" ? "Critical" : b.severity === "high" ? "High" : "Medium"} />
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">{b.why}</p>
                      <p className="mt-1.5 font-mono text-[13px]">
                        {b.uniqueTrustees} attori · {b.uniqueTargets} oggetti · {b.aceCount} ACE
                      </p>
                    </VoceSelezionabile>
                  ))}
                  <VoceSelezionabile scelta={rischioScelto === "grezzo"} onScegli={() => setRischioAcl("grezzo")}>
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      Elenco grezzo
                      <span className="font-mono text-[13px] text-muted-foreground">{acl.interestingAces.length}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">Tutte le ACE raccolte, senza raggruppare.</p>
                  </VoceSelezionabile>
                </Pannello>

                <Pannello
                  numero={2}
                  titolo="Chi può fare cosa"
                  conteggio={righeAcl.length}
                  sottotitolo={rischioScelto === "grezzo" ? "Elenco grezzo" : sintesiAcl.buckets.find((b) => b.id === rischioScelto)?.title}
                  className="lg:col-span-8"
                  corpoClassName="p-0"
                  azioni={<Input value={cercaAcl} onChange={(e) => setCercaAcl(e.target.value)} placeholder="Cerca attore, oggetto o permesso" className="h-8 w-56 sm:w-64" />}
                >
                  {righeAcl.length === 0 ? (
                    <div className="p-3"><Vuoto titolo="Nessuna ACE con questi filtri" testo="Cambia il tipo di rischio o togli la ricerca." /></div>
                  ) : (
                    <div className="max-h-[640px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 border-b bg-muted">
                          <tr>
                            <th className={TH}>Chi</th>
                            <th className={TH}>Su cosa</th>
                            <th className={TH}>Permesso</th>
                            <th className={TH}>Origine</th>
                          </tr>
                        </thead>
                        <tbody>
                          {righeAcl.slice(0, 500).map((r) => (
                            <tr key={r.chiave} className="border-b">
                              <td className={cn(TD, "font-semibold")} title={r.chiSid}>{r.chi}</td>
                              <td className={TD} title={r.cosaDn}>
                                {r.cosa} <Etichetta mono={false} className="ml-1">{r.tipo}</Etichetta>
                              </td>
                              <td className={TD}>{r.permesso}</td>
                              <td className={cn(TD, "text-[13px] text-muted-foreground")}>{r.ereditato == null ? "—" : r.ereditato ? "ereditato" : "diretto"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {righeAcl.length > 500 && <p className="px-3 py-2 text-[13px] text-muted-foreground">Mostrate le prime 500 righe su {righeAcl.length}: restringi con la ricerca.</p>}
                    </div>
                  )}
                </Pannello>
              </div>
            ) : (
              <Vuoto titolo="Permessi non letti" testo="L'ultima esecuzione riuscita non ha raccolto i descrittori di sicurezza: rilancia l'healthcheck." />
            ))}

          {sezione === "copertura" && (
            <Pannello
              titolo="Cosa è stato letto"
              conteggio={copertura.length}
              sottotitolo="Una regola che non scatta vale solo se il suo dato è «letto»"
              corpoClassName="p-0"
              piede="Regole Domarc su dati LDAP in sola lettura: non è PingCastle e non lo sostituisce."
            >
              {erroriRaccolta && erroriRaccolta.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 text-sm">
                  <Segno tipo="attenzione">{erroriRaccolta.length} ricerche LDAP fallite</Segno>
                  <span className="font-mono text-[13px]">{erroriRaccolta.join(" · ")}</span>
                </div>
              )}
              <table className="w-full text-sm">
                <thead className="border-b bg-muted">
                  <tr>
                    <th className={TH}>Fonte</th>
                    <th className={TH}>Dato</th>
                    <th className={TH}>Esito</th>
                    <th className={TH}>Valore</th>
                  </tr>
                </thead>
                <tbody>
                  {copertura.map((r, i) => (
                    <tr key={`${r.gruppo}-${r.voce}`} className="border-b">
                      <td className={cn(TD, "text-[13px] font-semibold text-cian-testo")}>{copertura[i - 1]?.gruppo === r.gruppo ? "" : r.gruppo}</td>
                      <td className={TD}>{r.voce}</td>
                      <td className={TD}><Segno tipo={r.tipo}>{r.esito}</Segno></td>
                      <td className={cn(TD, "font-mono")}>{r.valore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Pannello>
          )}
        </>
      )}
    </div>
  );
}
