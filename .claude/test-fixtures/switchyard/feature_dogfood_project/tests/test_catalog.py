import unittest
from catalog import lookup


class CatalogTests(unittest.TestCase):
    def test_existing_exact_lookup(self):
        self.assertEqual(lookup("Notebook"), 12)
        self.assertEqual(lookup("Pencil"), 3)

    def test_existing_case_sensitive_and_missing(self):
        self.assertIsNone(lookup("notebook"))
        self.assertIsNone(lookup("missing"))
        self.assertIsNone(lookup("Note"))

    def test_optional_case_insensitive_exact_lookup(self):
        self.assertEqual(lookup("notebook", ignore_case=True), 12)
        self.assertEqual(lookup("DESK LAMP", ignore_case=True), 25)
        self.assertEqual(lookup("pEnCiL", ignore_case=True), 3)
        self.assertIsNone(lookup("Note", ignore_case=True))
        self.assertIsNone(lookup("missing", ignore_case=True))
        self.assertIsNone(lookup("notebook", ignore_case=False))


if __name__ == "__main__":
    unittest.main()
