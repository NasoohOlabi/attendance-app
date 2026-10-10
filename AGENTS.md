# Masjid attendance

Local Windows app for the mosque sheet. A finger on the ZK4500 marks the student حاضر. Read this before changing the scanner, the sheet, or the window. Spreadsheet ids, gids, and the service-account path live in gitignored `attendance.config.json`, not in source.

Scanner source lives in `scanner/`. `node scripts/scanner-release.mjs` publishes the self-contained exe into `staging/scanner/`, and dev launches the path in `zk4500Cli`. `scanner/AGENTS.md` is the capture and match contract. This file is the host app and the bugs that showed up while wiring the two together. The installer copies that staged folder to `resources/scanner/`. The packaged app runs that copy.

## Git

At the end of every user prompt, commit the work from that prompt. When a prompt produced more than one independent change, keep the commits small and atomic. Do not commit secrets (service-account JSON, `attendance.config.json`, private keys). Do not push unless the user asked. `bun run release` bumps the version, commits that version on the current code, then builds the installer from that commit. Do not ship an installer whose version commit is behind the code.

## Stack

Node ESM, Bun, electron-vite (Vite 6), Electron 38, vanilla renderer (no React). `bun start` serves the renderer at `http://localhost:5173/` and opens the window. Tests: `bun test` (`node --test test/core.test.mjs`).

- Main process: `src/main/index.js`
- Preload: `src/preload/`
- Renderer: `src/renderer/index.html`, `style.css`, `renderer.js`, `view.js`
- Scan loop and zk4500 stdout: `src/scan.mjs`
- Sheet planning: `src/store.mjs`
- Google writes: `src/google.mjs`
- Paths and ids: `src/config.mjs` and gitignored `attendance.config.json`

One attendance process at a time. One `zk4500.exe` at a time. Do not kill every `electron.exe` on the machine. Cursor is Electron too. Kill only the `electron-vite` node for this app, and only when `zk4500.exe` is not running (see the scanner bug below).

## Window

The profile stays `%APPDATA%\attendance-service`, the folder this installation already uses. The NSIS upgrade id stays `2febcda6-3658-5c7c-9dfa-528fe71d9a9a`, the id for `com.masjid.attendance`. Default size is 1120×800 (`minWidth` 900). The caption matches the page (`#efeae2`) and the Attendance / Settings row sits in that bar. The window itself does not scroll: the new-fingerprint names scroll inside `#list`, and Settings scrolls inside `#config`. The mark is a fingertip pressed on the sensor: `src/renderer/public/icon.svg` is the source, `build/icon.png` is the dev window icon, and `build/icon.ico` is embedded in the exe for the Start menu, the taskbar, and the packaged window. The ready screen is three columns: the finger cue on the left, the scan log in the middle, and today's حاضر names with their count on the right. Below 760px the log drops back under the cue, so a narrow window does not crush the columns. The new-fingerprint list and Settings stay a single column, capped at 760px and centered, so the search field does not stretch across the whole window. Browse sits on the same row as the path. Settings can switch the UI to Arabic, and the layout is RTL while that is on.

The place cue is an inline SVG of a finger and the sensor (`#place`):

- `now` — fingertip taps the sensor. Label: “Place your finger”. Only after `Scanner ready`, while the live step is still waiting.
- `hold` — fingertip stays down, green contact mark. Label: “Hold still”. This is `Finger detected`.
- `wait` — fingertip stays raised, sensor stays quiet. Label: “One moment”.

`fingerCue` in `src/renderer/view.js` decides that. Tones `again`, `listen`, `trouble`, and `idle` clear “ready”. `prefers-reduced-motion` parks `now` on the pressed pose with no loop.

## Sheet

Mosque grid: the `spreadsheetId` / `sheetGid` in `attendance.config.json`, tab title `Info`.

- Column A header `إسم كامل` is the student name. Column B header `معرف` is the Marif id (`00 00 000 001`). Link the roster, the time log, and fingerprints by that id. The same name may appear twice when the ids differ. Two rows with the same id are a duplicate: `planAttendance` returns `duplicate` and writes nothing. A row with no id is not written.
- Row 1 is headers. Row 2 is counts (`COUNTA`). Students start at row 3.
- A present cell is the date checkbox, and that checkbox’s checked value is the Arabic word `حاضر`. An absent cell is empty, which leaves the box unchecked. `attendanceValue` returns that. `COUNTA` counts every non-empty cell, so `TRUE` / `FALSE` is the wrong value.
- Write the one date cell for that id. Do not restyle the sheet, do not write a whole row, and do not add a row for an unknown name.
- Date columns are not in strict calendar order. Today’s column is whichever header matches today’s day and month (`findDateColumn`). Inserting `معرف` moved the first date from M to N.

