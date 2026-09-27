import contextlib
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def free_port():
    with contextlib.closing(socket.socket()) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class BrowserSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not EDGE.exists():
            raise unittest.SkipTest("Microsoft Edge is not installed")
        cls.port = free_port()
        cls.server = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT,
            env={**__import__("os").environ, "PORT": str(cls.port)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        for _ in range(40):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Test server did not start")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=str(EDGE),
            headless=True,
            args=["--disable-gpu"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.terminate()
        cls.server.wait(timeout=5)

    def open_page(self, viewport):
        context = self.browser.new_context(viewport=viewport, device_scale_factor=1)
        page = context.new_page()
        console_errors = []
        failed_requests = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("requestfailed", lambda request: failed_requests.append(request.url))
        response = page.goto(self.base_url, wait_until="networkidle")
        self.assertEqual(response.status, 200)
        return context, page, console_errors, failed_requests

    def test_desktop_assets_canvas_and_game_flow(self):
        context, page, console_errors, failed_requests = self.open_page({"width": 960, "height": 540})
        try:
            self.assertEqual(page.title(), "돌핀 링 러시")
            self.assertTrue(page.locator("#startPanel").is_visible())
            self.assertEqual(page.locator("#rankingPanel").count(), 0)
            self.assertEqual(page.locator("#playerName").count(), 0)

            loaded_assets = page.evaluate("""
                () => Promise.all([
                  './LOWPOLY_DOLPHIN.png?v=20260928-2',
                  './ACADEMY_BACKGROUND.png?v=20260928-2',
                  './2RING.png?v=20260928-2'
                ].map(async url => ({ url, status: (await fetch(url)).status })))
            """)
            self.assertTrue(all(asset["status"] == 200 for asset in loaded_assets), loaded_assets)

            page.locator("#startButton").click()
            self.assertFalse(page.locator("#startPanel").is_visible())
            page.wait_for_timeout(2300)
            canvas_stats = page.locator("#game").evaluate("""
                canvas => {
                  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                  let opaque = 0;
                  let changing = 0;
                  for (let i = 0; i < data.length; i += 160) {
                    if (data[i + 3] > 0) opaque++;
                    if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) changing++;
                  }
                  return { opaque, changing, width: canvas.width, height: canvas.height };
                }
            """)
            self.assertGreater(canvas_stats["opaque"], 500)
            self.assertGreater(canvas_stats["changing"], 500)
            self.assertGreater(canvas_stats["width"], 0)
            self.assertGreater(canvas_stats["height"], 0)

            page.mouse.click(300, 300)
            page.wait_for_timeout(150)
            self.assertEqual(page.locator("#score").text_content(), "0")

            page.locator("#gameOverPanel").wait_for(state="visible", timeout=10000)
            self.assertTrue(page.locator("#gameOverPanel").is_visible())
            self.assertEqual(page.locator("#finalScore").text_content(), page.locator("#score").text_content())
            page.locator("#restartButton").click()
            self.assertFalse(page.locator("#gameOverPanel").is_visible())
            self.assertEqual(page.locator("#score").text_content(), "0")

            self.assertFalse(console_errors, console_errors)
            self.assertFalse(failed_requests, failed_requests)

            self.assertEqual(context.request.get(f"{self.base_url}/healthz").status, 200)
            self.assertEqual(context.request.get(f"{self.base_url}/api/rankings").status, 404)
            self.assertEqual(context.request.get(f"{self.base_url}/api/scores").status, 404)
        finally:
            context.close()

    def test_mobile_layout_has_no_overflow_or_ranking_ui(self):
        context, page, console_errors, failed_requests = self.open_page({"width": 390, "height": 844})
        try:
            panel = page.locator("#startPanel").bounding_box()
            self.assertIsNotNone(panel)
            self.assertGreaterEqual(panel["x"], 0)
            self.assertLessEqual(panel["x"] + panel["width"], 390)
            self.assertGreaterEqual(panel["y"], 0)
            self.assertLessEqual(panel["y"] + panel["height"], 844)
            self.assertEqual(page.locator("text=랭킹").count(), 0)
            self.assertFalse(page.evaluate("document.documentElement.scrollWidth > innerWidth"))
            self.assertFalse(page.evaluate("document.documentElement.scrollHeight > innerHeight"))
            self.assertFalse(console_errors, console_errors)
            self.assertFalse(failed_requests, failed_requests)
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()
