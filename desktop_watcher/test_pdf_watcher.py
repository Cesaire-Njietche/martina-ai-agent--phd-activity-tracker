import unittest
from datetime import datetime, timedelta, timezone

from pdf_watcher import SessionTracker, clean_title, match_app, run

T0 = datetime(2026, 6, 16, 12, 0, 0, tzinfo=timezone.utc)


class TestMatchApp(unittest.TestCase):
    def test_foxit_variants(self):
        for name in ["Foxit PDF Reader", "FoxitPDFReader.exe", "FoxitReader", "Foxit Reader"]:
            self.assertEqual(match_app(name), "Foxit PDF Reader", name)

    def test_acrobat_variants(self):
        for name in ["Adobe Acrobat", "Acrobat Reader", "AcroRd32.exe", "Acrobat", "Acrobat.exe"]:
            self.assertEqual(match_app(name), "Adobe Acrobat", name)

    def test_non_matches(self):
        for name in ["chrome.exe", "Code.exe", "Notepad", "", None]:
            self.assertIsNone(match_app(name))


class TestCleanTitle(unittest.TestCase):
    def test_strips_foxit_suffix(self):
        self.assertEqual(clean_title("thesis.pdf - Foxit PDF Reader"), "thesis.pdf")

    def test_strips_acrobat_suffix(self):
        self.assertEqual(
            clean_title("report final.pdf - Adobe Acrobat Reader (64-bit)"),
            "report final.pdf",
        )

    def test_no_suffix(self):
        self.assertEqual(clean_title("paper.pdf"), "paper.pdf")

    def test_only_app_name_falls_back(self):
        self.assertEqual(clean_title("Foxit PDF Reader"), "Foxit PDF Reader")


class TestSessionTracker(unittest.TestCase):
    def test_emits_after_threshold_on_focus_loss(self):
        tr = SessionTracker(threshold_secs=90)
        self.assertIsNone(tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0))
        # still focused at +91s -> no emit yet
        self.assertIsNone(
            tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0 + timedelta(seconds=91))
        )
        # focus lost at +95s -> emit
        ev = tr.tick(None, "", T0 + timedelta(seconds=95))
        self.assertIsNotNone(ev)
        self.assertEqual(ev["source"], "desktop")
        self.assertEqual(ev["activity_type"], "paper_read")
        self.assertEqual(ev["timestamp"], T0.isoformat())
        self.assertGreaterEqual(ev["engaged_secs"], 90)
        self.assertEqual(ev["metadata"]["app"], "Foxit PDF Reader")
        self.assertEqual(ev["metadata"]["title"], "a.pdf")
        self.assertEqual(ev["metadata"]["raw_title"], "a.pdf - Foxit PDF Reader")

    def test_no_emit_below_threshold(self):
        tr = SessionTracker(threshold_secs=90)
        tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0)
        ev = tr.tick(None, "", T0 + timedelta(seconds=30))
        self.assertIsNone(ev)

    def test_title_change_ends_old_and_starts_new(self):
        tr = SessionTracker(threshold_secs=90)
        tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0)
        # New PDF after 100s: emit the old session, start new immediately.
        ev = tr.tick(
            "Foxit PDF Reader", "b.pdf - Foxit PDF Reader", T0 + timedelta(seconds=100)
        )
        self.assertIsNotNone(ev)
        self.assertEqual(ev["metadata"]["title"], "a.pdf")
        # New session (b.pdf) lost after only 10s -> no emit.
        ev2 = tr.tick(None, "", T0 + timedelta(seconds=110))
        self.assertIsNone(ev2)

    def test_app_switch_ends_old(self):
        tr = SessionTracker(threshold_secs=90)
        tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0)
        ev = tr.tick("Adobe Acrobat", "b.pdf - Adobe Acrobat", T0 + timedelta(seconds=120))
        self.assertIsNotNone(ev)
        self.assertEqual(ev["metadata"]["app"], "Foxit PDF Reader")

    def test_continuing_same_session_no_emit(self):
        tr = SessionTracker(threshold_secs=90)
        tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0)
        for s in range(1, 200):
            self.assertIsNone(
                tr.tick("Foxit PDF Reader", "a.pdf - Foxit PDF Reader", T0 + timedelta(seconds=s))
            )


class TestRunLoop(unittest.TestCase):
    def test_run_emits_one_event_then_drives_post(self):
        # 95 ticks of Foxit focused, then focus lost.
        seq = [("FoxitPDFReader.exe", "thesis.pdf - Foxit PDF Reader")] * 95 + [(None, None)] * 2
        it = iter(seq)

        def gw():
            try:
                return next(it)
            except StopIteration:
                return (None, None)

        times = iter([T0 + timedelta(seconds=s) for s in range(0, 200)])
        posted = []
        run(
            get_window=gw,
            post=lambda e: posted.append(e) or True,
            poll_interval=0,
            threshold_secs=90,
            clock=lambda: next(times),
            sleep=lambda _: None,
            iterations=97,
        )
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0]["source"], "desktop")
        self.assertEqual(posted[0]["metadata"]["title"], "thesis.pdf")
        self.assertGreaterEqual(posted[0]["engaged_secs"], 90)


if __name__ == "__main__":
    unittest.main()
