# Masjid attendance

Local Windows app for the Bouty mosque roster. A finger on the ZK4500 queues attendance for the student's Bouty ID. The settings file is optional and local. Bouty credentials are encrypted for the Windows user and remain in the Electron main process.

Scanner source lives in `scanner/`. `node scripts/scanner-release.mjs` publishes the self-contained exe into `staging/scanner/`, and dev launches the path in `zk4500Cli`. `scanner/AGENTS.md` is the capture and match contract. This file is the host app and the bugs that showed up while wiring the two together. The installer copies that staged folder to `resources/scanner/`. The packaged app runs that copy.

## Git

At the end of every user prompt, commit the work from that prompt. When a prompt produced more than one independent change, keep the commits small and atomic. Do not commit secrets (service-account JSON, `attendance.config.json`, private keys). Do not push unless the user asked. Each feature or change is its own pull request. The pull request targets nightly. Stable only receives changes that are already on nightly, and only through a pull request. Never push a feature commit straight onto stable. `bun run release` bumps the version, commits that version on the current code, then builds the installer from that commit. Do not ship an installer whose version commit is behind the code.

## Security before committing or pushing

Run `bun run setup:hooks` in each working or publication clone. It installs the tracked pre-push hook locally and refuses to replace another hooks directory. Never bypass it with `--no-verify`, disable it, or push with `--mirror`. Only publish explicit branches or tags after the user requests a push.

Before committing, run `bun run lint` and review the staged diff privately. The lint checks staged and working copies of tracked files. Never force-add ignored credentials, encrypted accounts, local configuration, fingerprint templates, installers, or vendor SDK binaries. Do not print secret values into terminals, reports, commit messages, or CI logs. The signature scan is a guard, not proof that arbitrary passwords or personal data are absent; review new files too.

Before pushing, scan the entire ancestry of each outgoing ref with `node scripts/security-lint.mjs --history <ref>`, run `bun audit`, and run the tests appropriate to the change. The hook scans the exact outgoing commit histories and messages, including deleted files. CI runs the same history check. Do not weaken a failing rule to make a push pass.

The original working history contains vendor DLLs. Publish from a new filtered clone made by `scripts/prepare-publication.ps1`, install its hook, and inspect its refs and remote before pushing. Do not add a remote to the original repository to bypass this process. Preserve the installer allowlist and `scripts/verify-package.cjs`; run the package verification before distributing an installer. Never upload quarantined installers. If a real credential was exposed, revoke or rotate it with its owner; deleting it from Git or encrypting the replacement does not revoke it.

## Stack

Node ESM, Bun, electron-vite (Vite 6), Electron 44, vanilla renderer (no React). `bun start` serves the renderer at `http://localhost:5173/` and opens the window. Tests: `bun test` (`node --test test/core.test.mjs`).

- Main process: `src/main/index.js`
- Preload: `src/preload/`
- Renderer: `src/renderer/index.html`, `style.css`, `renderer.js`, `view.js`
- Scan loop and zk4500 stdout: `src/scan.mjs`
- Bouty login, roster, and writes: `src/bouty.mjs` and `src/bouty-resolve.mjs`
- Persistent attendance queue and credentials: `src/bouty-sync.mjs` and `src/bouty-storage.mjs`
- Paths and ids: `src/config.mjs` and gitignored `attendance.config.json`

One attendance process at a time. One `zk4500.exe` at a time. Do not kill every `electron.exe` on the machine. Cursor is Electron too. Kill only the `electron-vite` node for this app, and only when `zk4500.exe` is not running (see the scanner bug below).

## Window

