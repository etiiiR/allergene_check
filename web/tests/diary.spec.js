import { test, expect } from "@playwright/test";

test("recipe → meal → symptom-free check-in → patterns; persistence and cleanup", async ({
  page,
  request,
}) => {
  const ids = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Browser test " + Date.now();
  const api = async (path, data) => {
    const r = await request.post("/api" + path, {
      headers: { "X-Diary-Request": "1" },
      data,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  try {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Hör auf dein Bauchgefühl." }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Meine Rezepte", exact: true })
      .click();
    await page.getByRole("button", { name: "Rezept hinzufügen" }).click();
    await page.getByLabel("Rezeptname").fill(name);
    await page
      .getByLabel("Zutaten aus deinem Rezept")
      .fill("1 Zwiebel\n2 TL Kreuzkümmel");
    await page.getByRole("button", { name: "Zutaten erkennen" }).click();
    await expect(page.getByLabel("Zutat 1", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Lebensmittel-Zuordnung").first()).toHaveValue(
      "onion",
    );
    await expect(page.getByLabel("Lebensmittel-Zuordnung").nth(1)).toHaveValue(
      "cumin",
    );
    const recipeResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/recipes") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Rezept speichern", exact: true })
      .click();
    const recipeResult = await recipeResponse;
    expect(recipeResult.ok()).toBeTruthy();
    const recipe = await recipeResult.json();
    ids.push(["recipes", recipe.id]);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const card = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name }) });
    await card.getByRole("button", { name: "Ins Tagebuch eintragen" }).click();
    const mealResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/meals") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Eintrag speichern" }).click();
    const mealResult = await mealResponse;
    expect(mealResult.ok()).toBeTruthy();
    ids.push(["meals", (await mealResult.json()).id]);
    const edit = await request.put("/api/recipes/" + recipe.id, {
      headers: { "X-Diary-Request": "1" },
      data: {
        ...recipe,
        ingredients: [{ text: "Karotte", food_ids: ["carrot"], allergens: [] }],
      },
    });
    expect(edit.ok()).toBeTruthy();
    const persisted = await (await request.get("/api/diary")).json();
    expect(
      persisted.meals.find((m) => m.id === ids[1][1]).ingredients[0].food_ids,
    ).toEqual(["onion"]);
    const restore = await request.put("/api/recipes/" + recipe.id, {
      headers: { "X-Diary-Request": "1" },
      data: recipe,
    });
    expect(restore.ok()).toBeTruthy();
    await page
      .getByRole("link", { name: "Mein Tagebuch", exact: true })
      .click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("button", { name: "Check-in", exact: true }).click();
    await page.getByRole("checkbox", { name: /Mir geht es gut/ }).check();
    const checkResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/checkins") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Eintrag speichern" }).click();
    ids.push(["checkins", (await (await checkResponse).json()).id]);
    await page.getByLabel("Anzeigen").selectOption("free");
    await expect(
      page.getByRole("heading", { name: "Ein gutes Bauchgefühl" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Meine Muster", exact: true }).click();
    await expect(page.getByText("Deine Datenbasis wächst.")).toBeVisible();
    await page
      .getByRole("link", { name: "Meine Rezepte", exact: true })
      .click();
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name }) })
      .getByRole("button", { name: "Verträglichkeit ansehen" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Passt dieses Rezept zu meinen Beobachtungen?",
      }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Noch zu wenig Vergleichsdaten für eine Einschätzung.")
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Schliessen" }).click();
    await page
      .getByRole("link", { name: "FODMAP-Lexikon", exact: true })
      .click();
    await page.getByLabel("Lebensmittel suchen").fill("zwiebel");
    await expect(
      page.getByRole("cell", { name: "Onion", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Hör auf dein Bauchgefühl." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "/private/tmp/bauchgefuehl-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.screenshot({
      path: "/private/tmp/bauchgefuehl-desktop.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    for (const [kind, id] of ids.reverse())
      await request.delete("/api/" + kind + "/" + id, {
        headers: { "X-Diary-Request": "1" },
      });
  }
});
