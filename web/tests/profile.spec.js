import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const headers = { "X-Diary-Request": "1" };

test("guided setup persists a named person, preserves diary records and survives a new browser context", async ({
  page,
  request,
  browser,
}) => {
  const original = await (await request.get("/api/diary")).json();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/onboarding");
    await page.getByLabel("Name der Person").fill("  Testperson Léa  ");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await page.getByLabel("Körperkontext").selectOption("female");
    await page.getByLabel("Zyklus berücksichtigen").check();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(page.getByText("Alles bereit, Testperson Léa.")).toBeVisible();
    await page.route("**/api/profile", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Test: Speichern vorübergehend nicht möglich." },
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Profil anlegen und starten" })
      .click();
    await expect(page.locator("form [role=alert]")).toContainText(
      "vorübergehend",
    );
    await expect(
      page.getByRole("button", { name: "Profil anlegen und starten" }),
    ).toBeEnabled();
    await page.unroute("**/api/profile");
    await page
      .getByRole("button", { name: "Profil anlegen und starten" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".setup-nudge")).toHaveCount(0);
    const saved = await (await request.get("/api/diary")).json();
    expect(saved.profile).toMatchObject({
      display_name: "Testperson Léa",
      onboarding_completed: true,
      body_group: "female",
      cycle_tracking: true,
    });
    for (const key of [
      "recipes",
      "meals",
      "checkins",
      "stools",
      "recipe_flags",
      "stress_observations",
    ])
      expect(saved[key]).toEqual(original[key]);
    const context = await browser.newContext();
    try {
      const freshPage = await context.newPage();
      await freshPage.goto(new URL("/profile", page.url()).href);
      await expect(freshPage.getByLabel("Name der Person")).toHaveValue(
        "Testperson Léa",
      );
      await freshPage.getByLabel("Name der Person").fill("Testperson Alex");
      await freshPage.getByRole("button", { name: "Profil speichern" }).click();
      await expect(
        freshPage.locator(".profile-settings [role=status]"),
      ).toContainText("Profil gespeichert");
      await freshPage.reload();
      await expect(freshPage.getByLabel("Name der Person")).toHaveValue(
        "Testperson Alex",
      );
      await freshPage.goto(new URL("/report", page.url()).href);
      await expect(freshPage.locator("#patient-report")).toContainText(
        "Testperson Alex",
      );
    } finally {
      await context.close();
    }
  } finally {
    expect(
      (
        await request.put("/api/profile", { headers, data: original.profile })
      ).ok(),
    ).toBeTruthy();
  }
});

test("invalid profile updates cannot erase the saved person", async ({
  request,
}) => {
  const original = (await (await request.get("/api/diary")).json()).profile;
  for (const display_name of ["", "x".repeat(81), "Line\nbreak"]) {
    const response = await request.put("/api/profile", {
      headers,
      data: { ...original, display_name, onboarding_completed: true },
    });
    expect(response.status()).toBe(422);
  }
  expect((await (await request.get("/api/diary")).json()).profile).toEqual(
    original,
  );
});
