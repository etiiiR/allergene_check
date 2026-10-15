import { analyseDiaryPatterns } from "./diary-analysis.js";
import { analyseIngredientLines, applyDiaryRequest } from "./client-diary-api.js";
import { isVaultUnlocked, transactDiary, vaultSessionState } from "./vault-session.js";

const e2eEventsEnabled = typeof __GUTFEELING_E2E__ !== "undefined" && __GUTFEELING_E2E__;
let publishE2EOperation = () => {};
if (e2eEventsEnabled) {
  publishE2EOperation = (path, method, result, status = 200) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("gutfeeling:e2e-api", {
      detail: { path: `/api${path}`, method, result, status },
    }));
  };
}

function bodyValue(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Die Anfrage enthält keine gültigen Daten.");
  }
}

function requireUnlockedDiary() {
  if (!isVaultUnlocked()) throw new Error("Bitte entsperre zuerst dein Tagebuch.");
  return vaultSessionState.diary;
}

// Personal data routes are deliberately evaluated in this browser module.
// Recipe import is the sole exception: it sends only the URL to the crawler.
export async function clientVaultApi(path, options = {}) {
  const request = new URL(path, "https://local.invalid");
  const method = String(options.method || "GET").toUpperCase();
  if (request.pathname === "/recipes/import" && method === "POST") {
    let response;
    try {
      response = await fetch("/api/recipes/import", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Diary-Request": "1" },
        body: options.body,
      });
    } catch {
      throw new Error("Der Rezeptimport ist gerade nicht erreichbar.");
    }
    if (!response.ok) {
      let result;
      try { result = await response.json(); } catch {}
      throw new Error(result?.error?.message || "Das Rezept konnte nicht importiert werden.");
    }
    const imported = await response.json();
    publishE2EOperation(request.pathname + request.search, method, imported, response.status);
    return imported;
  }

  const diary = requireUnlockedDiary();
  if (request.pathname === "/patterns" && method === "GET") {
    const hours = Number(request.searchParams.get("hours") || 8);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      throw new Error("Zeitfenster muss zwischen 1 und 24 Stunden liegen.");
    }
    const result = analyseDiaryPatterns(diary, {
      symptom: request.searchParams.get("symptom") || "any",
      hours,
      timezone: request.searchParams.get("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich",
    });
    publishE2EOperation(request.pathname + request.search, method, result);
    return result;
  }
  if (request.pathname === "/ingredients/analyze" && method === "POST") {
    const result = analyseIngredientLines(bodyValue(options.body)?.lines);
    publishE2EOperation(request.pathname + request.search, method, result);
    return result;
  }
  if ((request.pathname === "/diary" || request.pathname === "/export") && method === "GET") {
    const result = structuredClone(diary);
    publishE2EOperation(request.pathname + request.search, method, result);
    return result;
  }

  const result = await transactDiary((draft) =>
    applyDiaryRequest(draft, request.pathname, method, bodyValue(options.body)),
  );
  publishE2EOperation(request.pathname + request.search, method, result, method === "DELETE" ? 204 : 200);
  return result;
}
