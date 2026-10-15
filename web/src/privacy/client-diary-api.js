import { extractIngredientLine, foods, ingredientKeys } from "./ingredient-normalizer.js";

const symptomKeys = new Set([
  "bloating",
  "pain",
  "nausea",
  "diarrhea",
  "constipation",
  "reflux",
]);
const allergens = new Set([
  "gluten",
  "milk",
  "egg",
  "peanut",
  "tree_nuts",
  "soy",
  "sesame",
  "mustard",
  "celery",
  "fish",
  "crustaceans",
  "molluscs",
  "lupin",
  "sulphites",
]);
const timingBuckets = new Set(["immediate", "early", "mid", "late", "unknown"]);
const cyclePhases = new Set([
  "menstruation",
  "follicular",
  "ovulation",
  "luteal",
  "unknown",
]);
const recipeFlagKinds = new Set(["suspected", "reaction"]);
const stoolQualities = new Set([
  "formed",
  "hard",
  "soft",
  "watery",
  "mixed",
  "no_stool",
  "unknown",
]);
const healthSources = new Set([
  "apple_healthkit",
  "android_health_connect",
  "oura",
  "ring",
  "watch",
  "generic",
]);
const healthMetrics = new Set([
  "stress_score",
  "hrv",
  "heart_rate",
  "resting_heart_rate",
  "sleep_score",
  "readiness_score",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const utf8Length = (value) => new TextEncoder().encode(value).length;

function invalid(message) {
  const error = new Error(message);
  error.code = "validation_error";
  error.status = 422;
  return error;
}

function notFound() {
  const error = new Error("Dieser Eintrag wurde nicht gefunden. Bitte lade das Tagebuch neu.");
  error.code = "entry_not_found";
  error.status = 404;
  return error;
}

function ensureDiary(diary) {
  if (!diary || typeof diary !== "object" || Array.isArray(diary)) {
    throw invalid("Die Tagebuchdaten sind ungültig.");
  }
  for (const key of [
    "recipes",
    "meals",
    "checkins",
    "recipe_flags",
    "stools",
    "stress_observations",
  ]) {
    if (!Array.isArray(diary[key])) diary[key] = [];
  }
  diary.profile ||= {
    display_name: "",
    onboarding_completed: false,
    body_group: "unspecified",
    cycle_tracking: false,
    cycle_length_days: 28,
    period_start: "",
  };
}

function id() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Dieser Browser kann keine sichere Eintrags-ID erzeugen.");
  }
  return globalThis.crypto.randomUUID();
}

function timeIsValid(value, now) {
  const date = new Date(value);
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 2000 &&
    date.getTime() <= now.getTime() + 5 * 60 * 1000
  );
}

function assertTime(value, now, label = "Zeitpunkt") {
  if (!timeIsValid(value, now)) throw invalid(`${label} ist ungültig.`);
}

function validateSymptoms(symptoms = {}) {
  let total = 0;
  for (const [key, value] of Object.entries(symptoms)) {
    if (!symptomKeys.has(key) || !Number.isInteger(value) || value < 0 || value > 10) {
      throw invalid("Symptome müssen zwischen 0 und 10 liegen.");
    }
    total += value;
  }
  return total;
}

