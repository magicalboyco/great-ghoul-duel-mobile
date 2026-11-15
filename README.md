# Spooktacular Showdown — The Boo Crew

**A Joy Haus game.** Little ghosts, big competition: collect wandering spirit flames, carry them home to your base, and steal your rivals' trails before time runs out.

**Play it:** <https://jonathanjoyner.com/ghost/> (also <https://magicalboyco.github.io/great-ghoul-duel-mobile/>)

> **Current state: Alpha 35, playable in any modern browser.** Runs on iPhone, Android and desktop. Install it from the browser to get an app-like, full-screen window (iPhone: Share → Add to Home Screen; Android: Install app).

## What's in the game

- **Pick a color, pick a ghost, press Play.** Seven pastel team colors (plus an optional high-contrast palette) and eight Boo Crew characters.
- **Three modes:** Four-Way Haunt (four teams, larger cemetery), Classic Duel (two teams, up to eight players) and Boo Crew Co-op (friends vs. rival bots).
- **Play with friends:** create a private room, share the invite link, and friends join with one tap. The host's browser runs the game, so the host has to keep their tab open. Group rematch voting is supported.
- **Powers from carried flames:** Speed at 8, Glow at 23, Magnet at 53, Phase at 113. They reset after a deposit or loss.
- **Solo play** against Easy, Normal or Hard bots, a Top 13 high-score board, original generated music and sound effects.
- Optional nickname, accessibility-minded options (high-contrast colors, pinch zoom left enabled).

## Run it locally

No build step. It is a single `index.html` plus a few assets.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Tests

```bash
cd multiplayer
node --test tests/*.test.mjs
```

The suite checks the multiplayer Worker (rooms, rematch voting, leaderboard) and pins key behaviors of the game page. CI runs it on every pull request.

## How it's put together

| Path | What it is |
| --- | --- |
| `index.html` | The whole game: menu, canvas rendering, bots, audio, lobby and match logic |
| `multiplayer/` | Cloudflare Worker + Durable Object that hosts private rooms and the shared Top 13 |
| `assets/` | Backdrop art, icons (SVG and PNG for home-screen install) |
| `manifest.webmanifest` | Web app install metadata |
| `preview/fourway/` | Old preview address; forwards to the game and keeps invite codes |
| `.github/workflows/` | Pages publishing and test automation |

Pushes to `main` are published automatically with GitHub Pages. The multiplayer Worker deploys through Cloudflare Workers Builds.

## Known limits

- Multiplayer is an experiment: the host runs the physics, there is no reconnecting, and there is no anti-cheat. High scores are unverified.
- Audio is generated in the browser; iPhone Safari occasionally needs a tap to wake sound (use **Test sound**).

## Roadmap

- [x] Playable web game with bots, rooms, rematches and high scores
- [x] Redesigned, low-text menu (color first, one big Play button)
- [x] Installable web app icons
- [ ] Confirm audio and touch controls on physical iPhone and Android devices
- [ ] Original-art and audio provenance review before any app-store submission
- [ ] iOS and Android store builds (wrap the web game; needs developer accounts)

## Credits and licensing

Thank you to the creators of Google's 2018 Halloween Doodle, whose ghost game inspired the idea of collecting and stealing spirit flames. Spooktacular Showdown is an independent game and is not affiliated with, sponsored or endorsed by Google.

Its graphics are drawn at runtime and its music and effects are synthesized in the browser; no third-party art, music recordings or code from that inspiration are included. Record the provenance of any asset you add in `ATTRIBUTIONS.md`, and don't reuse anyone's original art, sound, characters or branding without verified permission.