The profile stays `%APPDATA%\attendance-service`, the folder this installation already uses. The NSIS upgrade id stays `2febcda6-3658-5c7c-9dfa-528fe71d9a9a`, the id for `com.masjid.attendance`. Default size is 1120×800 (`minWidth` 900). The caption matches the page (`#efeae2`) and the Attendance / Settings row sits in that bar. The window itself does not scroll: today's names scroll inside the today card, which stays inside the ready area above the footer, the new-fingerprint names scroll inside `#list`, and Settings scrolls inside `#config`, with Save and Cancel kept at the bottom of that column. The sidebar title `#attendance` is a button. It closes Settings with `closeSettings`, closes Fingerprints with `closePrints`, and closes the dashboard with `show("ready")`, back on the finger screen. Attendance is selected there, Settings is selected on `#config`, Fingerprints is selected on `#prints`, and Dashboard is selected on the chart. The mark is a fingertip pressed on the sensor: `src/renderer/public/icon.svg` is the source, `build/icon.png` is the dev window icon, and `build/icon.ico` is embedded in the exe for the Start menu, the taskbar, and the packaged window. The ready screen is three columns: the finger cue on the left, the scan log in the middle, and today's حاضر names with their count on the right. On a match, `#last` sits above that log and shows the Info row: every non-empty header that is not a date. The full name is the title, `معرف` sits with the time, short values are chips, phones and long text are rows, and empty cells stay off the card. `TRUE` / `FALSE` is shown as Yes / No. Below 760px the log drops back under the cue, so a narrow window does not crush the columns. The new-fingerprint list, the Fingerprints page, and Settings stay a single column, capped at 760px and centered, so the search field does not stretch across the whole window. Browse sits on the same row as the path. Settings can switch the UI to Arabic, and the layout is RTL while that is on.

The place cue is an inline SVG of a finger and the sensor (`#place`):

- `now` — fingertip taps the sensor. Label: “Place your finger”. Only after `Scanner ready`, while the live step is still waiting.
- `hold` — fingertip stays down, green contact mark. Label: “Hold still”. This is `Finger detected`.
- `wait` — fingertip stays raised, sensor stays quiet. Label: “One moment”.

`fingerCue` in `src/renderer/view.js` decides that. Tones `again`, `listen`, `trouble`, and `idle` clear “ready”. `prefers-reduced-motion` parks `now` on the pressed pose with no loop.

## Bouty attendance

Roster identity is the Bouty student ID. Use the Marif ID from the source notes to migrate unambiguous legacy links. Require a unique active enrolment. Resolve the Damascus date to an existing attendance day and group session on Bouty before writing. The app sends individual present or absent operations with stable retry IDs. Never create days or group sessions from a scan.

Reuse one isolated Bouty session across roster lookups and attendance sync. Save verified credentials with Windows safeStorage in `~/Masjid/v1/config/bouty-account.enc`. Sign-out clears the file and session. Keep pending marks tied to the original account. The Today list and dashboard summarize local Bouty operations, including those awaiting sync.

Match the index's primary template and numbered copies such as `s-{id}--2.txt`. Preserve existing template names during migration and keep older copies on enrollment. Deleting prints removes local copies and links. The configured Google Sheets fingerprint tab is an append-only backup of linked samples. Keep Google credentials in the main process and keep attendance writes on Bouty.

Diagnostic lines go to `~/Masjid/logs/attendance-YYYY-MM-DD.log`. Look there first for scanner errors, Bouty failures, and renderer errors.

## Common bugs

### The same finger is treated as a new person

Symptom: six scans of one finger each scored 0 and opened the new-fingerprint picker.

Cause: `VerFingerFromStr` / `GetVerScore` returns 0 for these single-capture `GetTemplateAsString` templates. Swapping the argument order does not fix it. The registered template is the first argument and the verify template is the second; that was already correct.

Fix: 1:N match through `FPCacheDB.IdentificationFromStrInFPCacheDB`. The engine `Threshold` is set to 1 so the best score is reported. `match_found` is true only when that score is at least `--threshold` (default 8). Do not set `OneToOneThreshold`; the setter throws `E_UNEXPECTED`. `compare` must not call `GetVerTemplate`, because there is no live capture. Same-finger scores that have actually come back sit around 12–36.