function validateRecipe(recipe) {
  recipe.title = String(recipe.title || "").trim();
  recipe.instructions = String(recipe.instructions || "");
  recipe.source_url = String(recipe.source_url || "");
  if (!recipe.title || utf8Length(recipe.title) > 160) {
    throw invalid("Bitte einen Rezeptnamen mit maximal 160 Zeichen eingeben.");
  }
  if (
    !Number.isInteger(recipe.servings) ||
    recipe.servings < 1 ||
    recipe.servings > 50 ||
    utf8Length(recipe.instructions) > 15000 ||
    utf8Length(recipe.source_url) > 2048
  ) {
    throw invalid("Portionen oder Zubereitung sind ungültig.");
  }
  if (recipe.source_url) {
    let source;
    try {
      source = new URL(recipe.source_url);
    } catch {
      throw invalid("Die Rezeptquelle muss eine gültige HTTP- oder HTTPS-Adresse sein.");
    }
    if (!(["http:", "https:"].includes(source.protocol) && source.hostname && !source.username && !source.password)) {
      throw invalid("Die Rezeptquelle muss eine gültige HTTP- oder HTTPS-Adresse sein.");
    }
  }
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length < 1 || recipe.ingredients.length > 100) {
    throw invalid("Bitte 1 bis 100 Zutaten eingeben.");
  }
  for (const ingredient of recipe.ingredients) {
    ingredient.text = String(ingredient.text || "").trim();
    ingredient.food_ids ||= [];
    ingredient.allergens ||= [];
    if (
      !ingredient.text ||
      utf8Length(ingredient.text) > 500 ||
      !Array.isArray(ingredient.food_ids) ||
      ingredient.food_ids.length > 10 ||
      !Array.isArray(ingredient.allergens) ||
      ingredient.allergens.length > 14
    ) {
      throw invalid("Eine Zutat ist ungültig.");
    }
    if (ingredient.food_ids.some((foodId) => !foods.some((food) => food.id === foodId))) {
      throw invalid("Unbekannte Lebensmittel-Zuordnung.");
    }
    if (ingredient.allergens.some((allergen) => !allergens.has(allergen))) {
      throw invalid("Unbekanntes Allergen.");
    }
  }
  recipe.analysis_ingredient_ids = ingredientKeys(recipe.ingredients);
}

function validateCheckin(check, now) {
  assertTime(check.occurred_at, now);
  if (Object.hasOwn(check, "symptom_free") && typeof check.symptom_free !== "boolean") {
    throw invalid("Bitte eindeutig wählen, ob dieser Moment symptomfrei war.");
  }
  check.notes = String(check.notes || "");
  check.stress = check.stress == null || check.stress === "" ? null : Number(check.stress);
  check.sleep_hours = check.sleep_hours == null || check.sleep_hours === "" ? null : Number(check.sleep_hours);
  if (check.context_recorded != null && typeof check.context_recorded !== "boolean") {
    throw invalid("Der Stress-/Schlafkontext ist ungültig.");
  }
  check.context_recorded = Boolean(
    check.context_recorded && (check.stress !== null || check.sleep_hours !== null),
  );
  check.cycle_day = Number(check.cycle_day || 0);
  if (
    utf8Length(check.notes) > 3000 ||
    (check.stress !== null && (!Number.isInteger(check.stress) || check.stress < 0 || check.stress > 10)) ||
    (check.sleep_hours !== null && (!Number.isFinite(check.sleep_hours) || check.sleep_hours < 0 || check.sleep_hours > 24)) ||
    !Number.isInteger(check.cycle_day) || check.cycle_day < 0 || check.cycle_day > 45
  ) {
    throw invalid("Zeitpunkt, Schlaf, Stress oder Notiz sind ungültig.");
  }
  const total = validateSymptoms(check.symptoms || {});
  if (check.symptom_free && total) {
    throw invalid("Symptomfrei und Beschwerden können nicht gleichzeitig gespeichert werden.");
  }
  if (!check.symptom_free && !total) {
    throw invalid("Bitte Beschwerden eintragen oder ausdrücklich symptomfrei wählen.");
  }
  if (check.symptom_free) {
    check.timing_bucket = "";
    check.reference_meal_id = "";
  } else {
    check.timing_bucket ||= "unknown";
    if (!timingBuckets.has(check.timing_bucket)) {
      throw invalid("Bitte ein gültiges Beschwerde-Zeitfenster wählen.");
    }
    if (check.reference_meal_id && !uuidPattern.test(check.reference_meal_id)) {
      throw invalid("Die zugeordnete Mahlzeit ist ungültig.");
    }
  }
  check.cycle_phase ||= "unknown";
  if (!cyclePhases.has(check.cycle_phase)) throw invalid("Bitte eine gültige Zyklusphase wählen.");
  check.symptoms ||= {};
}

