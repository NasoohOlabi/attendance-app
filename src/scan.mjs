import { spawn } from "node:child_process";
import path from "node:path";

/**
 * One capture, then the process exits. cwd is the exe folder.
 *   zk4500.exe identify --timeout 20 --out DIR --prefix scan --match-dir TEMPLATES --threshold 8
 * The CLI waits `timeout` seconds. The first finger-down extends that once, by another
 * full timeout, so a print can take about two timeouts. Node must not kill before that.
 * Exit 0: capture saved (match_found may still be False). Exit 1: engine or save error.
 * Exit 2: idle timeout. Templates it will match are s-*.txt and t-*.txt only.
 */
export function scanArgs(timeoutSeconds, outDir, prefix) {
  return ["scan", "--timeout", String(timeoutSeconds), "--out", outDir, "--prefix", prefix];
}

export const SCAN_GRACE_SECONDS = 5;
export const SCAN_RETRY_PAUSE_MS = 2000;
export const SCAN_OUTAGE_STREAK = 8;
export const SCAN_OUTAGE_MESSAGE = "The scanner is having trouble. Still listening.";

/** A saved print is success. An empty miss waits, then tries once more. No red error. */
export function planScanRetry({ ok, timedOut, exitCode, streak = 0 } = {}) {
  if (ok) {
    return { retryNow: false, pauseMs: 0, keepListening: true, showError: false, message: "", streak: 0 };
  }
  if (timedOut || exitCode === 2 || exitCode === 1) {
    return { retryNow: false, pauseMs: SCAN_RETRY_PAUSE_MS, keepListening: true, showError: false, message: "", streak: 0 };
  }
  const next = Number(streak) + 1;
  const show = next >= SCAN_OUTAGE_STREAK;
  return {
    retryNow: false,
    pauseMs: SCAN_RETRY_PAUSE_MS,
    keepListening: true,
    showError: show,
    message: show ? SCAN_OUTAGE_MESSAGE : "",
    streak: next,
  };
}

export function beginScanAttempt(notice) {
  return { showError: false, message: "", streak: notice?.streak ?? 0 };
}

export function formatScanEvent(event) {
  if (event?.type === "started") return `Capture started · ${event.command || "identify"} · ${event.timeoutSeconds}s`;
  if (event?.type === "waiting") return `Waiting for a finger · ${event.elapsedSeconds}s`;
  if (event?.type === "killed") return `Stopped a capture that ran too long · ${event.elapsedSeconds}s`;
  if (event?.type === "exited") {
    if (event.timedOut) return `No finger · ${event.elapsedSeconds}s`;
    return `Scanner exited ${event.exitCode} · ${event.elapsedSeconds}s`;
  }
  if (event?.type === "result") {
    if (event.matched) return `Matched ${event.name || "student"} · score ${event.score} / ${event.threshold}`;
    return `No match · best ${event.score} / ${event.threshold}`;
  }
  if (event?.type === "finger") return "Finger detected";
  if (event?.type === "captured") return "Print captured";
  if (event?.type === "image") return "Picture saved";
  if (event?.type === "ready") return "Scanner ready";
  if (event?.type === "init") return `Scanner init failed (${event.code})`;
  if (event?.type === "next") return "Next capture scheduled";
  return "";
}

export function appendScanTrace(lines, event) {
  const text = formatScanEvent(event);
  if (!text) return lines || [];
  const current = lines || [];
  if (event.type === "waiting" && event.fingerDown) return current;
  if (event.type === "waiting" && String(current.at(-1) || "").startsWith("Waiting")) {
    return [...current.slice(0, -1), text];
  }
  return [...current, text].slice(-5);
}

/** Hang watchdog only. The CLI already extends its own deadline once a finger is down. */
export function captureKillDelay({
  elapsedMs = 0,
  timeoutMs = 20000,
  graceMs = SCAN_GRACE_SECONDS * 1000,
} = {}) {
  const limit = Number(timeoutMs) * 2 + Number(graceMs);
  return { kill: elapsedMs >= limit, waitMs: Math.max(0, limit - elapsedMs) };
}

/** A finished or hung capture always schedules another. The loop does not end. */
export function nextCapture({
  exited = false,
  exitCode = 0,
  timedOut = false,
  hasPrint = false,
  fingerDetected = false,
  fingerAtMs = 0,
  elapsedMs = 0,
  timeoutMs = 20000,
  graceMs = SCAN_GRACE_SECONDS * 1000,
} = {}) {
  const kill = captureKillDelay({ elapsedMs, timeoutMs, graceMs, fingerDetected, fingerAtMs }).kill;
  const hung = !exited && kill;
  if (!exited && !hung) return { scheduleNext: false, killChild: false, loopEnded: false, showError: false, immediate: false, pauseMs: 0 };
  const empty = Boolean(timedOut || exitCode === 2 || (exitCode === 1 && !hasPrint) || hung);
  return {
    scheduleNext: true,
    killChild: hung,
    loopEnded: false,
    showError: false,
    immediate: !empty,
    pauseMs: empty ? SCAN_RETRY_PAUSE_MS : 0,
    quiet: Boolean(timedOut || exitCode === 2 || exitCode === 1 || hung),
  };
}

