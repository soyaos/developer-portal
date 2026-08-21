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
import type { PortalDictionary } from "../lib/i18n";

type Messages = PortalDictionary["apiKeys"]["component"];

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

function fmtDate(iso: string | null, never: string, locale: string): string {
  if (!iso) return never;
  return new Date(iso).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function responseError(response: Response, messages: Messages): Promise<Error> {
  try {
    const payload = (await response.json()) as ErrorPayload;
    return new Error(payload.error?.message || `${messages.requestFailed} (${response.status}).`);
  } catch {
    return new Error(`${messages.requestFailed} (${response.status}).`);
  }
}

export function ApiKeysTable({ messages, locale }: { messages: Messages; locale: string }) {
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
      if (!response.ok) throw await responseError(response, messages);
      const payload = (await response.json()) as { keys: ApiKey[] };
      setKeys(payload.keys);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.loadError);
    } finally {
      setLoading(false);
    }
  }, [messages]);

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
    if (!response.ok) throw await responseError(response, messages);
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
      if (!response.ok) throw await responseError(response, messages);
      setKeys((current) => current.filter((key) => key.id !== pendingRevoke.id));
      setPendingRevoke(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.revokeError);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{messages.active}</h2>
          <p className="mt-1 text-xs text-soya-ink/60">
            {messages.grant}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={loading || keys.length >= 3}>
          {messages.create}
        </Button>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void loadKeys()}>
            {messages.retry}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-soya-ink/10 bg-white/60">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-soya-ink/5 text-[11px] uppercase tracking-wider text-soya-ink/60">
            <tr>
              <th className="px-4 py-3 font-medium">{messages.name}</th>
              <th className="px-4 py-3 font-medium">{messages.prefix}</th>
              <th className="px-4 py-3 font-medium">{messages.scopes}</th>
              <th className="px-4 py-3 font-medium">{messages.created}</th>
              <th className="px-4 py-3 font-medium">{messages.lastUsed}</th>
              <th className="px-4 py-3 font-medium text-right">{messages.actions}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-soya-ink/50">
                  {messages.loading}
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-soya-ink/50">
                  {messages.empty}
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
                  <td className="px-4 py-3 text-xs text-soya-ink/70">{fmtDate(key.createdAt, messages.never, locale)}</td>
                  <td className="px-4 py-3 text-xs text-soya-ink/70">{fmtDate(key.lastUsedAt, messages.never, locale)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="danger" onClick={() => setPendingRevoke(key)}>
                      {messages.revoke}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {keys.length >= 3 && (
        <p className="text-xs text-soya-ink/60">{messages.limit}</p>
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createKey}
        onCreated={(key) => setKeys((current) => [key, ...current])}
        messages={messages.createDialog}
      />

      <Dialog open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)}>
        <DialogHeader>
          <DialogTitle>{messages.revokeTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-soya-ink/80">
            {messages.revokeBefore} <code>{pendingRevoke?.name}</code> {messages.revokeAfter}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPendingRevoke(null)} disabled={revoking}>
            {messages.cancel}
          </Button>
          <Button variant="danger" onClick={() => void confirmRevoke()} disabled={revoking}>
            {revoking ? messages.revoking : messages.revokeKey}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
