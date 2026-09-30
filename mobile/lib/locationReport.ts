import { speedToMph } from '@/lib/format';
import { formatDistanceMiles } from '@/lib/geo';
import { formatTripDate, formatTripDuration, type Trip } from '@/lib/trips';
import { shareTextFile, type ShareFileResult } from '@/lib/shareFile';

export interface ReportPing {
  latitude: number;
  longitude: number;
  speed: number | null;
  recorded_at: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// A human-readable, real-data alternative to the raw JSON export: a
// self-contained HTML page with an actual map (Leaflet + OpenStreetMap
// tiles, same free/keyless tiles used everywhere else in the app) tracing
// recent locations, plus the same drive/speed data as "🚗 Recent drives".
// Opening the shared file on the phone that generated it (or any device)
// renders real content, not a raw data dump — built from data the
// location-history screen already has in memory, no extra backend call.
export function buildLocationReportHtml(fullName: string, pings: ReportPing[], trips: Trip[]): string {
  const chronological = [...pings].reverse();
  const points = chronological.map((p) => [p.latitude, p.longitude]);

  const tripRows = trips.length
    ? trips
        .map(
          (t) => `<tr>
            <td>${escapeHtml(formatTripDate(t.startedAt))}</td>
            <td>${escapeHtml(formatTripDuration(t.durationSeconds))}</td>
            <td>${escapeHtml(formatDistanceMiles(t.distanceMeters))}</td>
            <td>${t.maxSpeedMps != null ? `${Math.round(speedToMph(t.maxSpeedMps)!)} mph` : '—'}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4">No trips in the last 30 days.</td></tr>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fullName)} — Location &amp; Driving Report</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 20px; }
  #map { height: 320px; border-radius: 12px; margin-bottom: 24px; background: #eee; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  h2 { font-size: 15px; margin: 24px 0 10px; }
</style>
</head>
<body>
  <h1>${escapeHtml(fullName)}</h1>
  <div class="subtitle">Location &amp; driving report — generated ${new Date().toLocaleString()}</div>
  <div id="map"></div>

  <h2>🚗 Recent drives</h2>
  <table>
    <thead><tr><th>When</th><th>Duration</th><th>Distance</th><th>Top speed</th></tr></thead>
    <tbody>${tripRows}</tbody>
  </table>

  <script>
    const points = ${JSON.stringify(points)};
    const map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    if (points.length) {
      const line = L.polyline(points, { color: '#3b82f6', weight: 3 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
      L.marker(points[points.length - 1]).addTo(map).bindPopup('Most recent');
      L.marker(points[0]).addTo(map).bindPopup('Oldest');
    } else {
      map.setView([0, 0], 2);
    }
  </script>
</body>
</html>`;
}

export async function shareLocationReport(
  fullName: string,
  pings: ReportPing[],
  trips: Trip[],
): Promise<ShareFileResult> {
  const html = buildLocationReportHtml(fullName, pings, trips);
  const date = new Date().toISOString().slice(0, 10);
  return shareTextFile(`safecircle-report-${date}.html`, html, 'text/html', 'Save your location & driving report');
}
