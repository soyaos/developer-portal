import * as React from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

// TODO(soyaos): replace the setInterval with a real EventSource:
//
//   const es = new EventSource(
//     `/control/v0/connectors/bindings/${bindingId}/feed`,
//     { withCredentials: true },
//   );
//   es.onmessage = (ev) => {
//     const event = JSON.parse(ev.data) as ChannelInboundEvent;
//     pushEvent(event);
//   };
//
// The server emits one SSE event per inbound channel message, already
// decoded to the canonical Message shape. We stream forever — UI keeps
// the most recent N events and evicts the rest.

interface Binding {
  id: string;
  label: string;
  channel: "dingtalk" | "feishu" | "wechat";
}

const BINDINGS: Binding[] = [
  { id: "bind_dt_eng", label: "dingtalk-engineering", channel: "dingtalk" },
  { id: "bind_fs_mkt", label: "feishu-marketing", channel: "feishu" },
  { id: "bind_wc_cs", label: "wechat-customer", channel: "wechat" },
];

interface DecodedMessage {
  kind: "text" | "image" | "system";
  body: string;
}

interface InboundEvent {
  id: string;
  bindingId: string;
  timestamp: string; // ISO
  // The raw payload as the channel SDK delivered it. In production
  // this is the verbatim webhook body — keeping it visible is the
  // whole point of the debugger.
  raw: Record<string, unknown>;
  // The canonical Message the platform routes to Agents.
  decoded: DecodedMessage;
  // For the list summary.
  fromUser: string;
}

const MAX_EVENTS = 100;
const TICK_MS = 8000;

const SAMPLES_BY_CHANNEL: Record<Binding["channel"], () => InboundEvent> = {
  dingtalk: () => {
    const ts = new Date().toISOString();
    const id = `evt_${ts}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      id,
      bindingId: "bind_dt_eng",
      timestamp: ts,
      fromUser: "张工",
      raw: {
        msgtype: "text",
        text: { content: "@soyabot 帮我看下今天的部署是否成功" },
        conversationId: "cidA1B2C3==",
        senderStaffId: "0123abc",
        senderNick: "张工",
        createAt: Date.now(),
      },
      decoded: {
        kind: "text",
        body: "@bot 帮我看下今天的部署是否成功",
      },
    };
  },
  feishu: () => {
    const ts = new Date().toISOString();
    const id = `evt_${ts}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      id,
      bindingId: "bind_fs_mkt",
      timestamp: ts,
      fromUser: "marketing@example.com",
      raw: {
        schema: "2.0",
        header: { event_type: "im.message.receive_v1", tenant_key: "abc" },
        event: {
          message: {
            message_type: "text",
            content: '{"text":"@bot 帮我生成本周营销周报"}',
          },
        },
      },
      decoded: {
        kind: "text",
        body: "@bot 帮我生成本周营销周报",
      },
    };
  },
  wechat: () => {
    const ts = new Date().toISOString();
    const id = `evt_${ts}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      id,
      bindingId: "bind_wc_cs",
      timestamp: ts,
      fromUser: "wx_oa_user_982",
      raw: {
        ToUserName: "gh_soyaos",
        FromUserName: "wx_oa_user_982",
        CreateTime: Math.floor(Date.now() / 1000),
        MsgType: "text",
        Content: "客服你好，我想咨询一下退款流程",
        MsgId: 9223372036854775000,
      },
      decoded: {
        kind: "text",
        body: "客服你好，我想咨询一下退款流程",
      },
    };
  },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function WebhookFeed() {
  const [bindingId, setBindingId] = React.useState<string>(BINDINGS[0].id);
  const [events, setEvents] = React.useState<InboundEvent[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const selectedBinding = React.useMemo(
    () => BINDINGS.find((b) => b.id === bindingId) ?? BINDINGS[0],
    [bindingId],
  );

  // Stream simulator. In production the EventSource lifetime should
  // mirror this effect — open on mount / binding change, close on
  // pause + unmount.
  React.useEffect(() => {
    if (paused) return;
    const tick = () => {
      const sample = SAMPLES_BY_CHANNEL[selectedBinding.channel]();
      sample.bindingId = selectedBinding.id;
      setEvents((prev) => [sample, ...prev].slice(0, MAX_EVENTS));
    };
    // Fire one immediately so the page isn't blank for 8s.
    tick();
    const handle = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(handle);
  }, [paused, selectedBinding]);

  // When the binding changes we clear the buffer — the events were
  // attributed to the previous channel.
  React.useEffect(() => {
    setEvents([]);
    setExpanded(null);
  }, [bindingId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-soya-ink/10 bg-white/60 p-4">
        <label className="flex items-center gap-3 text-sm">
          <span className="font-medium tracking-tight text-soya-ink/80">
            Channel binding
          </span>
          <select
            className="h-9 rounded-md border border-soya-ink/15 bg-white/80 px-3 text-sm focus:border-soya-accent focus:outline-none focus:ring-2 focus:ring-soya-accent/30"
            value={bindingId}
            onChange={(e) => setBindingId(e.target.value)}
          >
            {BINDINGS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <Badge variant="muted">{selectedBinding.channel}</Badge>
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-soya-ink/60">
            {paused ? "paused" : "live"} · {events.length} / {MAX_EVENTS} events
          </span>
          <Button
            size="sm"
            variant={paused ? "primary" : "secondary"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEvents([]);
              setExpanded(null);
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-soya-ink/10 bg-white/60">
        {events.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-soya-ink/50">
            Waiting for the first inbound message from
            <code className="mx-1">{selectedBinding.label}</code>…
          </div>
        ) : (
          <ul className="divide-y divide-soya-ink/5">
            {events.map((ev) => {
              const isOpen = ev.id === expanded;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : ev.id)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-soya-accent/5 focus:outline-none focus-visible:bg-soya-accent/10"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-[11px] text-soya-ink/50">
                        {fmtTime(ev.timestamp)}
                      </span>
                      <Badge variant="accent">{ev.decoded.kind}</Badge>
                      <span className="truncate text-sm text-soya-ink">
                        <span className="text-soya-ink/60">{ev.fromUser}:</span>{" "}
                        {ev.decoded.body}
                      </span>
                    </div>
                    <span className="text-xs text-soya-ink/40">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grid gap-4 border-t border-soya-ink/5 bg-soya-ink/[0.02] p-4 md:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-soya-ink/60">
                          Raw inbound payload
                        </h3>
                        <pre className="max-h-64 overflow-auto rounded-md border border-soya-ink/10 bg-white/80 p-3 font-mono text-[11px] leading-relaxed text-soya-ink/80">
{JSON.stringify(ev.raw, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-soya-ink/60">
                          Decoded canonical Message
                        </h3>
                        <pre className="max-h-64 overflow-auto rounded-md border border-soya-ink/10 bg-white/80 p-3 font-mono text-[11px] leading-relaxed text-soya-ink/80">
{JSON.stringify(
  {
    binding_id: ev.bindingId,
    timestamp: ev.timestamp,
    from: ev.fromUser,
    message: ev.decoded,
  },
  null,
  2,
)}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
