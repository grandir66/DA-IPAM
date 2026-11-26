#!/usr/bin/env node
/**
 * Schermate del manuale per pagina (Riccardo, 26/11/2026: «acquisisci le schermate che servono in autonomia»).
 *
 * Per ogni guida `docs/manuale/pagine/<nome>.md` che ha accanto `<nome>.schermate.json`, apre le pagine su un IPAM vero
 * con un'utenza in sola lettura e salva i PNG in `public/manuale/<nome>/`. Si rifà una pagina sola:
 *
 *   node scripts/manuale/schermate.cjs discovery            # solo la guida «discovery»
 *   node scripts/manuale/schermate.cjs                      # tutte
 *
 * Il repo è pubblico: prima di ogni scatto gli IPv4 e i MAC a schermo diventano finti (stessa rete → stessa rete
 * finta, l'ultimo numero resta, così si capisce ancora chi sta con chi). I nomi restano (ok di Riccardo, 26/11).
 *
 * <nome>.schermate.json è un elenco di scatti:
 *   [{ "file": "elenco", "percorso": "/discovery", "intera": false, "altezza": 900,
 *      "prima": [{ "clic": "text=Raggruppa per" }, { "attesa": 800 }],
 *      "segni": [{ "n": 1, "cerca": "text=Raggruppa per" }],
 *      "zona": "main" }]
 * `cerca` e `clic` sono selettori di Playwright; `zona` ritaglia lo scatto su un elemento; `segni` mette un cerchio
 * numerato sull'angolo dell'elemento, da citare nel testo come ①②③; in `prima` ci sono anche `destro` (clic col tasto
 * destro), `sopra` (il mouse passa sopra) e `tasto` (un tasto premuto); `dopo` sono clic fatti dopo lo scatto per
 * rimettere com'era quello che il browser ricorda (il menu compresso); `ritaglio` è un elenco di selettori e lo
 * scatto prende solo il rettangolo che li contiene (più `margine`, 16 px), per mostrare la sola zona descritta; `nascondi` è un elenco di selettori CSS da
 * sfocare (colonne con nomi di persone: assegnatari, utenti di Active Directory, accessi).
 *
 * Ambiente: IPAM_URL (predefinito https://192.168.4.8), IPAM_UTENZA (file con righe `utente=` e `password=`,
 * predefinito ~/.config/da-ipam/hub-utenza-prova.txt, mai nel repo), PLAYWRIGHT_CORE (percorso del pacchetto se non
 * è installato qui), CHROME (eseguibile del browser).
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const RADICE = path.resolve(__dirname, "..", "..");
const GUIDE = path.join(RADICE, "docs", "manuale", "pagine");
const USCITA = path.join(RADICE, "public", "manuale");
const URL_BASE = (process.env.IPAM_URL || "https://192.168.4.8").replace(/\/+$/, "");
const UTENZA = process.env.IPAM_UTENZA || path.join(os.homedir(), ".config", "da-ipam", "hub-utenza-prova.txt");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function caricaPlaywright() {
  const candidati = [process.env.PLAYWRIGHT_CORE, "playwright-core", path.join(os.homedir(), "Progetti", "Integra3cx", "node_modules", "playwright-core")].filter(Boolean);
  for (const c of candidati) {
    try { return require(c); } catch { /* il prossimo */ }
  }
  console.error("✕ playwright-core non trovato: indica il percorso con PLAYWRIGHT_CORE.");
  process.exit(2);
}

