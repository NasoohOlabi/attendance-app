# Masjid Attendance

Windows attendance app for a mosque roster in Google Sheets. A ZK4500 fingerprint scan identifies a student by their Marif ID and marks today's checkbox with `حاضر`. The app supports Arabic, enrollment, attendance undo, time corrections, and a persistent queue for network outages.

## Set up development

Use Windows, Node.js 22.12 or later, Bun 1.4, and the .NET 9 SDK for the scanner project. Install the compatible ZK4500 USB driver and registered x86 Biokey ActiveX SDK from an authorized supplier. The app uses ZKFPEngX; a libzkfp-only SDK is not a replacement.

1. Supply `scanner/Interop.ZKFPEngXControl.dll` and `scanner/AxInterop.ZKFPEngXControl.dll` from your authorized SDK/tooling. These interop wrappers are ignored by Git. The registered Biokey OCX and driver are also required on the scanning computer.
2. Install dependencies and publish the local scanner:

   ```powershell
   bun install --frozen-lockfile
   node scripts/scanner-release.mjs
   Copy-Item attendance.config.example.json attendance.config.json
   ```

3. Edit `attendance.config.json`. Set `serviceAccountJson` to your local Google service-account key file. Set the roster `spreadsheetId`/`sheetGid`, the log `logSpreadsheetId`/`logSheetGid`, and `fingerprintSheetGid`. Set `zk4500Cli` to `staging/scanner/zk4500.exe`.
4. Enable the Google Sheets API for your Google project and share both spreadsheets as Editor with the email in your service-account key.
5. Run `bun start`.

Never commit credentials, real roster data, fingerprint templates, or your local configuration. The example contains no operational identifiers.

## Configure the sheets

The roster's `Info` tab needs `إسم كامل` for the name and `معرف` for the unique Marif ID. Row 1 contains headers, row 2 contains counts, and students start at row 3. Date columns use checkbox rules whose checked value is `حاضر`; unchecked cells are empty. Unknown or duplicate IDs are not marked.

The time-log tab uses `الطالب` for the ID and `حضور` for the Damascus timestamp. An optional `إسم` column stores the name. The fingerprint tab uses `student_id`, `fingerprint`, and `created_at`. Fingerprints are sensitive biometric data; restrict access to that spreadsheet and local backups.

The sheet GID is the numeric `gid` in a tab's URL. The spreadsheet ID is the identifier between `/d/` and `/edit`.

## Run the installed app

Open Settings to choose your private key file and roster settings. Advanced log/fingerprint settings can be supplied in `%APPDATA%\attendance-service\attendance.config.json`. That legacy profile name is retained so upgrades keep existing settings and renderer preferences. The display name remains Masjid Attendance.

Templates live under `~/Masjid/v1/fingerprints/templates/`; logs under `~/Masjid/logs/`; queued attendance under `~/Masjid/attendance-outbox.json`. Settings → Delete all fingerprints clears local prints and fingerprint sheet rows. It leaves the attendance sheet unchanged.

## Verify and build

```powershell
bun run test
bun run build
bun audit
```

`bun run dist` publishes a self-contained x86 scanner and builds a Windows installer. The installed scanner does not need a separate .NET installation. The installer still requires the ZK4500 driver and Biokey ActiveX SDK to have been installed separately. It is not yet a complete driver-installing setup.

For a distributable version, first commit the code, then run `bun run release`. This bumps the app version, commits it, and builds from that commit. Keep installer artifacts private until you have verified redistribution rights for every supplied SDK/interop component. Update the scanner to a supported framework before its current runtime reaches end of support.

Only one app and one scanner process may own the device. Close capture normally before scanner diagnostics or prerequisite changes. Force-killing `zk4500.exe` can lock the USB driver. See [AGENTS.md](AGENTS.md) and [scanner/AGENTS.md](scanner/AGENTS.md) for the capture contract.

## Prepare a public source copy

Install `git-filter-repo` with `python -m pip install --user git-filter-repo==2.47.0`, then run:

```powershell
.\scripts\prepare-publication.ps1 -Destination 'D:\publication\attendance-app'
```

The script creates a separate, branch-only clone and removes the unverified interop DLLs throughout its history. It excludes internal checkpoint refs and checks for common secret signatures. The destination must not already exist. It does not rewrite this working repository or push anything. Publish that verified copy using ordinary branch pushes, not a mirror push. A pattern scan cannot guarantee that every possible secret is absent.

## License

The app's own source is under the [MIT license](LICENSE). Font licenses are in `src/renderer/fonts/OFL-*.txt`. Third-party dependencies, SDK components, and locally supplied scanner wrappers retain their own terms. MIT does not grant permission to redistribute vendor software.

## Previous installer security issue

A packaging check found a service-account key in the previous local release app. The old installer and unpacked app were moved to `release/quarantine/`. Do not distribute those artifacts. New packaging uses an allowlist and an `afterPack` check that rejects unexpected root files and credential-shaped JSON.

If an old installer was shared, or sharing is uncertain, create a replacement key in Google Cloud, update the private local key configuration, verify access, and revoke the old key. Removing the key from a new build does not invalidate old copies. See [Google's service-account key guidance](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
