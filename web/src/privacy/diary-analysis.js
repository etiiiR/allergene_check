// Explainable, device-local diary analysis. This intentionally mirrors the
// exploratory server contract so encrypted diaries keep the same insights.
import { ingredientKeys } from "./ingredient-normalizer.js";

const timingWindows = {
  immediate: [0, 0.5],
  early: [0.5, 2],
  mid: [2, 6],
  late: [6, 24],
  unknown: [0, 24],
};
const timingMeta = {
  immediate: { label: "Direkt nach dem Essen", phase: "Frühes Fenster", range: "0–30 min" },
  early: { label: "30 Minuten bis 2 Stunden", phase: "Frühes Verdauungsfenster", range: "30 min–2 h" },
  mid: { label: "2 bis 6 Stunden", phase: "Dünndarm-orientiertes Fenster", range: "2–6 h" },
  late: { label: "6 bis 24 Stunden / Folgetag", phase: "Spätes / Folgetag-Fenster", range: "6–24 h" },
  unknown: { label: "Zeitpunkt unklar", phase: "Nicht zugeordnet", range: "–" },
};
const cyclePhases = {
  menstruation: "Menstruation",
  follicular: "Follikelphase",
  ovulation: "Ovulationsfenster",
  luteal: "Lutealphase",
};
const stoolLabels = {
  formed: "Gut geformt",
  hard: "Hart / schwer",
  soft: "Weich",
  watery: "Wässrig",
  mixed: "Unterschiedlich",
  no_stool: "Kein Stuhl",
  unknown: "Nicht sicher",
};
const abnormalStool = new Set(["hard", "soft", "watery", "mixed"]);
const round = (value, places = 3) => Number(value.toFixed(places));
const isoTime = (value) => {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.getTime() : NaN;
};

function maxSeverity(check, symptom) {
  const symptoms = check.symptoms || {};
  return symptom === "any" ? Math.max(0, ...Object.values(symptoms)) : symptoms[symptom] || 0;
}

function idsForMeal(meal) {
  if (Array.isArray(meal.ingredient_ids)) return meal.ingredient_ids;
  return ingredientKeys(meal.ingredients || []);
}

function localDate(value, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    return `${part.year}-${part.month}-${part.day}`;
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function stressValueFor(check, observations) {
  const checkAt = isoTime(check.occurred_at);
  let best = null;
  for (const item of observations) {
    if (item.normalized_stress == null) continue;
    const start = isoTime(item.observed_at);
    const end = item.observed_until ? isoTime(item.observed_until) : NaN;
    const distance = Number.isFinite(end) && start <= checkAt && checkAt <= end
      ? 0
      : Math.abs(checkAt - start);
    if (distance > 6 * 60 * 60 * 1000) continue;
    if (!best || distance < best.distance) best = { distance, value: item.normalized_stress };
  }
  return best?.value ?? null;
}

function logisticCoefficients(rows, eligible) {
  const contextFeatures = [
    {
      scale: 10,
      value: (row) =>
        row.importedStress ??
        (row.check.context_recorded === true ? row.check.stress : null),
    },
    {
      scale: 24,
      value: (row) =>
        row.check.context_recorded === true ? row.check.sleep_hours : null,
    },
  ]
    .map((feature) => {
      const values = rows.map((row) => {
        const value = feature.value(row);
        return Number.isFinite(value) ? value : null;
      });
      const observed = values.filter((value) => value !== null);
      if (observed.length < 5 || new Set(observed).size < 2) return null;
      return {
        values,
        mean: observed.reduce((sum, value) => sum + value, 0) / observed.length,
        scale: feature.scale,
      };
    })
    .filter(Boolean);
  const width = eligible.length + contextFeatures.length;
  const matrix = rows.map((row, rowIndex) => [
    ...eligible.map((name) => Number(row.exposures.has(name))),
    ...contextFeatures.map(
      (feature) => (feature.values[rowIndex] ?? feature.mean) / feature.scale,
    ),
  ]);
  const labels = rows.map((row) => row.positive);
  const weights = Array(width + 1).fill(0);

  // Newton/IRLS with L2 regularization (intercept excluded). Optional context
  // enters only with at least five varying, explicitly recorded values;
  // remaining gaps use that feature's observed mean, never a made-up default.
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const gradient = Array(width + 1).fill(0);
    const hessian = Array.from({ length: width + 1 }, () => Array(width + 1).fill(0));
    for (let index = 0; index < matrix.length; index += 1) {
      const x = [1, ...matrix[index]];
      const z = x.reduce((sum, value, j) => sum + value * weights[j], 0);
      const probability = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
      const variance = Math.max(probability * (1 - probability), 1e-9);
      for (let i = 0; i < x.length; i += 1) {
        gradient[i] += x[i] * (labels[index] - probability);
        for (let j = 0; j < x.length; j += 1) hessian[i][j] += variance * x[i] * x[j];
      }
    }
    for (let index = 1; index < weights.length; index += 1) {
      gradient[index] -= 2 * weights[index];
      hessian[index][index] += 2;
    }
    const step = solve(hessian, gradient);
    if (!step) return {};
    let largest = 0;
    for (let index = 0; index < weights.length; index += 1) {
      weights[index] += step[index];
      largest = Math.max(largest, Math.abs(step[index]));
    }
    if (largest < 1e-7) break;
  }
  return Object.fromEntries(eligible.map((name, index) => [name, weights[index + 1]]));
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= size; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= size; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[size]);
}

