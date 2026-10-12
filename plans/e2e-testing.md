# Set up complete attendance regression testing

Protect the mosque operator's attendance, saved fingerprints, and settings with tests that run the built Electron app.
Keep the existing core tests. Add one Windows E2E suite, a scripted scanner process, and a stateful Sheets test client.
Deliver five small changes in order, E2E-1 through E2E-5. These are planning ids, not opened PRs.
Block releases on known regressions, failed checks, and missing hardware evidence. No test suite can guarantee that every future defect is impossible.
This document is a plan only. No application changes, real sheet writes, scanner captures, or release builds are authorized by this plan.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists. Keep logs, screenshots, traces, request receipts, and the tested SHA together.

Execute under `C:/Users/OMEN/.codex/skills/poteto-mode/playbooks/autopilot-stack.md` after a separate implementation request. The operator lands the changes. Do not push or open PRs until the operator requests that work. Local atomic commits are sufficient until then.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Use the feature inventory in Appendix D as the coverage checklist. A green screenshot alone does not prove a write. Pair each user action with the resulting sheet state, disk state, and request history. All new commands and test paths below are proposed, not currently available.

## Program checklist

### Arm the program

- [ ] Record the implementation request, base SHA, and this plan in the run report before starting implementation.
- [ ] Re-read `AGENTS.md`, `scanner/AGENTS.md`, and the current source. Record changes since the analyzed SHA in Appendix A.
- [ ] Resolve the actual trunk name. Use `git show origin/main:AGENTS.md` only when `origin/main` is that trunk. The installed skills live outside this repository. Read their actual paths, rather than assuming `pstack/skills/` exists in trunk.
- [ ] For an unattended run, arrange `/loop 1h` or the harness's available scheduler. If unavailable, audit after each completed unit. Each status message names new evidence or a blocker. Do not invent an armed scheduler.
- [ ] Stop all implementation writes on the operator's hold instruction.

### Spawn owners

- [ ] Assign one owner to each phase. Follow `E2E-1 -> E2E-2 -> E2E-3 -> E2E-4 -> E2E-5`. Base each change on the previous verified change.
- [ ] Record the throughput checkpoint. Blocking first steps are isolation and a successful built-app launch. Independent workstreams are read-only feature analysis and fixture authoring after contracts settle. Shared mutable state is the main process, queue, and Google client. Serialize changes to those files. The smallest safe decomposition is one implementation owner per phase because the app has one scanner loop.
- [ ] Keep fixture and test changes in `test/`. Limit production edits to the dependency boundaries needed for isolation. Fix a defect exposed by a test in a separate atomic commit with that failing case.
- [ ] Treat ten live lanes as ten verification scenarios, not ten simultaneous captures. Independent Windows VMs may run concurrently. Each machine runs one attendance process and one scanner owner.
- [ ] If a fix changes an interaction, require screenshots and a short video for operator review before merge. Test-only changes have no interaction review gate.

### PR mechanics

- [ ] Before committing, inspect the diff for prose noise and unrelated changes. Preserve work from other prompts. Do not add config, keys, real student records, or biometric captures.
- [ ] Run `bun run test` and `bun run build`. No lint or typecheck script exists in the analyzed `package.json`. Do not report nonexistent checks as passing.
- [ ] If PR publication is requested, use the available forge, target the previous phase for a stack, and register every PR with the thread's `link_pull_request` tool when available.
- [ ] Review comments against the failing scenario and evidence. Fix proven defects. Explain rejected findings without changing behavior just to satisfy a comment.

### Verdict and merge

- [ ] Verify the exact head SHA. Run all earlier phase checks after each later production edit. A changed head invalidates affected evidence.
- [ ] Have an independent reviewer inspect the diff, request receipts, file snapshots, and coverage matrix. A skipped, flaky, or blocked critical scenario is not a pass.
- [ ] Stop at a verified local commit or a reviewable stack. The operator controls publication and merge. Recheck CI and relevant evidence after rebasing.

### Boot recipe

- [ ] Run on Windows with the pinned Bun, Node, Electron, and Playwright versions. Install with `bun install --frozen-lockfile`. Build with `bun run build` before launching `out/main/index.js` through Electron automation.
- [ ] Allocate a fresh absolute temporary root per test. Put the config, Electron profile, prints, scan images, logs, scan-times file, outbox, and fake scanner state under it. Record resolved paths before the first write.
- [ ] Launch with an explicit sanitized environment. Set `ATTENDANCE_CONFIG`, `FINGERPRINT_DIR`, and `ZK4500_CLI` to test paths. Set child `TEMP` and `TMP` to a directory under that root. Supply the additional app-data and clock seams built in E2E-1. Remove inherited real sheet, key, scanner, and renderer URL overrides.
- [ ] Connect the stateful Sheets test client before app startup. Reject unknown endpoints and spreadsheet ids. Fail any unexpected external network attempt. Do not replace `window.attendance`, IPC handlers, `planAttendance`, or the Google write helpers.
- [ ] Feed scanner events through a real child process. Drive user actions through the window's controls. Use main-process evaluation only for read-only inspection and native dialog interception.
- [ ] Wait for explicit window, scanner, disk, and request states. Do not use arbitrary sleeps for ordinary assertions. Use controlled delayed responses to prove pending operations remain responsive.
- [ ] Save each lane's screenshot under `test-results/<phase>/<lane>/`. Include the head SHA, fixture id, request history, scanner transcript, process ids, log, and relevant file snapshots. Use synthetic records only.
- [ ] Close the app gracefully. Wait for the child to exit before cleanup. Remove only the verified temporary root and this test's process tree. Never force-kill a real scanner or unrelated Electron process.

## Isolate and launch the real app, phase 1, E2E-1

**Depends on.** None.

**Files.**

