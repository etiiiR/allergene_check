import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  E2E_PASSPHRASE,
  createEncryptedDiaryRequest,
  createAccountRequestContext,
  signInBrowserContext,
} from "./fixtures.js";

const restoreURL = process.env.RESTORE_TEST_URL;
const headers = { "X-Diary-Request": "1" };

test("new vault setup can generate a local passphrase without sending it to the server", async ({
  browser,
}) => {
  test.skip(
    !restoreURL,
    "Set RESTORE_TEST_URL to a second app backed by a fresh disposable test database.",
  );
  const context = await browser.newContext();
  await signInBrowserContext(context, restoreURL);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: restoreURL,
  });
  const page = await context.newPage();
  const outgoingBodies = [];
  page.on("request", (request) => {
    const body = request.postData();
    if (body) outgoingBodies.push(body);
  });
  try {
    await page.goto(new URL("/", restoreURL).href);
    await expect(
      page.getByRole("heading", { name: "Dein Tagebuch bleibt bei dir" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Sichere Passphrase erstellen" })
      .click();
    await expect(page.getByRole("status")).toContainText("Passphrase erstellt");
    let generated = await page.evaluate(() => navigator.clipboard.readText());
    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    const passphrase = page.getByLabel("Neue Passphrase mindestens 12 Zeichen");
    await expect(passphrase).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Passphrase anzeigen" }).click();
    await expect(passphrase).toHaveAttribute("type", "text");
    await expect(passphrase).toHaveValue(generated);
    await page.getByRole("button", { name: "Passphrase verbergen" }).click();
    await passphrase.fill("An individually chosen long passphrase");
    await expect(
      page.getByRole("button", { name: "Passphrase anzeigen" }),
    ).toHaveCount(0);
    await expect(page.getByText(/Zufällige Passphrase erstellt/u)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Sichere Passphrase erstellen" })
      .click();
    generated = await page.evaluate(() => navigator.clipboard.readText());
    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    await page.getByLabel("Passphrase wiederholen").fill(generated);
    await page
      .getByRole("button", { name: "Verschlüsselten Tresor einrichten" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wiederherstellung sichern" }),
    ).toBeVisible();
    expect(outgoingBodies.join("\n")).not.toContain(generated);
    const vault = await (
      await context.request.get(new URL("/api/vault", restoreURL).href)
    ).json();
    expect(vault.revision).toBe(0);
    expect(vault.envelope).toBeNull();
  } finally {
    await context.close();
  }
});

test("encrypted backup restores in a fresh vault through the UI", async ({
  browser,
  playwright,
  baseURL,
}) => {
  test.skip(
    !restoreURL,
    "Set RESTORE_TEST_URL to a second app backed by a fresh disposable test database.",
  );

  const sourceAPI = await createEncryptedDiaryRequest({ playwright, baseURL });
  const sourceOriginal = await (await sourceAPI.get("/api/diary")).json();
  const sentinel = "RESTORE-PRIVATE-" + Date.now();
  const sourceContext = await browser.newContext();
  const restoreContext = await browser.newContext();
  await restoreContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: restoreURL,
  });
  let verifyPassphraseContext;
  let verifyRecoveryContext;
  const rawRestoreAPI = await createAccountRequestContext({
    playwright,
    baseURL: restoreURL,
  });

  try {
    const sourceUpdate = await sourceAPI.put("/api/profile", {
      headers,
      data: {
        ...sourceOriginal.profile,
        display_name: sentinel,
        onboarding_completed: true,
      },
    });
    expect(sourceUpdate.ok()).toBeTruthy();

    const sourcePage = await sourceContext.newPage();
    await signInBrowserContext(sourceContext, baseURL);
    await sourcePage.goto(new URL("/profile", baseURL).href);
    await sourcePage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await sourcePage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(sourcePage.getByLabel("Pseudonym")).toHaveValue(sentinel);

    const downloadPromise = sourcePage.waitForEvent("download");
    await sourcePage
      .getByRole("button", { name: "Sicherung herunterladen" })
      .click();
    const download = await downloadPromise;
    const backupBytes = await readFile(await download.path());

    const emptyVaultResponse = await rawRestoreAPI.get("/api/vault");
    expect(emptyVaultResponse.ok()).toBeTruthy();
    const emptyVault = await emptyVaultResponse.json();
    expect(emptyVault.revision).toBe(0);
    expect(emptyVault.envelope).toBeNull();
    expect(Boolean(emptyVault.legacy_available)).toBe(false);

    const restorePage = await restoreContext.newPage();
    await signInBrowserContext(restoreContext, restoreURL);
    await restorePage.goto(new URL("/profile", restoreURL).href);
    await expect(
      restorePage.getByRole("heading", {
        name: "Dein Tagebuch bleibt bei dir",
      }),
    ).toBeVisible();
    const restoreForm = restorePage.locator(".vault-backup-restore");
    await restoreForm
      .getByText("Verschlüsselte Sicherung wiederherstellen", { exact: true })
      .click();
    await restoreForm.getByLabel("Sicherungsdatei").setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer: backupBytes,
    });
    await restoreForm.getByLabel("Passphrase").fill("wrong restore phrase");
    await restoreForm
      .getByRole("button", { name: "Sicherung prüfen & wiederherstellen" })
      .click();
    await expect(restorePage.getByRole("alert")).toContainText(
      "Passphrase",
    );
    const unchanged = await (await rawRestoreAPI.get("/api/vault")).json();
    expect(unchanged).toMatchObject({ revision: 0, envelope: null });

    await restoreForm.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await restoreForm
      .getByRole("button", { name: "Sicherung prüfen & wiederherstellen" })
      .click();
    await expect(restorePage.getByLabel("Pseudonym")).toHaveValue(sentinel);
    const restored = await (await rawRestoreAPI.get("/api/vault")).json();
    expect(restored.revision).toBe(1);
    expect(restored.envelope).toBeTruthy();
    expect(JSON.stringify(restored.envelope)).not.toContain(sentinel);

    await restorePage.getByRole("button", { name: "Sicherheit" }).click();
    await restorePage
      .getByRole("button", { name: "Sichere Passphrase erstellen" })
      .click();
    await expect(restorePage.getByRole("status")).toContainText(
      "Passphrase erstellt",
    );
    let nextPassphrase = await restorePage.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(nextPassphrase).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    await restorePage
      .getByLabel("Neue Passphrase mindestens 12 Zeichen")
      .fill("Another individually chosen long passphrase");
    await expect(
      restorePage.getByRole("button", { name: "Passphrase anzeigen" }),
    ).toHaveCount(0);
    await expect(
      restorePage.getByText(/Zufällige Passphrase erstellt/u),
    ).toHaveCount(0);
    await restorePage
      .getByRole("button", { name: "Sichere Passphrase erstellen" })
      .click();
    nextPassphrase = await restorePage.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(nextPassphrase).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    await restorePage
      .getByLabel("Neue Passphrase wiederholen")
      .fill(nextPassphrase);
    await restorePage
      .getByRole("button", { name: "Zugangsdaten vorbereiten" })
      .click();
    const newRecoveryKey = await restorePage
      .locator(".vault-recovery-key")
      .textContent();
    expect(newRecoveryKey).toBeTruthy();
    const recoveryConfirmation = restorePage.getByLabel(
      "Wiederherstellungsphrase zur Bestätigung erneut eingeben",
    );
    const saveRotatedVault = restorePage.getByRole("button", {
      name: "Tresor mit neuen Daten speichern",
    });
    await recoveryConfirmation.fill("not the recovery phrase");
    await expect(saveRotatedVault).toBeDisabled();
    expect((await (await rawRestoreAPI.get("/api/vault")).json()).revision).toBe(1);
    await recoveryConfirmation.fill(newRecoveryKey.trim());
    await expect(saveRotatedVault).toBeEnabled();
    await saveRotatedVault.click();
    await expect(restorePage.getByRole("status")).toContainText(
      "mit den neuen Zugangsdaten verschlüsselt",
    );

    const rotated = await (await rawRestoreAPI.get("/api/vault")).json();
    expect(rotated.revision).toBe(2);
    expect(JSON.stringify(rotated.envelope)).not.toContain(sentinel);

    verifyPassphraseContext = await browser.newContext();
    await signInBrowserContext(verifyPassphraseContext, restoreURL);
    const verifyPassphrasePage = await verifyPassphraseContext.newPage();
    await verifyPassphrasePage.goto(new URL("/profile", restoreURL).href);
    await verifyPassphrasePage.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
    await verifyPassphrasePage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(verifyPassphrasePage.getByRole("alert")).toContainText(
      "ungültig",
    );
    await verifyPassphrasePage
      .getByLabel("Passphrase")
      .fill(nextPassphrase);
    await verifyPassphrasePage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(verifyPassphrasePage.getByLabel("Pseudonym")).toHaveValue(
      sentinel,
    );

    verifyRecoveryContext = await browser.newContext();
    await signInBrowserContext(verifyRecoveryContext, restoreURL);
    const verifyRecoveryPage = await verifyRecoveryContext.newPage();
    await verifyRecoveryPage.goto(new URL("/profile", restoreURL).href);
    await verifyRecoveryPage
      .getByRole("button", { name: "Mit Wiederherstellungsphrase öffnen" })
      .click();
    await verifyRecoveryPage
      .getByLabel("Wiederherstellungsphrase")
      .fill(newRecoveryKey.trim());
    await verifyRecoveryPage
      .getByRole("button", { name: "Tagebuch entsperren" })
      .click();
    await expect(verifyRecoveryPage.getByLabel("Pseudonym")).toHaveValue(
      sentinel,
    );
  } finally {
    await Promise.all(
      [
        sourceContext.close(),
        restoreContext.close(),
        verifyPassphraseContext?.close(),
        verifyRecoveryContext?.close(),
      ].filter(Boolean),
    );
    await rawRestoreAPI.dispose();
    const reset = await sourceAPI.put("/api/profile", {
      headers,
      data: sourceOriginal.profile,
    });
    expect(reset.ok()).toBeTruthy();
    await sourceAPI.dispose();
  }
});
