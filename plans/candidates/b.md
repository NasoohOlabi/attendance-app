# Candidate B: pinned scanner release and offline bootstrapper

Planning only. No history rewrite, application rename, installer execution, or publication occurs in this task.

## Problem

The application depends on a separate scanner repository, a framework-dependent Windows x86 CLI, and an installed vendor SDK/OCX and USB driver. Bundling the CLI alone cannot make a clean Windows installation work. Public publication also needs a sanitized history and generic configuration without destroying live T3 checkpoint references. The audit found privacy identifiers but no common credential signatures in 24 commits; that finding does not prove every historical object is safe.

## Usage (caller's view)

The maintainer runs one build after approving a vendor package and publishing a pinned scanner release:

```powershell
bun run package:windows
```

That command produces one offline `attendance-app-setup.exe`. The user runs it, approves Windows elevation for machine prerequisites, and then starts Masjid Attendance under their normal account. First launch requests private Google configuration once. Later launches need no terminal, external scanner folder, or manual runtime installation.

Illustrative build and publication call sites:

```js
const setup = await buildWindowsInstaller({ manifestPath: 'build/windows-payload.json', outputDirectory: 'dist' });
const publication = await preparePublicRepository({ sourceDirectory, destinationDirectory, policyPath: 'publication-policy.private.json' });
const report = await verifyPublicRepository(publication.directory);
```

The publication calls are explicit maintainer commands and never run during packaging or application startup. The private removal policy lives outside the publication repository.

## Shape

Keep the scanner in its own repository. Its release contains the CLI, required adjacent DLLs and .NET files, source commit, archive checksum, and licensing notices. The attendance build downloads or reads that one pinned artifact, verifies it, and stages its exact contents in `resources/scanner`. Development also stages that artifact instead of using a hardcoded sibling executable. A scanner release must be rebuilt when its source changes; the attendance build never copies an arbitrary existing `cli/zk4500.exe`.

An outer offline bootstrapper owns machine prerequisites. It detects and installs the exact supported x86 .NET Desktop Runtime selected after testing the CLI on .NET 10 and licensed vendor SDK/driver package, handles reboot-required results, and invokes the existing per-user Electron installer as the original logged-in user. Elevation applies to prerequisites only. If the bootstrapper technology cannot preserve that user identity, it fails this design's acceptance gate. It must never save configuration or fingerprints in an administrator's profile.

One checked-in payload manifest records scanner release provenance, prerequisite checksums, authorized redistribution evidence, validated install commands, detection rules, and reboot result handling. Public build scripts own validation and staging. Actual private Google configuration stays outside every payload. The packaging command hides dependency ordering and detection details behind one operation, per boundary-discipline and minimize-reader-load.

| Owner | Responsibility |
| --- | --- |
| `build/windows-payload.json` | One pinned list of redistributable payloads and their installation contracts |
| `scripts/package-windows.mjs` | Verify payloads, stage scanner, build the inner app and outer installer |
| `build/bootstrapper/` | Machine prerequisite detection and installation; normal-user app install and launch |
| `scripts/publication.mjs` | Isolated publication clone, approved branch/tag selection, filtering, and verification |
| `src/config.mjs` | Generic public defaults and external private user configuration |
| `src/main/index.js` | Stable explicit data directory and packaged scanner path |
| `zk4500-cli` release | Scanner implementation and verified scanner binaries |

Illustrative domain sketch, recorded in Markdown rather than runnable stubs:

```ts
type ScannerRelease = {
  sourceCommit: string;
  archive: { location: string; sha256: string };
};
type ApprovedPrerequisite = {
  id: string;
  archive: { location: string; sha256: string };
  redistributionEvidence: string;
  detection: InstalledVersionRule;
  install: ValidatedVendorInstallCommand;
  rebootExitCodes: number[];
};
type WindowsPayload = {
  scanner: ScannerRelease;
  prerequisites: ApprovedPrerequisite[];
};
type PublicationResult = { directory: string; commitMapPath: string; selectedRefs: string[] };
type PublicationReport = { credentialFindings: Finding[]; privacyFindings: Finding[]; reachableObjectCount: number };

async function buildWindowsInstaller(input: {
  manifestPath: string; outputDirectory: string;
}): Promise<{ setupPath: string; sha256: string }> {
  throw new Error('not implemented');
}
async function preparePublicRepository(input: {
  sourceDirectory: string; destinationDirectory: string; policyPath: string;
}): Promise<PublicationResult> {
  throw new Error('not implemented');
}
async function verifyPublicRepository(directory: string): Promise<PublicationReport> {
  throw new Error('not implemented');
}
```

These are design signatures, not a request to introduce TypeScript into this ESM project. Boundary parsing creates approved payload values only after checksum, license evidence, and install-contract validation. An unchecked download cannot become a release payload.

