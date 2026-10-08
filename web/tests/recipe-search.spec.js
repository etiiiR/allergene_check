import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";

// Use only the isolated test app described in README. Create 200 real records,
// not a mocked dropdown, and clean up precisely the returned fixture IDs.
const headers = { "X-Diary-Request": "1" },
  recipes = [],
  created = [];
let meal;
async function create(request, kind, data) {
  const response = await request.post(`/api/${kind}`, { headers, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  const record = await response.json();
  created.push([kind, record.id]);
  return record;
}
test.beforeAll(async ({ request }) => {
  for (let start = 0; start < 200; start += 10) {
    const batch = await Promise.all(
      Array.from({ length: 10 }, (_, offset) => {
        const n = start + offset;
        const title =
          n === 196
            ? "Kräuter-Reis mit Zitrone"
            : n === 197
              ? "Sommerpfanne"
              : n >= 198
                ? "Täglicher Reis"
                : `Sammlung ${String(n + 1).padStart(3, "0")}`;
        const ingredient =
          n === 196
            ? "Kräuter · 1 Bio-Zitrone"
            : n === 197
              ? "Reis · Zitrone"
              : n === 199
                ? "Tomate"
                : "Karotte";
        return create(request, "recipes", {
          title,
          servings: 2,
          ingredients: [{ text: ingredient, food_ids: [], allergens: [] }],
        });
      }),
    );
    recipes.push(...batch);
  }
  for (const [index, hours] of [
    [165, 48],
    [165, 24],
    [170, 1],
  ]) {
    const record = await create(request, "meals", {
      recipe_id: recipes[index].id,
      portions: 1,
      occurred_at: new Date(Date.now() - hours * 3600000).toISOString(),
    });
    if (index === 170) meal = record;
  }
});
test.afterAll(async ({ request }) => {
  for (const [kind, id] of created.reverse())
    expect(
      (await request.delete(`/api/${kind}/${id}`, { headers })).ok(),
    ).toBeTruthy();
});
async function openMeal(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Mahlzeit eintragen", exact: true })
    .click();
  await page.locator(".entry-workspace").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((a) => a.finished),
    );
  });
}

