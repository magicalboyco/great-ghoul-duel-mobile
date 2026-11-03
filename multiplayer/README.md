# Ghost Duel — Alpha 14 online-room prototype

This is an **opt-in experimental mode**. The existing Alpha 13 solo game stays unchanged.

## Deploy the multiplayer relay
1. From this repository, go to the `multiplayer` directory.
2. With Node.js installed, run `npx wrangler login`, then `npx wrangler deploy`.
3. Copy the printed `https://ghost-duel-rooms.<subdomain>.workers.dev` URL.
4. Open Ghost Duel's menu, paste that URL in the **Online multiplayer** server field, and select **Create room**. Share the six-character room code. Other players enter the same server URL and room code and select **Join room**.
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
