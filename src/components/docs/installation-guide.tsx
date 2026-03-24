"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CodeCopyBlock } from "@/components/docs/code-copy-block";

/** Percorso standard applicazione (VM, CT, bare metal) */
const APP_DIR = "/opt/da-invent";

/** Clone bootstrap sul nodo Proxmox (default script) */
const NODE_CLONE_DEFAULT = "/root/da-invent-install";

const SNIPPET_PROXMOX_BOOTSTRAP = `curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-proxmox.sh -o /tmp/da-invent-bootstrap.sh \\
  && bash /tmp/da-invent-bootstrap.sh`;

const SNIPPET_PROXMOX_WIZARD_FROM_CLONE = `cd ${NODE_CLONE_DEFAULT}
chmod +x scripts/proxmox-lxc-install.sh
./scripts/proxmox-lxc-install.sh`;

const SNIPPET_LINUX_BOOTSTRAP_PIPE = `curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-linux.sh | sudo bash`;

const SNIPPET_LINUX_BOOTSTRAP_FILE = `curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-linux.sh -o /tmp/da-invent-bootstrap-linux.sh \\
  && sudo bash /tmp/da-invent-bootstrap-linux.sh`;

const SNIPPET_GIT_INSTALL_IN_TARGET = `git clone https://github.com/grandir66/DA-IPAM.git ${APP_DIR}
cd ${APP_DIR}
chmod +x scripts/install.sh
sudo ./scripts/install.sh --systemd`;

const SNIPPET_UPDATE_INSTANCE = `cd ${APP_DIR}
./scripts/update.sh --restart`;

