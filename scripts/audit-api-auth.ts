/**
 * audit-api-auth.ts — matrice delle guardie di tutte le rotte API.
 *
 * Nato nella «Wave 0» (W0-1) come analisi testuale; dal 12/10 (T3-24) usa lo
 * stesso rilevatore e lo stesso censimento della prova
 * `src/lib/permessi/__tests__/rotte-censite.test.ts`, così la matrice e il
 * cancello non possono dire due cose diverse. Il rilevatore legge l'albero
 * sintattico e vede tutte le forme di export (anche `export { handle as GET }`
 * dei proxy, che l'audit vecchio non contava).
 *
 * Per ogni gestore: guardia vista, livello atteso, esito (ok · eccezione ·
 * debito · scoperto). Eccezioni e debiti stanno in `src/lib/permessi/rotte.ts`.
 *
 * Uso:  npx tsx scripts/audit-api-auth.ts [uscita.md]
 *       senza argomento stampa solo il riepilogo; con un percorso scrive lì la
 *       matrice (per rigenerare quella del repo: `docs/auth-matrix.md`).
 *       AUDIT_STAMP=YYYY-MM-DD data la matrice.
 * Esce con 1 se il censimento ha problemi (gli stessi che fanno fallire la prova).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { censisci, consentitiDaAuthConfig, gestoriDellAlbero, type Valutazione } from "../src/lib/permessi/rotte";
import { ORDINE_GUARDIE } from "../src/lib/permessi/rilevatore-guardie";

const ROOT = process.cwd();
const uscita = process.argv[2] ? resolve(ROOT, process.argv[2]) : null;

const { file, gestori } = gestoriDellAlbero(ROOT);
const consentiti = consentitiDaAuthConfig(readFileSync(resolve(ROOT, "src/lib/auth.config.ts"), "utf8"));
const { valutazioni, problemi } = censisci(gestori, consentiti);

const per = (esito: Valutazione["esito"]) => valutazioni.filter((v) => v.esito === esito);
const forme = new Map<string, number>();
for (const g of gestori) forme.set(g.forma, (forme.get(g.forma) ?? 0) + 1);
const guardie = ORDINE_GUARDIE.map((g) => `\`${g}\`=${gestori.filter((x) => x.guardia === g).length}`).join(" · ");

const riepilogo = [
  `file route.ts: ${file} · gestori: ${gestori.length} (${[...forme].map(([f, n]) => `${f} ${n}`).join(", ")})`,
  `guardie: ${guardie.replace(/`/g, "")}`,
  `ok ${per("ok").length} · eccezioni ${per("eccezione").length} · debiti ${per("debito").length} · scoperti ${per("scoperto").length}`,
  `problemi del censimento: ${problemi.length}`,
];

if (uscita) {
  const stamp = process.env.AUDIT_STAMP || "(esegui con AUDIT_STAMP=YYYY-MM-DD per datare)";
  const righe: string[] = [];
  righe.push("# Matrice auth API — DA-IPAM", "");
  righe.push(
    `> Generato da \`scripts/audit-api-auth.ts\` · ${stamp} · rilevatore e censimento di \`src/lib/permessi/\` (gli stessi della prova \`rotte-censite.test.ts\`).`,
    "",
  );
  righe.push("## Riepilogo", "");
  righe.push(`- File \`route.ts\`: **${file}** · gestori (metodo × rotta): **${gestori.length}**`);
  righe.push(`- Forme di export: ${[...forme].map(([f, n]) => `${f} ${n}`).join(" · ")}`);
  righe.push(`- Guardie viste: ${guardie}`);
  righe.push(
    `- Esiti: ok **${per("ok").length}** · eccezioni **${per("eccezione").length}** · debiti **${per("debito").length}** · scoperti **${per("scoperto").length}**`,
  );
  righe.push("");
  righe.push(
    "Livello atteso: GET/HEAD/OPTIONS → `auth`; scritture → `admin`; letture col nome sensibile → `admin`; i livelli dichiarati stanno in `ATTESI` di `src/lib/permessi/rotte.ts`. `withTenantFromSession` (`sessione`) chiede l'accesso ma non il ruolo: per una lettura vale quanto `auth`.",
    "",
  );
  if (problemi.length) {
    righe.push("## Problemi del censimento", "");
    for (const p of problemi) righe.push(`- ${p}`);
    righe.push("");
  }
  const tabella = (titolo: string, elenco: Valutazione[]) => {
    righe.push(`## ${titolo}`, "", "| Rotta | Metodo | Guardia | Attesa | Nota |", "|---|---|---|---|---|");
    for (const v of elenco) righe.push(`| \`${v.rotta}\` | ${v.metodo} | \`${v.guardia}\` | \`${v.atteso}\` | ${v.nota} |`);
    if (elenco.length === 0) righe.push("| — | — | — | — | nessuna |");
    righe.push("");
  };
  tabella("Debiti (guardie da alzare)", per("debito"));
  tabella("Scoperti", per("scoperto"));
  tabella("Eccezioni dichiarate", per("eccezione"));
  const ordinate = [...valutazioni].sort((a, b) => a.rotta.localeCompare(b.rotta) || a.metodo.localeCompare(b.metodo));
  tabella("Inventario completo", ordinate);
  mkdirSync(dirname(uscita), { recursive: true });
  writeFileSync(uscita, righe.join("\n"), "utf8");
  riepilogo.push(`→ scritto ${relative(ROOT, uscita)}`);
}

process.stdout.write(riepilogo.join("\n") + "\n");
if (problemi.length) {
  process.stdout.write(problemi.map((p) => `  - ${p}`).join("\n") + "\n");
  process.exitCode = 1;
}
