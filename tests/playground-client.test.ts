import { describe, expect, it, vi } from "vitest";
import { formatPlaygroundError } from "../src/components/Playground";
import {
  INFERENCE_API_BASE,
  listPlaygroundModels,
  PlaygroundApiError,
  runPlaygroundCompletion,
} from "../src/lib/playground-client";

const API_KEY = "sk-soya-abcdefghijkl.abcdefghijklmnopqrstuvwxyzABCDEFGHijk";

describe("Playground API client", () => {
  it("loads models with a bearer key without putting it in the URL", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        { object: "list", data: [{ id: "soya:starter", object: "model" }] },
        { headers: { "x-request-id": "req_models" } },
      ),
    );

    await expect(listPlaygroundModels(API_KEY, fetcher)).resolves.toEqual(["soya:starter"]);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${INFERENCE_API_BASE}/models`);
    expect(String(url)).not.toContain(API_KEY);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("parses a non-streaming completion and its usage", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          model: "soya:starter",
          choices: [{ message: { role: "assistant", content: "Cloud ready" } }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        },
        { headers: { "x-request-id": "req_chat_json" } },
      ),
    );

    await expect(
      runPlaygroundCompletion(
        {
          apiKey: API_KEY,
          model: "soya:starter",
          prompt: "hello",
          stream: false,
        },
        fetcher,
      ),
    ).resolves.toEqual({
      content: "Cloud ready",
      requestId: "req_chat_json",
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });
  });

  it("parses split CRLF stream events and requires DONE", async () => {
    const encoded = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoded.encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\r'),
        );
        controller.enqueue(
          encoded.encode('\n\r\ndata: {"choices":[{"delta":{"content":"Cloud "}}]}\r\n\r\n'),
        );
        controller.enqueue(
          encoded.encode('data: {"choices":[{"delta":{"content":"ready"}}]}\n\n'),
        );
        controller.enqueue(encoded.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetcher = vi.fn(async () =>
      new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_chat_stream",
        },
      }),
    );
    const deltas: string[] = [];

    await expect(
      runPlaygroundCompletion(
        {
          apiKey: API_KEY,
          model: "soya:starter",
          prompt: "hello",
          stream: true,
          onDelta: (delta) => deltas.push(delta),
        },
        fetcher,
      ),
    ).resolves.toEqual({
      content: "Cloud ready",
      requestId: "req_chat_stream",
      usage: null,
    });
    expect(deltas).toEqual(["Cloud ", "ready"]);
  });

  it("preserves stable quota guidance and redacts a key from unexpected errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "daily_request_limit",
            message: `Unexpected echo ${API_KEY}`,
          },
        },
        {
          status: 429,
          headers: {
            "retry-after": "120",
            "x-request-id": "req_limited",
          },
        },
      ),
    );

    let caught: unknown;
    try {
      await runPlaygroundCompletion(
        {
          apiKey: API_KEY,
          model: "soya:starter",
          prompt: "hello",
          stream: false,
        },
        fetcher,
      );
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toMatchObject({
      status: 429,
      code: "daily_request_limit",
      requestId: "req_limited",
      retryAfter: 120,
    });
    const rendered = formatPlaygroundError(caught, API_KEY);
    expect(rendered).toContain("daily_request_limit");
    expect(rendered).toContain("120 seconds");
    expect(rendered).not.toContain(API_KEY);
  });

  it("rejects a stream that ends without DONE", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetcher = vi.fn(async () =>
      new Response(body, { headers: { "x-request-id": "req_incomplete" } }),
    );

    await expect(
      runPlaygroundCompletion(
        {
          apiKey: API_KEY,
          model: "soya:starter",
          prompt: "hello",
          stream: true,
        },
        fetcher,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PlaygroundApiError>>({
        status: 502,
        code: "incomplete_stream",
        requestId: "req_incomplete",
      }),
    );
  });
});