export function InstallationGuide() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Installazione</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Comandi ufficiali con percorsi espliciti: sul nodo Proxmox (wizard LXC), oppure dentro VM, CT o altro
          container Linux Debian/Ubuntu l&apos;app va in <code className="text-xs bg-muted px-1 rounded">{APP_DIR}</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tre scenari</CardTitle>
          <CardDescription>
            Stesso repository Git ovunque; cambia solo <strong>dove</strong> apri la shell (nodo PVE vs interno CT/VM).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-6 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead className="min-w-[140px]">Dove esegui i comandi</TableHead>
                <TableHead>Installer facilitato</TableHead>
                <TableHead>Alternativa (git + install.sh)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">1</TableCell>
                <TableCell className="text-sm">
                  <strong>Proxmox VE</strong> — crei un container LXC dal nodo
                </TableCell>
                <TableCell className="text-sm">
                  Shell <strong>root</strong> sul <strong>nodo</strong> Proxmox (mai nel CT per il wizard pct)
                </TableCell>
                <TableCell className="text-sm">
                  <code className="text-[11px] bg-muted px-1 rounded">bootstrap-proxmox.sh</code> scarica il repo sul nodo e
                  lancia <code className="text-[11px] bg-muted px-1 rounded">proxmox-lxc-install.sh</code> (wizard pct). Nel CT
                  puoi rispondere sì all&apos;installazione automatica: <code className="text-[11px] bg-muted px-1 rounded">git clone</code>{" "}
                  in <code className="text-[11px] bg-muted px-1 rounded">{APP_DIR}</code> e{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">install.sh --systemd</code>
                </TableCell>
                <TableCell className="text-sm">
                  Sul nodo con clone già presente:{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">./scripts/proxmox-lxc-install.sh</code> dalla root del repo.
                  <strong className="block mt-1">Dentro il CT</strong> (senza auto-install):{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">bootstrap-linux.sh</code> oppure clone manuale +{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">./scripts/install.sh --systemd</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">2</TableCell>
                <TableCell className="text-sm">
                  <strong>VM o bare metal</strong> — Debian/Ubuntu come OS principale (senza creare un CT in questa guida)
                </TableCell>
                <TableCell className="text-sm">
                  Shell <strong>root</strong> (o <code className="text-[11px] bg-muted px-1 rounded">sudo</code>) dentro la VM o sul server fisico
                </TableCell>
                <TableCell className="text-sm">
                  <code className="text-[11px] bg-muted px-1 rounded">bootstrap-linux.sh</code> (una riga curl da raw GitHub): dipendenze minime, clone in{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">{APP_DIR}</code>, poi{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">install.sh --systemd</code>
                </TableCell>
                <TableCell className="text-sm">
                  <code className="text-[11px] bg-muted px-1 rounded">git clone</code> verso{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">{APP_DIR}</code>, poi{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">chmod +x scripts/install.sh</code> e{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">sudo ./scripts/install.sh --systemd</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">3</TableCell>
                <TableCell className="text-sm">
                  <strong>Container Linux</strong> — stesso percorso dello scenario 2, ma dentro il CT (LXC altro host, Docker Debian/Ubuntu, ecc.)
                </TableCell>
                <TableCell className="text-sm">
                  Shell <strong>root</strong> <strong>dentro il container</strong>
                </TableCell>
                <TableCell className="text-sm">
                  Stesso <code className="text-[11px] bg-muted px-1 rounded">bootstrap-linux.sh</code> (serve rete verso GitHub e NodeSource)
                </TableCell>
                <TableCell className="text-sm">
                  Stesso <code className="text-[11px] bg-muted px-1 rounded">git clone</code> +{" "}
                  <code className="text-[11px] bg-muted px-1 rounded">install.sh</code> in <code className="text-[11px] bg-muted px-1 rounded">{APP_DIR}</code>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenario 1 — nodo Proxmox (bootstrap)</CardTitle>
          <CardDescription>
            Solo sul nodo: salva lo script su disco (non usare <code className="text-xs bg-muted px-1 rounded">curl … | bash</code>) così il wizard resta interattivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CodeCopyBlock title="Scarica ed esegui bootstrap (due righe)" code={SNIPPET_PROXMOX_BOOTSTRAP} />
          <p className="text-xs text-muted-foreground">
            Dopo il clone, la directory predefinita sul nodo è spesso <code className="bg-muted px-1 rounded">{NODE_CLONE_DEFAULT}</code> (variabile{" "}
            <code className="bg-muted px-1 rounded">DA_INVENT_BOOTSTRAP_DIR</code>). Adatta <code className="bg-muted px-1 rounded">cd</code> se hai clonato altrove.
          </p>
          <CodeCopyBlock
            title="Solo wizard LXC (repo già sul nodo)"
            code={SNIPPET_PROXMOX_WIZARD_FROM_CLONE}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenari 2 e 3 — VM, bare metal, CT, container Linux</CardTitle>
          <CardDescription>
            L&apos;applicazione risiede in <code className="text-xs bg-muted px-1 rounded">{APP_DIR}</code>. Esegui i comandi{" "}
            <strong>sulla macchina dove deve girare Node</strong> (non sul nodo Proxmox, salvo pct exec).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CodeCopyBlock title="Bootstrap Linux (una riga, con sudo)" code={SNIPPET_LINUX_BOOTSTRAP_PIPE} />
          <CodeCopyBlock title="Bootstrap Linux (script salvato, due righe)" code={SNIPPET_LINUX_BOOTSTRAP_FILE} />
          <CodeCopyBlock
            title="Manuale: clone in /opt/da-invent poi install (quattro righe)"
            code={SNIPPET_GIT_INSTALL_IN_TARGET}
          />
          <p className="text-xs text-muted-foreground border-t border-border pt-4">
            <strong>Docker / Podman:</strong> usa un&apos;immagine Debian o Ubuntu, entra in shell come root, assicurati che{" "}
            <code className="bg-muted px-1 rounded">{APP_DIR}</code> sia persistente (volume) se il container è effimero, poi gli stessi comandi dello scenario 2 dentro il container.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dopo il deploy — aggiornamenti</CardTitle>
          <CardDescription>
            Dalla directory dell&apos;istanza (es. <code className="text-xs bg-muted px-1 rounded">{APP_DIR}</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeCopyBlock code={SNIPPET_UPDATE_INSTANCE} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Documentazione estesa: file <code className="bg-muted px-1 rounded">README.md</code> nel repository e{" "}
        <code className="bg-muted px-1 rounded">docs/INSTALLAZIONE-PROXMOX.md</code>.
      </p>
    </div>
  );
}
