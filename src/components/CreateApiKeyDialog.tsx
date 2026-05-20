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

export type Scope = "agents:invoke" | "agents:list" | "agents:write";

export const ALL_SCOPES: Array<{ id: Scope; label: string; hint: string }> = [
  { id: "agents:invoke", label: "agents:invoke", hint: "Call /v1/chat against any soya:* model." },
  { id: "agents:list", label: "agents:list",   hint: "Read-only listing of Agents in this org." },
  { id: "agents:write", label: "agents:write", hint: "Create, update and delete Agent definitions." },
];

export interface CreatedKey {
  name: string;
  scopes: Scope[];
  prefix: string;
  rawKey: string; // one-time, never shown again
  createdAt: string; // ISO
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: CreatedKey) => void;
}

function makeRawKey(): string {
  // TODO(soyaos): swap with the value returned from
  //   POST /control/v0/api-keys
  // The control plane signs raw keys with our HMAC issuing key and stores
  // only the bcrypt hash; the raw string is never persisted client-side.
  const random =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2).padEnd(24, "0");
  return `sk-soya-prod-${random.slice(0, 12)}`;
}

export function CreateApiKeyDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<Scope[]>(["agents:invoke"]);
  const [issued, setIssued] = React.useState<CreatedKey | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Reset internal state whenever the dialog opens fresh.
  React.useEffect(() => {
    if (open) {
      setName("");
      setScopes(["agents:invoke"]);
      setIssued(null);
      setCopied(false);
    }
  }, [open]);

  const toggleScope = (s: Scope) => {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || scopes.length === 0) return;
    const raw = makeRawKey();
    const created: CreatedKey = {
      name: trimmed,
      scopes,
      prefix: raw.slice(0, 16),
      rawKey: raw,
      createdAt: new Date().toISOString(),
    };
    setIssued(created);
    onCreated(created);
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.rawKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail in non-secure contexts — leave the key
      // visible so the user can select-and-copy manually.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>
          {issued ? "Your new API key" : "Create new API key"}
        </DialogTitle>
        <p className="mt-1 text-xs text-soya-ink/60">
          {issued
            ? "Copy this key now — for security reasons it will never be shown again."
            : "Pick a memorable name and the scopes this key should be allowed to use."}
        </p>
      </DialogHeader>

      {issued ? (
        <DialogBody className="space-y-4">
          <div className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
            Make sure to copy this key now — it will never be shown again.
          </div>

          <div className="rounded-md border border-soya-ink/10 bg-white/80 p-3 font-mono text-xs break-all">
            {issued.rawKey}
          </div>

          <div className="flex items-center justify-between text-xs text-soya-ink/60">
            <span>
              Scopes:{" "}
              {issued.scopes.map((s) => (
                <Badge key={s} variant="accent" className="mr-1">
                  {s}
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
            <span className="text-xs font-medium tracking-tight text-soya-ink/80">
              Key name
            </span>
            <Input
              className="mt-1"
              placeholder="prod-essay-tutor-edge"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <span className="mt-1 block text-[11px] text-soya-ink/50">
              Shown in lists and audit logs. Doesn&apos;t need to be unique.
            </span>
          </label>

          <fieldset>
            <legend className="text-xs font-medium tracking-tight text-soya-ink/80">
              Scopes
            </legend>
            <div className="mt-2 space-y-2">
              {ALL_SCOPES.map((s) => (
                <label
                  key={s.id}
                  className="flex items-start gap-3 rounded-md border border-soya-ink/10 bg-white/50 px-3 py-2 text-xs hover:border-soya-accent/60"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-soya-accent"
                    checked={scopes.includes(s.id)}
                    onChange={() => toggleScope(s.id)}
                  />
                  <span>
                    <span className="font-medium tracking-tight text-soya-ink">
                      {s.label}
                    </span>
                    <span className="ml-2 text-soya-ink/60">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </DialogBody>
      )}

      <DialogFooter>
        {issued ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!name.trim() || scopes.length === 0}
            >
              Create key
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