test("200-recipe picker shows recents, bounded results, German ingredient search and keyboard selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMeal(page);
  await expect(page.locator(".recipe-result")).toHaveCount(3);
  await expect(page.locator(".recipe-result").first()).toHaveAttribute(
    "data-recipe-id",
    recipes[170].id,
  );
  await page.getByLabel("Rezeptvorschläge sortieren").selectOption("frequent");
  await expect(page.locator(".recipe-result").first()).toHaveAttribute(
    "data-recipe-id",
    recipes[165].id,
  );
  await page
    .getByRole("button", { name: "Alle 200 Rezepte durchsuchen" })
    .click();
  await expect(page.locator(".recipe-result")).toHaveCount(6);
  const pager = page.getByRole("navigation", {
    name: "Rezeptvorschläge blättern",
  });
  await pager.getByRole("button", { name: "Weiter" }).click();
  await expect(pager).toContainText("2 / 34");
  const input = page.getByRole("searchbox", {
    name: "Rezept suchen",
    exact: true,
  });
  await input.fill("zitrone kraeuter");
  await expect(page.locator(".recipe-result")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("recipe-search-390.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await input.press("Enter");
  await expect(page.locator(".recipe-selected")).toContainText(
    "Kräuter-Reis mit Zitrone",
  );
  await expect(
    page.getByRole("button", { name: "Rezept ändern", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".recipe-result")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("recipe-selection-390.png"),
  });
  const saveButton = await page
    .getByRole("button", { name: "Mahlzeit speichern", exact: true })
    .boundingBox();
  const mobileNav = await page.locator(".bottom-nav").boundingBox();
  expect(saveButton.y + saveButton.height).toBeLessThanOrEqual(mobileNav.y);
  await expect(
    page.getByRole("heading", { name: "Mahlzeit eintragen", exact: true }),
  ).toBeVisible();
  // Selection alone never submits the meal.
  await page
    .getByRole("button", { name: "Rezept ändern", exact: true })
    .click();
  await input.fill("keinesdieserrezepte");
  await expect(
    page.getByText("Kein passendes Rezept", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recipe-selected")).toContainText(
    recipes[196].title,
  );
  await page.getByRole("button", { name: "Auswahl beibehalten" }).click();
  await expect(input).toHaveCount(0);
});

test("ambiguous names are distinguishable by ingredients and search never resets meal details", async ({
  page,
}) => {
  await openMeal(page);
  const time = await page.getByLabel("Zeitpunkt", { exact: true }).inputValue();
  await page
    .getByRole("button", { name: "Portionen oder Notiz ergänzen" })
    .click();
  await page.getByLabel("Notiz", { exact: false }).fill("my lunch note");
  const input = page.getByRole("searchbox", {
    name: "Rezept suchen",
    exact: true,
  });
  await input.fill("täglicher reis");
  await expect(page.locator(".recipe-result")).toHaveCount(2);
  await input.press("Enter");
  await expect(input).toBeVisible();
  await page
    .locator(`.recipe-result[data-recipe-id="${recipes[199].id}"]`)
    .click();
  await expect(page.locator(".recipe-selected")).toContainText("Tomate");
  await expect(page.getByLabel("Zeitpunkt", { exact: true })).toHaveValue(time);
  await expect(page.getByLabel("Notiz", { exact: false })).toHaveValue(
    "my lunch note",
  );
  await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
});

test("library renders 12 of 200 recipes, resets pages for search and differentiates zero matches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/recipes");
  await expect(page.locator(".recipe-card")).toHaveCount(12);
  await expect(page.locator(".recipe-result-count")).toContainText(
    "200 Rezepte",
  );
  await page.getByLabel("Rezeptsammlung sortieren").selectOption("name");
  const pager = page.getByRole("navigation", {
    name: "Rezeptsammlung blättern",
  });
  await pager.getByRole("button", { name: "Weiter" }).click();
  await expect(pager).toContainText("Seite 2 / 17");
  const input = page.getByRole("searchbox", {
    name: "Rezepte suchen",
    exact: true,
  });
  await input.fill("zitrone reis");
  await expect(page.locator(".recipe-card")).toHaveCount(2);
  await expect(page.locator(".recipe-result-count")).toContainText(
    "1–2 angezeigt",
  );
  await expect(
    page.getByRole("heading", { name: "Sommerpfanne" }),
  ).toBeVisible();
  await input.fill("keinrezept");
  await expect(
    page.getByRole("heading", { name: "Kein passendes Rezept gefunden." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mein erstes Rezept" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Suche zurücksetzen", exact: true })
    .click();
  await expect(page.locator(".recipe-card")).toHaveCount(12);
  await expect(pager).toContainText("Seite 1 / 17");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("recipes-200-320.png"),
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("recipe cards stay compact on mobile and form a denser desktop grid", async ({
  page,
}) => {
  await page.goto("/recipes");
  for (const [width, columns] of [
    [390, 1],
    [1024, 2],
    [1440, 3],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("recipe-card")).toHaveCount(12);
    const count = await page
      .locator(".recipe-library-list")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(count).toBe(columns);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});

test("existing meal editor reuses the same search and preserves its original choice on cancel", async ({
  page,
}) => {
  await page.goto("/diary");
  await page.getByRole("button", { name: "Alle Tage", exact: true }).click();
  await page
    .locator(`[data-entry-id="${meal.id}"]`)
    .getByRole("button", { name: "Eintrag bearbeiten" })
    .click();
  await expect(page.locator(".recipe-selected")).toContainText(
    recipes[170].title,
  );
  await page
    .getByRole("button", { name: "Rezept ändern", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Rezept suchen", exact: true })
    .fill("kraeuter");
  await page
    .getByRole("button", {
      name: recipes[196].title + " auswählen",
      exact: true,
    })
    .click();
  await expect(page.locator(".recipe-selected")).toContainText(
    recipes[196].title,
  );
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(page.locator(`[data-entry-id="${meal.id}"]`)).toContainText(
    recipes[170].title,
  );
});
