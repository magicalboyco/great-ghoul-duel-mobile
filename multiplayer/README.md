# Boo Crew — Alpha 14 online-room prototype

This is an **opt-in experimental mode**. The existing Alpha 13 solo game stays unchanged.

## Deploy the multiplayer relay
1. From this repository, go to the `multiplayer` directory.
2. With Node.js installed, run `npx wrangler login`, then `npx wrangler deploy`.
3. Copy the printed `https://ghost-duel-rooms.<subdomain>.workers.dev` URL.
4. Open the Boo Crew menu, paste that URL in the **Online multiplayer** server field, and select **Create room**. Share the six-character room code. Other players enter the same server URL and room code and select **Join room**.
5. The host selects **Start online match**. Remaining seats are bots. Up to eight humans can play (four per team).

The Workers Free plan supports SQLite-backed Durable Objects. See https://developers.cloudflare.com/durable-objects/ and https://developers.cloudflare.com/durable-objects/best-practices/websockets/.

## Architecture & limitations
- One Durable Object per room assigns fixed player seats and relays inputs and host snapshots.
- The **host browser** executes the existing 60-Hz Alpha 13 simulation. All participating browsers render its game snapshots. This ensures score and collision consistency for a cooperative prototype, but is not anti-cheat secure.
- An open host browser is required throughout the game. On host departure the room ends; guest departures revert to bots.
- The mode does not yet offer reconnect, matchmaking, usernames, persistent rooms, or server-authoritative anti-cheat physics.
- Room codes are discovery-only, not access-control secrets. Share only with trusted friends.
- The relay currently accepts cross-origin WebSockets to allow GitHub Pages; for public launch implement explicit origin allowlisting and rate limits.
- A public game should move authoritative simulation and security checks to the Durable Object before competitive multiplayer.
- The server URL is stored in local browser storage, so players need to configure it once per device.

## Validation
After deploying, check `/health` on your Worker. Two browsers should see assigned seats, matching scores, ghost positions, trails and the same 120-second match. Verify the solo **Start Game** path still works, that remote controls steer the guest's ghost, and that closing a guest browser leaves a bot.

**Do not point the game at an arbitrary worker URL.** Only use your own deployment.

## Cloudflare Workers Builds (Git integration)

Build root directory: `/multiplayer`.
Build command: none.
Deploy command: `npx wrangler deploy`.
Configuration file: `multiplayer/wrangler.jsonc` (relative to repository root).

The initial setup build ran before the Wrangler configuration file was committed
to `main`. This README commit is made after both server files are present and
triggers a new GitHub-connected build when automatic deployments are enabled.

## Retrying after the initial setup failure

