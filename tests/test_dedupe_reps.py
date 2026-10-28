import unittest
from unittest.mock import patch

from app import dedupe


class BurstRepresentativeTests(unittest.TestCase):
    def groups(self):
        return [
            [
                {"rank": 1, "photos": ["a"]},
                {"rank": 2, "photos": ["b"]},
                {"rank": 3, "photos": ["c"]},
                {"rank": 4, "photos": ["d"]},
                {"rank": 5, "photos": ["e"]},
            ],
            [
                {"rank": 1, "photos": ["g", "h"]},  # RAW+JPG 算一个对象
                {"rank": 2, "photos": ["i"]},
                {"rank": 3, "photos": ["j"]},
                {"rank": 4, "photos": ["k"]},
            ],
        ]

    def test_only_three_representatives_per_burst_group(self):
        ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]
        with patch.object(dedupe, "_detect", return_value=self.groups()):
            selected, skipped = dedupe.screening_representatives("act", ids, 3)
        self.assertEqual(selected, ["a", "b", "c", "f", "g", "h", "i", "j"])
        self.assertEqual(skipped, ["d", "e", "k"])
        self.assertEqual(len([x for x in selected if x != "f"]), 7)

    def test_unrelated_singles_are_always_sent(self):
        ids = ["solo", "a", "b", "c", "d"]
        with patch.object(dedupe, "_detect", return_value=[[
            {"rank": 1, "photos": ["a"]}, {"rank": 2, "photos": ["b"]},
            {"rank": 3, "photos": ["c"]}, {"rank": 4, "photos": ["d"]},
        ]]):
            selected, skipped = dedupe.screening_representatives("act", ids, 3)
        self.assertEqual(selected, ["solo", "a", "b", "c"])
        self.assertEqual(skipped, ["d"])


if __name__ == "__main__":
    unittest.main()