function nonFoodAssessment(moments, severityFor) {
  const withFood = moments.filter((moment) => moment.exposures.size);
  const withoutFood = moments.filter((moment) => !moment.exposures.size);
  const symptomaticWith = withFood.filter((moment) => severityFor(moment.check) >= 3).length;
  const symptomaticWithout = withoutFood.filter((moment) => severityFor(moment.check) >= 3).length;
  const withRate = withFood.length ? symptomaticWith / withFood.length : null;
  const withoutRate = withoutFood.length ? symptomaticWithout / withoutFood.length : null;
  let status = "insufficient_data";
  let label = "Noch zu wenig Vergleichsmomente";
  let explanation = "Dokumentiere Mahlzeiten und Befinden auch dann, wenn du keinen Essensauslöser vermutest.";
  if (withFood.length >= 3 && withoutFood.length >= 3) {
    if (withoutRate - withRate >= 0.25 && symptomaticWithout >= 3) {
      status = "possible_other_driver";
      label = "Möglicherweise nicht primär lebensmittelbezogen";
      explanation = "Viele Beschwerden traten in Momenten ohne passend dokumentierte Mahlzeit auf. Andere Faktoren sollten mitbeobachtet werden.";
    } else if (withRate - withoutRate >= 0.25) {
      status = "food_timing_more_consistent";
      label = "Essensbezug ist in den Daten konsistenter";
      explanation = "Beschwerden traten häufiger in dokumentierten Essensfenstern auf. Das ist ein Hinweis, kein Beweis.";
    } else {
      status = "mixed_or_unclear";
      label = "Gemischtes oder unklareres Muster";
      explanation = "Die Beschwerden verteilen sich auf Momente mit und ohne passenden Essensbezug.";
    }
  }
  return {
    status, label, explanation,
    documented_moments: moments.length,
    moments_with_food_window: withFood.length,
    moments_without_food_window: withoutFood.length,
    symptomatic_with_food: symptomaticWith,
    symptomatic_without_food: symptomaticWithout,
    rate_with_food: withRate == null ? null : round(withRate),
    rate_without_food: withoutRate == null ? null : round(withoutRate),
  };
}

function stressAssessment(moments, severityFor) {
  const scored = moments.filter((item) => item.stress != null);
  const high = scored.filter((item) => item.stress >= 6);
  const lower = scored.filter((item) => item.stress < 6);
  const highSymptomatic = high.filter((item) => severityFor(item.check) >= 3).length;
  const lowerSymptomatic = lower.filter((item) => severityFor(item.check) >= 3).length;
  const highRate = high.length ? highSymptomatic / high.length : null;
  const lowerRate = lower.length ? lowerSymptomatic / lower.length : null;
  const difference = highRate == null || lowerRate == null ? null : highRate - lowerRate;
  let status = "insufficient_data";
  let label = "Noch zu wenig Stress-Vergleichsdaten";
  let explanation = "Dokumentiere Stress und Befinden zu mehreren Zeitpunkten, damit diese persönliche Gegenüberstellung aussagekräftiger wird.";
  if (high.length >= 3 && lower.length >= 3) {
    if (difference >= 0.25) {
      status = "more_symptoms_at_higher_stress";
      label = "Mehr Beschwerden bei höherem dokumentiertem Stress";
      explanation = "In deinen bisherigen Einträgen wurden Beschwerden häufiger bei Stress ab 6/10 dokumentiert. Das ist ein persönliches Muster, kein Nachweis einer Ursache.";
    } else if (difference <= -0.25) {
      status = "more_symptoms_at_lower_stress";
      label = "Mehr Beschwerden bei niedrigerem dokumentiertem Stress";
      explanation = "In deinen bisherigen Einträgen wurden Beschwerden häufiger bei Stress unter 6/10 dokumentiert. Das ist ein persönliches Muster, kein Nachweis einer Ursache.";
    } else {
      status = "mixed_or_unclear";
      label = "Kein klares Stress-Muster";
      explanation = "Die Beschwerderaten liegen in den beiden Stressbereichen nah beieinander oder sind gemischt.";
    }
  }
  return {
    status, label, explanation,
    moments: scored.length,
    high_stress_moments: high.length,
    lower_stress_moments: lower.length,
    high_stress_symptomatic: highSymptomatic,
    lower_stress_symptomatic: lowerSymptomatic,
    high_stress_rate: highRate == null ? null : round(highRate),
    lower_stress_rate: lowerRate == null ? null : round(lowerRate),
    difference: difference == null ? null : round(difference),
    average_stress: scored.length ? round(scored.reduce((sum, item) => sum + item.stress, 0) / scored.length, 2) : null,
  };
}

