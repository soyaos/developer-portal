import * as React from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface UsageData {
  window: { from: string; to: string; resetsAt: string };
  quota: {
    requestLimit: number;
    requestUsed: number;
    tokenLimit: number;
    tokenUsed: number;
  };
  rows: Array<{
    keyPrefix: string;
    model: string;
    requests: number;
    tokens: number;
    errors: number;
    avgLatencyMs: number;
  }>;
}

interface Trace {
  requestId: string;
  traceId: string;
  keyPrefix: string;
  model: string;
  status: "success" | "error";
  errorCode: string | null;
  latencyMs: number;
  createdAt: string;
}

interface ErrorPayload {
  error?: { message?: string };
}

async function parseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as ErrorPayload;
    return new Error(payload.error?.message || `Request failed (${response.status}).`);
  } catch {
    return new Error(`Request failed (${response.status}).`);
  }
}

function fmtInt(value: number): string {
  return value.toLocaleString();
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-soya-ink/10 bg-white/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-soya-ink/50">{label}</p>
      <p className="mt-2 font-mono text-2xl tracking-tight text-soya-ink">{value}</p>
      <p className="mt-1 text-[11px] text-soya-ink/50">{hint}</p>
    </div>
  );
}

export function UsagePanel() {
  const [usage, setUsage] = React.useState<UsageData | null>(null);
  const [traces, setTraces] = React.useState<Trace[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageResponse, tracesResponse] = await Promise.all([
        fetch("/control/v1/usage", { credentials: "same-origin", headers: { accept: "application/json" } }),
        fetch("/control/v1/traces", { credentials: "same-origin", headers: { accept: "application/json" } }),
      ]);
      if (!usageResponse.ok) throw await parseError(usageResponse);
      if (!tracesResponse.ok) throw await parseError(tracesResponse);
      const [nextUsage, tracePayload] = await Promise.all([
        usageResponse.json() as Promise<UsageData>,
        tracesResponse.json() as Promise<{ traces: Trace[] }>,
      ]);
      setUsage(nextUsage);
      setTraces(tracePayload.traces);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="rounded-xl border border-soya-ink/10 bg-white/60 p-8 text-center text-sm text-soya-ink/60">Loading usage…</p>;
  }

  if (error || !usage) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-400/40 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span>{error ?? "Usage is unavailable."}</span>
        <Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant="accent">live tenant data</Badge>
        <p className="text-xs text-soya-ink/60">Resets {fmtDate(usage.window.resetsAt)} (UTC boundary)</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Requests today" value={fmtInt(usage.quota.requestUsed)} hint={`of ${fmtInt(usage.quota.requestLimit)} daily`} />
        <KpiCard label="Tokens today" value={fmtInt(usage.quota.tokenUsed)} hint={`of ${fmtInt(usage.quota.tokenLimit)} daily`} />
        <KpiCard label="Request remaining" value={fmtInt(Math.max(0, usage.quota.requestLimit - usage.quota.requestUsed))} hint="UTC day" />
        <KpiCard label="Token remaining" value={fmtInt(Math.max(0, usage.quota.tokenLimit - usage.quota.tokenUsed))} hint="UTC day" />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Today by key and model</h2>
        <div className="overflow-x-auto rounded-xl border border-soya-ink/10 bg-white/60">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="bg-soya-ink/5 text-[11px] uppercase tracking-wider text-soya-ink/60">
              <tr>
                <th className="px-4 py-3 font-medium">Key prefix</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 text-right font-medium">Requests</th>
                <th className="px-4 py-3 text-right font-medium">Tokens</th>
                <th className="px-4 py-3 text-right font-medium">Errors</th>
                <th className="px-4 py-3 text-right font-medium">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-soya-ink/50">No requests recorded today.</td></tr>
              ) : usage.rows.map((row) => (
                <tr key={`${row.keyPrefix}-${row.model}`} className="border-t border-soya-ink/5">
                  <td className="px-4 py-3 font-mono text-xs">{row.keyPrefix}…</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.model}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInt(row.requests)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInt(row.tokens)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInt(row.errors)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInt(row.avgLatencyMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Recent traces</h2>
        <p className="mb-3 text-xs text-soya-ink/60">Metadata only, retained for 24 hours. Prompt and response bodies are never stored.</p>
        <div className="overflow-x-auto rounded-xl border border-soya-ink/10 bg-white/60">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead className="bg-soya-ink/5 text-[11px] uppercase tracking-wider text-soya-ink/60">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Trace</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {traces.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-soya-ink/50">No traces in the last 24 hours.</td></tr>
              ) : traces.map((trace) => (
                <tr key={trace.requestId} className="border-t border-soya-ink/5">
                  <td className="px-4 py-3 text-xs">{fmtDate(trace.createdAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{trace.traceId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{trace.model}</td>
                  <td className="px-4 py-3 font-mono text-xs">{trace.keyPrefix}…</td>
                  <td className="px-4 py-3"><Badge variant={trace.status === "success" ? "accent" : "danger"}>{trace.errorCode ?? trace.status}</Badge></td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInt(trace.latencyMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
