# Candidate A: one repository, self-contained scanner, offline installer

## Problem

Publish a reusable attendance app without publishing private credentials, fingerprints, roster data, or mosque-specific configuration, and install both the app and scanner prerequisites from one setup executable. Existing history contains deployment-specific details but no confirmed credential signature; those categories must remain distinct. The scanner owns a USB device and x86 COM SDK, so importing its source does not remove the vendor prerequisite. Existing data paths must survive a name change.

## Usage (caller's view)

Public project/repository/package: `attendance-app`; visible product: `Masjid Attendance`. `Hudur` is a shorter alternative but needs a separate availability check before adopting it. Keep `com.masjid.attendance` and capture the exact userData directory from the existing installed app, then pin it explicitly before changing any identity; naming is presentation, not migration.

A new user runs `Attendance App Setup.exe`, accepts Windows elevation for the licensed scanner prerequisite, then opens the app without elevation. Setup works offline. First launch requests Google sheet and credential configuration once; one-click installation cannot create external account permissions. Driver reboot or plug/replug instructions appear only when required by the verified vendor installer.

Release maintainer usage, after the planned scripts are implemented:

```powershell
bun run scanner:build
bun run dist
```

Publication maintainer usage, after the publication script is implemented:

```powershell
.\scripts\prepare-publication.ps1 -Destination 'D:\publication\attendance-app' -PolicyPath 'D:\private\publication-policy.json'
```

Three internal call sites:

```js
await buildScannerRelease({ sourceRoot: 'scanner', outputRoot: 'resources/scanner' });
const release = await readInstallerRelease('resources/scanner-release.json');
await verifyInstallerRelease(release); // build refuses missing files or redistribution evidence
```

## Shape

Single repository owns the app, scanner CLI source, and installer composition. Import source after checking its repository for secrets and vendor redistribution restrictions; keep its capture/match contract beside the source. Do not import private templates, credentials, previous build output, or unlicensed vendor material.

Module map:

- `scanner/`: C# CLI source/project and scanner contract; publish `win-x86` self-contained output on a supported Windows Forms TFM, targeting `net10.0-windows` only after x86 COM and hardware compatibility proof. .NET 9 support ends November 10, 2026; .NET 10 LTS is supported through November 14, 2028 ([official policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)).
- `scripts/scanner-release.mjs`: build and validate scanner payload; owns the release-file list and digest checks.
- `resources/scanner-release.json`: one release manifest for CLI output plus legally distributable vendor payload and license evidence. Packaging and installer derive payload selection from it.
- `build/installer.nsh`: NSIS prerequisite orchestration using vendor-documented install and detection behavior; app launch returns to original unelevated user.
- `scripts/prepare-publication.ps1`: owns sanitized-copy creation, policy enforcement, history rewrite, and publication-ref checks. Its private policy/report/backup live outside both repositories.
- `src/config.mjs` and main configuration boundary: public empty defaults, explicit legacy data directory, validated user-supplied Google configuration. Existing scan module remains the sole scanner process owner.

Data and signature sketch (ESM/JSDoc; planning only):

```js
/** @typedef {{relativePath: string, sha256: string}} ReleaseFile */
/** @typedef {{kind:'redistributable', version:string, files:ReleaseFile[],
 * licenseEvidencePath:string, detection:object, install:object}} VendorPrerequisite */
/** @typedef {{schemaVersion:1, runtime:'win-x86-self-contained',
 * cliFiles:ReleaseFile[], vendor:VendorPrerequisite}} ScannerRelease */
/** @typedef {{sourceRoot:string, outputRoot:string}} ScannerBuild */

/** Publishes x86 CLI and records all required files; no partial release accepted. */
export async function buildScannerRelease(build) { throw new Error('not implemented'); }
/** Parses and validates disk manifest at the build boundary. */
export async function readInstallerRelease(manifestPath) { throw new Error('not implemented'); }
/** Checks payload integrity and redistribution evidence before packaging. */
export async function verifyInstallerRelease(release) { throw new Error('not implemented'); }
```

The eventual manifest uses concrete, vendor-supported install/detection fields; the `object` placeholders above are explicitly unresolved until the real installer is inspected. A driver payload cannot become a release by setting an unchecked boolean. NSIS derives required files from the verified manifest; do not hand-sync DLL lists in multiple scripts (per single source of truth). The small release API hides publishing and payload validation, while PowerShell owns destructive-history mechanics behind one publication command (per boundary-discipline).

