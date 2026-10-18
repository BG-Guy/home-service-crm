// Fuzzy service matching (SPEC M04): case-insensitive name, then the alias list,
// then a punctuation-insensitive comparison. Unmatched values stay as service_text.

export interface ServiceTypeLike {
  id: string;
  name: string;
  aliases: string[] | null;
  active?: boolean;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function matchServiceType(
  text: string | null | undefined,
  types: readonly ServiceTypeLike[],
): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const live = types.filter((x) => x.active !== false);
  const byName = live.find((x) => x.name.trim().toLowerCase() === t);
  if (byName) return byName.id;
  const byAlias = live.find((x) =>
    (x.aliases ?? []).some((a) => a.trim().toLowerCase() === t),
  );
  if (byAlias) return byAlias.id;
  const sq = squash(t);
  if (!sq) return null;
  const bySquash = live.find(
    (x) =>
      squash(x.name) === sq || (x.aliases ?? []).some((a) => squash(a) === sq),
  );
  return bySquash?.id ?? null;
}
