# Production inference smoke test

Use this runbook before opening a SoyaOS Cloud release to users. In `full` mode,
it checks the real authenticated production inference path with one to five
rounds of two short completions. In `models-only` mode it performs one read-only
authentication check and sends no Chat request. It is not a recurring monitor
and has no scheduled trigger.

## Safety contract

- The workflow is manual-only and fixed to `https://api.soyaos.ai` and
  `soya:starter`.
- The API key comes only from the `production-smoke` GitHub Environment secret
  named `SOYAOS_PRODUCTION_SMOKE_API_KEY`.
- The script logs only check names, result, latency, request IDs and aggregate
  token usage. It never logs the key, Authorization header, prompt, completion
  content or an error response body.
- A full-mode round sends one non-streaming and one streaming request with
  `max_tokens: 512`, matching the production API default. A run is limited to
  five rounds (ten Chat requests). Cost-bearing POST requests are never retried,
  and a failed request stops the run immediately.
- Every response has a 30-second timeout and a 1 MiB body limit.

## Prepare a disposable key

1. Sign in at `https://developer.soyaos.ai`.
2. Create a key named for the release smoke test and copy its one-time value.
3. Open the `soyaos/developer-portal` repository on GitHub.
4. Open **Settings → Environments → production-smoke**.
5. Add or replace the Environment secret
   `SOYAOS_PRODUCTION_SMOKE_API_KEY`, then paste the full one-time key.
6. Do not paste the value into GitHub Actions inputs, Linear, chat, screenshots
   or shell history.

## Run and verify

1. Open **Actions → Smoke production inference → Run workflow** on `main`.
2. Choose `mode: full`. Choose `rounds: 1` for an ordinary release smoke or
   `rounds: 5` only for the approved v0.2.0 controlled promotion sample.
3. Confirm the run prints a top-level `"result": "pass"`. An ordinary run must
   show `expectedChatRequests: 2`; the controlled sample must show
   `expectedChatRequests: 10` and `passedChatRequests: 10`.
4. Record the request IDs. Each non-streaming result must also contain
   non-negative `promptTokens`, `completionTokens` and `totalTokens`.
5. In the Developer Portal, open **Usage** and search for each request ID.
   Confirm both completion requests appear without prompt or response bodies.

If a check fails, keep the key active while the failure is investigated. The
failure report contains only a stable check/code pair and optional HTTP status;
inspect Cloudflare body-free metadata using the request ID when available.

## Clean up

After all checks and Usage traces pass:

1. Revoke the disposable API key in the Developer Portal.
2. While the old value remains in the Environment secret, rerun with
   `mode: models-only` and `rounds: 1`. Confirm the read-only Models check fails
   with HTTP `401`; this mode sends no Chat request.
3. Delete `SOYAOS_PRODUCTION_SMOKE_API_KEY` from the `production-smoke`
   GitHub Environment.
4. Confirm rerunning the workflow now fails at `configuration` with
   `missing_api_key` before any network request.

The separate `Monitor production` workflow remains the recurring read-only
availability check. Never add a schedule to the production inference smoke.