- [ ] Edit `package.json`, `bun.lock`, `src/main/index.js`, `src/config.mjs`, and `src/log.mjs` only as needed for the test boundaries.
- [ ] Create `test/e2e/playwright.config.mjs`, `test/e2e/fixtures/app.mjs`, `test/e2e/fixtures/sheets.mjs`, `test/e2e/fixtures/scanner/`, and `test/e2e/smoke.spec.mjs`.
- [ ] Update `.gitignore` and builder exclusions so reports, fake executables, and fixture data cannot enter release artifacts.

**Build.**

- [ ] Pin a compatible `@playwright/test` version. First prove a Windows launch, renderer lookup, preload call, state event, and graceful close against Electron 38. Keep the experiment as the smoke test.
- [ ] Define one test-run fixture record containing its root, clock, sheet state, scanner script, request log, and owned process ids. Keep fixture state outside the renderer.
- [ ] Add a narrow main-process test bootstrap for paths, clock, and Google client creation. Preserve normal production defaults. Initialize paths before `startAppLog()` or any home/profile write. Refuse incomplete test configuration.
- [ ] Keep real `src/google.mjs` request construction. Substitute only the authenticated client's `request` transport. Model the app's actual metadata, values, append, updateCells, row deletion, and date-column operations. Fail unsupported calls.
- [ ] Build a small Windows fake scanner executable without the Biokey dependency. Match argv, cwd, streamed UTF-8 lines, JPG/template files, exit codes, and controlled delays. Keep its control channel private to the test root.
- [ ] Use one Playwright worker initially. Add `bun run test:e2e` for the built app. Keep `bun run test` for the existing Node suite.
- [ ] Explicitly start and stop tracing on the Electron browser context. Playwright's default page fixture configuration must not be assumed to capture a custom Electron context. Retain the first failure without requiring a retry.

**You see.**

- [ ] The real window loads with the real preload and main process. The report shows every writable path under the temporary root and zero real Sheets requests.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run test`. Add direct cases for path resolution and fail-closed fixture configuration. Verify the Sheets fixture rejects unsupported writes and the fake scanner emits a literal known transcript.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Launch a ready window on trunk and head in isolated Windows accounts. Save `01-ready.png`. Pass when the same ready controls render and the head uses its test root. If trunk cannot launch safely, record that gap and compare its source contract instead of claiming a runtime baseline.
- [ ] Lane 2. Launch with a populated sheet fixture. Save `02-preload.png`. Pass when the real preload delivers the roster and today's count.
- [ ] Lane 3. Launch with empty setup fields. Save `03-empty-setup.png`. Pass when Settings remains reachable and the test never requests real credentials.
- [ ] Lane 4. Launch with no fake scanner executable. Save `04-missing-scanner.png`. Pass when the missing-path detail appears without a capture child.
- [ ] Lane 5. Stream scanner ready and finger-down separately. Save `05-streamed-events.png`. Pass when the cue changes before child exit.
- [ ] Lane 6. Delay sheet reads. Save `06-loading.png`. Pass when the window renders before the delayed request completes.
- [ ] Lane 7. Verify all resolved data paths and temporary disk effects. Save `07-isolation.png`. Pass when every app write remains under the test root.
- [ ] Lane 8. Attempt an unsupported fixture request. Save `08-rejected-request.png`. Pass when the run fails explicitly rather than returning a generic success.
- [ ] Lane 9. Run two tests sequentially with different roots. Save `09-clean-second-run.png`. Pass when the second run inherits no data or language preference.
- [ ] Lane 10. Close while the fake capture is active. Save `10-close.png` before closing. Pass when the owned child exits, no process remains, and unrelated processes are untouched.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure process launch to the visible ready window and count owned processes.
- [ ] Probe. Run 20 interleaved trunk/head launches on the same isolated Windows VM with identical fixtures after the compatibility experiment succeeds.
- [ ] Baseline. Record trunk p95 first. If trunk lacks safe fixture injection, measure both with the same isolated account and canned dependency setup. Keep unmatched measurements separate.
- [ ] Rule. Proposed budget is p95 below 5 seconds and no regression greater than 20 percent plus 100 ms. Require one app and at most one capture child. Reassess the timing budget with recorded measurements before enforcing it.

**Review gate.** None. E2E-1 is not review-gated unless the required bootstrap changes a production interaction.

**Merge.**

- [ ] Record the exact SHA, successful compatibility probe, path audit, 48-test baseline comparison, and graceful cleanup receipt before accepting E2E-1.

## Protect attendance and the offline queue, phase 2, E2E-2

**Depends on.** E2E-1.

**Files.**

- [ ] Create `test/e2e/attendance.spec.mjs`, `test/e2e/outbox.spec.mjs`, and attendance fixtures under `test/e2e/fixtures/`.
- [ ] Extend `test/core.test.mjs` for queue transitions, log identity, time edits, and date boundaries missing from the baseline.

**Build.**

- [ ] Assert mark, undo, and clock edits through the UI. Compare literal grid values, checkbox validation, count, log rows, and persisted queue records.
- [ ] Seed Arabic names, two identical names with different ids, duplicate ids, missing ids, unknown matched ids, reordered rows, unordered dates, and headers beyond column Z. Use a complete roster cache so offline matching remains meaningful. Cover both AttendanceLog layouts, with and without the existing name column, and no configured log sheet.
- [ ] Freeze the app's business clock independently of its retry timers. Cover Damascus midnight, month and year changes, previous-day queued marks, and a Windows timezone different from Damascus.
- [ ] Control failures before a cell write, after the cell write, during log append, after server acceptance with a lost response, and during queue persistence. Restart between each partial stage.
- [ ] Interleave two students, an undo, a clock change, roster refresh, and a delayed in-flight write. Check the entire queue and sheet, not only the last person shown.
- [ ] Assert exact single-cell `updateCells` payloads for marks and undo. Preserve the `BOOLEAN` rule, checked value `حاضر`, `strict`, and `showCustomUi`. Reject attendance values writes, values clears, boolean marks, full-row updates, and unrelated formatting.
- [ ] Check missing-date insertion separately. Preserve existing data, copy only the required number format and validation, and update the row-2 formula for the new column.
- [ ] Treat unsafe crash recovery or duplicate log appends as defects, not expected golden output. Keep the failed scenario and fix separately. A fake client cannot prove Google's real checkbox behavior.

**You see.**

- [ ] A recognized student appears immediately. The queue survives restart, the scanner continues while writes wait, and recovery converges to the correct checkbox and time-log state.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run test`, `bun run test:e2e -- --grep attendance`, and `bun run test:e2e -- --grep outbox`. Assert concrete queue transitions and Damascus stamps against literal expected values.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Scan the same known id on trunk and head. Save `01-known-mark.png`. Pass when the picker stays closed, one student appears, and only the intended checkbox and log row change.
- [ ] Lane 2. Scan one id repeatedly, then a second id with the same name. Save `02-repeat-and-names.png`. Pass when the count is two and each id has one new attendance log entry.
- [ ] Lane 3. Match duplicate, missing, and unknown ids. Save `03-invalid-identities.png`. Pass when no invalid sheet write occurs and the operator receives an accurate result after sync.
- [ ] Lane 4. Use unordered dates and then a missing date. Save `04-date-column.png`. Pass when the correct day is selected or safely inserted and other cells remain unchanged.
- [ ] Lane 5. Block Google responses and scan two students. Save `05-offline.png`. Pass when both appear, the next capture starts, and both marks persist in the outbox before graceful restart.
- [ ] Lane 6. Undo a not-yet-sent mark, then undo a completed mark. Save `06-undo.png`. Pass when the first queues no write and the second clears its value, preserves validation, and deletes only that id's current-day log rows.
- [ ] Lane 7. Edit a queued clock twice, then an existing log clock. Save `07-clock.png`. Pass when the latest valid time wins, the Damascus date stays fixed, and invalid input leaves state unchanged.
- [ ] Lane 8. Restore network after a cell-success/log-failure restart. Save `08-partial-recovery.png`. Pass when the cell remains present and the pending log completes once without replaying unrelated work.
- [ ] Lane 9. Lose an append acknowledgement and interrupt disk persistence. Save `09-crash-recovery.png`. Pass when no acknowledged mark vanishes and recovery neither duplicates a log entry nor corrupts the outbox. Record a failure as a release blocker if this contract is not yet supported.
- [ ] Lane 10. Race undo, rescan, roster reordering, and midnight with delayed writes. Save `10-races.png`. Pass when the correct id and original queued day receive each operation and no neighboring queue item or student changes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure scanner-result receipt to visible attendance and disk persistence, plus next-capture start while Google is blocked.
- [ ] Probe. Run 20 interleaved trunk/head samples using the same two-student fixture and a 10-second blocked transport. Confirm actual queued files and spawned captures in every sample.
- [ ] Baseline. Record trunk p95 and the current retry pause first. Do not count Google's blocked response time as local UI latency.
- [ ] Rule. Proposed local-update budget is 1 second with no regression greater than 20 percent plus 100 ms. The next capture must begin independently of the blocked write after the configured retry pause, with 1 second of scheduling tolerance.

