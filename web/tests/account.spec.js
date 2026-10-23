import { test, expect, E2E_ACCOUNT_PASSWORD, E2E_ACCOUNT_USERNAME, E2E_PASSPHRASE } from "./fixtures.js";

test("a second device signs in before it can fetch or unlock the encrypted vault", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const appBaseURL = baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", appBaseURL).href);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Auf deinen Tresor zugreifen" })).toBeVisible();
    await page.getByText("Kontopasswort vergessen?", { exact: true }).click();
    await expect(page.getByText(/keine Selbstbedienungs-Wiederherstellung/u)).toBeVisible();
    await expect(page.getByText(/brauchst du weiterhin deine Tresor-Passphrase/u)).toBeVisible();

    const privateVault = await context.request.get(new URL("/api/vault", appBaseURL).href);
    expect(privateVault.status()).toBe(401);

    await page.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await page.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(new URL("/", appBaseURL).href);
    await expect(page.getByRole("heading", { name: "Tagebuch entsperren" })).toBeVisible();

    await page.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await page.getByRole("button", { name: "Tagebuch entsperren" }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("revoking other devices preserves this session and locks the revoked browser", async ({
  page,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const appBaseURL = baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  try {
    const otherPage = await context.newPage();
    await otherPage.goto(new URL("/", appBaseURL).href);
    await otherPage.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await otherPage.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await otherPage.getByRole("button", { name: "Anmelden" }).click();
    await expect(otherPage).toHaveURL(new URL("/", appBaseURL).href);
    expect((await context.request.get(new URL("/api/vault", appBaseURL).href)).status()).toBe(200);

    await page.goto("/profile");
    await page.getByRole("button", { name: "Sicherheit" }).click();
    await page.getByRole("button", { name: "Andere Geräte abmelden" }).click();
    await expect(page.getByRole("status")).toContainText(/\d+ weitere Anmeldungen? abgemeldet/u);

    expect((await page.request.get(new URL("/api/vault", appBaseURL).href)).status()).toBe(200);
    expect((await context.request.get(new URL("/api/vault", appBaseURL).href)).status()).toBe(401);
    await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(otherPage).toHaveURL(/\/login$/);
    await expect(otherPage.getByRole("heading", { name: "Auf deinen Tresor zugreifen" })).toBeVisible();
  } finally {
    await context.close();
  }
});
