import { app, session } from "electron";
import { GoogleAuth } from "google-auth-library";
import { homedir, tmpdir } from "node:os";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.ATTENDANCE_E2E_ROOT;
const endpoint = new URL(process.env.ATTENDANCE_E2E_ENDPOINT);
if (!root || !path.isAbsolute(root) || endpoint.hostname !== "127.0.0.1" || endpoint.protocol !== "http:") {
  throw new Error("E2E requires an absolute isolated root and loopback transport.");
}
const inside = (file) => {
  const relative = path.relative(realpathSync(root), path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes the E2E root: ${file}`);
};
for (const file of [homedir(), tmpdir(), process.env.ATTENDANCE_CONFIG, process.env.FINGERPRINT_DIR]) inside(file);
const appData = path.join(root, "appdata");
mkdirSync(appData, { recursive: true });
app.setPath("appData", appData);
globalThis.__attendanceClock = Date.parse(process.env.ATTENDANCE_E2E_CLOCK);
if (!Number.isFinite(globalThis.__attendanceClock)) throw new Error("Invalid E2E business clock.");
const WallDate = Date;
globalThis.Date = class extends WallDate {
  constructor(...args) {
    super(...(args.length ? args : [globalThis.__attendanceClock]));
  }
};

GoogleAuth.prototype.getClient = async () => ({
  request: async (options) => {
    const response = await fetch(new URL("request", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    });
    const result = await response.json();
    if (result.error) {
      const error = new Error(result.error.message);
      if (result.error.status) error.response = { status: result.error.status, data: result.error.data };
      throw error;
    }
    return result;
  },
});

app.on("ready", () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed = ["file:", "print:", "devtools:", "data:"].includes(url.protocol);
    if (!allowed) console.error(`E2E blocked external request ${details.url}`);
    callback({ cancel: !allowed });
  });
});
await import(pathToFileURL(path.resolve("out/main/index.js")).href);