function leggiUtenza() {
  let testo;
  try { testo = fs.readFileSync(UTENZA, "utf-8"); } catch {
    console.error(`✕ Manca il file dell'utenza (${UTENZA}).`);
    process.exit(2);
  }
  const campo = (k) => (testo.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
  const utente = campo("utente"), password = campo("password");
  if (!utente || !password) { console.error("✕ Il file dell'utenza non ha utente= e password=."); process.exit(2); }
  return { utente, password };
}

/** Gira nella pagina: IPv4 e MAC finti, coerenti fra loro dentro lo stesso scatto e fra uno scatto e l'altro. */
function mascheraNellaPagina(reti) {
  const mappa = new Map(Object.entries(reti));
  const reteFinta = (r) => {
    if (!mappa.has(r)) mappa.set(r, `10.${20 + Math.floor(mappa.size / 250)}.${(mappa.size % 250) + 1}`);
    return mappa.get(r);
  };
  // Quattro numeri da soli, non un pezzo di un identificativo SNMP (1.3.6.1.4.1…): prima e dopo non c'è «.cifra».
  const ip = /(?<!\d\.)\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b(?!\.\d)/g;
  const mac = /\b([0-9A-Fa-f]{2})([:-])([0-9A-Fa-f]{2})\2([0-9A-Fa-f]{2})\2([0-9A-Fa-f]{2})\2([0-9A-Fa-f]{2})\2([0-9A-Fa-f]{2})\b/g;
  const email = /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g;
  // I nomi dei portatili e dei PC portano spesso il cognome di chi li usa (NB-ROSSI): si tiene il prefisso.
  const pcPersona = /\b(NB|PC|LT|NOTEBOOK|LAPTOP|DESKTOP|WS)-([A-Za-z][A-Za-z.]{2,})\b/g;
  const sostituisci = (s) => s
    .replace(email, "utente@esempio.it")
    .replace(pcPersona, (tutto, pre, nome) => (/^[A-Z0-9]{6,}$/.test(nome) && /\d/.test(nome) ? tutto : `${pre}-UTENTE`))
    .replace(ip, (tutto, a, b, c, d) => {
      const n = [a, b, c, d].map(Number);
      if (n.some((x) => x > 255) || n[0] === 0 || n[0] === 255 || n[0] === 127) return tutto;
      return `${reteFinta(`${a}.${b}.${c}`)}.${d}`;
    })
    .replace(mac, (tutto, a, sep, b, c, d, e, f) => `02${sep}00${sep}5E${sep}${d}${sep}${e}${sep}${f}`.toUpperCase());
  const giro = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = giro.nextNode(); n; n = giro.nextNode()) {
    const nuovo = sostituisci(n.nodeValue || "");
    if (nuovo !== n.nodeValue) n.nodeValue = nuovo;
  }
  for (const el of document.querySelectorAll("input, textarea")) {
    if (el.value) el.value = sostituisci(el.value);
    if (el.placeholder) el.placeholder = sostituisci(el.placeholder);
  }
  for (const el of document.querySelectorAll("[title]")) el.title = sostituisci(el.title);
  return Object.fromEntries(mappa);
}

function segno({ n, box }) {
  const d = document.createElement("div");
  d.textContent = String(n);
  d.setAttribute("data-segno-manuale", "");
  Object.assign(d.style, {
    position: "absolute", left: `${Math.max(0, box.x + window.scrollX - 12)}px`, top: `${Math.max(0, box.y + window.scrollY - 12)}px`,
    width: "26px", height: "26px", borderRadius: "50%", background: "#FFD400", color: "#0D2537", border: "2px solid #0D2537",
    font: "700 15px/22px Signika, sans-serif", textAlign: "center", zIndex: "2147483647", pointerEvents: "none",
  });
  document.body.appendChild(d);
}

