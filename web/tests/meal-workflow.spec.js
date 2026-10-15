import { test, expect } from "./fixtures.js";

test("equal actions and inline recipe creation preserve the meal and its editable good default", async ({
  page,
  request,
}) => {
  const created = [],
    headers = { "X-Diary-Request": "1" };
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const actions = await page.locator(".compact-capture > button").all();
    const sizes = await Promise.all(
      actions.map((action) => action.boundingBox()),
    );
    for (const size of sizes) {
      expect(Math.abs(size.width - sizes[0].width)).toBeLessThan(1);
      // Browser transforms can introduce sub-pixel rounding during entry.
      expect(Math.abs(size.height - sizes[0].height)).toBeLessThan(1);
    }
    await page
      .getByRole("button", { name: "Mahlzeit eintragen", exact: true })
      .click();
    const occurredAt = await page
      .getByLabel("Zeitpunkt", { exact: true })
      .inputValue();
    await expect(
      page.getByRole("button", { name: "Gut", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Neues Rezept direkt hinzufügen" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Mahlzeit eintragen", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
    await page.getByLabel("Rezeptname").fill("Inline recipe " + Date.now());
    await page
      .getByRole("button", { name: "Zutat manuell hinzufügen" })
      .click();
    await page.getByLabel("Zutat 1", { exact: true }).fill("1 Prise Salz");
    const recipeResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/recipes") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Rezept speichern", exact: true })
      .click();
    const recipe = await (await recipeResponse).json();
    created.push(["recipes", recipe.id]);
    expect(recipe.analysis_ingredient_ids).toEqual(["salt"]);
    await expect(page.locator(".inline-recipe-create")).toHaveCount(0);
    await expect(page.getByLabel("Zeitpunkt", { exact: true })).toHaveValue(
      occurredAt,
    );
    await page
      .getByRole("button", { name: "Nicht erfassen", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Gut", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Gut", exact: true }).click();
    const mealResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/meals") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Mahlzeit speichern", exact: true })
      .click();
    const response = await mealResponse;
    expect(response.ok()).toBeTruthy();
    const meal = await response.json();
    created.push(["meals", meal.id]);
    if (meal.checkin) created.push(["checkins", meal.checkin.id]);
    expect(meal.recipe_id).toBe(recipe.id);
    expect(meal.checkin).toMatchObject({
      symptom_free: true,
      meal_baseline: true,
      reference_meal_id: meal.id,
      occurred_at: meal.occurred_at,
    });
  } finally {
    for (const [kind, id] of created.reverse())
      expect(
        (await request.delete(`/api/${kind}/${id}`, { headers })).ok(),
      ).toBeTruthy();
  }
});

test("web browser does not pretend it can authorize Apple Health", async ({
  page,
}) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Health", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Apple Health freigeben & synchronisieren",
    }),
  ).toBeDisabled();
  await expect(page.getByText(/Hier läuft die Web-App/)).toBeVisible();
});
