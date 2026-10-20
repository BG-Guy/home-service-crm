/** First error of a field from an ActionResult's fieldErrors (plain module: no upload code). */
export const fe = (
  errs: Record<string, string[]> | undefined,
  key: string,
): string | undefined => errs?.[key]?.[0];
