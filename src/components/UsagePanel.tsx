import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Badge } from "./ui/badge";

// TODO(soyaos): replace MOCK_USAGE with a real fetch:
//
//   const res = await fetch(
//     `/control/v0/usage?window=${win}`,
//     { credentials: "include" },
//   );
//   const usage = await res.json();
//
// Server should aggregate (api_key_prefix × agent_slug × sandbox_image)
// over the requested window and return KPI totals plus the row list.

type Window = "today" | "7d" | "30d";

interface Row {
  keyPrefix: string;
  agentSlug: string;
  sandboxImage: string;
  calls: number;
  vcpuSeconds: number;
  gpuSeconds: number;
  costUsd: number;
}

interface WindowData {
  kpi: {
    calls: number;
    vcpuSeconds: number;
    gpuSeconds: number;
    bytesOut: number;
  };
  rows: Row[];
}

const MOCK_USAGE: Record<Window, WindowData> = {
  today: {
    kpi: { calls: 1284, vcpuSeconds: 962, gpuSeconds: 41, bytesOut: 18_932_104 },
    rows: [
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 612,
        vcpuSeconds: 480,
        gpuSeconds: 12,
        costUsd: 3.42,
      },
      {
        keyPrefix: "sk-soya-prod-3e88f0",
        agentSlug: "customer-bot",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 401,
        vcpuSeconds: 310,
        gpuSeconds: 0,
        costUsd: 1.81,
      },
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-cuda:12.4",
        calls: 51,
        vcpuSeconds: 90,
        gpuSeconds: 29,
        costUsd: 4.93,
      },
      {
        keyPrefix: "sk-soya-dev-9f3b21",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 220,
        vcpuSeconds: 82,
        gpuSeconds: 0,
        costUsd: 0.41,
      },
    ],
  },
  "7d": {
    kpi: { calls: 8_902, vcpuSeconds: 6_741, gpuSeconds: 312, bytesOut: 142_198_004 },
    rows: [
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 4_120,
        vcpuSeconds: 3_240,
        gpuSeconds: 80,
        costUsd: 22.10,
      },
      {
        keyPrefix: "sk-soya-prod-3e88f0",
        agentSlug: "customer-bot",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 2_805,
        vcpuSeconds: 2_104,
        gpuSeconds: 4,
        costUsd: 12.62,
      },
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-cuda:12.4",
        calls: 380,
        vcpuSeconds: 612,
        gpuSeconds: 198,
        costUsd: 33.66,
      },
      {
        keyPrefix: "sk-soya-prod-58a91d",
        agentSlug: "ops-canary",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 1_120,
        vcpuSeconds: 410,
        gpuSeconds: 0,
        costUsd: 2.05,
      },
      {
        keyPrefix: "sk-soya-dev-9f3b21",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 477,
        vcpuSeconds: 375,
        gpuSeconds: 30,
        costUsd: 1.88,
      },
    ],
  },
  "30d": {
    kpi: { calls: 38_510, vcpuSeconds: 29_402, gpuSeconds: 1_409, bytesOut: 612_409_881 },
    rows: [
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 18_204,
        vcpuSeconds: 14_220,
        gpuSeconds: 360,
        costUsd: 96.41,
      },
      {
        keyPrefix: "sk-soya-prod-3e88f0",
        agentSlug: "customer-bot",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 12_004,
        vcpuSeconds: 9_201,
        gpuSeconds: 14,
        costUsd: 55.13,
      },
      {
        keyPrefix: "sk-soya-prod-7c12aa",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-cuda:12.4",
        calls: 1_602,
        vcpuSeconds: 2_807,
        gpuSeconds: 901,
        costUsd: 152.34,
      },
      {
        keyPrefix: "sk-soya-prod-58a91d",
        agentSlug: "ops-canary",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 4_822,
        vcpuSeconds: 1_799,
        gpuSeconds: 0,
        costUsd: 8.99,
      },
      {
        keyPrefix: "sk-soya-prod-c104a2",
        agentSlug: "ci-smoke",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 1_400,
        vcpuSeconds: 1_001,
        gpuSeconds: 12,
        costUsd: 6.04,
      },
      {
        keyPrefix: "sk-soya-dev-9f3b21",
        agentSlug: "essay-tutor-v2",
        sandboxImage: "soya-sandbox-py:3.11",
        calls: 478,
        vcpuSeconds: 374,
        gpuSeconds: 122,
        costUsd: 9.21,
      },
    ],
  },
};

