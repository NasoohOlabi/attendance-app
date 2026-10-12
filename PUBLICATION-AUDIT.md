# Publication audit

Updated 2026-10-12. Public source preparation is complete for the separately filtered publication copy. This working repository retains historical interop binaries; do not publish it directly or mirror its internal refs.

## Completed source work

- Added a README and MIT license for the app's own source. Third-party licenses remain separate.
- Upgraded Electron to 44.7.0, electron-builder to 26.15.3, and Vite to 6.4.4. Required Node version is now 22.12 or later. Overrides select http-cache-semantics 4.3.0 and global-agent 4.1.3; the latter removes the vulnerable sprintf-js dependency chain. bun audit reports no vulnerabilities.
- Removed both scanner interop DLLs from tracking while preserving the ignored local copies. Scanner publishing still works locally and fails clearly before deleting staging when a wrapper is missing.
- Added scripts/prepare-publication.ps1. It makes a separate committed-branch clone, filters both interop DLLs from its history, excludes checkpoint/tag refs, checks common secret signatures and commit messages, and leaves no remote. No push occurs.
- Verified a filtered clone with frozen-lockfile installation, core tests, production build, dependency audit, ref inspection and history checks. Pattern scanning cannot prove absence of every possible secret.
- Verified the built renderer/preload on Electron 44.7.0, including state IPC, settings, Arabic RTL and sandboxed Node isolation. Directory packaging also passed. Physical scanner and Google writes were not exercised in this task.

## Confirmed packaging security bug

The previous packaging configuration allowed a local service-account key into app.asar. The key was found in a private verification build and the prior release's unpacked app. Git source/history scans did not find that credential. No secret values were printed or committed.

The build now allows only out/, package.json and LICENSE, plus automatically collected production dependencies. An afterPack guard rejects unexpected root files and credential-shaped JSON. It rejects the known unsafe old package and accepts the fixed one. This corrects the failed root-JSON exclusion instead of adding another filename-specific rule.

The old setup EXE, blockmap and unpacked app were moved to ignored release/quarantine/. Do not distribute them. Sharing history is uncertain; the account owner must replace the potentially exposed service-account key, update private configuration, verify access and revoke the old key. No key rotation was performed. This is a confirmed security bug; no unauthorized access or public disclosure has been established.

Google guidance: https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys

## Source publication versus installer distribution

Only the verified filtered source copy is intended for GitHub publication. Locally supplied interop wrappers and vendor SDK/driver components are not included in that copy. Their redistribution rights remain unresolved for binary releases.

The self-contained scanner still targets net9.0-windows and does not install the USB driver or Biokey ActiveX control. The complete driver-installing setup, supported-runtime migration and clean-machine/hardware checks remain release work. No new setup installer was shipped by this task.

The package remains attendance-app, display name Masjid Attendance, app identity com.masjid.attendance, and legacy attendance-service user profile. No credentials, private configuration or live scanner lifecycle were changed. Nothing was pushed.
