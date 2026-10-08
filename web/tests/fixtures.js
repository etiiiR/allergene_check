import { test as base, expect } from "@playwright/test";
import { applyDiaryRequest } from "../src/privacy/client-diary-api.js";
import {
  encryptVaultPayload,
  unlockWithPassphrase,
} from "../src/privacy/vault-crypto.js";
import { E2E_PASSPHRASE } from "./e2e-constants.js";

export { expect };
export { E2E_PASSPHRASE };

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
        try { return waiter.predicate(response); } catch { return false; }
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
        const gate = document.querySelector(".vault-gate");
        const input = gate?.querySelector('input[autocomplete="current-password"]');
        if (!input || gate.dataset.e2eUnlockStarted) return;
        gate.dataset.e2eUnlockStarted = "true";
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, passphrase);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.form?.requestSubmit();
      };
      const observer = new MutationObserver(attemptUnlock);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", attemptUnlock, { once: true });
      attemptUnlock();
    }, E2E_PASSPHRASE);

    const actualWaitForResponse = page.waitForResponse.bind(page);
    page.waitForResponse = (predicate, options = {}) => {
      if (typeof predicate !== "function") return actualWaitForResponse(predicate, options);
      const match = queued.findIndex((response) => {
        try { return predicate(response); } catch { return false; }
      });
      if (match >= 0) return Promise.resolve(queued.splice(match, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for a local encrypted-vault operation."));
        }, options.timeout || 30000);
        waiters.push(waiter);
      });
    };

    const actualGoto = page.goto.bind(page);
    page.goto = async (...args) => {
      const response = await actualGoto(...args);
      await page.locator(".vault-lock-button").waitFor({ state: "visible", timeout: 20000 });
      return response;
    };
    const actualReload = page.reload.bind(page);
    page.reload = async (...args) => {
      const response = await actualReload(...args);
      await page.locator(".vault-lock-button").waitFor({ state: "visible", timeout: 20000 });
      return response;
    };
    await use(page);
    waiters.forEach((waiter) => clearTimeout(waiter.timer));
  },

  request: async ({ playwright, page, baseURL }, use) => {
    const raw = await playwright.request.newContext({ baseURL });
    async function readVaultDiary() {
      const response = await raw.get("/api/vault");
      if (!response.ok()) throw new Error(`Vault read failed: ${response.status()}`);
      const vault = await response.json();
      if (!vault.envelope) throw new Error("The isolated browser-test vault is not initialized.");
      return { vault, ...(await unlockWithPassphrase(vault.envelope, E2E_PASSPHRASE)) };
    }
    async function updateDiary(path, method, body) {
      const { vault, dataKey, diary } = await readVaultDiary();
      let result;
      try {
        result = applyDiaryRequest(diary, path.replace(/^\/api/u, ""), method, body, new Date());
      } catch (error) {
        return { error, status: error.status || 422 };
      }
      if (result.changed !== false) {
        const envelope = { ...vault.envelope, payload: await encryptVaultPayload(dataKey, result.diary) };
        const saved = await raw.put("/api/vault", {
          headers: { "X-Diary-Request": "1" },
          data: { expected_revision: vault.revision, envelope },
        });
        if (!saved.ok()) throw new Error(`Encrypted fixture save failed: ${saved.status()}`);
        if (page.url() !== "about:blank") {
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
        const result = await updateDiary(path, "POST", options.data);
        if (result?.error) return localResponse(`${baseURL}${path}`, "POST", { error: { message: result.error.message } }, result.status);
        return localResponse(`${baseURL}${path}`, "POST", result, 201);
      },
      put: async (path, options = {}) => {
        const result = await updateDiary(path, "PUT", options.data);
        if (result?.error) return localResponse(`${baseURL}${path}`, "PUT", { error: { message: result.error.message } }, result.status);
        return localResponse(`${baseURL}${path}`, "PUT", result);
      },
      delete: async (path, options = {}) => {
        const result = await updateDiary(path, "DELETE", options.data);
        if (result?.error) return localResponse(`${baseURL}${path}`, "DELETE", { error: { message: result.error.message } }, result.status);
        return localResponse(`${baseURL}${path}`, "DELETE", result, 204);
      },
    };
    await use(wrapped);
    await raw.dispose();
  },
});