type SortKey = "calls" | "vcpuSeconds" | "gpuSeconds" | "costUsd";
type SortDir = "asc" | "desc";

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
}

function KpiCard({ label, value, hint }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-soya-ink/10 bg-white/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-soya-ink/50">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tracking-tight text-soya-ink">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[11px] text-soya-ink/50">{hint}</p>
      )}
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (field: SortKey) => void;
  className?: string;
}

function SortableHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  className,
}: SortableHeaderProps) {
  const active = field === sortKey;
  return (
    <th
      className={`px-4 py-3 font-medium ${className ?? ""}`.trim()}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 transition hover:text-soya-ink ${
          active ? "text-soya-ink" : "text-soya-ink/60"
        }`}
      >
        {label}
        <span className="text-[10px]">
          {active ? (sortDir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function UsagePanel() {
  const [win, setWin] = React.useState<Window>("today");
  const [sortKey, setSortKey] = React.useState<SortKey>("costUsd");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const data = MOCK_USAGE[win];

  const sortedRows = React.useMemo(() => {
    const copy = [...data.rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  const onSort = (field: SortKey) => {
    if (field === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(field);
      setSortDir("desc");
    }
  };

  return (
    <Tabs
      value={win}
      onValueChange={(v) => setWin(v as Window)}
      className="space-y-6"
    >
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="7d">7 days</TabsTrigger>
          <TabsTrigger value="30d">30 days</TabsTrigger>
        </TabsList>
        <Badge variant="muted">mock data</Badge>
      </div>

      {(["today", "7d", "30d"] as Window[]).map((w) => (
        <TabsContent key={w} value={w} className="space-y-6">
          {/* KPI cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Calls"
              value={fmtInt(MOCK_USAGE[w].kpi.calls)}
              hint="counted after auth + rate-limit"
            />
            <KpiCard
              label="vCPU·s"
              value={fmtInt(MOCK_USAGE[w].kpi.vcpuSeconds)}
              hint="100ms granularity, ceil to s"
            />
            <KpiCard
              label="GPU·s"
              value={fmtInt(MOCK_USAGE[w].kpi.gpuSeconds)}
              hint="A10G-equivalent normalized"
            />
            <KpiCard
              label="Bytes out"
              value={fmtBytes(MOCK_USAGE[w].kpi.bytesOut)}
              hint="egress from sandbox network"
            />
          </div>

          {/* Breakdown table */}
          <div className="overflow-hidden rounded-xl border border-soya-ink/10 bg-white/60">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-soya-ink/5 text-[11px] uppercase tracking-wider text-soya-ink/60">
                <tr>
                  <th className="px-4 py-3 font-medium">Key prefix</th>
                  <th className="px-4 py-3 font-medium">Agent slug</th>
                  <th className="px-4 py-3 font-medium">Sandbox image</th>
                  <SortableHeader
                    label="Calls"
                    field="calls"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="text-right"
                  />
                  <SortableHeader
                    label="vCPU·s"
                    field="vcpuSeconds"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="text-right"
                  />
                  <SortableHeader
                    label="GPU·s"
                    field="gpuSeconds"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="text-right"
                  />
                  <SortableHeader
                    label="Cost USD"
                    field="costUsd"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="text-right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={`${row.keyPrefix}-${row.agentSlug}-${row.sandboxImage}`}
                    className="border-t border-soya-ink/5 hover:bg-soya-accent/5"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-soya-ink/80">
                      {row.keyPrefix}…
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium tracking-tight">
                        {row.agentSlug}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-soya-ink/70">
                      {row.sandboxImage}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {fmtInt(row.calls)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {fmtInt(row.vcpuSeconds)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {fmtInt(row.gpuSeconds)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-soya-accent">
                      {fmtUsd(row.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      ))}

      <footer className="rounded-xl border border-soya-ink/10 bg-soya-accent/[0.05] p-4 text-xs leading-relaxed text-soya-ink/70">
        <strong className="text-soya-ink">Billing rules.</strong> Sandbox
        runtime is sampled at <code>100ms</code> granularity and rounded
        <em>up</em> to the next whole second per call. vCPU and GPU seconds
        are billed separately; GPU seconds use A10G-equivalent normalization.
        Egress bytes are metered at the sandbox network boundary.
        {" "}
        {/* TODO(soyaos): replace MOCK_USAGE with GET /control/v0/usage?window=... */}
      </footer>
    </Tabs>
  );
}
