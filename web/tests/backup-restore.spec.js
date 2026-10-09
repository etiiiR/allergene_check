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

    const nextPassphrase = "GutFeeling!Neue!Passphrase2026";
    await restorePage.getByRole("button", { name: "Sicherheit" }).click();
    await restorePage
      .getByRole("textbox", { name: "Neue Passphrase mindestens 12 Zeichen" })
      .fill(nextPassphrase);
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
