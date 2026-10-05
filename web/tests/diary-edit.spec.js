import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const headers = { "X-Diary-Request": "1" };
let created;
test.beforeEach(() => {
  created = [];
});
test.afterEach(async ({ request }) => {
  for (const [kind, id] of created.reverse())
    expect(
      (await request.delete(`/api/${kind}/${id}`, { headers })).ok(),
    ).toBeTruthy();
});
async function create(request, kind, data) {
  const response = await request.post(`/api/${kind}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  const record = await response.json();
  created.push([kind, record.id]);
  if (record.checkin) created.push(["checkins", record.checkin.id]);
  return record;
}
const now = () => new Date(Date.now() - 60_000).toISOString();

test("meal-time baseline keeps provenance on note edit and supports explicit symptomatic correction", async ({
  page,
  request,
}) => {
  const recipe = await create(request, "recipes", {
    title: "Baseline edit",
    servings: 1,
    ingredients: [{ text: "Salz", food_ids: ["salt"], allergens: [] }],
  });
  const meal = await create(request, "meals", {
    recipe_id: recipe.id,
    occurred_at: now(),
    portions: 1,
    record_good_moment: true,
  });
  await openEditor(page, meal.checkin.id);
  await expect(
    page.getByLabel("Als eigenständige Beobachtung bestätigen"),
  ).not.toBeChecked();
  await page.getByLabel("Notiz", { exact: true }).fill("corrected note only");
  expect(await saveEditor(page, "checkins", meal.checkin.id)).toMatchObject({
    meal_baseline: true,
    reference_meal_id: meal.id,
  });
  await openEditor(page, meal.checkin.id);
  await page.getByRole("button", { name: "Beschwerden", exact: true }).click();
  await page.getByLabel("Bauchschmerzen", { exact: true }).fill("5");
  const saved = await saveEditor(page, "checkins", meal.checkin.id);
  expect(saved.meal_baseline).toBeFalsy();
  expect(saved).toMatchObject({
    symptom_free: false,
    symptoms: { pain: 5 },
    reference_meal_id: meal.id,
  });
});

test("changing meal recipe and day updates its calendar timestamp without duplicating observations", async ({
  page,
  request,
}) => {
  const first = await create(request, "recipes", {
    title: "Before",
    servings: 1,
    ingredients: [{ text: "Salz", food_ids: ["salt"], allergens: [] }],
  });
  const second = await create(request, "recipes", {
    title: "After",
    servings: 1,
    ingredients: [{ text: "Zucker", food_ids: ["sugar"], allergens: [] }],
  });
  const meal = await create(request, "meals", {
    recipe_id: first.id,
    occurred_at: now(),
    portions: 1,
  });
  await openEditor(page, meal.id);
  await page
    .getByRole("button", { name: "Rezept ändern", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Rezept suchen", exact: true })
    .fill(second.title);
  await page
    .getByRole("button", { name: second.title + " auswählen", exact: true })
    .click();
  await page.getByLabel("Zeitpunkt", { exact: true }).fill("2026-01-02T12:34");
  const saved = await saveEditor(page, "meals", meal.id);
  const expectedTime = await page.evaluate(() =>
    new Date("2026-01-02T12:34").toISOString(),
  );
  expect(saved).toMatchObject({
    id: meal.id,
    recipe_id: second.id,
    title: "After",
    ingredients: second.ingredients,
    occurred_at: expectedTime,
  });
  await expect(page.locator(`[data-entry-id="${meal.id}"]`)).toContainText(
    "After",
  );
});
async function openEditor(page, id) {
  await page.goto("/diary");
  await page.getByRole("button", { name: "Alle Tage", exact: true }).click();
  await page
    .locator(`[data-entry-id="${id}"]`)
    .getByRole("button", { name: "Eintrag bearbeiten" })
    .click();
  await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
  // Measure accessibility after the entrance fade, not a translucent frame.
  await page.locator(".entry-workspace").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
}
async function saveEditor(page, kind, id) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/${kind}/${id}`) && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  const saved = await response;
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await expect(page.locator(".diary-edit-form")).toHaveCount(0);
  return saved.json();
}
async function diary(request) {
  return (await request.get("/api/diary")).json();
}

