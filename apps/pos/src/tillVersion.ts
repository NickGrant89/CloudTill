declare const __TILL_BUILD_VERSION__: string;

/** Baked in at POS build from apps/api/src/index.ts — visible before /api/health returns. */
export const TILL_BUILD_VERSION =
  typeof __TILL_BUILD_VERSION__ !== "undefined" ? __TILL_BUILD_VERSION__ : "dev";