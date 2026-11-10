/**
 * «Sicurezza del dominio» e «Health Active Directory» in una voce sola, su tutte le installazioni
 * (Riccardo, 08/11/2026: «i due menù … dovrebbero essere collassati, mantenendo le informazioni»).
 * La pagina /sicurezza-dominio ha due schede: «Eventi dei DC» e «Health AD».
 *
 * Cade se una sezione delle due pagine di prima sparisce dalla pagina unita, se torna la voce doppia
 * nel menu, o se il vecchio indirizzo /active-directory?tab=health non porta più alla scheda nuova.
 *
 * Run: node --import tsx --test src/lib/menu/__tests__/sicurezza-dominio-unita.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indirizzoHealthSpostata, schedaSicurezzaDominio } from "../sicurezza-dominio";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Le sezioni delle due pagine di prima, coi titoli come si leggono a schermo.
const SEZIONI_EVENTI = [
  "Lettura dei domain controller", "Leggi i DC adesso", "Come configurare i DC",
  "\"Login\"", "\"Accessi falliti\"", "\"Account bloccati\"", "\"Modifiche\"", "\"Attacchi e malware\"",
  "Allarmi nel tempo", "\"Domain controller\"", "\"Eventi\"",
];
const SEZIONI_HEALTH = [
  // Dal 10/11/2026 la Health è rifatta in quattro sezioni (Rilievi, Privilegi, Permessi, Copertura):
  // topologia, ADCS e probe dei DC stanno in «Cosa è stato letto».
  "non è PingCastle", "/api/ad/healthcheck/export", "testoVulcan",
  "titolo=\"Rilievi\"", "Matrice dei privilegi", "Chi può fare cosa", "Cosa è stato letto", "BarraRischio",
];

test("la pagina unita porta tutte le sezioni di «Sicurezza del dominio» e della Health AD", () => {
  const unita = [
    "src/app/(dashboard)/sicurezza-dominio/page.tsx",
    "src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-schede.tsx",
    "src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-client.tsx",
    "src/components/ad/health-active-directory.tsx",
  ].map(src).join("\n");
  for (const s of [...SEZIONI_EVENTI, ...SEZIONI_HEALTH]) assert.ok(unita.includes(s), `manca: ${s}`);
  assert.ok(src("src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-schede.tsx").includes("<HealthActiveDirectory"));
});

test("nel menu una voce sola: niente più «Health Active Directory»", () => {
  const menu = src("src/components/shared/sidebar.tsx");
  assert.ok(!menu.includes("Health Active Directory\""), "la voce doppia è tornata");
  assert.ok(menu.includes("href: \"/sicurezza-dominio\""));
});

test("il vecchio indirizzo della Health porta alla scheda nuova; le altre schede di AD restano", () => {
  assert.equal(indirizzoHealthSpostata("health"), "/sicurezza-dominio?tab=health");
  for (const t of [null, "computers", "users", "groups", "dhcp"]) assert.equal(indirizzoHealthSpostata(t), null);
});

test("la scheda della pagina unita viene dall'indirizzo, di base gli eventi", () => {
  assert.equal(schedaSicurezzaDominio("health"), "health");
  assert.equal(schedaSicurezzaDominio("eventi"), "eventi");
  assert.equal(schedaSicurezzaDominio(null), "eventi");
  assert.equal(schedaSicurezzaDominio("boh"), "eventi");
});
