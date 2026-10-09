import {
  createEncryptedVault,
  encryptVaultPayload,
  unlockWithPassphrase,
} from "../src/privacy/vault-crypto.js";
import {
  E2E_ACCOUNT_PASSWORD,
  E2E_ACCOUNT_USERNAME,
  E2E_PASSPHRASE,
} from "./e2e-constants.js";

const appURL = process.env.APP_TEST_URL || "http://localhost:3001";
let sessionCookie = "";

async function jsonRequest(path, options = {}, targetURL = appURL, cookie = sessionCookie) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(new URL(path, targetURL), { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (targetURL === appURL && setCookie) sessionCookie = setCookie.split(";", 1)[0];
  let body;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function establishTestAccount(targetURL) {
  const { response: statusResponse, body: status } = await jsonRequest(
    "/api/auth/status",
    {},
    targetURL,
    "",
  );
  if (!statusResponse.ok) throw new Error(`Could not inspect isolated test account: ${statusResponse.status}`);
  const setupToken = process.env.ACCOUNT_SETUP_TOKEN;
  const action = status.configured ? "login" : "register";
  if (!status.configured && !setupToken) {
    throw new Error("ACCOUNT_SETUP_TOKEN must be set for the isolated browser-test app.");
  }
  const { response, body } = await jsonRequest(
    `/api/auth/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Diary-Request": "1" },
      body: JSON.stringify({
        ...(status.configured ? {} : { setup_token: setupToken }),
        username: E2E_ACCOUNT_USERNAME,
        password: E2E_ACCOUNT_PASSWORD,
      }),
    },
    targetURL,
    "",
  );
  if (!response.ok) {
    throw new Error(`Could not ${action} the isolated browser-test account: ${response.status} ${body?.error?.message || ""}`);
  }
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie) throw new Error("Test account sign-in did not return a session cookie.");
  if (targetURL === appURL) sessionCookie = cookie;
  return cookie;
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

  await establishTestAccount(appURL);
  if (process.env.RESTORE_TEST_URL) {
    await establishTestAccount(process.env.RESTORE_TEST_URL);
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
