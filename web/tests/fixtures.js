import { test as base, expect } from "@playwright/test";
import { applyDiaryRequest } from "../src/privacy/client-diary-api.js";
import {
  encryptVaultPayload,
  unlockWithPassphrase,
} from "../src/privacy/vault-crypto.js";
import {
  E2E_ACCOUNT_PASSWORD,
  E2E_ACCOUNT_USERNAME,
  E2E_PASSPHRASE,
} from "./e2e-constants.js";

export { expect };
export { E2E_ACCOUNT_PASSWORD, E2E_ACCOUNT_USERNAME };
export { E2E_PASSPHRASE };
const testSessionCookies = new Map();
const resolvedTestURL = (value) =>
  value || process.env.APP_TEST_URL || "http://localhost:3001";

function readSessionCookie(value, baseURL) {
  const [pair] = (value || "").split(";", 1);
  const separator = pair?.indexOf("=") ?? -1;
  if (separator < 1) return null;
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    domain: new URL(resolvedTestURL(baseURL)).hostname,
    path: "/",
    httpOnly: true,
    secure: new URL(resolvedTestURL(baseURL)).protocol === "https:",
    sameSite: "Strict",
    // Playwright requires an explicit numeric expiry for cookies restored
    // through storageState; -1 keeps the account session cookie non-persistent.
    expires: -1,
  };
}

async function signInRequestContext(raw, baseURL) {
  const origin = new URL(baseURL).origin;
  const cached = testSessionCookies.get(origin);
  if (cached) {
    await raw.dispose();
    return null;
  }
  const response = await raw.post("/api/auth/login", {
    headers: { "X-Diary-Request": "1" },
    data: {
      username: E2E_ACCOUNT_USERNAME,
      password: E2E_ACCOUNT_PASSWORD,
    },
  });
  if (!response.ok()) {
    throw new Error(`Could not sign in to the isolated test app: ${response.status()}`);
  }
  const cookie = readSessionCookie(response.headers()["set-cookie"], baseURL);
  if (!cookie) throw new Error("The isolated test app did not issue a session cookie.");
  testSessionCookies.set(origin, cookie);
  return cookie;
}

export async function signInBrowserContext(context, baseURL) {
  baseURL = resolvedTestURL(baseURL);
  const cached = testSessionCookies.get(new URL(baseURL).origin);
  if (cached) {
    await context.addCookies([cached]);
    return;
  }
  const response = await context.request.post(
    new URL("/api/auth/login", baseURL).href,
    {
      headers: { "X-Diary-Request": "1" },
      data: {
        username: E2E_ACCOUNT_USERNAME,
        password: E2E_ACCOUNT_PASSWORD,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`Could not sign in to the isolated browser context: ${response.status()}`);
  }
  const cookie = readSessionCookie(response.headers()["set-cookie"], baseURL);
  if (!cookie) throw new Error("The isolated browser app did not issue a session cookie.");
  testSessionCookies.set(new URL(baseURL).origin, cookie);
}

export async function createAccountRequestContext({ playwright, baseURL }) {
  baseURL = resolvedTestURL(baseURL);
  const origin = new URL(baseURL).origin;
  const cached = testSessionCookies.get(origin);
  if (cached) {
    return playwright.request.newContext({
      baseURL,
      storageState: { cookies: [cached], origins: [] },
    });
  }
  const raw = await playwright.request.newContext({ baseURL });
  try {
    await signInRequestContext(raw, baseURL);
    return raw;
  } catch (error) {
    await raw.dispose();
    throw error;
  }
}

function localResponse(url, method, result, status = 200) {
  return {
    url: () => url,
    request: () => ({ method: () => method }),
    ok: () => status >= 200 && status < 400,
    status: () => status,
    json: async () => result,
    text: async () => JSON.stringify(result),
    headers: () => ({}),
  };
}

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await signInBrowserContext(page.context(), baseURL);
    const waiters = [];
    const queued = [];
    const notify = (detail) => {
      const response = localResponse(
        `${baseURL || "http://localhost:3001"}${detail.path}`,
        detail.method,
        detail.result,
        detail.status || 200,
      );
      const index = waiters.findIndex((waiter) => {
        try {
          return waiter.predicate(response);
        } catch {
          return false;
        }
      });
      if (index >= 0) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(response);
      } else queued.push(response);
    };

    await page.exposeFunction("__gutfeelingE2EApiEvent", notify);
    await page.addInitScript((passphrase) => {
      window.addEventListener("gutfeeling:e2e-api", (event) => {
        window.__gutfeelingE2EApiEvent?.(event.detail);
      });
      const attemptUnlock = () => {
        if (window.__gutfeelingDisableE2EAutoUnlock) return;
        const gate = document.querySelector(".vault-gate");
        const input = gate?.querySelector(
          'input[autocomplete="current-password"]',
        );
        if (!input || gate.dataset.e2eUnlockStarted) return;
        gate.dataset.e2eUnlockStarted = "true";
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(input, passphrase);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.form?.requestSubmit();
      };
      const observer = new MutationObserver(attemptUnlock);
      const observePage = () => {
        const root = document.documentElement;
        if (!root) return;
        observer.observe(root, { childList: true, subtree: true });
        attemptUnlock();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", observePage, {
          once: true,
        });
      } else {
        observePage();
      }
    }, E2E_PASSPHRASE);

    const actualWaitForResponse = page.waitForResponse.bind(page);
    page.waitForResponse = (predicate, options = {}) => {
      if (typeof predicate !== "function")
        return actualWaitForResponse(predicate, options);
      const match = queued.findIndex((response) => {
        try {
          return predicate(response);
        } catch {
          return false;
        }
      });
      if (match >= 0) return Promise.resolve(queued.splice(match, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(
            new Error(
              "Timed out waiting for a local encrypted-vault operation.",
            ),
          );
        }, options.timeout || 30000);
        waiters.push(waiter);
      });
    };

    const actualGoto = page.goto.bind(page);
    const waitForVaultLock = async () => {
      const width = page.viewportSize()?.width ?? 1280;
      await page
        .locator(
          width >= 1024
            ? ".sidebar-lock-button"
            : ".header-lock-button",
        )
        .waitFor({ state: "visible", timeout: 20000 });
    };
    page.goto = async (...args) => {
      const response = await actualGoto(...args);
      await waitForVaultLock();
      return response;
    };
    const actualReload = page.reload.bind(page);
    page.reload = async (...args) => {
      const response = await actualReload(...args);
      await waitForVaultLock();
      return response;
    };
    await use(page);
    waiters.forEach((waiter) => clearTimeout(waiter.timer));
  },

  request: async ({ playwright, page, baseURL }, use) => {
    const wrapped = await createEncryptedDiaryRequest({
      playwright,
      page,
      baseURL,
    });
    try {
      await use(wrapped);
    } finally {
      await wrapped.dispose();
    }
  },
});

