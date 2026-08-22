# P2 — Wire the live Chronos-2 HF endpoint into Render + verify

**Status**: in progress (KAI-003)
**Owner**: Roy (ops/config — no `feature-dev` build needed; see §1)
**Depends on**: P1 shipped (KAI-002, live); the cost decision (`decisions.md`, 2026-08-22);
a running HF Dedicated Inference Endpoint for `roydekel/chronos-2-kairo`
**Blocks**: P3 (events covariate — no covariate slot until the model taking covariates is live)

---

## 1. Why this spec has no code changes in it

Unusually for a spec in this folder, P2 does not ask `feature-dev` to build anything. Three
things already shipped to `main`, in this order:

1. **Phase 0/1 HF integration** (commit `f47e26f`) — `server/services/forecastService.js`
   calls `HF_ENDPOINT_URL` with `HF_API_KEY` when both are set, on a 4s timeout, and falls
   back to `seasonal_naive_forecast` on any failure or unset var
   (`forecastService.js:304–410`).
2. **P1 batch + cache** (KAI-002) — the nightly `forecastBatch.js` job calls
   `forecastService.forecastRoute` exactly the same way the request path does, so it picks up
   `HF_ENDPOINT_URL` automatically, off the request path, where a slow cold start is harmless.
3. **`FORECAST_LIVE_HF_ENABLED`** (PR #11) — guards the *request-path* HF call specifically,
   so a live `/api/flights` search doesn't re-arm a scale-to-zero endpoint's idle timer on
   every cache miss. `source === 'batch'` always calls HF regardless of this flag; only the
   live path respects it.

Separately, on the HF side, `roydekel/chronos-2-kairo` (a duplicate of `amazon/chronos-2`,
pushed 2026-08-22) carries a custom `handler.py` at its repo root — a sibling checkout at
`chronos-2-kairo/`, its own git repo with its own remote, not part of this repo's history —
whose request/response shape was written to match `forecastService.js` exactly (see
`hf-endpoint/chronos-2-handler/README.md` for the pointer and the contract):

```
Request:  { "inputs": [<daily prices>], "parameters": { "prediction_length": 7, "num_samples": 20 } }
Response: { "quantiles": { "0.1": [...7 values], "0.5": [...7 values], "0.9": [...7 values] } }
```

That handler is what HF Inference Endpoints auto-detects and deploys as a "Custom" task.
Roy has confirmed the Dedicated Inference Endpoint is provisioned and running, and that the
per-hour billing this implies is accepted (`decisions.md`, 2026-08-22).

**So what's left is entirely operational**: get the endpoint's URL + token into the one place
that doesn't already have them (Render's environment), and verify the whole chain end to end
before trusting it. That's what this spec's acceptance criteria check.

---

## 2. Steps (in order)

1. **Smoke-test the endpoint directly**, before touching Render. From the endpoint's HF
   dashboard page, copy the Endpoint URL and confirm the token. Then, from a shell that has
   them as env vars (never pasted into chat or committed):

   ```bash
   curl -s -X POST "$HF_ENDPOINT_URL" \
     -H "Authorization: Bearer $HF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"inputs":[120,118,115,122,130,128,125,119,121,124,126,123,120,118,122,130,128,125,121,123,126,124,120,119,122,127,129,125,121,123],"parameters":{"prediction_length":7,"num_samples":20}}'
   ```

   Expect `{"quantiles":{"0.1":[...7 numbers],"0.5":[...7 numbers],"0.9":[...7 numbers]}}`.
   A cold scale-to-zero endpoint can take well over the app's 4s timeout on this first call —
   that's expected here; it's *why* this step is manual and separate from the app's request
   path. If the shape doesn't match, the mismatch must be fixed in `handler.py` (in the
   `chronos-2-kairo` HF repo, then `git push`) before wiring Render — a shape mismatch inside
   the app is a **silent** fallback to seasonal-naive (`forecastService.js` rejects an
   unusable response rather than throwing), so it will not show up as an error anywhere.

2. **Set `HF_ENDPOINT_URL` and `HF_API_KEY` in Render's environment** (Render dashboard, the
   `flight-tracker-backend` service → Environment). Redeploy or wait for the next boot.

