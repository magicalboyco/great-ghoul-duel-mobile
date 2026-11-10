# Spooktacular Showdown — The Boo Crew

**Game studio: Joy Haus** · An independent, colorful ghost arcade game for phones, tablets and desktop browsers.

Two teams of ghosts race around a haunted graveyard collecting spirit flames, chaining them behind their ghost, stealing from rivals, and depositing them at base before time runs out. Play solo against computer ghosts, or open an online room for up to eight players.

## Play

The playable build is published with GitHub Pages from this repository (see the workflow in `.github/workflows/pages.yml`). Open the Pages URL in any modern browser.

- **Solo:** choose a ghost and start a match against computer opponents.
- **Online:** one player hosts a private room and shares the six-character code. Other players join with the same code. The host's browser runs the match, so the host must keep the game open.

## Status

- [x] Playable single-page web build (`index.html`)
- [x] Solo mode with computer ghosts
- [x] Private online rooms through a Cloudflare Worker (`multiplayer/`)
- [x] Automated room tests (`multiplayer/tests/`)
- [ ] Verified end-to-end test of four-way rooms across real devices
- [ ] Reconnection, abuse controls and anti-cheat for public launch

The `preview/fourway/` build is the newer four-team preview and is not yet the default.

## Multiplayer server and tests

Setup and deployment notes for the room server are in [`multiplayer/README.md`](multiplayer/README.md). To run the tests locally with Node.js 22:

```sh
node --check multiplayer/src/worker.js
node --test multiplayer/tests/*.test.mjs
```

## Credits and licenses

See [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) for the current provenance record. All art is drawn at runtime and all music and effects are synthesized in the browser, so no third-party recordings or artwork are bundled. The code is released under the MIT License (see `LICENSE`).
