# Publication audit

Quick audit on 2026-10-10. Recommendation: do not publish the current repository yet.

- No common private-key, Google API-key, GitHub-token, or AWS access-key signatures were found in the tracked files across all 24 reachable commits. This was a pattern scan, not a guarantee that every possible secret was detected.
- Tracked history contains no service-account JSON, attendance.config.json, capture directory, or fingerprint roster file by filename. The current ignore rules exclude the known credentials and local output folders.
- Real spreadsheet IDs, the service-account email, mosque details, personal Windows paths, and student-like names appear in source, documentation, or test fixtures. Spreadsheet IDs and the email are not credentials. Review which details may be public and replace private details before publication. Existing history retains them after ordinary edits.
- npm audit reports 11 affected dependency packages: 3 high and 8 moderate. Electron is among the affected packages and is a shipped runtime despite being declared as a devDependency. npm audit --omit=dev reports zero, so that result alone does not establish that the desktop app is safe. Update and verify dependencies before distributing a release.
- No root project license or README is present. Choose a license if public reuse is intended and document setup. Bundled fonts have OFL notices, including notices copied into releases.
- The repository depends on a separate local scanner project for release builds. It cannot currently produce a scanner-equipped installer from a fresh clone alone.

## Name

The local folder, package.json, and bun.lock use attendance-app. Sheet ids and the service-account path are local configuration, not source defaults. The display name remains Masjid Attendance and the Electron app ID remains com.masjid.attendance. Historical references are covered by the separate publication cleanup plan. A full blob inventory on 2026-10-10 found no confirmed credential in git history. Raw results stay outside the repository.

## Scanner distribution

The scanner source is in `scanner/`. `node scripts/scanner-release.mjs` publishes a self-contained win-x86 CLI into `staging/scanner`, and the installer copies that folder. The staged output includes the .NET runtime. It does not include the USB driver or the Biokey ActiveX control.

The installed FPSensor folder contains SDK files and uninstallers, but no driver installer or INF/SYS/CAT package was found there. No matching scanner installer archive was found beside this repository during this check.

Before adding the driver, obtain the compatible vendor installer and its redistribution terms. Keep the existing ZKFPEngX implementation. Copying installed DLLs alone will not install the USB driver or register the ActiveX component. Driver installation also needs an elevation flow; the current app installer has allowElevation disabled.

Official vendor downloads: https://www.zkteco.com/en/download_center

Redistribution rights for the required legacy driver/SDK were not established by this audit. The package/path rename was subsequently completed. No driver binaries were added and nothing was pushed.
