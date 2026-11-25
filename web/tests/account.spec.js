import {
  test,
  expect,
  E2E_ACCOUNT_PASSWORD,
  E2E_ACCOUNT_USERNAME,
  E2E_PASSPHRASE,
  clearCachedTestSession,
} from "./fixtures.js";

test("a second device signs in before it can fetch or unlock the encrypted vault", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const appBaseURL =
    baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", appBaseURL).href);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Auf deinen Tresor zugreifen" }),
    ).toBeVisible();
    await expect(
      page.getByText(/verschlüsselt das Tagebuch vor der Synchronisierung/u),
    ).toBeVisible();
    const privacyNote = page.getByText("Welche Angaben speichert der Server?");
    await expect(privacyNote).toBeVisible();
    await privacyNote.click();
    await expect(page.getByText(/Hash des Kontopassworts/u)).toBeVisible();
    await expect(
      page.getByText(/kann den Tresor aber nicht entschlüsseln/u),
    ).toBeVisible();
    await expect(
      page.getByText(/IP-Adresse nutzt der App-Server kurzzeitig/u),
    ).toBeVisible();
    await page.getByText("Kontopasswort vergessen?", { exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Mit Wiederherstellungscode zurücksetzen",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/setzt nur die Anmeldung zurück/u),
    ).toBeVisible();

    const privateVault = await context.request.get(
      new URL("/api/vault", appBaseURL).href,
    );
    expect(privateVault.status()).toBe(401);

    await page.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await page.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(new URL("/", appBaseURL).href);
    await expect(
      page.getByRole("heading", { name: "Tagebuch entsperren" }),
    ).toBeVisible();

    await page.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await page.getByRole("button", { name: "Tagebuch entsperren" }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a separately signed-in device unlocks the latest encrypted diary revision", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  const secondDevice = await browser.newContext();
  const secondPage = await secondDevice.newPage();
  const appBaseURL =
    baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  const recipeName = `Cross-device recipe ${Date.now()}`;
  let recipe;

  try {
    await page.goto("/recipes");
    await page.getByRole("button", { name: "Rezept hinzufügen" }).click();
    await page.getByLabel("Rezeptname").fill(recipeName);
    await page.getByRole("button", { name: "Zutat manuell hinzufügen" }).click();
    await page.getByLabel("Zutat 1", { exact: true }).fill("1 Prise Salz");

    const recipeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/recipes") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Rezept speichern", exact: true }).click();
    const saved = await recipeResponse;
    expect(saved.ok()).toBeTruthy();
    recipe = await saved.json();
    const persistedDiary = await request.get("/api/diary");
    expect((await persistedDiary.json()).recipes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: recipe.id })]),
    );

    await secondPage.goto(new URL("/", appBaseURL).href);
    await expect(secondPage).toHaveURL(/\/login$/);
    await secondPage.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await secondPage.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await secondPage.getByRole("button", { name: "Anmelden" }).click();
    await expect(secondPage).toHaveURL(new URL("/", appBaseURL).href);
    const firstVaultResponse = await request.get("/api/vault");
    const secondVaultResponse = await secondDevice.request.get(
      new URL("/api/vault", appBaseURL).href,
    );
    expect(firstVaultResponse.ok()).toBeTruthy();
    expect(secondVaultResponse.ok()).toBeTruthy();
    expect((await secondVaultResponse.json()).revision).toBe(
      (await firstVaultResponse.json()).revision,
    );
    await expect(
      secondPage.getByRole("heading", { name: "Tagebuch entsperren" }),
    ).toBeVisible();

    await secondPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await secondPage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(secondPage.locator(".app-shell")).toBeVisible();
    await secondPage
      .locator(".desktop-sidebar")
      .getByRole("link", { name: "Rezepte", exact: true })
      .click();
    await expect(
      secondPage.getByRole("heading", { name: "Meine Rezepte" }),
    ).toBeVisible();
    await expect(
      secondPage.getByTestId("recipe-card").filter({ hasText: recipeName }),
    ).toBeVisible();
  } finally {
    if (recipe?.id) {
      const cleanup = await request.delete(`/api/recipes/${recipe.id}`, {
        headers: { "X-Diary-Request": "1" },
      });
      expect(cleanup.ok()).toBeTruthy();
    }
    await secondDevice.close();
  }
});

