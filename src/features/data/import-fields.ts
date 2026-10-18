// CSV import field catalog + header auto-mapping (client-safe, pure).

export type ImportKind = "customers" | "pricebook" | "jobs";
/** field key → CSV header (or null = not mapped). */
export type ImportMapping = Record<string, string | null>;

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

const CUSTOMER_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Full name",
    aliases: [
      "name",
      "full name",
      "customer",
      "customer name",
      "client",
      "display name",
      "contact",
    ],
  },
  {
    key: "first_name",
    label: "First name",
    aliases: ["first name", "first", "firstname", "given name"],
  },
  {
    key: "last_name",
    label: "Last name",
    aliases: ["last name", "last", "lastname", "surname", "family name"],
  },
  {
    key: "company",
    label: "Company",
    aliases: ["company", "company name", "business", "organization"],
  },
  {
    key: "phone",
    label: "Phone",
    aliases: [
      "phone",
      "mobile",
      "cell",
      "phone number",
      "mobile phone",
      "telephone",
      "primary phone",
    ],
  },
  {
    key: "email",
    label: "Email",
    aliases: ["email", "e-mail", "email address"],
  },
  {
    key: "type",
    label: "Customer type",
    aliases: ["type", "customer type", "client type"],
  },
  {
    key: "address",
    label: "Address (one line)",
    aliases: ["address", "full address", "service address"],
  },
  {
    key: "street",
    label: "Street",
    aliases: [
      "street",
      "address 1",
      "address1",
      "street address",
      "address line 1",
    ],
  },
  {
    key: "unit",
    label: "Unit",
    aliases: [
      "unit",
      "apt",
      "suite",
      "address 2",
      "address2",
      "address line 2",
    ],
  },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "province", "region"] },
  {
    key: "zip",
    label: "ZIP",
    aliases: ["zip", "zip code", "zipcode", "postal code", "postcode"],
  },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments"] },
  {
    key: "sms_consent",
    label: "Agreed to texts",
    aliases: ["sms consent", "text ok", "sms opt in", "opt in", "consent"],
  },
];

const PRICEBOOK_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["name", "item", "item name", "service", "product", "description"],
  },
  {
    key: "sku",
    label: "SKU",
    aliases: ["sku", "code", "item code", "part number", "part #"],
  },
  {
    key: "kind",
    label: "Kind (service/part/fee…)",
    aliases: ["kind", "type", "item type"],
  },
  { key: "category", label: "Category", aliases: ["category", "group"] },
  {
    key: "price",
    label: "Price",
    aliases: ["price", "unit price", "rate", "sell price", "amount"],
  },
  { key: "cost", label: "Cost", aliases: ["cost", "unit cost", "our cost"] },
  { key: "taxable", label: "Taxable", aliases: ["taxable", "tax"] },
  {
    key: "description",
    label: "Description",
    aliases: ["details", "long description", "notes"],
  },
];

const JOB_FIELDS: ImportField[] = [
  ...CUSTOMER_FIELDS.filter(
    (f) => f.key !== "sms_consent" && f.key !== "notes",
  ),
  {
    key: "completed_on",
    label: "Date completed",
    required: true,
    aliases: [
      "date",
      "completed",
      "completed on",
      "completed date",
      "job date",
      "service date",
      "invoice date",
    ],
  },
  {
    key: "service",
    label: "Service / description",
    aliases: ["service", "job", "job type", "work", "work done", "line items"],
  },
  {
    key: "total",
    label: "Total",
    aliases: ["total", "amount", "invoice total", "price", "revenue"],
  },
  { key: "notes", label: "Notes", aliases: ["notes", "job notes", "comments"] },
  {
    key: "external_ref",
    label: "Old job #",
    aliases: [
      "job #",
      "job number",
      "invoice #",
      "invoice number",
      "id",
      "external id",
      "reference",
    ],
  },
];

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  customers: CUSTOMER_FIELDS,
  pricebook: PRICEBOOK_FIELDS,
  jobs: JOB_FIELDS,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Best-effort header → field mapping (exact alias match, each header used once). */
export function guessMapping(
  headers: readonly string[],
  kind: ImportKind,
): ImportMapping {
  const used = new Set<string>();
  const out: ImportMapping = {};
  for (const f of IMPORT_FIELDS[kind]) {
    const hit = headers.find(
      (h) => !used.has(h) && f.aliases.some((a) => norm(a) === norm(h)),
    );
    out[f.key] = hit ?? null;
    if (hit) used.add(hit);
  }
  return out;
}
