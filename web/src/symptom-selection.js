export function toggleSelectedSymptom(selected, key) {
  return selected.includes(key)
    ? selected.filter((item) => item !== key)
    : [...selected, key];
}

export function allSelectedSymptomsRated(selected, scores) {
  return (
    selected.length > 0 && selected.every((key) => Number(scores[key]) > 0)
  );
}