Time log: `logSpreadsheetId` / `logSheetGid` in `attendance.config.json`, tab `AttendanceLog` in the file titled Pages. Headers are `الطالب`, `إسم`, and `حضور`. New rows store the Marif id in `الطالب`, the roster name in `إسم`, and the Damascus stamp in `حضور`. The app does not add that name column; when it is missing, the row is still just the id and the stamp. Existing rows are left as they are. The window still shows the Arabic name by looking the id up on the roster. The timestamp is Asia/Damascus, day/month, no leading zeros, 24-hour clock, for example `3/10/2026 16:55:03` (`attendanceStamp` / `attendanceLogRow`). The log does not store the word حاضر.

The log append runs after the cell write. If the append throws, the حاضر cell stays and the detail line is “Marked present. The time log was not written.”

Today’s list can undo one student: that clears their date cell and leaves the checkbox, then deletes the matching time-log row for today, matched by id. Writing `""` through the values API leaves the checkbox and `COUNTA` still counts it, so the clear goes through `writeAttendanceCell`. Changing the clock keeps the Damascus date and rewrites that log row (`stampFromClock`). When the log has no time, the clock shows when the finger was scanned.

Diagnostic lines for this app go to `~/Masjid/logs/attendance-YYYY-MM-DD.log`. That file gets scanner lines, sheet failures, renderer errors, and uncaught exceptions. Look there first when something breaks after the terminal is gone. The roster file `log.json` inside the fingerprints folder is the enrolled-student list, not this bug log.

Fingerprints tab: same Pages file, `fingerprintSheetGid` in `attendance.config.json`, tab `FingerPrints`. Headers are `student_id`, `fingerprint`, and `created_at`. A saved print appends one row: the Marif id, the template text, and the scan time in the same Damascus stamp as the time log. Several rows can share an id. The scanner still matches local files: `s-{id}.txt`, with spaces in the id turned into hyphens (`s-00-00-000-001.txt`), extras `s-{id}--2.txt`. `zk4500 identify` only loads `*.txt` whose stem starts with `s-` or `t-`. Saving a print writes the local file and appends one sheet row. If that append throws, the local file stays and the detail line says the fingerprint sheet was not written. Startup copies sheet templates that are missing on disk and does not delete local files the sheet lacks.

Prints stay on this computer: `~/Masjid/v1/fingerprints/templates/`. Settings → Delete all fingerprints removes those local files, the pending scan, the roster, and every data row on the fingerprints tab. The header row stays. The attendance sheet is left as it is. The sheet is cleared before the local files, so a failed sheet write does not wipe the copies that startup would restore. Startup still copies sheet templates that are missing on disk and does not delete local files the sheet lacks. Google Drive is not used.

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

### The checkbox disappears, or the count jumps

Symptom: today’s cell shows the word `حاضر` and the checkbox is gone, or the cell is a boolean and the row-2 count is higher than the number of students who were here.

Cause: the date checkbox is a `BOOLEAN` rule whose checked value is `حاضر`. `spreadsheets.values.update` stores that word and deletes the rule. Boolean `FALSE` is non-empty, so `COUNTA` counts it as present.

Fix: `writeAttendanceCell` sets `حاضر` or clears the cell and writes the same checkbox rule in that `updateCells` call. Do not write `TRUE` or `FALSE`. Do not write extra test cells.

### The time log never grows

Symptom: the student is حاضر, and the UI says the time log was not written. The API returns `403 PERMISSION_DENIED` for the Pages spreadsheet.

Cause: the Pages spreadsheet is not shared with the service account. The fingerprints tab on that same file is refused too.

Fix: share that spreadsheet as Editor with the service-account email from the key file. The key file is gitignored. Do not keep retrying the append, and do not undo the حاضر cell when the append fails. A failed fingerprint append leaves the local `s-{id}.txt` in place.

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

Fix: one owner. `info` takes the device too. Copy the Release output onto `cli\zk4500.exe` before expecting the app to run it. `cwd` for the spawn is the exe’s folder. The form stays minimized and the spawn uses `windowsHide: false`.
