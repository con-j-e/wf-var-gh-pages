(async () => {

    const hash  = location.hash.substring(1);
    const parts = hash.split('/');

    if (parts.length < 2) {
        document.getElementById('quadrant-grid').innerHTML =
            '<div class="state-error">Invalid URL — expected: incident.html#&lt;region&gt;/&lt;incident-uid&gt;</div>';
        return;
    }

    const [region, uid] = parts;
    const zones = Object.keys(ChartRenderer.ZONE_LABELS);

    // Fetch datetime and chart data concurrently.
    const [, results] = await Promise.all([

        fetch('data/last_updated.json')
            .then(r => r.ok ? r.json() : null)
            .then(payload => {
                const datetime = ChartRenderer.extractDatetime(payload);
                const el = document.getElementById('last-updated');
                if (datetime && el) el.textContent = `Last Updated: ${datetime}`;
            })
            .catch(() => {}),

        Promise.allSettled(
            zones.map(zone =>
                fetch(`data/${region}/${uid}/${zone}.json`).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
            )
        ),

    ]);

    // Set page title from first successful result.
    const firstSuccess = results.find(r => r.status === 'fulfilled');
    if (firstSuccess) {
        const incidentName = firstSuccess.value.title.split(':')[0].trim();
        document.title = incidentName;
        document.getElementById('incident-name').textContent = incidentName;
    }

    const grid = document.getElementById('quadrant-grid');
    grid.innerHTML = '';

    results.forEach((result, i) => {
        const zone = zones[i];
        const cell = document.createElement('div');
        cell.className = 'quadrant-cell';

        if (result.status === 'rejected') {
            cell.innerHTML = `<div class="state-error">Failed to load ${zone}: ${result.reason.message}</div>`;
            grid.appendChild(cell);
            return;
        }

        const chartData = result.value;
        const chartHref = `chart.html#${region}/${uid}/${zone}`;

        cell.innerHTML = `
            <div class="quadrant-header">
                <h3>${chartData.title}</h3>
                <p>${chartData.subtitle} &nbsp;|&nbsp; <a href="${chartHref}" target="_blank">Full view →</a></p>
            </div>
            <div class="quadrant-canvas-wrapper">
                <canvas></canvas>
            </div>
            <p class="chart-footer-note">${ChartRenderer.buildFooterNote(zone)}</p>
        `;

        grid.appendChild(cell);
        ChartRenderer.render(cell.querySelector('canvas'), chartData, { maintainAspectRatio: false });
    });

})();
