// Built-in automations + templates (SPEC §7.3 + BUILD_PLAN Appendix B). Owner: B5.
// Seeded by F's base seed (src/db/seed/base.ts) with ON CONFLICT DO NOTHING, so admin
// edits survive re-seeding. Add a new built-in here (key + steps + its templates);
// existing installs pick it up on the next boot (the base seed is idempotent).
import type { AutomationSeed, TemplateSeed } from "@/features/registry";
import { builtinAutomationList } from "./automations";
import { builtinTemplateList } from "./templates";

export const builtinAutomations: AutomationSeed[] = builtinAutomationList;
export const builtinTemplates: TemplateSeed[] = builtinTemplateList;
