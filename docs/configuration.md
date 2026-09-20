# Configuration

Meridian needs no configuration to run. Without keys it uses a local heuristic evaluator that returns the same response
shape as the real model, so the whole app is interactive. The header's `TypeSafe` and `OpenAI` pills always show `Live`
versus `demo mode` / `not configured`, plus the last call's latency, so it is never ambiguous which one answered.

## Environment variables

Copy [`.env.example`](../.env.example) to `.env.local`. All values are optional.

| Variable | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | none | Enables the real TypeSafe Jev model. Keys come from [console.typesafe.ai](https://console.typesafe.ai/settings/keys). |
| `TYPESAFE_MODEL` | `jev-latest` | TypeSafe model id. |
| `OPENAI_API_KEY` | none | Enables the OpenAI comparison and the model that writes chat replies. Independent of the TypeSafe key. |
| `OPENAI_MODEL` | `gpt-6-astra` | OpenAI model id. |
| `EVAL_SERVICE_URL` | `http://localhost:8008` | Where the app finds the [evaluation service](../eval-service/README.md). |

`npm run meridian` also reads:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | App port. The script exits with an error if it is taken instead of moving to another. |
| `HOST` | `meridian.local` | Preferred hostname. Used only if it resolves to this machine; otherwise the script uses `localhost` and prints the one-line `/etc/hosts` entry that enables it. |
| `MERIDIAN_EVAL` | on | Set to `0` to not start the evaluation service alongside the app. |
| `EVAL_SERVICE_PORT` | `8008` | Port for the service the script starts. |

The e2e scripts read `E2E_URL` (default `http://localhost:3000`); see [Testing](testing.md).

## Settings dialog

The gear icon in the header opens **Settings**: a password-masked key field and a model dropdown for each backend, the judge
model choice, and the auto-evaluation switch.

- **TypeSafe** ships one Jev model (`jev-latest`).
- **OpenAI** offers the current chat-completions lineup, defaulting to the newest flagship (`gpt-6-astra`) down to the
  cheapest (`gpt-4o-mini`). The list is in [`src/lib/settings.ts`](../src/lib/settings.ts).

Keys are stored in `localStorage` only and never written to the app's server-side session store. They are sent in the body of
each request the browser already makes and take priority over the matching environment variable for that request
([`src/lib/typesafe/client.ts`](../src/lib/typesafe/client.ts), [`src/lib/openai/client.ts`](../src/lib/openai/client.ts)).
Saving a key fires a cheap, real validation call ([`/api/validate-keys`](../src/app/api/validate-keys/route.ts)), so the header
pill claims `Live` only once the key is confirmed to work.

Newer OpenAI models spend reasoning tokens by default, which `/v1/chat/completions` rejects for function-calling requests, so
the app sets `reasoning_effort: "none"` for reasoning-family models. If a selected model is still not callable on a key (a
staged rollout, for example), the OpenAI client retries once against `gpt-4o-mini` and reports the fallback in the UI rather
than failing the comparison.

## Display brightness

The sun/moon button in the header opens a five-level brightness slider (drag it, use the arrow keys, or pick a name). From
brightest to darkest: **Bright** (one step brighter than the original), **Original** (the palette Meridian first shipped),
**Default** (slightly darker than the original; what a new visitor sees), **Dark**, and **Darkest**. The whole UI follows, the
choice is remembered, and it is applied before first paint so there is no flash of the wrong palette.

Each level's palette is defined in [`src/app/globals.css`](../src/app/globals.css).
[`src/lib/themePalette.test.ts`](../src/lib/themePalette.test.ts) reads that file and checks every level: WCAG AA contrast for
every text and surface pair (including status text on its tinted chips), that levels get strictly darker in order, that
"default" is only slightly darker than "original", and that "original" is still exactly the shipped palette. `npm run test:e2e`
scans every level across every view with axe. When editing a palette, run those two first.
