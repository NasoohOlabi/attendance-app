# Public release plan

History rewrite and installer changes remain planned. The attendance-app package/path naming is applied; the display name and application identity are retained.

## Architect progress

- [x] Ground: trace configuration, history, scanner, and installer boundaries.
- [x] Sketch: compare two distinct release designs.
- [x] Agree: record the chosen design and unresolved inputs.
- [x] Implement: turn the design into ordered tasks and acceptance checks. Code implementation is outside this request.
- [x] Scrap: define when new evidence requires redesign.

## Problem and current flow

Publish reusable source without private operational data, give the app consistent names, and distribute one installer that supplies the scanner prerequisites. The quick audit found no common secret signatures across 24 commits. A complete scan must establish whether actual credentials ever appeared; spreadsheet IDs and service-account email are identifiers, not credentials.

`app.whenReady()` calls `startLoop()`, which loads configuration through `loadConfig(configOptions())`. Packaged configuration lives at `app.getPath("userData")`; the scanner resolves to `resources/scanner/zk4500.exe`. `runIdentify()` calls `runZk()`, which launches the CLI from its executable folder and reads UTF-8 event lines. The CLI's STA WinForms host opens the Biokey ActiveX engine, captures/matches a finger, and releases it with `EndEngine`. Main then resolves the Marif ID and writes attendance through Google Sheets.

`package.json` currently copies six CLI files from an absolute sibling workspace. The scanner targets x86, Windows Forms, framework-dependent .NET 9; its interop assemblies require the separately installed Biokey OCX, USB libraries, and driver. Current NSIS settings disallow elevation. Commit `b33af61` explicitly added bundling to remove the installed app's dependence on a workspace path. Keeping the build source outside this repo appears to have been a minimal integration, rather than a reproducible public build design.

There is no Git remote configured. Besides `master`, local refs include T3 checkpoint refs. History cleanup must happen in an isolated publication copy, never by deleting live harness refs. Source-control history, local source, both AGENTS contracts, and official deployment documentation are the evidence for this plan. External tracker/chat/analytics searches are outside this local release task; vendor redistribution terms and hardware compatibility remain unverified.

## Usage first

The recipient runs one setup EXE, accepts Windows elevation when needed, and launches the ordinary-user app from its shortcut. No separate CLI, runtime, driver download, terminal, or manual OCX registration is required. If the vendor package requires rebooting, setup explains this and waits to claim readiness until after reboot and verification.

The first Google Sheets configuration remains private onboarding: choose a local service-account key and spreadsheet settings. Existing installations retain their configuration. A public installer must never include the mosque's key or private settings. Installation can work offline; Google attendance writes need connectivity.

The maintainer builds from a fresh checkout with declared Node/.NET build tools and an approved vendor payload. A proposed `bun run dist` performs scanner publish, verifies/stages payloads, and builds one setup artifact. The recipient needs none of those build tools.

## Naming

Selected names: repository and npm package `attendance-app`; existing display name `Masjid Attendance`. The package, lockfile, credential defaults and local configuration use the selected path/name. Existing display labels stay as they are. No remote repository has been renamed.

Keep `com.masjid.attendance` as the application identity. Capture the actual old installed app's userData directory and effective NSIS installer identity before changing the npm name. Pin or migrate that path before loading config or creating the window; preserve renderer preferences, logs, and fingerprints under their current locations. Do not guess the legacy directory from productName alone.

## Chosen shape

Prefer one source repository with an imported, audited `scanner/` project and a self-contained x86 CLI. A single installer supplies the licensed vendor prerequisite and the per-user Electron app. NSIS owns prerequisite orchestration, while the ordinary-user main process retains scanner ownership. Prove elevation and original-user launch in a prototype before committing to this installer mechanism.

Self-contained publishing includes the .NET runtime but does not include the USB driver or replace ActiveX registration. Use a supported Windows Forms target, preferably .NET 10 after x86 COM and physical-device compatibility checks. Keep trimming and single-file publishing disabled initially. Copy the entire verified publish output, rather than the old six-file list. Runtime security updates require rebuilding the self-contained release.

One versioned manifest owns vendor provenance, hashes, redistribution evidence, detection, validated installation arguments, success/reboot codes, and supported OS targets. A generated staging manifest inventories the published CLI files. Build and installer input derive from these records; nobody hand-maintains duplicate DLL lists. Reject unapproved, missing, or mismatched payloads before packaging. Vendor installation commands remain unresolved until the actual compatible package is inspected.

