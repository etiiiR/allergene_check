import { test, expect, createEncryptedDiaryRequest } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";

// Exercise populated screens as well as the existing CRUD suite. Fixtures are
// tracked by returned IDs; cleanup never targets the user's other records.
const created = [];
const headers = { "X-Diary-Request": "1" };
let originalIDs;
let fixtureAPI;
const diaryIDs = (data) =>
  Object.fromEntries(
    ["recipes", "meals", "checkins", "stress_observations"].map((key) => [
      key,
      (data[key] || []).map((item) => item.id).sort(),
    ]),
  );
test.beforeAll(async ({ playwright, baseURL }) => {
  fixtureAPI = await createEncryptedDiaryRequest({ playwright, baseURL });
  originalIDs = diaryIDs(await (await fixtureAPI.get("/api/diary")).json());
  const create = async (kind, data) => {
    const response = await fixtureAPI.post(`/api/${kind}`, { headers, data });
    expect(response.ok()).toBeTruthy();
    const item = await response.json();
    created.push([kind, item.id]);
    return item;
  };
  const recipe = await create("recipes", {
    title: "UX Test · Ofengemüse mit Kräutern und Joghurtsauce",
    servings: 2,
    ingredients: [
      { text: "Karotte", food_ids: ["carrot"], allergens: [] },
      { text: "Zwiebel", food_ids: ["onion"], allergens: [] },
      { text: "Milch", food_ids: ["milk"], allergens: ["milk"] },
    ],
  });
  await create("meals", {
    recipe_id: recipe.id,
    occurred_at: new Date(Date.now() - 7200000).toISOString(),
    portions: 1,
    notes: "UX test fixture",
  });
  await create("checkins", {
    occurred_at: new Date(Date.now() - 600000).toISOString(),
    symptom_free: false,
    symptoms: { bloating: 6 },
    timing_bucket: "mid",
    stress: 7,
    sleep_hours: 7,
    context_recorded: true,
    notes: "UX test fixture",
  });
  await create("checkins", {
    occurred_at: new Date(Date.now() - 86400000).toISOString(),
    symptom_free: true,
    symptoms: {},
    stress: 2,
    sleep_hours: 8,
    context_recorded: true,
    notes: "UX test fixture",
  });
});
test.afterAll(async () => {
  if (!fixtureAPI) return;
  try {
    for (const [kind, id] of created.reverse()) {
      const response = await fixtureAPI.delete(`/api/${kind}/${id}`, {
        headers,
      });
      expect(response.ok()).toBeTruthy();
    }
    expect(diaryIDs(await (await fixtureAPI.get("/api/diary")).json())).toEqual(
      originalIDs,
    );
  } finally {
    await fixtureAPI.dispose();
  }
});

const routes = [
  "/",
  "/diary",
  "/calendar",
  "/recipes",
  "/insights",
  "/foods",
  "/profile",
  "/onboarding",
  "/report",
];

test(
  "an empty filter offers a one-tap reset instead of suggesting the diary is new",
  async ({ page }) => {
    await page.goto("/diary");
    await page.getByLabel("Datum").fill("2099-01-01");

    const emptyState = page.locator(".empty-state");
    await expect(
      emptyState.getByRole("heading", {
        name: "Keine Einträge für diese Auswahl",
      }),
    ).toBeVisible();
    await emptyState
      .getByRole("button", { name: "Alle Einträge zeigen" })
      .click();
    await expect(emptyState).toHaveCount(0);
    await expect(page.locator(".diary-entry").first()).toBeVisible();
  },
);

