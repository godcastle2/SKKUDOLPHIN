import random
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


class ProjectIntegrityTest(unittest.TestCase):
    def test_required_assets_have_expected_dimensions(self):
        expected = {
            "LOWPOLY_DOLPHIN.png": (1536, 1024),
            "ACADEMY_BACKGROUND.png": (1672, 941),
            "RING_LOWPOLY_THIN.png": (1024, 1536),
        }
        for filename, size in expected.items():
            with self.subTest(filename=filename), Image.open(ROOT / filename) as image:
                self.assertEqual(image.size, size)

    def test_dolphin_sprite_has_real_transparency(self):
        with Image.open(ROOT / "LOWPOLY_DOLPHIN.png").convert("RGBA") as image:
            alpha = image.getchannel("A")
            minimum, maximum = alpha.getextrema()
            self.assertEqual(minimum, 0)
            self.assertGreaterEqual(maximum, 250)
            self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_only_current_assets_are_referenced(self):
        game = (ROOT / "src" / "game.js").read_text(encoding="utf-8")
        styles = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("LOWPOLY_DOLPHIN.png", game)
        self.assertIn("ACADEMY_BACKGROUND.png", game)
        self.assertIn("RING_LOWPOLY_THIN.png", game)
        self.assertIn('if (half === "front")', game)
        self.assertIn("verticalDistance > openingHalfHeight", game)
        self.assertIn("cfg.capReleaseSpeed", game)
        self.assertNotIn("2RING.png", game + styles)
        self.assertIn("ACADEMY_BACKGROUND.png", styles)
        self.assertNotIn("DOLPHINIMAGE.png", game + styles)

    def test_ranking_ui_and_network_calls_are_removed(self):
        source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in [ROOT / "index.html", ROOT / "src" / "game.js"]
        ).lower()
        for removed_term in ["rankingpanel", "rankingbutton", "playername", "/api/rankings", "/api/scores"]:
            self.assertNotIn(removed_term, source)

    def test_link_preview_uses_current_korean_title(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        title = "명륜당 앞바다에 돌고래가 산다!"
        self.assertIn(f"<title>{title}</title>", html)
        self.assertIn(f'<meta property="og:title" content="{title}">', html)
        self.assertIn('<meta property="og:image" content="https://godcastle2.github.io/', html)
        self.assertNotIn("돌핀 링 러시", html)

    def test_player_facing_score_labels_are_korean(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        game = (ROOT / "src" / "game.js").read_text(encoding="utf-8")
        for label in ["점수", "연속 통과", "게임 종료", "총점", "최고 점수"]:
            self.assertIn(label, html)
        for label in ["완벽 통과!", "통과! +1", "연속 ${burst.combo}회"]:
            self.assertIn(label, game)
        for old_label in ["Clean Combo", "Game Over", ">Score<", ">Best<"]:
            self.assertNotIn(old_label, html)
        for old_label in ["CLEAN!", "HIT +1", "COMBO x"]:
            self.assertNotIn(old_label, game)

    def test_pages_workflow_deploys_main_branch(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("branches: [main]", workflow)
        self.assertIn("actions/configure-pages@v5", workflow)
        self.assertIn("actions/upload-pages-artifact@v4", workflow)
        self.assertIn("actions/deploy-pages@v4", workflow)

    def test_speed_multiplies_every_ten_points_without_cap(self):
        speed = lambda score: 255 * (1.3 ** (score // 10))
        self.assertEqual(speed(0), 255)
        self.assertEqual(speed(9), 255)
        self.assertAlmostEqual(speed(10), 331.5)
        self.assertAlmostEqual(speed(20), 430.95)
        self.assertAlmostEqual(speed(30), 560.235)
        self.assertGreater(speed(1000), 415)

    def test_spawn_formula_reaches_upper_and_lower_areas(self):
        random.seed(20260928)
        minimum, maximum = 80, 420
        last = 270
        samples = []
        for _ in range(500):
            target = minimum + random.random() * (maximum - minimum)
            blended = last + (target - last) * 0.9
            drift = (random.random() * 2 - 1) * 40
            last = max(minimum, min(maximum, blended + drift))
            samples.append(last)
        self.assertLess(min(samples), 130)
        self.assertGreater(max(samples), 370)
        self.assertTrue(all(minimum <= value <= maximum for value in samples))

    def test_landscape_ring_spawns_fully_beyond_visible_world(self):
        viewport_width = 844
        scale = min(viewport_width / 960, 390 / 540)
        visible_world_right = max(960, viewport_width / scale)
        ring_outer_radius = 73
        spawn_x = visible_world_right + ring_outer_radius + 70
        self.assertGreater(spawn_x - ring_outer_radius, visible_world_right)
        self.assertGreater(visible_world_right, 960)

    def test_late_game_height_changes_are_larger(self):
        previous = 270
        target = 100
        early_change = abs((previous + (target - previous) * 0.55) - previous)
        late_change = abs((previous + (target - previous) * 0.9) - previous)
        self.assertGreater(late_change, early_change)

    def test_speed_growth_affects_spatial_gap_at_thirty_percent(self):
        start_speed = 255
        faster_speed = 399
        speed_ratio = faster_speed / start_speed
        expected_gap_ratio = 1 + (speed_ratio - 1) * 0.3
        compensated_interval_ratio = expected_gap_ratio / speed_ratio
        actual_gap_ratio = speed_ratio * compensated_interval_ratio
        self.assertAlmostEqual(actual_gap_ratio, expected_gap_ratio)
        self.assertLess(actual_gap_ratio, speed_ratio)


if __name__ == "__main__":
    unittest.main()
