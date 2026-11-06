# Great Ghoul Duel Mobile

**Game studio: Joy Haus** · *Ghost Duel* is the independent playable fan recreation in this repository.

An independent **preservation and recreation project** studying the gameplay of Google's *The Great Ghoul Duel* (Halloween 2018), with the goal of a playable browser game and eventually iOS and Android apps.

> **Current state (updated 2026-11-06):** `index.html` is a single-file playable alpha titled "Spooktacular Showdown: The Boo Crew (Alpha 33)". `.github/workflows/pages.yml` publishes it on every push to `main` (expected URL: https://magicalboyco.github.io/great-ghoul-duel-mobile/, not verified live). An experimental online-rooms relay (Cloudflare Worker) lives in `multiplayer/` with tests in CI. Phone testing is not documented here. The roadmap and code layout below predate this build; `apps/`, `server/`, `packages/` and `tests/` do not exist yet.
>
> **Names:** the repo is `great-ghoul-duel-mobile`, the current build title is *Spooktacular Showdown: The Boo Crew*, and the docs and attributions still say *Ghost Duel*.

## Goals

- Reproduce the 2018 two-team, eight-player, two-minute game loop: collect spirit flames, chain them behind ghosts, steal from opponents, deposit at base, and unlock upgrades.
- Preserve the original game feel through measured movement, visual design, animations, sound and map layout.
- Support touch controls on iPhone and iPad, plus Android and desktop browsers.
- Implement reliable bots and eventually online multiplayer and private rooms.
- Keep a readable, testable source tree and deploy a verified browser build with GitHub Pages.

## Known references

- [Official 2018 Halloween Doodle](https://doodles.google/doodle/halloween-2018/)
- [Custom community Java multiplayer server](https://github.com/JasonTheKitten/custom-ggd-server)
- [Original Ghost Playground prototype in Lovable](https://lovable.dev/projects/1a3002c4-6a10-4152-a534-f9e98a2cdf23)

## Development strategy

1. **Recover and audit client:** Move the structured Phaser 3 + TypeScript prototype out of Lovable; validate the code compiles and starts. Do not use the previous bare-bones single-file HTML demos as the main codebase.
2. **First real browser build:** Implement and test a landscape-oriented game that starts, moves on touch, collects flames, draws trails, deposits at base, and runs a 120-second match with bots. Add an automatic build check.
3. **Fidelity pass:** Inventory and compare the original 2018 maps, movement, power-up thresholds, UI, character animation and sound; fix discrepancies.
4. **Multiplayer:** Fork and harden the Java community server; validate entity ownership, movement, collisions, match lifecycle, reconnects and secure tokens.
5. **Mobile packaging:** Wrap the shared web client for iOS/Android after web gameplay is stable.

## Proposed code layout

```text
apps/game/             Phaser + TypeScript game and touch UI
server/java/           Hardened multiplayer server (later)
packages/protocol/     Shared networking definitions and fixtures
tests/                 Game and browser/mobile test suites
docs/                  Research, fidelity and asset provenance
```

## Asset and licensing policy

This is **not an official Google project**. Source code published under open-source licenses does not give us permission to distribute Google's original art, sound, characters or branding. Until rights are verified, use clearly labeled temporary/original assets, record their provenance, and keep reference material separate from distributable assets.

## Working from an iPhone/iPad

This repository can be managed in GitHub's browser interface; its web build will ultimately be tested using an HTTPS preview (not by opening an HTML attachment in Files). GitHub Pages hosting is a later step once the actual project builds.

## Status

- [x] Dedicated repository created
- [x] Project scope and architecture documented
- [ ] Structured Lovable client imported
- [ ] Build and touch smoke tests passing
- [x] Playable alpha build in `index.html` (single file; deployment URL not verified)
- [ ] Original-game fidelity validation
- [ ] Online multiplayer
- [ ] iOS and Android release