/** identify captures once, then matches *.txt in matchDir whose names start with s- or t-. */
export function identifyArgs(timeoutSeconds, outDir, prefix, matchDir, threshold = 8) {
  return [
    "identify",
    "--timeout",
    String(timeoutSeconds),
    "--out",
    outDir,
    "--prefix",
    prefix,
    "--match-dir",
    matchDir,
    "--threshold",
    String(threshold),
  ];
}

function quoteArg(part) {
  return /[\s"]/.test(part) ? `"${part}"` : part;
}

export function formatCommand(exe, args) {
  return [exe, ...args].map(quoteArg).join(" ");
}

export function parseZkOutput(output) {
  const result = {};
  for (const line of String(output).split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** If the engine said the print succeeded, keep the jpg and template it wrote. */
export function mergeCapturedFiles(result, filePaths) {
  if (result?.ok || result?.timedOut) return result;
  if (result?.parsed?.capture_success !== "True") return result;
  const files = filePaths || [];
  const image = files.find((file) => String(file).toLowerCase().endsWith(".jpg"));
  const template = files.find((file) => String(file).toLowerCase().endsWith(".txt"));
  if (!template) return result;
  return {
    ...result,
    ok: true,
    timedOut: false,
    error: "",
    imagePath: result.imagePath || image,
    templatePath: result.templatePath || template,
  };
}

export function interpretScan(stdout, exitCode) {
  const parsed = parseZkOutput(stdout);
  const timedOut = exitCode === 2 || parsed.error === "timeout";
  const saved = parsed.capture_success === "True" && Boolean(parsed.template) && !timedOut;
  if (saved) {
    return { ok: true, templatePath: parsed.template, imagePath: parsed.image ?? "", parsed };
  }
  if (timedOut) {
    return { ok: false, timedOut: true, error: "Fingerprint capture timed out.", parsed };
  }
  return {
    ok: false,
    error: parsed.error || `zk4500 scan failed (exit ${exitCode}).`,
    parsed,
  };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}

function consumeLines(buffer, chunk, onLine) {
  const pending = buffer + chunk;
  const parts = pending.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  for (const line of parts) if (line && onLine) onLine(line);
  return rest;
}

async function runZk(exe, args, timeoutSeconds, onLine) {
  const command = formatCommand(exe, args);
  const timeoutMs = Number(timeoutSeconds) * 1000;
  const graceMs = SCAN_GRACE_SECONDS * 1000;
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let pending = "";
    let settled = false;
    let killed = false;
    let timer;
    const take = (chunk) => {
      stdout += chunk;
      pending = consumeLines(pending, String(chunk), (line) => {
        if (/^(error|image|template|capture_success)=/.test(line) || line.startsWith("match_")) {
          console.log(line);
        }
        if (onLine) onLine(line);
      });
    };
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pending && onLine) onLine(pending);
      resolve({ stdout, exitCode, command, killed });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const delay = captureKillDelay({ elapsedMs: 0, timeoutMs, graceMs });
    timer = setTimeout(() => {
      killed = true;
      killTree(child.pid);
      setTimeout(() => finish(2), 2000);
    }, delay.waitMs);
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(killed ? 2 : (code ?? 1)));
  });
}

function fromRun(run, interpret) {
  if (run.killed) {
    return {
      ok: false,
      timedOut: true,
      killed: true,
      exitCode: 2,
      error: "Fingerprint capture timed out.",
      command: run.command,
      parsed: parseZkOutput(run.stdout),
    };
  }
  return { ...interpret(run.stdout, run.exitCode), command: run.command, exitCode: run.exitCode };
}

export async function runScan({ exe, timeoutSeconds, outDir, prefix }) {
  const run = await runZk(exe, scanArgs(timeoutSeconds, outDir, prefix), timeoutSeconds);
  return fromRun(run, interpretScan);
}

function numericField(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function interpretIdentify(stdout, exitCode) {
  const scan = interpretScan(stdout, exitCode);
  const parsed = scan.parsed || {};
  const matched = scan.ok && parsed.match_found === "True" && Boolean(parsed.match_sid);
  return {
    ...scan,
    timedOut: !scan.ok && (exitCode === 2 || parsed.error === "timeout"),
    matched,
    matchSid: parsed.match_sid || "",
    matchScore: numericField(parsed.match_score),
    matchThreshold: numericField(parsed.match_threshold),
    matchLoaded: numericField(parsed.match_loaded),
    matchBestSid: parsed.match_best_sid || "",
  };
}

export async function runIdentify({ exe, timeoutSeconds, outDir, prefix, matchDir, onLine }) {
  const run = await runZk(exe, identifyArgs(timeoutSeconds, outDir, prefix, matchDir), timeoutSeconds, onLine);
  return fromRun(run, interpretIdentify);
}
