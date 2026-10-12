# Regression tests

Run on Windows with Node 22.12 or newer, Bun 1.4, and .NET SDK 9. Install the locked dependencies with `bun install --frozen-lockfile`. If Electron was not downloaded, run `node node_modules/electron/install.js`.

```powershell
bun run test
bun run test:e2e
```

The first command runs core and integration tests. The second builds the app, publishes a dependency-free fake scanner, and runs 50 cases through the real Electron main process, preload, and renderer. Run one Electron suite at a time. The physical reader and its SDK are not needed.

Each case uses its own temporary profile, config, prints, outbox, and logs. Google requests go to a stateful loopback fixture. The test entry rejects unsafe paths and blocks external renderer requests. Account-import cases use generated disposable keys and actual Windows encryption. No production config, student records, fingerprints, or service-account key is needed.

The full suite requires every title in `e2e/coverage.json` to execute. The inventory counts titles, including duplicates; file moves do not change behavior coverage. Skips, retries, unexpected runtime errors, and missing cases fail the run. Keep the inventory synchronized when adding or renaming a case; do not delete a case to hide a failure.

Filtered runs are useful for diagnosis but do not satisfy the full inventory gate:

```powershell
bun run test:e2e --grep "pending"
```

Inspect `playwright-report/index.html` and `test-results/`. Each case saves a screenshot, trace, request history, final fixture grids, scanner receipts, disk snapshots, source SHA, and runtime versions. Temporary roots are retained for diagnosis; their paths appear in the receipts. These artifacts contain synthetic data.

Windows CI runs both commands and uploads the reports. The workflow has been added locally; a remote CI run and required branch protection need repository publication and configuration.

The fixture does not prove the SDK, Google validation semantics, native dialogs, or an installed upgrade. Complete [the release checklist](RELEASE-CHECKLIST.md) for the exact installer. `bun run verify:release <receipts.json>` checks the evidence files, source/version, installer hash, and packaged scanner manifest. It validates recorded evidence; the operator must perform the checks. A development commit is intentionally rejected because HEAD must be the release version commit.
