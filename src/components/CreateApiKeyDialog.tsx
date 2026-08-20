import * as React from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

export interface CreatedKey {
  id: string;
  name: string;
  scopes: string[];
  prefix: string;
  rawKey: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<CreatedKey>;
  onCreated: (key: CreatedKey) => void;
}

export function CreateApiKeyDialog({ open, onOpenChange, onCreate, onCreated }: Props) {
  const [name, setName] = React.useState("");
  const [issued, setIssued] = React.useState<CreatedKey | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setIssued(null);
      setCopied(false);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await onCreate(trimmed);
      setIssued(created);
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the key.");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.rawKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // The raw key stays visible for manual copy when Clipboard API is unavailable.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{issued ? "Your new API key" : "Create new API key"}</DialogTitle>
        <p className="mt-1 text-xs text-soya-ink/60">
          {issued
            ? "Copy this key now — it will never be shown again."
            : "The Preview key can list models and call chat completions."}
        </p>
      </DialogHeader>

      {issued ? (
        <DialogBody className="space-y-4">
          <div className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
            This is the only time SoyaOS will display the raw key.
          </div>
          <div className="rounded-md border border-soya-ink/10 bg-white/80 p-3 font-mono text-xs break-all">
            {issued.rawKey}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-soya-ink/60">
            <span className="flex flex-wrap gap-1">
              {issued.scopes.map((scope) => (
                <Badge key={scope} variant="accent">
                  {scope}
                </Badge>
              ))}
            </span>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? "Copied!" : "Copy to clipboard"}
            </Button>
          </div>
        </DialogBody>
      ) : (
        <DialogBody className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium tracking-tight text-soya-ink/80">Key name</span>
            <Input
              className="mt-1"
              placeholder="preview-smoke-test"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void submit()}
              autoFocus
            />
            <span className="mt-1 block text-[11px] text-soya-ink/50">
              1–64 characters. You can keep at most three active keys.
            </span>
          </label>
          {error && (
            <div role="alert" className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </DialogBody>
      )}

      <DialogFooter>
        {issued ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || submitting}>
              {submitting ? "Creating…" : "Create key"}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
