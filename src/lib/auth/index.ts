import "server-only";

export { sessionCookieName } from "./cookie-name";
// Auth public surface (BUILD_PLAN §2). Import from "@/lib/auth".
export {
  actorOf,
  can,
  getCurrentUser,
  loadSessionUser,
  requestActor,
  requireAnyPerm,
  requireApiUser,
  requireUser,
} from "./current";
export {
  acceptInvite,
  changePassword,
  completePasswordReset,
  createInvite,
  createPasswordResetLink,
  getInviteByToken,
  getPasswordReset,
  login,
  logout,
  requestPasswordReset,
  revokeInvite,
  signup,
} from "./flows";
export {
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
export {
  clearSessionCookie,
  createSession,
  findSession,
  readSessionCookie,
  requestMeta,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from "./session";
