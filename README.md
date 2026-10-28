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

3. Edit `attendance.config.json`. Set the roster `spreadsheetId`/`sheetGid`, the log `logSpreadsheetId`/`logSheetGid`, and `fingerprintSheetGid`. Set `zk4500Cli` to `staging/scanner/zk4500.exe`. Leave `serviceAccountJson` empty for secure import.
4. Enable the Google Sheets API for your Google project and share both spreadsheets as Editor with the email in your service-account key.
5. Run `bun start`.
6. Open Settings → Service account → Import JSON and choose your Google service-account file.

Never commit credentials, real roster data, fingerprint templates, or your local configuration. The example contains no operational identifiers.

## Configure the sheets

The roster's `Info` tab needs `إسم كامل` for the name and `معرف` for the unique Marif ID. Row 1 contains headers, row 2 contains counts, and students start at row 3. Date columns use checkbox rules whose checked value is `حاضر`; unchecked cells are empty. Unknown or duplicate IDs are not marked.

The time-log tab uses `الطالب` for the ID and `حضور` for the Damascus timestamp. An optional `إسم` column stores the name. The fingerprint tab uses `student_id`, `fingerprint`, and `created_at`. Fingerprints are sensitive biometric data; restrict access to that spreadsheet and local backups.

The sheet GID is the numeric `gid` in a tab's URL. The spreadsheet ID is the identifier between `/d/` and `/edit`.

## Run the installed app

### Bouty attendance

In Settings → Bouty, enter the Bouty username and password and save. They are encrypted for the current Windows account. Configure the JSON with existing attendance-day IDs by date and an explicit mapping from each roster Marif ID to the corresponding Bouty enrolment ID:

```json
{
  "mapping": [{ "studentId": "00 00 000 001", "enrollmentId": 123 }],
  "days": { "2026-10-31": 456 },
  "presentStatusId": 1,
  "absentStatusId": 2
}
```

These numbers are examples, not actual IDs. Create the day and its group sessions on Bouty first, and use the ID in the attendance day URL. Verify enrolment and status IDs for the actual course before mapping. Keep earlier date entries until their queued scans have synced. The app does not create attendance days or groups; adding a group on Bouty can mark all its students present, so review its defaults. A missing mapping, missing day, login failure, or network failure leaves scans in the separate Bouty queue and shows a status message. Removing a student from today's list queues the configured Absent status. Fingerprints are not sent to Bouty. The request includes the scan timestamp as `changed_at`, but Bouty entry-time persistence has not been verified.

Open Settings → Service account → Import JSON to import or replace your Google account. Set the roster fields on the General page. Advanced log/fingerprint settings can be supplied in `%APPDATA%\attendance-service\attendance.config.json`. That legacy profile name is retained so upgrades keep existing settings and renderer preferences. The display name remains Masjid Attendance.

The imported account is encrypted under `~/Masjid/v1/config/service-account.enc`, beside the fingerprint store. Electron's asynchronous safeStorage API uses Windows DPAPI to protect the encryption key for your Windows account. There is no separate plaintext encryption-key file. The decrypted key stays in the main process and is not sent to the page or written to a temporary plaintext file. The original downloaded JSON is left untouched.

This protects stored data from other Windows users; it does not protect against malware running as you. Moving the encrypted file to another Windows account can make it unreadable; import the original account there instead. If secure Windows storage is unavailable, importing fails rather than saving plaintext. Existing external key paths keep working until you import an encrypted copy.

See [Electron safeStorage security semantics](https://www.electronjs.org/docs/latest/api/safe-storage). If an old installer exposed your key, revoke/replace it first; encrypting an exposed key does not invalidate its old copies.

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
