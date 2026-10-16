/**
 * Regole sulla audit policy del Domain Controller.
 *
 * Rispondono alla domanda che l'assenza di eventi nel SIEM lascia aperta:
 * "non e' successo nulla" oppure "non lo stiamo registrando"?
 */

import type { RuleDef } from "../types";
import { aggFinding } from "./helpers";

/**
 * Sotto questa soglia i fallimenti sono fisiologici (password digitate male,
 * sessioni scadute) e segnalarli sarebbe solo rumore.
 */
export const BRUTE_FORCE_MIN_OCCURRENCES = 50;

export const auditRules: RuleDef[] = [
  {
    id: "DA-A-AuditPolicyGaps",
    axis: "anomaly",
    points: 25,
    title: "Audit policy del DC incompleta",
    run(ctx) {
      const w = ctx.winrm;
      if (!w || w.status !== "ok") return null;
      const gaps = w.auditGaps;
      // null = auditpol non letto: tacere, non dedurre
      if (gaps == null || gaps.length === 0) return null;

      const lostEvents = [...new Set(gaps.flatMap((g) => g.eventIds))].sort();
      return aggFinding({
        ruleId: "DA-A-AuditPolicyGaps",
        axis: "anomaly",
        points: 25,
        title: "Audit policy del DC incompleta",
        description:
          `${gaps.length} sottocategoria/e di audit non registrano quanto serve: ` +
          gaps.map((g) => `${g.labelIt} (${g.current})`).join("; ") +
          `. Event ID che non arriveranno mai al SIEM: ${lostEvents.join(", ")}.`,
        dns: gaps.map((g) => g.labelIt),
        raw: { gaps },
      });
    },
  },
  {
    id: "DA-A-BruteForceActivity",
    axis: "anomaly",
    points: 25,
    title: "Tentativi di autenticazione falliti in corso",
    run(ctx) {
      const w = ctx.wazuh;
      if (!w || !w.available) return null;
      if (w.authFailureOccurrences < BRUTE_FORCE_MIN_OCCURRENCES) return null;

      // Quali bersagli sono account di dominio realmente esistenti e abilitati
      const enabledSams = new Set(
        ctx.users.filter((u) => u.enabled).map((u) => u.samAccountName.toLowerCase()),
      );
      const named = w.authFailureTargets.filter((t) => t.targetUser);
      const realAccounts = named.filter((t) =>
        enabledSams.has((t.targetUser ?? "").toLowerCase()),
      );

      const top = named
        .slice(0, 5)
        .map((t) => `${t.targetUser} (${t.occurrences})`)
        .join(", ");

      return aggFinding({
        ruleId: "DA-A-BruteForceActivity",
        axis: "anomaly",
        points: 25,
        title: "Tentativi di autenticazione falliti in corso",
        description:
          `${w.authFailureOccurrences} tentativi di autenticazione falliti negli ultimi ` +
          `${w.windowDays} giorni (fonte: alert Wazuh).` +
          (top ? ` Account piu' bersagliati: ${top}.` : "") +
          (realAccounts.length > 0
            ? ` ${realAccounts.length} di questi corrispondono ad account di dominio abilitati.`
            : ""),
        dns: named.map((t) => t.targetUser as string),
        raw: {
          windowDays: w.windowDays,
          occurrences: w.authFailureOccurrences,
          targets: w.authFailureTargets,
          lockoutOccurrences: w.lockoutOccurrences,
        },
      });
    },
  },
];
