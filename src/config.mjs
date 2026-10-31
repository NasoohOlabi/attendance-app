import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Profile directory the installed app already uses. Not the display name or the npm package name. */
export const LEGACY_USER_DATA_DIR = "attendance-service";

export function legacyUserDataPath(appData) {
  return path.join(appData, LEGACY_USER_DATA_DIR);
}

const DEFAULTS = {
  serviceAccountJson: "",
  spreadsheetId: "",
  sheetGid: null,
  logSpreadsheetId: "",
  logSheetGid: null,
  fingerprintSheetGid: null,
  fingerprintDir: path.join(homedir(), "Masjid", "v1", "fingerprints"),
  zk4500Cli: "",
  scanTimeoutSeconds: 20,
  syncIntervalSeconds: 60,
  updateChannel: "stable",
};

function filled(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^your_/i.test(text)) return "";
  if (/path[/\\]to[/\\]/i.test(text)) return "";
  return text;
}

function pickGid(envValue, fileValue, fallback = DEFAULTS.sheetGid) {
  const chosen = envValue !== undefined && String(envValue).trim() !== "" ? envValue : fileValue;
  const text = filled(chosen);
  if (!text) return fallback;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function resolvePath(value, baseDir) {
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Packaged scanner lives next to the app, under resources/scanner/. */
export function scannerExeInResources(resourcesPath) {
  return path.join(resourcesPath, "scanner", "zk4500.exe");
}

/**
 * Env wins over attendance.config.json. Paths in the file resolve next to that file.
 * Packaged builds pass scannerDefault and scannerFallback so a missing saved path
 * uses the exe under process.resourcesPath. Dev leaves both unset.
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, scannerDefault?: string, scannerFallback?: string, exists?: (file: string) => boolean }} [options]
 */
export function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const configPath = env.ATTENDANCE_CONFIG
    ? path.resolve(cwd, env.ATTENDANCE_CONFIG)
    : path.join(cwd, "attendance.config.json");

  let file = {};
  if (existsSync(configPath)) {
    file = JSON.parse(readFileSync(configPath, "utf8"));
  }
  const baseDir = path.dirname(configPath);

  const serviceFromEnv = filled(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const serviceAccountJson = resolvePath(
    serviceFromEnv || filled(file.serviceAccountJson) || DEFAULTS.serviceAccountJson,
    serviceFromEnv ? cwd : baseDir,
  );
  // Home path is fixed. FINGERPRINT_DIR is for tests only; the config file cannot move it.
  const fingerprintDir = resolvePath(env.FINGERPRINT_DIR || DEFAULTS.fingerprintDir, cwd);
  const zkFromEnv = filled(env.ZK4500_CLI);
  const zkFromFile = filled(file.zk4500Cli);
  const scannerDefault = options.scannerDefault || DEFAULTS.zk4500Cli;
  let zk4500Cli = resolvePath(zkFromEnv || zkFromFile || scannerDefault, zkFromEnv ? cwd : baseDir);
  if (options.scannerFallback && (zkFromEnv || zkFromFile) && !exists(zk4500Cli)) {
    zk4500Cli = options.scannerFallback;
  }

  return {
    serviceAccountJson,
    spreadsheetId: filled(env.SPREADSHEET_ID) || filled(file.spreadsheetId) || DEFAULTS.spreadsheetId,
    sheetGid: pickGid(env.SHEET_GID, file.sheetGid),
    logSpreadsheetId: filled(env.LOG_SPREADSHEET_ID) || filled(file.logSpreadsheetId) || DEFAULTS.logSpreadsheetId,
    logSheetGid: pickGid(env.LOG_SHEET_GID, file.logSheetGid, DEFAULTS.logSheetGid),
    fingerprintSheetGid: pickGid(env.FINGERPRINT_SHEET_GID, file.fingerprintSheetGid, DEFAULTS.fingerprintSheetGid),
    fingerprintDir,
    zk4500Cli,
    scanTimeoutSeconds: positiveNumber(
      env.SCAN_TIMEOUT_SECONDS ?? file.scanTimeoutSeconds,
      DEFAULTS.scanTimeoutSeconds,
    ),
    syncIntervalSeconds: positiveNumber(
      env.SYNC_INTERVAL_SECONDS ?? file.syncIntervalSeconds,
      DEFAULTS.syncIntervalSeconds,
    ),
    updateChannel: String(file.updateChannel || DEFAULTS.updateChannel).toLowerCase() === "nightly" ? "nightly" : "stable",
    configPath,
  };
}

export function requireGoogleConfig(config) {
  const missing = [];
  if (!config.serviceAccountJson) missing.push("serviceAccountJson / GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!config.spreadsheetId) missing.push("spreadsheetId / SPREADSHEET_ID");
  if (config.sheetGid === undefined || config.sheetGid === null || config.sheetGid === "") {
    missing.push("sheetGid / SHEET_GID");
  }
  if (!config.fingerprintDir) missing.push("fingerprintDir / FINGERPRINT_DIR");
  if (missing.length) {
    throw new Error(
      `Missing config: ${missing.join(", ")}. Copy attendance.config.example.json to attendance.config.json or set the env vars.`,
    );
  }
}