The first Cloudflare build (#f65e76e7) cloned the repository before the
`multiplayer/wrangler.jsonc` configuration was added to `main`.
That historical build cannot deploy the complete Worker. A new push to
`main`, such as this documentation update, lets Cloudflare Workers Builds
pick up the current `multiplayer` directory from the configured production
branch. Look for a **new build ID** in Cloudflare's Deployments list rather
than the old error screen. If none appears, verify Git integration triggers
and the build API token in Settings → Builds.

## Alpha 18 — Top 13 Hall of Fame

The game now offers a **Top 13 High Scores** screen in the start menu and
after a match. A winning human player can submit their own *banked spirit
flames* (not the combined team score), with a 1–13-character nickname,
a manually chosen country flag, and the Boo Crew costume and color worn
in that match. The portrait is drawn from the game's own SVG artwork:
players do not upload photographs.

The existing `ghost-duel-rooms` Worker exposes:
- `GET /leaderboard`: top 13 public entries, descending by score
- `POST /leaderboard`: validated JSON fields `name`, `country` (ISO alpha-2),
  `styleId` (0–7), `color` (from the game's palette), and `score` (positive
  integer up to 99,999)
- `OPTIONS /leaderboard`: cross-origin browser preflight

Only nickname, chosen flag, in-game character and color, numeric score,
server timestamp and random row ID are stored in the Durable Object.
The implementation does not collect account identifiers, precise location,
contact details, or photos. Names and flags are self-reported.

**Leaderboard integrity:** This is a *casual*, player-submitted leaderboard,
not a server-authoritative competitive ranking. Match results can be
fabricated by modified game clients. Do not use it for prizes until the
game simulation and score submission are authenticated on the server.
Moderation, abuse throttling and report/remove controls should be added
before actively promoting a public worldwide leaderboard.

**Offline fallback:** Without a configured Worker URL, or if the Worker is
unavailable, scores appear in a clearly labeled device-only Top 13 stored
in browser localStorage. These are *not* shared or automatically synced.

**Deploy:** Commit and deploy both the updated HTML game and Worker source.
The leaderboard reuses the existing `GHOST_ROOMS` Durable Object binding
with a separately named instance and storage key; no new migration is
required. Open `/leaderboard` on the deployed Worker to verify its JSON
response before inviting players to submit scores.

## Alpha 19 — Explicit private room creation and richer graveyard art

The game now draws distinct carved gravestones, curved jack-o'-lanterns,
arched mausoleums and low vaulted crypts in Canvas. All original wall and
collision rectangles are unchanged, so physics stays the same.

Room creation is **server-owned** rather than implicit WebSocket behavior:

1. The host presses **Create room**. The browser sends `POST /rooms`.
2. The Worker generates a six-character room code and a separate, secret
   48-character host token. It reserves the code in a Durable Object
   (`room-<CODE>`). The host token is kept only in this page's session.
3. The host connects to `/room/<CODE>` and sends a WebSocket
   `hello` message with `role: host` and the private token.
4. Guests use `GET /rooms/<CODE>` to verify the room exists, then connect
   to the same socket with `hello` and `role: guest`, **without** a token.
5. The room coordinator assigns the host seat 0 and guests the remaining
   seats. A guest cannot take the host seat, start a match, or create a
   room accidentally by guessing a code.
6. The lobby shows a distinct 8-seat roster and shareable code. The invite
   link contains the room code only, never the host token.

New unoccupied rooms expire after one hour. Closing the host connection
closes the guest sessions and removes the reservation. No account-specific
Worker URL or credentials are committed in the client.

Before using the feature, point the game at the **updated** deployed Worker
in the menu's Cloudflare server field. Earlier server deployments do not
support `POST /rooms` or `GET /rooms/<CODE>`, so the new lobby cannot
connect until the corresponding Worker code is deployed.

### Testing

Automated, no-dependency Node.js regression tests:
`node --test multiplayer/tests/*.test.mjs`

The tests cover creating a code and host credential, finding/not finding
rooms, guest seat allocation, rejecting wrong host credentials, forbidding
guest match starts, allowing verified host starts, movement message relay,
host shutdown, origin checks, and preservation of the Top 13 endpoint.
GitHub Actions runs these on pull requests and production pushes.

A real two-device WebSocket test is **still required** after deploying
the server and game. This is a beta prototype with host-authoritative
gameplay, not a cheat-resistant public matchmaking platform.

## Alpha 20 — Real human-controlled ghosts

Online rooms have the same eight ghost seats as solo play. Only occupied
seats should receive human joystick input; vacant seats use computer AI.

Before this fix, the host could fall back to computer control for a **still
connected** friend when input updates arrived late. That made multiplayer
look as though everyone was playing separate single-player games.

The corrected client and Worker now:

- Mark connected human seats explicitly and never run bot AI for them.
  Stale input instead gives a neutral/no-motion direction.
- Relay movement updates with monotonically increasing sequence numbers;
  the host acknowledges accepted controls and the guest displays connection
  health.
- Show a clear in-game room indicator listing code, host/guest role,
  real-player count, bot count, and guest control connection status.
- Label real ghosts in the shared arena with visible YOU / PLAYER tags.
- Relay each person's selected Boo Crew costume and pastel color in the
  lobby, and preserve that identity in shared state snapshots.
- Permit character and color selection updates before the host starts,
  without altering the other team's score or collision physics.

Test command: `node --test multiplayer/tests/*.test.mjs`. Regression
coverage now includes human-versus-bot seat ownership, delayed joystick
input, per-seat profiles, input delivery to the authoritative host, and
return acknowledgments.

**Important:** passing automated tests alone does not confirm end-to-end
networking between real browsers. The Cloudflare Worker and GitHub Pages
game need to deploy the same revision, followed by a real two-device
check in the SAME room code. Both screens must show the same room code,
the same shared score and timer, and real-player indicators. The guest
should steer one ghost on the host's display.

The game remains host-authoritative, experimental multiplayer.

## Alpha 23 — Unique cast, better props, and phone layout

The full Boo Crew ensemble now has exactly **one of each of the eight
character costumes** per online round. Human selections are resolved
before computer-controlled seats. If two humans request the same character,
the lower-numbered seat keeps their choice and the other is assigned the
first available costume, with an in-game explanation. Only the **costume**
changes: colors are still team-uniform colors, player control/seat/team
are unchanged, and every player keeps a personal pastel accent.

The old gray collision pillars were still being drawn as rectangular
placeholders. Alpha 23 introduces `drawGothicPillar()` with a carved arch,
tapered top, and a mossy base, *inside the original collision rectangle*.
The two large pumpkins at the edges of `assets/boo-crew-night.svg`
have separate curved lobes, carved glowing faces, stems, and shading.
No physical walls or scoring rules were changed.

On mobile, the canvas adapts to the changing visible viewport height,
with a portrait-specific camera scale that avoids showing empty world
outside the scene, and smaller phone HUD/joystick. The original browser
address bars are owned by Safari, not by the game. Players can select
**Share → Add to Home Screen** to launch the game in standalone mode.
`manifest.webmanifest` and `assets/boo-crew-icon.svg` support
that option. Browser-based play remains available.

Run `node --test multiplayer/tests/*.test.mjs` to verify the costume
resolver, curved environment props, unchanged collision rules,
viewport settings, and existing online networking.

Live acceptance check: two humans choosing the **same** Boo Crew character
should spawn as two *different* characters; no bot duplicates either,
and the player's label/joystick still map to the original seat.
On an iPhone portrait screen, safe-area controls must remain tappable
and arena artwork must cover the full available game viewport.

## Alpha 24 — Guest audio, team color ownership, efficient updates, and official server

The game now defaults to the **public** Joy Haus multiplayer Worker URL
`https://ghost-duel-rooms.jonathanjoyner.workers.dev`.
Players only need to create a room or enter a six-character code. An
advanced server field remains available for development or other hosting.
The URL is public infrastructure, not a secret; private host authorization
tokens are kept out of copied invitation links and source code.

Every online player can select a costume and personal pastel. The **first
human player on each team** chooses that team's visible uniform color, with
a contrasting fallback if both team captains pick exactly the same color.
Other human teammates keep their personal color as an accent. The guest
sees **YOUR BASE** at their own scoring base, never a misleading host-centric
"rivals" label.

Guest devices unlock Web Audio on a deliberate Join Room tap before any
asynchronous WebSocket messages. The already-existing original game music
starts when the round begins, and local guest milestone cues (collection,
deposit, steal, loss, powers) now respond to incoming authoritative game
snapshots. Mobile Safari can still suspend audio due to OS/browser policies;
the Test Sound button remains available for manual reactivation.

For gameplay latency, the host now sends compact position/score updates
approximately every 70 ms and full flame/trail/inventory snapshots roughly
every 240 ms, rather than sending every large state packet every 85 ms.
Guest rendering interpolates nearby ghost positions while retaining the
host's authoritative physics and scores. No server protocol or Durable
Object migration is required for this client-compatible snapshot format.

Automated tests cover selected team colors, guest-relative base labels,
gesture-triggered audio initialization, compact snapshot volume, full-state
periodicity, default server, and preservation of invitation secrecy.
A live iPhone/Safari guest test is still necessary, especially for audio
interruption and connection quality.

## Alpha 25 — readable base plaques and textured graveyard path

Two exclusively **visual** refinements to the canvas arena:

- `drawBaseNameplate(ctx,base,team)` places a dark amethyst plaque
  over each base's outer ring. A border follows the team color while
  cream, dark-outlined text remains readable for lavender, green,
  yellow and all other team colors. A second line displays
  `YOUR BASE` or `OTHER TEAM BASE` from the *local player's* team
  perspective in online games. Long colorway names fit automatically.
- `buildGraveyardPathLayer()` generates one deterministic, offscreen
  Canvas strip containing worn cobbles, earth, grass tufts, pebbles
  and leaves. `drawEnvironment()` reuses that cached layer at the
  existing center walkway. The path is drawn beneath interactive
  scenery and characters; it is decorative, not a physics change.

The original base centers/radii, wall rectangles, WebSocket messages,
scoring rules and leaderboard are preserved. Regression checks cover
contrast treatments, long-label fitting, path caching, ordering and
removal of the flat stripe. Run the existing test command:
`node --test multiplayer/tests/*.test.mjs`.

Live visual check: confirm both base names read clearly in very light
colorways and at iPhone portrait scale, and confirm the walkway remains
subtle enough to distinguish ghosts and spirit flames during play.

## Alpha 26 — more competitive computer ghosts (power thresholds unchanged)

Beta feedback was that computer opponents felt a little too easy. This
update strengthens rival AI's strategic pressure **10% on Easy, 15% on
Normal, and 20% on Hard** by shortening thinking intervals and increasing
chase opportunities and awareness radius. Movement speed rises by only
about 3–5%, so the game remains casual rather than becoming a twitch
reflex challenge.

The player's helpful computer teammates retain their previous Normal
AI tuning, so difficulty increases apply to the **rival** team and remain
visible in solo matches. Each difficulty retains its established small,
medium or large banking behavior.

A separate `movementSpeedFactor(g)` checks whether a ghost belongs to
a real human or an AI seat. **Both the host and guests in multiplayer
always move at the same base speed**, regardless of their teams or the
selected bot difficulty. Only computer-controlled opponents receive the
difficulty speed modifier.

All four existing upgrade thresholds stay at **8 (Speed), 23 (Glow),
53 (Magnet), and 113 (Phase)** carried spirits in every mode.
Player abilities, score mechanics, match time, physics, background,
music and online room protocol are otherwise unchanged.

New regression tests check tier-by-tier strategic differences,
small movement increments, human movement parity across all three
difficulty modes, teammate bot consistency and the unchanged power-ups.

After deployment, compare several games at each difficulty on the same
device and with similar play strategies. This is an initial tuning
experiment, not proof that wins become exactly 10/15/20% harder.

## Alpha 27 — Choose Your Haunt! Co-op and Classic Duel

The game menu now exposes two live multiplayer formats and preserves
**Play Solo** as a direct button. **Four-Way Haunt** is shown only as
`Coming later`; a four-team game is not implemented.

**Boo Crew Co-op (1–4 humans):** The host and up to three guests are
assigned ghost seats 0, 1, 2, and 3. All four are on the same team,
competing against four rival computer ghosts in seats 4–7. Unoccupied
friendly seats use computer allies. The host chooses the human team's
main uniform color; each friend retains their own personal costume pin.
The existing eight unique costumes, pickups, scores, match duration and
power unlocks remain intact.

**Classic Duel (1–8 humans):** Preserves the original alternating
seating order `[0,4,1,5,2,6,3,7]`, with players filling both
opposing teams and bots occupying unclaimed seats.

The Worker now stores the mode in each room's existing Durable Object
reservation metadata; no additional Durable Object class, migration,
table, or secret is necessary. `POST /rooms` accepts
`{"mode":"coop"}` or `{"mode":"classic"}`, defaulting to Classic
for older clients. `GET /rooms/<CODE>` and the WebSocket welcome,
roster, prepare and start messages expose the server's confirmed mode.
The Worker enforces a four-human cap for Co-op and eight for Classic;
clients cannot change the mode after room creation.

The lobby previews the eight team positions, with human portraits,
friendly-bot / rival-bot labels and team-color borders. A guest
automatically adopts the room's mode upon joining; only the host
chooses the mode. The host remains responsible for starting the
synchronized multiplayer match, as before.

### Deployment and compatibility

**Both** `index.html` and `multiplayer/src/worker.js` must be
deployed before Co-op will start. GitHub Pages can publish the
frontend as usual; the Cloudflare Worker build must deploy from
the repository's `main` branch with root `/multiplayer` and
command `npx wrangler deploy`, using the existing
`multiplayer/wrangler.jsonc` binding. There is no database migration.

If a Co-op host attempts to create a room while the old Worker is
still online, the browser checks `GET /health` and presents a
clear message rather than silently starting a Classic game. Classic
Duel and Play Solo continue working with the older Worker. Once
the new Worker is deployed, `/health` should return a
`modes` array containing `classic` and `coop`.

Automated tests exercise mode persistence, four-person Co-op seating,
the fifth-player rejection, the unchanged eight-seat Classic order,
room start handshakes, human joystick routing, and the user-facing
menu wiring. A real two-device browser check is still required.

**Do not tell users Co-op is live until the Worker deployment is
confirmed.** GitHub merge alone does not guarantee a Cloudflare build
has completed successfully.

## Alpha 28 — Adaptive menu on phones and tablets

The front-end menu now explicitly permits its centered flex child to
shrink below content's intrinsic minimum width. Character names, the
two-line title, mode selectors, and online roster labels wrap rather
than pushing the entire scene wider than a phone's CSS viewport.

Under 520 CSS pixels, the eight-character selection grid uses two
columns, online roster positions use two columns, and the panel's
padding and title size shrink. Intermediate screens from 521–679
pixels use three crew columns; larger screens retain four. The menu
stays vertically scrollable with safe-area padding, including short
landscape viewports. Form inputs use 16px text to reduce Safari's
focus-zoom behavior.

This is a UI-only change. No Canvas camera, world geometry, controls,
AI, game mechanics, server protocol, multiplayer seating, power
unlock threshold, sound, or leaderboard logic has been modified.

Regression tests cover mobile shrink rules, grid breakpoints, safe
area handling and input text size. For live visual acceptance, review
iPhone portrait at 320, 375, 390 and 430 CSS pixels, Android
portrait, 600–800px tablets, and phone landscape. Check that the
header, all eight characters, color swatches, mode cards, room
buttons and bottom actions remain accessible without horizontal
scrolling or double-tap zoom. Automated source tests cannot replace
real-device rendering.

## Alpha 29 — player nicknames and iPhone menu viewport recovery

The menu now displays an optional **Your player name** field before
the Boo Crew character selector. Names are at most 16 Unicode letters,
numbers, spaces or simple punctuation, trimmed and validated both in
the client and on the Worker. A name appears on your room portrait,
over your ghost in the match, and in the award/results screen.
Leaving it blank remains allowed and uses the friendly generic
player label. The name is saved only in the player's browser for
future visits; the Worker relays it to the room's connected players
but does not persist room names in the public leaderboard.

This requires an updated Worker for names to appear to other
players; the underlying game remains playable with an older Worker,
but older servers do not echo names in the room roster.

iPhone menu updates include `-webkit-text-size-adjust:100%` to stop
Safari inflating text beyond its configured viewport font size, a
stronger shrink-safe menu panel, and detection of a narrow physical
phone with an unusually large desktop-style layout viewport.
That case activates the alternate two-column `phoneView` layout.
If Safari has actually been pinch-zoomed in, the game displays
guidance rather than disabling user-initiated browser zoom, so
accessibility remains intact. Larger devices retain their natural
layouts; game Canvas camera, world physics, input and scoring are
unchanged.

To test iOS reliably, load
`https://magicalboyco.github.io/great-ghoul-duel-mobile/?v=29`
after GitHub Pages updates and confirm the menu says Alpha 29.
The distinct query helps bypass previously loaded HTML on phones.
Try portrait and landscape at normal Safari Page Zoom, test that
all eight ghosts are accessible without horizontal scroll, then
create or join a room and verify distinct nicknames on both screens.
Automated tests cover source invariants and room-name validation, but
physical browser layout should still be confirmed visually.

## Alpha 29 — iPhone menu display and player-chosen names

A player can now enter an **optional ghost name, up to 16 characters**
directly in the setup menu, independent of the public Top 13 score
nickname. Each human chooses their own nickname on their device before
creating/joining a private room. Short Unicode letter/number names
plus spaces, dots, apostrophes, hyphens and underscores are accepted.
Unsupported markup/control characters are filtered by the client and
rejected by the Worker. A blank name uses the old generic seat labels.

The room's existing profile WebSocket messages now relay each person's
sanitized `name`. The lobby renders names using `textContent`, and
gameplay name tags draw with `canvas.fillText()`; **player-entered
names are never interpolated into HTML markup**. Nicknames are
transmitted in the host's existing full snapshots, and shown on
post-match award tiles. The name is saved only to the player's
local browser and their private room's ephemeral in-memory profile.
No new Durable Object table, migration, login or account is required.

On iPhone, Apple Safari may inflate text sizes even when a responsive
viewport tag is present. The stylesheet explicitly uses
`-webkit-text-size-adjust:100%` without disabling user pinch-to-zoom.
The menu retains compact two-column ghost portraits, safe-area
padding, and vertical scrolling at narrow widths. Layout fixes affect
only setup screens, not game-world physics or camera.

**Visual verification is still needed on a physical iPhone.**
After the production GitHub Pages and Cloudflare deployments, open the
game with `?build=alpha29` appended to its URL to fetch the fresh page.
Confirm the upper menu badge reads Alpha 29, both rows of ghost cards
fit in portrait without horizontal cropping, and each invited person
can choose a name that appears in the lobby, above their ghost, and
on the award screen. Test also on Android, desktop and phone landscape.
If the menu is still magnified with Alpha 29 visible, check the Safari
website-specific Page Zoom setting and whether Request Desktop Website
is enabled; the game does not forcibly disable user-chosen zoom.

The existing Classic Duel, Boo Crew Co-op, Solo modes, difficulty levels,
team colors, eight distinct ghosts and power thresholds are preserved.
Automated tests cover mobile text sizing, optional names, their
cross-client synchronization and sanitization.
