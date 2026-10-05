"""Can run with stdlib unittest; no model, database, or network needed."""
import json
import unittest
from pathlib import Path
from app.ingredient_normalization import normalize_ingredient, extract_line, FOODS, ingredient_text


class IngredientNormalizationTests(unittest.TestCase):
    def test_shared_corpus(self):
        cases = json.loads((Path(__file__).parent / "fixtures/ingredient_normalization.json").read_text())
        for case in cases:
            with self.subTest(line=case['line']):
                self.assertEqual(normalize_ingredient(case['line']), {k:v for k,v in case.items() if k != 'line'})

    def test_suggestions_never_auto_confirm_unknown_or_negated_food(self):
        for text in ['Salzz', 'ohne Milch', 'Salz oder Zucker', 'garlic infused oil', 'lactose free yogurt', 'glutenfreies Mehl']:
            with self.subTest(text=text):
                result = extract_line(text)
                self.assertTrue(result['needs_review'])
                self.assertEqual(result['canonical_id'], '')
        self.assertIn('salt', [f['id'] for f in extract_line('Salzz')['matches']])

    def test_specific_identity_and_original_are_preserved(self):
        for text, expected in [('200 ml almond milk', 'almond-milk'), ('1 Prise Salz', 'salt'), ('250g Mandelmehl', 'almond-flour')]:
            result = extract_line(text)
            self.assertEqual(result['line'], text)
            self.assertEqual([f['id'] for f in result['matches']], [expected])
            self.assertFalse(result['needs_review'])
        self.assertEqual(extract_line('unknown secret sauce')['matches'], [])
        self.assertEqual(extract_line('1 Prise Salz')['matches'][0]['level'], 'unknown')

    def test_catalog_aliases_have_no_conflicting_ids(self):
        seen = {}
        for food in FOODS:
            for alias in food['aliases']:
                normalized = ingredient_text(alias)
                self.assertIn(seen.get(normalized), (None, food['id']))
                seen[normalized] = food['id']


if __name__ == '__main__':
    unittest.main()