function manualAndStoolEvidence(diary, meals, recipeFlags, timeZone) {
  const manual = {};
  for (const flag of recipeFlags) {
    for (const ingredient of flag.ingredient_ids) {
      const item = manual[ingredient] ||= { flags: 0, reaction_flags: 0, suspected_flags: 0, severity: 0 };
      item.flags += 1;
      item.reaction_flags += Number(flag.kind === "reaction");
      item.suspected_flags += Number(flag.kind === "suspected");
      item.severity = Math.max(item.severity, flag.severity || 0);
    }
  }
  const stoolCounts = Object.fromEntries(Object.keys(stoolLabels).map((key) => [key, 0]));
  const stoolByIngredient = {};
  for (const stool of diary.stools || []) {
    const quality = stoolCounts[stool.quality] == null ? "unknown" : stool.quality;
    stoolCounts[quality] += 1;
    if (!abnormalStool.has(quality) && quality !== "formed") continue;
    const observedForDate = stool.observed_for_date;
    for (const meal of meals) {
      const mealDate = localDate(meal.occurred_at, timeZone);
      const expected = new Date(`${mealDate}T00:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() + 1);
      if (observedForDate !== expected.toISOString().slice(0, 10)) continue;
      for (const ingredient of idsForMeal(meal)) {
        const item = stoolByIngredient[ingredient] ||= { abnormal: 0, formed: 0 };
        item.abnormal += Number(abnormalStool.has(quality));
        item.formed += Number(quality === "formed");
      }
    }
  }
  const stoolSummary = Object.entries(stoolLabels).map(([quality, label]) => ({ quality, label, count: stoolCounts[quality] }));
  return {
    manual,
    stoolByIngredient,
    stoolSummary,
    manualSummary: {
      flags: (diary.recipe_flags || []).length,
      suspected_recipe_flags: (diary.recipe_flags || []).filter((flag) => flag.kind === "suspected").length,
      reaction_flags: (diary.recipe_flags || []).filter((flag) => flag.kind === "reaction").length,
      stool_observations: (diary.stools || []).length,
    },
  };
}

function stressSummary(observations) {
  const bySource = {};
  const byMetric = {};
  const normalized = [];
  for (const item of observations) {
    bySource[item.source] = (bySource[item.source] || 0) + 1;
    byMetric[item.metric] = (byMetric[item.metric] || 0) + 1;
    if (item.normalized_stress != null) normalized.push(item);
  }
  normalized.sort((a, b) => isoTime(a.observed_at) - isoTime(b.observed_at));
  return {
    total: observations.length,
    normalized_count: normalized.length,
    raw_metric_count: observations.length - normalized.length,
    by_source: Object.entries(bySource).sort(([a], [b]) => a.localeCompare(b)).map(([source, count]) => ({ source, count })),
    by_metric: Object.entries(byMetric).sort(([a], [b]) => a.localeCompare(b)).map(([metric, count]) => ({ metric, count })),
    last_normalized_score: normalized.length ? round(normalized.at(-1).normalized_stress, 2) : null,
    last_normalized_at: normalized.at(-1)?.observed_at || null,
  };
}

export function analyseDiaryPatterns(diary, {
  symptom = "any",
  hours = 8,
  timezone = "Europe/Zurich",
} = {}) {
  const meals = (diary.meals || []).map((meal) => ({ ...meal, ingredient_ids: idsForMeal(meal) }));
  const checkins = (diary.checkins || []).filter((check) => !check.meal_baseline);
  const observations = diary.stress_observations || [];
  const timingCounts = Object.fromEntries(Object.keys(timingWindows).map((key) => [key, 0]));
  const moments = [];
  const rows = [];
  const severityFor = (check) => maxSeverity(check, symptom);

  for (const check of [...checkins].sort((a, b) => isoTime(a.occurred_at) - isoTime(b.occurred_at))) {
    const bucket = Object.hasOwn(timingWindows, check.timing_bucket) ? check.timing_bucket : "unknown";
    timingCounts[bucket] += 1;
    const [lower, defaultUpper] = timingWindows[bucket];
    const upper = bucket === "unknown" ? hours : defaultUpper;
    const checkAt = isoTime(check.occurred_at);
    const exposures = new Set();
    for (const meal of meals) {
      if (check.reference_meal_id && meal.id !== check.reference_meal_id) continue;
      const elapsed = (checkAt - isoTime(meal.occurred_at)) / 3600000;
      if (elapsed >= lower && elapsed <= upper) meal.ingredient_ids.forEach((item) => exposures.add(item));
    }
    const importedStress = stressValueFor(check, observations);
    const manualStress =
      check.context_recorded === true && Number.isFinite(check.stress)
        ? check.stress
        : null;
    moments.push({ check, exposures, stress: importedStress ?? manualStress });
    if (!exposures.size) continue;
    rows.push({ exposures, positive: Number(severityFor(check) >= 3), check, importedStress });
  }

  const names = [...new Set(rows.flatMap((row) => [...row.exposures]))].sort();
  const positives = rows.reduce((sum, row) => sum + row.positive, 0);
  const eligible = names.filter((name) => rows.filter((row) => row.exposures.has(name)).length >= 3 && rows.filter((row) => !row.exposures.has(name)).length >= 3);
  const trained = rows.length >= 20 && positives >= 5 && rows.length - positives >= 5 && eligible.length > 0;
  const coefficients = trained ? logisticCoefficients(rows, eligible) : {};
  const associations = names.map((name) => {
    const exposed = rows.filter((row) => row.exposures.has(name));
    const unexposed = rows.filter((row) => !row.exposures.has(name));
    const symptomaticExposed = exposed.reduce((sum, row) => sum + row.positive, 0);
    const symptomaticUnexposed = unexposed.reduce((sum, row) => sum + row.positive, 0);
    const comparable = exposed.length >= 3 && unexposed.length >= 3;
    const coOccurring = names.filter((other) => other !== name && rows.every((row) => row.exposures.has(name) === row.exposures.has(other)));
    return {
      ingredient_id: name,
      exposed: exposed.length,
      unexposed: unexposed.length,
      symptomatic_exposed: symptomaticExposed,
      symptomatic_unexposed: symptomaticUnexposed,
      rate_exposed: round(symptomaticExposed / exposed.length),
      rate_unexposed: unexposed.length ? round(symptomaticUnexposed / unexposed.length) : null,
      difference: comparable ? round(symptomaticExposed / exposed.length - symptomaticUnexposed / unexposed.length) : null,
      coefficient: Object.hasOwn(coefficients, name) ? round(coefficients[name]) : null,
      co_occurring: coOccurring,
      evidence: comparable ? "exploratory" : "insufficient",
    };
  }).sort((a, b) => (b.difference ?? -2) - (a.difference ?? -2));

  const flags = (diary.recipe_flags || []).map((flag) => ({
    ...flag,
    ingredient_ids: (diary.recipes || []).find((recipe) => recipe.id === flag.recipe_id)?.analysis_ingredient_ids || ingredientKeys((diary.recipes || []).find((recipe) => recipe.id === flag.recipe_id)?.ingredients || []),
  }));
  const { manual, stoolByIngredient, stoolSummary, manualSummary } = manualAndStoolEvidence(diary, meals, flags, timezone);
  const associationMap = new Map(associations.map((item) => [item.ingredient_id, item]));
  const possibleIngredients = [...new Set([...associationMap.keys(), ...Object.keys(manual), ...Object.keys(stoolByIngredient)])]
    .flatMap((ingredientId) => {
      const association = associationMap.get(ingredientId) || {};
      const explicit = manual[ingredientId] || {};
      const stool = stoolByIngredient[ingredientId] || {};
      const reasons = [];
      let evidenceScore = 0;
      if (explicit.reaction_flags) { reasons.push("manuell als Reaktion markiert"); evidenceScore += explicit.reaction_flags * 3; }
      if (explicit.suspected_flags) { reasons.push("Rezept manuell als verdächtig markiert"); evidenceScore += explicit.suspected_flags * 2; }
      if (stool.abnormal) { reasons.push("mit auffälligerer Stuhlbeobachtung am Folgetag verbunden"); evidenceScore += stool.abnormal; }
      if (association.difference != null && association.difference > 0) { reasons.push("in den Essensfenstern häufiger mit Beschwerden verbunden"); evidenceScore += 1; }
      if (!reasons.length) return [];
      return [{
        ingredient_id: ingredientId, reasons, evidence_score: evidenceScore,
        manual_flags: explicit.flags || 0, manual_reactions: explicit.reaction_flags || 0,
        stool_abnormal: stool.abnormal || 0, stool_formed: stool.formed || 0,
        observed_difference: association.difference ?? null,
      }];
    })
    .sort((a, b) => b.evidence_score - a.evidence_score || a.ingredient_id.localeCompare(b.ingredient_id))
    .slice(0, 12);

  const documentedPositive = moments.filter((moment) => severityFor(moment.check) >= 3).length;
  const profile = diary.profile || {};
  const cycleActive = profile.body_group === "female" && profile.cycle_tracking;
  const cycleCounts = Object.fromEntries(Object.keys(cyclePhases).map((phase) => [phase, { moments: 0, symptomatic_moments: 0 }]));
  if (cycleActive) {
    for (const moment of moments) {
      const entry = cycleCounts[moment.check.cycle_phase];
      if (!entry) continue;
      entry.moments += 1;
      entry.symptomatic_moments += Number(severityFor(moment.check) >= 3);
    }
  }
  const cycleSummary = cycleActive ? Object.entries(cycleCounts).map(([phase, values]) => ({
    phase, label: cyclePhases[phase], ...values,
    rate: values.moments ? round(values.symptomatic_moments / values.moments) : null,
  })) : [];
  const analysisScope = profile.body_group === "female" && cycleActive
    ? "female_cycle_separated"
    : profile.body_group === "male"
      ? "male_separated_no_cycle_context"
      : "personal_profile_without_cycle_model";

  return {
    observations: rows.length,
    symptomatic_days: positives,
    comparison_days: rows.length - positives,
    documented_moments: moments.length,
    food_matched_moments: rows.length,
    symptomatic_moments: documentedPositive,
    comparison_moments: moments.length - documentedPositive,
    model_status: trained ? "exploratory" : "insufficient_data",
    window_hours: hours,
    symptom,
    associations,
    timezone,
    timing_summary: Object.entries(timingWindows).map(([bucket]) => ({ bucket, ...timingMeta[bucket], count: timingCounts[bucket] })),
    non_food_assessment: nonFoodAssessment(moments, severityFor),
    possible_ingredients: possibleIngredients,
    manual_flag_summary: manualSummary,
    stool_summary: stoolSummary,
    stress_summary: stressSummary(observations),
    stress_assessment: stressAssessment(moments, severityFor),
    analysis_scope: analysisScope,
    cycle_summary: cycleSummary,
    method: "Jeder Check-in ist eine eigene Beobachtung. Zutaten werden anhand dokumentierter Mahlzeiten und des gewählten Zeitfensters verglichen; sehr leichte und stärkere Symptomstufen zählen als Beschwerden. Stress und Schlaf sind optional. Manuelle Werte werden nur nach ausdrücklicher Bestätigung, Health-Stresswerte nur nach Normalisierung berücksichtigt. Fehlende Werte werden nicht als Null oder Standardmessung interpretiert; das Mehrfaktorenmodell nutzt Kontext nur bei genügend beobachteten Werten. Rohwerte wie HRV und Puls werden nicht in Stress umgerechnet. Das Modell ist explorativ und nicht klinisch validiert.",
    limitations: "Zusammenhänge diagnostizieren weder Unverträglichkeit noch Allergie oder eine andere Erkrankung. Nicht zugeordnete Momente können nicht protokollierte Mahlzeiten oder andere Erklärungen enthalten. Zeitfenster sind persönliche Beobachtungen und keine Messung des Verdauungswegs. Zyklusphasen sind Näherungen, keine medizinische Beratung. Gemeinsam gegessene Zutaten lassen sich nicht sicher trennen. Fehlende Einträge und weitere Faktoren können Ergebnisse beeinflussen. Wearable-Werte unterscheiden sich je nach Anbieter; Modellgewichte sind keine Wahrscheinlichkeiten.",
  };
}