| Proposed owner | Responsibility |
| --- | --- |
| `scanner/` | C# source, project, interop integration, scanner AGENTS contract; becomes the canonical scanner implementation |
| `build/scanner-payload.json` | Approved vendor package/provenance/install contract; contains no private configuration |
| `scripts/scanner-release.mjs` | Publish CLI, verify vendor payload, generate staging inventory and installer input |
| `build/installer.nsh` | Prerequisite detection, bounded elevation, exit/reboot handling, original-user install/launch |
| `scripts/prepare-publication.ps1` | Build and verify a sanitized publication copy using private removal policy |
| `src/config.mjs`, main startup | Public configuration boundary, stable storage path, staged CLI path |
| Generated staging directory | Complete CLI/runtime, licensed prerequisite payload, notices; ignored by Git |

Illustrative call sites, after implementation:

```js
const payload = await prepareScannerPayload({ sourceDir, vendorManifest, stagingDir });
// Packaging consumes this verified staging inventory, not an arbitrary sibling EXE.
```

```powershell
# Illustrative future maintainer command; the private policy is outside the repo.
.\scripts\prepare-publication.ps1 -Destination 'D:\publication\attendance-app' -PolicyPath 'D:\private\publication-policy.json'
```

Data and signature sketch in ESM/JSDoc, not runnable scaffolding:

```js
/** @typedef {{path:string, sha256:string}} PayloadFile */
/** @typedef {{sourceCommit:string, buildParameters:string[], rid:'win-x86', framework:string,
 * files:PayloadFile[], vendorContractPath:string}} VerifiedScannerPayload */
/** Validates vendor inputs, publishes CLI, records output and emits installer input. */
export async function prepareScannerPayload({ sourceDir, vendorManifest, stagingDir }) {
  throw new Error('not implemented');
}
```

The PowerShell publication command is a separate maintainer boundary, never part of app startup or packaging. It validates destination and ref policy, rewrites only its isolated clone, then emits a private finding report and commit map. Boundary validation hides build/file/install mechanics behind one scanner preparation operation and one publication operation. Existing attendance and scanner APIs remain intact.

## Ordered tasks and acceptance

The matching checklist is in [TASKS.md](../TASKS.md). Each independent source change gets its own commit. Finish naming and installer edits before the final history pass so later changes cannot reintroduce removed details.

| Task | Work | Completion evidence |
| --- | --- | --- |
| P1 | Inventory all refs, blobs, filenames, commit/tag messages, author metadata, binaries, LFS if present, ignored build inputs, and scanner import source. Run a secret scanner plus targeted private-literal review. Store raw results outside Git. | Private findings distinguish confirmed secrets, privacy identifiers, public examples, and false positives; intended public branch/tag list recorded. |
| P2 | Make a verified private backup outside all publication/build directories. Rotate/revoke any confirmed exposed key first. Move real Sheets IDs, credential paths, mosque details, and disallowed names into ignored local config; make examples generic. Add missing log/fingerprint/credential ignore and packaging exclusions without excluding required CLI runtime JSON. | Restore check succeeds; current private deployment still resolves the same settings; no private value is printed or committed by the cleanup tooling. |
| P3 | Use a non-hardlinked isolated clone and approved removal policy with `git-filter-repo` or equivalent reviewed tooling. Remove sensitive paths/content and, if needed, metadata throughout intended public refs. Exclude internal checkpoint refs only in that copy. | Scan every intended public branch/tag, reachable history, messages and actual fresh clone. Private backup/source/harness refs intact; rewritten hashes and commit mapping documented privately. No mirror push. |
| N1 | Rename package and lockfile to `attendance-app`; update docs and intended display labels consistently. Preserve app ID and effective installer upgrade identity. Stabilize actual legacy userData before name-dependent lookup. | Existing config, language/font preferences, enrollment files and today list survive upgrade; single-instance behavior, icon, shortcut and uninstall entry remain correct. |
| S1 | Obtain compatible signed ZK4500/Biokey installer and legal redistribution evidence for all driver/OCX/SDK components. Inspect and test actual unattended arguments, dependencies, detection, error/reboot codes and supported Windows versions. | Approved payload has version, source, digest, signature check, notices and tested install contract. No claim of driver readiness based only on PnP enumeration. |
| S2 | Audit and import scanner source and its contract; stop attendance builds using absolute sibling paths. Verify supported .NET x86 target, publish self-contained untrimmed output, stage CLI/runtime and licensed prerequisites. | Fresh checkout builds with declared tools and approved payload; no dependency on absolute sibling workspace paths; CLI source revision matches staged manifest. Development uses the same canonical source/build. |
| S3 | Prototype and implement one offline setup EXE. Detect installed prerequisites before starting app; elevate machine work; install/launch app under the original ordinary user. Handle cancelled UAC, failed prerequisite, restart and rerun deterministically. | No manual runtime download/OCX registration. Setup never silently succeeds after driver failure or launches into an administrator's data profile; rerun preserves data. |
| V1 | Update affected Electron/build dependencies with core and build verification; inspect packaged runtime versions and unpacked installer resources for sensitive data and required notices. | `bun test`, production build and installer build pass; dependency findings resolved or individually documented with evidence. Zero confirmed secrets/disallowed private data in app.asar, resources, setup or build logs. |
| V2 | Install offline on a clean supported Windows machine with no scanner SDK/runtime; repeat setup, upgrade, cancellation and failure/reboot cases. Use a real ZK4500 for capture, same-finger match and release verification. | Ordinary-user app reaches healthy ready; one owner; UTF-8 IDs; all capture/match/save contracts pass. Uninstall preserves enrolled data and does not remove shared vendor components other apps depend on. |
| R1 | Add README, chosen project license and vendor/font/runtime notices, secret scanning and payload validation checks. Refresh audit, rerun P3 verification over final edits and approved refs, publish only on explicit request. | Public source is generic and reproducible; release contents have clear provenance; no private scanner/source history imported accidentally. |

