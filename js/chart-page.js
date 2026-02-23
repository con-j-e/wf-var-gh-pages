(async () => {

    const hash  = location.hash.substring(1);
    const parts = hash.split('/');

    if (parts.length < 3) {
        document.getElementById('chart-body').innerHTML =
            '<div class="state-error">Invalid URL — expected: chart.html#&lt;region&gt;/&lt;incident-uid&gt;/&lt;zone-id&gt;</div>';
        return;
    }

    const [region, uid, zone] = parts;

    // Fetch and display last-updated datetime (fails silently if file is absent).
    fetch('data/last_updated.json')
        .then(r => r.ok ? r.json() : null)
        .then(payload => {
            const datetime = ChartRenderer.extractDatetime(payload);
            const el = document.getElementById('last-updated');
            if (datetime && el) el.textContent = `Last Updated: ${datetime}`;
        })
        .catch(() => {});

    try {
        const response = await fetch(`data/${region}/${uid}/${zone}.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const chartData = await response.json();

        document.title = chartData.title;
        document.getElementById('chart-title').textContent    = chartData.title;
        document.getElementById('chart-subtitle').textContent = chartData.subtitle;
        document.getElementById('incident-link').href         = `incident.html#${region}/${uid}`;
        document.getElementById('chart-footer').innerHTML     = ChartRenderer.buildFooterNote(zone);

        ChartRenderer.render(
            document.getElementById('chart-canvas'),
            chartData,
            { maintainAspectRatio: false }
        );

    } catch (err) {
        document.getElementById('chart-body').innerHTML =
            `<div class="state-error">Failed to load chart data: ${err.message}</div>`;
    }

})();
