import {
  test,
  expect,
  E2E_ACCOUNT_PASSWORD,
  E2E_ACCOUNT_USERNAME,
  E2E_PASSPHRASE,
} from "./fixtures.js";

test("account recovery restores sign-in without changing the vault keys", async ({
  page,
  browser,
  baseURL,
}) => {
  const appBaseURL = baseURL || process.env.APP_TEST_URL || "http://localhost:3001";
  const replacementPassword = "Recovered-Account-Password-2026!";
  const recoveryContext = await browser.newContext();
  try {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sicherheit" }).click();
    await page
      .getByRole("button", { name: "Wiederherstellungscode erstellen oder ersetzen" })
      .click();
    const recoveryCode = await page
      .getByTestId("account-recovery-code")
      .textContent();
    expect(recoveryCode.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const confirmationForm = page.locator(".account-recovery-confirm-form");
    await confirmationForm
      .getByLabel("Code zur Bestätigung erneut eingeben")
      .fill(recoveryCode.trim());
    await confirmationForm
      .getByLabel("Aktuelles Kontopasswort")
      .fill(E2E_ACCOUNT_PASSWORD);
    await confirmationForm.getByRole("button", { name: "Code speichern" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Wiederherstellungscode eingerichtet",
    );
    await expect(page.getByTestId("account-recovery-code")).toHaveCount(0);

    const recoveryPage = await recoveryContext.newPage();
    await recoveryPage.goto(new URL("/login", appBaseURL).href);
    await recoveryPage.getByLabel("Benutzername").fill(E2E_ACCOUNT_USERNAME);
    await recoveryPage.getByText("Kontopasswort vergessen?", { exact: true }).click();
    await recoveryPage
      .getByRole("button", { name: "Mit Wiederherstellungscode zurücksetzen" })
      .click();
    await recoveryPage.getByLabel("Wiederherstellungscode").fill(recoveryCode.trim());
    const newPasswordFields = recoveryPage.locator(
      '.account-recovery-note input[autocomplete="new-password"]',
    );
    await newPasswordFields.nth(0).fill(replacementPassword);
    await newPasswordFields.nth(1).fill(replacementPassword);
    await recoveryPage
      .getByRole("button", { name: "Passwort zurücksetzen" })
      .click();
    await expect(recoveryPage.getByRole("status")).toContainText(
      "Zum Öffnen brauchst du weiterhin deine Tresor-Passphrase",
    );

    // Reset only grants access to ciphertext: sign-in still leads to the vault gate.
    await recoveryPage.getByLabel("Kontopasswort").fill(replacementPassword);
    await recoveryPage.getByRole("button", { name: "Anmelden" }).click();
    await expect(recoveryPage).toHaveURL(new URL("/", appBaseURL).href);
    await recoveryPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await recoveryPage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(recoveryPage.locator(".app-shell")).toBeVisible();

    // Restore the fixture credential so the disposable account stays reusable.
    const restorePassword = await recoveryPage.request.put(
      new URL("/api/auth/password", appBaseURL).href,
      {
        headers: { "X-Diary-Request": "1" },
        data: {
          current_password: replacementPassword,
          new_password: E2E_ACCOUNT_PASSWORD,
        },
      },
    );
    expect(restorePassword.ok()).toBeTruthy();
  } finally {
    await recoveryContext.close();
  }
});
