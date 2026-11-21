import { test, expect } from "./fixtures/app.mjs";

test("reduced motion parks the ready finger cue", async ({ app }) => {
  await expect(app.page.locator("#place")).toHaveAttribute("data-cue", "now");
  await app.page.emulateMedia({ reducedMotion: "reduce" });
  const cue = await app.page.locator("#place .digit").evaluate((digit) => ({
    animation: getComputedStyle(digit).animationName,
    transform: getComputedStyle(digit).transform,
  }));
  expect(cue.animation).toBe("none");
  expect(cue.transform).not.toBe("none");
});
