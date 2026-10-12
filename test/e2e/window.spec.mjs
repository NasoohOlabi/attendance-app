import { test, expect } from "./fixtures/app.mjs";

const crowdedStudents = Array.from({ length: 24 }, (_, index) => [
  `Student ${String(index + 1).padStart(2, "0")}`,
  `00 00 000 ${String(index + 1).padStart(3, "0")}`,
  "حاضر",
  "",
  "",
  "",
  "",
]);

const profileStudents = [
  ["Ahmed Student", "00 00 000 001", "حاضر", "OLD-DATE-VALUE", "+963 900000001", "TRUE", ""],
  ["Second Student", "00 00 000 002", "", "OLD-DATE-VALUE", "+963 900000002", "FALSE", ""],
];

test.describe("crowded ready list", () => {
  test.use({ fixtureOptions: { sheets: { students: crowdedStudents } } });

  test("today names scroll inside the ready area while the window stays fixed", async ({ app }) => {
    await expect(app.page.locator("#today-count")).toHaveText("24");
    const layout = await app.page.evaluate(() => {
      const root = document.documentElement;
      const today = document.querySelector("#today");
      return {
        pageFits: root.scrollHeight <= root.clientHeight,
        todayFitsReady: today.getBoundingClientRect().bottom <= document.querySelector("#ready").getBoundingClientRect().bottom,
        todayScrolls: today.scrollHeight > today.clientHeight,
        names: [...document.querySelectorAll("#today-list .today-name")].map((node) => node.textContent),
      };
    });
    expect(layout.pageFits).toBe(true);
    expect(layout.todayFitsReady).toBe(true);
    expect(layout.todayScrolls).toBe(true);
    expect(layout.names).toHaveLength(24);
    expect(layout.names[0]).toBe("Student 01");
    expect(layout.names.at(-1)).toBe("Student 24");
  });
});

test.describe("attendance profile card", () => {
  test.use({ fixtureOptions: { sheets: { students: profileStudents } } });

  test("shows the matched roster values and omits date and blank cells", async ({ app }) => {
    await expect(app.page.locator("#today-count")).toHaveText("1");
    await app.seedPrint("00 00 000 001", "Ahmed Student");
    await app.mark("00 00 000 001");
    await expect(app.page.locator("#last")).toBeVisible();
    await expect(app.page.locator("#last-name")).toHaveText("Ahmed Student");
    await expect(app.page.locator("#last-fields")).toContainText("+963 900000001");
    await expect(app.page.locator("#last-fields dt")).toHaveCount(1);
    await expect(app.page.locator("#last-chips > span")).toHaveCount(1);
    await expect(app.page.locator("#last-chips")).toContainText("Yes");
    await expect(app.page.locator("#last")).not.toContainText("OLD-DATE-VALUE");

    await app.seedPrint("00 00 000 002", "Second Student");
    await app.mark("00 00 000 002");
    await expect(app.page.locator("#last-name")).toHaveText("Second Student");
    await expect(app.page.locator("#last-fields")).toContainText("+963 900000002");
    await expect(app.page.locator("#last-fields dt")).toHaveCount(1);
    await expect(app.page.locator("#last-chips > span")).toHaveCount(1);
    await expect(app.page.locator("#last-chips")).toContainText("No");
    await expect(app.page.locator("#last")).not.toContainText("OLD-DATE-VALUE");
  });
});

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
