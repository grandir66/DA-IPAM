"use client";

/**
 * Guida configurazione Domain Controller per integrazione Active Directory in DA-IPAM (v0.2.657).
 *
 * Coperti i 5 setup principali:
 *   - Verifiche preliminari servizi DC
 *   - LDAPS (porta 636) con self-signed cert per DC senza CA Enterprise
 *   - WinRM sul DC per sync DHCP
 *   - Service account svc-ipam (creazione + permessi minimi)
 *   - Troubleshooting DHCP sync zero scope (caso 2R)
 *
 * Apribile dalla pagina /active-directory.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogScrollableArea } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, ExternalLink, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "prereq" | "ldaps" | "winrm-dhcp" | "svc-account" | "troubleshoot";
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
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
      <span className="absolute bottom-1 right-2 text-[9px] text-muted-foreground/60 uppercase">powershell</span>
    </div>
  );
}

export function ADSetupGuideDialog({ open, onOpenChange, initialTab = "prereq" }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl w-full">
        <DialogHeader className="border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Guida: configurare il Domain Controller per DA-IPAM</DialogTitle>
        </DialogHeader>

        <DialogScrollableArea className="px-4 py-3 max-h-[75vh]">
          <p className="text-xs text-muted-foreground mb-3">
            DA-IPAM si connette al DC via <strong>LDAP/LDAPS (porte 389/636)</strong> per sync utenti/computer/gruppi,
            e via <strong>WinRM (porta 5985)</strong> per leggere i lease DHCP se il DC ha il ruolo DHCP. Sono <strong>due canali separati</strong>:
            entrambi vanno configurati. Tutti i comandi si eseguono <strong>sul DC</strong>, in <strong>PowerShell elevato</strong>.
          </p>

          <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/5 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold">Manuale completo</p>
              <p className="text-xs text-muted-foreground">
                Dettagli su tutti gli scenari, hardening e incident reali (DTS.local, 2R).
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a
                href="/api/ad-setup/manual"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-border bg-background text-xs hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5" />
                MANUALE-ACTIVE-DIRECTORY.md
              </a>
            </div>
          </div>

          <Tabs defaultValue={initialTab}>
            <TabsList className="grid grid-cols-5 mb-3">
              <TabsTrigger value="prereq">Prerequisiti</TabsTrigger>
              <TabsTrigger value="ldaps">LDAPS</TabsTrigger>
              <TabsTrigger value="winrm-dhcp">WinRM/DHCP</TabsTrigger>
              <TabsTrigger value="svc-account">Service account</TabsTrigger>
              <TabsTrigger value="troubleshoot">Diagnostica</TabsTrigger>
            </TabsList>

            {/* ────────── Prerequisiti ────────── */}
            <TabsContent value="prereq" className="space-y-3">
              <h4 className="text-sm font-semibold">1. Servizi base sul DC</h4>
              <CodeBlock code={`Get-Service NTDS, ADWS, WinRM, DHCPServer | Format-Table Name, Status, StartType`} />
              <p className="text-xs text-muted-foreground">
                Tutti devono essere <code>Running</code>. <code>DHCPServer</code> solo se il DC ha il ruolo DHCP.
              </p>

              <h4 className="text-sm font-semibold">2. Modulo PowerShell DhcpServer (se DC ha DHCP)</h4>
              <CodeBlock code={`Get-Module -ListAvailable DhcpServer
# Se manca:
Install-WindowsFeature RSAT-DHCP`} />

              <h4 className="text-sm font-semibold">3. Porte aperte verso DA-IPAM appliance</h4>
              <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1">
                <div><code className="font-semibold">389</code> — LDAP plaintext</div>
                <div><code className="font-semibold">636</code> — LDAPS (richiesto in setup tipici)</div>
                <div><code className="font-semibold">3268</code> — Global Catalog</div>
                <div><code className="font-semibold">3269</code> — Global Catalog TLS</div>
                <div><code className="font-semibold">5985</code> — WinRM (per DHCP sync)</div>
                <div><code className="font-semibold">9389</code> — ADWS (PowerShell AD)</div>
              </div>
            </TabsContent>

            {/* ────────── LDAPS ────────── */}
            <TabsContent value="ldaps" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Caso più frequente</Badge>
                <Badge className="bg-amber-100 border-amber-300 text-amber-800">DC senza CA Enterprise</Badge>
              </div>

              <h4 className="text-sm font-semibold">1. Verifica policy LDAP sul DC</h4>
              <CodeBlock code={`Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters |
  Select-Object LdapEnforceChannelBinding, LDAPServerIntegrity`} />
              <p className="text-xs text-muted-foreground">
                <code>LDAPServerIntegrity = 2</code> = signing forzato → solo LDAPS funziona. <code>LdapEnforceChannelBinding ≥ 1</code> richiede cert valido.
              </p>

              <h4 className="text-sm font-semibold">2. Verifica cert LDAPS esistente</h4>
              <CodeBlock code={`Get-ChildItem Cert:\\LocalMachine\\My |
  Where-Object { $_.EnhancedKeyUsageList.FriendlyName -like "*Server Authentication*" } |
  Select-Object Subject, NotAfter`} />
              <p className="text-xs text-muted-foreground">
                Se trovi un cert con <code>Subject = CN=&lt;NomeDC&gt;.&lt;dominio.fqdn&gt;</code> → LDAPS è già attivo, vai a §3.
              </p>

              <h4 className="text-sm font-semibold">3. Crea self-signed cert (se manca)</h4>
              <CodeBlock code={`# Genera cert self-signed per LDAPS
$cert = New-SelfSignedCertificate \`
  -DnsName "$($env:COMPUTERNAME).$env:USERDNSDOMAIN", $env:COMPUTERNAME \`
  -CertStoreLocation "Cert:\\LocalMachine\\My" \`
  -KeyUsage DigitalSignature, KeyEncipherment \`
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") \`
  -NotAfter (Get-Date).AddYears(5)

# Copia anche nel Trusted Root del DC (essenziale!)
$srcCert = Get-Item "Cert:\\LocalMachine\\My\\$($cert.Thumbprint)"
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root","LocalMachine")
$rootStore.Open("ReadWrite")
$rootStore.Add($srcCert)
$rootStore.Close()

# Restart NTDS per caricare il cert
Restart-Service NTDS -Force`} />
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ <strong>Incident DTS.local</strong>: il cert DEVE essere SIA in <code>My</code> (Personal\Computer) SIA in <code>Root</code>
                (Trusted Root) del DC stesso, altrimenti NTDS lo carica ma rifiuta i bind LDAPS come untrusted.
              </p>

              <h4 className="text-sm font-semibold">4. Test LDAPS dal lato DA-IPAM appliance (linux)</h4>
              <CodeBlock code={`echo | openssl s_client -connect <ip-DC>:636 -showcerts 2>&1 | grep -E "subject|issuer|verify"`} />
            </TabsContent>

            {/* ────────── WinRM/DHCP ────────── */}
            <TabsContent value="winrm-dhcp" className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Solo se DC ha ruolo DHCP</Badge>
              </div>

              <h4 className="text-sm font-semibold">1. Abilita WinRM sul DC</h4>
              <CodeBlock code={`Enable-PSRemoting -Force`} />

              <h4 className="text-sm font-semibold">2. Aggiungi il service account ai gruppi DHCP</h4>
              <CodeBlock code={`# Crea gruppi se non esistono (server appena promosso a DHCP)
Add-DhcpServerSecurityGroup
Restart-Service DHCPServer

# Aggiungi svc-ipam ai DHCP Administrators
Add-ADGroupMember -Identity "DHCP Administrators" -Members "svc-ipam"

# Per WinRM serve anche essere admin del DC:
Add-LocalGroupMember -Group "Administrators" -Member "DOMINIO\\svc-ipam"`} />

              <h4 className="text-sm font-semibold">3. Test cmdlet DHCP</h4>
              <CodeBlock code={`# Lo stesso comando che DA-IPAM esegue:
Get-DhcpServerv4Scope | ConvertTo-Json -Depth 2 -Compress`} />
              <p className="text-xs text-muted-foreground">
                Se restituisce JSON con i scope → DA-IPAM sincronizzerà. Errori comuni in tab Diagnostica.
              </p>
            </TabsContent>

            {/* ────────── Service account ────────── */}
            <TabsContent value="svc-account" className="space-y-3">
              <p className="text-sm">
                Account di dominio dedicato per DA-IPAM, isolato per audit e principio del minimo privilegio.
              </p>

              <h4 className="text-sm font-semibold">1. Crea account svc-ipam</h4>
              <CodeBlock code={`Import-Module ActiveDirectory

$pwd = ConvertTo-SecureString "PasswordLungaSicura!2026" -AsPlainText -Force
New-ADUser \`
  -Name "svc-ipam" \`
  -SamAccountName "svc-ipam" \`
  -UserPrincipalName "svc-ipam@dominio.fqdn" \`
  -AccountPassword $pwd \`
  -PasswordNeverExpires $true \`
  -Enabled $true \`
  -Description "Service account per DA-IPAM"`} />

              <h4 className="text-sm font-semibold">2. Permessi minimi necessari</h4>
              <div className="text-xs space-y-1">
                <p>• <strong>Sync LDAP utenti/computer/gruppi</strong>: Authenticated Users (default OK)</p>
                <p>• <strong>Sync DHCP</strong>: gruppo <code>DHCP Administrators</code></p>
                <p>• <strong>WinRM connect al DC</strong>: gruppo <code>Administrators</code> locale del DC (o Domain Admins)</p>
              </div>

              <CodeBlock code={`# Aggiungi ai gruppi
Add-ADGroupMember "DHCP Administrators" -Members svc-ipam
Add-LocalGroupMember -Group "Administrators" -Member "DOMINIO\\svc-ipam"`} />

              <h4 className="text-sm font-semibold">3. Test connessione</h4>
              <CodeBlock code={`# Da una macchina in dominio:
$cred = Get-Credential   # username: DOMINIO\\svc-ipam
Invoke-Command -ComputerName dc01.dominio.fqdn -Credential $cred -ScriptBlock {
  Get-DhcpServerv4Scope | Select ScopeId, Name
}`} />
              <p className="text-xs text-muted-foreground">
                Se restituisce i scope → DA-IPAM funzionerà con la stessa credenziale.
              </p>

              <h4 className="text-sm font-semibold">4. Credenziale DA-IPAM</h4>
              <p className="text-xs">In <code>/credentials</code> crea credenziale Windows:</p>
              <ul className="text-xs list-disc ml-5">
                <li>Username: <code>svc-ipam@dominio.fqdn</code> (UPN, preferito per Kerberos)</li>
                <li>Oppure: <code>DOMINIO\svc-ipam</code> (NetBIOS)</li>
              </ul>
            </TabsContent>

            {/* ────────── Troubleshooting ────────── */}
            <TabsContent value="troubleshoot" className="space-y-3">
              <h4 className="text-sm font-semibold">LDAP bind fallisce con &quot;Inappropriate Authentication&quot;</h4>
              <p className="text-sm">DC richiede LDAP signing. Usare LDAPS (porta 636) o fix lato DC → tab LDAPS.</p>

              <h4 className="text-sm font-semibold mt-4">LDAPS fallisce con &quot;Certificate verification failed&quot;</h4>
              <p className="text-sm">Cert non in <code>Trusted Root</code> del DC. Vedi tab LDAPS §3 (My + Root + restart NTDS).</p>

              <h4 className="text-sm font-semibold mt-4">DHCP sync ritorna 0 scope ma DC ha DHCP attivo (caso 2R)</h4>
              <p className="text-sm">Esegui questa checklist sul DC <strong>con lo stesso account WinRM configurato in DA-IPAM</strong>:</p>
              <CodeBlock code={`# 1. Cmdlet disponibile
Get-Command Get-DhcpServerv4Scope
# Se errore: Install-WindowsFeature RSAT-DHCP

# 2. Servizio DHCP running
Get-Service DHCPServer | Select Status, StartType

# 3. DC autorizzato come DHCP server in AD
Get-DhcpServerInDC
# Se vuoto: Add-DhcpServerInDC

# 4. Scope visibili direttamente
Get-DhcpServerv4Scope

# 5. Permessi: utente in DHCP Administrators
net localgroup "DHCP Administrators"   # cerca svc-ipam

# 6. Test esecuzione via WinRM (replica esatta di DA-IPAM)
Invoke-Command -ComputerName localhost -ScriptBlock {
  Get-DhcpServerv4Scope | ConvertTo-Json -Depth 2 -Compress
}`} />

              <h4 className="text-sm font-semibold mt-4">Sync AD timeout</h4>
              <p className="text-sm">
                Filtri LDAP non indicizzati sul DC, oppure cert TLS lento. Verifica <code>Get-NetTCPConnection -LocalPort 636 -State Established</code>.
              </p>

              <h4 className="text-sm font-semibold mt-4">WinRM connect al DC fallisce con 401</h4>
              <p className="text-sm">
                Verifica formato username (vedi guida WinRM in <code>/credentials</code>). Per DC il formato preferito è
                {" "}<code>svc-ipam@dominio.fqdn</code> (Kerberos).
              </p>

              <h4 className="text-sm font-semibold mt-4">Comandi diagnostici globali sul DC</h4>
              <CodeBlock code={`Get-Service NTDS, ADWS, WinRM, DHCPServer | Format-Table Name, Status
netstat -ano | findstr "389 636 5985 9389"
Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters |
  Select LdapEnforceChannelBinding, LDAPServerIntegrity
Get-ADUser svc-ipam -Properties MemberOf, PasswordLastSet, LockedOut`} />
            </TabsContent>
          </Tabs>

          <div className="mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground flex items-center gap-2">
            <ExternalLink className="h-3 w-3" />
            Riferimento Microsoft:&nbsp;
            <a
              href="https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-over-ssl-3rd-certification-authority"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Enable LDAP over SSL with a third-party CA
            </a>
          </div>
        </DialogScrollableArea>

        <DialogFooter className="px-4 py-3 border-t border-border/50">
          <Button onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
