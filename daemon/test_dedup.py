import unittest

from daemon.main import Event, _accumulate, _dedup_hash

TS = "2026-06-16T12:00:00+00:00"
TS_SAME_DAY = "2026-06-16T18:30:00+00:00"
TS_NEXT_DAY = "2026-06-17T09:00:00+00:00"


def desktop(metadata, ts=TS):
    return Event(
        source="desktop",
        activity_type="paper_read",
        timestamp=ts,
        engaged_secs=90,
        metadata=metadata,
    )


class TestDedup(unittest.TestCase):
    def test_desktop_one_row_per_pdf(self):
        a = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}))
        b = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "b.pdf"}))
        # Different PDFs in the same app -> different rows.
        self.assertNotEqual(a, b)

    def test_same_pdf_same_day_collapses(self):
        a = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}))
        a2 = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}, ts=TS_SAME_DAY))
        self.assertEqual(a, a2)

    def test_same_pdf_next_day_is_new_row(self):
        a = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}))
        a_next = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}, ts=TS_NEXT_DAY))
        self.assertNotEqual(a, a_next)

    def test_same_pdf_different_app_differs(self):
        foxit = _dedup_hash(desktop({"app": "Foxit PDF Reader", "title": "a.pdf"}))
        acro = _dedup_hash(desktop({"app": "Adobe Acrobat", "title": "a.pdf"}))
        self.assertNotEqual(foxit, acro)

    def test_paper_id_still_dedups_cross_source(self):
        # paper_id takes precedence over app/title and source.
        h1 = _dedup_hash(desktop({"paper_id": "2401.00001", "app": "Foxit PDF Reader", "title": "x"}))
        h2 = _dedup_hash(
            Event(
                source="browser",
                activity_type="paper_read",
                timestamp=TS,
                engaged_secs=90,
                metadata={"paper_id": "2401.00001", "url": "https://arxiv.org/abs/2401.00001"},
            )
        )
        self.assertEqual(h1, h2)

    def test_app_without_title_still_works(self):
        h = _dedup_hash(desktop({"app": "Adobe Acrobat"}))
        self.assertIsInstance(h, str)
        self.assertEqual(len(h), 64)


class TestAccumulate(unittest.TestCase):
    def test_sums_engaged_secs_across_sessions(self):
        rows = [{"dedup_hash": "h1", "engaged_secs": 90, "timestamp": TS_SAME_DAY}]
        prior = {"h1": {"dedup_hash": "h1", "engaged_secs": 90, "timestamp": TS}}
        out = _accumulate(rows, prior)
        self.assertEqual(out[0]["engaged_secs"], 180.0)
        # earliest start is kept
        self.assertEqual(out[0]["timestamp"], TS)

    def test_no_prior_leaves_row_unchanged(self):
        rows = [{"dedup_hash": "h2", "engaged_secs": 45, "timestamp": TS}]
        out = _accumulate(rows, {})
        self.assertEqual(out[0]["engaged_secs"], 45)
        self.assertEqual(out[0]["timestamp"], TS)

    def test_does_not_mutate_inputs(self):
        rows = [{"dedup_hash": "h1", "engaged_secs": 90, "timestamp": TS}]
        prior = {"h1": {"engaged_secs": 90, "timestamp": TS}}
        _accumulate(rows, prior)
        # original row still holds the window-only value (safe to re-buffer)
        self.assertEqual(rows[0]["engaged_secs"], 90)


if __name__ == "__main__":
    unittest.main()
