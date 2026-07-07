#!/usr/bin/env node
/**
 * Generate a star history SVG chart for a GitHub repo.
 * Uses GITHUB_TOKEN from env (falls back to unauthenticated).
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/generate-star-history.mjs <owner/repo> [output.svg]
 *
 * Default output: assets/star-history.svg (relative to repo root, via GITHUB_WORKSPACE)
 */

const OWNER_REPO = process.argv[2] || (process.env.GITHUB_REPOSITORY || 'zosmaai/zosma-cowork');
const OUTPUT = process.argv[3]
  || `${process.env.GITHUB_WORKSPACE || '.'}/assets/star-history.svg`;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const WIDTH = 800;
const HEIGHT = 280;
const PAD = { top: 30, right: 30, bottom: 50, left: 55 };
const CHART_W = WIDTH - PAD.left - PAD.right;
const CHART_H = HEIGHT - PAD.top - PAD.bottom;

async function fetchPaginated(url) {
  const items = [];
  let next = url;
  while (next) {
    const res = await fetch(next, {
      headers: {
        'Accept': 'application/vnd.github.v3.star+json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        'User-Agent': 'star-history-generator',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    items.push(...data);
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return items;
}

function aggregateByMonth(stargazers) {
  const map = {};
  for (const s of stargazers) {
    const key = s.starred_at ? s.starred_at.slice(0, 7) : 'unknown';
    map[key] = (map[key] || 0) + 1;
  }
  const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  let cumulative = 0;
  return sorted.map(([month, count]) => {
    cumulative += count;
    return { month, count, cumulative };
  });
}

function svgChart(data, repo) {
  const n = data.length;
  const cumulativeTotal = n > 0 ? data[n - 1].cumulative : 0;

  // X axis: show a subset of labels
  const maxLabels = Math.min(n, 12);
  const labelStep = Math.max(1, Math.floor(n / maxLabels));

  // Y axis ticks
  const yMax = Math.max(...data.map(d => d.cumulative), 1);
  const yStep = yMax <= 5 ? 1 : yMax <= 20 ? 5 : yMax <= 100 ? 10 : yMax <= 500 ? 50 : yMax <= 1000 ? 100 : 500;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);
  if (yTicks[yTicks.length - 1] < yMax) yTicks.push(yMax);

  const xScale = (i) => PAD.left + (i / Math.max(n - 1, 1)) * CHART_W;
  const yScale = (v) => PAD.top + CHART_H - (v / yMax) * CHART_H;

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.cumulative)}`).join(' ');

  const lines = [];

  // Y axis grid lines + labels
  for (const v of yTicks) {
    const y = yScale(v);
    lines.push(`<line x1="${PAD.left}" y1="${y}" x2="${WIDTH - PAD.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`);
    lines.push(`<text x="${PAD.left - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11" font-family="system-ui,sans-serif">${v}</text>`);
  }

  // X axis labels
  for (let i = 0; i < n; i++) {
    if (i % labelStep !== 0 && i !== n - 1) continue;
    const x = xScale(i);
    // Short label: "Jan '24"
    const d = new Date(data[i].month + '-01');
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    lines.push(`<text x="${x}" y="${HEIGHT - PAD.bottom + 18}" text-anchor="end" fill="#64748b" font-size="10" font-family="system-ui,sans-serif" transform="rotate(-30,${x},${HEIGHT - PAD.bottom + 18})">${label}</text>`);
  }

  // Fill area under line
  const fillPoints = points + ` ${xScale(n - 1)},${yScale(0)} ${xScale(0)},${yScale(0)}`;
  lines.push(`<polygon points="${fillPoints}" fill="url(#gradient)" opacity="0.15"/>`);

  // Line
  lines.push(`<polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);

  // Dots
  if (n <= 36) {
    for (let i = 0; i < n; i++) {
      lines.push(`<circle cx="${xScale(i)}" cy="${yScale(data[i].cumulative)}" r="2.5" fill="#3b82f6"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" rx="8"/>
  <text x="${PAD.left}" y="18" fill="#0f172a" font-size="13" font-weight="600" font-family="system-ui,sans-serif">★ Star History — ${repo}</text>
  <text x="${WIDTH - PAD.right}" y="18" text-anchor="end" fill="#64748b" font-size="11" font-family="system-ui,sans-serif">${cumulativeTotal} stars total</text>
  ${lines.join('\n  ')}
</svg>`;
}

async function main() {
  try {
    const stargazers = await fetchPaginated(
      `https://api.github.com/repos/${OWNER_REPO}/stargazers?per_page=100`
    );
    const data = aggregateByMonth(stargazers);
    if (data.length === 0) throw new Error('No stargazer data returned');

    const svg = svgChart(data, OWNER_REPO);

    // Ensure output directory exists
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, svg, 'utf-8');

    console.log(`✅ Star history chart saved to ${OUTPUT}`);
    console.log(`   Repo: ${OWNER_REPO}, Total stars: ${data[data.length - 1].cumulative}, Months: ${data.length}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
