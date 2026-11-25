import {
  test,
  expect,
  E2E_ACCOUNT_PASSWORD,
  E2E_ACCOUNT_USERNAME,
} from "./fixtures.js";

test("account deletion asks for deliberate confirmation and exits the profile", async ({
  page,
}) => {
  const baseURL = process.env.APP_TEST_URL || "http://localhost:3001";
  const freshSession = await page
    .context()
    .request.post(new URL("/api/auth/login", baseURL).href, {
      headers: { "X-Diary-Request": "1" },
      data: {
        username: E2E_ACCOUNT_USERNAME,
        password: E2E_ACCOUNT_PASSWORD,
      },
    });
  expect(freshSession.ok()).toBeTruthy();

  await page.goto("/profile");
  await page.getByRole("button", { name: "Sicherheit" }).click();

  const deletionForm = page.locator(".account-delete-form");
  await expect(
    page.getByRole("heading", { name: "Konto und Tagebuch löschen" }),
  ).toBeVisible();
  const deletionPassword = deletionForm.getByLabel(
    "Kontopasswort zur Löschung",
  );
  await deletionPassword.fill(E2E_ACCOUNT_PASSWORD);
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
