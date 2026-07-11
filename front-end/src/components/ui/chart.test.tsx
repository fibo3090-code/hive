import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ChartConfig } from "./chart";
import { ChartStyle } from "./chart";

// ChartStyle builds a <style> tag via dangerouslySetInnerHTML, sourcing CSS
// custom-property values straight from the caller-supplied `chartConfig`
// (color strings, and the chart `id`). That's exactly the shape of an XSS
// sink (C408): if `config[key].color` or the container `id` ever came from
// untrusted/user-controlled input and were emitted verbatim, a value like
// `red} </style><script>...` or `red;}body{...}` could break out of the
// `--color-*: <value>;` declaration (or, if it ever reached HTML instead of
// a style block, break out of the tag entirely).
//
// Current source (src/components/ui/chart.tsx) already guards this with an
// allow-list sanitiser: `sanitiseCss` strips everything except
// `[A-Za-z0-9 ,.()#%/_-]` from color values, and `sanitiseId` strips
// everything except `[A-Za-z0-9_-]` from the chart id. Notably neither
// allow-list includes `{`, `}`, `:`, `;`, `<`, `>`, quotes, or backslashes —
// the characters needed to close a declaration/rule/tag or start a new one.
// The tests below assert that behavior holds: dangerous characters never
// reach the emitted <style> text, only the sanitised remainder does.
describe("ChartStyle (XSS-sanitization surface, C408)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function styleText(container: HTMLElement) {
    return container.querySelector("style")?.textContent ?? "";
  }

  it("happy path: renders --color-<key> custom properties for both light and dark selectors", () => {
    const config: ChartConfig = {
      revenue: { label: "Revenue", color: "#ff0000" },
      cost: { label: "Cost", theme: { light: "#00ff00", dark: "#0000ff" } },
    };

    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const text = styleText(container);

    // Light selector (empty prefix) uses color / theme.light.
    expect(text).toContain("[data-chart=chart-1] {");
    expect(text).toContain("--color-revenue: #ff0000;");
    expect(text).toContain("--color-cost: #00ff00;");

    // Dark selector (.dark prefix) uses theme.dark for `cost`. `revenue`
    // only has a flat `color` (no `theme`), so `itemConfig.theme?.[theme]`
    // is undefined and it falls back to the same `color` in both blocks.
    expect(text).toContain(".dark [data-chart=chart-1] {");
    expect(text).toContain("--color-cost: #0000ff;");
    const darkBlock = text.slice(text.indexOf(".dark [data-chart=chart-1] {"));
    expect(darkBlock).toContain("--color-revenue: #ff0000;");
  });

  it("renders nothing when no config entries have a color or theme", () => {
    const config: ChartConfig = { revenue: { label: "Revenue" } };

    const { container } = render(<ChartStyle id="chart-1" config={config} />);

    expect(container.querySelector("style")).toBeNull();
  });

  it("strips CSS-breakout characters from a malicious color value", () => {
    const config: ChartConfig = {
      evil: { color: "red} </style><script>alert(1)</script>" },
    };

    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const text = styleText(container);

    // The raw payload must never appear verbatim.
    expect(text).not.toContain("</style><script>");
    expect(text).not.toContain("<script>");
    // `<` / `>` / quotes never legitimately appear anywhere in the emitted
    // template (unlike `{`, `}`, `:`, `;`, which are part of the static
    // `--color-x: value;` / block-wrapper shape) — so a global absence
    // check for exactly those characters is a safe, real assertion.
    expect(text).not.toMatch(/[<>'"]/);
    // The alphanumeric/allow-listed remainder is still present as the
    // (now fully inert) value — proving sanitisation transforms rather
    // than silently drops the whole entry.
    expect(text).toContain("--color-evil: red /stylescriptalert(1)/script;");
  });

  it("strips CSS-breakout characters from a malicious chart id", () => {
    const config: ChartConfig = { revenue: { color: "#ff0000" } };
    const maliciousId = 'chart-1"] {}  body{background:url(javascript:alert(1))} [data-chart="x';

    const { container } = render(<ChartStyle id={maliciousId} config={config} />);
    const text = styleText(container);

    // Quotes never legitimately appear in the template, so their absence is
    // a safe global check. (`{`, `}`, `[`, `]`, `=`, `:` all appear
    // legitimately elsewhere in the static template shape, so we can't
    // assert their global absence — instead we assert the *exact* sanitised
    // selector below, which proves the malicious id's own brace/bracket/
    // colon/quote characters were stripped rather than preserved.)
    expect(text).not.toContain('"');
    // Only the alnum/_/- remainder of the id is used in the selector — one
    // flat token, not a re-opened attribute selector or new rule.
    expect(text).toContain("[data-chart=chart-1bodybackgroundurljavascriptalert1data-chartx] {");
  });

  it("a value that looks like a URL/() injection still can't introduce a new declaration", () => {
    const config: ChartConfig = {
      evil: { color: "red; background: url('javascript:alert(1)')" },
    };

    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const text = styleText(container);

    // Single quotes never legitimately appear in the template.
    expect(text).not.toContain("'");
    // The value's own `;` and `:` are stripped (leaving one flat token), so
    // even though `;`/`:` legitimately appear elsewhere in the template
    // (around the *real* `--color-evil:` declaration), the injected value
    // itself can no longer terminate that declaration or start a new
    // `background:` one.
    expect(text).toContain("--color-evil: red background url(javascriptalert(1));");
  });

  it("omits an entry whose resolved color/theme value is falsy", () => {
    const config: ChartConfig = {
      // theme present but empty strings for both keys -> falsy -> filtered
      // out of the emitted lines (still counted as "has theme" for the
      // colorConfig filter, but the per-line ternary drops it).
      empty: { theme: { light: "", dark: "" } },
      revenue: { color: "#ff0000" },
    };

    const { container } = render(<ChartStyle id="chart-1" config={config} />);
    const text = styleText(container);

    expect(text).not.toContain("--color-empty");
    expect(text).toContain("--color-revenue: #ff0000;");
  });
});
