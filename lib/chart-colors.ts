// Categorical chart colors (task-7-3), assigned in this fixed order and never cycled.
// Slot 1 is RheinWerk blue-500; the others come from the dataviz reference palette because the brand
// ramps have no further mid-lightness hues (navy is too dark, lime and blue-300 too light for marks).
// Validated with the dataviz validator on the chart surface #FCFBF7 (light mode; the dashboard has no
// dark theme): lightness band, chroma, adjacent CVD ΔE >= 21.9, normal-vision ΔE >= 31.3, contrast >= 3:1.
// Slots 1–3 also pass all-pairs (CVD ΔE 14.8), so forms where every pair can touch use at most three.
export const CHART_COLORS = ["#2F80C9", "#EB6834", "#4A3AA7", "#008300"] as const;
