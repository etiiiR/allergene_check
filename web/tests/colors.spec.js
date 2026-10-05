import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("capture actions share one visual style and the app uses only three semantic tones", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const captureControls = [
    page.getByRole("button", { name: "Mahlzeit eintragen", exact: true }),
    page.getByRole("button", { name: "Befinden", exact: true }),
    page.getByRole("button", { name: "Gutes Befinden", exact: true }),
    page.locator(".compact-more summary"),
  ];
  const captureStyles = await Promise.all(
    captureControls.map((control) =>
      control.evaluate((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return [
          style.backgroundColor,
          style.color,
          style.borderColor,
          style.borderRadius,
          Math.round(rect.height),
        ];
      }),
    ),
  );
  expect(
    captureStyles.every(
      (style) => JSON.stringify(style) === JSON.stringify(captureStyles[0]),
    ),
  ).toBeTruthy();
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
  expect(new Set(tones).size).toBe(3);
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
  await page.getByRole("radio", { name: "Blähungen: Leicht" }).click();
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
  expect(new Set(backgrounds).size).toBeLessThanOrEqual(2);
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
