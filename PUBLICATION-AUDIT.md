# Publication audit

Updated 2026-10-12. Source appears clean of the checked secrets, but public publication readiness is not yet established.

## Checks performed

- Working tree was clean before this audit. No Git remote is configured.
- Scanned tracked text across all 24 reachable commits for common private-key, Google API-key, GitHub-token and AWS access-key signatures. No matches. This pattern scan is not a guarantee of absence of every possible secret.
- Checked current files and reachable history for the previously known spreadsheet IDs, service-account identifier, key filename and named fixture. No matches.
- Historical filenames showed no tracked local attendance.config.json, service-account file, capture directory or fingerprint roster.
- Local configuration and the known key file are ignored. Source defaults for sheet identifiers and credential paths are empty. Actual local credentials were not printed or added to Git.
- Master contains 20 commits. Internal T3 checkpoint refs remain. Publication should push only intended branches/tags, never mirror all refs. No ref was changed by this audit.

## Remaining publication work

- Verify redistribution rights/provenance for the tracked scanner/AxInterop.ZKFPEngXControl.dll and scanner/Interop.ZKFPEngXControl.dll. Source publication includes those binaries even without shipping the vendor driver.
- Add a README describing setup, private Google configuration and scanner prerequisites. Choose a root project license if public reuse is intended; a missing license does not itself expose secrets.
- Resolve or individually assess dependency advisories before claiming the app/release is secure. bun audit currently reports advisories for Electron, extract-zip, http-cache-semantics and sprintf-js, including high severity. Electron is shipped despite being declared a devDependency. Package advisories do not establish that every listed issue is exploitable in this app.
- Update release tasks and architecture notes to match implemented behavior. The history checklist says private history was replaced with one public root commit; master now has 20 commits. Confirm the intended cleaned ancestry rather than relying on that checklist alone. This commit count is not a secret finding.

## Installer status

Scanner source lives in scanner/. scripts/scanner-release.mjs publishes self-contained win-x86 output into staging/scanner, which the Electron installer copies to resources/scanner. The build no longer requires the sibling workspace.

The CLI still targets net9.0-windows. The staged runtime does not supply the USB driver or Biokey ActiveX control. A compatible vendor installer, redistribution terms, elevation handling and clean-machine/hardware verification remain needed for the promised complete one-installer experience.

The package name is attendance-app; display name is Masjid Attendance; app identity is com.masjid.attendance. The legacy attendance-service profile path is intentional for existing data compatibility.

No dependencies, history, installer or credentials were changed. Nothing was pushed.
