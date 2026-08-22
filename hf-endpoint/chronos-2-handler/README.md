# Chronos-2 custom Inference Endpoint handler

The actual deployed artifact — `handler.py`, `config.json`, `requirements.txt`, and the
`amazon/chronos-2` model weights — lives in its own git repo, checked out as a sibling
directory to this one: `../../chronos-2-kairo/` (remote:
`https://huggingface.co/roydekel/chronos-2-kairo`). That repo is a duplicate of
`amazon/chronos-2` with the custom handler added at its root; it is **not** part of this
repo's history (it has its own `.git`, its own remote, and its own commit log — treat it as
an external HF Hub repo you happen to have checked out locally, not a KAIRO source file).

This directory exists only so the docstring in `handler.py` — and anyone reading
`server/services/forecastService.js`'s `HF_ENDPOINT_URL` call — has somewhere in *this* repo
to land. It intentionally holds no copy of the handler itself, to avoid two files drifting
out of sync; edit the handler in `chronos-2-kairo/`, then `git push` from there to update the
live endpoint (HF Inference Endpoints redeploy the custom handler from the repo's `main`).

## The contract

`forecastService.js` (`server/services/forecastService.js:304-410`) sends:

```json
{ "inputs": [<daily prices, oldest first>], "parameters": { "prediction_length": 7, "num_samples": 20 } }
```

and expects back:

```json
{ "quantiles": { "0.1": [7 numbers], "0.5": [7 numbers], "0.9": [7 numbers] } }
```

Any other shape falls back to `seasonal_naive_forecast` **silently** — `forecastService.js`
rejects an unusable response rather than throwing. See
`docs/product/specs/p2-hf-endpoint-rollout.md` for the manual smoke test that verifies this
shape before relying on the nightly batch to surface a mismatch.

## Deployment (already done — this is how it was set up)

1. On huggingface.co, duplicated `amazon/chronos-2` into `roydekel/chronos-2-kairo`.
2. Added `handler.py` + `requirements.txt` (`chronos-forecasting`, `pandas`) at the repo
   root and pushed. HF Inference Endpoints auto-detects `handler.py` and offers the "Custom"
   task.
3. Created a Dedicated Inference Endpoint pointing at `roydekel/chronos-2-kairo`, task
   Custom, CPU instance (Chronos-2 is 120M params and runs fine on CPU — no GPU needed).
4. Copied the resulting endpoint URL + generated an API token, set as `HF_ENDPOINT_URL` /
   `HF_API_KEY` — see the rollout spec for where those go (Render's environment, not this
   repo, not committed anywhere).
