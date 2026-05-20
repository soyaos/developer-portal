import * as React from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  CreateApiKeyDialog,
  type CreatedKey,
  type Scope,
} from "./CreateApiKeyDialog";

// TODO(soyaos): replace seed + mutations with the real control-plane API:
//   GET    /control/v0/api-keys
//   POST   /control/v0/api-keys
//   DELETE /control/v0/api-keys/{id}
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: string; // ISO
  lastUsedAt: string | null; // ISO or null
}

const SEED: ApiKey[] = [
  {
    id: "key_01",
    name: "unsafe-dev-local",
    prefix: "sk-soya-dev-9f3b21",
    scopes: ["agents:invoke", "agents:list", "agents:write"],
    createdAt: "2026-05-12T09:14:00Z",
    lastUsedAt: "2026-05-19T16:42:00Z",
  },
  {
    id: "key_02",
    name: "prod-essay-tutor-edge",
    prefix: "sk-soya-prod-7c12aa",
    scopes: ["agents:invoke"],
    createdAt: "2026-04-28T11:02:00Z",
    lastUsedAt: "2026-05-19T18:01:00Z",
  },
  {
    id: "key_03",
    name: "prod-customer-bot",
    prefix: "sk-soya-prod-3e88f0",
    scopes: ["agents:invoke", "agents:list"],
    createdAt: "2026-04-02T07:30:00Z",
    lastUsedAt: "2026-05-18T22:15:00Z",
  },
  {
    id: "key_04",
    name: "ci-smoke-test",
    prefix: "sk-soya-prod-c104a2",
    scopes: ["agents:invoke"],
    createdAt: "2026-03-19T15:45:00Z",
    lastUsedAt: null,
  },
  {
    id: "key_05",
    name: "ops-rotation-canary",
    prefix: "sk-soya-prod-58a91d",
    scopes: ["agents:list"],
    createdAt: "2026-05-01T13:00:00Z",
    lastUsedAt: "2026-05-17T03:11:00Z",
  },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ApiKeysTable() {
  const [keys, setKeys] = React.useState<ApiKey[]>(SEED);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pendingRevoke, setPendingRevoke] = React.useState<ApiKey | null>(null);

  const onCreated = (k: CreatedKey) => {
    // Insert the newly-issued key at the top. We only ever store the
    // prefix locally — the raw key lives inside the dialog and is
    // discarded when it closes.
    setKeys((prev) => [
      {
        id: `key_${(prev.length + 1).toString().padStart(2, "0")}`,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        createdAt: k.createdAt,
        lastUsedAt: null,
      },
      ...prev,
    ]);
  };

  const confirmRevoke = () => {
    if (!pendingRevoke) return;
    setKeys((prev) => prev.filter((k) => k.id !== pendingRevoke.id));
    setPendingRevoke(null);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">API keys</h2>
          <p className="mt-1 text-xs text-soya-ink/60">
            Keys grant access to <code>POST /v1/chat/completions</code> and the
            control plane. Treat them like passwords — rotate often.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Create new key</Button>
      </header>

      <div className="overflow-hidden rounded-xl border border-soya-ink/10 bg-white/60">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-soya-ink/5 text-[11px] uppercase tracking-wider text-soya-ink/60">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Prefix</th>
              <th className="px-4 py-3 font-medium">Scopes</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-xs text-soya-ink/50"
                >
                  No active keys. Click <em>Create new key</em> to issue one.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr
                  key={k.id}
                  className="border-t border-soya-ink/5 hover:bg-soya-accent/5"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium tracking-tight text-soya-ink">
                      {k.name}
                    </div>
                    {k.name === "unsafe-dev-local" && (
                      <Badge variant="danger" className="mt-1">
                        dev only
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs text-soya-ink/80">
                    {k.prefix}…
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="accent">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-soya-ink/70">
                    {fmtDate(k.createdAt)}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-soya-ink/70">
                    {fmtDate(k.lastUsedAt)}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setPendingRevoke(k)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onCreated}
      />

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
      >
        <DialogHeader>
          <DialogTitle>Revoke this key?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-soya-ink/80">
            Revoking <code>{pendingRevoke?.name}</code> immediately invalidates
            it. Any service still using the key will start receiving
            <code className="ml-1">401 unauthorized</code>.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPendingRevoke(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmRevoke}>
            Revoke key
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
