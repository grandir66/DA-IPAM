"use client";

import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { urlAccessoDomarc } from "@/lib/daauth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Pagina d'accesso (Riccardo, 20/10; ADR 0023): due metà come DA-Template, navy col marchio a
 * sinistra e modulo a destra. Tre momenti nella stessa scheda: nome e password; poi, solo per chi
 * l'admin ha chiesto la verifica in due passaggi, il codice a 6 cifre oppure (la prima volta) il QR
 * da inquadrare. Chi entra con l'account Domarc (entra.domarc.it) non vede né codice né QR.
 */
type Fase =
  | { tipo: "credenziali" }
  | { tipo: "codice" }
  | { tipo: "attivazione"; segreto: string; qr: string };

export default function LoginPage() {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>({ tipo: "credenziali" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [codice, setCodice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  // Secondi residui del backoff di login (0 = non bloccato). Mostrato come countdown
  // così l'utente sa di dover aspettare, non di aver perso la password.
  const [lockSec, setLockSec] = useState(0);
  // Ora di sblocco in ora italiana, fissata quando scatta il blocco (non a ogni disegno).
  const [sbloccoAlle, setSbloccoAlle] = useState("");
  const blocca = useCallback((sec: number) => {
    setLockSec(sec);
    setSbloccoAlle(new Date(Date.now() + sec * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
  }, []);
  // Sta provando a entrare con l'account Domarc (o è appena tornato da
  // entra.domarc.it): la pagina lo dice, invece di restare ferma un secondo.
  const [domarcInCorso, setDomarcInCorso] = useState(false);
  const [domarcErrore, setDomarcErrore] = useState("");
  // Indirizzo del servizio di autenticazione Domarc, letto da /api/setup.
  // Vuoto = questa installazione non lo usa: è il caso delle appliance dei
  // clienti, dove il bottone non deve nemmeno comparire.
  const [daauthUrl, setDaauthUrl] = useState("");

  /**
   * Accesso con l'account Domarc.
   *
   * Due tempi, e sono l'uno la conseguenza dell'altro: prima si prova con il
   * cookie che il browser ha già (chi è entrato in un'altra applicazione
   * Domarc non deve rifare niente); se non c'è, si va su entra.domarc.it e si
   * torna qui con `?domarc=1`, che fa ripartire il primo tempo.
   */
  const entraConDomarc = useCallback(async (mandaAllAccesso: boolean, base: string) => {
    if (!base) return;
    setDomarcErrore("");
    setDomarcInCorso(true);
    try {
      const esito = await signIn("domarc", { redirect: false });
      if (esito?.ok && !esito?.error) {
        window.location.assign("/");
        return;
      }
      if (mandaAllAccesso) {
        window.location.assign(
          urlAccessoDomarc(base, `${window.location.origin}/login?domarc=1`),
        );
        return;
      }
      // Tornati dall'accesso e ancora non riconosciuti: l'utenza Domarc esiste
      // ma qui no. Dirlo, invece di rimandare in un giro che rifarebbe lo
      // stesso percorso all'infinito.
      setDomarcErrore(
        "Il tuo account Domarc è valido, ma non risulta un'utenza DA-IPAM. Chiedi a un amministratore.",
      );
    } catch {
      setDomarcErrore("Servizio di autenticazione non raggiungibile. Usa username e password.");
    } finally {
      setDomarcInCorso(false);
    }
  }, []);

  // Ritorno da entra.domarc.it: si riprova una volta sola, senza rimbalzare.
  // Parte solo quando si sa che l'opzione è accesa, cioè dopo /api/setup.
  useEffect(() => {
    if (!daauthUrl || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("domarc") !== "1") return;
    // Differito, non chiamato qui dentro: `entraConDomarc` imposta stato
    // appena parte, e farlo in modo sincrono in un effetto innesca un giro di
    // render in più (il lint di DA-Vul-can lo segnala; qui la regola non c'è,
    // ma il codice è lo stesso e non deve divergere).
    const id = setTimeout(() => void entraConDomarc(false, daauthUrl), 0);
    return () => clearTimeout(id);
  }, [entraConDomarc, daauthUrl]);

  useEffect(() => {
    if (lockSec <= 0) return;
    const id = setTimeout(() => setLockSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [lockSec]);

  useEffect(() => {
    // Non lasciare mai “Caricamento…” all’infinito (DB bloccato, /api/setup lento, rete locale).
    const giveUp = setTimeout(() => setChecking(false), 12_000);
    const ac = new AbortController();
    const abortSlow = setTimeout(() => ac.abort(), 10_000);
    fetch("/api/setup", { signal: ac.signal, credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { needsSetup?: boolean; daauthUrl?: string }) => {
        setDaauthUrl((data.daauthUrl || "").trim());
        if (data.needsSetup) {
          router.replace("/setup");
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false))
      .finally(() => {
        clearTimeout(abortSlow);
        clearTimeout(giveUp);
      });
    return () => {
      clearTimeout(giveUp);
      clearTimeout(abortSlow);
      ac.abort();
    };
  }, [router]);

  /** Il blocco dei tentativi si legge e si mostra col conto alla rovescia (incidenti 99.50 e cliente A). */
  async function leggiBlocco(u: string): Promise<boolean> {
    try {
      const r = await fetch(`/api/auth/lock-state?u=${encodeURIComponent(u)}`, { credentials: "same-origin" });
      const data = (await r.json().catch(() => null)) as { locked?: boolean; retryAfterSec?: number } | null;
      if (data?.locked && (data.retryAfterSec ?? 0) > 0) {
        blocca(data.retryAfterSec as number);
        setError("");
        return true;
      }
    } catch {
      /* non raggiungibile → messaggio generico */
    }
    return false;
  }

  /** Accesso vero (NextAuth). «ok» = si va alla dashboard; altrimenti il motivo, già mostrato. */
  async function entra(conCodice?: string): Promise<"ok" | "bloccato" | "rifiuta"> {
    const result = await signIn("credentials", {
      username,
      password,
      ...(conCodice ? { codice: conCodice } : {}),
      redirect: false,
    });
    if (result?.error || result?.ok === false) {
      if (await leggiBlocco(username)) return "bloccato";
      setError(conCodice ? "Codice non valido o già usato: scrivi quello nuovo che mostra l'app." : "Nome o password non validi.");
      return "rifiuta";
    }
    // Navigazione completa: i cookie di sessione arrivano al middleware (evita il giro sul login).
    window.location.assign("/");
    return "ok";
  }

  /** Passo 1 sul server: password giusta → serve il codice, il QR, o si entra. */
  async function chiediPassoUno() {
    const r = await fetch("/api/auth/passo-uno", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    return (await r.json().catch(() => null)) as
      | { esito: "entra" | "serve_codice" | "rifiuta" }
      | { esito: "serve_attivazione"; segreto: string; qr: string }
      | { esito: "bloccato"; secondi: number }
      | null;
  }

  async function passoUno(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const d = await chiediPassoUno();
      if (!d) {
        setError("Accesso non riuscito: il server non ha risposto come doveva.");
      } else if (d.esito === "entra") {
        await entra();
      } else if (d.esito === "serve_codice") {
        setCodice("");
        setFase({ tipo: "codice" });
      } else if (d.esito === "serve_attivazione") {
        setCodice("");
        setFase({ tipo: "attivazione", segreto: d.segreto, qr: d.qr });
      } else if (d.esito === "bloccato") {
        blocca(d.secondi);
      } else if (!(await leggiBlocco(username))) {
        // Il blocco si dice subito, col conto alla rovescia (incidenti 99.50 e cliente A).
        setError("Nome o password non validi.");
      }
    } catch {
      setError("Errore di connessione durante l'accesso.");
    } finally {
      setLoading(false);
    }
  }

  async function passoCodice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const esito = await entra(codice);
      if (esito === "ok") return;
      setCodice("");
      // In attivazione il QR scade dopo 10 minuti (il tempo di scaricare l'app): se il codice
      // non va, si richiede il passo 1 e, se il QR è cambiato, si mostra quello nuovo invece di
      // far sbagliare fino al blocco (seconda revisione del 20/10).
      if (esito === "rifiuta" && fase.tipo === "attivazione") {
        const d = await chiediPassoUno();
        if (d?.esito === "serve_attivazione" && d.segreto !== fase.segreto) {
          setFase({ tipo: "attivazione", segreto: d.segreto, qr: d.qr });
          setError("Il QR era scaduto: inquadra questo nuovo QR (quello di prima nell'app non vale più) e scrivi il codice.");
        }
      }
    } catch {
      setError("Errore di connessione durante l'accesso.");
    } finally {
      setLoading(false);
    }
  }

  function indietro() {
    setFase({ tipo: "credenziali" });
    setCodice("");
    setError("");
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento…</p>
      </div>
    );
  }

  const bloccato = lockSec > 0;
  return (
    <div className="min-h-screen flex flex-col min-[900px]:flex-row bg-background">
      {/* ── Metà sinistra: il marchio (sotto i 900 px diventa una testata) ── */}
      <aside className="bg-[#0D2537] text-white flex flex-col justify-between px-8 py-6 min-[900px]:w-[44%] min-[900px]:px-14 min-[900px]:py-14">
        <img src="/logo-white.png" alt="Domarc · Oltre l'ufficio IT" className="h-12 w-auto self-start object-contain min-[900px]:h-20" />
        <div className="hidden min-[900px]:block">
          <p aria-hidden className="text-[#00A7E7] text-3xl font-bold tracking-[0.3em] mb-6">›››</p>
          <h1 className="text-4xl font-bold tracking-tight !text-white">DA-IPAM</h1>
          <p className="mt-2 text-lg text-white/80 font-light">Inventario, rete e sicurezza dei sistemi</p>
        </div>
        <p className="hidden min-[900px]:block text-[13px] text-white/60">Domarc · Oltre l&apos;ufficio IT</p>
      </aside>

      {/* ── Metà destra: il modulo ── */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 bg-card">
        <div className="w-full max-w-md">
          {fase.tipo === "credenziali" && (
            <>
              <h2 className="text-2xl font-bold tracking-tight mb-1">Accedi a DA-IPAM</h2>
              <p className="text-sm text-muted-foreground mb-6">{daauthUrl ? "Con il tuo account Domarc o con nome e password." : "Con il tuo nome utente e la password."}</p>
              {daauthUrl && (
                <>
                  <Button type="button" className="w-full" disabled={domarcInCorso} onClick={() => void entraConDomarc(true, daauthUrl)}>
                    {domarcInCorso ? "Accesso in corso…" : "Accedi con l'account Domarc"}
                  </Button>
                  {domarcErrore && <Avviso tono="errore">{domarcErrore}</Avviso>}
                  <div className="my-5 flex items-center gap-3 text-[13px] text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    oppure con nome e password
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}
              <form onSubmit={passoUno} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Nome utente</Label>
                  <Input id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" name="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Messaggi bloccato={bloccato} lockSec={lockSec} sbloccoAlle={sbloccoAlle} error={error} />
                <Button type="submit" variant={daauthUrl ? "outline" : "default"} className="w-full" disabled={loading || bloccato}>
                  {loading ? "Verifica in corso…" : "Accedi"}
                </Button>
              </form>
            </>
          )}

          {fase.tipo === "codice" && (
            <form onSubmit={passoCodice} className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Verifica in due passaggi</h2>
              <p className="text-sm text-muted-foreground">Scrivi il codice a 6 cifre che mostra l&apos;app di autenticazione per <b className="text-foreground">{username}</b>.</p>
              <CampoCodice valore={codice} onCambia={setCodice} />
              <Messaggi bloccato={bloccato} lockSec={lockSec} sbloccoAlle={sbloccoAlle} error={error} />
              <Button type="submit" className="w-full" disabled={loading || bloccato || codice.replace(/\s/g, "").length !== 6}>
                {loading ? "Verifica in corso…" : "Accedi"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={indietro}>← Indietro</Button>
            </form>
          )}

          {fase.tipo === "attivazione" && (
            <form onSubmit={passoCodice} className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Attiva la verifica in due passaggi</h2>
              <p className="text-sm text-muted-foreground">L&apos;amministratore l&apos;ha richiesta per <b className="text-foreground">{username}</b>. Serve una volta sola.</p>
              <ol className="space-y-1 text-sm list-decimal pl-5">
                <li>Apri l&apos;app di autenticazione sul telefono (Microsoft Authenticator, Google Authenticator…).</li>
                <li>Inquadra il QR, oppure inserisci a mano il codice qui sotto.</li>
                <li>Scrivi il codice a 6 cifre che compare nell&apos;app.</li>
              </ol>
              <div className="flex flex-col items-center gap-2 rounded-md border bg-white p-3">
                <img src={fase.qr} alt="QR da inquadrare con l'app di autenticazione" width={200} height={200} />
                <code className="font-mono text-[13px] text-[#0D2537] tracking-wider text-center break-all" title="Codice da inserire a mano nell'app">
                  {fase.segreto.replace(/(.{4})/g, "$1 ").trim()}
                </code>
              </div>
              <p className="text-[13px] text-muted-foreground">Il QR vale 10 minuti: se scade, torna indietro e rientra.</p>
              <CampoCodice valore={codice} onCambia={setCodice} />
              <Messaggi bloccato={bloccato} lockSec={lockSec} sbloccoAlle={sbloccoAlle} error={error} />
              <Button type="submit" className="w-full" disabled={loading || bloccato || codice.replace(/\s/g, "").length !== 6}>
                {loading ? "Verifica in corso…" : "Attiva ed entra"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={indietro}>← Indietro</Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

/** Campo del codice: 6 cifre, tastiera numerica sul telefono, compilabile dall'app (one-time-code). */
function CampoCodice({ valore, onCambia }: { valore: string; onCambia: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="codice">Codice a 6 cifre</Label>
      <Input
        id="codice"
        name="codice"
        autoFocus
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="123 456"
        className="text-center font-mono text-xl tracking-[0.3em]"
        value={valore}
        onChange={(e) => onCambia(e.target.value.replace(/[^\d ]/g, ""))}
      />
    </div>
  );
}

function Messaggi({ bloccato, lockSec, sbloccoAlle, error }: { bloccato: boolean; lockSec: number; sbloccoAlle: string; error: string }) {
  if (bloccato) {
    return (
      <Avviso tono="attenzione">
        Troppi tentativi falliti. Riprova tra {Math.floor(lockSec / 60)}:{String(lockSec % 60).padStart(2, "0")} (alle {sbloccoAlle}).
      </Avviso>
    );
  }
  return error ? <Avviso tono="errore">{error}</Avviso> : null;
}

/** Avviso col simbolo e il bordo del token (Riccardo è daltonico: mai solo il colore). */
function Avviso({ tono, children }: { tono: "errore" | "attenzione"; children: React.ReactNode }) {
  const stile =
    tono === "errore"
      ? { segno: "✕", classi: "border-[#8E1B20] text-[#8E1B20] dark:border-[#E8625A] dark:text-[#E8625A]" }
      : { segno: "▲", classi: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]" };
  return (
    <p role="alert" className={`mt-2 flex items-start gap-2 rounded-md border-l-4 border px-3 py-2 text-sm ${stile.classi}`}>
      <span aria-hidden className="font-bold">{stile.segno}</span>
      <span>{children}</span>
    </p>
  );
}
