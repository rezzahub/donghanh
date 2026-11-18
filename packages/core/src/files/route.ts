import { uriScheme } from "./refs";
import type { FileProvider } from "./types";

/**
 * Try the providers for the uri's scheme in order; the first non-null result
 * wins. A provider that throws is skipped; only its error name is logged.
 * When none answered and at least one threw, throws "File providers are
 * unavailable" (never the provider's message), so an outage does not read as
 * a missing file.
 */
export async function firstFrom<T>(
  providers: FileProvider[],
  uri: string,
  fn: (p: FileProvider) => Promise<T | null>,
): Promise<T | null> {
  const scheme = uriScheme(uri);
  let threw = false;
  for (const p of providers) {
    if (p.scheme !== scheme) continue;
    try {
      const result = await fn(p);
      if (result !== null) return result;
    } catch (e) {
      threw = true;
      const name = e instanceof Error ? e.name : "Error";
      console.error(`[files] provider ${p.scheme} failed (${name})`);
    }
  }
  if (threw) {
    throw new Error(`File providers are unavailable (${scheme}); try again.`);
  }
  return null;
}
