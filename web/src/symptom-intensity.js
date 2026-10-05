// Keep the historical 0..10 API values, while presenting severity as words.
// A mild report maps above the analysis service's 3/10 event threshold.
export const symptomIntensityFromScore = (score) => {
  const value = Number(score) || 0;
  if (value <= 0) return 0;
  if (value <= 5) return 1;
  if (value <= 8) return 2;
  return 3;
};

export const symptomScoreFromIntensity = (intensity) =>
  [0, 4, 7, 10][Math.max(0, Math.min(3, Math.round(Number(intensity) || 0)))];

export const symptomIntensityLabels = ["Keine", "Leicht", "Mittel", "Stark"];