**Review gate.** None. E2E-2 is not review-gated. A separate behavior fix uses the interaction review gate from the program checklist.

**Merge.**

- [ ] Attach grid diffs, literal request payloads, queue files before and after restart, and all race results to the E2E-2 head receipt.

## Protect enrollment and scanner ownership, phase 3, E2E-3

**Depends on.** E2E-2.

**Files.**

- [ ] Create `test/e2e/enrollment.spec.mjs`, `test/e2e/scanner.spec.mjs`, and `test/e2e/fingerprint-sync.spec.mjs`.
- [ ] Extend the fake scanner scenarios and disk fixtures. Add protocol integration cases under `test/integration/` and expand the test script to run those files.

**Build.**

- [ ] Cover an unmatched scan, assignment, replacement of an existing single print, batch enrollment, adding scans, Done, Rescan, and confirmed Cancel. Assert exact primary and extra filenames, index, roster, pending file, and sheet rows.
- [ ] Cover empty rosters, unavailable sheets with cached students, stale search responses, and a refreshed roster during selection. Keep visible names during the throttled 10-second reread.
- [ ] Cover pending single-file and batch restart behavior separately. Batch scans are currently session-only. Decide no new persistence behavior in this test change. Report the pending-file restoration gap in Appendix C.
- [ ] Cover successful local saves with failed fingerprint appends. Verify local matching still works. Startup restores missing remote templates and never deletes local-only prints.
- [ ] Cover Delete all fingerprints through its confirmation. Clear the remote data first, preserve its header, then clear local prints, pending, index, roster, and gallery state. Leave attendance and its outbox unchanged.
- [ ] Cover deletion and configuration restart while a fake capture is in flight. Assert old-generation or old-epoch results cannot recreate deleted or reassigned prints.
- [ ] Feed fragmented UTF-8 output, a final line without a newline, repeated keys, stderr errors, unreadable templates, threshold scores 7 and 8, Arabic legacy template names, extra sample stems, success with exit 1, timeout, and init failure.
- [ ] Exercise the actual child-process watchdog with a fake process only. Verify no kill before `2 * timeout + grace`, the retry pause, and absence of overlapping scanner owners. Keep one real-duration watchdog case alongside faster protocol tests.

**You see.**

