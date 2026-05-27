"use client";

/**
 * Guida rapida abilitazione WinRM sul server target (v0.2.649).
 *
 * Coperti i 4 scenari più frequenti di DA-IPAM:
 *   - Server WORKGROUP + admin builtin "Administrator"
 *   - Server WORKGROUP + admin locale custom (es. "da", "manutenzione")  ← caso più rognoso
 *   - Server DOMINIO + admin di dominio
 *   - Server DOMINIO + admin locale non-builtin
 *
 * Tutti i comandi sono PowerShell elevato sul server target. Ogni snippet ha
 * un bottone "Copia" per copiarlo veloce.
 *
 * Apribile da: form credenziali (type=windows), toast errore 401/TCP_TIMEOUT.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogScrollableArea } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, ExternalLink, Download, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab iniziale da aprire (es. "workgroup-custom" se l'errore è 401 e l'host è workgroup). */
  initialTab?: "workgroup-builtin" | "workgroup-custom" | "domain-admin" | "domain-local" | "troubleshoot";
}

function CodeBlock({ code, lang = "powershell" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative group">
      <pre className="bg-muted text-foreground text-[12px] leading-relaxed p-3 pr-10 rounded-md border border-border overflow-x-auto whitespace-pre">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded hover:bg-background border border-border bg-background/80 transition-opacity"
        title="Copia"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      <span className="absolute bottom-1 right-2 text-[9px] text-muted-foreground/60 uppercase">{lang}</span>
    </div>
  );
}

