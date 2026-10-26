import { test, expect } from "./fixtures.js";

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
      page.getByRole("heading", { name: "Dein Tag, im Überblick." }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Rezepte", exact: true }).click();
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
    await page.getByRole("button", { name: "Mahlzeit speichern" }).click();
    const mealResult = await mealResponse;
    expect(mealResult.ok()).toBeTruthy();
    const savedMeal = await mealResult.json();
    ids.push(["meals", savedMeal.id]);
    if (savedMeal.checkin) ids.push(["checkins", savedMeal.checkin.id]);
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
    await page.getByRole("link", { name: "Tagebuch", exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("button", { name: "Check-in", exact: true }).click();
    await page
      .getByRole("button", { name: /Zu diesem Zeitpunkt geht es gut/ })
      .click();
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
    await page.getByRole("link", { name: "Muster", exact: true }).click();
    await expect(
      page.getByText("Für den Mehrfaktorenvergleich fehlen noch Einträge."),
    ).toBeVisible();
    await expect(page.getByText("Ab „Sehr leicht“ (ab 1 Stern)")).toBeVisible();
    await expect(page.getByText("Ab 3 von 10")).toHaveCount(0);
    await page.getByRole("link", { name: "Rezepte", exact: true }).click();
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name }) })
      .getByRole("button", { name: "Details und Verträglichkeit ansehen" })
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
    await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
    await page.getByRole("link", { name: "FODMAP", exact: true }).click();
    await page.getByLabel("Lebensmittel suchen").fill("zwiebel");
    await expect(
      page.getByRole("cell", { name: "Onion", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Dein Tag, im Überblick." }),
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

test("symptom check-in records its timing window", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Befinden", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Blähungen", exact: true }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Stärke bei Blähungen" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("radiogroup", { name: "Stärke bei Blähungen" })
      .getByRole("radio"),
  ).toHaveCount(6);
  await expect(
    page.locator(".symptom-rating-control .symptom-rating-star"),
  ).toHaveCount(5);
  await expect(
    page.locator(".symptom-rating-control .symptom-rating-symptom-icon"),
  ).toHaveText("🎈");
  await expect(
    page.getByRole("radio", { name: "Blähungen: Leicht" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Blähungen: Keine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Übelkeit", exact: true }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Stärke bei Übelkeit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Übelkeit: Mittel" }).click();
  await expect(
    page.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Blähungen: Leicht" }).click();
  await expect(
    page.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeEnabled();
  await page.getByRole("radio", { name: "Blähungen: Sehr stark" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.locator(".entry-recap")).toContainText("Blähungen");
  await expect(page.locator(".entry-recap")).toContainText("Übelkeit");
  await expect(page.locator(".timing-shared-note")).toBeVisible();
  await page.getByRole("button", { name: /Später/ }).click();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/checkins") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Eintrag speichern" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const checkin = await response.json();
  expect(checkin.timing_bucket).toBe("mid");
  expect(checkin.symptoms.bloating).toBe(10);
  expect(checkin.symptoms.nausea).toBe(7);
  expect(checkin.stress).toBeNull();
  expect(checkin.sleep_hours).toBeNull();
  expect(checkin.context_recorded).toBe(false);

  const cleanup = await request.delete("/api/checkins/" + checkin.id, {
    headers: { "X-Diary-Request": "1" },
  });
  expect(cleanup.ok()).toBeTruthy();
});

test("a check-in can stay outside the food comparison despite a nearby meal", async ({
  page,
  request,
}) => {
  const created = [];
  const recipeResponse = await request.post("/api/recipes", {
    headers: { "X-Diary-Request": "1" },
    data: {
      title: "No-food-link UI test",
      servings: 1,
      ingredients: [{ text: "Zwiebel", food_ids: ["onion"], allergens: [] }],
    },
  });
  expect(recipeResponse.ok()).toBeTruthy();
  const recipe = await recipeResponse.json();
  created.push(["recipes", recipe.id]);

  try {
    const mealResponse = await request.post("/api/meals", {
      headers: { "X-Diary-Request": "1" },
      data: {
        recipe_id: recipe.id,
        occurred_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        portions: 1,
      },
    });
    expect(mealResponse.ok()).toBeTruthy();
    const meal = await mealResponse.json();
    created.push(["meals", meal.id]);

    await page.goto("/");
    await page.getByRole("button", { name: "Befinden", exact: true }).click();
    await page.getByRole("button", { name: "Blähungen", exact: true }).click();
    await page.getByRole("radio", { name: "Blähungen: Mittel" }).click();
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await page.getByRole("button", { name: "Keine Mahlzeit zuordnen" }).click();
    await expect(page.locator(".timing-choice-grid")).toHaveCount(0);
    await expect(page.locator(".food-relation-note")).toContainText(
      "keine Mahlzeiten oder Zutaten verglichen",
    );

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkins") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Eintrag speichern" }).click();
    const checkinResponse = await responsePromise;
    expect(checkinResponse.ok()).toBeTruthy();
    const checkin = await checkinResponse.json();
    created.push(["checkins", checkin.id]);
    expect(checkin.food_relation).toBe("none");
    expect(checkin.timing_bucket).toBe("unknown");
    expect(checkin.reference_meal_id).toBe("");
  } finally {
    for (const [kind, id] of created.reverse()) {
      const response = await request.delete(`/api/${kind}/${id}`, {
        headers: { "X-Diary-Request": "1" },
      });
      expect(response.ok()).toBeTruthy();
    }
  }
});

test("profile keeps cycle tracking in its separate context", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/diary")).json();
  try {
    await page.goto("/profile");
    await page
      .getByRole("button", { name: "Körper & Zyklus", exact: true })
      .click();
    await page.getByLabel("Körperkontext").selectOption("female");
    await page.getByLabel("Zyklus in Check-ins berücksichtigen").check();
    await page.getByLabel("Beginn der letzten Periode").fill("2026-09-01");
    await page.getByLabel("Übliche Zykluslänge").fill("28");
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/profile") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Profil speichern" }).click();
    expect((await responsePromise).ok()).toBeTruthy();
    await expect(page.locator(".profile-settings [role=status]")).toContainText(
      "Profil gespeichert",
    );
    const saved = await (await request.get("/api/diary")).json();
    expect(saved.profile.body_group).toBe("female");
    expect(saved.profile.cycle_tracking).toBeTruthy();
  } finally {
    const restore = await request.put("/api/profile", {
      headers: { "X-Diary-Request": "1" },
      data: original.profile,
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test("recipe flags and next-day stool observation feed the diary", async ({
  page,
  request,
}) => {
  const created = [];
  const name = "Flag browser test " + Date.now();
  const headers = { "X-Diary-Request": "1" };
  try {
    const recipeResponse = await request.post("/api/recipes", {
      headers,
      data: {
        title: name,
        servings: 2,
        instructions: "",
        ingredients: [
          { text: "1 Zwiebel", food_ids: ["onion"], allergens: [] },
        ],
      },
    });
    expect(recipeResponse.ok()).toBeTruthy();
    const recipe = await recipeResponse.json();
    created.push(["recipes", recipe.id]);

    const mealResponse = await request.post("/api/meals", {
      headers,
      data: {
        recipe_id: recipe.id,
        occurred_at: new Date(Date.now() - 3600000).toISOString(),
        portions: 1,
        notes: "",
      },
    });
    expect(mealResponse.ok()).toBeTruthy();
    const meal = await mealResponse.json();
    created.push(["meals", meal.id]);

    await page.goto("/recipes");
    const card = page.locator("article").filter({ hasText: name });
    await card
      .locator("summary", { hasText: "Bearbeiten & weitere Optionen" })
      .click();
    await card.getByRole("button", { name: "Verdächtig markieren" }).click();
    const suspectedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/recipe-flags") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Verdacht speichern" }).click();
    const suspected = await (await suspectedResponse).json();
    created.push(["recipe_flags", suspected.id]);

    await card.getByRole("button", { name: "Reaktion markieren" }).click();
    await page.getByLabel("Zugehörige Mahlzeit").selectOption(meal.id);
    await page.getByRole("button", { name: "Durchfall", exact: true }).click();
    await expect(
      page.getByRole("radiogroup", { name: "Stärke bei Durchfall" }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Durchfall: Sehr stark" }).click();
    const reactionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/recipe-flags") &&
        response.request().method() === "POST",
    );
    await page
      .locator("form.flag-form")
      .getByRole("button", { name: "Reaktion markieren" })
      .click();
    const reaction = await (await reactionResponse).json();
    expect(reaction.severity).toBe(10);
    expect(reaction.symptoms.diarrhea).toBe(10);
    created.push(["recipe_flags", reaction.id]);

    await page.goto("/diary");
    await page.getByRole("button", { name: "Stuhl", exact: true }).click();
    await page.getByRole("button", { name: "Wässrig" }).click();
    const stoolResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/stools") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Beobachtung speichern" }).click();
    const stool = await (await stoolResponse).json();
    expect(stool.quality).toBe("watery");
    created.push(["stools", stool.id]);
  } finally {
    for (const [kind, id] of created.reverse()) {
      const response = await request.delete("/api/" + kind + "/" + id, {
        headers,
      });
      expect(response.ok()).toBeTruthy();
    }
  }
});

test("profile imports normalized wearable stress data", async ({
  page,
  request,
}) => {
  const externalID = "browser-health-" + Date.now();
  let stressID = "";
  const payload = {
    source: "generic",
    records: [
      {
        external_id: externalID,
        metric: "stress_score",
        value: 64,
        unit: "percent",
        normalized_stress: 6.4,
        observed_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
  };
  try {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Health", exact: true }).click();
    await page
      .getByText("Datei-Import für andere Quellen (optional)", { exact: true })
      .click();
    await page
      .getByLabel("Quelle der Gesundheitsdaten")
      .selectOption("generic");
    await page.locator('input[type="file"]').setInputFiles({
      name: "health.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(payload)),
    });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/health/import") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Health-Daten importieren" })
      .click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const imported = await response.json();
    expect(imported.imported).toBe(1);
    expect(imported.records[0].normalized_stress).toBe(6.4);
    stressID = imported.records[0].id;
    await expect(page.locator(".profile-settings [role=status]")).toContainText(
      "1 neu importiert",
    );

    const second = await request.post("/api/health/import", {
      headers: { "X-Diary-Request": "1" },
      data: payload,
    });
    expect(second.ok()).toBeTruthy();
    expect((await second.json()).updated).toBe(1);
  } finally {
    if (stressID) {
      const cleanup = await request.delete("/api/stress/" + stressID, {
        headers: { "X-Diary-Request": "1" },
      });
      expect(cleanup.ok()).toBeTruthy();
    }
  }
});

test("dashboard saves a manual stress score", async ({ page, request }) => {
  let stressID = "";
  try {
    await page.goto("/");
    await page.getByText("Weitere Beobachtungen", { exact: true }).click();
    await page.getByRole("button", { name: "Stress manuell" }).click();
    await expect(
      page.getByRole("button", { name: "Stress speichern" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Hoch" }).click();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/stress") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Stress speichern" }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const saved = await response.json();
    expect(saved.source).toBe("generic");
    expect(saved.metric).toBe("stress_score");
    expect(saved.normalized_stress).toBe(9);
    stressID = saved.id;
    await page.goto("/insights");
    await page.locator(".insight-details > summary").click();
    await expect(
      page.getByRole("heading", { name: "Stress & Health-Daten" }),
    ).toBeVisible();
  } finally {
    if (stressID) {
      const cleanup = await request.delete("/api/stress/" + stressID, {
        headers: { "X-Diary-Request": "1" },
      });
      expect(cleanup.ok()).toBeTruthy();
    }
  }
});

test("doctor report renders a printable full-data overview", async ({
  page,
}) => {
  await page.goto("/report");
  await expect(
    page.getByRole("heading", { name: "Zusammenfassung für das Arztgespräch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Drucken / PDF" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Teilen / senden" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Enthält Symptome und weitere Gesundheitsdaten. Prüfe vor dem Teilen den Empfänger.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Zutatenmuster" }),
  ).toBeVisible();
});

test("calendar shows an open follow-up and lets me add a good check-in", async ({
  page,
  request,
}) => {
  const ids = [];
  const headers = { "X-Diary-Request": "1" };
  const name = "Kalender test " + Date.now();
  try {
    const diaryResponse = await request.get("/api/diary");
    expect(diaryResponse.ok()).toBeTruthy();
    const diary = await diaryResponse.json();
    const localKey = (date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const checkinDays = new Set(
      (diary.checkins || []).map((item) =>
        localKey(new Date(item.occurred_at)),
      ),
    );
    const now = new Date();
    let mealAt = null;
    for (let daysAgo = 1; daysAgo <= 180 && !mealAt; daysAgo += 1) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() - daysAgo);
      candidate.setHours(12, 0, 0, 0);
      if (!checkinDays.has(localKey(candidate))) mealAt = candidate;
    }
    expect(mealAt).not.toBeNull();

    const recipeResponse = await request.post("/api/recipes", {
      headers,
      data: {
        title: name,
        servings: 1,
        ingredients: [{ text: "Karotte", food_ids: ["carrot"], allergens: [] }],
      },
    });
    expect(recipeResponse.ok()).toBeTruthy();
    const recipe = await recipeResponse.json();
    ids.push(["recipes", recipe.id]);

    const mealResponse = await request.post("/api/meals", {
      headers,
      data: {
        recipe_id: recipe.id,
        occurred_at: mealAt.toISOString(),
        portions: 1,
      },
    });
    expect(mealResponse.ok()).toBeTruthy();
    const meal = await mealResponse.json();
    ids.push(["meals", meal.id]);

    await page.goto("/calendar");
    await expect(
      page.getByRole("heading", { name: "Dein Kalender" }),
    ).toBeVisible();
    const monthDifference =
      (mealAt.getFullYear() - now.getFullYear()) * 12 +
      mealAt.getMonth() -
      now.getMonth();
    const monthButton =
      monthDifference < 0 ? "Vorheriger Monat" : "Nächster Monat";
    for (let index = 0; index < Math.abs(monthDifference); index += 1) {
      await page.getByRole("button", { name: monthButton }).click();
    }
    const dateLabel = new Intl.DateTimeFormat("de-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(mealAt);
    await page.getByRole("button", { name: new RegExp(dateLabel) }).click();
    await expect(
      page
        .locator(".selected-day-panel")
        .getByText("Befinden offen", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: "Gutes Befinden", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wie geht es deinem Bauch?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Zu diesem Zeitpunkt geht es gut/ })
      .click();
    const checkResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkins") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Eintrag speichern" }).click();
    const checkin = await (await checkResponse).json();
    expect(checkin.symptom_free).toBeTruthy();
    ids.push(["checkins", checkin.id]);
  } finally {
    for (const [kind, id] of ids.reverse()) {
      const cleanup = await request.delete(`/api/${kind}/${id}`, { headers });
      expect(cleanup.ok()).toBeTruthy();
    }
  }
});
