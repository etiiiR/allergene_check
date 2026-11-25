import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { applyDiaryRequest } from "../web/src/privacy/client-diary-api.js";
import { createEncryptedVault, unlockWithPassphrase } from "../web/src/privacy/vault-crypto.js";

// Only run against the fresh, disposable Compose demo documented in README.md.
const port = process.env.GUTFEELING_DEMO_PORT || "3020";
assert(["3020", "3021"].includes(port), "Use a dedicated demo port (3020 or 3021).");
const origin = `http://localhost:${port}`;
const setupToken = process.env.ACCOUNT_SETUP_TOKEN;
assert.equal(process.env.ALLOW_DEMO_SEED, "1", "Confirm this is the isolated demo.");
assert(setupToken, "Supply the disposable instance's account setup token.");
const screens = fileURLToPath(new URL("./public/screens/", import.meta.url));
const passphrase = "Demo vault phrase for GutFeeling screenshots";
const diary = {
  profile: { display_name: "Demo", onboarding_completed: true, body_group: "unspecified" },
  recipes: [], meals: [], checkins: [], recipe_flags: [], stools: [], stress_observations: [],
};
const post = (path, body) => applyDiaryRequest(diary, path, "POST", body).result;
const createRecipe = (title, lines) =>
  post("/recipes", { title, servings: 2, ingredients: lines.map((text) => ({
    text, food_ids: [], allergens: [],
  })) });
const bowls = [
  createRecipe("Reisbowl mit Zwiebeln", ["200 g Reis", "1 Zwiebel", "2 Karotten"]),
  createRecipe("Kartoffeln mit Kräutern", ["300 g Kartoffeln", "1 TL Petersilie", "1 Prise Salz"]),
  createRecipe("Karottenreis", ["200 g Reis", "2 Karotten", "1 Prise Salz"]),
  createRecipe("Zwiebel-Kartoffel-Pfanne", ["300 g Kartoffeln", "1 Zwiebel", "1 Prise Salz"]),
];
const now = new Date();
for (let i = 23; i >= 0; i--) {
  const recipe = bowls[i % bowls.length];
  const when = new Date(now);
  when.setDate(when.getDate() - i);
  when.setHours(12, 15, 0, 0);
  when.setTime(Math.min(when.getTime(), now.getTime() - 4 * 3600_000));
  const meal = post("/meals", { occurred_at: when.toISOString(), portions: 1, recipe_id: recipe.id });
  if (i === 2 || i === 4) continue;
  const symptoms = i % 6 < (i % 2 ? 3 : 1);
  post("/checkins", {
    occurred_at: new Date(when.getTime() + 3 * 3600_000).toISOString(),
    symptom_free: !symptoms,
    symptoms: symptoms ? { bloating: 7, pain: 4 } : {},
    timing_bucket: "mid",
    reference_meal_id: meal.id,
    context_recorded: true,
    stress: 3 + (i % 5),
    sleep_hours: 7,
  });
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 760 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    timezoneId: "Europe/Zurich",
  });
  const status = await context.request.get("/api/auth/status");
  assert(status.ok(), "The isolated instance must be running.");
  const { configured } = await status.json();
  const headers = { "X-Diary-Request": "1" };
  const account = await context.request.post(configured ? "/api/auth/login" : "/api/auth/register", {
    headers,
    data: {
      ...(!configured && { setup_token: setupToken }),
      username: "screens-demo",
      password: "Only for the isolated screenshots 2026",
    },
  });
  assert(account.ok(), `Could not sign in to the demo (${account.status()}).`);
  if (configured) {
    const existing = await context.request.get("/api/vault");
    assert(existing.ok(), "Could not check the existing screenshot vault.");
    const { revision, envelope } = await existing.json();
    assert.equal(revision, 1, "Use a fresh demo or the unchanged screenshot vault.");
    const { diary: existingDiary } = await unlockWithPassphrase(envelope, passphrase);
    assert.equal(existingDiary.profile?.display_name, "Demo");
    assert.deepEqual(existingDiary.recipes.map(recipe => recipe.title), bowls.map(recipe => recipe.title));
  } else {
    const { envelope } = await createEncryptedVault(diary, passphrase);
    const saved = await context.request.put("/api/vault", {
      headers,
      data: { expected_revision: 0, envelope },
    });
    assert(saved.ok(), `Demo vault save failed (${saved.status()}).`);
  }

  await mkdir(screens, { recursive: true });
  const page = await context.newPage();
  const shot = async (name, locator = page) => {
    await page.evaluate(() => document.fonts.ready);
    await locator.screenshot({ path: `${screens}${name}.png`, animations: "disabled" });
  };
  const open = async (path) => {
    await page.goto(path);
    await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
    await page.getByRole("button", { name: "Tagebuch entsperren" }).click();
    await page.locator("main#main-content").waitFor();
  };
  await page.goto("/");
  await page.getByRole("heading", { name: "Tagebuch entsperren" }).waitFor();
  await shot("vault");
  await open("/");
  await shot("today");
  await page.getByRole("button", { name: "Mahlzeit eintragen", exact: true }).click();
  await page.getByRole("button", { name: "Neues Rezept direkt hinzufügen" }).waitFor();
  await shot("meal");
  await open("/");
  await page.getByRole("button", { name: "Befinden", exact: true }).click();
  await page.getByRole("button", { name: "Blähungen", exact: true }).click();
  await page.getByRole("radio", { name: "Blähungen: Mittel" }).click();
  await shot("symptom");
  await open("/recipes");
  await page.getByRole("button", { name: "Rezept hinzufügen", exact: true }).click();
  await page.getByLabel("Rezeptname").fill("Zitronenreis");
  await page.getByLabel("Zutaten aus deinem Rezept").fill("200 g Reis\n1 Zitrone\n1 Prise Salz");
  await page.getByRole("button", { name: "Zutaten erkennen" }).click();
  await page.getByLabel("Zutat 1", { exact: true }).waitFor();
  await page.locator(".recipe-source-import").evaluate(el => {
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -80);
  });
  await shot("recipe");
  await open("/calendar");
  await shot("calendar");
  await page.setViewportSize({ width: 1180, height: 900 });
  await open("/insights");
  await shot("pattern", page.locator(".pattern-card").first());
  await open("/report");
  const report = page.locator(".patient-report");
  await report.waitFor();
  await report.evaluate(el => {
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -80);
  });
  await page.evaluate(() => document.fonts.ready);
  const { x, y, width, height } = await report.boundingBox();
  await page.screenshot({
    path: `${screens}report.png`,
    clip: { x, y: Math.max(y, 0), width, height: Math.min(height, 540) },
    animations: "disabled",
  });
} finally {
  await browser.close();
}
