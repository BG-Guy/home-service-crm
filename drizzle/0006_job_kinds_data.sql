-- Leads-flow redesign, item 6: three job types (Free estimate, Service call, Project)
-- with the trade's own jobs under them. Data only, for databases seeded before 0005
-- (a fresh database has no rows yet; the base seed writes the new ones).
--   * "Estimate visit" -> "Free estimate" (kind estimate)
--   * "Service call" / "Service call / diagnostic" (and "/ assessment", "/ leak
--     diagnostic"…) -> "Service call" (kind service)
--   * "Installation" -> "Project" (kind project, home-improvement contract)
--   * "Repair" and "Maintenance" are retired: active = false. Their jobs keep
--     service_type_id, so history is intact; techs who had them as skills get the
--     Service call skill instead (they still take that work).
--   * Every other row keeps its name; kind stays 'service' (the column default) unless
--     it is clearly an install or project.
--   * maintenance_interval_months -> NULL everywhere (no maintenance reminders).
-- Nothing is deleted. Names are matched case- and space-insensitively. Only one row is
-- renamed per mapping (the first live one), and never onto a name that already exists,
-- so an admin's own rows are not merged or duplicated. A renamed row still on the old
-- seeded icon / length gets the new kind default (src/features/jobs/kinds.ts):
-- Free estimate clipboard, Service call wrench (tools) and 90 min, Project 240 min.

-- Free estimate
UPDATE "service_types" SET "kind" = 'estimate', "updated_at" = now()
WHERE lower(btrim("name")) IN ('estimate visit', 'free estimate');
--> statement-breakpoint
UPDATE "service_types" SET
  "name" = 'Free estimate',
  "icon" = CASE WHEN "icon" = 'estimates' THEN 'clipboard' ELSE "icon" END,
  "updated_at" = now()
WHERE "id" = (
    SELECT "id" FROM "service_types"
    WHERE lower(btrim("name")) = 'estimate visit' AND "deleted_at" IS NULL
    ORDER BY "active" DESC, "sort", "created_at", "id" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "service_types"
    WHERE lower(btrim("name")) = 'free estimate' AND "deleted_at" IS NULL);
--> statement-breakpoint

-- Service call (kind 'service' is already the default; the name is what changes)
UPDATE "service_types" SET
  "name" = 'Service call',
  "icon" = CASE WHEN "icon" = 'clipboard' THEN 'tools' ELSE "icon" END,
  "default_duration_min" = CASE WHEN "default_duration_min" = 60 THEN 90
    ELSE "default_duration_min" END,
  "updated_at" = now()
WHERE "id" = (
    SELECT "id" FROM "service_types"
    WHERE lower(btrim("name")) ~ '^service call\s*/' AND "deleted_at" IS NULL
    ORDER BY "active" DESC, "sort", "created_at", "id" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "service_types"
    WHERE lower(btrim("name")) = 'service call' AND "deleted_at" IS NULL);
--> statement-breakpoint

-- Project
UPDATE "service_types"
SET "kind" = 'project', "contract_kind" = 'improvement', "updated_at" = now()
WHERE lower(btrim("name")) IN ('installation', 'project');
--> statement-breakpoint
UPDATE "service_types" SET
  "name" = 'Project',
  "default_duration_min" = CASE WHEN "default_duration_min" = 180 THEN 240
    ELSE "default_duration_min" END,
  "updated_at" = now()
WHERE "id" = (
    SELECT "id" FROM "service_types"
    WHERE lower(btrim("name")) = 'installation' AND "deleted_at" IS NULL
    ORDER BY "active" DESC, "sort", "created_at", "id" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "service_types"
    WHERE lower(btrim("name")) = 'project' AND "deleted_at" IS NULL);
--> statement-breakpoint

-- Retire Repair and Maintenance. Techs who listed them as skills keep taking that
-- work as service calls (users.skills gains the Service call row).
UPDATE "users" SET
  "skills" = array_append("users"."skills", "sc"."id"),
  "updated_at" = now()
FROM (
  SELECT "id" FROM "service_types"
  WHERE lower(btrim("name")) = 'service call' AND "deleted_at" IS NULL
  ORDER BY "active" DESC, "sort", "created_at", "id" LIMIT 1) AS "sc"
WHERE "users"."skills" && ARRAY(
    SELECT "id" FROM "service_types"
    WHERE lower(btrim("name")) IN ('repair', 'maintenance'))
  AND NOT ("sc"."id" = ANY ("users"."skills"));
--> statement-breakpoint
UPDATE "service_types" SET "active" = false, "updated_at" = now()
WHERE lower(btrim("name")) IN ('repair', 'maintenance') AND "active";
--> statement-breakpoint

-- Everything else stays a service call unless it is clearly an install or project:
-- a home-improvement contract, half a day or more by default, or an install /
-- project / remodel / renovation / rebuild by name.
UPDATE "service_types" SET "kind" = 'project', "updated_at" = now()
WHERE "kind" = 'service'
  AND lower(btrim("name")) NOT IN ('repair', 'maintenance')
  AND lower(btrim("name")) !~ '^service call'
  AND ("contract_kind" = 'improvement'
    OR "default_duration_min" >= 240
    OR lower("name") ~ '\m(install|installs|installation|installations|project|projects|remodel|remodeling|renovation|renovations|rebuild|rebuilds)\M');
--> statement-breakpoint

-- No maintenance reminders.
UPDATE "service_types" SET "maintenance_interval_months" = NULL, "updated_at" = now()
WHERE "maintenance_interval_months" IS NOT NULL;
