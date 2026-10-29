/**
 * Copies each key of `defaults` onto a new object.
 * Uses the source value when it is not null or undefined, and the default otherwise.
 * `0` and `false` on the source are kept. Keys absent from `defaults` are dropped.
 * This matches `source.field ?? default` and does not match object spread.
 */
export function fillDefaults<D extends Record<string, unknown>>(
  source: { [K in keyof D]?: D[K] | null } | null | undefined,
  defaults: D,
): D {
  const result = {} as D;
  for (const key of Object.keys(defaults) as (keyof D)[]) {
    const fromSource = source?.[key];
    result[key] = (fromSource ?? defaults[key]) as D[keyof D];
  }
  return result;
}
