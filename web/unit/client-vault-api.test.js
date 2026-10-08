import test from "node:test";
import assert from "node:assert/strict";
import { clientVaultApi } from "../src/privacy/client-vault-api.js";
import {
  commitPreparedVault,
  loadVaultSession,
  lockVaultSession,
  prepareVault,
  vaultSessionState,
} from "../src/privacy/vault-session.js";

const originalFetch = globalThis.fetch;
const passphrase = "Kiesel!Wolke!Abendlicht";

async function withVault(run) {
  const calls = [];
  const server = { revision: 0, envelope: null };
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, "/api/vault");
    calls.push({ method: options.method || "GET", body: options.body });
    if (!options.method || options.method === "GET") {
      return new Response(JSON.stringify(server), { status: 200 });
    }
    const body = JSON.parse(options.body);
    if (body.expected_revision !== server.revision) {
      return new Response(JSON.stringify({ error: { message: "revision conflict" } }), { status: 409 });
    }
    server.revision += 1;
    server.envelope = body.envelope;
    return new Response(JSON.stringify(server), { status: 200 });
  };
  try {
    lockVaultSession();
    await loadVaultSession();
    await commitPreparedVault(await prepareVault({
      profile: { display_name: "Local Person", body_group: "unspecified", cycle_tracking: false },
      recipes: [], meals: [], checkins: [], recipe_flags: [], stools: [], stress_observations: [],
    }, passphrase));
    await run({ calls, server });
  } finally {
    lockVaultSession();
    globalThis.fetch = originalFetch;
  }
}

test("personal create/edit and analysis requests use the encrypted browser vault", async () => {
  await withVault(async ({ calls }) => {
    const recipe = await clientVaultApi("/recipes", {
      method: "POST",
      body: JSON.stringify({
        title: "Zitronenreis",
        servings: 2,
        ingredients: [{ text: "1 tsp cumin", food_ids: ["cumin"], allergens: [] }],
      }),
    });
    await clientVaultApi("/meals", {
      method: "POST",
      body: JSON.stringify({ recipe_id: recipe.id, occurred_at: new Date().toISOString(), portions: 1, record_good_moment: true }),
    });
    const ingredients = await clientVaultApi("/ingredients/analyze", {
      method: "POST",
      body: JSON.stringify({ lines: ["1 Prise Salz"] }),
    });
    assert.equal(ingredients.ingredients[0].normalized_name, "Salz");
    const patterns = await clientVaultApi("/patterns?symptom=any&hours=8", { method: "GET" });
    assert.equal(patterns.observations, 0);
    assert.equal(vaultSessionState.diary.meals.length, 1);
    assert.equal(vaultSessionState.diary.checkins.length, 1);
    const wire = calls.filter((call) => call.method === "PUT").map((call) => call.body).join("\n");
    assert.ok(!wire.includes("Zitronenreis"));
    assert.ok(!wire.includes("1 tsp cumin"));
  });
});

test("personal reads fail closed while locked", async () => {
  lockVaultSession();
  await assert.rejects(clientVaultApi("/patterns"), /entsperre zuerst/u);
});
