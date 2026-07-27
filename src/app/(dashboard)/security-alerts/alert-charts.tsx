"use client";

/**
 * Grafici degli alert di sicurezza.
 *
 * Colori: slot categorici in ordine FISSO per id di categoria, così il colore
 * segue l'entità e non la sua posizione — filtrando una categoria le altre non
 * cambiano tinta. Palette validata (light e dark) con lo script della skill
 * dataviz: separazione CVD e banda di luminosità superate in entrambe le
 * modalità. In chiaro tre tinte restano sotto 3:1 di contrasto, per questo la
 * legenda porta sempre il valore accanto al colore e la tabella sottostante
 * resta la vista testuale di riferimento.
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface CategorySlice {
  id: string;
  labelIt: string;
  count: number;
  diagnostic: boolean;
}
export type SeriesRow = { bucket: string } & Record<string, number | string>;

/** Ordine fisso: mai ciclato, mai riassegnato in base al volume. */
const SERIES_SLOT: Record<string, number> = {
  ransomware: 1,
  auth_failure: 2,
  privileged_change: 3,
  log_tampering: 4,
  agent_health: 5,
  self_probe: 6,
};

export function seriesColor(categoryId: string): string {
  const slot = SERIES_SLOT[categoryId] ?? 6;
  return `var(--series-${slot})`;
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatBucket(iso: string, interval: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return interval === "1d"
    ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
    : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit" });
}

interface TooltipEntry {
  name?: string;
  value?: number;
  dataKey?: string | number;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  interval,
  labels,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  interval: string;
  labels: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((p) => (p.value ?? 0) > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border bg-[var(--chart-surface)] px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">
        {formatBucket(String(label), interval)}
      </div>
      {rows.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: p.color }}
            aria-hidden
          />
          <span className="text-muted-foreground">
            {labels[String(p.dataKey)] ?? String(p.dataKey)}
          </span>
          <span className="ml-auto font-medium tabular-nums text-foreground">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 flex gap-2 border-t pt-1">
        <span className="text-muted-foreground">Totale</span>
        <span className="ml-auto font-medium tabular-nums text-foreground">{total}</span>
      </div>
    </div>
  );
}

