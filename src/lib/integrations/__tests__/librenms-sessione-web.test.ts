// Accesso automatico a LibreNMS (passo 4b, 16/10/2026), contro un Laravel finto
// che — come quello vero — dà il cookie `laravel_session` anche col login sbagliato:
//  - il login si giudica da dove porta la risposta, non dal cookie;
//  - una sessione invalidata a monte fa svuotare la cache e rifare il login;
//  - il 302 porta a LibreNMS sullo stesso nome su cui finiscono i cookie.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  esitoLoginLibreNMS,
  getLibreNMSWebSession,
  invalidaSessioneLibreNMS,
  verificaSessioneLibreNMS,
  type LibreNMSWebSessionOptions,
} from "../librenms-web-session";
import {
  allineaHostLibreNMS,
  gestisciAccessoAutomaticoLibreNMS,
  gestisciProxyLibreNMS,
  hostDellaRichiesta,
  type DipendenzeAccessoAutomaticoLibreNMS,
} from "../librenms-accesso";
import { sembraPaginaDiLogin } from "../pagina-login";

const PASSWORD = "Pw-giusta-di-prova";
const servers: Server[] = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

interface LaravelFinto {
  origin: string;
  post: number;
  invalida(): void;
}

function cookieDi(header: string | undefined, nome: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`).exec(header ?? "");
  return m?.[1] ?? null;
}

async function laravelFinto(): Promise<LaravelFinto> {
  const valide = new Set<string>();
  let n = 0;
  const stato = { post: 0 };
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const anonimo = `anon-${++n}`;
      if (req.method === "GET" && req.url === "/login") {
        res.setHeader("Set-Cookie", [`XSRF-TOKEN=xsrf-${n}; Path=/`, `laravel_session=${anonimo}; Path=/; HttpOnly`]);
        res.setHeader("Content-Type", "text/html");
        res.end(`<form method="post" action="/login"><input type="hidden" name="_token" value="tok-${n}"><input name="username"><input type="password" name="password"></form>`);
        return;
      }
      if (req.method === "POST" && req.url === "/login") {
        stato.post++;
        const form = new URLSearchParams(body);
        if (form.get("password") === PASSWORD && form.get("_token")?.startsWith("tok-")) {
          const sessione = `sess-${n}`;
          valide.add(sessione);
          res.statusCode = 302;
          res.setHeader("Location", `http://${req.headers.host}/`);
          res.setHeader("Set-Cookie", `laravel_session=${sessione}; Path=/; HttpOnly`);
        } else {
          // Come Laravel: rimanda al login, con un cookie di sessione nuovo lo stesso.
          res.statusCode = 302;
          res.setHeader("Location", `http://${req.headers.host}/login`);
          res.setHeader("Set-Cookie", `laravel_session=${anonimo}; Path=/; HttpOnly`);
        }
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/") {
        const s = cookieDi(req.headers.cookie, "laravel_session");
        if (s && valide.has(s)) {
          res.setHeader("Content-Type", "text/html");
          res.end("<html><title>LibreNMS</title>Dashboard</html>");
        } else {
          res.statusCode = 302;
          res.setHeader("Location", `http://${req.headers.host}/login`);
          res.end();
        }
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    origin,
    get post() {
      return stato.post;
    },
    invalida: () => valide.clear(),
  };
}

const opzioni = (origin: string, password = PASSWORD): LibreNMSWebSessionOptions => ({
  upstreamOrigin: origin,
  username: "admin",
  password,
});

function depsVere(opts: LibreNMSWebSessionOptions): DipendenzeAccessoAutomaticoLibreNMS {
  return {
    accessoAutomaticoAttivo: () => true,
    cookieAccessoAutomatico: () =>
      getLibreNMSWebSession(opts)
        .then((r) => r.cookieHeader)
        .catch(() => null),
    setCookieDiretti: (c) => c.split(";").map((p) => `${p.trim()}; Path=/; Secure; SameSite=Lax`),
    sessioneValida: (c) => verificaSessioneLibreNMS(opts, c),
    svuotaCache: () => invalidaSessioneLibreNMS(opts),
  };
}

// ── Login giudicato dal contenuto ────────────────────────────────────────────

