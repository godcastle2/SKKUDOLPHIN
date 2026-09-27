# Dolphin Ring Rush

Mobile web game where players guide a dolphin through rings and compete on an online leaderboard.

## Local Run

```bash
python server.py
```

Open:

- PC: `http://localhost:8000`
- Phone on same Wi-Fi: `http://<PC-IP>:8000`
- QR page: `http://<PC-IP>:8000/qr.html`

## Public Deployment

The game is deployed as a static site with GitHub Pages. Every push to `main`
triggers `.github/workflows/pages.yml` and updates the public game automatically.

Public URL:

```text
https://godcastle2.github.io/eskaradolphingame/
```

In the GitHub repository, set **Settings > Pages > Source** to **GitHub Actions**
once. After that, the game remains available even when the development PC is off.

## Files

- `index.html`: game UI
- `qr.html`: QR share page
- `src/config.js`: physics, difficulty, ring, and visual tuning
- `src/game.js`: canvas rendering, controls, scoring, and collision handling
- `src/physics.js`: lightweight game physics helpers
- `src/styles.css`: mobile UI styling
- `server.py`: static file server
- `tests/physics_test.py`: physics regression tests

- `GET /healthz`: deployment health check

## Notes

- For real events, use the deployed public URL in the QR code.