- [ ] An unmatched finger opens the picker. Saved prints match the chosen id on the next scan. Cancel and failed deletion preserve the right files, and stale captures cannot restore cleared data.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run test` and `bun run test:e2e -- --grep "enrollment|scanner|fingerprint"`. Add subprocess-level assertions for streamed output, exit/file reconciliation, and watchdog behavior.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Capture an unknown print and assign the same roster id on trunk and head. Save `01-single-enroll.png`. Pass when one local primary print and one fingerprint row exist and the next match stays off the picker.
- [ ] Lane 2. Replace an existing primary print with extra samples. Save `02-replace.png`. Pass when the single-save replacement removes obsolete extras and the saved file matches the chosen id.
- [ ] Lane 3. Keep three batch scans, use Done, and assign them. Save `03-batch.png`. Pass when the primary and numbered extras retain their bytes and three fingerprint rows carry the same id.
- [ ] Lane 4. Rescan the latest batch item, cancel confirmation, then confirm Cancel. Save `04-cancel-rescan.png`. Pass when only the requested pending scans disappear and unrelated enrolled prints stay.
- [ ] Lane 5. Fail the fingerprint append after saving locally. Save `05-append-failure.png`. Pass when the warning appears and a subsequent local match still finds the student.
- [ ] Lane 6. Start with remote-only and local-only prints. Save `06-restore.png`. Pass when startup copies missing templates, preserves local-only files, and links the restored id.
- [ ] Lane 7. Fail Delete all remotely, then allow it. Save `07-clear.png`. Pass when failure preserves every local file and success removes only fingerprint data while preserving the remote header and attendance.
- [ ] Lane 8. Finish an old fake capture after settings save or fingerprint deletion. Save `08-stale-capture.png`. Pass when no stale print, gallery item, or attendance mark reappears and one owner remains.
- [ ] Lane 9. Stream fragmented Arabic output, exit-1 success, weak scores, and timeouts. Save `09-protocol.png`. Pass when real file results and score thresholds lead to the right picker or matched state.
- [ ] Lane 10. Refresh search while a response is delayed, then restart single pending and batch sessions. Save `10-search-restart.png`. Pass when older responses cannot replace newer search results, throttling holds, and restart behavior matches the recorded contract or produces an explicit gap.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure streamed finger-down to Hold still, assignment to local-file completion, and maximum simultaneous capture owners.
- [ ] Probe. Run 20 interleaved trunk/head trials with three synthetic scans and delayed fingerprint appends. Collect child pid lifetimes and file hashes.
- [ ] Baseline. Record trunk p95 for both local timings and its maximum owner count first.
- [ ] Rule. Proposed cue budget is 500 ms and local save budget is 1 second, with no regression greater than 20 percent plus 100 ms. Owner count must never exceed one. Remote latency must not enter local-save measurements.

**Review gate.** None. E2E-3 is not review-gated. Any changed persistence or enrollment interaction requires its own reviewed fix.

**Merge.**

- [ ] Attach file hashes, scanner transcripts, pid timelines, deletion ordering receipts, and separate pending/batch restart outcomes to the verified E2E-3 SHA.

## Protect settings, layout, and operator feedback, phase 4, E2E-4

**Depends on.** E2E-3.

**Files.**

- [ ] Create `test/e2e/settings.spec.mjs`, `test/e2e/window.spec.mjs`, `test/e2e/errors.spec.mjs`, and synthetic visual baselines under `test/e2e/snapshots/`.
- [ ] Add a renderer-only responsive fixture under `test/e2e/fixtures/` for widths below the native window minimum. Label those checks separately from full Electron E2E.

**Build.**

- [ ] Cover settings open, cancel, save, path browsing and browse cancellation, invalid gid, malformed config, missing or invalid key file, and rejection of pasted key contents. Preserve unedited log/fingerprint configuration fields.
- [ ] Intercept native file dialogs in the Electron main process for deterministic tests. Add one native browse receipt in the packaged release checklist because DOM automation cannot operate that OS dialog.
- [ ] Cover English and Arabic, all four font choices, invalid saved preferences, and persistence after restart. Confirm names, ids, timestamps, paths, and phone numbers retain their intended direction.
- [ ] Use known geometry assertions for the 1120 by 800 window and minimum 900 by 680 window. Populate long today lists, long picker lists, Settings, and a large match profile. Scroll the last entry into view and verify the footer remains visible.
- [ ] Verify `#last` above the scan log. Show name, id, and time once. Hide date columns and empty cells. Show literal TRUE/FALSE profile fields as translated Yes/No, with chips, phone rows, and long text rows.
- [ ] Verify the cue sequence before scanner readiness, after readiness, finger-down, retry, and outage. Under reduced motion, assert the parked pose and no looping animation.
- [ ] Cover confirm accept, Cancel, Escape, and backdrop cancellation for Undo and deleting scans or fingerprints. Confirm canceled actions cause no disk or sheet change. Exercise search Enter selection, initial confirmation focus, and keyboard access to each action.
- [ ] Load the allowed single and gallery slots through the real `print://` protocol. Assert an unknown slot or arbitrary filename returns 404 without exposing unrelated local bytes.
- [ ] Assert operator-visible offline, protected-cell, missing-sheet, permission, and partial-log outcomes. Unexpected page errors, rejected IPC calls, render-process exits, and uncaught exceptions fail the run. Expected induced errors must have exact diagnostic receipts.
- [ ] Compare selected visual states on one pinned Windows image after fonts load. Keep behavioral assertions primary. Require human review of baseline changes.

**You see.**

