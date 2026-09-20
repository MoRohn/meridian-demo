/**
 * Loads .env.local then .env from the repo root into process.env, the same files and order `next dev` reads, so the
 * launcher scripts (and the evaluation service they spawn) see the same keys and PORT/HOST/MERIDIAN_EVAL settings as
 * the app. Real environment variables always win, and nothing is ever logged.
 *
 * Import this first: the scripts read process.env at import time, and ES imports run in order.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of [".env.local", ".env"]) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  try {
    process.loadEnvFile(file); // does not override variables that are already set
  } catch {
    // Unreadable or unsupported (Node < 20.12): the app itself still loads its own env files.
  }
}
