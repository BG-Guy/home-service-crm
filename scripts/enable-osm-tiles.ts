// One-off: turn on the free OpenStreetMap street map (the Settings → Map preset) in
// an existing database, e.g. a demo business seeded before the preset existed.
//
//   PGLITE_DIR=.data/demo/handyman/db npx tsx --conditions=react-server scripts/enable-osm-tiles.ts
//   DATABASE_URL=postgres://… npx tsx --conditions=react-server scripts/enable-osm-tiles.ts
//   … scripts/enable-osm-tiles.ts --off     (turn it back off)
//
// Stop the app first when it runs on PGlite: one process per PGlite folder. The
// change is a normal settings write (audited as the system). NEXT_PUBLIC_TILE_URL,
// when set, still wins over the saved preset.
import { OSM_TILE_ATTRIBUTION, OSM_TILE_URL } from "../src/adapters/maps";
import { closeDb, db } from "../src/db";
import { NotFoundError } from "../src/lib/errors";
import { updateSettings } from "../src/lib/settings";
import { SYSTEM_ACTOR } from "../src/lib/types";

async function main() {
  const off = process.argv.includes("--off");
  const where = process.env.DATABASE_URL
    ? "DATABASE_URL"
    : (process.env.PGLITE_DIR ?? "./.data/pglite");
  const next = await db.transaction((tx) =>
    updateSettings(
      tx,
      {
        map: off
          ? { tile_url: "", tile_attribution: "" }
          : { tile_url: OSM_TILE_URL, tile_attribution: OSM_TILE_ATTRIBUTION },
      },
      SYSTEM_ACTOR,
    ),
  );
  console.log(
    off
      ? `Street map off in ${where}.`
      : `Street map on in ${where}: ${next.map.tile_url} (${next.map.tile_attribution}).`,
  );
}

main()
  .catch((err) => {
    if (err instanceof NotFoundError)
      console.error(
        "No company in this database yet: sign up or seed it first.",
      );
    else console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
