import { test, expect, E2E_PASSPHRASE } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
const headers = { "X-Diary-Request": "1" };

test("a missing profile opens the setup wizard, while setup can be deferred and resumed", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/diary")).json();
  try {
    const reset = {
      ...original.profile,
      display_name: "",
      onboarding_completed: false,
    };
    expect(
      (await request.put("/api/profile", { headers, data: reset })).ok(),
    ).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Einfach starten" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Für wen ist das Tagebuch?" }),
    ).toBeFocused();
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Schritt 1 von 3",
    );
    expect(
      await page
        .locator(".setup-progress > span")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0.24s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".setup-progress > span")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await page.getByRole("link", { name: "Später einrichten" }).click();
    await expect(page).toHaveURL(/\/?setup=later$/);
    await expect(page.locator(".setup-nudge")).toBeVisible();
    await page.locator(".setup-nudge").click();
    await expect(page).toHaveURL(/\/onboarding$/);
  } finally {
    expect(
      (
        await request.put("/api/profile", { headers, data: original.profile })
      ).ok(),
    ).toBeTruthy();
  }
});

test("setup suggests an editable pseudonym without requiring a real name", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/diary")).json();
  try {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: {
            ...original.profile,
            display_name: "",
            onboarding_completed: false,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/onboarding");
    const name = page.getByLabel("Pseudonym");
    const first = await name.inputValue();
    expect(first).toMatch(/\d{2}$/u);
    await page
      .getByRole("button", { name: "Neues Pseudonym erstellen" })
      .click();
    await expect(name).not.toHaveValue(first);
    await expect(
      page.getByText("Du brauchst keinen echten Namen.", { exact: false }),
    ).toBeVisible();
  } finally {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: original.profile,
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test("profile explains the encrypted vault and its local-only limits", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(
    page
      .getByLabel("Datenschutzinformationen")
      .getByText("Pseudonym und verschlüsseltes Tagebuch"),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Datenschutzinformationen")
      .getByText(/verschlüsselten Tresor/u),
  ).toBeVisible();
  await page
    .getByLabel("Datenschutzinformationen")
    .getByText("Was das schützt – und was nicht")
    .click();
  await expect(
    page
      .getByLabel("Datenschutzinformationen")
      .getByText(/keine Konto-Anmeldung/u),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Datenschutzinformationen")
      .getByText(/Ein Pseudonym ist keine Anonymität/u),
  ).toBeVisible();
  await expect(
    page.getByText(/Änderungen werden verschlüsselt im Tresor/u),
  ).toBeVisible();
});

test("profile downloads a generic encrypted backup without diary text", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/diary")).json();
  const sentinel = `BACKUP-PRIVATE-${Date.now()}`;
  try {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: { ...original.profile, display_name: sentinel },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/profile");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Sicherung herunterladen" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^gutfeeling-encrypted-backup-\d{4}-\d{2}-\d{2}\.json$/u,
    );
    const contents = await readFile(await download.path(), "utf8");
    const backup = JSON.parse(contents);
    const serverVault = await (await request.get("/api/vault")).json();
    expect(backup.format).toBe("gutfeeling-encrypted-vault");
    expect(backup.envelope).toEqual(serverVault.envelope);
    expect(contents).not.toContain(sentinel);
    expect(contents).not.toContain(E2E_PASSPHRASE);
  } finally {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: original.profile,
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test("onboarding explains pseudonym and encryption without interrupting setup", async ({
  page,
}) => {
  await page.goto("/onboarding");
  const privacy = page.getByLabel("Datenschutzinformationen");
  await expect(privacy).toBeVisible();
  await expect(
    privacy.getByText(/Anzeigename und deine Einträge/u),
  ).toBeVisible();
  await expect(
    privacy.getByText("Was das schützt – und was nicht"),
  ).toBeVisible();
  await expect(page.locator("dialog, [aria-modal=true]")).toHaveCount(0);
});

test("diary sentinel is absent from Inertia page props and the stored vault envelope", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/diary")).json();
  const sentinel = `PRIVATE-SENTINEL-${Date.now()}-not-for-server`;
  try {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: { ...original.profile, display_name: sentinel },
        })
      ).ok(),
    ).toBeTruthy();

    const response = await page.goto("/profile");
    const html = await response.text();
    expect(html).not.toContain(sentinel);
    const vault = await (await request.get("/api/vault")).json();
    expect(JSON.stringify(vault)).not.toContain(sentinel);
    expect(vault.envelope?.payload?.ciphertext).toBeTruthy();
  } finally {
    expect(
      (
        await request.put("/api/profile", {
          headers,
          data: original.profile,
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test("guided setup persists a named person, preserves diary records and survives a new browser context", async ({
  page,
  request,
  browser,
}) => {
  const original = await (await request.get("/api/diary")).json();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/onboarding");
    await page.getByLabel("Pseudonym").fill("  Testperson Léa  ");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Was sollen wir berücksichtigen?" }),
    ).toBeFocused();
    await page.getByLabel("Körperkontext").selectOption("female");
    await page.getByLabel("Zyklus berücksichtigen").check();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(page.getByText("Alles bereit, Testperson Léa.")).toBeVisible();
    await page.route("**/api/vault", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Test: Speichern vorübergehend nicht möglich." },
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Profil anlegen und starten" })
      .click();
    await expect(page.locator("form [role=alert]")).toContainText(
      "vorübergehend",
    );
    await expect(
      page.getByRole("button", { name: "Profil anlegen und starten" }),
    ).toBeEnabled();
    await page.unroute("**/api/vault");
    await page
      .getByRole("button", { name: "Profil anlegen und starten" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".setup-nudge")).toHaveCount(0);
    const saved = await (await request.get("/api/diary")).json();
    expect(saved.profile).toMatchObject({
      display_name: "Testperson Léa",
      onboarding_completed: true,
      body_group: "female",
      cycle_tracking: true,
    });
    for (const key of [
      "recipes",
      "meals",
      "checkins",
      "stools",
      "recipe_flags",
      "stress_observations",
    ])
      expect(saved[key]).toEqual(original[key]);
    const context = await browser.newContext();
    try {
      const freshPage = await context.newPage();
      await freshPage.goto(new URL("/profile", page.url()).href);
      await freshPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
      await freshPage
        .getByRole("button", { name: "Tagebuch entsperren" })
        .click();
      await expect(freshPage.locator(".vault-lock-button")).toBeVisible();
      await expect(freshPage.getByLabel("Pseudonym")).toHaveValue(
        "Testperson Léa",
      );
      await freshPage.getByLabel("Pseudonym").fill("Testperson Alex");
      await freshPage.getByRole("button", { name: "Profil speichern" }).click();
      await expect(
        freshPage.locator(".profile-settings [role=status]"),
      ).toContainText("Profil gespeichert");
      await freshPage.reload();
      await freshPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
      await freshPage
        .getByRole("button", { name: "Tagebuch entsperren" })
        .click();
      await expect(freshPage.locator(".vault-lock-button")).toBeVisible();
      await expect(freshPage.getByLabel("Pseudonym")).toHaveValue(
        "Testperson Alex",
      );
      await freshPage.goto(new URL("/profile", page.url()).href);
      await freshPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
      await freshPage
        .getByRole("button", { name: "Tagebuch entsperren" })
        .click();
      await expect(freshPage.locator(".vault-lock-button")).toBeVisible();
      await freshPage
        .getByRole("link", { name: "Profil-Assistent öffnen" })
        .click();
      await expect(freshPage).toHaveURL(/\/onboarding\?edit=1$/);
      await expect(freshPage.getByLabel("Pseudonym")).toHaveValue(
        "Testperson Alex",
      );
      await freshPage.goto(new URL("/report", page.url()).href);
      await freshPage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
      await freshPage
        .getByRole("button", { name: "Tagebuch entsperren" })
        .click();
      await expect(freshPage.locator(".vault-lock-button")).toBeVisible();
      await expect(freshPage.locator("#patient-report")).toContainText(
        "Testperson Alex",
      );
    } finally {
      await context.close();
    }
  } finally {
    expect(
      (
        await request.put("/api/profile", { headers, data: original.profile })
      ).ok(),
    ).toBeTruthy();
  }
});

test("invalid profile updates cannot erase the saved person", async ({
  request,
}) => {
  const original = (await (await request.get("/api/diary")).json()).profile;
  for (const display_name of ["", "x".repeat(81), "Line\nbreak"]) {
    const response = await request.put("/api/profile", {
      headers,
      data: { ...original, display_name, onboarding_completed: true },
    });
    expect(response.status()).toBe(422);
  }
  expect((await (await request.get("/api/diary")).json()).profile).toEqual(
    original,
  );
});
