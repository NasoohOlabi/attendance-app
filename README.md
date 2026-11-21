# Masjid Attendance

Windows attendance app for the Bouty mosque roster. A ZK4500 scan identifies a student by their Bouty ID and queues attendance for Bouty. The app can back up saved fingerprint templates to Google Sheets.

## Set up development

Use Windows, Node.js 22.12 or later, Bun 1.4, and the .NET 9 SDK for the scanner project. Install the compatible ZK4500 USB driver and registered x86 Biokey ActiveX SDK from an authorized supplier. The app uses ZKFPEngX; a libzkfp-only SDK is not a replacement.

1. Supply `scanner/Interop.ZKFPEngXControl.dll` and `scanner/AxInterop.ZKFPEngXControl.dll` from your authorized SDK/tooling. These interop wrappers are ignored by Git. The registered Biokey OCX and driver are also required on the scanning computer.
2. Install dependencies and publish the local scanner:

   ```powershell
   bun install --frozen-lockfile
   node scripts/scanner-release.mjs
   Copy-Item attendance.config.example.json attendance.config.json
   ```

3. Set `zk4500Cli` to `staging/scanner/zk4500.exe` in `attendance.config.json`.
4. Run `bun start` and sign in to Bouty in Settings.

Never commit credentials, real roster data, fingerprint templates, or local configuration.

## Use the app

Sign in once in **Settings**. The app verifies the account on Bouty and saves the credentials with Windows encryption. It reuses one session for roster lookups and writes, and reconnects with the saved account after restarting or when the website session expires. Use **Sign out** to clear the saved account and cookies. Pending attendance is kept for the original account and resumes after signing back in.

On **Attendance**, use **Search students** to find students by name or number. Page through the roster or select **Refresh** to reload it. Select a student to view their profile or mark them present. Fingerprint enrollment and automatic attendance use the Bouty student ID. When the complete roster is available, the app uses the Marif source ID in the student's Bouty notes to migrate unambiguous legacy links. The existing template files stay where they are. The active course needs an existing attendance day with group sessions.

After the first successful roster download, the app keeps an encrypted copy for offline student search, fingerprint enrollment, and manual attendance. Attendance waits in the queue until Bouty is reachable. **Refresh** replaces the saved list after a complete download, and signing out clears it.

Today and the dashboard reflect attendance recorded by this installation. The arrival clock shows the local scan time. Manage corrections and view attendance from other devices on Bouty.

To practice, sign in and turn on **Test mode** in **Settings**. Scan a finger, link it to a roster student, or mark and undo attendance manually. Today, Dashboard, and Fingerprints show your practice changes. Bouty and the Google Sheets backup receive no practice writes. Turning the switch off or closing the app discards the session and restores the live view.

The advanced settings allow explicit IDs when automatic lookup is unavailable:

```json
{
  "mapping": [{ "studentId": "bouty:42", "enrollmentId": 123 }],
  "days": { "2026-10-31": 456 },
  "presentStatusId": 1,
  "absentStatusId": 2
}
```

Use the IDs shown on Bouty. Keep earlier dates in the mapping until their queued scans have synced. Adding a group session on Bouty can mark the entire group present, so review the defaults before creating one. **Undo** sends an Absent status for the selected student.

Local templates live in `~/Masjid/v1/fingerprints/templates/`. Delete individual templates from **Fingerprints**, or clear them all in **Settings**. Those actions remove local copies. Existing Sheets backup rows are retained. Bouty credentials and the attendance queue live in `~/Masjid/v1/config/`.

### Fingerprint backup

Set `logSpreadsheetId` and `fingerprintSheetGid` in the local `attendance.config.json` to use the existing fingerprint tab. Installed builds read that file from `%APPDATA%\attendance-service`. Give the backup service account edit access to the sheet. The app reuses the imported Windows-encrypted account if present, or reads the key from the private `serviceAccountJson` path. A new backup tab can start empty. The app adds the `student_id`, `fingerprint`, and `created_at` headers.

The backup copies linked local samples on startup and after enrollment or migration. The app retries after a network failure and preserves previous rows. New rows use the Bouty ID when the fingerprint is linked to one. Restrict access to the backup sheet because it contains fingerprint templates. Attendance and roster lookup use Bouty.

## Verify and build

```powershell
bun run test
bun run build
bun audit
```

`bun run dist` publishes a self-contained x86 scanner and builds a Windows installer. The installed scanner does not need a separate .NET installation. The installer still requires the ZK4500 driver and Biokey ActiveX SDK to have been installed separately. It is not yet a complete driver-installing setup.

For a distributable version, first commit the code, then run `bun run release`. This bumps the app version, commits it, and builds from that commit. Keep installer artifacts private until you have verified redistribution rights for every supplied SDK/interop component. Update the scanner to a supported framework before its current runtime reaches end of support.

## Publish releases and update the installed app

`bun run release` creates the version commit and an annotated `v<version>` tag. Push that explicit tag from the filtered public clone to start `.github/workflows/release.yml`. The workflow builds the Windows installer and publishes the installer, `latest.yml`, and blockmap to the GitHub Release. GitHub Actions uses the repository URL from its checkout, so the package does not contain a guessed owner name.

Protect `v*` tags and require reviewer approval for a `release` environment. That environment needs `ZK4500_INTEROP_BUNDLE_B64`, `WINDOWS_CODE_SIGNING_CERTIFICATE`, and `WINDOWS_CODE_SIGNING_PASSWORD` secrets. The first is a base64 ZIP with the two licensed scanner wrappers (`AxInterop.ZKFPEngXControl.dll` and `Interop.ZKFPEngXControl.dll`); the certificate secret is the Authenticode certificate accepted by electron-builder. Keep those vendor files and signing material out of Git. The workflow uses the built-in `GITHUB_TOKEN` to publish the release.

Installed builds show **Check for updates** in the window header. A click checks GitHub; when a release is available, the button becomes **Download update**, then **Restart to update** after the signed installer is downloaded. Restarting installs the update and keeps the existing app identity, `%APPDATA%\attendance-service` profile, and fingerprint folder. Development builds hide the control.

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