Publication uses a separate local clone and an explicit allowlist of intended public branches and tags. It excludes `refs/t3/checkpoints` and other harness refs. Filtering removes discovered credential files and sensitive content throughout the selected history, preserves useful commit structure, and scans every remaining reachable object. Commit-message privacy and historical binary contents require review too. The original repository remains the recovery copy. Confirmed exposed credentials must be revoked or rotated independently of filtering. If an external remote already exists, its copies require a separate coordinated cleanup; no remote currently exists in the grounded model.

Rename the repository and package to `attendance-app`; keep the visible product `Masjid Attendance` unless the user chooses a new display name. `Hudur` is a shorter alternative, but trademark and GitHub availability need verification before adoption. Capture the installed app's actual userData path before renaming. Keep the effective app ID, installer GUID/identity, explicit mapping to that captured directory, and fixed fingerprint path so changing the npm package cannot hide existing configuration or fingerprints. Changing installer identity requires a separate migration.

## Synthesis decision

Candidate A was selected as the base. This design contributed packaging-interface, installer-identity and provenance safeguards; its outer bootstrapper remains a fallback. See [public-release.md](../public-release.md).

## Tradeoffs accepted

- We accept an outer installer and a larger offline download in exchange for one distributed executable that installs machine prerequisites correctly.
- We accept a separate pinned scanner release in exchange for an independent scanner capture/match contract and reproducible attendance builds.
- We accept elevation and possible reboot in exchange for installing a real Windows USB driver. Neither can be promised away.
- We accept changed commit hashes in the publication clone in exchange for preserving useful historical changes after sensitive content removal.

## Alternatives considered

Importing scanner source and publishing a self-contained CLI removes the .NET runtime prerequisite and gives one source build. It also moves scanner maintenance and native package licensing into this repository. It may offer a smaller installer API if integrated NSIS can correctly install the driver and preserve the normal user's app context.

Publishing only a new root commit makes privacy verification simpler, but loses useful history. Choose it only if retained history cannot pass verification or the user explicitly prefers a fresh history.

Downloading prerequisites at install time reduces installer size but fails the offline single-distributable requirement and makes installation depend on mutable vendor endpoints.

## Open questions and risks

- Which compatible vendor SDK/driver installer permits redistribution and supports unattended installation and reboot detection?
- Can the chosen bootstrapper install the inner per-user app and launch it under the original account after UAC elevation?
- Which confirmed credential or private-data findings require removal, and which configuration identifiers should remain only in private local configuration?
- Does the CLI pass COM and physical-device verification on .NET 10 x86 WinForms? .NET 9 support ends November 10, 2026, so a new installer must target a supported runtime. Verify the target against [Microsoft's support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).

## Tasks and acceptance

1. Inventory selected branches/tags, historical credential paths, names, spreadsheet IDs, service-account identifiers, and binaries. Record findings outside the public clone. Distinguish privacy findings from confirmed credentials.
2. Replace public defaults and examples with generic values. Preserve the working private configuration outside Git. Resolve dependency advisories with supported versions and run core tests.
3. Create and sanitize the isolated publication clone. Validate branch/tag selection, commit mappings, tracked files, reachable historical blobs, and messages. Acceptance: zero confirmed credentials or disallowed private identifiers remain; source repository and harness references are untouched.
4. Rename package/repository metadata and document display-name choices. Acceptance: old user data is found after upgrade and product/app ID decisions are explicit.
5. Obtain the vendor package and redistribution permission, validate its signature/provenance, and test actual detection/install commands. Acceptance: build fails when any required package, authorization, or checksum is missing.
6. Upgrade and verify the CLI on a supported x86 Windows Forms target, then produce a pinned scanner release and stage it in attendance builds. Acceptance: packaged CLI hash matches the release manifest, required adjacent files exist, and no sibling source directory is needed.
7. Build the offline bootstrapper. Acceptance: on a clean supported Windows machine, it installs prerequisites and the app with bounded elevation, reports reboot requirements, and launches as the normal user. A second run detects installed prerequisites and preserves enrolled templates.
8. Verify with the physical ZK4500. Acceptance: one scanner owner, graceful process exit, UTF-8 names, scanner-ready cue, matching, fingerprint save, and Google configuration onboarding all work. Keep attendance writes limited to the authorized cell/log contracts.
9. Review the resulting publication clone and installer reports before any GitHub push or release. No public push is part of this planning task.

## Red-flag screen

The manifest owns payload versions and checksums once; generated installer input derives from it. Publication and packaging own different state and never share output directories. The application has one staged scanner path per development/package mode and no fallback to stale sibling binaries. The public operations complete whole maintainer tasks, so callers do not coordinate validation, download, and installation stages themselves. The unavoidable cost is the bootstrapper layer, which must prove it preserves the original user identity before this design can ship.

## Next implementation step

Build the private history inventory and generic configuration changes first, before filtering history or changing installer behavior.
