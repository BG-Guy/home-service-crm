# map (M19) — owner B7, flag `map`

Live tech positions, today's job pins, the customer tracking page and the location pings
behind them. ⚖️ Positions are accepted only while the tech is clocked in and has
acknowledged the monitoring notice; nothing is tracked off shift.

## Pieces
- `LocationSharer` (S53, `slots.client.tsx`) — mounted by the shell for techs. Asks
  `GET /api/location` whether to share (flag, `location.share`, notice, clocked in via B2
  `getClockStatuses`), then `watchPosition` while the app is visible and POSTs at most every
  `ping_interval_sec` (≥ 60 s). Shows a "Sharing location" pill; stops when the server says
  `share:false`.
- `/api/location` — GET state / POST ping (zod, 1 stored ping per 30 s per user, plausible
  fix, device time clamped). Upserts `tech_locations` (never backwards in time); writes
  `location_breadcrumbs` only when `keep_breadcrumbs_days > 0` (pruned by `map.prune`).
- `recordStatusLocation` (api) — B2 stamps a position on each status change (same rules).
- `/map` — Leaflet (lazy chunk, `L.divIcon`): initials in the tech color, status ring
  (off / idle / en route / on job), > 15 min grey, > 60 min hidden unless "Show stale",
  accuracy halo > 100 m, job pins by status; side list (desktop) / list under the map
  (mobile) with current/next job and an ETA chip; job sheet with B2 `AssignJobButton`.
  Refreshes every 60 s while visible.
- `/t/[token]` — public tracking page (token kind `tracking`, 3 h TTL): first name, photo,
  license #, ETA (clock time in the company time zone) and last-known position on a
  zero-JS static tile map while en route. After arrival the link stays valid but shows
  only "<name> has arrived" (then "Your visit is complete"), never a position; an
  expired/revoked token shows "This link has expired". Phases: `trackingPhase()`.
- `/settings/map` ("Map") — the street map for every map (one-click "OpenStreetMap (free)",
  `saveMapTiles`), then ping interval, grey/hide thresholds and breadcrumb retention (those
  only while the `map` flag is on; the page itself has no flag gate).

## Extension points
- Tiles: `getMapConfig(settings.map)` (`src/adapters/maps`). `NEXT_PUBLIC_TILE_URL` (+
  `NEXT_PUBLIC_TILE_ATTRIBUTION`) wins, then the saved `map.tile_url` / `map.tile_attribution`
  (the OSM preset; https templates only, attribution escaped), then OSM in development only.
  Production with neither draws maps without streets plus a "Set it up" link to `/settings/map`.
  Existing databases: `scripts/enable-osm-tiles.ts` turns the preset on (`--off` reverses).
- Pure rules (`rules.ts`, tested in `tests/map/rules.test.ts`): staleness, status ring,
  haversine, rough ETA, fix sanity — reuse for "nearest tech" later.