test("meal edits persist without changing snapshots, IDs or precise times and recalculate patterns", async ({
  page,
  request,
}) => {
  const recipe = await create(request, "recipes", {
    title: "Edit meal regression",
    servings: 1,
    ingredients: [{ text: "Salz", food_ids: ["salt"], allergens: [] }],
  });
  const meal = await create(request, "meals", {
    recipe_id: recipe.id,
    occurred_at: now(),
    portions: 1,
    notes: "original",
    record_good_moment: true,
  });
  expect(
    (
      await request.put(`/api/recipes/${recipe.id}`, {
        headers,
        data: {
          ...recipe,
          ingredients: [{ text: "Zucker", food_ids: ["sugar"], allergens: [] }],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page, meal.id);
  await page.getByLabel("Notiz", { exact: true }).fill("cancel this");
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await diary(request)).meals.find((m) => m.id === meal.id).notes).toBe(
    "original",
  );
  await openEditor(page, meal.id);
  await page.getByLabel("Portionen", { exact: true }).fill("1.5");
  await page.getByLabel("Notiz", { exact: true }).fill("corrected meal");
  const saved = await saveEditor(page, "meals", meal.id);
  expect(saved).toMatchObject({
    id: meal.id,
    portions: 1.5,
    occurred_at: meal.occurred_at,
    ingredients: meal.ingredients,
  });
  await expect(page.locator(".edit-analysis-status")).toContainText(
    "Auswertung mit den aktuellen Daten neu berechnet",
    { timeout: 30_000 },
  );
  const data = await diary(request);
  expect(data.meals.filter((m) => m.id === meal.id)).toHaveLength(1);
  expect(data.checkins.find((c) => c.id === meal.checkin.id)).toMatchObject(
    meal.checkin,
  );
  await page.reload();
  await page.getByRole("button", { name: "Alle Tage", exact: true }).click();
  await expect(page.locator(`[data-entry-id="${meal.id}"]`)).toContainText(
    "1.5 Portion(en)",
  );
});

test("editing all symptoms retains context, reports ML outages separately and can switch to symptom-free", async ({
  page,
  request,
}) => {
  const check = await create(request, "checkins", {
    occurred_at: now(),
    symptom_free: false,
    symptoms: { pain: 6, bloating: 4 },
    timing_bucket: "mid",
    stress: 7,
    sleep_hours: 6.5,
    notes: "before",
  });
  await page.route("**/api/patterns?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "offline" } }),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page, check.id);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("edit-390.png"),
    fullPage: true,
  });
  await expect(page.getByLabel("Bauchschmerzen", { exact: true })).toHaveValue(
    "6",
  );
  await expect(page.getByLabel("Blähungen", { exact: true })).toHaveValue("4");
  await page.getByLabel("Bauchschmerzen", { exact: true }).fill("2");
  const saved = await saveEditor(page, "checkins", check.id);
  expect(saved).toMatchObject({
    id: check.id,
    symptoms: { pain: 2, bloating: 4 },
    stress: 7,
    sleep_hours: 6.5,
    timing_bucket: "mid",
    occurred_at: check.occurred_at,
  });
  await expect(page.locator(".edit-analysis-status")).toContainText(
    "Deine Änderungen bleiben erhalten",
  );
  expect(
    (await diary(request)).checkins.find((c) => c.id === check.id).symptoms
      .pain,
  ).toBe(2);
  await page.unroute("**/api/patterns?**");
  await page
    .getByRole("button", { name: "Auswertung erneut versuchen" })
    .click();
  await expect(page.locator(".edit-analysis-status")).toContainText(
    "Auswertung mit den aktuellen Daten neu berechnet",
    { timeout: 30_000 },
  );
  await openEditor(page, check.id);
  await page.getByRole("button", { name: "Gut", exact: true }).click();
  const good = await saveEditor(page, "checkins", check.id);
  expect(good.symptom_free).toBe(true);
  expect(good.symptoms).toEqual({});
});

test("stool and manual stress edits update existing records and analysis values", async ({
  page,
  request,
}) => {
  const stool = await create(request, "stools", {
    observed_at: now(),
    observed_for_date: now().slice(0, 10),
    quality: "hard",
  });
  const stress = await create(request, "stress", {
    source: "generic",
    metric: "stress_score",
    value: 3,
    normalized_stress: 3,
    unit: "score_0_10",
    observed_at: now(),
  });
  await openEditor(page, stool.id);
  await page.getByLabel("Beschaffenheit").selectOption("formed");
  expect((await saveEditor(page, "stools", stool.id)).quality).toBe("formed");
  await openEditor(page, stress.id);
  await page.getByLabel("Stress (0–10)").fill("7.5");
  expect(await saveEditor(page, "stress", stress.id)).toMatchObject({
    id: stress.id,
    value: 7.5,
    normalized_stress: 7.5,
  });
});

test("imported Health measurements allow note corrections but reject modified measurements", async ({
  page,
  request,
}) => {
  const observation = await create(request, "stress", {
    source: "apple_healthkit",
    external_id: `edit-${Date.now()}`,
    metric: "hrv",
    value: 42,
    unit: "ms",
    observed_at: now(),
  });
  await openEditor(page, observation.id);
  await expect(page.getByLabel("Zeitpunkt", { exact: true })).toHaveCount(0);
  await page.getByLabel("Notiz", { exact: true }).fill("after walk");
  expect(await saveEditor(page, "stress", observation.id)).toMatchObject({
    ...observation,
    notes: "after walk",
  });
  expect(
    (
      await request.put(`/api/stress/${observation.id}`, {
        headers,
        data: { value: 8 },
      })
    ).status(),
  ).toBe(422);
  expect(
    (await diary(request)).stress_observations.find(
      (s) => s.id === observation.id,
    ).value,
  ).toBe(42);
});

test("failed writes retain the draft and invalid or missing entries are not upserted", async ({
  page,
  request,
}) => {
  const check = await create(request, "checkins", {
    occurred_at: now(),
    symptom_free: false,
    symptoms: { pain: 6 },
    stress: 4,
    sleep_hours: 8,
  });
  await openEditor(page, check.id);
  await page.getByLabel("Notiz", { exact: true }).fill("keep my draft");
  await page.route(`**/api/checkins/${check.id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Speichern gerade nicht möglich." },
      }),
    }),
  );
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.locator(".diary-edit-form [role=alert]")).toContainText(
    "Speichern gerade nicht möglich",
  );
  await expect(page.getByLabel("Notiz", { exact: true })).toHaveValue(
    "keep my draft",
  );
  await page.unroute(`**/api/checkins/${check.id}`);
  await saveEditor(page, "checkins", check.id);
  expect(
    (
      await request.put(`/api/checkins/${check.id}`, {
        headers,
        data: { symptoms: { pain: 99 } },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.put("/api/checkins/00000000-0000-4000-8000-000000000000", {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.put(`/api/checkins/${check.id}`, {
        data: { notes: "forbidden" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await diary(request)).checkins.find((c) => c.id === check.id),
  ).toMatchObject({ notes: "keep my draft", symptoms: { pain: 6 } });
});
