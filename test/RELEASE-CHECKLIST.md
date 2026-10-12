# Release checks

Automated tests use a fake scanner and a local Sheets transport. They do not prove hardware or live Sheets behavior. Complete these checks against the exact candidate commit before release. Keep the evidence with the release review. Do not put real fingerprint templates or biometric captures in CI artifacts.

## Scanner hardware

- [ ] Record candidate commit SHA and SHA-256 of `staging/scanner/zk4500.exe`.
- [ ] With the ZK4500 attached, capture the same finger six times. Record each score and confirm all six match the same Marif id without opening enrollment.
- [ ] Capture a different enrolled finger and an idle timeout. Confirm neither marks the wrong student.
- [ ] Unplug and reconnect the scanner. Confirm capture recovers without killing its owning process.
- [ ] Hold a finger down through the capture deadline. Confirm the extended capture finishes and the next capture can open the sensor.
- [ ] Confirm scanner `info` reports `init=0`, vendor `ZKSoftware Inc.`, product `ZK4500 Fingerprint Reader`, and size `276×360`.

Evidence: candidate SHA `________`; scanner SHA-256 `________`; device/driver `________`; operator and date `________`; results or log path `________`.

## Google Sheets

- [ ] Use disposable copies of the Info and Pages spreadsheets shared with the service account.
- [ ] Mark one known id. Read back the `حاضر` cell and its BOOLEAN checkbox rule, including `showCustomUi`.
- [ ] Read back the row-2 count and confirm only the intended student increased it.
- [ ] Undo the mark. Confirm the cell value is empty, the checkbox rule remains, and the time-log row for today's id is removed.
- [ ] Confirm an unknown id and a duplicate id write no attendance cell.

Evidence: candidate SHA `________`; disposable spreadsheet ids `________`; operator and date `________`; readback or screenshot paths `________`.

## Windows install

- [ ] Install the candidate over the existing app. Confirm the profile remains `%APPDATA%\attendance-service` and existing settings load.
- [ ] Import the service-account JSON through Settings. Confirm it stays connected after restart and deleting the source copy; confirm no private key appears in the UI or logs.
- [ ] Confirm the taskbar, window, Start shortcut, and installed executable show the fingertip icon.
- [ ] Record the installer SHA-256 and verify the installer was built from the version commit at the candidate's full HEAD.

Evidence: candidate SHA `________`; version commit SHA `________`; installer SHA-256 `________`; Windows version `________`; operator and date `________`; results `________`.

Passing these checks records evidence for this candidate. It does not guarantee zero regressions.

## Receipt format

Store receipts and evidence outside the repository. Record all four checks: `hardware`, `sheets`, `upgrade`, and `package`. Each must use this shape with the candidate SHA, version, installer hash, and a non-empty evidence file relative to the receipts directory. Set `status` to `pass` only after performing the check.

```json
{
  "sourceCommit": "FULL_CANDIDATE_SHA",
  "version": "CANDIDATE_VERSION",
  "installer": { "path": "installer.exe", "sha256": "INSTALLER_SHA256" },
  "scannerManifest": { "path": "manifest.json" },
  "scannerDirectory": "scanner",
  "checks": {
    "hardware": {
      "status": "pending",
      "sourceCommit": "FULL_CANDIDATE_SHA",
      "version": "CANDIDATE_VERSION",
      "installerSha256": "INSTALLER_SHA256",
      "evidence": { "path": "evidence/hardware.txt", "sha256": "EVIDENCE_SHA256" }
    }
  }
}
```

Add the other three check objects with their own evidence. Use the manifest produced by `scripts/scanner-release.mjs` and the scanner files copied into the candidate package. The package evidence must include archive inspection, private-file exclusion, scanner hashes, and icon inspection. Hash files with `Get-FileHash -Algorithm SHA256`.

Run `bun run verify:release <receipts.json>` from a clean tree at the version commit. The verifier rejects missing evidence, mismatched hashes, old source/version receipts, unsafe scanner paths, and incorrect publish settings. It does not run hardware or Google checks on your behalf.
