// The UI uses a 0–5 rating while the API keeps its historical 0–10 values.
// The first non-zero choice remains above the analysis service's event threshold.
export const symptomIntensityFromScore = (score) => {
  const value = Number(score) || 0;
  if (value <= 0) return 0;
  if (value <= 4) return 1;
  if (value <= 5) return 2;
  if (value <= 7) return 3;
  if (value <= 8) return 4;
  return 5;
};

export const symptomScoreFromIntensity = (intensity) =>
  [0, 4, 5, 7, 8, 10][
    Math.max(0, Math.min(5, Math.round(Number(intensity) || 0)))
  ];

// Keep legacy precision when editing a different field. The visible six-level
// rating groups historical 0–10 values, so only explicitly changed ratings
// should be converted back to a representative score.
export function preserveUnchangedSymptomScores(
  original = {},
  edited = {},
  changedKeys = [],
) {
  const result = structuredClone(original);
  for (const key of changedKeys) {
    if (Object.hasOwn(edited, key)) result[key] = edited[key];
    else delete result[key];
  }
  return result;
}

export const symptomIntensityLabels = [
  "Keine",
  "Sehr leicht",
  "Leicht",
  "Mittel",
  "Stark",
  "Sehr stark",
];