- [ ] The operator can reach every control and last list entry. Arabic settings survive restart. Errors state what was saved and what remains pending.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run test` and `bun run test:e2e -- --grep "settings|window|errors"`. Assert profile text, translation output, and each cue state against literal expected values.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Show the same populated ready screen on trunk and head. Save `01-ready-layout.png`. Pass when three columns, the match profile, today's count, and footer fit at 1120 by 800.
- [ ] Lane 2. Fill today's list with 100 synthetic names at minimum window size. Save `02-today-scroll.png`. Pass when the last name and its Undo control can be reached while the footer stays visible and the body does not scroll.
- [ ] Lane 3. Fill a long picker and Settings. Save `03-inner-scroll.png`. Pass when each intended container scrolls and search, Browse, and Save remain usable.
- [ ] Lane 4. Switch to Arabic and each font, then restart. Save `04-arabic-font.png`. Pass when language and font persist, names display intact, and numeric fields stay readable.
- [ ] Lane 5. Show mixed profile values, phones, long text, blank cells, and dates. Save `05-profile.png`. Pass when the correct id's nonempty nondates appear in the intended groups without duplicate identity or boolean literals.
- [ ] Lane 6. Stream all cue states with reduced motion on and off. Save `06-cue.png`. Pass when Place your finger appears only after ready, Hold still follows finger-down, and reduced motion has no loop.
- [ ] Lane 7. Cancel Undo and Delete through Escape, backdrop, and Cancel, then accept one Undo. Save `07-confirm.png`. Pass when cancellations change nothing and acceptance affects only the chosen student.
- [ ] Lane 8. Save valid settings, reject invalid gid and pasted key contents, and cancel Browse. Save `08-settings.png`. Pass when valid values persist, invalid values do not, and cancel restores the previous screen.
- [ ] Lane 9. Inject protected-cell, permission, and nonretryable log failures. Save `09-errors.png`. Pass when the preserved data and pending work match the visible message and diagnostics. The missing-log warning must not be silently lost.
- [ ] Lane 10. Render the 760px breakpoint in the isolated responsive fixture. Save `10-responsive.png`. Pass when the log moves below the cue without clipped controls. Record that this renderer check does not prove native-window behavior.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure Settings open, cached name search, and language switch to settled DOM with a 1000-student synthetic roster.
- [ ] Probe. Run 20 interleaved trunk/head samples on the same VM. Wait for fonts once and exclude font download or first build from interaction timing.
- [ ] Baseline. Record trunk p95 per action and roster request counts first.
- [ ] Rule. Proposed p95 budget is 500 ms per local action, with no regression greater than 20 percent plus 100 ms. Search-triggered catalog reads must occur at most once per 10 seconds, excluding independently scheduled sync reads.

**Review gate.** None. E2E-4 is not review-gated unless a production UI fix is included. Review every new or changed screenshot baseline before accepting it.

**Merge.**

- [ ] Attach the English and Arabic screenshots, geometry assertions, responsive-test label, settings disk diff, and exact error receipts to the E2E-4 SHA.

## Gate CI and verify the shipped installer, phase 5, E2E-5

**Depends on.** E2E-4.

**Files.**

- [ ] Create `.github/workflows/test.yml` if GitHub is the chosen CI, `test/e2e/release.spec.mjs`, `scripts/verify-release.mjs`, and `test/RELEASE-CHECKLIST.md`.
- [ ] Edit `package.json` and builder exclusions for the test commands and artifact rules. Change `scripts/release.mjs` only to add required prebuild checks and build identity receipts.

**Build.**

- [ ] Gate every PR on frozen dependency install, `bun run test`, `bun run build`, and the complete serial Windows fake-boundary E2E suite. Set `forbidOnly`, zero automatic retries, and an explicit expected test inventory. Fail skipped critical cases and missing files.
- [ ] Upload first-failure traces, screenshots, app logs, request receipts, and process diagnostics even after a failed check. Attach SHA, tool versions, and the fixture seed. Never upload real key material or fingerprint templates.
- [ ] Add a fault probe that deliberately removes checkbox validation, changes a threshold result, suppresses queue persistence, or opens the picker for a match. Confirm each corresponding test fails. Run these probes in disposable checkouts, not the release branch.
- [ ] Establish confidence with 20 consecutive complete fake-boundary runs and a seeded 100-operation mark/undo/time/enrollment sequence. Assert all ids, final grid, queue, templates, and process count after completion and restart. Do not hide flakes with retries or exclusions.
- [ ] Run a restricted real-Sheets smoke job only on dedicated disposable test spreadsheets with synthetic students. Require an explicit allowlist of ids, never production config. Read back value, validation, formula count, log identity, timestamps, and preserved neighboring cells after mark and undo.
- [ ] Gate releases on a Windows desktop station with the SDK installed and one real ZK4500. Run the actual packaged executable in the logged-in session, not Session 0. Keep this lane separate from hosted CI and run it serially. Keep physical templates and captures private to the station. Crop fingerprint images out of review screenshots.
- [ ] Build the installer from its version commit after all source changes. Record that SHA, app version, installer SHA-256, scanner sourceCommit, and each staged scanner hash. Reject a dirty tree, stale scanner copy, or installer built from code newer than its version commit. Test release-script sequencing in a temporary repository.
- [ ] Inspect the unpacked app and `app.asar`. Reject secrets, test fixtures, private captures, source scanner binaries, and test bootstrap modules. Verify required scanner runtime files, fonts, licenses, and icons are present.
- [ ] Exercise fresh install and upgrade on a disposable Windows account. Preserve the `attendance-service` profile, NSIS id, config, local prints, language, and pending outbox. Verify packaged scanner fallback and native Browse selection/cancellation.
- [ ] Require all automated checks and current hardware/package receipts before publication. A hardware gap blocks release even when simulated E2E is green. No publishing or installation on the operator's account occurs as part of this planning task.

**You see.**

- [ ] A failed known regression blocks CI. A release report identifies the exact tested installer and proves the physical scanner and real Sheets behavior separately.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run all test commands, `bun run test:e2e:release`, and the proposed release verifier against an unpacked build. Prove a deliberately failing run remains red and still uploads diagnostics.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Install the previous accepted installer and candidate in separate disposable accounts. Save `01-upgrade.png`. Pass when the same saved student matches, settings persist, and the candidate has the expected profile and version.
- [ ] Lane 2. Run a clean Windows CI checkout without scanner SDK or credentials. Save `02-ci-smoke.png`. Pass when the full fake-boundary suite succeeds without external network or real scanner access.
- [ ] Lane 3. Deliberately fail a representative E2E case. Save `03-failure-report.png`. Pass when CI stays red, the trace opens, and screenshot, log, SHA, and request receipts exist.
- [ ] Lane 4. Run fault probes and the repeated seeded sequence. Save `04-regression-probes.png`. Pass when every injected defect is caught and accepted runs have no leaks, queue loss, or flakes.
- [ ] Lane 5. Mark, change time, and undo on the dedicated real test sheet. Save `05-real-sheet.png`. Pass when readback confirms the literal mark, checked and unchecked validation, count, and only the matching log mutations.
- [ ] Lane 6. Enroll one physical finger and scan it six times with the packaged app. Save `06-real-repeat.png`. Pass when every subsequent scan identifies the same id, the picker stays closed, and no duplicate attendance mark or log appears.
- [ ] Lane 7. Scan a different finger, wait through idle timeout, then reconnect an unplugged scanner. Save `07-device-recovery.png`. Pass when unknown capture, idle retry, and recovery work with one owner and no visible SDK window.
- [ ] Lane 8. Keep a physical finger down near the initial timeout, then close and relaunch after capture exit. Save `08-deadline-close.png`. Pass when the extension completes without premature forced termination and the next open has `init=0`.
- [ ] Lane 9. Inspect installed assets, window, Start shortcut, taskbar icon, and native Browse. Launch a second instance. Save `09-packaged-ui.png`. Pass when the fingertip icon and fonts load, dialogs work, the existing window receives focus without another scanner owner, and no build-machine paths or private assets ship.
- [ ] Lane 10. Verify version commit and staged/packaged scanner hashes, then restore an upgrade with queued offline work. Save `10-build-identity.png`. Pass when every receipt names the candidate SHA and queued operations survive upgrade and reconcile once.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure packaged startup to ready, scan-result to visible attendance, and process count before and after the seeded run. Record physical capture latency separately.
- [ ] Probe. Alternate 20 previous-release/candidate trials on the same hardware station and synthetic test account data. Confirm both builds execute the same scenario and use identical scanner and sheet conditions.
- [ ] Baseline. Record the previous accepted release's p95 and process cleanup first. Include failures and timeouts in the report instead of dropping them from timing samples.
- [ ] Rule. Proposed budgets remain 5 seconds for startup and 1 second for local attendance feedback, with no regression greater than 20 percent plus 100 ms. Require no extra live app/scanner processes after cleanup. Do not gate hardware capture speed against a synthetic scanner result.

**Review gate.** None. E2E-5 is not review-gated for interactions. The operator approves installer publication after reviewing the release receipts.

**Merge.**

- [ ] Attach required CI check names, red fault-probe evidence, real-Sheets readback, hardware transcript, installer hash, upgrade screenshots, and exact build SHA before accepting E2E-5.

## Close the program

- [ ] Map every Appendix D feature to an automated case or a documented hardware/package gate. No critical feature may remain uncovered.
- [ ] Make the complete fake-boundary suite reproducible with one documented command. Keep the real dependency commands separate and fail when their prerequisites are missing.
- [ ] Record the first known-good suite and installer receipts. Keep required checks blocking and add a failing reproduction before each future bug fix.
- [ ] For every feature change, update its scenario and coverage row in the same commit. Review skipped tests, approved visual changes, and dependency upgrades explicitly.
- [ ] Hand back the verified commits or stack and unresolved blockers. Do not describe source analysis or simulated checks as physical hardware proof.

## Appendix A. Prototype evidence

The analyzed checkout is `cf8b1fe06ebc73fb291b8ad436b1ac6828309d81`, version 0.1.9, on 12 October 2026. The working tree was clean before this document.

`bun test` and `bun run test` both passed 48 cases in `test/core.test.mjs`. These are core helper and local-file tests. They do not launch Electron, exercise native dialogs, run the physical SDK, or verify real Sheets mutation.

No implementation prototype ran during planning. Electron automation compatibility, isolated packaged launch, and test timing budgets remain unproven. E2E-1 makes those experiments its first acceptance gate. No screenshot, prototype branch, or prototype SHA exists to cite.

Three read-only exploration agents were started before the session interruption. The UI agent returned a partial isolation finding, then hit a usage limit. The data and scanner agents provided no retained completion reports. The final plan uses direct source inspection after the updated instructions and records no independent-agent verification claim.

The plan checker is `C:/Users/OMEN/.codex/skills/poteto-mode/scripts/check-plan.mjs`. Run `node C:/Users/OMEN/.codex/skills/poteto-mode/scripts/check-plan.mjs plans/e2e-testing.md` after editing this plan. This checks structure, not whether the proposed tests work.

## Appendix B. Alternatives rejected

| Approach | Reason |
| --- | --- |
| Browser-only tests with a fake `window.attendance` | They bypass the main process, preload, IPC, queue, scanner spawn, and actual Google request construction. Keep only narrow responsive checks this way. |
| Real Sheets and a real reader in every PR | USB hardware, SDK setup, credentials, and network availability make the ordinary regression suite nondeterministic. Verify those boundaries separately before release. |
| A second application backend or generic Google emulator | The app needs one small client substitution and known request contracts. A separate backend adds behavior that production does not use. |
| Snapshot-only coverage | A correct screenshot can coexist with a wrong student write, corrupted queue, or missing checkbox rule. Assert disk and grid results too. |
| Retries that turn flaky failures green | A failed first attempt is evidence. Preserve it and fix the cause before restoring the blocking check. |
| A guaranteed zero-regression claim or an arbitrary coverage percentage | Neither proves the known workflows. Gate concrete cases, real boundaries, and every documented historical failure. |

## Appendix C. Risks

These are source-inspection risks or unverified requirements, not reproduced runtime diagnoses.

| Risk | Source evidence and required response |
| --- | --- |
| Tests touch real home data | `loadConfig` isolates prints with `FINGERPRINT_DIR`, but `startAppLog`, `scanTimesPath`, `outboxPath`, and `app.setPath` still select real home/profile locations. E2E-1 isolates all paths before boot. |
| Append replay after an uncertain acknowledgement | `writeQueuedPresent` persists `item.log` after append. A server-accepted append followed by a lost response or crash can be replayed. E2E-2 must prove deduplication or block release with a failing case. Do not claim exactly-once delivery from local flags alone. |
| Queue loss or wrong operation after rapid actions | `saveOutbox` writes directly, acceptance invokes it without awaiting, and `drainOutbox` removes the array head after an awaited write. Concurrent undo, clock, and mark mutations require controlled E2E-2 races and disk-failure cases. |
| Wrong person after roster rows move | Undo resolves `planClearRow` by queued row number, whereas log mutation uses id. E2E-2 reorders the roster before sync and requires identity-safe results. |
| A partial log warning disappears | `writeQueuedPresent` saves `item.logError`, but `drainOutbox` removes the item without passing it to `markDetail`. E2E-4 checks the required warning. Permission and offline failures have separate retained-queue behavior. |
| A saved pending print is not offered after restart | `restorePending` checks that `pending.txt` exists but leaves `pending` null. Batch scans intentionally remain in memory. E2E-3 records both restart outcomes and requires a separate product decision before changing the batch contract. |
| Date selection differs from timestamp timezone | `findDateColumn` uses local Date getters while `attendanceStamp` uses Asia/Damascus. E2E-2 runs midnight cases with a different host timezone. |
| Simulated Sheets preserves rules incorrectly | The fixture can validate requests but cannot prove Google applies them as intended. E2E-5 reads real value and validation back from dedicated test cells. |
| Fake scanner hides SDK matching or device locks | Physical cache matching, UTF-8 console output, the hidden message pump, USB reconnection, and `EndEngine` require the E2E-5 reader station. |
| Playwright Electron automation changes | Electron support is experimental. Pin the pair, gate the launch probe, and test upgrades before changing either dependency. |
| Generic control skills are unavailable | This harness has no `control-ui` or `control-cli` skill. The implementation uses repository-owned Electron tests and PowerShell for reproducible checks. Use the product-native collaborative preview for available browser inspection. Native installer and dialog checks need a documented Windows desktop procedure. |
| Builder includes fixture assets | `files` excludes `test/**` but new tooling elsewhere needs explicit exclusions. E2E-5 inspects packaged contents and fails on test modules or private assets. |
| Historical scanner instructions disagree | `scanner/AGENTS.md` retains an old Express timeout paragraph, but names `src/scan.mjs` as the current host. Use its actual `2 * timeout + grace` implementation and the current host contract. Do not revive the obsolete adapter. |
| No runtime proof yet | This prompt requested analysis and a plan. All live lanes, budgets, real-Sheets checks, hardware checks, and upgrade checks remain unchecked until implementation. |

## Appendix D. Links and reading list

### Feature inventory and owners

The following inventory comes from direct inspection of the analyzed checkout. The phase column names planned coverage, not tests already implemented.

| Feature | Source entry points | Planned coverage |
| --- | --- | --- |
| Startup, setup failure, preload state, one app instance | `src/main/index.js` app startup, `createWindow`, `registerIpc`; `src/preload/index.js` | E2E-1 smoke; E2E-5 second launch focuses the first window without a second scanner owner |
| Config precedence, fixed paths, packaged scanner fallback | `src/config.mjs` `loadConfig`, `legacyUserDataPath`, `scannerExeInResources`; `configOptions` | E2E-1 isolation; E2E-4 settings; E2E-5 upgrade |
| Continuous identify, live cue, retry, watchdog | `src/scan.mjs` `runIdentify`, `interpretIdentify`, `mergeCapturedFiles`, `planScanRetry`; main `oneScan`, `runLoop` | E2E-3 protocol and ownership; E2E-4 cues; E2E-5 physical capture |
| Known match and exact roster id | `src/store.mjs` `studentByTemplateSid`, `captureScreen`, `canonicalStudentId`; main `handleCapture` | E2E-2 identity cases; E2E-3 Arabic and extra-template stems |
| Matched student's Info profile | `studentProfile`; main `profileFieldsFor`, `lastMatchOf`; renderer `renderProfile` | E2E-4 filled nondates, short chips, flags, phone/long rows, id and time |
| Today list, count, scan clock fallback | `presentToday`, `attachLogTimes`, `withScanTimes`, `clocksFromAppLog`; renderer `renderToday` | E2E-2 literal counts and log mapping; E2E-4 scroll and clock controls |
| Attendance checkbox and missing date insertion | `planAttendance`, `findDateColumn`, `planDateColumn`; Google `writeAttendanceCell`, `ensureDateColumn`, `insertDateColumn` | E2E-2 payload/grid preservation; E2E-5 real checkbox and COUNTA readback |
| Immediate optimistic mark and persistent queue | `queuePresent`, `overlayPresent`; main `acceptPresent`, `saveOutbox`, `loadOutbox`, `drainOutbox` | E2E-2 offline, retries, restarts, corruption, interleaving |
| Undo with confirmation | `queueAbsent`, `planClearRow`, `logHits`; main `acceptAbsent`, `writeQueuedAbsent`; renderer `undoToday` | E2E-2 unsent cancel, sent clear, matching log deletion; E2E-4 confirmation |
| Clock correction | `parseClock`, `stampFromClock`, `queueClock`; main `acceptClock`, `writeQueuedClock` | E2E-2 invalid time, coalescing, same Damascus date, existing or missing log row |
| AttendanceLog optional name and failure preservation | `logLayout`, `attendanceLogRow`; main `writeQueuedPresent`, `timesFor`, `markDetail` | E2E-2 optional columns and partial writes; E2E-4 accurate warnings |
| Cached and fuzzy roster search | `fuzzyStudents`, `catalogDue`; main `refreshCatalog`, `reloadStudents`; renderer `refreshList`, `filterGen` | E2E-3 throttle, stale responses, current list retention, empty/cached roster |
| Unknown capture, assignment, primary replacement | main `showPending`, `assignStudent`; store `templateFileForStudent`, `putStudent`, `saveIndex` | E2E-3 picker, invalid selection, exact saved bytes and next match |
| Multiple scans, gallery, Done, Rescan, Cancel | main `addMoreScans`, `finishEnroll`, `rescanCapture`, `discardScans`, `writeBatch`; renderer gallery/actions | E2E-3 batch filenames, latest rescan, cancel preservation, session-only restart |
| Fingerprint sheet append and restore | `fingerprintSheetRow`, `fingerprintFiles`; main `appendFingerprints`, `syncStoredPrints` | E2E-3 multiple rows per id, empty-sheet headers, local save retention, missing-only restore |
| Delete all fingerprints | main `clearFingerprints` IPC, `printsEpoch`; store `clearFingerprints`; Google `clearSheetBelowHeader` | E2E-3 remote-first failure/success and stale capture suppression |
| Settings and native file picker | main `saveConfig`, `writeConfigFile`, `pickFile`, `startLoop`; renderer Settings handlers | E2E-4 validation, cancel, persistence; E2E-5 native dialog |
| Language and four Arabic fonts | `src/renderer/i18n.js` `setLang`, `setFont`, `applyDom`; localStorage | E2E-4 English, Arabic RTL, fonts, persistence, invalid saved preference fallback |
| Contained scrolling and responsive breakpoint | `src/renderer/style.css`; `index.html` ready, today, pending, config | E2E-4 native-window geometry, large content, separate sub-760 renderer test |
| Scan images and private print protocol | main `keepScanImage`, `rememberBatchImage`, `printFile`, `protocol.handle` | E2E-3 single/gallery images; E2E-4 allowed slot loads, unknown file 404, no arbitrary file access |
| Diagnostics and crash visibility | `src/log.mjs` `startAppLog`; main `watchWindow` | E2E-1 isolated log; E2E-4 renderer/main failures and no secrets in reports |
| Packaging, scanner runtime, icon, profile, release commit | `package.json` builder/NSIS; `scripts/scanner-release.mjs`; `scripts/release.mjs` | E2E-5 artifact contents, hashes, version ancestry, fresh install and upgrade |

### Verify every known historical failure

| Recorded failure in AGENTS.md | Required regression case |
| --- | --- |
| Same finger repeatedly opens picker | E2E-5 physical six-scan case using cache identification and threshold 8 |
| Arabic template id turns into question marks | E2E-3 fragmented UTF-8 protocol plus E2E-5 legacy Arabic filename capture |
| USB locked by forced termination | E2E-3 fake watchdog and graceful ownership; E2E-5 healthy reopen after capture exit |
| Finger cue starts before scanner ready | E2E-4 ready, wait, down, retry, outage, reduced-motion states |
| Checkbox disappears or FALSE inflates count | E2E-2 exact updateCells contract; E2E-5 real mark/undo validation and count readback |
| Pages permission failure loses log or fingerprint | E2E-2 retained cell and queue; E2E-3 retained local print; E2E-4 accurate warning |
| Start or taskbar shows Electron atom | E2E-5 installed exe and shortcut icon inspection |
| Two scanner owners or stale executable | E2E-3 pid timeline; E2E-5 packaged exe path and staged hash comparison |
| Installer version commit is behind shipped code | E2E-5 clean-tree release sequence and SHA/version/installer receipts |

### Read the source and external contracts

Read [host instructions](../AGENTS.md), [scanner instructions](../scanner/AGENTS.md), [main process](../src/main/index.js), [scanner host](../src/scan.mjs), [sheet and queue helpers](../src/store.mjs), [Google requests](../src/google.mjs), [preload](../src/preload/index.js), [renderer](../src/renderer/renderer.js), [window styles](../src/renderer/style.css), and [existing tests](../test/core.test.mjs).

Playwright documents Electron launch and main-process inspection as experimental support. Native Electron dialogs require main-process interception for deterministic automation. See [Electron automation](https://playwright.dev/docs/api/class-electron) and [Electron application inspection](https://playwright.dev/docs/api/class-electronapplication). Use the Electron browser context's tracing lifecycle for custom fixtures. See [trace viewer](https://playwright.dev/docs/trace-viewer). Keep retries disabled for the required first-attempt gate. See [retry behavior](https://playwright.dev/docs/test-retries).

Google describes cell values and validation as separate cell fields. The real-Sheets check must read both back. See [CellData and DataValidationRule](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells) and [data validation operations](https://developers.google.com/workspace/sheets/api/samples/data).

### Record the principles used

| Read principle | Specific planning choice |
| --- | --- |
| Sequence work into verifiable units | Complete isolated launch before workflow tests, then add release gates after the workflows pass. |
| Prove It Works | Pair window assertions with disk and grid evidence, then separately test the real reader, real Sheets, and installer. |
| Test Behavior, Not Implementation | Trigger actions through the real controls and assert literal final state, rather than successful mocked calls. |
| Boundary Discipline | Replace scanner input and authenticated transport at their boundaries while retaining main, preload, renderer, queue, and write helpers. |
| Guard the Context Window | Partition initial source exploration into UI, data, and scanner slices. Reinspect directly when agent reports were unavailable. |
| Encode Lessons in Structure | Plan blocking cases for every documented historical bug and validate this document with the existing plan checker. |

The analysis used the `how`, `technical-writing`, `unslop`, and `swarm` skills. Implementation uses `how` before boundary edits and `interrogate` if a design remains contested. Keep the execution decision trail with the phase receipts. Do not substitute that trail for test evidence.
