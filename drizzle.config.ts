import { defineConfig } from "drizzle-kit";

// `npm run db:generate` needs no database. `db:migrate` / `db:studio` use
// DATABASE_URL (Postgres) when set, else the local PGlite directory.
const databaseUrl = process.env.DATABASE_URL;
const pgliteDir = process.env.PGLITE_DIR ?? "./.data/pglite";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite", dbCredentials: { url: pgliteDir } }),
});
