import { test, expect, E2E_ACCOUNT_PASSWORD } from "./fixtures.js";

test("account deletion asks for deliberate confirmation and exits the profile", async ({
  page,
}) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Sicherheit" }).click();

  const deletionForm = page.locator(".account-delete-form");
  await expect(
    page.getByRole("heading", { name: "Konto und Tagebuch löschen" }),
  ).toBeVisible();
  await deletionForm
    .getByLabel("Aktuelles Kontopasswort")
    .fill(E2E_ACCOUNT_PASSWORD);
  await deletionForm
    .getByLabel("Tippe LÖSCHEN zur Bestätigung")
    .fill("LÖSCHEN");

  let deletionRequestObserved = false;
  await page.route("**/api/auth/account", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    const requestBody = route.request().postDataJSON();
    expect(requestBody.confirmation).toBe("LÖSCHEN");
    expect(requestBody.current_password).toBe(E2E_ACCOUNT_PASSWORD);
    deletionRequestObserved = true;
    await route.fulfill({
      status: 204,
      headers: {
        "Set-Cookie":
          "gutfeeling_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
      },
    });
  });

  await deletionForm
    .getByRole("button", { name: "Konto und Tagebuch endgültig löschen" })
    .click();
  await expect(page).toHaveURL(/\/login$/u);
  expect(deletionRequestObserved).toBe(true);
});
