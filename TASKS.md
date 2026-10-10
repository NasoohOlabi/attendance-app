# Tasks

## Public release

Architecture and acceptance checks: [plans/public-release.md](plans/public-release.md).

- [x] P1: Inventory all Git refs, history, metadata, private configuration, and release artifacts. Classify actual secrets separately from private identifiers and example data.
- [x] P2: Back up outside the repository; revoke/rotate any confirmed leaked credentials; move private defaults into local configuration without losing the current installation's settings.
- [x] P3: The private history was replaced with one public root commit. Old commits are not in this repository.
- [x] N1: Package/path references now use attendance-app and the display name remains Masjid Attendance. Verify installed upgrades preserve app and installer identity and existing userData.
- [ ] S1: Obtain the compatible signed ZK4500 driver/Biokey installer, redistribution terms, and tested silent-install/reboot behavior.
- [x] S2: Bring scanner source and its contract into this repository; publish a supported, self-contained x86 CLI from source into a generated staging folder.
- [ ] S3: Build one offline installer containing the app, CLI/runtime, and licensed scanner prerequisites; handle elevation, cancellation, failures, and reboot requirements.
- [ ] V1: Upgrade affected dependencies and verify the actual packaged Electron/runtime versions; scan unpacked release contents for secrets and private data.
- [ ] V2: Verify clean installation, physical scanner capture/matching, reinstall/upgrade, data retention, and uninstall on the supported Windows target.
- [ ] R1: Add public setup/license documentation and recurrence checks; refresh the audit; repeat final history scan after all release changes before publication. Do not push without an explicit request.

- Today list, undo, scan-time fallback, in-app confirm, cream title bar — done
- Save several scans to one student at once — done
- Plain student list and search inset — done
- Fingertip icon embedded in the exe — done
- Settings language English / العربية, with RTL — done
- Link the roster, time log, and fingerprints by Marif id — done
- Fingerprints tab stores one template per row; the scanner loads local s-{id}.txt — done
- Remove Google Drive — done
