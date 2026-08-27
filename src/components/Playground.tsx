import * as React from "react";
import {
  listPlaygroundModels,
  PlaygroundApiError,
  runPlaygroundCompletion,
  type PlaygroundUsage,
} from "../lib/playground-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import type { Locale, PortalDictionary } from "../lib/i18n";

type Messages = PortalDictionary["playground"]["component"];

const DEFAULT_ERRORS = {
  cancelled: "Request cancelled.",
  invalidKey: "This API key is invalid or revoked. Create or copy an active key and try again.",
  quotaReached: "Free quota reached",
  retryAfter: "Retry after {seconds} seconds.",
  requestFailed: "The request failed.",
};

interface ResultState {
  content: string;
  requestId: string;
  usage: PlaygroundUsage | null;
  latencyMs: number;
  streamed: boolean;
}

export function formatPlaygroundError(
  cause: unknown,
  apiKey = "",
  messages: Pick<Messages, "cancelled" | "invalidKey" | "quotaReached" | "retryAfter" | "requestFailed"> = DEFAULT_ERRORS,
): string {
  let message: string;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    message = messages.cancelled;
  } else if (cause instanceof PlaygroundApiError) {
    const retry = cause.retryAfter
      ? ` ${messages.retryAfter.replace("{seconds}", String(cause.retryAfter))}`
      : "";
    if (cause.status === 401) {
      message = messages.invalidKey;
    } else if (cause.status === 429) {
      message = `${messages.quotaReached} (${cause.code}).${retry}`;
    } else {
      message = `${cause.message} (${cause.code}).${retry}`;
    }
  } else {
    message = cause instanceof Error ? cause.message : messages.requestFailed;
  }
  const secret = apiKey.trim();
  return secret ? message.split(secret).join("[redacted]") : message;
}

function UsageSummary({ usage, messages }: { usage: PlaygroundUsage; messages: Messages }) {
  return (
    <dl className="grid grid-cols-3 gap-3 text-xs">
      <div>
        <dt className="text-soya-ink/50">{messages.promptTokens}</dt>
        <dd className="mt-1 font-mono">{usage.promptTokens}</dd>
      </div>
      <div>
        <dt className="text-soya-ink/50">{messages.completionTokens}</dt>
        <dd className="mt-1 font-mono">{usage.completionTokens}</dd>
      </div>
      <div>
        <dt className="text-soya-ink/50">{messages.totalTokens}</dt>
        <dd className="mt-1 font-mono">{usage.totalTokens}</dd>
      </div>
    </dl>
  );
}