export function AlertsOverTime({
  series,
  categories,
  interval,
}: {
  series: SeriesRow[];
  categories: CategorySlice[];
  interval: string;
}) {
  if (series.length === 0 || categories.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Nessun alert nella finestra selezionata.
      </p>
    );
  }
  const labels = Object.fromEntries(categories.map((c) => [c.id, c.labelIt]));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(v: string) => formatBucket(v, interval)}
          tick={{ fontSize: 11, fill: "var(--chart-ink-muted)" }}
          stroke="var(--chart-grid)"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--chart-ink-muted)" }}
          stroke="var(--chart-grid)"
          width={44}
          tickFormatter={compact}
        />
        <Tooltip
          cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }}
          content={<ChartTooltip interval={interval} labels={labels} />}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v: string) => (
            <span style={{ color: "var(--chart-ink-muted)" }}>{labels[v] ?? v}</span>
          )}
        />
        {categories.map((c, i) => (
          <Bar
            key={c.id}
            dataKey={c.id}
            stackId="alerts"
            fill={seriesColor(c.id)}
            // 2px nel colore della superficie: è il distanziatore fra i segmenti
            stroke="var(--chart-surface)"
            strokeWidth={2}
            maxBarSize={24}
            radius={i === categories.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AlertsComposition({ categories }: { categories: CategorySlice[] }) {
  const total = categories.reduce((s, c) => s + c.count, 0);
  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Nessun alert da comporre.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 md:flex-row">
      <ResponsiveContainer width="100%" height={220} className="md:max-w-[240px]">
        <PieChart>
          <Pie
            data={categories}
            dataKey="count"
            nameKey="labelIt"
            innerRadius={52}
            outerRadius={88}
            paddingAngle={2}
            stroke="var(--chart-surface)"
            strokeWidth={2}
          >
            {categories.map((c) => (
              <Cell key={c.id} fill={seriesColor(c.id)} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as CategorySlice;
              return (
                <div className="rounded-md border bg-[var(--chart-surface)] px-3 py-2 text-xs shadow-md">
                  <div className="font-medium text-foreground">{d.labelIt}</div>
                  <div className="text-muted-foreground">
                    {d.count} alert · {((d.count / total) * 100).toFixed(1)}%
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* La legenda porta il valore accanto al colore: è il sostegno testuale
          richiesto dalle tinte a basso contrasto in modalità chiara. */}
      <ul className="w-full flex-1 space-y-1.5 text-sm">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: seriesColor(c.id) }}
              aria-hidden
            />
            <span className="truncate text-muted-foreground">
              {c.labelIt}
              {c.diagnostic ? " (diagnostica)" : ""}
            </span>
            <span className="ml-auto shrink-0 font-medium tabular-nums">
              {compact(c.count)}
            </span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {((c.count / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-[var(--chart-surface)] p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {typeof value === "number" ? compact(value) : value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export interface TargetedAccount {
  account: string;
  count: number;
  sourceIp: string | null;
  workstation: string | null;
  detectedBy: string | null;
  lastSeenAt: string | null;
  system: "windows" | "microsoft365" | "linux" | "altro";
  kind: "utente" | "computer";
}

const SYSTEM_LABEL: Record<TargetedAccount["system"], string> = {
  windows: "Windows",
  microsoft365: "Microsoft 365",
  linux: "Linux",
  altro: "Altro",
};

/**
 * Chi viene bersagliato dai tentativi falliti, con l'origine.
 *
 * Barre orizzontali a tinta unica: è una sola serie, quindi un solo colore per
 * ogni barra — colorare "più scuro dove più grande" raddoppierebbe l'encoding
 * della lunghezza e brucerebbe l'unico canale libero. Nomi lunghi ⇒ orizzontale.
 */
/** Il loopback dice solo "e' successo su quella macchina": lo dice gia' il nome. */
function originLabel(a: TargetedAccount): string {
  const ip = a.sourceIp && a.sourceIp !== "127.0.0.1" && a.sourceIp !== "::1" ? a.sourceIp : null;
  if (a.workstation && ip) return `${a.workstation} · ${ip}`;
  return a.workstation ?? ip ?? "—";
}

const ACCOUNTS_PER_PAGE = 10;

export function TargetedAccounts({ accounts }: { accounts: TargetedAccount[] }) {
  const [page, setPage] = useState(0);
  if (accounts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nessun account con tentativi falliti nella finestra selezionata.
      </p>
    );
  }
  // La scala delle barre resta ancorata al massimo ASSOLUTO, non a quello della
  // pagina: altrimenti a pagina 3 un account con 3 tentativi disegnerebbe una
  // barra piena e sembrerebbe grave quanto il primo della classifica.
  const max = Math.max(...accounts.map((a) => a.count), 1);
  const pages = Math.ceil(accounts.length / ACCOUNTS_PER_PAGE);
  const current = Math.min(page, pages - 1);
  const visible = accounts.slice(
    current * ACCOUNTS_PER_PAGE,
    current * ACCOUNTS_PER_PAGE + ACCOUNTS_PER_PAGE,
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-normal">Account bersagliato</th>
            <th className="pb-2 font-normal">Sistema</th>
            <th className="pb-2 font-normal">Tentativi falliti</th>
            <th className="pb-2 font-normal">Da dove parte il tentativo</th>
            <th className="pb-2 font-normal">Rilevato da</th>
            <th className="pb-2 text-right font-normal">Ultimo</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr key={`${a.system}-${a.account}`} className="border-t">
              <td className="py-2 pr-3">
                <span className="font-medium">{a.account}</span>
                {a.kind === "computer" ? (
                  <span className="ml-2 rounded border px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                    account computer
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">
                {SYSTEM_LABEL[a.system]}
              </td>
              <td className="w-1/2 py-2 pr-3">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 rounded-r-sm"
                    style={{
                      width: `${Math.max(2, (a.count / max) * 100)}%`,
                      background: "var(--series-1)",
                    }}
                    aria-hidden
                  />
                  <span className="shrink-0 tabular-nums">{compact(a.count)}</span>
                </div>
              </td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">
                {originLabel(a)}
              </td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">
                {a.detectedBy ?? "—"}
              </td>
              <td className="py-2 text-right text-xs tabular-nums text-muted-foreground">
                {a.lastSeenAt
                  ? new Date(a.lastSeenAt).toLocaleString("it-IT", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pages > 1 ? (
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {accounts.length} account con tentativi falliti · pagina {current + 1} di {pages}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
            >
              Precedente
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
            >
              Successiva
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
