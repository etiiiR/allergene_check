import { test, expect, E2E_ACCOUNT_PASSWORD, E2E_ACCOUNT_USERNAME, E2E_PASSPHRASE } from "./fixtures.js";

test("a second device signs in before it can fetch or unlock the encrypted vault", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", baseURL).href);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Auf deinen Tresor zugreifen" })).toBeVisible();

    const privateVault = await context.request.get(new URL("/api/vault", baseURL).href);
    expect(privateVault.status()).toBe(401);

    await page.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await page.getByLabel("Kontopasswort").fill(E2E_ACCOUNT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(new URL("/", baseURL).href);
    await expect(page.getByRole("heading", { name: "Dein Tagebuch bleibt bei dir" })).toBeVisible();

    await page.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await page.getByRole("button", { name: "Tagebuch entsperren" }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
  } finally {
    await context.close();
  }
});
