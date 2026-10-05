import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("category colors remain distinct, labelled and accessible in every capture view", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tones = [];
  for (const [label, tone, more] of [
    ["Mahlzeit eintragen", "meal", false],
    ["Befinden", "symptom", false],
    ["Gutes Befinden", "well", false],
    ["Stress manuell", "stress", true],
    ["Stuhl", "stool", true],
  ]) {
    await page.goto("/");
    if (more) await page.locator(".compact-more summary").click();
    const action = page.getByRole("button", { name: label, exact: true });
    await expect(action).toHaveAttribute("data-tone", tone);
    tones.push(
      await action.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--tone-ink").trim(),
      ),
    );
    await action.click();
    const editor = page.locator(".entry-workspace");
    await expect(editor).toHaveAttribute("data-tone", tone);
    await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`${tone}-390.png`),
      animations: "disabled",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBeTruthy();
  }
  expect(new Set(tones).size).toBe(5);
});

test("time, stress and notes have separate input treatments and selected symptoms remain explicit", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Befinden", exact: true }).click();
  const symptom = page.getByRole("button", { name: "Blähungen", exact: true });
  await symptom.click();
  await expect(symptom).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page
    .getByRole("button", { name: "Stress, Schlaf oder Notiz ergänzen" })
    .click();
  const backgrounds = [];
  for (const name of ["Zeitpunkt", "Stress (manuell)", "Notiz optional"]) {
    const field = page.getByLabel(name, { exact: true });
    expect(
      await field.evaluate(
        (el) => getComputedStyle(el.closest("label")).boxShadow,
      ),
    ).toBe("none");
    expect(
      await field.evaluate(
        (el) => getComputedStyle(el.closest("label")).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    backgrounds.push(
      await field.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
  }
  expect(new Set(backgrounds).size).toBe(3);
  const stress = page.getByLabel("Stress (manuell)", { exact: true });
  await stress.focus();
  await expect(stress).toBeFocused();
  expect(await stress.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe(
    "2px",
  );
  await stress.blur();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("grouped-inputs-390.png"),
    fullPage: true,
    animations: "disabled",
  });
});
