# Ghost Duel — Attribution and Gratitude Register

Updated for Alpha 14 (2026-11-02).

This document distinguishes **inspiration and thanks**, **materials currently included in the playable build**, and **third-party source code or media actually incorporated**. Appreciation is not a substitute for license compliance.

## Original gameplay inspiration — not bundled assets

- **Google, The Great Ghoul Duel (Halloween 2018)** — central reference for the two-team, eight-ghost, two-minute spirit-flame collection/deposit/steal mechanics and individual end-of-match superlatives. [Official Doodle and complete original credits](https://doodles.google/doodle/halloween-2018/). The game thanks the artists, musicians, producers, designers, engineers, and Google Cloud contributors listed there.
- The independent project is **not affiliated with or endorsed by Google**. Original Google Doodle artwork, music recordings, characters, or code must not be copied into the distributable game without independent rights verification.
- **My Little Pony** — named as a broad example of cheerful pastel fantasy aesthetics that influenced the color palette; no franchise artwork, characters, music, or logo is intentionally included. No affiliation with Hasbro.

## Code and graphics currently shipped

- The current playable web build is the project's own JavaScript/HTML/CSS single-page implementation at [index.html](https://github.com/magicalboyco/great-ghoul-duel-mobile/blob/main/index.html). Game graphics and ghost portraits are drawn at runtime in Canvas/SVG; no original Google Doodle assets are embedded in this build.
- Browser APIs used include Canvas 2D, Web Audio, pointer events, and standard JavaScript. Browser APIs are not themselves third-party code redistributed by the game.
- **JasonTheKitten's custom-ggd-server** — a community source and historical multiplayer reference at https://github.com/JasonTheKitten/custom-ggd-server. The current Alpha 14 single-page game does not bundle this repository or claim its source code was incorporated. Check its exact license and requirements before reusing any code in the planned multiplayer server.
- An earlier [Lovable prototype](https://lovable.dev/projects/1a3002c4-6a10-4152-a534-f9e98a2cdf23) helped inform project exploration. It is cited as project history, not as proof of copied code in the current file.

## Music and sound currently shipped

- **Moonlit Mischief** — game-specific synthesized melody and effects implemented in `index.html` using Web Audio: main loop, hurry-up sequence, and end-of-match sound effects. The musical note patterns are declared directly in the game source and rendered into audio buffers by the browser.
- **No external sound recordings, identified public-domain tracks, or identified Creative Commons-licensed music files are included in Alpha 14.** Therefore no particular external composer, song, recording, or license is falsely listed as an incorporated asset.
- Respect and gratitude are extended to public-domain musicians, archivists, and Creative Commons artists generally, while keeping a verifiable attribution record for any files later introduced.

## AI and creative assistance

- OpenAI ChatGPT was used in the iterative creative and coding workflow; conversational assistance does not provide a reliable list of all copyrighted works present in any AI system's training data.
- Thank you to the researchers, engineers, designers, evaluators, tool builders, open-source contributors and human artists behind the technologies that aid development.
- Do **not** present any unverified song, artist, recording, or image as a training-data source for an AI model.

## Future third-party asset procedure

For each externally sourced asset actually added, record:

| Field | Required value |
|---|---|
| Asset | Exact title/filename and where used |
| Creator | Credited author or organization |
| Source | Direct original URL and retrieval date |
| License / status | Exact license name, version, or verified public-domain basis and jurisdiction if relevant |
| Changes | Cropped, recolored, remixed, adapted, etc. |
| Attribution | Wording and link required by its specific license |
| Verification | Whether the asset is authorized for distribution in this build |

Creative Commons licenses differ: some require attribution, a link to the license, and changes notices; NC and ND restrictions can affect compatibility with intended use. CC0 and public-domain claims should still be verified for the specific work and recording. Record all third-party dependencies and licenses before publication.

We are grateful for the work, ideas, and communities behind games and music — and for everyone who plays this one.
