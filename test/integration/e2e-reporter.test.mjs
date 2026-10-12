import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import E2EReporter from "../e2e/reporter.mjs";

const coveragePath = fileURLToPath(new URL("../e2e/coverage.json", import.meta.url));
const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));

function caseObject(title) {
  return { title, titlePath: () => [title] };
}

function runReporter(reporter) {
  const diagnostics = [];
  const originalError = console.error;
  console.error = (message) => diagnostics.push(String(message));
  try {
    return { result: reporter.onEnd(), diagnostics };
  } finally {
    console.error = originalError;
  }
}

function withFullRun(value, action) {
  const previous = process.env.ATTENDANCE_E2E_FULL;
  if (value === undefined) delete process.env.ATTENDANCE_E2E_FULL;
  else process.env.ATTENDANCE_E2E_FULL = value;
  try {
    return action();
  } finally {
    if (previous === undefined) delete process.env.ATTENDANCE_E2E_FULL;
    else process.env.ATTENDANCE_E2E_FULL = previous;
  }
}

function begin(reporter, titles) {
  reporter.onBegin({}, { allTests: () => titles.map(caseObject) });
}

test("E2E reporter fails closed for skipped and flaky tests", () => {
  withFullRun(undefined, () => {
    const skipped = new E2EReporter();
    begin(skipped, ["skipped case"]);
    skipped.onTestEnd(caseObject("skipped case"), { status: "skipped", retry: 0 });
    const skippedRun = runReporter(skipped);
    assert.deepEqual(skippedRun.result, { status: "failed" });
    assert.ok(skippedRun.diagnostics.some((line) => line.includes("Skipped: skipped case")));

    const flaky = new E2EReporter();
    begin(flaky, ["retried case"]);
    flaky.onTestEnd(caseObject("retried case"), { status: "passed", retry: 1 });
    const flakyRun = runReporter(flaky);
    assert.deepEqual(flakyRun.result, { status: "failed" });
    assert.ok(flakyRun.diagnostics.some((line) => line.includes("Flaky: retried case")));
  });
});

test("E2E reporter fails closed when no tests were discovered", () => {
  withFullRun(undefined, () => {
    const reporter = new E2EReporter();
    begin(reporter, []);
    const run = runReporter(reporter);
    assert.deepEqual(run.result, { status: "failed" });
    assert.ok(run.diagnostics.some((line) => line.includes("No E2E tests were discovered.")));
  });
});

test("full E2E run requires every declared case to execute", () => {
  withFullRun("1", () => {
    const healthy = new E2EReporter();
    begin(healthy, coverage);
    for (const title of coverage) {
      healthy.onTestEnd(caseObject(title), { status: "passed", retry: 0 });
    }
    assert.equal(runReporter(healthy).result, undefined);

    const incomplete = new E2EReporter();
    begin(incomplete, coverage);
    for (const title of coverage.slice(0, -1)) {
      incomplete.onTestEnd(caseObject(title), { status: "passed", retry: 0 });
    }
    const run = runReporter(incomplete);
    assert.deepEqual(run.result, { status: "failed" });
    assert.ok(run.diagnostics.some((line) => line.includes("did not execute every discovered case")));
    assert.equal(run.diagnostics.some((line) => line.includes(coverage.at(-1))), false);
    const missing = new E2EReporter();
    begin(missing, coverage.slice(0, -1));
    for (const title of coverage.slice(0, -1)) missing.onTestEnd(caseObject(title), { status: "passed", retry: 0 });
    const missingRun = runReporter(missing);
    assert.deepEqual(missingRun.result, { status: "failed" });
    assert.ok(missingRun.diagnostics.some((line) => line.includes(`Missing E2E cases: ${coverage.at(-1)}`)));
  });
});