test("esito del login: dal rinvio e dalla pagina, non dal cookie", () => {
  const conCookie = { "set-cookie": ["laravel_session=x"] };
  assert.equal(esitoLoginLibreNMS({ status: 302, headers: { ...conCookie, location: "https://h:7443/" }, body: "" }).ok, true);
  assert.equal(esitoLoginLibreNMS({ status: 302, headers: { ...conCookie, location: "https://h:7443/login" }, body: "" }).ok, false);
  assert.equal(esitoLoginLibreNMS({ status: 302, headers: { ...conCookie, location: "/login" }, body: "" }).ok, false);
  assert.equal(esitoLoginLibreNMS({ status: 419, headers: conCookie, body: "Page Expired" }).ok, false);
  assert.equal(
    esitoLoginLibreNMS({ status: 200, headers: conCookie, body: '<input type="password" name="password">' }).ok,
    false,
  );
  assert.equal(esitoLoginLibreNMS({ status: 500, headers: conCookie, body: "" }).ok, false);
});

test("pagina di login riconosciuta da rinvio o contenuto", () => {
  assert.equal(sembraPaginaDiLogin({ status: 302, location: "/app/login?nextUrl=%2F" }), true);
  assert.equal(sembraPaginaDiLogin({ status: 302, location: "/dashboard" }), false);
  assert.equal(sembraPaginaDiLogin({ status: 200, body: "<input type='password'>" }), true);
  assert.equal(sembraPaginaDiLogin({ status: 200, body: "<html>ok</html>" }), false);
});

test("password sbagliata: il cookie arriva lo stesso, ma il login è rifiutato", async () => {
  const l = await laravelFinto();
  await assert.rejects(getLibreNMSWebSession(opzioni(l.origin, "sbagliata")), /rifiutato/);
  // E la rotta /sso risponde con un errore spiegato, non con un 302 verso il login.
  const resp = await gestisciAccessoAutomaticoLibreNMS(`${l.origin}/`, "admin", depsVere(opzioni(l.origin, "sbagliata")));
  assert.equal(resp.status, 502);
  assert.match(await resp.text(), /password admin/);
  assert.equal(resp.headers.get("set-cookie"), null);
});

test("password giusta: si entra, e la seconda apertura usa la cache", async () => {
  const l = await laravelFinto();
  const a = await getLibreNMSWebSession(opzioni(l.origin));
  assert.match(a.cookieHeader, /laravel_session=sess-/);
  const b = await getLibreNMSWebSession(opzioni(l.origin));
  assert.equal(b.cookieHeader, a.cookieHeader);
  assert.equal(l.post, 1);
  assert.equal(await verificaSessioneLibreNMS(opzioni(l.origin), a.cookieHeader), true);
});

test("sessione invalidata a monte: l'apertura svuota la cache e rifà il login", async () => {
  const l = await laravelFinto();
  const opts = opzioni(l.origin);
  const vecchio = (await getLibreNMSWebSession(opts)).cookieHeader;
  l.invalida();
  assert.equal(await verificaSessioneLibreNMS(opts, vecchio), false, "la vecchia sessione porta al login");

  const resp = await gestisciAccessoAutomaticoLibreNMS(`${l.origin}/`, "admin", depsVere(opts));
  assert.equal(resp.status, 302);
  assert.equal(l.post, 2, "un login nuovo");
  const nuovo = /laravel_session=([^;]+)/.exec(resp.headers.get("set-cookie") ?? "")?.[1];
  assert.ok(nuovo && !vecchio.includes(nuovo), "cookie nuovo, non quello in cache");
  assert.equal(await verificaSessioneLibreNMS(opts, `laravel_session=${nuovo}`), true);
});