function validateProfile(profile, now) {
  profile.display_name = String(profile.display_name || "").trim();
  if (
    (Object.hasOwn(profile, "onboarding_completed") && typeof profile.onboarding_completed !== "boolean") ||
    (Object.hasOwn(profile, "cycle_tracking") && typeof profile.cycle_tracking !== "boolean")
  ) {
    throw invalid("Profil- und Zyklusangaben sind ungültig.");
  }
  profile.body_group ||= "unspecified";
  profile.cycle_length_days = Number(profile.cycle_length_days || 28);
  if (
    [...profile.display_name].length > 80 ||
    /[\r\n\t]/u.test(profile.display_name)
  ) {
    throw invalid("Bitte einen Namen mit maximal 80 Zeichen ohne Zeilenumbrüche eingeben.");
  }
  if (profile.onboarding_completed && !profile.display_name) {
    throw invalid("Bitte einen Namen für die Person eingeben.");
  }
  if (!["unspecified", "male", "female", "other"].includes(profile.body_group)) {
    throw invalid("Bitte einen gültigen Körperkontext wählen.");
  }
  if (!Number.isInteger(profile.cycle_length_days) || profile.cycle_length_days < 21 || profile.cycle_length_days > 45) {
    throw invalid("Die angenommene Zykluslänge muss zwischen 21 und 45 Tagen liegen.");
  }
  if (profile.period_start) {
    const start = new Date(`${profile.period_start}T00:00:00Z`);
    if (
      !/^\d{4}-\d\d-\d\d$/u.test(profile.period_start) ||
      !Number.isFinite(start.getTime()) ||
      start.toISOString().slice(0, 10) !== profile.period_start ||
      start.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ) {
      throw invalid("Der Beginn der letzten Periode ist ungültig.");
    }
  }
  if (profile.body_group !== "female" || !profile.cycle_tracking) {
    profile.cycle_tracking = false;
    profile.period_start = "";
  }
}

function inferredCycleContext(occurredAt, profile) {
  if (
    profile.body_group !== "female" ||
    !profile.cycle_tracking ||
    !profile.period_start ||
    profile.cycle_length_days < 21
  ) return ["unknown", 0];
  const start = Date.parse(`${profile.period_start}T00:00:00Z`);
  const when = new Date(occurredAt).getTime();
  const calendarDay = Math.floor((when - start) / 86400000) + 1;
  if (calendarDay < 1) return ["unknown", 0];
  const cycleDay = ((calendarDay - 1) % profile.cycle_length_days) + 1;
  if (cycleDay <= 5) return ["menstruation", cycleDay];
  if (cycleDay <= 13) return ["follicular", cycleDay];
  if (cycleDay === 14) return ["ovulation", cycleDay];
  return ["luteal", cycleDay];
}

function validateFlag(flag, now) {
  if (!uuidPattern.test(flag.recipe_id || "")) throw invalid("Das markierte Rezept ist ungültig.");
  if (flag.meal_id && !uuidPattern.test(flag.meal_id)) throw invalid("Die markierte Mahlzeit ist ungültig.");
  flag.severity = Number(flag.severity || 0);
  flag.notes = String(flag.notes || "");
  if (!recipeFlagKinds.has(flag.kind) || !Number.isInteger(flag.severity) || flag.severity < 0 || flag.severity > 10 || utf8Length(flag.notes) > 1500) {
    throw invalid("Die Rezeptmarkierung ist ungültig.");
  }
  if (flag.occurred_at) assertTime(flag.occurred_at, now, "Der Zeitpunkt der Rezeptmarkierung");
  const total = validateSymptoms(flag.symptoms || {});
  if (flag.kind === "reaction" && total === 0 && flag.severity === 0) {
    throw invalid("Bitte mindestens ein Symptom oder eine Stärke angeben.");
  }
  flag.symptoms ||= {};
}

function validateStool(stool, now) {
  assertTime(stool.observed_at, now, "Der Zeitpunkt");
  stool.notes = String(stool.notes || "");
  if (!stoolQualities.has(stool.quality) || utf8Length(stool.notes) > 1000) {
    throw invalid("Der Zeitpunkt oder die Notiz der Stuhlbeobachtung ist ungültig.");
  }
  const date = new Date(`${stool.observed_for_date}T00:00:00Z`);
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86400000;
  if (
    !/^\d{4}-\d\d-\d\d$/u.test(stool.observed_for_date || "") ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== stool.observed_for_date ||
    date.getUTCFullYear() < 2000 ||
    date.getTime() > tomorrow
  ) {
    throw invalid("Der Beobachtungstag ist ungültig.");
  }
}

