/**
 * ChartRenderer - shared Chart.js radar chart factory.
 *
 * Null value handling
 * -------------------
 * A null data value means the metric was not assessed (information gap).
 * Null axes are visually distinct from 0-value axes:
 *   - 0 renders at the radar origin with a visible blue dot + normal label
 *   - null renders at the radar origin with NO dot + grayed-out label
 * A "No data" tooltip appears when hovering over a grayed null label.
 *
 * Raw value display
 * -----------------
 * When the JSON payload includes a "raw" key alongside "data", tooltips show
 * the pre-normalization abstracted value and its metric description next to
 * the log-normalized score. Each raw entry is a {value, metric} object.
 * Composite labels (e.g. Critical Infrastructure) use an array of
 * {value, metric} objects. Metric descriptions are provided by the Python
 * backend via the LABEL_METRICS configuration — this module contains no
 * domain-specific unit or label knowledge.
 */
const ChartRenderer = (() => {

    const SCALE_MAX       = 100;
    const SCALE_STEP      = 20;
    const MAX_LABEL_CHARS = 14;

    const COLOR_DATA_FILL    = 'rgba(59, 130, 246, 0.22)';
    const COLOR_DATA_BORDER  = 'rgba(59, 130, 246, 0.85)';
    const COLOR_DATA_POINT   = 'rgba(59, 130, 246, 1)';
    const COLOR_GRID         = 'rgba(45, 55, 72, 0.75)';
    const COLOR_ANGLE_LINE   = 'rgba(45, 55, 72, 0.9)';
    const COLOR_TICK         = '#64748b';
    const COLOR_LABEL        = '#cbd5e1';
    const COLOR_LABEL_NULL   = '#3d4a5c';   // muted; visually indicates missing data
    const COLOR_NULL_BASELINE = 'rgba(51, 65, 85, 0.8)'; // inner polygon fill for all-null baseline


    // Human-readable display names for zone IDs.
    const ZONE_LABELS = {
        '0_mile_buffer': 'Perimeter or Reported Location',
        '1_mile_buffer': '1 Mile Buffer',
        '3_mile_buffer': '3 Mile Buffer',
        '5_mile_buffer': '5 Mile Buffer',
    };

    // Builds the footer note HTML for a given zone ID.
    function buildFooterNote(zoneId) {
        const label = ZONE_LABELS[zoneId] || zoneId;
        return `Scores are <a href="https://www.mathsisfun.com/definitions/logarithmic-scale.html" `
            + `target="_blank" rel="noopener noreferrer">log-scaled</a> per axis, relative to the highest value in the `
            + `<strong>${label} zone</strong> for current wildfires.`;
    }

    // Extracts a datetime string from the parsed last_updated.json payload.
    // Accepts a bare string or any single-key object regardless of the key name,
    // so the data pipeline can freely choose its own field name.
    function extractDatetime(payload) {
        if (typeof payload === 'string') return payload;
        if (typeof payload !== 'object' || payload === null) return null;
        return Object.values(payload).find(v => typeof v === 'string') ?? null;
    }

    function wrapPointLabel(text) {
        if (text.length <= MAX_LABEL_CHARS) return text;
        const words = text.split(' ');
        const lines = [];
        let   line  = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (candidate.length > MAX_LABEL_CHARS && line) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    /**
     * Format a numeric raw value for tooltip display.
     * Integers get locale-aware grouping (e.g. 26,400); floats are capped at one decimal.
     */
    function formatNumber(value) {
        if (value === null || value === undefined) return 'N/A';
        if (typeof value !== 'number') return String(value);
        return Number.isInteger(value)
            ? value.toLocaleString()
            : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    /**
     * Format a single {value, metric} entry for tooltip display.
     */
    function formatRawEntry(entry) {
        if (!entry || entry.value === null || entry.value === undefined) return null;
        const formatted = formatNumber(entry.value);
        return entry.metric ? `${formatted} ${entry.metric}` : formatted;
    }

    /**
     * Build the tooltip text for a single data point.
     *
     * When raw data is available the tooltip is multi-line: the first line shows
     * the pre-normalization value with its metric, the second shows the
     * log-normalized score out of 100. When raw data is unavailable, a single
     * "Score: X / 100" line is returned.
     *
     * Raw entries are either {value, metric} objects (simple metrics) or arrays
     * of such objects (composite metrics). The metric descriptions come from the
     * Python backend — this function applies no domain-specific logic.
     *
     * @param {string}  label      - The chart axis label
     * @param {number}  scoreValue - The log-normalized score (0-100)
     * @param {boolean} isNull     - Whether the value was originally null
     * @param {Object|null} rawData - The full raw dict from the chart JSON (nullable)
     * @returns {string|string[]} Single line or multi-line array for Chart.js tooltip
     */
    function buildTooltipLabel(label, scoreValue, isNull, rawData) {
        if (isNull) return 'No data available';

        const scoreLine = `• Score: ${scoreValue.toFixed(1)} / 100`;

        if (!rawData || !(label in rawData)) return scoreLine;

        const rawEntry = rawData[label];
        if (rawEntry === null || rawEntry === undefined) return scoreLine;

        // Array of sub-values (composite metrics).
        if (Array.isArray(rawEntry)) {
            const parts = rawEntry.map(formatRawEntry).filter(Boolean);
            return parts.length > 0
                ? [`• ${parts.join(' | ')}`, scoreLine]
                : scoreLine;
        }

        // Single {value, metric} object.
        const formatted = formatRawEntry(rawEntry);
        return formatted ? [`• ${formatted}`, scoreLine] : scoreLine;
    }

    // Draws a filled polygon at the value-0 ring before datasets are rendered.
    // This gives the null-baseline inner area a distinct background color.
    const nullBaselinePlugin = {
        id: 'nullBaseline',
        beforeDatasetsDraw(chart) {
            const scale = chart.scales.r;
            if (!scale) return;
            const numPoints   = chart.data.labels.length;
            const innerRadius = scale.getDistanceFromCenterForValue(0);
            const { ctx }     = chart;
            ctx.save();
            ctx.beginPath();
            for (let i = 0; i < numPoints; i++) {
                const pos = scale.getPointPosition(i, innerRadius);
                if (i === 0) ctx.moveTo(pos.x, pos.y);
                else         ctx.lineTo(pos.x, pos.y);
            }
            ctx.closePath();
            ctx.fillStyle = COLOR_NULL_BASELINE;
            ctx.fill();
            ctx.restore();
        },
    };

    /**
     * Render a radar chart into the given canvas element.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {{ title: string, subtitle: string, data: Object, raw?: Object }} chartData
     * @param {{ maintainAspectRatio?: boolean }} [options]
     * @returns {Chart} the Chart.js instance
     */
    function render(canvas, chartData, { maintainAspectRatio = true } = {}) {
        const labels      = Object.keys(chartData.data);
        const scoreValues = Object.values(chartData.data);
        const rawData     = chartData.raw || null;
        const nullFlags   = scoreValues.map(v => v === null);

        // Null values render at origin (0) so the polygon stays closed.
        // pointRadius = 0 hides the dot, making null visually distinct from an actual 0 value.
        const displayValues   = scoreValues.map(v => v === null ? 0 : v);
        const pointColors     = nullFlags.map(n => n ? 'transparent' : COLOR_DATA_POINT);
        const pointRadii      = nullFlags.map(n => n ? 0 : 4);
        const pointHoverRadii = nullFlags.map(n => n ? 0 : 6);
        const pointHitRadii   = nullFlags.map(n => n ? 0 : 8);

        const chart = new Chart(canvas, {
            type: 'radar',
            data: {
                labels,
                datasets: [{
                    data:                 displayValues,
                    fill:                 { value: 0 },
                    backgroundColor:      COLOR_DATA_FILL,
                    borderColor:          COLOR_DATA_BORDER,
                    borderWidth:          1.5,
                    pointBackgroundColor: pointColors,
                    pointBorderColor:     pointColors,
                    pointRadius:          pointRadii,
                    pointHoverRadius:     pointHoverRadii,
                    pointHitRadius:       pointHitRadii,
                }],
            },
            options: {
                responsive:          true,
                maintainAspectRatio: maintainAspectRatio,
                animation:           { duration: 300 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            title: items  => labels[items[0].dataIndex],
                            label: item   => {
                                const i = item.dataIndex;
                                return buildTooltipLabel(
                                    labels[i],
                                    scoreValues[i],
                                    nullFlags[i],
                                    rawData,
                                );
                            },
                        },
                    },
                },
                scales: {
                    r: {
                        min: -25,
                        max:  SCALE_MAX,
                        ticks: {
                            stepSize:      SCALE_STEP,
                            color:         COLOR_TICK,
                            backdropColor: 'transparent',
                            font:          { size: 9 },
                            callback:      v => v < 0 ? '' : `${v}`,
                        },
                        grid: { color: ctx => ctx.tick.value < 0 ? 'transparent' : COLOR_GRID },
                        angleLines: { color: COLOR_ANGLE_LINE },
                        pointLabels: {
                            color:    ctx => nullFlags[ctx.index] ? COLOR_LABEL_NULL : COLOR_LABEL,
                            font:     { size: 10 },
                            callback: wrapPointLabel,
                        },
                    },
                },
            },
            plugins: [nullBaselinePlugin],
        });

        return chart;
    }

    return { render, ZONE_LABELS, buildFooterNote, extractDatetime };
})();