test("proxy: rinvio al login dopo l'accesso automatico → cache svuotata, login nuovo, home", async () => {
  const conta = { svuota: 0, login: 0 };
  const inoltrate: Request[] = [];
  const resp = await gestisciProxyLibreNMS(new Request("https://da-ipam.local/api/integrations/proxy/librenms/devices"), "admin", {
    accessoAutomaticoAttivo: () => true,
    cookieAccessoAutomatico: async () => `laravel_session=s${++conta.login}`,
    inoltra: async (r) => {
      inoltrate.push(r);
      return inoltrate.length === 1
        ? new Response(null, { status: 302, headers: { Location: "/login" } })
        : new Response("home", { status: 200 });
    },
    allegaCookie: async (r, c) => {
      const h = new Headers(r.headers);
      h.set("x-cookie", c);
      return new Response(await r.text(), { status: r.status, headers: h });
    },
    svuotaCache: () => conta.svuota++,
  });
  assert.equal(conta.svuota, 1);
  assert.equal(conta.login, 2);
  assert.equal(resp.headers.get("x-cookie"), "laravel_session=s2");
  assert.match(inoltrate[1]!.headers.get("cookie") ?? "", /laravel_session=s2/);
});

// ── Cookie sullo stesso nome del 302 ─────────────────────────────────────────

test("allineamento del nome: stesso nome resta, nome dell'appliance si cambia, host estraneo no", () => {
  assert.deepEqual(allineaHostLibreNMS("https://192.0.2.10:7443/", "192.0.2.10", []), {
    ok: true, url: "https://192.0.2.10:7443/", cambiato: false,
  });
  assert.deepEqual(allineaHostLibreNMS("https://192.0.2.10:7443/", "appliance.local", ["192.0.2.10"]), {
    ok: true, url: "https://appliance.local:7443/", cambiato: true,
  });
  assert.deepEqual(allineaHostLibreNMS("https://nms.example:7443/", "appliance.local", ["192.0.2.10"]), {
    ok: false, url: "https://nms.example:7443/", hostDaIpam: "appliance.local", hostLibreNMS: "nms.example",
  });
  assert.equal(allineaHostLibreNMS("https://192.0.2.10:7443/", null, ["192.0.2.10"]).ok, true);
});

test("host della richiesta: X-Forwarded-Host di nginx prima di Host, senza porta", () => {
  assert.equal(hostDellaRichiesta(new Headers({ host: "127.0.0.1:3001", "x-forwarded-host": "Appliance.Local:443" })), "appliance.local");
  assert.equal(hostDellaRichiesta(new Headers({ host: "192.0.2.10" })), "192.0.2.10");
  assert.equal(hostDellaRichiesta(new Headers()), null);
});

function finteSso() {
  const conta = { login: 0 };
  const deps: DipendenzeAccessoAutomaticoLibreNMS = {
    accessoAutomaticoAttivo: () => true,
    cookieAccessoAutomatico: async () => {
      conta.login++;
      return "laravel_session=abc; XSRF-TOKEN=def";
    },
    setCookieDiretti: (c) => c.split(";").map((p) => `${p.trim()}; Path=/; Secure; SameSite=Lax`),
  };
  return { conta, deps };
}

test("rotta /sso: DA-IPAM aperto per nome, LibreNMS per IP dell'appliance → 302 sul nome, coi cookie", async () => {
  const { deps } = finteSso();
  const resp = await gestisciAccessoAutomaticoLibreNMS("https://192.0.2.10:7443/", "admin", deps, {
    hostRichiesta: "appliance.local",
    hostAllineabili: ["192.0.2.10"],
  });
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get("location"), "https://appliance.local:7443/");
  assert.match(resp.headers.get("set-cookie") ?? "", /laravel_session=abc/);
  assert.doesNotMatch(resp.headers.get("set-cookie") ?? "", /Domain=/i, "cookie dell'host della risposta, cioè dello stesso nome");
});

test("rotta /sso: LibreNMS su un altro host → errore spiegato, nessun login, nessun cookie perso in silenzio", async () => {
  const { conta, deps } = finteSso();
  const resp = await gestisciAccessoAutomaticoLibreNMS("https://nms.example:7443/", "admin", deps, {
    hostRichiesta: "appliance.local",
    hostAllineabili: ["192.0.2.10"],
  });
  assert.equal(resp.status, 409);
  assert.equal(conta.login, 0);
  assert.equal(resp.headers.get("set-cookie"), null);
  const html = await resp.text();
  assert.match(html, /appliance\.local/);
  assert.match(html, /nms\.example/);
});
