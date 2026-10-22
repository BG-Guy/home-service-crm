import "server-only";
import { assertEstimateAccess } from "@/features/estimates/access";
import { getCurrentUser } from "@/lib/auth/current";

// Present mode (/e/…?present=1): the customer's own estimate page, full screen on
// a staff tablet. It only turns on for a signed-in staff user who may present
// this estimate (the same rule as "Sign on this device": estimates.send + row
// access). The /e page asks before wrapping the page, and the approval action
// asks again before it records the signature as given in person.

export interface Presenter {
  id: string;
  name: string;
}

/** The staff user presenting estimate `estimateId` on this device, or null. */
export async function presentingUser(
  estimateId: string,
): Promise<Presenter | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.perms.has("estimates.send")) return null;
  try {
    await assertEstimateAccess(user, estimateId, "read");
  } catch {
    return null;
  }
  return { id: user.id, name: user.name };
}