If no genuine credential is discovered, report that result rather than claiming a key was removed or rotated. Privacy cleanup can still rewrite history. Retain sanitized history by default; starting with a new root commit is an alternative only if retaining it cannot be verified or the user chooses that tradeoff. If prior publication is later discovered, address remote refs, cached views and other clones separately; local rewriting cannot erase their copies.

## Verification contracts

Keep the ZKFPEngX engine, x86/STA WinForms host, cache matching and threshold, UTF-8 stdout, single owner, exe-folder working directory, minimized form and current capture deadline contract. Never call `info` during a live capture or force-kill the scanner during installer/rebuild work. Healthy device verification runs only with no capture owner.

Core tests verify configuration/migration and unchanged attendance planning. A clean VM proves installation mechanics; physical hardware proves the USB/COM boundary. Verify fingerprint enrollment and repeated same-finger recognition, graceful exit and reopen, and absent-device failure. Sheet writes use mocks or an explicitly approved test sheet, never extra cells in the mosque sheet.

## Synthesis decision

Compared [candidate A](candidates/a.md), unified scanner source and self-contained runtime, with [candidate B](candidates/b.md), pinned separate scanner release and offline runtime bootstrapper. Both were screened for duplicated payload lists, split storage ownership, stale executable paths and installer user-context leakage.

The independent judge scored A/B respectively: history safety 2/2, installer realism 2/2, source-build provenance 2/1, data preservation 1/2, interface depth 1/2. Despite B's higher unweighted total, both the judge and this synthesis select A because building the shipped scanner from the same checkout directly meets this project's release goal. B is a viable fallback, not an install-time network dependency.

Grafted B's single packaging operation, explicit installer identity preservation, same staged CLI for development, source revision/build parameters/hashes, and vendor signature validation. Kept A's backup restoration gate and supported self-contained runtime. Rejected public stage-by-stage build APIs, arbitrary sibling EXE copying, install-time prerequisite downloads and routine history squashing. Preferred Claude/Grok runner models were unavailable; grounding, both candidates and the judge used the available parent model, so this is independent agent comparison rather than cross-family review.

Verification: traced live configuration/startup/scan/packaging paths, compared both complete candidates and checked each task for observable acceptance criteria. No runtime or hardware tests were run because this commit changes plans only. Driver compatibility and actual elevation behavior remain implementation gates.

## Tradeoffs and redesign triggers

Accept a larger installer and responsibility for patching the bundled runtime in exchange for no separate runtime installation. Accept retaining legacy identity/storage names in exchange for safe upgrades. The scanner source import moves its maintenance into this repository; the external project must not remain a competing canonical implementation.

Vendor licensing/package availability is a shipment dependency. If the package cannot be redistributed, use an approved alternative distribution arrangement and revise the one-click promise. If NSIS cannot preserve user context or handle vendor reboot/install behavior reliably, redesign around an offline outer bootstrapper. If .NET 10 self-contained publishing breaks COM, re-ground and compare a supported framework-dependent runtime design rather than patching scanner semantics blindly.

## Open inputs

- Which compatible vendor package and redistribution terms can be obtained?
- Which Windows versions/architectures will the release support?
- Which root project license should govern reuse?

These inputs are recorded for implementation; they do not block this planning deliverable.

## Reference checks

Rotate confirmed exposed credentials before history cleanup; changing hashes does not revoke them. [GitHub sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

Self-contained publishing carries the platform runtime; framework-dependent publishing requires a preinstalled runtime. [Microsoft publishing overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/).

.NET 9 support ends November 10, 2026; .NET 10 LTS ends November 14, 2028. Recheck support and patches at implementation time. [Microsoft support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).
