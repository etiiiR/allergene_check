// Search normalization is for finding recipes only. It never changes stored
// ingredient identities or makes claims about allergens/tolerance.
export function searchText(value = "") {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const titleOrder = new Intl.Collator("de", {
  numeric: true,
  sensitivity: "base",
});

// Build once per diary update, not once per keystroke. O(recipes + meals).
export function recipeIndex(recipes = [], meals = []) {
  const usage = new Map();
  for (const meal of meals) {
    const entry = usage.get(meal.recipe_id) || { count: 0, last: 0 };
    entry.count++;
    entry.last = Math.max(entry.last, Date.parse(meal.occurred_at) || 0);
    usage.set(meal.recipe_id, entry);
  }
  return recipes.map((recipe) => ({
    recipe,
    title: searchText(recipe.title),
    text: searchText(
      `${recipe.title} ${(recipe.ingredients || []).map((i) => i.text).join(" ")}`,
    ),
    count: usage.get(recipe.id)?.count || 0,
    last: usage.get(recipe.id)?.last || 0,
    created: Date.parse(recipe.created_at) || 0,
  }));
}

export function findRecipes(index, query = "", sort = "recent") {
  const phrase = searchText(query);
  const terms = phrase.split(" ").filter(Boolean);
  const relevance = (item) =>
    !phrase
      ? 0
      : item.title === phrase
        ? 0
        : item.title.startsWith(phrase)
          ? 1
          : terms.every((term) => item.title.includes(term))
            ? 2
            : 3;
  return index
    .filter((item) => terms.every((term) => item.text.includes(term)))
    .sort(
      (a, b) =>
        relevance(a) - relevance(b) ||
        (sort === "frequent"
          ? b.count - a.count || b.last - a.last
          : sort === "recent"
            ? b.last - a.last || b.created - a.created
            : 0) ||
        titleOrder.compare(a.recipe.title, b.recipe.title) ||
        a.recipe.id.localeCompare(b.recipe.id),
    );
}
