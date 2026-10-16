/**
 * Snippet PowerShell condiviso per accettare il cert self-signed di MeshCentral.
 *
 * SORGENTE UNICA di questo blocco: lo usano SIA lo script generato dalla UI
 * (integrations/meshcentral/install-scripts.ts) SIA quello eseguito via push
 * WinRM (patch/ps-scripts.ts). Erano due copie divergenti e il push era rotto
 * da mesi senza che nessuno se ne accorgesse: tenerlo in un posto solo e' il
 * punto di questo file. Se un giorno MeshCentral avra' un cert valido, si
 * cancella qui una volta sola.
 *
 * PERCHE' Add-Type E NON `ServerCertificateValidationCallback = { $true }`:
 * quel callback e' uno ScriptBlock. In una sessione interattiva funziona, ma
 * sotto WinRM .NET lo invoca dal thread della connessione, dove non esiste un
 * runspace PowerShell in cui eseguirlo: il callback solleva eccezione e
 * Invoke-WebRequest fallisce con
 *   "Connessione sottostante chiusa: Errore imprevisto durante un'operazione di invio"
 * Verificato dal vivo su RGSERVER (Windows Server 2022, PS 5.1.20348.2400) il
 * 2026-07-17, isolando le due varianti nella stessa sessione WinRM:
 *   ScriptBlock -> FAIL (errore di invio)      Add-Type/ICertificatePolicy -> OK status=200
 * Nota diagnostica: l'handshake TLS grezzo (SslStream) riusciva gia' — TLS 1.3,
 * AES256 — quindi non era ne' rete ne' versione di protocollo.
 *
 * ICertificatePolicy e' deprecata in .NET Core: su PowerShell 7+ viene ignorata,
 * ma li' il callback ScriptBlock funziona, quindi usiamo quello.
 */

/** Nome del tipo compilato: usato anche per l'idempotenza dell'Add-Type. */
const TRUST_TYPE = "DomarcTrustAllCertsPolicy";

/**
 * Blocco PS che disattiva la validazione del cert TLS.
 * Escape hatch: DA_IPAM_INSECURE_SSL=0 ripristina la validazione (da usare
 * quando MeshCentral avra' un certificato valido).
 */
export const PS_TRUST_SELF_SIGNED = `[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
if ($env:DA_IPAM_INSECURE_SSL -ne '0') {
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Windows PowerShell 5.1 (quello che gira sotto WinRM): serve un tipo
    # COMPILATO. Con uno ScriptBlock callback Invoke-WebRequest fallisce con
    # "Errore imprevisto durante un'operazione di invio" (vedi src/lib/ps-tls.ts).
    if (-not ('${TRUST_TYPE}' -as [type])) {
      Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class ${TRUST_TYPE} : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate c, WebRequest r, int p) { return true; }
}
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object ${TRUST_TYPE}
  } else {
    # PowerShell 7+: ICertificatePolicy viene ignorata, ma qui il callback va bene.
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  }
}`;