History work happens in an isolated publication clone only. Before rewriting, inventory branches, tags, checkpoints, LFS, and all reachable objects; rotate any confirmed credentials. Make a private full backup outside the repository and verify restoration. Rewrite all intended public branches/tags, replace deployment literals, remove sensitive paths and messages, and discard nonpublic/harness refs only in the publication clone. Do not rewrite the working repository or destroy live `refs/t3/checkpoints`. Scan reachable objects and the actual exported bundle afterward; inspect ignored/untracked payloads separately before packaging. Do not upload until audit passes and the user requests a push.

Scanner lifecycle remains one app owner and one CLI owner. Preserve UTF-8 stdout, cache 1:N matching, template success despite exit code 1, correct spawn directory, `windowsHide:false`, and graceful device release. Installer prerequisite detection runs before starting the app and never probes hardware while a capture owns it. Installing twice must converge without deleting fingerprints.

## Synthesis decision

Selected as the base, with candidate B's build-interface and migration safeguards. The final synthesis and ordered tasks are in [public-release.md](../public-release.md).

## Tradeoffs accepted

- We accept a larger setup executable in exchange for no separate .NET runtime download.
- We accept scanner source and SDK integration in this repository in exchange for a single reproducible release boundary.
- We accept keeping the legacy application id/data directory in exchange for a rename that preserves enrolled fingerprints and configuration.
- We accept delaying driver bundling until licensing and install semantics are verified in exchange for an installer that can be published legitimately and tested accurately.

## Alternatives considered

- Separate scanner repository/artifact plus runtime bootstrapper hides scanner development from this repo but exposes artifact version coordination and network/runtime installation to release maintainers and users; weaker for an offline one-click target.
- Squash to a clean initial commit simplifies proof of public contents but discards useful history; retain sanitized history where the audit can prove it clean.
- Driver instructions outside setup have the smallest implementation but expose vendor package choice and installation order to every user, missing the requested outcome.

## Open questions and risks

- Which official ZK4500/Biokey package is compatible with the installed FPSensor OCX, and does its license permit redistribution of every needed driver/SDK/COM file?
- What documented installer options, detection method, reboot codes, and supported Windows architectures does that package provide?
- Does self-contained publishing preserve this legacy x86 COM behavior on a clean machine, or does the vendor package require another distributable runtime?

These are evidence tasks, not requests to stop planning. Driver shipment remains blocked until resolved.

## Acceptance tasks

1. Inventory every historical/publication ref, private literal/path, credential finding, dependency vulnerability, and scanner-source restriction; retain a private report without copying sensitive values into public plans.
2. Build and verify the private backup, sanitize isolated history, scan every intended public reachable object, verify clone/restore, and publish only a clean artifact. No force-push in this task.
3. Set repository/package name to `attendance-app`; sync lockfile and documentation, pin legacy data location, retain application id, and verify an upgrade keeps configuration and templates.
4. Import audited CLI source and prove the supported .NET 10 Windows/x86 migration against COM and real capture/matching, then publish self-contained x86; generate the manifest and fail packaging for absent dependencies, digest mismatches, or absent redistribution evidence.
5. Obtain official driver package and redistribution terms; document exact required SDK/COM/runtime components and supported OS versions. Implement only documented installer/detection behavior.
6. Build offline NSIS installation with prerequisite detection, elevation, clear failure/reboot handling, and unelevated app launch. Preserve user data on upgrade/uninstall unless explicitly requested otherwise.
7. Test on a clean Windows VM with no .NET or scanner SDK: install offline, rerun setup, cancel UAC, inject driver failure/reboot, and verify standard-user app launch. Verify real ZK4500 ready/capture/match and clean release of the device separately on hardware.
8. Verify published source, setup payload, and installed directory contain no credentials, roster, fingerprint templates, live sheet defaults, or private reports; run core tests and dependency audit before the release commit.

## Red-flag screening

One release manifest owns payload membership; one publication command owns sanitized-copy mechanics; one module retains runtime scanner ownership. No competing configuration defaults, duplicate installer file lists, mixed elevated UI, or overwrite of live history. Unresolved vendor fields remain a task rather than executable scaffolding.

## Next implementation step

Implement the private publication inventory and restoration check, then sanitize an isolated clone before importing scanner source or changing package identity.
