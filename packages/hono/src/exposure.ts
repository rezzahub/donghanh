import type { OperationDetail, Registry } from "@donghanh/core";

export type Selector = {
  type?: "query" | "mutation";
  tags?: string[];
  ids?: string[];
  widget?: boolean;
  destructive?: boolean;
};

export interface ExposureConfig {
  default?: "tool" | "catalog";
  tools?: Selector;
  catalog?: Selector;
  pin?: string[];
}

export type Placement = "tool" | "catalog";

export interface ResolvedExposure {
  /** Every operation id. */
  placement: Map<string, Placement>;
  pinned: Set<string>;
  /** Catalog-placed operations with `appCallable`: listed with visibility ["app"]. */
  appOnly: Set<string>;
  catalogIds(): string[];
}

function matches(sel: Selector | undefined, op: OperationDetail): boolean {
  if (!sel) return false;
  const checks: boolean[] = [];
  if (sel.type !== undefined) checks.push(op.type === sel.type);
  if (sel.tags !== undefined)
    checks.push(sel.tags.some((t) => op.tags?.includes(t)));
  if (sel.ids !== undefined) checks.push(sel.ids.includes(op.id));
  if (sel.widget !== undefined)
    checks.push(sel.widget === (op.widget !== undefined));
  if (sel.destructive !== undefined)
    checks.push(sel.destructive === (op.destructive === true));
  return checks.length > 0 && checks.every(Boolean);
}

/**
 * Place every operation as a `tool` or in the `catalog`.
 * Order: widget > pin > tools selector > catalog selector > default (tool).
 * Throws on ids in `pin`, `tools.ids` or `catalog.ids` that aren't operations.
 */
export function resolveExposure(
  registry: Registry,
  exposure: ExposureConfig | undefined,
): ResolvedExposure {
  const details = registry
    .list()
    .map((o) => registry.detail(o.id))
    .filter((d): d is OperationDetail => d !== null);
  const known = new Set(details.map((d) => d.id));

  const where: [string, string[] | undefined][] = [
    ["pin", exposure?.pin],
    ["tools.ids", exposure?.tools?.ids],
    ["catalog.ids", exposure?.catalog?.ids],
  ];
  for (const [field, ids] of where) {
    for (const id of ids ?? []) {
      if (!known.has(id)) {
        throw new Error(`Unknown operation id "${id}" in exposure ${field}`);
      }
    }
  }

  const pinned = new Set(exposure?.pin ?? []);
  const fallback = exposure?.default ?? "tool";
  const placement = new Map<string, Placement>();
  const appOnly = new Set<string>();

  for (const d of details) {
    let p: Placement;
    if (d.widget !== undefined || pinned.has(d.id)) p = "tool";
    else if (matches(exposure?.tools, d)) p = "tool";
    else if (matches(exposure?.catalog, d)) p = "catalog";
    else p = fallback;
    placement.set(d.id, p);
    if (p === "catalog" && d.appCallable) appOnly.add(d.id);
  }

  return {
    placement,
    pinned,
    appOnly,
    catalogIds: () =>
      [...placement].filter(([, p]) => p === "catalog").map(([id]) => id),
  };
}
