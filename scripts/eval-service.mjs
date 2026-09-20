#!/usr/bin/env node
/**
 * Runs the DeepEval evaluation service (eval-service/, Python) so the Evaluate buttons work.
 *
 *   npm run eval-service:setup    one time: creates eval-service/.venv and installs its requirements
 *   npm run eval-service          starts it in the foreground on port 8008
 *
 * `npm run meridian` starts it for you when the setup has been done (set MERIDIAN_EVAL=0 to skip).
 * The judge key comes from, in order: a key saved in Meridian's Settings (sent with each evaluation),
 * OPENAI_API_KEY in the environment (including the repo's .env.local, loaded by scripts/load-env.mjs), or eval-service/.env.
 */
import "./load-env.mjs";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SERVICE_DIR = path.join(ROOT, "eval-service");
export const SERVICE_PORT = Number(process.env.EVAL_SERVICE_PORT || 8008);
/** Loopback by default: the service spends judge-model credits and is only ever called by Meridian's own server. Set EVAL_SERVICE_HOST to expose it deliberately (and set EVAL_SERVICE_TOKEN when you do). */
export const SERVICE_HOST = process.env.EVAL_SERVICE_HOST || "127.0.0.1";
const isWin = process.platform === "win32";

const venvBin = (name) => path.join(SERVICE_DIR, ".venv", isWin ? "Scripts" : "bin", isWin ? `${name}.exe` : name);
export const isSetUp = () => fs.existsSync(venvBin("uvicorn"));

export function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer().once("error", () => resolve(false)).once("listening", () => tester.close(() => resolve(true))).listen(port, "127.0.0.1");
  });
}

/** Starts the service. `output: "inherit"` streams its log as it is; "prefixed" tags each line so it can share a terminal with another process. */
export function startEvalService({ output = "inherit" } = {}) {
  const child = spawn(venvBin("uvicorn"), ["main:app", "--host", SERVICE_HOST, "--port", String(SERVICE_PORT)], {
    cwd: SERVICE_DIR,
    stdio: output === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (output === "prefixed") {
    const tag = (stream) => stream.on("data", (chunk) => String(chunk).split("\n").filter(Boolean).forEach((line) => console.log(`  [eval] ${line}`)));
    tag(child.stdout);
    tag(child.stderr);
  }
  return child;
}

function setup() {
  const python = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { stdio: "ignore" }).status === 0);
  if (!python) {
    console.error("  ✕ Python 3 was not found. Install Python 3.10+ and run this again.");
    process.exit(1);
  }
  const run = (cmd, args) => {
    console.log(`  $ ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { cwd: SERVICE_DIR, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run(python, ["-m", "venv", ".venv"]);
  run(venvBin("pip"), ["install", "-q", "-r", "requirements.txt"]);
  console.log("\n  ✓ Evaluation service installed.");
  console.log("    Judge key: save an OpenAI key in Meridian's Settings, or put OPENAI_API_KEY in eval-service/.env");
  console.log("    Then run `npm run meridian` (it starts the service too) or `npm run eval-service`.\n");
}

async function main() {
  const command = process.argv[2] ?? "start";
  if (command === "setup") return setup();
  if (command !== "start") {
    console.error("Usage: node scripts/eval-service.mjs [start|setup]");
    process.exit(2);
  }
  if (!isSetUp()) {
    console.error("  ✕ The evaluation service isn't installed yet. Run once:  npm run eval-service:setup");
    process.exit(1);
  }
  if (!(await isPortFree(SERVICE_PORT))) {
    console.error(`  ✕ Port ${SERVICE_PORT} is already in use (is the evaluation service already running?).`);
    process.exit(1);
  }
  const child = startEvalService();
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
