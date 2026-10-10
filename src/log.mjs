import { appendFileSync, mkdirSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Bug log. Not the roster log.json inside the fingerprints folder. */
export function appLogDir(home = homedir()) {
  return path.join(home, "Masjid", "logs");
}

export function appLogFile(date = new Date(), home = homedir()) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return path.join(appLogDir(home), `attendance-${day}.log`);
}

export function appLogLine(level, message, date = new Date()) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const text = String(message ?? "").replace(/\s*\n\s*/g, " | ").trim();
  return `${stamp} ${level} ${text}\n`;
}

export function textOf(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export async function appendAppLog(file, line) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, line, "utf8");
}

export function appendAppLogSync(file, line) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, line, "utf8");
}

export function createAppLogger(home = homedir()) {
  let chain = Promise.resolve();
  const writeLine = (level, args, sync) => {
    const date = new Date();
    const line = appLogLine(level, textOf(args), date);
    const file = appLogFile(date, home);
    if (sync) {
      appendAppLogSync(file, line);
      return;
    }
    chain = chain.then(() => appendAppLog(file, line)).catch(() => {});
  };
  return {
    record: (level, args) => writeLine(level, args, false),
    recordSync: (level, args) => writeLine(level, args, true),
  };
}

let attached = false;

/** Copy console and crash lines into ~/Masjid/logs. Safe to call once per process. */
export function startAppLog(home = homedir()) {
  if (attached) return;
  attached = true;
  const logger = createAppLogger(home);
  for (const [method, level] of [
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      logger.record(level, args);
    };
  }
  process.on("unhandledRejection", (reason) => {
    logger.recordSync("error", ["unhandled rejection", reason]);
  });
  process.on("uncaughtException", (err) => {
    logger.recordSync("error", ["uncaught exception", err]);
    process.exit(1);
  });
  console.log(`attendance log ${appLogFile(new Date(), home)}`);
}

function pad(value) {
  return String(value).padStart(2, "0");
}
