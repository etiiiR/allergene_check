import {
  createEncryptedVault,
  encryptVaultPayload,
  unlockWithPassphrase,
} from "../src/privacy/vault-crypto.js";
import { E2E_PASSPHRASE } from "./e2e-constants.js";

const appURL = process.env.APP_TEST_URL || "http://localhost:3001";

async function jsonRequest(path, options) {
  const response = await fetch(new URL(path, appURL), options);
  let body;
  try { body = await response.json(); } catch {}
  return { response, body };
}

function emptyDiary() {
  return {
    profile: {
      display_name: "Testperson UX",
      onboarding_completed: true,
      body_group: "unspecified",
      cycle_tracking: false,
      cycle_length_days: 28,
      period_start: "",
    },
    recipes: [], meals: [], checkins: [], recipe_flags: [], stools: [], stress_observations: [],
  };
}

export default async function globalSetup() {
  if (process.env.ALLOW_E2E_VAULT_MUTATION !== "1") {
    throw new Error(
      "Playwright seeds and updates an encrypted vault. Set ALLOW_E2E_VAULT_MUTATION=1 only for a dedicated test database.",
    );
  }
  const parsedURL = new URL(appURL);
  if (parsedURL.port === "3000") {
    throw new Error(
      "Playwright must use an isolated app/database, never the personal app on port 3000. Set APP_TEST_URL (for example http://localhost:3001).",
    );
  }

  const { response: vaultResponse, body: vault } = await jsonRequest("/api/vault");
  if (!vaultResponse.ok) throw new Error(`Could not load isolated test vault: ${vaultResponse.status}`);

  let diary;
  let dataKey;
  if (vault.envelope) {
    try {
      ({ diary, dataKey } = await unlockWithPassphrase(vault.envelope, E2E_PASSPHRASE));
    } catch {
      throw new Error("The isolated test vault exists but does not use the Playwright test passphrase. Reset only the dedicated test database.");
    }
  } else if (vault.legacy_available) {
    const { response: legacyResponse, body: legacy } = await jsonRequest("/api/legacy/diary", {
      headers: { "X-Encrypted-Migration": "1" },
    });
    if (!legacyResponse.ok) throw new Error(`Could not migrate isolated test diary: ${legacyResponse.status}`);
    diary = legacy;
  } else {
    diary = emptyDiary();
  }

  diary.profile ||= emptyDiary().profile;
  diary.profile.display_name = "Testperson UX";
  diary.profile.onboarding_completed = true;

  let envelope;
  if (vault.envelope) {
    envelope = { ...vault.envelope, payload: await encryptVaultPayload(dataKey, diary) };
  } else {
    const prepared = await createEncryptedVault(diary, E2E_PASSPHRASE);
    envelope = prepared.envelope;
  }

  const { response: saveResponse } = await jsonRequest("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Diary-Request": "1" },
    body: JSON.stringify({
      expected_revision: vault.revision,
      migrate_legacy: Boolean(vault.legacy_available),
      envelope,
    }),
  });
  if (!saveResponse.ok) throw new Error(`Could not seed isolated encrypted test vault: ${saveResponse.status}`);
}
