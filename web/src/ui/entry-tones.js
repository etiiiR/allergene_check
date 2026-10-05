// Shared category cues, not medical risk/severity scores. Labels and icons
// remain necessary so the diary is also understandable without color.
export function entryTone(item) {
  if (["meal", "meals", "recipes"].includes(item.kind)) return "meal";
  if (["stool", "stools"].includes(item.kind)) return "stool";
  if (item.kind === "stress") return "stress";
  return item.symptom_free ? "well" : "symptom";
}