export function WinRMSetupGuideDialog({ open, onOpenChange, initialTab = "workgroup-custom" }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-full">
        <DialogHeader className="border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Guida: abilitare WinRM sul server target</DialogTitle>
        </DialogHeader>

        <DialogScrollableArea className="px-4 py-3 max-h-[75vh]">
          <p className="text-xs text-muted-foreground mb-3">
            DA-IPAM usa WinRM (porta 5985 HTTP / 5986 HTTPS) per inventario software, fingerprint OS,
            esecuzione comandi. Tutti i comandi qui sotto si eseguono <strong>sul server target</strong>,
            in <strong>PowerShell come amministratore</strong>.
          </p>

          {/* v0.2.656: download script PowerShell automatico + manuale completo */}
          <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/5 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold">Setup automatico</p>
              <p className="text-xs text-muted-foreground">
                Lo script PowerShell copre tutti gli scenari (workgroup, dominio, admin custom).
                Scaricalo, copia sul server, esegui in PowerShell elevato.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a
                href="/api/winrm-setup/script"
                download="Configure-WinRM-DA-IPAM.ps1"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90"
              >
                <Download className="h-3.5 w-3.5" />
                Script .ps1
              </a>
              <a
                href="/api/winrm-setup/manual"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-border bg-background text-xs hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5" />
                Manuale .md
              </a>
            </div>
          </div>

          <Tabs defaultValue={initialTab}>
            <TabsList className="grid grid-cols-5 mb-3">
              <TabsTrigger value="workgroup-builtin">Workgroup<br/>Administrator</TabsTrigger>
              <TabsTrigger value="workgroup-custom">Workgroup<br/>admin custom</TabsTrigger>
              <TabsTrigger value="domain-admin">Dominio<br/>admin AD</TabsTrigger>
              <TabsTrigger value="domain-local">Dominio<br/>admin locale</TabsTrigger>
              <TabsTrigger value="troubleshoot">Diagnostica</TabsTrigger>
            </TabsList>

            {/* ─────────── Workgroup + Administrator builtin ─────────── */}
            <TabsContent value="workgroup-builtin" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Server NON joinato a dominio</Badge>
                <Badge variant="outline">Account: Administrator (builtin)</Badge>
              </div>
              <p className="text-sm">
                Caso più semplice: l&apos;account <code>Administrator</code> builtin è esente dal filtro UAC remoto.
                Basta abilitare il listener WinRM su NIC pubblica e aprire il firewall.
              </p>
              <h4 className="text-sm font-semibold">0. Setup automatico (consigliato)</h4>
              <CodeBlock code={`.\\Configure-WinRM-DA-IPAM.ps1 -Mode Workgroup`} />
              <h4 className="text-sm font-semibold">1. Setup manuale (alternativa)</h4>
              <CodeBlock code={`Enable-PSRemoting -Force -SkipNetworkProfileCheck`} />
              <p className="text-xs text-muted-foreground">
                Configura listener WinRM, abilita la regola firewall <code>WINRM-HTTP-In-TCP-PUBLIC</code>
                e attiva PSRemoting. Funziona anche se la NIC è classificata Public (default in workgroup).
              </p>
              <h4 className="text-sm font-semibold">2. Credenziale in DA-IPAM</h4>
              <ul className="text-sm space-y-1 list-disc ml-5">
                <li>Tipo: <strong>Windows (host)</strong></li>
                <li>Username: <strong><code>.\Administrator</code></strong> (con punto e backslash)</li>
                <li>Password: la password locale di Administrator</li>
              </ul>
              <h4 className="text-sm font-semibold">3. Verifica sul server</h4>
              <CodeBlock code={`netstat -ano | findstr ":5985"\nTest-NetConnection -ComputerName localhost -Port 5985`} />
              <p className="text-xs text-muted-foreground">
                Devi vedere <code>0.0.0.0:5985 LISTENING</code> e <code>TcpTestSucceeded : True</code>.
              </p>
            </TabsContent>

            {/* ─────────── Workgroup + admin custom (caso più rognoso) ─────────── */}
            <TabsContent value="workgroup-custom" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Server NON joinato a dominio</Badge>
                <Badge variant="outline">Account custom (es. &quot;da&quot;, &quot;manutenzione&quot;)</Badge>
                <Badge className="bg-amber-100 border-amber-300 text-amber-800">Più frequente</Badge>
              </div>
              <p className="text-sm">
                Caso con tre ostacoli sovrapposti: profilo NIC Public, filtro UAC remoto sugli admin
                locali non-builtin, e formato username. Servono <strong>tutti e tre</strong> i fix.
              </p>

              <h4 className="text-sm font-semibold">0. Setup automatico (consigliato)</h4>
              <CodeBlock code={`.\\Configure-WinRM-DA-IPAM.ps1 -Mode WorkgroupCustomAdmin`} />
              <p className="text-xs text-muted-foreground">
                Lo script copre tutti i 3 fix sotto in un colpo. Per restringere l&apos;accesso solo al DA-IPAM appliance:
                <code className="ml-1">-AllowFromIP 192.168.4.8</code>
              </p>

              <h4 className="text-sm font-semibold">1. Disabilita il filtro UAC remoto</h4>
              <p className="text-xs text-muted-foreground">
                Senza questa key, qualunque admin locale che NON sia <code>Administrator</code> builtin
                riceve un token &quot;filtered&quot; via rete → WinRM rifiuta con 401 anche se la password è esatta.
              </p>
              <CodeBlock code={`reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f`} />

              <h4 className="text-sm font-semibold">2. Abilita listener WinRM (anche su NIC Public)</h4>
              <CodeBlock code={`Enable-PSRemoting -Force -SkipNetworkProfileCheck`} />
              <p className="text-xs text-muted-foreground">
                Il flag <code>-SkipNetworkProfileCheck</code> è essenziale: <code>winrm quickconfig</code>
                normalmente rifiuta su NIC Public.
              </p>

              <h4 className="text-sm font-semibold">3. Credenziale in DA-IPAM</h4>
              <ul className="text-sm space-y-1 list-disc ml-5">
                <li>Tipo: <strong>Windows (host)</strong></li>
                <li>Username: <strong><code>.\nomeutente</code></strong> (es. <code>.\da</code>) — il punto-backslash dice &quot;account locale di questa macchina&quot;</li>
                <li>Password: la password locale dell&apos;utente</li>
              </ul>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ Senza il prefisso <code>.\</code> NTLM manda con dominio vuoto → Windows lo instrada
                al DC fantasma → 401. È l&apos;errore più comune.
              </p>

              <h4 className="text-sm font-semibold">4. Verifica</h4>
              <CodeBlock code={`# Sul server\nnetstat -ano | findstr ":5985"\nTest-NetConnection -ComputerName localhost -Port 5985\nnet localgroup Administrators`} />
              <p className="text-xs text-muted-foreground">
                <code>net localgroup Administrators</code> deve elencare il tuo utente.
              </p>
            </TabsContent>

            {/* ─────────── Domain + admin AD ─────────── */}
            <TabsContent value="domain-admin" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Server joinato a dominio</Badge>
                <Badge variant="outline">Account di dominio (Domain Admins / membro Administrators)</Badge>
              </div>
              <p className="text-sm">
                Caso più semplice in ambiente AD: l&apos;account di dominio usa Kerberos automaticamente.
                Il filtro UAC remoto NON si applica agli account di dominio.
              </p>
              <h4 className="text-sm font-semibold">0. Setup automatico (consigliato)</h4>
              <CodeBlock code={`.\\Configure-WinRM-DA-IPAM.ps1 -Mode Domain`} />
              <h4 className="text-sm font-semibold">1. Setup manuale</h4>
              <CodeBlock code={`Enable-PSRemoting -Force`} />
              <p className="text-xs text-muted-foreground">
                In dominio la NIC è già Private/DomainAuthenticated → niente <code>-SkipNetworkProfileCheck</code>.
              </p>

              <h4 className="text-sm font-semibold">2. Credenziale in DA-IPAM</h4>
              <ul className="text-sm space-y-1 list-disc ml-5">
                <li>Tipo: <strong>Windows (host)</strong></li>
                <li>Username: <strong><code>utente@dominio.fqdn</code></strong> (UPN — es. <code>admin@corp.acme.local</code>) — preferito per Kerberos</li>
                <li>Oppure: <strong><code>DOMINIO\utente</code></strong> (NetBIOS — es. <code>CORP\admin</code>) — funziona via NTLM</li>
                <li>Password: la password AD</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Il bridge WinRM di DA-IPAM tenta Kerberos prima, poi NTLM come fallback. Entrambi
                i formati sono accettati.
              </p>
            </TabsContent>

            {/* ─────────── Domain + admin locale ─────────── */}
            <TabsContent value="domain-local" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Server joinato a dominio</Badge>
                <Badge variant="outline">Account LOCALE del server (non di dominio)</Badge>
              </div>
              <p className="text-sm">
                Server in dominio ma vuoi usare un admin locale (più isolato, audit cleaner).
                Stesso vincolo del caso workgroup: serve <code>LocalAccountTokenFilterPolicy</code>
                se l&apos;account NON è il builtin Administrator.
              </p>

              <h4 className="text-sm font-semibold">1. Filtro UAC remoto (solo se admin custom)</h4>
              <CodeBlock code={`reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f`} />

              <h4 className="text-sm font-semibold">2. Abilita WinRM</h4>
              <CodeBlock code={`Enable-PSRemoting -Force`} />

              <h4 className="text-sm font-semibold">3. Credenziale in DA-IPAM</h4>
              <ul className="text-sm space-y-1 list-disc ml-5">
                <li>Tipo: <strong>Windows (host)</strong></li>
                <li>Username: <strong><code>.\nomeutente</code></strong> — il punto-backslash forza l&apos;auth contro l&apos;account locale del server, evitando il DC</li>
                <li>Oppure: <strong><code>NOMESERVER\nomeutente</code></strong> con il NetBIOS name del server</li>
              </ul>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ Se ometti il prefisso, il server interroga il DC del dominio cercando un account
                inesistente → 401.
              </p>
            </TabsContent>

            {/* ─────────── Troubleshoot ─────────── */}
            <TabsContent value="troubleshoot" className="space-y-3">
              <h4 className="text-sm font-semibold">Errore 401 (AUTH_REJECTED)</h4>
              <p className="text-sm">
                Le credenziali sono state rifiutate. Cause più probabili in ordine di frequenza:
              </p>
              <ol className="text-sm space-y-1 list-decimal ml-5">
                <li><strong>Username senza prefisso</strong> per account locale → metti <code>.\nomeutente</code></li>
                <li><strong>LocalAccountTokenFilterPolicy non impostata</strong> → vedi tab Workgroup/admin custom o Dominio/admin locale</li>
                <li><strong>Password sbagliata</strong> — banale ma testa con <code>net user nomeutente</code> sul server, deve essere <code>Account active=Yes</code></li>
                <li><strong>Account non nel gruppo Administrators</strong> (o per non-admin: non in &quot;Remote Management Users&quot;)</li>
                <li><strong>NTLM disabilitato</strong> (Windows hardened): <code>Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa | Select RestrictReceivingNTLMTraffic</code> — se vale 2, sblocca con 0</li>
              </ol>

              <h4 className="text-sm font-semibold mt-4">Errore TCP_TIMEOUT (host irraggiungibile su 5985)</h4>
              <p className="text-sm">Ping OK ma 5985 non risponde:</p>
              <ol className="text-sm space-y-1 list-decimal ml-5">
                <li><strong>Listener WinRM non attivo</strong> — sul server: <code>netstat -ano | findstr &quot;:5985&quot;</code>. Se vuoto: <code>Enable-PSRemoting -Force -SkipNetworkProfileCheck</code></li>
                <li><strong>Regola firewall su Public mancante</strong> — sblocco:
                  <CodeBlock code={`Enable-NetFirewallRule -Name WINRM-HTTP-In-TCP\nEnable-NetFirewallRule -Name WINRM-HTTP-In-TCP-PUBLIC`} />
                </li>
                <li><strong>Antivirus enterprise</strong> (Sophos, ESET, Kaspersky) con firewall personale → aggiungi eccezione 5985</li>
                <li><strong>Router / VLAN ACL</strong> blocca tra la subnet DA-IPAM e quella del server → controlla regole di rete</li>
              </ol>

              <h4 className="text-sm font-semibold mt-4">Errore KERBEROS_FAILED</h4>
              <p className="text-sm">
                Kerberos fallisce ma il bridge fa fallback automatico su NTLM/CredSSP/Basic. Se vedi
                questo errore senza fallback, hai forzato il transport con <code>WINRM_TRANSPORT=kerberos</code>.
                Rimuovi la env var.
              </p>

              <h4 className="text-sm font-semibold mt-4">Errore KERBEROS_ONLY (server rifiuta NTLM)</h4>
              <p className="text-sm">
                Windows server hardened con NTLM disabilitato. Soluzioni:
              </p>
              <ul className="text-sm space-y-1 list-disc ml-5">
                <li>Joinare il server al dominio AD e usare credenziali AD (UPN o DOMAIN\user)</li>
                <li>Riabilitare NTLM in ingresso: <code>Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa -Name RestrictReceivingNTLMTraffic -Value 0</code></li>
              </ul>

              <h4 className="text-sm font-semibold mt-4">Comandi diagnostici utili sul server</h4>
              <CodeBlock code={`# Stato auth providers WinRM
winrm get winrm/config/service/auth

# Listener attivi
winrm enumerate winrm/config/listener

# Profilo NIC (Public/Private/Domain)
Get-NetConnectionProfile

# Test self-loopback
Test-NetConnection -ComputerName localhost -Port 5985

# Gruppi local del tuo utente
net user nomeutente

# Membri Administrators
net localgroup Administrators`} />
            </TabsContent>
          </Tabs>

          <div className="mt-4 pt-3 border-t border-border/50 space-y-2">
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold mb-1">Casi avanzati (non in questo dialog):</p>
              <ul className="list-disc ml-5 space-y-0.5">
                <li>Mass deployment su postazioni Windows via <strong>Group Policy</strong> → vedi <a href="/api/winrm-setup/manual" target="_blank" rel="noreferrer" className="text-primary hover:underline">manuale completo §5</a></li>
                <li>Configurazione <strong>Domain Controller</strong> per LDAPS + WinRM → manuale §3.6</li>
                <li>Hardening con <strong>HTTPS 5986</strong> e restrizione IP → manuale §9</li>
              </ul>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <ExternalLink className="h-3 w-3" />
              Documentazione ufficiale Microsoft:&nbsp;
              <a
                href="https://learn.microsoft.com/en-us/windows/win32/winrm/installation-and-configuration-for-windows-remote-management"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                WinRM installation and configuration
              </a>
            </div>
          </div>
        </DialogScrollableArea>

        <DialogFooter className="px-4 py-3 border-t border-border/50">
          <Button onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
