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
