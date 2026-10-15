import { test, expect } from "./fixtures.js";

test("a 1/1 ingredient observation shows its counts without a 100% bar", async ({
  page,
  request,
}) => {
  const headers = { "X-Diary-Request": "1" };
  const created = [];
  const create = async (kind, data) => {
    const response = await request.post(`/api/${kind}`, { headers, data });
    expect(response.ok()).toBeTruthy();
    const item = await response.json();
    created.push([kind, item.id]);
    return item;
  };

  try {
    const recipe = await create("recipes", {
      title: `Small sample UX ${Date.now()}`,
      servings: 1,
      ingredients: [{ text: "Salz", food_ids: ["salt"], allergens: [] }],
    });
    const meal = await create("meals", {
      recipe_id: recipe.id,
      occurred_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      portions: 1,
      notes: "",
    });
    await create("checkins", {
      occurred_at: new Date().toISOString(),
      symptom_free: false,
      symptoms: { bloating: 6 },
      timing_bucket: "unknown",
      reference_meal_id: meal.id,
      notes: "",
    });

    await page.goto("/insights");
    const card = page
      .locator(".pattern-card")
      .filter({ has: page.getByRole("heading", { name: "Salz", exact: true }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Noch wenig Daten");
    await expect(card).toContainText("1 / 1 Momente");
    await expect(card).toContainText("Zu wenige Daten");
    await expect(card).not.toContainText("100 %");
    await expect(card.locator("progress")).toHaveCount(0);
  } finally {
    for (const [kind, id] of created.reverse()) {
      const response = await request.delete(`/api/${kind}/${id}`, { headers });
      expect(response.ok()).toBeTruthy();
    }
  }
});
