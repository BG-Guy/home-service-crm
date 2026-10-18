# Module template (SPEC §15.1–§15.2)

A reference module that shows every convention end to end. It is **not registered**
(nothing imports `manifest.ts`), so it never appears in the app. It reads and writes
the `tasks` table as a stand-in for "your module's own table".

| File | What it shows |
|---|---|
| `permissions.ts` | Permission keys with default grants (`"AOT"` letters) and optional feature flags |
| `settings.ts` | A settings namespace with zod defaults (`.prefault({})`) |
| `nav.ts` | Sidebar, More list and settings-index entries |
| `manifest.ts` | `defineModule({...})` tying the above together |
| `queries.ts` | Read DAL: `requireUser(perm)` first, scoped query, React `cache()` |
| `actions.ts` | Mutations with `action()`: perm, zod, one transaction, audit, activity, revalidate |
| `api.ts` | Server functions other modules may call (`tx` first, no `'use server'`) |
| `contracts.ts` | Types only: slot props and DTOs (importable from client code) |
| `components/` | A Server Component list plus a small client form using `useActionState` |
| `events.ts`, `cron.ts`, `workers.ts`, `badges.ts`, `seed.ts` | Runtime hooks (empty here) |

## Create a module

1. Copy this folder to `src/features/<key>/` and replace `example` everywhere.
2. Tables: add `src/db/schema/<key>.ts` (SPEC §6.1 conventions: uuid ids, `timestamps()`,
   money as integer cents), export it from `src/db/schema/index.ts`, then run
   `npm run db:generate`. Never edit an applied migration.
3. `permissions.ts`: declare keys and default grants. Import `grants`/`flags` in
   `src/lib/permissions.ts` and `src/lib/flags.ts` so they join the `Perm` and
   `FeatureFlag` unions (then remove the `as Perm` casts in this template).
4. `settings.ts`: add the import to the `settingsSchema` spread in `src/features/registry.ts`.
5. `manifest.ts`: add the key to `ModuleKey` and one line to `modules` in the registry.
   Nav, the permission grid, `/settings/features` and the settings index pick it up.
6. Runtime hooks: add your `events.ts`, `cron.ts`, `workers.ts`, `badges.ts` and `seed.ts`
   to the aggregators (`src/lib/event-handlers.ts`, `cron-hooks.ts`, `workers.ts`,
   `badges.ts`, `src/db/seed/demo.ts`). Event handlers must be idempotent. A `seed.ts`
   reads the plan from `ctx.plan` and any trade-flavoured copy (notes, vendors, checklist
   items…) from `ctx.profile` (`src/db/seed/profiles/`), so `--profile=<trade>` demos stay
   consistent.
7. Routes: `src/app/(app)/<route>/page.tsx` (+ `loading.tsx`). Example:

   ```tsx
   import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
   import { requireUser } from "@/lib/auth/current";
   import { Page } from "@/ui/components/AppShell";
   import { LargeTitleHeader } from "@/ui/components/NavBar";
   import { PageTransition } from "@/ui/motion/PageTransition";
   import { ExampleList } from "@/features/example/components/ExampleList";

   export default async function ExamplePage() {
     const user = await requireUser("example.view");
     return (
       <PageTransition>
         <LargeTitleHeader title="Examples" trailing={<HeaderActions />} />
         <Page>
           <ExampleList canManage={user.perms.has("example.manage")} />
         </Page>
       </PageTransition>
     );
   }
   ```

8. Messages: never call a driver. Use the messaging module's `enqueueMessage` (consent,
   quiet hours and caps are enforced there) and seed templates/automations in
   `src/features/automations/builtin`.
9. Tests: golden tests for any money, time or rule logic in `tests/golden/`.
10. Docs: one paragraph in `docs/MODULES.md` and a line in `docs/CHANGELOG.md`.
    Check `npm run lint && npm run typecheck && npm test && npm run build`.