for (const route of routes) {
  test(`responsive and accessible: ${route}`, async ({ page }, testInfo) => {
    const errors = [];
    const cspErrors = [];
    await page.addInitScript(() => {
      window.__cspViolationDetails = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolationDetails.push({
          blockedURI: event.blockedURI,
          directive: event.violatedDirective,
          sourceFile: event.sourceFile,
          line: event.lineNumber,
          sample: event.sample,
        });
      });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        /Content Security Policy|Refused to apply inline style/i.test(
          message.text(),
        )
      ) {
        cspErrors.push({ text: message.text(), location: message.location() });
      }
    });
    const response = await page.goto(route);
    expect(response?.headers()["content-security-policy"]).toContain(
      "style-src-attr 'none'",
    );
    await expect(page.locator("main h1").first()).toBeVisible();
    if (route === "/insights" || route === "/report") {
      await expect(page.locator(".skeleton-panel")).toHaveCount(0);
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `overflow on ${route} at ${width}`,
      ).toBeTruthy();
      const nav = page.getByRole("navigation", {
        name: "Hauptnavigation",
        exact: true,
      });
      await expect(nav).toHaveCount(1);
      await expect(nav.getByRole("link")).toHaveCount(5);
      await page.screenshot({
        path: testInfo.outputPath(`page-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(a11y.violations).toEqual([]);
    expect(errors).toEqual([]);
    expect(cspErrors).toEqual([]);
    expect(await page.evaluate(() => window.__cspViolationDetails)).toEqual([]);
  });
}

test("manual vault lock stays in the header and does not cover mobile diary content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/diary");
  const lock = page.getByRole("button", { name: "Tagebuch sperren" });
  await expect(lock).toBeVisible();
  await expect(page.locator(".vault-lock-button")).toHaveCount(0);
  expect(
    await lock.evaluate((element) => getComputedStyle(element).position),
  ).toBe("static");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();

  await page.evaluate(() => {
    window.__gutfeelingDisableE2EAutoUnlock = true;
  });
  await lock.click();
  await expect(
    page.getByRole("heading", { name: "Tagebuch entsperren" }),
  ).toBeVisible();
});

test("automatic vault lock warns first and offers a non-modal way to continue", async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");

  await page.clock.fastForward(14 * 60 * 1000);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "wird bald aus Datenschutzgründen gesperrt" }),
  ).toBeVisible();
  await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const a11y = await new AxeBuilder({ page })
    .include(".vault-idle-warning")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  await page.getByRole("button", { name: "Weiterarbeiten" }).click();
  await expect(page.locator(".vault-idle-warning")).toHaveCount(0);
  await page.clock.fastForward(14 * 60 * 1000);
  await expect(page.locator(".vault-idle-warning")).toBeVisible();
  await page.clock.fastForward(60 * 1000);
  await expect(
    page.getByRole("heading", { name: "Tagebuch entsperren" }),
  ).toBeVisible();
});

test("inline editor retains failed inputs, re-enables saving, and restores focus", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Befinden", exact: true });
  await trigger.click();
  const heading = page.getByRole("heading", {
    name: "Wie geht es deinem Bauch?",
  });
  await expect(heading).toBeFocused();
  await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
  await page.getByRole("button", { name: "Blähungen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Blähungen: Leicht" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Später 2–6 h", exact: true }).click();
  await page
    .getByRole("button", { name: "Stress, Schlaf oder Notiz ergänzen" })
    .click();
  await page.getByLabel("Notiz").fill("Nur ein UI-Test, nicht speichern.");
  await page.route("**/api/vault", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Testfehler: Bitte erneut versuchen." },
      }),
    });
  });
  await page.getByRole("button", { name: "Eintrag speichern" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Testfehler");
  await expect(page.getByLabel("Notiz")).toHaveValue(
    "Nur ein UI-Test, nicht speichern.",
  );
  await expect(
    page.getByRole("button", { name: "Eintrag speichern" }),
  ).toBeEnabled();
  await expect(page.locator(".entry-recap")).toContainText("Blähungen");
  await expect(page.locator(".toast-enter-active")).toHaveCount(0);
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("editor.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
  await expect(trigger).toBeFocused();
});

test("good moment can switch to symptoms and navigation leaves the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Gutes Befinden", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Zu diesem Zeitpunkt geht es gut/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Stattdessen Beschwerden festhalten" })
    .click();
  await page.getByRole("button", { name: "Blähungen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Blähungen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("link", { name: "Rezepte", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Meine Rezepte" }),
  ).toBeVisible();
  await expect(page.locator(".entry-workspace")).toHaveCount(0);
  await page.getByRole("link", { name: "Heute", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dein Tag, im Überblick." }),
  ).toBeVisible();
});

test("daily overview and both symptom steps keep primary actions above mobile navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const aboveNavigation = async (locator) => {
    const action = await locator.boundingBox();
    const nav = await page.locator(".bottom-nav").boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(nav.y);
  };
  await aboveNavigation(page.locator(".home-footer"));
  await page.getByRole("button", { name: "Befinden", exact: true }).click();
  await page.getByRole("button", { name: "Blähungen", exact: true }).click();
  await page.getByRole("radio", { name: "Blähungen: Leicht" }).click();
  await aboveNavigation(
    page.getByRole("button", { name: "Weiter", exact: true }),
  );
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Essensbezug und Zeitpunkt?" }),
  ).toBeFocused();
  await aboveNavigation(
    page.getByRole("button", { name: "Eintrag speichern", exact: true }),
  );
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Blähungen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("reduced motion disables transitions and report print hides app chrome", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page
      .locator(".page-content")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.goto("/report");
  await expect(page.locator("#patient-report")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".desktop-sidebar")).toBeHidden();
  await expect(page.locator(".mobile-header")).toBeHidden();
  await expect(page.locator(".bottom-nav")).toBeHidden();
  await expect(page.locator("#patient-report")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("print.png"),
    fullPage: true,
    animations: "disabled",
  });
});
