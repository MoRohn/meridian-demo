#!/usr/bin/env node
/**
 * Wrapper around `next dev` so `npm run meridian` gives a
 * clean, predictable startup: a fixed port (fails loudly instead of
 * silently hopping to another one when it's taken), a real `meridian.local`
 * URL once it's set up (falling back to localhost with clear one-time setup
 * instructions until it is), and the browser opened for you automatically.
 */
import "./load-env.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import { isPortFree as isServicePortFree, isSetUp as evalServiceIsSetUp, SERVICE_PORT, startEvalService } from "./eval-service.mjs";

const PORT = Number(process.env.PORT || 3000);
const PREFERRED_HOST = process.env.HOST || "meridian.local";
const HOSTS_LINE = `127.0.0.1 ${PREFERRED_HOST}`;

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "0.0.0.0");
  });
}

async function resolvesToLocalhost(host) {
  if (host === "localhost") return true;
  try {
    const results = await dns.lookup(host, { all: true });
    return results.some((r) => r.address === "127.0.0.1" || r.address === "::1");
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  try {
    spawn(cmd, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-fatal. the banner already printed the URL to open by hand.
  }
}

async function waitUntilReady(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // Server not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function banner() {
  console.log("");
  const title = "Meridian | Contract Risk & Compliance AI Evaluation Tool";
  const rule = "─".repeat(title.length + 6);
  console.log(`  ╭${rule}╮`);
  console.log(`  │   ${title}   │`);
  console.log(`  ╰${rule}╯`);
  console.log("");
}

async function main() {
  banner();

  const free = await isPortFree(PORT);
  if (!free) {
    console.error(`  ✕ Port ${PORT} is already in use.`);
    console.error(`    Stop whatever is running on it, or start with a different port:`);
    console.error(`    PORT=3001 npm run meridian\n`);
    process.exit(1);
  }

  const hasCustomHost = await resolvesToLocalhost(PREFERRED_HOST);
  const displayHost = hasCustomHost ? PREFERRED_HOST : "localhost";
  const url = `http://${displayHost}:${PORT}`;

  if (!hasCustomHost) {
    console.log(`  ${PREFERRED_HOST} isn't set up on this machine yet — using localhost for now.`);
    console.log(`  To get the real ${PREFERRED_HOST} URL permanently, run once:`);
    console.log("");
    console.log(`    echo "${HOSTS_LINE}" | sudo tee -a /etc/hosts`);
    console.log("");
    console.log(`  (needs your password — this script can't run sudo for you)\n`);
  }

  console.log(`  Starting on ${url} ...`);

  // The app and the evaluation service it starts share a secret, so nothing else that can reach the service's port can spend
  // its judge credits. A token set in the environment or .env.local is used as it is.
  if (!process.env.EVAL_SERVICE_TOKEN?.trim()) process.env.EVAL_SERVICE_TOKEN = randomBytes(24).toString("hex");

  // Bind on all interfaces (Next's default) so it answers to localhost,
  // 127.0.0.1, AND meridian.local alike only the URL we print/open differs.
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  // The evaluation service is optional infrastructure, but the Evaluate buttons need it, so start it alongside the app
  // when it has been set up. MERIDIAN_EVAL=0 skips this; a remote EVAL_SERVICE_URL means it is not ours to start.
  let evalChild = null;
  const remoteEval = process.env.EVAL_SERVICE_URL && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.EVAL_SERVICE_URL);
  if (process.env.MERIDIAN_EVAL !== "0" && !remoteEval) {
    if (!evalServiceIsSetUp()) {
      console.log("  Evaluations are off: the evaluation service isn't installed. To enable them, run once:");
      console.log("    npm run eval-service:setup\n");
    } else if (!(await isServicePortFree(SERVICE_PORT))) {
      console.log(`  Evaluation service: already running on port ${SERVICE_PORT}.\n`);
    } else {
      evalChild = startEvalService({ output: "prefixed" });
      console.log(`  Evaluation service: starting on port ${SERVICE_PORT}.\n`);
    }
  }

  waitUntilReady(url).then((ready) => {
    if (ready) {
      console.log("");
      console.log(`  ✓ Meridian is ready → ${url}`);
      console.log("");
      openBrowser(url);
    }
  });

  const stopAll = (signal) => {
    evalChild?.kill(signal);
    child.kill(signal);
  };
  child.on("exit", (code) => {
    evalChild?.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  process.on("SIGINT", () => stopAll("SIGINT"));
  process.on("SIGTERM", () => stopAll("SIGTERM"));
}

main();
