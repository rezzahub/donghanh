declare namespace JSX {
  type Element = import("./primitives").ChatNode;
  // biome-ignore lint/complexity/noBannedTypes: required for JSX IntrinsicElements
  type IntrinsicElements = {};

  interface ElementChildrenAttribute {
    children: unknown;
  }
}