3. **Decide `FORECAST_LIVE_HF_ENABLED` deliberately.** The code default is `true` (live
   requests call HF on a cache miss, same as before the flag existed). With real per-hour
   billing now in effect, choose one and record it as a decisions.md addendum if it differs
   from the default:
   - **Leave `true`** if the endpoint is always-on (no cold-start risk, and traffic-driven
     idle-timer resets are an accepted, budgeted cost).
   - **Set `false`** if the endpoint is scale-to-zero — this restricts HF calls to the
     nightly batch (~one call per featured route per day) and live cache-misses fall straight
     to seasonal-naive rather than risking an unbounded reactivation pattern. This is the
     configuration the P1 spec and the HF analysis doc both assumed when they scoped cost at
     ~$8/month.

4. **Trigger or wait for the nightly batch.** `forecastBatch.js` runs on `FORECAST_BATCH_CRON`
   (default `0 2 * * *`) plus a boot-delay run `FORECAST_BATCH_BOOT_DELAY_MS` after deploy —
   a fresh Render deploy already re-runs it without waiting for 02:00.

5. **Verify in Supabase.** Query `forecast_cache` for featured routes with `sample_size` past
   `MIN_OBS_FOR_FORECAST` / `MIN_DAYS_FOR_FORECAST` (Tier 3 eligible). Confirm
   `reason = 'huggingface_chronos_forecast'` rather than `seasonal_naive_forecast`, and that
   `confidence_score` is no longer the seasonal engine's residual-based value.

6. **Watch the logs for one full day.** `forecastService.js:392` logs
   `[forecastService] HF Dedicated Endpoint forecast succeeded for <route>. Median: $X` on
   success; a caught HF error logs and falls through to seasonal-naive silently at the
   `forecastRoute` level, so the *absence* of that success line across a batch run is the
   signal to check, not an explicit error.

---

## 3. Acceptance criteria

1. A manual `curl` against `HF_ENDPOINT_URL` with `HF_API_KEY` returns `quantiles.0.1`,
   `quantiles.0.5`, `quantiles.0.9`, each a 7-element array (matches §2 step 1).
2. `HF_ENDPOINT_URL` and `HF_API_KEY` are set in Render's environment (verified by the person
   doing the rollout — this is a dashboard change, not something CI checks).
3. `FORECAST_LIVE_HF_ENABLED` is set to an explicit, reasoned value (not left on the code
   default without a decision recorded) matching the endpoint's scaling configuration.
4. After the next batch run, at least one `forecast_cache` row for a Tier-3-eligible featured
   route has `reason = 'huggingface_chronos_forecast'`.
5. The batch's summary log line and the per-route success log
   (`[forecastService] HF Dedicated Endpoint forecast succeeded...`) both appear for that run.
6. A non-featured or low-history route still tiers to `basic_statistics` /
   `insufficient_history` as before — this rollout changes *which engine* answers Tier 3, not
   the tiering rule itself.

---

## 4. Out of scope

- **The events-covariate loop (P3)** — depends on this shipping first (no covariate slot
  until Chronos is actually being called), but is not part of this rollout.
- **The LLM narrative (P4)**.
- **Fine-tuning Chronos-2** on KAIRO's own `fare_observations` — the analysis doc's Phase 5,
  months out.
- **Any change to `handler.py`'s modeling logic, `forecastService.js`'s tiering rule, or the
  quantile→confidence-score mapping** — this spec verifies the existing contract works
  end-to-end; it does not revisit the contract itself.

---

## 5. Risks / open questions

- **Silent-fallback risk is the main one.** Because a malformed HF response falls back to
  seasonal-naive rather than erroring, a broken wiring can sit unnoticed indefinitely — the
  app keeps working, just never actually uses Chronos. The smoke test (§2.1) and the
  `forecast_cache.reason` check (§2.5) both exist to make this visible immediately rather
  than discovered weeks later.
- **Cost visibility.** With per-hour billing now real, `FORECAST_LIVE_HF_ENABLED` is the one
  knob that turns unpredictable (traffic-driven) into predictable (batch-only, ~daily)
  endpoint activation. Decide it deliberately, not by leaving the code default in place by
  omission.
- **Endpoint scaling config is outside this repo** — set in the HF dashboard, not in code.
  Nothing here enforces that the endpoint's actual scale-to-zero setting matches the
  assumption `FORECAST_LIVE_HF_ENABLED` was set under; that has to be checked by hand during
  rollout (§2.3) and re-checked if either changes independently later.