function validateStress(item, now) {
  assertTime(item.observed_at, now, "Der Zeitpunkt der Gesundheitsmessung");
  item.notes = String(item.notes || "");
  if (
    !healthSources.has(item.source) ||
    !healthMetrics.has(item.metric) ||
    utf8Length(item.external_id || "") > 300 ||
    utf8Length(item.unit || "") > 64 ||
    utf8Length(item.notes) > 1000 ||
    !Number.isFinite(item.value)
  ) {
    throw invalid("Quelle oder Messart der Gesundheitsmessung ist ungültig.");
  }
  if (item.observed_until) {
    assertTime(item.observed_until, now, "Das Ende der Gesundheitsmessung");
    if (new Date(item.observed_until) < new Date(item.observed_at)) {
      throw invalid("Das Ende der Gesundheitsmessung liegt vor ihrem Beginn.");
    }
  }
  if (item.metric === "stress_score" && item.normalized_stress == null) {
    throw invalid("Ein Stress-Score muss zusätzlich als normalized_stress zwischen 0 und 10 angegeben werden.");
  }
  if (item.normalized_stress != null && (!Number.isFinite(item.normalized_stress) || item.normalized_stress < 0 || item.normalized_stress > 10)) {
    throw invalid("normalized_stress muss zwischen 0 und 10 liegen.");
  }
}

function mealBaseline(meal) {
  return {
    id: id(),
    occurred_at: meal.occurred_at,
    symptom_free: true,
    symptoms: {},
    timing_bucket: "unknown",
    reference_meal_id: meal.id,
    meal_baseline: true,
    notes: "Gutes Befinden beim Erfassen der Mahlzeit. Keine Aussage über spätere Beschwerden.",
  };
}

function routeResult(diary, result, changed = true) {
  return { diary, result, changed };
}

function findEntry(collection, entryId) {
  const entry = collection.find((item) => item.id === entryId);
  if (!entry) throw notFound();
  return entry;
}

function assertMealRecipe(diary, recipeId) {
  const recipe = diary.recipes.find((item) => item.id === recipeId);
  if (!recipe) throw invalid("Bitte ein gespeichertes Rezept wählen.");
  return recipe;
}

function editEntry(diary, kind, entryId, body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalid("Ungültige Änderungen.");
  }
  if (kind === "meals") {
    const old = findEntry(diary.meals, entryId);
    const next = { ...old, ...body, id: old.id, title: old.title, ingredients: old.ingredients };
    if (!timeIsValid(next.occurred_at, now) || !Number.isFinite(next.portions) || next.portions <= 0 || next.portions > 20 || utf8Length(String(next.notes || "")) > 3000) {
      throw invalid("Zeitpunkt, Portionen oder Notiz sind ungültig.");
    }
    next.notes = String(next.notes || "");
    if (next.recipe_id !== old.recipe_id) {
      if (diary.recipe_flags.some((flag) => flag.meal_id === entryId)) {
        throw invalid("Bitte zuerst die Reaktionsmarkierung dieser Mahlzeit beim bisherigen Rezept entfernen, bevor du das Rezept wechselst.");
      }
      const recipe = assertMealRecipe(diary, next.recipe_id);
      next.title = recipe.title;
      next.ingredients = structuredClone(recipe.ingredients);
    }
    return next;
  }
  if (kind === "checkins") {
    const old = findEntry(diary.checkins, entryId);
    const suppliedSymptoms = Object.hasOwn(body, "symptoms");
    const next = { ...old, ...body, id: old.id };
    if (!suppliedSymptoms) next.symptoms = structuredClone(old.symptoms || {});
    next.meal_baseline = Boolean(old.meal_baseline && next.symptom_free && !body.confirm_observation);
    validateCheckin(next, now);
    if (next.meal_baseline) {
      next.reference_meal_id = old.reference_meal_id;
      next.timing_bucket = old.timing_bucket;
      next.stress = old.stress;
      next.sleep_hours = old.sleep_hours;
      next.cycle_phase = old.cycle_phase;
      next.cycle_day = old.cycle_day;
    } else if (next.reference_meal_id && next.reference_meal_id !== old.reference_meal_id) {
      if (!diary.meals.some((meal) => meal.id === next.reference_meal_id)) {
        throw invalid("Die zugeordnete Mahlzeit wurde nicht gefunden.");
      }
    }
    delete next.confirm_observation;
    return next;
  }
  if (kind === "stools") {
    const old = findEntry(diary.stools, entryId);
    const next = { ...old, ...body, id: old.id };
    validateStool(next, now);
    return next;
  }
  if (kind === "stress") {
    const old = findEntry(diary.stress_observations, entryId);
    const next = { ...old, ...body, id: old.id };
    if (old.source !== "generic" || old.external_id || old.metric !== "stress_score") {
      const changedMeasurement = [
        "source",
        "external_id",
        "metric",
        "value",
        "unit",
        "normalized_stress",
        "observed_at",
        "observed_until",
      ].some((key) => next[key] !== old[key]);
      if (changedMeasurement) {
        throw invalid("Bei importierten Health-Messungen lässt sich nur die Notiz bearbeiten. Messwerte und Zeitpunkt bleiben unverändert.");
      }
    } else {
      if (
        next.source !== old.source ||
        next.external_id !== old.external_id ||
        next.metric !== old.metric ||
        next.unit !== old.unit ||
        next.observed_until !== old.observed_until
      ) {
        throw invalid("Die Quelle und Messart lassen sich nicht ändern.");
      }
      if (!Number.isFinite(next.value) || next.value < 0 || next.value > 10) {
        throw invalid("Stress muss zwischen 0 und 10 liegen.");
      }
      next.normalized_stress = next.value;
    }
    validateStress(next, now);
    return next;
  }
  throw notFound();
}