// beforeAll/afterAll hooks cannot consume Playwright's per-test page/request
// fixtures. This worker-safe helper gives those hooks the same encrypted-diary
// API without binding its lifetime to a browser page.
export async function createEncryptedDiaryRequest({
  playwright,
  baseURL,
  page = null,
}) {
  const raw = await createAccountRequestContext({ playwright, baseURL });
  let writes = Promise.resolve();
  async function readVaultDiary() {
    const response = await raw.get("/api/vault");
    if (!response.ok())
      throw new Error(`Vault read failed: ${response.status()}`);
    const vault = await response.json();
    if (!vault.envelope)
      throw new Error("The isolated browser-test vault is not initialized.");
    return {
      vault,
      ...(await unlockWithPassphrase(vault.envelope, E2E_PASSPHRASE)),
    };
  }
  async function updateDiary(path, method, body) {
    const operation = writes.then(() => performDiaryUpdate(path, method, body));
    writes = operation.catch(() => {});
    return operation;
  }
  async function performDiaryUpdate(path, method, body) {
    const { vault, dataKey, diary } = await readVaultDiary();
    let result;
    try {
      result = applyDiaryRequest(
        diary,
        path.replace(/^\/api/u, ""),
        method,
        body,
        new Date(),
      );
    } catch (error) {
      return { error, status: error.status || 422 };
    }
    if (result.changed !== false) {
      const envelope = {
        ...vault.envelope,
        payload: await encryptVaultPayload(dataKey, result.diary),
      };
      const saved = await raw.put("/api/vault", {
        headers: { "X-Diary-Request": "1" },
        data: { expected_revision: vault.revision, envelope },
      });
      if (!saved.ok())
        throw new Error(`Encrypted fixture save failed: ${saved.status()}`);
      if (page && page.url() !== "about:blank") {
        await page.reload();
      }
    }
    return result.result;
  }
  const wrapped = {
    get: async (path, options = {}) => {
      if (path === "/api/diary") {
        const { diary } = await readVaultDiary();
        return localResponse(`${baseURL}${path}`, "GET", diary);
      }
      return raw.get(path, options);
    },
    post: async (path, options = {}) => {
      if (path === "/api/recipes/import") return raw.post(path, options);
      if (!hasDiaryRequestHeader(options.headers)) {
        return forbiddenDiaryResponse(baseURL, path, "POST");
      }
      const result = await updateDiary(path, "POST", options.data);
      if (result?.error)
        return localResponse(
          `${baseURL}${path}`,
          "POST",
          { error: { message: result.error.message } },
          result.status,
        );
      return localResponse(`${baseURL}${path}`, "POST", result, 201);
    },
    put: async (path, options = {}) => {
      if (!hasDiaryRequestHeader(options.headers)) {
        return forbiddenDiaryResponse(baseURL, path, "PUT");
      }
      const result = await updateDiary(path, "PUT", options.data);
      if (result?.error)
        return localResponse(
          `${baseURL}${path}`,
          "PUT",
          { error: { message: result.error.message } },
          result.status,
        );
      return localResponse(`${baseURL}${path}`, "PUT", result);
    },
    delete: async (path, options = {}) => {
      if (!hasDiaryRequestHeader(options.headers)) {
        return forbiddenDiaryResponse(baseURL, path, "DELETE");
      }
      const result = await updateDiary(path, "DELETE", options.data);
      if (result?.error)
        return localResponse(
          `${baseURL}${path}`,
          "DELETE",
          { error: { message: result.error.message } },
          result.status,
        );
      return localResponse(`${baseURL}${path}`, "DELETE", result, 204);
    },
  };
  return {
    ...wrapped,
    dispose: () => raw.dispose(),
  };
}

function hasDiaryRequestHeader(headers = {}) {
  return (headers["X-Diary-Request"] ?? headers["x-diary-request"]) === "1";
}

function forbiddenDiaryResponse(baseURL, path, method) {
  return localResponse(
    `${baseURL}${path}`,
    method,
    { error: { message: "Der Tagebuch-Request wurde nicht freigegeben." } },
    403,
  );
}