async function main() {
  const solo = process.argv[2];
  const elenchi = fs.readdirSync(GUIDE).filter((f) => f.endsWith(".schermate.json"))
    .map((f) => f.replace(/\.schermate\.json$/, ""))
    .filter((n) => !solo || n === solo);
  if (elenchi.length === 0) { console.error(solo ? `✕ Nessun ${solo}.schermate.json` : "✕ Nessuna guida con schermate."); process.exit(1); }

  const { chromium } = caricaPlaywright();
  const { utente, password } = leggiUtenza();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "it-IT", timezoneId: "Europe/Rome" });
  const page = await ctx.newPage();
  await page.goto(`${URL_BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#username", utente);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.press("#password", "Enter")]);

  let reti = {};
  let errori = 0;
  for (const nome of elenchi) {
    let scatti;
    try { scatti = JSON.parse(fs.readFileSync(path.join(GUIDE, `${nome}.schermate.json`), "utf-8")); } catch (e) {
      console.error(`✕ ${nome}: elenco illeggibile (${e.message})`); errori++; continue;
    }
    fs.mkdirSync(path.join(USCITA, nome), { recursive: true });
    for (const s of scatti) {
      const destinazione = path.join(USCITA, nome, `${s.file}.png`);
      try {
        await page.setViewportSize({ width: s.larghezza || 1440, height: s.altezza || 900 });
        await page.goto(`${URL_BASE}${s.percorso}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(s.attesa ?? 1200);
        for (const p of s.prima || []) {
          if (p.clic) await page.locator(p.clic).first().click({ timeout: 10000 });
          if (p.destro) await page.locator(p.destro).first().click({ button: "right", timeout: 10000 });
          if (p.sopra) await page.locator(p.sopra).first().hover({ timeout: 10000 });
          if (p.tasto) await page.keyboard.press(p.tasto);
          if (p.scrivi) await page.locator(p.scrivi.in).first().fill(p.scrivi.testo);
          await page.waitForTimeout(p.attesa ?? 600);
        }
        // Il «?» del manuale, la fascia «Nuova versione disponibile» e gli avvisi a comparsa non servono nelle schermate.
        await page.addStyleTag({ content: "[aria-label='Manuale di questa pagina']{visibility:hidden!important} div.fixed.top-0.left-0.right-0.z-50,[data-sonner-toaster]{display:none!important}" });
        reti = await page.evaluate(mascheraNellaPagina, reti);
        if (s.nascondi?.length) await page.addStyleTag({ content: `${s.nascondi.join(",")}{filter:blur(5px)!important}` });
        for (const g of s.segni || []) {
          const box = await page.locator(g.cerca).first().boundingBox({ timeout: 5000 }).catch(() => null);
          if (box) await page.evaluate(segno, { n: g.n, box });
          else console.error(`  ▲ ${nome}/${s.file}: segno ${g.n} non trovato (${g.cerca})`);
        }
        if (s.ritaglio?.length) {
          // Solo la parte di schermo che il testo descrive (Riccardo, 26/11: «solo la zona, non tutta la schermata»):
          // il rettangolo che contiene tutti gli elementi indicati, più un margine per i cerchi numerati.
          const margine = s.margine ?? 16;
          const { sx, sy, larga } = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, larga: document.documentElement.clientWidth }));
          const scatole = [];
          for (const sel of s.ritaglio) {
            const b = await page.locator(sel).first().boundingBox({ timeout: 5000 }).catch(() => null);
            if (b) scatole.push(b); else console.error(`  ▲ ${nome}/${s.file}: ritaglio, non trovo ${sel}`);
          }
          if (!scatole.length) throw new Error("nessun elemento del ritaglio trovato");
          const x0 = Math.max(0, Math.min(...scatole.map((b) => b.x)) - margine + sx);
          const y0 = Math.max(0, Math.min(...scatole.map((b) => b.y)) - margine + sy);
          // Una tabella più larga dello schermo scorre dentro la pagina: si taglia al bordo visibile.
          const x1 = Math.min(larga + sx, Math.max(...scatole.map((b) => b.x + b.width)) + margine + sx);
          const y1 = Math.max(...scatole.map((b) => b.y + b.height)) + margine + sy;
          await page.screenshot({ path: destinazione, fullPage: true, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        } else if (s.zona) await page.locator(s.zona).first().screenshot({ path: destinazione });
        else await page.screenshot({ path: destinazione, fullPage: !!s.intera });
        console.log(`✓ ${nome}/${s.file}.png`);
        // `dopo`: rimette com'era quello che lo scatto ha cambiato e il browser ricorda (il menu compresso).
        await page.evaluate(() => document.querySelectorAll("[data-segno-manuale]").forEach((n) => n.remove()));
        for (const p of s.dopo || []) {
          if (p.clic) await page.locator(p.clic).first().click({ timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(p.attesa ?? 400);
        }
      } catch (e) {
        console.error(`✕ ${nome}/${s.file}: ${e.message.split("\n")[0]}`);
        errori++;
      }
    }
  }
  await browser.close();
  process.exit(errori ? 1 : 0);
}

main().catch((e) => { console.error(`✕ ${e.message}`); process.exit(1); });