test("revoking other devices preserves this session and locks the revoked browser", async ({
  page,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const appBaseURL =
    baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  try {
    const cleanup = await page.request.delete(
      new URL("/api/auth/sessions/others", appBaseURL).href,
      { headers: { "X-Diary-Request": "1" } },
    );
    expect(cleanup.ok()).toBeTruthy();
    const otherPage = await context.newPage();
    await otherPage.goto(new URL("/", appBaseURL).href);
    await otherPage.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await otherPage.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await otherPage.getByRole("button", { name: "Anmelden" }).click();
    await expect(otherPage).toHaveURL(new URL("/", appBaseURL).href);
    expect(
      (
        await context.request.get(new URL("/api/vault", appBaseURL).href)
      ).status(),
    ).toBe(200);

    await page.goto("/profile");
    await page.getByRole("button", { name: "Sicherheit" }).click();
    await page.getByRole("button", { name: "Andere Geräte abmelden" }).click();
    await expect(page.locator(".alert.success[role='status']")).toContainText(
      /\d+ weitere Anmeldung(?:en)? abgemeldet/u,
    );
    await expect(page.getByText("Anmeldungen werden geladen …")).toHaveCount(0);

    expect(
      (await page.request.get(new URL("/api/vault", appBaseURL).href)).status(),
    ).toBe(200);
    expect(
      (
        await context.request.get(new URL("/api/vault", appBaseURL).href)
      ).status(),
    ).toBe(401);
    await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(otherPage).toHaveURL(/\/login$/);
    await expect(
      otherPage.getByRole("heading", { name: "Auf deinen Tresor zugreifen" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("device inventory can revoke one selected sign-in without affecting this device", async ({
  page,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const appBaseURL =
    baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  try {
    const cleanup = await page.request.delete(
      new URL("/api/auth/sessions/others", appBaseURL).href,
      { headers: { "X-Diary-Request": "1" } },
    );
    expect(cleanup.ok()).toBeTruthy();
    const otherPage = await context.newPage();
    await otherPage.goto(new URL("/", appBaseURL).href);
    await otherPage.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await otherPage.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await otherPage.getByRole("button", { name: "Anmelden" }).click();
    await expect(otherPage).toHaveURL(new URL("/", appBaseURL).href);

    await page.goto("/profile");
    await page.getByRole("button", { name: "Sicherheit" }).click();
    const sessions = page.getByTestId("device-session");
    await expect(sessions).toHaveCount(2);
    await expect(
      sessions.filter({ hasText: "Dieses Gerät · aktuell" }),
    ).toHaveCount(1);
    const target = sessions.filter({ hasText: "Safari auf iPhone / iPad" });
    await expect(target).toBeVisible();
    await target
      .getByRole("button", { name: "Safari auf iPhone / iPad abmelden" })
      .click();
    await expect(sessions).toHaveCount(1);

    expect(
      (await page.request.get(new URL("/api/vault", appBaseURL).href)).status(),
    ).toBe(200);
    expect(
      (
        await context.request.get(new URL("/api/vault", appBaseURL).href)
      ).status(),
    ).toBe(401);
  } finally {
    await context.close();
  }
});

test("signing out locks the diary and browser Back cannot reopen it", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page
    .locator(".desktop-sidebar")
    .getByRole("link", { name: "Profil und Zyklus", exact: true })
    .click();
  await page.getByRole("button", { name: "Sicherheit" }).click();

  await page.getByRole("button", { name: "Dieses Gerät abmelden" }).click();
  clearCachedTestSession(baseURL);
  await expect(page).toHaveURL(/\/login$/u);
  await expect(
    page.getByRole("heading", { name: "Auf deinen Tresor zugreifen" }),
  ).toBeVisible();

  await page.goBack();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect
    .poll(async () => {
      const signIn = await page
        .getByRole("heading", { name: "Auf deinen Tresor zugreifen" })
        .count();
      const unlock = await page
        .getByRole("heading", { name: "Tagebuch entsperren" })
        .count();
      return signIn + unlock;
    })
    .toBe(1);
});
