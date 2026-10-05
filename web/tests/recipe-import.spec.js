import { test, expect } from "@playwright/test";

// HTTP/parser behavior is covered by Python's offline fixtures. Here we check
// the editable preview contract without depending on a third-party website.
const source = "https://example.org/recipe";
async function openImport(page) {
  await page.goto("/recipes");
  await page.getByRole("button", { name: "Rezept hinzufügen" }).click();
  await page.getByLabel("Rezept von URL übernehmen").fill(source);
}

test("HTML import fills portions and preserves preview plus all warnings if normalization is unavailable", async ({
  page,
}) => {
  let saves = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/recipes")) saves++;
  });
  await page.route("**/api/recipes/import", (route) => {
    expect(route.request().postDataJSON()).toEqual({ url: source });
    return route.fulfill({
      json: {
        title: "HTML-Testrezept",
        ingredients: ["125 g Mehl", "1 Prise Salz"],
        instructions: "Zutaten mischen.",
        servings: 4,
        source_url: source,
        extraction_method: "microdata",
        warnings: ["Bitte die Portionszahl prüfen."],
      },
    });
  });
  await page.route("**/api/ingredients/analyze", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Nicht verfügbar" } },
    }),
  );
  await openImport(page);
  await page.getByRole("button", { name: "Vorschau laden" }).click();
  await expect(page.getByLabel("Rezeptname")).toHaveValue("HTML-Testrezept");
  await expect(page.getByLabel("Portionen", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Zutat 1", { exact: true })).toHaveValue(
    "125 g Mehl",
  );
  await expect(page.getByLabel("Zutat 2", { exact: true })).toHaveValue(
    "1 Prise Salz",
  );
  await expect(page.getByLabel("Zubereitung")).toHaveValue("Zutaten mischen.");
  await expect(page.getByRole("alert")).toContainText("Zutaten-Zuordnung");
  await expect(page.getByRole("alert")).toContainText("Portionszahl prüfen");
  await page.getByLabel("Zutat 2", { exact: true }).fill("2 Prisen Salz");
  expect(saves).toBe(0);
});

test("unsupported recipe pages show a useful error without clearing the draft", async ({
  page,
}) => {
  await page.route("**/api/recipes/import", (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: {
          message:
            "Im heruntergeladenen HTML wurde kein eindeutig erkennbares Rezept gefunden.",
        },
      },
    }),
  );
  await openImport(page);
  await page.getByLabel("Rezeptname").fill("Mein Entwurf");
  await page.getByLabel("Zutaten aus deinem Rezept").fill("1 Prise Salz");
  await page.getByRole("button", { name: "Vorschau laden" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "kein eindeutig erkennbares Rezept",
  );
  await expect(page.getByLabel("Rezeptname")).toHaveValue("Mein Entwurf");
  await expect(page.getByLabel("Zutaten aus deinem Rezept")).toHaveValue(
    "1 Prise Salz",
  );
  await expect(page.getByLabel("Rezept von URL übernehmen")).toHaveValue(
    source,
  );
});

test("piece yields require a deliberate portion count instead of silently saving the default", async ({
  page,
}) => {
  await page.route("**/api/recipes/import", (route) =>
    route.fulfill({
      json: {
        title: "Testpancakes",
        ingredients: ["100 g Mehl"],
        instructions: "Mischen.",
        servings: null,
        original_yield: "12 / 12 Pancakes",
        source_url: source,
        warnings: [
          "Portionszahl nicht eindeutig erkannt (Quellangabe: 12 / 12 Pancakes); bitte vor dem Speichern prüfen.",
        ],
      },
    }),
  );
  await page.route("**/api/ingredients/analyze", (route) =>
    route.fulfill({
      json: {
        ingredients: [
          {
            line: "100 g Mehl",
            matches: [],
            needs_review: true,
            normalized_name: "Mehl",
          },
        ],
      },
    }),
  );
  await openImport(page);
  await page.getByRole("button", { name: "Vorschau laden" }).click();
  const portions = page.getByLabel("Portionen", { exact: true });
  await expect(portions).toHaveValue("");
  await expect(page.getByRole("alert")).toContainText("12 Pancakes");
  expect(await portions.evaluate((node) => node.checkValidity())).toBe(false);
  await portions.fill("4");
  expect(await portions.evaluate((node) => node.checkValidity())).toBe(true);
});
