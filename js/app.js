(async () => {

    // ── DOM references ─────────────────────────────────────────────
    const regionSelect   = document.getElementById('region-select');
    const incidentSelect = document.getElementById('incident-select');
    const zoneSelect     = document.getElementById('zone-select');
    const addBtn         = document.getElementById('add-chart-btn');
    const overviewLinkEl = document.getElementById('incident-overview-link');
    const chartsGrid     = document.getElementById('charts-grid');
    const emptyState     = document.getElementById('empty-state');
    const lastUpdatedEl  = document.getElementById('last-updated');

    // ── Populate zone options from ChartRenderer ───────────────────
    Object.entries(ChartRenderer.ZONE_LABELS).forEach(([value, label]) => {
        zoneSelect.add(new Option(label, value));
    });

    // ── State ──────────────────────────────────────────────────────
    let incidentMap    = {};   // { region: { name: uid } }
    let incidentLookup = {};   // { name: { region, uid } } — flat O(1) lookup
    const activeCharts = new Map();   // chartId → Chart instance

    // ── Bootstrap ──────────────────────────────────────────────────
    try {
        const response = await fetch('data/incident_map.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        incidentMap = await response.json();
    } catch (err) {
        chartsGrid.innerHTML = `<div class="state-error">Failed to load incident map: ${err.message}</div>`;
        return;
    }

    // Build a flat name → { region, uid } lookup for resolveIncident().
    for (const [region, incidents] of Object.entries(incidentMap)) {
        for (const [name, uid] of Object.entries(incidents)) {
            incidentLookup[name] = { region, uid };
        }
    }

    // Populate region filter options (alphabetical).
    Object.keys(incidentMap).sort().forEach(region => {
        regionSelect.add(new Option(region, region));
    });

    // Incidents are sorted descending by their numeric prefix (highest number first).
    function sortIncidentsDescending(names) {
        return [...names].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    }

    const allIncidentNames = sortIncidentsDescending(
        Object.values(incidentMap).flatMap(Object.keys)
    );

    function populateIncidentSelect(names) {
        const currentValue = incidentSelect.value;
        incidentSelect.innerHTML = '<option value="">— Select incident —</option>';
        sortIncidentsDescending(names).forEach(name => {
            const opt = document.createElement('option');
            opt.value       = name;
            opt.textContent = name;
            incidentSelect.appendChild(opt);
        });
        // Preserve the current selection if it is still in the new list.
        if (names.includes(currentValue)) {
            incidentSelect.value = currentValue;
        }
    }
    populateIncidentSelect(allIncidentNames);

    // Fetch and display last-updated datetime (optional — fails silently).
    fetch('data/last_updated.json')
        .then(r => r.ok ? r.json() : null)
        .then(payload => {
            const datetime = ChartRenderer.extractDatetime(payload);
            if (datetime && lastUpdatedEl) {
                lastUpdatedEl.textContent = `Last Updated: ${datetime}`;
            }
        })
        .catch(() => {});

    // ── Helpers ────────────────────────────────────────────────────

    // Returns resolved incident info for the current selection, or null.
    function resolveIncident() {
        const name  = incidentSelect.value;
        if (!name) return null;
        const entry = incidentLookup[name];
        if (!entry) return null;
        return { region: entry.region, name, uid: entry.uid };
    }

    function refreshOverviewLink() {
        const incident = resolveIncident();
        overviewLinkEl.innerHTML = incident
            ? `<a href="incident.html#${incident.region}/${incident.uid}" target="_blank">View all zones →</a>`
            : '';
    }

    function refreshAddButton() {
        addBtn.disabled = !resolveIncident() || !zoneSelect.value;
    }

    // ── Event listeners ────────────────────────────────────────────

    // Region acts as an optional filter — selecting one narrows the incident dropdown.
    regionSelect.addEventListener('change', () => {
        const region = regionSelect.value;
        const names  = region
            ? Object.keys(incidentMap[region])
            : allIncidentNames;
        populateIncidentSelect(names);
        handleIncidentChange();
    });

    function handleIncidentChange() {
        const incident = resolveIncident();
        zoneSelect.disabled = !incident;
        if (!incident) zoneSelect.value = '';
        refreshOverviewLink();
        refreshAddButton();
    }

    incidentSelect.addEventListener('change', handleIncidentChange);
    zoneSelect.addEventListener('change', refreshAddButton);

    addBtn.addEventListener('click', async () => {
        const incident = resolveIncident();
        const zone     = zoneSelect.value;
        if (!incident || !zone) return;

        const chartId = `${incident.region}--${incident.uid}--${zone}`;
        if (document.getElementById(chartId)) {
            zoneSelect.value = '';
            addBtn.disabled  = true;
            return;
        }

        addBtn.disabled    = true;
        addBtn.textContent = 'Loading…';

        try {
            const response = await fetch(`data/${incident.region}/${incident.uid}/${zone}.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const chartData = await response.json();

            emptyState?.remove();
            const card   = buildCard(chartId, chartData, incident, zone);
            chartsGrid.appendChild(card);
            activeCharts.set(chartId, ChartRenderer.render(card.querySelector('canvas'), chartData));

        } catch (err) {
            console.error('Failed to load chart data:', err);
            const errCard = document.createElement('article');
            errCard.className = 'chart-card';
            errCard.innerHTML = `<div class="state-error" style="padding:2rem">Failed to load chart: ${err.message}</div>`;
            chartsGrid.appendChild(errCard);
            setTimeout(() => errCard.remove(), 4000);
        }

        addBtn.textContent = 'Add Chart';
        zoneSelect.value   = '';
        addBtn.disabled    = true;
    });

    // ── Card builder ───────────────────────────────────────────────

    function buildCard(chartId, chartData, incident, zone) {
        const card     = document.createElement('article');
        card.className = 'chart-card';
        card.id        = chartId;

        const chartHref    = `chart.html#${incident.region}/${incident.uid}/${zone}`;
        const incidentHref = `incident.html#${incident.region}/${incident.uid}`;

        card.innerHTML = `
            <div class="chart-card-header">
                <div class="chart-card-title">
                    <h3>${chartData.title}</h3>
                    <p>${chartData.subtitle}</p>
                </div>
                <div class="chart-card-actions">
                    <a href="${chartHref}" target="_blank" class="action-link" title="Open full chart view">⧉</a>
                    <a href="${incidentHref}" target="_blank" class="action-link" title="View all zones for this incident">☰</a>
                    <button class="action-btn remove-btn" title="Remove chart">✕</button>
                </div>
            </div>
            <div class="canvas-wrapper">
                <canvas></canvas>
            </div>
            <p class="chart-footer-note">${ChartRenderer.buildFooterNote(zone)}</p>
        `;

        card.querySelector('.remove-btn').addEventListener('click', () => {
            activeCharts.get(chartId)?.destroy();
            activeCharts.delete(chartId);
            card.remove();
        });

        return card;
    }

})();
