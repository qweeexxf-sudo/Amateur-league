# Riftline Tournament Platform

Production prototype for **RIFTLINE OPEN 2026**, an independent amateur Dota 2 tournament.

## Current deployment

- Public site and admin UI are served from GitHub Pages.
- Railway runs the Express API and one Dota 2 lobby worker.
- The worker authenticates with modern `steam-user`; its refresh token is stored on the persistent Railway volume.
- The Dota 2 Game Coordinator connection has been live-tested successfully.
- A real Captains Mode practice lobby was created through Valve GC and destroyed successfully in the one-time smoke test.
- Server region `3` is Europe.
- BO1 / BO3 / BO5 map to Dota series types NONE / BEST_OF_THREE / BEST_OF_FIVE.
- `LEAGUE_ID=0` remains correct until a legitimate Valve league ID is approved.

## Match flow

The admin UI queues a match through the authenticated API. The worker creates the practice lobby, records the lobby ID, invites the supplied SteamID64 players, and waits for admin actions to launch, destroy, or cancel the lobby.

One worker/account can own one active lobby at a time. Running simultaneous tournament matches requires additional worker accounts/services; do not assume this single worker can host concurrent lobbies.

## Local setup

```bash
cp .env.example .env
npm install
npm start
# separate process
npm run bot
```

## Security

Never commit a Steam password, Steam Guard code, refresh token, or admin token. Keep secrets in Railway/environment variables or the persistent private volume. The public admin page stores the admin token only in browser session storage.

## Operational notes

The admin UI includes a protected live bot status showing Steam connectivity, Dota GC readiness, and heartbeat freshness. Steam Guard email codes are only needed when Steam explicitly requests re-authorization.

Keep manual lobby creation available as an event-day fallback because Steam and the Dota Game Coordinator are external dependencies.
