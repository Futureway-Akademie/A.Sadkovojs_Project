// Categorical chart colors in fixed order, never cycled (task-7-3; order and values from the dashboard
// specification of task-10-3, section 05, checked there with the dataviz validator for CVD and contrast):
// RheinWerk blue-500, warning-800, lime-700. Lime-700 is too light for an unlabeled mark, so a chart
// with three series always has a legend and a data table. Forms with more series use small multiples.
export const CHART_COLORS = ["#2F80C9", "#B45F09", "#8FAE24"] as const;
