# Tasks

## Public release

Architecture and acceptance checks: [plans/public-release.md](plans/public-release.md).

- [x] P1: Inventory all Git refs, history, metadata, private configuration, and release artifacts. Classify actual secrets separately from private identifiers and example data.
- [x] P2: Back up outside the repository; revoke/rotate any confirmed leaked credentials; move private defaults into local configuration without losing the current installation's settings.
- [x] P3: Prepare a branch-only public copy with interop DLLs removed throughout retained history. Keep this working repository and internal checkpoints intact; publish only the filtered copy.
- [x] N1: Package/path references now use attendance-app and the display name remains Masjid Attendance. Verify installed upgrades preserve app and installer identity and existing userData.
- [ ] S1: Obtain the compatible signed ZK4500 driver/Biokey installer, redistribution terms, and tested silent-install/reboot behavior.
- [x] S2: Bring scanner source and its contract into this repository; publish a supported, self-contained x86 CLI from source into a generated staging folder.
- [ ] S3: Build one offline installer containing the app, CLI/runtime, and licensed scanner prerequisites; handle elevation, cancellation, failures, and reboot requirements.
- [x] V1: Upgrade Electron/build dependencies; verify renderer/preload and directory packaging; bun audit reports no vulnerabilities. Restrict packaged files and reject credential JSON after packing.
- [ ] V2: Verify clean installation, physical scanner capture/matching, reinstall/upgrade, data retention, and uninstall on the supported Windows target.
- [x] R1: Add README, MIT license, packaging guard and repeatable publication-history filtering/checks. Refresh the audit and verify the final public copy. Do not push without an explicit request.
- [ ] SEC1: Replace the service-account key potentially exposed in old installers, update private configuration, and revoke the old key. Old release artifacts are quarantined; this is a confirmed packaging bug, not evidence of unauthorized access.

- Today list, undo, scan-time fallback, in-app confirm, cream title bar — done
- Save several scans to one student at once — done
- Plain student list and search inset — done
- Fingertip icon embedded in the exe — done
- Settings language English / العربية, with RTL — done
- Link the roster, time log, and fingerprints by Marif id — done
- Fingerprints tab stores one template per row; the scanner loads local s-{id}.txt — done
- Remove Google Drive — done
