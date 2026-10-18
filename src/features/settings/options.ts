// Pickers and labels for B8 settings screens. Client-safe data.
export { US_STATES, US_TIME_ZONES } from "@/app/(auth)/signup/options";

export const WEEKDAYS = [
  { day: 0, short: "Sun", label: "Sunday" },
  { day: 1, short: "Mon", label: "Monday" },
  { day: 2, short: "Tue", label: "Tuesday" },
  { day: 3, short: "Wed", label: "Wednesday" },
  { day: 4, short: "Thu", label: "Thursday" },
  { day: 5, short: "Fri", label: "Friday" },
  { day: 6, short: "Sat", label: "Saturday" },
] as const;

/** Icon keys (src/ui/icons.ts) offered for service types. */
export const SERVICE_ICONS = [
  { value: "tools", label: "Wrench" },
  { value: "hammer", label: "Hammer" },
  { value: "toolbox", label: "Toolbox" },
  { value: "key", label: "Key" },
  { value: "lock", label: "Lock" },
  { value: "clipboard", label: "Clipboard" },
  { value: "checklist", label: "Checklist" },
  { value: "estimates", label: "Document" },
  { value: "home", label: "House" },
  { value: "timer", label: "Timer" },
  { value: "flag", label: "Flag" },
  { value: "security", label: "Shield" },
] as const;

/** iOS system colors offered as swatches (service types, team colors, brand presets). */
export const SWATCHES = [
  { hex: "#007AFF", name: "Blue" },
  { hex: "#34C759", name: "Green" },
  { hex: "#FF9500", name: "Orange" },
  { hex: "#FF3B30", name: "Red" },
  { hex: "#AF52DE", name: "Purple" },
  { hex: "#FF2D55", name: "Pink" },
  { hex: "#5AC8FA", name: "Teal" },
  { hex: "#5856D6", name: "Indigo" },
  { hex: "#A2845E", name: "Brown" },
  { hex: "#8E8E93", name: "Gray" },
] as const;

export const ENTITY_LABELS: Record<string, string> = {
  customer: "Customers",
  property: "Properties",
  job: "Jobs",
  lead: "Leads",
  estimate: "Estimates",
  invoice: "Invoices",
  vehicle: "Vehicles",
  tool: "Tools",
};

export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  date: "Date",
  select: "Pick one",
  multiselect: "Pick many",
  boolean: "Yes / No",
  photo: "Photo",
};

export const CHECKLIST_ITEM_TYPES = [
  { value: "check", label: "Checkbox" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "photo", label: "Photo" },
  { value: "signature", label: "Signature" },
  { value: "select", label: "Pick one" },
] as const;
