import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const coveragePath = fileURLToPath(new URL("./coverage.json", import.meta.url));

export default class E2EReporter {
  failures = [];
  tests = [];
  fullRun = false;
  completed = 0;

  onBegin(config, suite) {
    this.fullRun = process.env.ATTENDANCE_E2E_FULL === "1";
    this.tests = suite.allTests().map((test) => test.title);
  }

  onTestEnd(test, result) {
    this.completed += 1;
    if (result.status === "skipped") this.failures.push(`Skipped: ${test.titlePath().join(" › ")}`);
    if (result.status === "passed" && result.retry > 0) this.failures.push(`Flaky: ${test.titlePath().join(" › ")}`);
    if (result.status !== "passed" && result.status !== "skipped") this.failures.push(`${result.status}: ${test.titlePath().join(" › ")}`);
  }

  onEnd() {
    if (this.tests.length === 0) this.failures.push("No E2E tests were discovered.");
    if (this.fullRun) {
      if (this.completed !== this.tests.length) this.failures.push("The full E2E run did not execute every discovered case.");
      let expected;
      try {
        expected = JSON.parse(readFileSync(coveragePath, "utf8"));
      } catch (error) {
        this.failures.push(`Could not read E2E coverage inventory: ${error.message}`);
      }
      if (Array.isArray(expected)) {
        const actualCounts = new Map();
        const expectedCounts = new Map();
        for (const title of this.tests) actualCounts.set(title, (actualCounts.get(title) ?? 0) + 1);
        for (const title of expected) expectedCounts.set(title, (expectedCounts.get(title) ?? 0) + 1);
        const titles = new Set([...expectedCounts.keys(), ...actualCounts.keys()]);
        const missing = [...titles].flatMap((title) => Array(Math.max(0, (expectedCounts.get(title) ?? 0) - (actualCounts.get(title) ?? 0))).fill(title));
        const unexpected = [...titles].flatMap((title) => Array(Math.max(0, (actualCounts.get(title) ?? 0) - (expectedCounts.get(title) ?? 0))).fill(title));
        if (missing.length) this.failures.push(`Missing E2E cases: ${missing.join("; ")}`);
        if (unexpected.length) this.failures.push(`Unreviewed E2E cases: ${unexpected.join("; ")}`);
      } else if (expected !== undefined) {
        this.failures.push("E2E coverage inventory must be an array of test path and title strings.");
      }
    }
    for (const failure of this.failures) console.error(failure);
    return this.failures.length ? { status: "failed" } : undefined;
  }
}
