# Riftline Tournament Platform

Prototype for an independent amateur Dota 2 tournament website and lobby automation service.

## Included
- Public tournament website with About, format, schedule, rules and contact sections.
- Admin API for creating queued match records.
- Lobby-bot prototype that consumes queued matches and requests Captains Mode practice lobbies from the Dota 2 Game Coordinator.
- Optional `LEAGUE_ID` support. A league ID must come from Valve's legitimate league process; this project does not bypass approval.

## Before publishing
1. Replace the placeholder contact email in `public/index.html` with a real monitored tournament address.
2. Confirm the tournament dates, format and region are accurate.
3. Publish the public site at a stable HTTPS URL.
4. Use the official Dota 2 amateur-league process if you need an approved League ID.
5. Only after approval, set `LEAGUE_ID` in the deployment environment and use an organizer account with the required permissions.

## Local setup
```bash
cp .env.example .env
npm install
npm start
# separate process
npm run bot
```

## Security
Never commit a real Steam password, Steam Guard code or admin token. Keep them in deployment secrets/environment variables. Use a dedicated organizer account rather than a valuable personal Steam account.

## Reliability
The Steam/Dota Game Coordinator integration relies on community-maintained libraries. It has not yet been live-tested in this repository. Keep manual lobby creation available as a fallback until end-to-end testing is complete.

## Steam bot runtime

The Railway worker uses modern `steam-user` authentication with a refresh token stored on the persistent volume, and `node-dota2-fork` for Dota 2 Game Coordinator/lobby operations. Steam Guard codes are only used for initial authorization when Steam requests them.
