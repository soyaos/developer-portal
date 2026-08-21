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
import { CreateApiKeyDialog, type CreatedKey } from "./CreateApiKeyDialog";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface ErrorPayload {
  error?: { message?: string };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as ErrorPayload;
    return new Error(payload.error?.message || `Request failed (${response.status}).`);
  } catch {
    return new Error(`Request failed (${response.status}).`);
  }
}

export function ApiKeysTable() {
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pendingRevoke, setPendingRevoke] = React.useState<ApiKey | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  const loadKeys = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/control/v1/api-keys", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw await responseError(response);
      const payload = (await response.json()) as { keys: ApiKey[] };
      setKeys(payload.keys);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const createKey = async (name: string): Promise<CreatedKey> => {
    const response = await fetch("/control/v1/api-keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw await responseError(response);
    return ((await response.json()) as { key: CreatedKey }).key;
  };

  const confirmRevoke = async () => {
    if (!pendingRevoke || revoking) return;
    setRevoking(true);
    setError(null);
    try {
      const response = await fetch(`/control/v1/api-keys/${encodeURIComponent(pendingRevoke.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw await responseError(response);
      setKeys((current) => current.filter((key) => key.id !== pendingRevoke.id));
      setPendingRevoke(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the key.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Active API keys</h2>
          <p className="mt-1 text-xs text-soya-ink/60">
            Keys grant access to <code>GET /v1/models</code> and <code>POST /v1/chat/completions</code>.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={loading || keys.length >= 3}>
          + Create new key
        </Button>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void loadKeys()}>
            Retry
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-soya-ink/10 bg-white/60">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
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
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-soya-ink/50">
                  Loading keys…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-soya-ink/50">
                  No active keys. Create one to run the first Cloud smoke test.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id} className="border-t border-soya-ink/5 hover:bg-soya-accent/5">
                  <td className="px-4 py-3 font-medium tracking-tight">{key.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-soya-ink/80">{key.prefix}…</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} variant="accent">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-soya-ink/70">{fmtDate(key.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-soya-ink/70">{fmtDate(key.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="danger" onClick={() => setPendingRevoke(key)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {keys.length >= 3 && (
        <p className="text-xs text-soya-ink/60">Active key limit reached: revoke a key before creating another.</p>
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createKey}
        onCreated={(key) => setKeys((current) => [key, ...current])}
      />

      <Dialog open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)}>
        <DialogHeader>
          <DialogTitle>Revoke this key?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-soya-ink/80">
            Revoking <code>{pendingRevoke?.name}</code> invalidates it immediately. This cannot be undone.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPendingRevoke(null)} disabled={revoking}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmRevoke()} disabled={revoking}>
            {revoking ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
