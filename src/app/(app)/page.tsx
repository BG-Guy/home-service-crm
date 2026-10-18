import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { homeFor } from "@/lib/auth/home";

// "/" → the role home (SPEC §13.1): admin → /insights, office and tech → /today.
export default async function AppIndex() {
  const user = await requireUser();
  redirect(homeFor(user.baseRole));
}