The host prints `match_` lines. A capture with `capture_success=True` and a template is a success even when the process exit code is 1.

### The score is real, but the picker still opens

Symptom: the log says `match_score=35` (or similar) and the UI still says no match, with the template id full of `?`.

Cause: the .NET console code page replaced Arabic filename characters with ASCII `?` before Node read stdout, so `studentByTemplateSid` missed.

Fix: `Console.OutputEncoding = new UTF8Encoding(false)` at the start of `Main` in `ZK4500Cli.cs`. Node already reads stdout as utf8. In the scan log, the matched name is its own `dir="auto"` span so “Matched اسم رابع” does not reverse.

### Scanning looks dead, and every later capture says init failed (2)

Symptom: the first capture works, then “Scanner init failed (2)” while the app still waits ~25s. `info` shows `init=2`, `sensor_count=1`, empty vendor and product, and a bogus size such as 328×356.

Cause: the USB device is locked. `sensor_count=1` means the SDK can see it and cannot open it. Force-killing `zk4500.exe` (`taskkill /F`) skips `EndEngine` and wedges the driver. A healthy open is `init=0`, vendor `ZKSoftware Inc.`, product `ZK4500 Fingerprint Reader`, 276×360. PnP can still say the device is OK while `InitEngine` returns 2.

Fix: do not force-kill a process that owns the scanner. Let the capture exit. `OpenEngine` retries `InitEngine` once (`EndEngine`, 500ms, `SensorIndex=0`). If it is still not 0, the CLI prints `error=scanner_not_ready` and exits 1 without `BeginCapture`. To unlock the device, unplug and replug it, or run `pnputil /restart-device` as admin on `USB\VID_1B55&PID_0840\…`. `Disable-PnpDevice` has failed here with `0x80041001`. From Git Bash, `&` in that instance id is eaten unless the id is single-quoted inside PowerShell.

The host kill timer is `2 * timeout + grace` (45s when timeout is 20 and grace is 5), not `timeout + 5`. The first finger-down extends the CLI deadline once by another full timeout. `SCAN_RETRY_PAUSE_MS` is 2000. The running exe is `staging/scanner/zk4500.exe`, produced by `node scripts/scanner-release.mjs`.

### The place cue says to put a finger down before the sensor is open

Symptom: the finger animates during “Listening” or “Scanner not ready”.

Cause: the cue followed the latest line, including the wait that happens before `Scanner ready`.

Fix: `fingerCue` returns `now` only when a ready step is still in the trace and the live step is wait or ready. `hold` is finger-down. Everything else is `wait` (finger raised).

### Start and the taskbar show the Electron atom

Symptom: the installed app’s Start shortcut and taskbar button show a generic or Electron-atom icon. The fingertip mark is only in the dev window.

Cause: `BrowserWindow` pointed at `../../build/icon.png`, which is not inside `app.asar`, so the window fell back to the exe icon. `signAndEditExecutable: false` also skips the resource edit, so `win.icon` is never written into the exe and the NSIS shortcut keeps the Electron atom.

Fix: leave `icon` unset when `app.isPackaged` (dev still uses `build/icon.png`). Set `signExecutable: false` so the build still embeds `build/icon.ico` and skips code signing. Reinstall the new setup exe. Windows may keep the old picture until the shortcut is unpinned and the app is opened again, or Explorer is restarted.

### A second scanner process, or a rebuild that did not ship

Symptom: `InitEngine` fails as soon as a capture starts, or the match behavior does not match the C# you just edited.

Cause: another `zk4500.exe` already holds the device, or the process is still the copy in `cli\` while the new build is only under `cli\bin\`.

Fix: one owner. `info` takes the device too. Copy the Release output onto `cli\zk4500.exe` before expecting the app to run it. `cwd` for the spawn is the exe’s folder. The form stays off-screen (opacity 0, no taskbar button) and the spawn uses `windowsHide: false`.
