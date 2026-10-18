// Role home (SPEC §13.1): the first tab of each role's tab bar. Isomorphic.
import type { BaseRole } from "@/db/enums";

export function homeFor(baseRole: BaseRole): string {
  return baseRole === "admin" ? "/insights" : "/today";
}