export function analyseIngredientLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw invalid("Bitte 1 bis 100 Zutaten eingeben.");
  }
  if (lines.some((line) => typeof line !== "string" || utf8Length(line) > 500)) {
    throw invalid("Eine Zutatenzeile ist zu lang.");
  }
  return { ingredients: lines.map((line) => extractIngredientLine(line.slice(0, 500))) };
}

// Execute personal diary writes against a private draft. Call this only inside
// the vault session transaction; it never sends diary contents to the server.
export function applyDiaryRequest(diary, path, method, body, now = new Date()) {
  ensureDiary(diary);
  const pathname = new URL(path, "https://local.invalid").pathname.replace(/\/$/u, "") || "/";
  const verb = String(method || "GET").toUpperCase();
  if (pathname === "/ingredients/analyze" && verb === "POST") {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    return routeResult(diary, analyseIngredientLines(request?.lines), false);
  }
  if (pathname === "/profile" && verb === "PUT") {
    const profile = typeof body === "string" ? JSON.parse(body) : body;
    validateProfile(profile, now);
    diary.profile = profile;
    return routeResult(diary, profile);
  }

  const recipeMatch = pathname.match(/^\/recipes(?:\/([^/]+))?$/u);
  if (recipeMatch && (verb === "POST" || verb === "PUT")) {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    const recipe = { ...request };
    validateRecipe(recipe);
    if (verb === "PUT") {
      const old = findEntry(diary.recipes, recipeMatch[1]);
      recipe.id = old.id;
      recipe.created_at = old.created_at;
      diary.recipes[diary.recipes.indexOf(old)] = recipe;
    } else {
      recipe.id = id();
      recipe.created_at = now.toISOString();
      diary.recipes.push(recipe);
    }
    return routeResult(diary, recipe);
  }

  if (pathname === "/meals" && verb === "POST") {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    const meal = { ...request };
    assertTime(meal.occurred_at, now);
    if (!Number.isFinite(meal.portions) || meal.portions <= 0 || meal.portions > 20 || utf8Length(String(meal.notes || "")) > 3000) {
      throw invalid("Zeitpunkt, Portionen oder Notiz sind ungültig.");
    }
    const recipe = assertMealRecipe(diary, meal.recipe_id);
    meal.id = id();
    meal.title = recipe.title;
    meal.ingredients = structuredClone(recipe.ingredients);
    meal.notes = String(meal.notes || "");
    diary.meals.push(meal);
    let checkin;
    if (request.record_good_moment) {
      checkin = mealBaseline(meal);
      diary.checkins.push(checkin);
    }
    return routeResult(diary, checkin ? { ...meal, checkin } : meal);
  }

  if (pathname === "/checkins" && verb === "POST") {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    const checkin = { ...request, meal_baseline: false };
    validateCheckin(checkin, now);
    if (checkin.cycle_phase === "unknown") {
      [checkin.cycle_phase, checkin.cycle_day] = inferredCycleContext(checkin.occurred_at, diary.profile);
    }
    if (diary.profile.body_group !== "female" || !diary.profile.cycle_tracking) {
      checkin.cycle_phase = "unknown";
      checkin.cycle_day = 0;
    }
    if (checkin.reference_meal_id && !diary.meals.some((meal) => meal.id === checkin.reference_meal_id)) {
      throw invalid("Die zugeordnete Mahlzeit wurde nicht gefunden.");
    }
    checkin.id = id();
    diary.checkins.push(checkin);
    return routeResult(diary, checkin);
  }

  if (pathname === "/recipe-flags" && verb === "POST") {
    const flag = typeof body === "string" ? JSON.parse(body) : body;
    validateFlag(flag, now);
    if (!diary.recipes.some((recipe) => recipe.id === flag.recipe_id)) {
      throw invalid("Das markierte Rezept wurde nicht gefunden.");
    }
    if (flag.meal_id) {
      const meal = diary.meals.find((item) => item.id === flag.meal_id && item.recipe_id === flag.recipe_id);
      if (!meal) throw invalid("Die markierte Mahlzeit gehört nicht zu diesem Rezept.");
      if (!flag.occurred_at) flag.occurred_at = meal.occurred_at;
    }
    flag.id = id();
    diary.recipe_flags.push(flag);
    return routeResult(diary, flag);
  }

  if (pathname === "/stools" && verb === "POST") {
    const stool = typeof body === "string" ? JSON.parse(body) : body;
    validateStool(stool, now);
    stool.id = id();
    diary.stools.push(stool);
    return routeResult(diary, stool);
  }

  if (pathname === "/stress" && verb === "POST") {
    const observation = typeof body === "string" ? JSON.parse(body) : body;
    validateStress(observation, now);
    observation.id = id();
    diary.stress_observations.push(observation);
    return routeResult(diary, observation);
  }

  if (pathname === "/health/import" && verb === "POST") {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    if (!Array.isArray(request?.records) || request.records.length < 1 || request.records.length > 10000) {
      throw invalid("Bitte 1 bis 10000 Gesundheitsmessungen importieren.");
    }
    if (request.source && !healthSources.has(request.source)) throw invalid("Die Gesundheitsquelle ist nicht bekannt.");
    const existing = new Map();
    for (const observation of diary.stress_observations) {
      if (observation.source && observation.external_id) {
        existing.set(`${observation.source}\u0000${observation.external_id}`, observation.id);
      }
    }
    let imported = 0;
    let updated = 0;
    const records = [];
    for (const input of request.records) {
      const observation = { ...input };
      if (!observation.source) observation.source = request.source;
      else if (request.source && observation.source !== request.source) {
        throw invalid("Eine Messung gehört zu einer anderen Quelle als der Import.");
      }
      validateStress(observation, now);
      const key = `${observation.source}\u0000${observation.external_id || ""}`;
      const oldId = observation.external_id ? existing.get(key) : undefined;
      if (oldId) {
        observation.id = oldId;
        updated++;
        const index = diary.stress_observations.findIndex((item) => item.id === oldId);
        diary.stress_observations[index] = observation;
      } else {
        observation.id = id();
        imported++;
        diary.stress_observations.push(observation);
      }
      records.push(observation);
    }
    return routeResult(diary, { imported, updated, records });
  }

  const editMatch = pathname.match(/^\/(meals|checkins|stools|stress)\/([^/]+)$/u);
  if (editMatch && verb === "PUT") {
    const request = typeof body === "string" ? JSON.parse(body) : body;
    const updated = editEntry(diary, editMatch[1], editMatch[2], request, now);
    const collection = editMatch[1] === "stress" ? diary.stress_observations : diary[editMatch[1]];
    collection[collection.findIndex((item) => item.id === editMatch[2])] = updated;
    return routeResult(diary, updated);
  }

  const deleteMatch = pathname.match(/^\/(recipes|meals|checkins|recipe_flags|stools|stress)\/([^/]+)$/u);
  if (deleteMatch && verb === "DELETE") {
    const collectionName = deleteMatch[1] === "stress" ? "stress_observations" : deleteMatch[1];
    const collection = diary[collectionName];
    const index = collection.findIndex((item) => item.id === deleteMatch[2]);
    if (index < 0) throw notFound();
    collection.splice(index, 1);
    return routeResult(diary, null);
  }

  throw new Error("Diese persönliche Funktion ist noch nicht für den verschlüsselten Tresor verfügbar.");
}