export function Playground({ messages, locale }: { messages: Messages; locale: Locale }) {
  const [apiKey, setApiKey] = React.useState("");
  const [models, setModels] = React.useState<string[]>([]);
  const [model, setModel] = React.useState("soya:starter");
  const [prompt, setPrompt] = React.useState(messages.defaultPrompt);
  const [stream, setStream] = React.useState(false);
  const [streamedContent, setStreamedContent] = React.useState("");
  const [result, setResult] = React.useState<ResultState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const clearKey = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setApiKey("");
    setModels([]);
    setModel("soya:starter");
    setStreamedContent("");
    setResult(null);
    setError(null);
    setLoadingModels(false);
    setRunning(false);
  };

  const loadModels = async () => {
    const key = apiKey.trim();
    if (!key || loadingModels || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingModels(true);
    setError(null);
    try {
      const nextModels = await listPlaygroundModels(key, fetch, controller.signal);
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setModels(nextModels);
      if (!nextModels.includes(model)) setModel(nextModels[0] ?? "soya:starter");
    } catch (cause) {
      if (abortRef.current === controller) {
        setModels([]);
        setError(formatPlaygroundError(cause, key, messages));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoadingModels(false);
      }
    }
  };

  const run = async () => {
    const key = apiKey.trim();
    const message = prompt.trim();
    if (!key || !message || running || loadingModels) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setResult(null);
    setStreamedContent("");
    const startedAt = performance.now();
    try {
      const completion = await runPlaygroundCompletion({
        apiKey: key,
        model,
        prompt: message,
        stream,
        signal: controller.signal,
        onDelta: stream
          ? (delta) => {
              if (!controller.signal.aborted && abortRef.current === controller) {
                setStreamedContent((current) => current + delta);
              }
            }
          : undefined,
      });
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setResult({
        ...completion,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        streamed: stream,
      });
      setStreamedContent("");
    } catch (cause) {
      if (abortRef.current === controller) {
        setError(formatPlaygroundError(cause, key, messages));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  };

  const cancel = () => abortRef.current?.abort();
  const visibleContent = streamedContent || result?.content || "";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{messages.request}</CardTitle>
          <CardDescription>
            {messages.keyMemory}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label htmlFor="playground-key" className="text-xs font-medium text-soya-ink/80">
              {messages.apiKey}
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="playground-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setModels([]);
                }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={messages.apiKeyPlaceholder}
              />
              <Button
                variant="secondary"
                onClick={() => void loadModels()}
                disabled={!apiKey.trim() || loadingModels || running}
              >
                {loadingModels ? messages.loading : messages.loadModels}
              </Button>
              <Button variant="ghost" onClick={clearKey} disabled={!apiKey && !result}>
                {messages.clear}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-soya-ink/50">
              {messages.keyHint}
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-soya-ink/80">{messages.model}</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-soya-ink/15 bg-white/70 px-3 font-mono text-sm focus:border-soya-accent focus:outline-none focus:ring-2 focus:ring-soya-accent/30"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {(models.length > 0 ? models : ["soya:starter"]).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-soya-ink/80">{messages.message}</span>
            <textarea
              className="mt-1 min-h-36 w-full resize-y rounded-md border border-soya-ink/15 bg-white/70 px-3 py-2 text-sm leading-6 focus:border-soya-accent focus:outline-none focus:ring-2 focus:ring-soya-accent/30"
              value={prompt}
              maxLength={16_000}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-soya-ink/70">
            <input
              type="checkbox"
              checked={stream}
              onChange={(event) => setStream(event.target.checked)}
              className="h-4 w-4 accent-soya-ink"
            />
            {messages.streamResponse}
          </label>

          {error && (
            <div role="alert" className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={() => void run()}
              disabled={!apiKey.trim() || !prompt.trim() || running || loadingModels}
            >
              {running ? (stream ? messages.streaming : messages.running) : messages.run}
            </Button>
            {running && <Button variant="secondary" onClick={cancel}>{messages.cancel}</Button>}
          </div>
        </CardContent>
      </Card>

      <Card aria-live="polite">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{messages.response}</CardTitle>
              <CardDescription>{messages.responseDescription}</CardDescription>
            </div>
            {result && <Badge variant="accent">{result.streamed ? messages.stream : messages.json}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="min-h-56 whitespace-pre-wrap rounded-lg border border-soya-ink/10 bg-soya-paper/70 p-4 text-sm leading-6">
            {visibleContent || (
              <span className="text-soya-ink/40">
                {messages.emptyResponse}
              </span>
            )}
          </div>

          {result && (
            <div className="space-y-4 rounded-lg border border-soya-ink/10 bg-white/60 p-4">
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-soya-ink/50">{messages.requestId}</p>
                  <p className="mt-1 break-all font-mono">{result.requestId}</p>
                </div>
                <div>
                  <p className="text-soya-ink/50">{messages.browserLatency}</p>
                  <p className="mt-1 font-mono">{result.latencyMs.toLocaleString()} ms</p>
                </div>
              </div>
              {result.usage ? (
                <UsageSummary usage={result.usage} messages={messages} />
              ) : (
                <p className="text-xs text-soya-ink/60">
                  {messages.streamUsage}
                </p>
              )}
              <a
                className="inline-flex text-xs font-medium text-soya-accent underline hover:no-underline"
                href={`/${locale}/usage?requestId=${encodeURIComponent(result.requestId)}`}
              >
                {messages.findTrace}
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
