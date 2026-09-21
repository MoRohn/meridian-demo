# Production notes

Meridian is a demo, and several parts are deliberately simplified. This page lists them and what replaces each in a real
deployment.

| Area | Demo behavior | Production direction |
|---|---|---|
| **Session store** | In-memory and single-instance ([`src/lib/memory/session.ts`](../src/lib/memory/session.ts)), bounded to 500 sessions with a one-hour idle expiry, so it cannot grow without limit. | Redis or DynamoDB. The module's exported functions are the only integration surface, so it is a contained change. |
| **Who may call the API** | There are no accounts. A session id is a random capability minted by the browser (and checked for that shape), not an identity; the routes that spend money refuse other-site browsers and are rate limited per client (120 requests a minute, [`src/lib/api/guard.ts`](../src/lib/api/guard.ts)). | Put real authentication in front of `/api/*` (Auth.js, Clerk, your SSO), tie sessions to the signed-in user, and rate limit at the edge (the in-process limiter is per instance and trusts `x-forwarded-for` from your proxy). |
| **Citation retrieval** | `AUTHORITY_SECTIONS` ([`src/lib/data/authorities.ts`](../src/lib/data/authorities.ts)) is a hardcoded stand-in for a real playbook, and each key term's clause is chosen by keyword rules ([`src/lib/citations/topics.ts`](../src/lib/citations/topics.ts)). | Embed the playbook and the document's clauses in a vector store (pgvector, OpenSearch, Pinecone) and choose by similarity; resolve outside citations (statutes, cases) against a real corpus instead of marking them not checkable. The "does the retrieved context support the claim" judgment step is unchanged. |
| **Uploaded files** | Extracted to text and held only in the in-memory session; [`/api/extract`](../src/app/api/extract/route.ts) never writes to disk. | Persist the original in object storage (S3 or Blob) for audit, and virus-scan it before extraction. |
| **API keys** | Keys saved in Settings live in the browser and travel per request; they are never persisted server-side. By default they sit in `sessionStorage` (this tab only, gone when it closes), and only a reader who ticks "Remember my keys on this device" gets them in `localStorage`. That is the price of a demo with no accounts: any script that runs on the page can read a key while it is there. The mitigation is the Content-Security-Policy in [`next.config.ts`](../next.config.ts): no third-party script is loaded, and `connect-src 'self'` stops a script from sending them anywhere else. | Move key management to a secrets and identity layer rather than trusting the client: keys held server-side per user, never in the browser. |
| **Observability** | The `TraceEntry[]` the app builds for the UI ([`src/lib/orchestrator/run.ts`](../src/lib/orchestrator/run.ts)) and the eval service's structured logs. | Ship the trace to a real pipeline (structured logs, OpenTelemetry spans per skill) for drift monitoring and confidence-threshold tuning against real outcomes. |
| **Local evaluator** | [`src/lib/typesafe/mock.ts`](../src/lib/typesafe/mock.ts) uses keyword-overlap heuristics, not a trained model. It exists so the app runs without credentials and is intentionally imperfect at anything needing real comprehension. | Not used when a TypeSafe key is present. |

## Cloud deployment

The app is plain Next.js (App Router, API routes) with no platform-specific code, so it runs on Vercel as is. On AWS or Azure,
the same build runs on App Runner, ECS Fargate or Azure Container Apps behind a standard Dockerfile. The only
environment-specific pieces are `TYPESAFE_API_KEY` and `OPENAI_API_KEY` (in Secrets Manager or Key Vault) and the session
store swap above.

The [evaluation service](../eval-service/README.md) is a separate FastAPI process. Deploy it as its own container and point
the app at it with `EVAL_SERVICE_URL`. It spends judge-model credits, so it listens on loopback by default and, when
`EVAL_SERVICE_TOKEN` is set on both the app and the service, refuses any caller that does not present it; set one whenever
the service is reachable from anywhere but the app. Each judge call has a deadline (`EVAL_JUDGE_TIMEOUT_S`, 45s) and only
`EVAL_MAX_CONCURRENT` (8) may run at once, with up to `EVAL_MAX_QUEUED` (16) waiting; more than that is refused at once (429 `judge_busy`). The judge key is forwarded only over https or to the same machine, and the service
never logs judged text. DeepEval telemetry is off by default because the text being judged is confidential; do not set
`CONFIDENT_API_KEY`, which would upload test cases to a third party.
