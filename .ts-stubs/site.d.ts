// Ambient stub for the browser-only absolute specifier "/site/site.js",
// which public/js/core/site.js imports at runtime: it's served from
// public/site/site.js, written by scripts/build.js and gitignored, so it
// isn't always on disk when tsc runs. See jsconfig.json's `paths`, and
// the matching real shape in scripts/buildOutputs.js's
// buildPublicSiteModule() / src/site/schema.js's Site typedef.
export declare const site: {
  name: string;
  wordmark: { accent: string; rest: string };
  tagline: string;
  sourceLanguage: string;
  timezone: string;
  region: string;
  lowercaseNames: boolean;
  contactUrl: string;
  [key: string]: unknown;
};
export declare const copy: Record<string, string>;
