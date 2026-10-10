# ZK4500

Windows USB fingerprint scanner, ZKTeco ZK4500, `USB\VID_1B55&PID_0840`. One-shot 32-bit CLI. Read this before touching the scanner.

## Stack

`ZK4500Cli.cs` hosts `AxZKFPEngX` (ZKFPEngX ActiveX) on a hidden WinForms message pump. `zk4500.csproj` is `net9.0-windows`, `PlatformTarget` x86, `RuntimeIdentifier` win-x86. A normal build is framework-dependent and needs the x86 .NET 9 desktop runtime. `node scripts/scanner-release.mjs` publishes a self-contained, untrimmed win-x86 output into `staging/scanner/`. That folder is gitignored and is what the installer copies.

The OCX and its USB libraries are the installed Biokey SDK, typically `C:\Program Files (x86)\FPSensor\Biokey\` (`biokey.ocx`, `USB.dll`, `usb_dll.dll`). This directory vendors the interop assemblies:

- `AxInterop.ZKFPEngXControl.dll`
- `Interop.ZKFPEngXControl.dll`

Stay on ZKFPEngX. Switch to libzkfp only if asked.

## Rules

1. One process owns the scanner. A second process that calls `InitEngine` (`info`, `scan`, or `identify`) while another holds the device fails or fights it. `info` takes the device too.
2. The owner runs in the logged-in user session, STA, with a message pump. This CLI is `[STAThread]` and calls `Application.Run` on a form that stays off-screen: opacity 0, no border, no taskbar or Alt-Tab button. The HWND stays alive. Do not minimize it; with `ShowInTaskbar` false, Windows shows that minimized form on the desktop. `BeginCapture()` returns immediately. `OnFingerTouching`, `OnFingerLeaving`, `OnFeatureInfo`, `OnImageReceived`, and `OnCapture` run on that pump. A Windows service (Session 0) cannot host it.
3. Today the product is still one-shot: `zk4500.exe scan|identify|info`. Each call starts a process, calls `InitEngine`, and for scan/identify calls `BeginCapture`, arms a timeout (default 20s), prints `key=value` lines, calls `EndEngine`, and exits. Exit code 2 is timeout.
4. `server-integration/scanner.mjs` uses `execFile` and reads stdout only after the process exits. `finger=detected` and the other live lines reach an HTTP client only then. Timeouts already stack: the CLI deadline, the Node kill timeout (`timeout + 5` seconds), and the browser or host HTTP client. Leave that stack alone.
5. Use this CLI until the long-running owner in Direction exists.

## Commands

Run `staging/scanner/zk4500.exe`:

```text
zk4500.exe info
zk4500.exe scan [--timeout 20] [--out PATH] [--prefix capture] [--no-template] [--save-image-event]
zk4500.exe identify [--timeout 20] [--out PATH] [--prefix capture] [--match-dir PATH] [--threshold 8] [--no-template] [--save-image-event]
```

No args, `-h`, `--help`, or `help` prints usage and exits 0. An unknown command or flag prints usage and exits 1.

Defaults: `--timeout` 20 (minimum 1), `--out` and `--match-dir` `{exe dir}/captures`, `--prefix` `capture`, `--threshold` 8 (clamped 1–100). `--no-template` skips the template file. `--save-image-event` also writes a JPG from `OnImageReceived` when `aImageValid` is true. That flag works and is omitted from `--help`.

Exit codes: `0` success, `1` error, `2` timeout (`capture_success=False`, `error=timeout`). Identify with no match still exits 0 when the capture itself succeeded. Check `match_found`.

`info` prints the device block and exits. It captures nothing. Exit 0 only when `InitEngine` returns 0.

## Capture timing

A WinForms timer ticks every 250ms. The deadline starts at `timeout` seconds from `BeginCapture`. The first finger-down (`OnFingerTouching`, or the timer seeing the finger still down) extends that deadline once, by another `timeout` seconds. The extended deadline is final. On timeout the CLI calls `CancelCapture`, closes the form, and `EndEngine`.

`OnCapture` with `actionResult` false prints `capture_success=False` and keeps waiting until the deadline.

## Stdout

One `key=value` line. `scanner.mjs` keeps the last value when a key repeats.

After every `InitEngine`:

```text
init=
engine_valid=
sensor_count=
sensor_index=
vendor=
product=
image_width=
image_height=
out_dir=
```

`init=0` means `InitEngine` succeeded. `product` is the SDK `ProduceName`. Width and height come from the sensor at runtime.

Scan and identify also print `waiting_seconds=`, then event lines as they happen: `finger=detected`, `finger=removed`, `quality=`, `image_valid=`, `capture_success=`. A saved capture adds `image=`, and unless `--no-template` was set, `template=` and `template_length=`. Failures print `error=` (save exception, init/host exception, or `timeout`).

Identify adds:

```text
match_threshold=
match_loaded=
match_found=True|False
match_best_sid=
match_sid=
match_score=
```

`match_sid` is set only when `match_found` is True. `match_best_sid` is the highest score even below the threshold. An empty capture template prints `match_found=False`, `match_error=empty_template`, `match_score=0`, `match_loaded=0`. A file that throws prints `match_skip=` and `match_skip_error=` and is skipped. A thrown identify pass prints `match_found=False`, `match_error=`, `match_score=0` and still exits 0 if the image save succeeded.

## Files

- JPG: `{out}/{prefix}-{yyyyMMdd-HHmmss}.jpg` (`SaveJPG`). `--prefix` applies to this name.
- Template text (`GetTemplateAsString`): `{out}/template-{yyyyMMdd-HHmmss}.txt`. The filename prefix is the literal `template`.
- `--save-image-event`: `{out}/image-event-{yyyyMMdd-HHmmss}.jpg`.
- Identify reads `*.txt` in `--match-dir` whose filename without extension, lowercased, starts with `s-` or `t-`. It skips empty files. `template-*.txt` is not a candidate.
- Matching loads those candidates into the engine's fingerprint cache and runs `IdentificationFromStrInFPCacheDB` (1:N). It also decodes each candidate and runs `IdentificationInFPCacheDB` against `GetVerTemplate`. `VerFingerFromStr` both argument orders is only a fallback when both cache scores are under `--threshold`. The engine threshold is set to 1 so the best score is reported; `match_found` is true only when that score is at least `--threshold`. `compare --template FILE --match-dir PATH` runs the same matcher without a new capture.
- `captures/` is gitignored. It is biometric data.

Direct CLI scans must be renamed to `s-…txt` or `t-…txt` before identify will load them. The host scan route does that rename when it is given a sid (see below).

## Node

The attendance host is `src/scan.mjs`. It spawns the published exe and reads UTF-8 stdout. The old Express snapshot from the scanner workspace was not imported.

## Build

```text
node scripts/scanner-release.mjs
```

That runs `dotnet publish` self-contained for `win-x86`, with single-file and trimming off, into `staging/scanner/`. `bin/` and `obj/` are gitignored. Run that script after a scanner change, then point `zk4500Cli` at `staging/scanner/zk4500.exe`.

## Common bugs

### Same finger scores 0

`VerFingerFromStr` and `GetVerScore` return 0 for these `GetTemplateAsString` captures. Both argument orders do that. The registered template is the first argument; the order was not the bug.

Match with `IdentificationFromStrInFPCacheDB`. Set the engine `Threshold` to 1 so the best score is printed. `match_found` is true only when the score is at least `--threshold` (default 8). Do not set `OneToOneThreshold`; the setter throws `E_UNEXPECTED` even after a successful `InitEngine`. `compare` has no live capture, so it must not call `GetVerTemplate`. Same-finger scores that have come back sit around 12–36.

### Arabic ids print as `?`

The console code page replaces Arabic filename characters before the host reads stdout. A real score then still fails the name lookup. `Main` sets `Console.OutputEncoding = new UTF8Encoding(false)` before any output.

### `init=2` with `sensor_count=1`

The device is locked, not absent. A healthy open is `init=0`, vendor `ZKSoftware Inc.`, product `ZK4500 Fingerprint Reader`, 276×360. A locked device reports `init=2`, empty vendor and product, and a bogus size such as 328×356. PnP can still say the device is OK.

`taskkill /F` on `zk4500.exe` skips `EndEngine` and wedges the driver. Do not force-kill the owner. `OpenEngine` retries `InitEngine` once (`EndEngine`, 500ms, `SensorIndex=0`). If it is still not 0, print `error=scanner_not_ready` and exit 1 without `BeginCapture`. Unlock it by unplugging the reader or by `pnputil /restart-device` as admin on `USB\VID_1B55&PID_0840\…`.

### Host kills a live finger

The idle deadline is `--timeout` seconds. The first finger-down extends it once, by another full timeout. A host that kills at `timeout + 5` seconds cuts off that extension. The attendance app waits `2 * timeout + grace`.

### Edited source, old exe

`dotnet publish` writes `staging/scanner/`. That is the exe the host runs. Run `node scripts/scanner-release.mjs` after a scanner change.

## Direction

Not built. The intended next step is one long-running 32-bit process in the logged-in user session: it owns the scanner, streams events on localhost SSE, and takes instant POSTs for enroll, cancel, and reload. The CLI stays a bench tool. Until that process exists, call `zk4500.exe`.
