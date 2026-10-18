# auth (M01) — owner F

Signup (first signup creates the company + first admin; afterwards invite-only unless
`settings.auth.open_signup`, which creates `pending` users), login with throttling
(5 failures/email, 20/IP per 15 min via `login_attempts`), DB sessions (sha256 of a
32-byte token; `__Host-sid` in production, `sid` on http://localhost; `r.`/`s.` prefix =
remember-me 30 d sliding / 12 h), invites (7 d), password reset (30 min, single use;
emailed through the email adapter — the console driver prints the link), change password,
sign out other devices.

- Server logic: `src/lib/auth/*` (`flows.ts`, `session.ts`, `current.ts`, `password.ts`).
- Server actions for the `(auth)` pages and profile: `actions.ts` (`useActionState`-ready).
- Cross-module API: `api.ts` (`createInvite`, `revokeInvite`, `createPasswordResetLink`, `revokeAllSessions`).
- `src/proxy.ts` does the optimistic cookie redirect; `requireUser()` does the real check.
