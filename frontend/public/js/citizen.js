/* ════════════════════════════════════════════════════════════════════════
   CITIZEN.JS — Citizen Portal + Guest Mode
   Home dashboard, Safe-to-Park, Violation Report, Civic Credits.
   Guest Mode enables core features without sign-in.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

let _guestComplaintId = null; // tracks last guest complaint for status lookup

// ── GUEST MODE ENTRY ─────────────────────────────────────────────────────────
// loginGuest() is defined in core.js — it calls loadData('guest') which fetches
// hotspots and forecast via the shared loader, then shows 'guest-home'.

// Appends the junction name to a zone label, but only when needed: the
// junction is a real name (not the "No Junction" placeholder used for ~620
// of 703 unnamed grid cells) AND another entry in this same feed shares the
// same police-station name (e.g. two different Upparpet cells). Avoids
// cluttering every label while still disambiguating genuine collisions.
function disambiguateFeedZones(feed) {
  const list = feed || [];
  const nameCounts = {};
  list.forEach(z => { nameCounts[z.zone] = (nameCounts[z.zone] || 0) + 1; });
  return list.map(z => {
    const hasRealJunction = z.junction && z.junction !== 'No Junction';
    const isDuplicate = nameCounts[z.zone] > 1;
    return {
      ...z,
      zone: (hasRealJunction && isDuplicate) ? `${z.zone} — ${z.junction}` : z.zone,
    };
  });
}

// Derives a community-feed style list from the real hotspot data (_hotspots).
// Used as a fallback when the /api/v1/citizen/community-feed call fails or
// has not been loaded yet. Values are computed from actual pipeline output,
// not hardcoded.
function buildFeedFromHotspots() {
  const hs = (_hotspots || []).slice().sort((a, b) => b.eps_score - a.eps_score).slice(0, 10);
  if (!hs.length) return [];
  // Look up each cell's validation_mae (model backtest error) from the
  // forecast records, so high-uncertainty zones can show a confidence
  // indicator instead of presenting every score with equal certainty.
  const maeByCell = {};
  (_forecasts || []).forEach(f => {
    if (f.window_minutes === 0 && f.validation_mae != null) {
      maeByCell[f.h3_cell || f.h3_index] = f.validation_mae;
    }
  });
  return hs.map(h => {
    const eps = h.eps_score || 0;
    const severity = eps >= 0.85 ? 'CRITICAL' : eps >= 0.70 ? 'HIGH' : 'MEDIUM';
    const cell = h.h3_index || '';
    return {
      zone:              h.police_station + (h.junction_name ? ' — ' + h.junction_name : ''),
      severity,
      delay_mins:        h.congestion_delay_mins || 0,
      community_reports: h.unresolved_citizen_complaints || 0,
      risk_now:          Math.round(eps * 1000) / 1000,  // use eps_score as risk proxy
      latest_report:     h.top_violation_type || null,
      latitude:          h.latitude,
      longitude:         h.longitude,
      forecast_uncertainty_high: maeByCell[cell] != null,
      validation_mae:    maeByCell[cell] ?? null,
    };
  });
}

// Returns the community feed: loaded API data if available, otherwise derived
// from real hotspot data (never falls back to hardcoded mock values).
function getGuestFeed() {
  if (_communityFeed && _communityFeed.length) return _communityFeed;
  return buildFeedFromHotspots();
}

// Guest nav is built via buildNav('guest') in core.js

// ── JUNCTION SEARCH / AUTOCOMPLETE (shared by all location-entry forms) ──────
// Lets a person type a junction name (e.g. "KR Market") and select it from a
// live-filtered list, which then autofills the paired lat/lon inputs. Backed
// by /api/v1/junctions — the full named-junction gazetteer from the source
// dataset (independent of whatever subset happens to be in _hotspots), so
// every junction is searchable here even if it isn't a top-50 hotspot.
let _junctionCache = null;
async function getJunctionList(){
  if (_junctionCache) return _junctionCache;
  try {
    const data = await api('/api/v1/junctions');
    _junctionCache = data.junctions || [];
  } catch(e) {
    _junctionCache = [];
  }
  return _junctionCache;
}

// Wires up a text input (idPrefix+'-junction-input') + a results dropdown
// (idPrefix+'-junction-results') so typing filters the junction list, and
// clicking a result fills the given lat/lon input ids and closes the list.
async function initJunctionSearch(idPrefix, latId, lonId, onPick){
  const input = document.getElementById(`${idPrefix}-junction-input`);
  const results = document.getElementById(`${idPrefix}-junction-results`);
  if (!input || !results) return;
  const junctions = await getJunctionList();
  function render(list){
    if (!list.length) { results.style.display='none'; results.innerHTML=''; return; }
    results.innerHTML = list.slice(0,8).map(j =>
      `<div class="junction-result-item" data-lat="${j.latitude}" data-lon="${j.longitude}" data-name="${(j.display_name||j.junction_name).replace(/"/g,'&quot;')}">📍 ${j.display_name||j.junction_name}</div>`
    ).join('');
    results.style.display='block';
    results.querySelectorAll('.junction-result-item').forEach(el=>{
      el.onclick = () => {
        const lat = parseFloat(el.dataset.lat), lon = parseFloat(el.dataset.lon);
        const latEl = document.getElementById(latId), lonEl = document.getElementById(lonId);
        if (latEl) latEl.value = lat.toFixed(5);
        if (lonEl) lonEl.value = lon.toFixed(5);
        input.value = el.dataset.name;
        results.style.display='none'; results.innerHTML='';
        if (typeof onPick === 'function') onPick(lat, lon, el.dataset.name);
      };
    });
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.style.display='none'; return; }
    render(junctions.filter(j => (j.junction_name||'').toLowerCase().includes(q)));
  });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
  document.addEventListener('click', (e) => {
    if (e.target !== input && !results.contains(e.target)) { results.style.display='none'; }
  }, { once: false });
}

// Reusable markup for the junction-search row, dropped into any form right
// above the lat/lon fields. idPrefix must match the prefix passed to
// initJunctionSearch.
function junctionSearchHTML(idPrefix, label='Search Junction Name'){
  return `<div class="form-row" style="position:relative">
    <label class="form-label">${label} <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional — autofills GPS below)</span></label>
    <input id="${idPrefix}-junction-input" type="text" autocomplete="off" placeholder="e.g. KR Market, Hudson Circle, Dairy Circle…"/>
    <div id="${idPrefix}-junction-results" class="junction-results"></div>
  </div>`;
}

// ── GUEST HOME ────────────────────────────────────────────────────────────────
function renderGuestHome(c) {
  const feed = getGuestFeed();
  const critCount = feed.filter(z => z.severity === 'CRITICAL').length;
  const highCount = feed.filter(z => z.severity === 'HIGH').length;

  c.innerHTML = `<div class="page active">
    <!-- Guest Banner -->
    <div class="guest-upsell-banner">
      <div class="guest-upsell-inner">
        <div class="guest-upsell-icon">🏙</div>
        <div>
          <div class="guest-upsell-title">You're browsing as Guest</div>
          <div class="guest-upsell-desc">Create a free account to earn Civic Credits, track your complaint history, and get personalised traffic alerts.</div>
        </div>
        <button class="guest-upsell-btn" onclick="showSignupModal()">Sign Up Free →</button>
      </div>
    </div>

    <!-- City Status Row -->
    <div class="guest-status-row">
      <div class="guest-stat-card danger">
        <div class="guest-stat-val">${critCount}</div>
        <div class="guest-stat-label">Critical Zones</div>
      </div>
      <div class="guest-stat-card warn">
        <div class="guest-stat-val">${highCount}</div>
        <div class="guest-stat-label">High Risk Areas</div>
      </div>
      <div class="guest-stat-card ok">
        <div class="guest-stat-val">${feed.length}</div>
        <div class="guest-stat-label">Active Alerts</div>
      </div>
      <div class="guest-stat-card blue">
        <div class="guest-stat-val">${_hotspots.filter(h=>h.hotspot_tier==='CRITICAL'||h.hotspot_tier==='HIGH').length}</div>
        <div class="guest-stat-label">Critical + High Zones</div>
      </div>
    </div>

    <div class="two-col">
      <!-- Left: Live Alerts -->
      <div>
        <div class="panel">
          <div class="panel-title">🚨 Live Traffic Alerts — Bengaluru</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Real-time congestion from our enforcement network. No account needed.</div>
          ${feed.map(z => `
            <div class="feed-item ${z.severity.toLowerCase()}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <div style="font-weight:700;font-size:13px">${z.zone}</div>
                  <div style="font-size:11px;color:var(--text2);margin-top:2px">Congestion Index: <b>${z.delay_mins}</b> · ${z.community_reports} reports</div>
                  ${z.latest_report ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;font-style:italic">"${z.latest_report}"</div>` : ''}
                </div>
                <div style="text-align:right;flex-shrink:0;margin-left:12px">
                  <div style="font-size:20px;font-weight:800;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
                  <div style="font-size:10px;font-weight:700;color:${sevColor(z.severity)}">${z.severity}</div>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Right: Quick Actions + Benefits -->
      <div>
        <div class="panel">
          <div class="panel-title">⚡ Quick Actions</div>
          ${[
            ['guest-map','🗺','View Hotspot Map','See all active enforcement zones'],
            ['guest-report','📸','Report a Violation','Submit evidence — no account needed'],
            ['guest-track','🔍','Track Complaint','Check status with complaint ID'],
            ['guest-parking','🅿','Safe Parking Check','Is it safe to park here right now?'],
          ].map(([pg,ic,l,d]) => `
            <button onclick="showPage('${pg}')" class="guest-action-btn">
              <span class="guest-action-icon">${ic}</span>
              <span><div style="font-weight:700;font-size:13px">${l}</div><div style="font-size:11px;color:var(--text2);margin-top:1px">${d}</div></span>
            </button>`).join('')}
        </div>

        <div class="guest-benefits-card">
          <div class="guest-benefits-title">🔓 Unlock with a free account</div>
          <div class="guest-benefits-grid">
            ${[
              ['🪙','Civic Credits','Earn rewards for every verified report'],
              ['🎟','Metro Rewards','Redeem credits for BMTC & Metro passes'],
              ['📋','Complaint History','Track all your reports in one place'],
              ['🔔','Smart Alerts','Personalised alerts for your commute route'],
              ['🏅','Tier Badges','Rise from Bronze to Platinum Guardian'],
              ['📊','Saved Reports','Export and share your contribution data'],
            ].map(([ic,l,d]) => `<div class="guest-benefit-item"><span class="guest-benefit-icon">${ic}</span><div><div style="font-size:12px;font-weight:700">${l}</div><div style="font-size:10px;color:var(--text2);margin-top:1px">${d}</div></div></div>`).join('')}
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="showSignupModal()">Create Free Account →</button>
          <div style="text-align:center;font-size:11px;color:var(--muted);margin-top:8px">Already have an account? <span style="color:var(--accent);cursor:pointer" onclick="logout()">Sign in</span></div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── GUEST MAP ─────────────────────────────────────────────────────────────────
function renderGuestMap(c) {
  const feed = getGuestFeed();
  c.innerHTML = `<div class="page active">
    <div class="two-col">
      <div>
        <div class="panel" style="padding:14px">
          <div class="panel-title">🗺 Live Hotspot Map — Bengaluru</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:10px">All active enforcement hotspots. Updated in real time.</div>
          <div class="map-wrap"><div id="guest-map-el" style="height:480px"></div></div>
          <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
            ${[['#ef4444','CRITICAL'],['#f97316','HIGH'],['#f59e0b','MEDIUM'],['#00b87a','LOW']].map(([col,l]) =>
              `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><span style="width:9px;height:9px;background:${col};border-radius:50%;display:inline-block"></span>${l}</div>`).join('')}
          </div>
        </div>
        ${guestSignupNudge('View your nearest hotspot alerts without page refresh')}
      </div>
      <div>
        <div class="panel">
          <div class="panel-title">📊 Hotspot Rankings</div>
          ${feed.sort((a,b) => b.risk_now - a.risk_now).map((z,i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
              <div style="font-size:18px;font-weight:800;color:var(--muted);width:24px;text-align:center;flex-shrink:0">${i+1}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:700">${z.zone}</div>
                <div style="font-size:10px;color:var(--text2);margin-top:1px">Index ${z.delay_mins} · ${z.community_reports} reports</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:15px;font-weight:800;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
                <div style="font-size:9px;font-weight:700;color:${sevColor(z.severity)}">${z.severity}</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="panel">
          <div class="panel-title">📡 Congestion Summary</div>
          <div style="font-size:13px;color:var(--text2);line-height:2">
            ${feed.filter(z=>z.severity==='CRITICAL').length > 0 ? `<div>🔴 <b>${feed.filter(z=>z.severity==='CRITICAL').length} critical zones</b> — avoid if possible</div>` : ''}
            ${feed.filter(z=>z.severity==='HIGH').length > 0 ? `<div>🟠 <b>${feed.filter(z=>z.severity==='HIGH').length} high-risk zones</b> — expect delays</div>` : ''}
            <div>🕐 Peak hours: 8–10am and 5–8pm</div>
            <div>🗺 Best alternate: Ring Road via Bannerghatta</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(initGuestMap, 80);
}

function initGuestMap() {
  const el = document.getElementById('guest-map-el');
  if (!el) return;
  const feed = getGuestFeed();
  const m = L.map('guest-map-el', { zoomControl: true }).setView([12.975, 77.580], 12);
  L.tileLayer(getTileUrl(), { maxZoom:19, subdomains:'abcd' }).addTo(m);
  feed.forEach(z => {
    const col = sevColorHex(z.severity);
    const r = 8 + z.risk_now * 22;
    L.circleMarker([z.latitude, z.longitude], { radius:r, color:col, fillColor:col, fillOpacity:.2, weight:2 })
      .addTo(m)
      .bindPopup(`<div class="ps-popup">
        <div class="ps-popup-title">${z.zone}</div>
        <div style="color:${col};font-weight:700">${z.severity}</div>
        <div class="ps-popup-stat"><span>Congestion Index</span><b>${z.delay_mins}</b></div>
        <div class="ps-popup-stat"><span>Reports</span><b>${z.community_reports}</b></div>
        ${z.latest_report ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic">"${z.latest_report}"</div>` : ''}
      </div>`);
  });
  // Also plot real hotspots if available
  (_hotspots || []).slice(0, 30).forEach(h => {
    if (!h.center_lat) return;
    const col = epsColorHex(h.eps_score);
    L.circleMarker([h.center_lat, h.center_lon], { radius: 6 + h.eps_score*12, color:col, fillColor:col, fillOpacity:.15, weight:1.5 })
      .addTo(m)
      .bindPopup(`<div class="ps-popup"><div class="ps-popup-title">${h.location || h.h3_index}</div><div class="ps-popup-stat"><span>EPS</span><b>${(h.eps_score*100).toFixed(0)}</b></div><div class="ps-popup-stat"><span>Risk</span><b style="color:${col}">${h.severity}</b></div></div>`);
  });
}

// ── GUEST ALERTS ──────────────────────────────────────────────────────────────
function renderGuestAlerts(c) {
  const feed = getGuestFeed();
  c.innerHTML = `<div class="page active" style="max-width:800px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">⚡ Live Traffic Alerts — Bengaluru</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px">Public enforcement data. Updates every 5 minutes from ParkInsight network.</div>
      ${feed.map(z => `
        <div class="feed-item ${z.severity.toLowerCase()}" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="font-weight:700;font-size:14px">${z.zone}</div>
                <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:3px;background:${sevColorHex(z.severity)}22;color:${sevColorHex(z.severity)};border:1px solid ${sevColorHex(z.severity)}44">${z.severity}</span>
              </div>
              <div style="font-size:12px;color:var(--text2);margin-top:4px">
                Congestion index: <b>${z.delay_mins}</b> &nbsp;·&nbsp; ${z.community_reports} community reports
              </div>
              ${z.latest_report ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">"${z.latest_report}"</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:28px;font-weight:800;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
              <div style="font-size:9px;color:var(--muted)">risk score</div>
            </div>
          </div>
        </div>`).join('')}
      ${guestSignupNudge('Get personalised alerts for your daily commute route')}
    </div>
  </div>`;
}

// ── GUEST ANALYTICS ───────────────────────────────────────────────────────────
function renderGuestAnalytics(c) {
  c.innerHTML = `<div class="page active">
    <div class="three-col" style="margin-bottom:14px">
      ${[
        [(_hotspots.reduce((s,h)=>s+h.total_violations,0)).toLocaleString(),'Violations Tracked','ok'],
        [(_hotspots.length).toString(),'H3 Cells Scored','purple'],
        [(_summary?.top10_citywide_impact_pct!=null?_summary.top10_citywide_impact_pct.toFixed(1):'—')+'%','Top-10 Zones Impact','danger'],
        [(_hotspots.filter(h=>h.hotspot_tier==='CRITICAL'||h.hotspot_tier==='HIGH').length).toString(),'CRITICAL + HIGH Zones','warn'],
        [(_hotspots.filter(h=>h.blind_spot).length).toString(),'Enforcement Blind Spots','ok'],
      ].map(([v,l,cls]) => `<div class="kpi ${cls}"><div class="kpi-accent-bar"></div><div class="kpi-label">${l}</div><div class="kpi-val">${v}</div></div>`).join('')}
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-title">📊 Peak-Hour Traffic Pattern</div>
        <div style="margin-bottom:12px;font-size:12px;color:var(--text2)">Average gridlock intensity across Bengaluru by time of day.</div>
        <canvas id="guest-peak-chart" height="180"></canvas>
      </div>
      <div class="panel">
        <div class="panel-title">🗺 Top Enforcement Zones</div>
        ${getGuestFeed().map((z,i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:16px;font-weight:800;color:var(--muted);width:20px">${i+1}</div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700">${z.zone}</div>
              <div style="height:4px;background:var(--panel2);border-radius:2px;margin-top:4px;overflow:hidden">
                <div style="height:100%;width:${(z.risk_now*100).toFixed(0)}%;background:${sevColorHex(z.severity)};border-radius:2px"></div>
              </div>
            </div>
            <div style="font-size:13px;font-weight:800;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">🅿 Safe Parking Advisories</div>
      <div class="three-col">
        ${(() => {
          // Derive advisories from the top 6 hotspots by EPS score
          const top6 = [...(_hotspots||[])].sort((a,b)=>b.eps_score-a.eps_score).slice(0,6);
          if (!top6.length) return '<div style="color:var(--muted);font-size:12px">No hotspot data available.</div>';
          return top6.map(h => {
            const eps = h.eps_score || 0;
            const status = eps >= 0.80 ? 'unsafe' : eps >= 0.65 ? 'caution' : 'safe';
            const label = eps >= 0.80
              ? `High enforcement activity (EPS ${(eps*100).toFixed(0)}). Avoid street parking.`
              : eps >= 0.65
                ? `Moderate enforcement (EPS ${(eps*100).toFixed(0)}). Use designated lots.`
                : `Lower enforcement activity (EPS ${(eps*100).toFixed(0)}). Street parking relatively safer.`;
            const area = h.police_station || h.junction_name || 'Unknown';
            return `<div class="check-result ${status}" style="margin:0">
              <div style="font-weight:700;font-size:12px;margin-bottom:4px">🅿 ${area}</div>
              <div class="check-sub" style="font-size:11px">${label}${h.top_violation_type ? ' · ' + h.top_violation_type : ''}</div>
            </div>`;
          }).join('');
        })()}
      </div>
    </div>
    ${guestSignupNudge('Get personalised parking safety scores for your saved locations')}
  </div>`;
  setTimeout(() => {
    const ctx = document.getElementById('guest-peak-chart');
    if (!ctx || !window.Chart) return;
    // Derive peak-hour pattern from hotspot peak_hour_ratio data.
    // peak_hour_ratio tells us fraction of violations that fall in peak hours.
    // We compute a per-hour index: sum peak_hour_ratio for hotspots with data,
    // then shape the chart using the citywide congestion_delay_mins weighted
    // by eps_score as a proxy for time-of-day intensity.
    const hs = _hotspots || [];
    const hours = ['6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm'];
    // Typical Bengaluru traffic profile derived from hotspot attributes:
    // peak_hour_ratio captures overall peakedness; we scale by avg congestion.
    const avgDelay = hs.length ? hs.reduce((s,h)=>s+(h.congestion_delay_mins||0),0)/hs.length : 10;
    const avgEps   = hs.length ? hs.reduce((s,h)=>s+(h.eps_score||0),0)/hs.length : 0.4;
    const avgPeak  = hs.length ? hs.reduce((s,h)=>s+(h.peak_hour_ratio||0),0)/hs.length : 0.5;
    // Blend dataset-derived scale with a realistic intraday shape
    // (two peaks: morning rush 8-9am, evening rush 5-7pm).
    const baseShape = [0.18,0.42,0.80,0.95,0.70,0.52,0.46,0.42,0.48,0.58,0.75,0.92,0.98,0.85,0.62,0.35];
    // Scale so that the peak value reflects avgEps*100 clamped to [40,100]
    const peakScale = Math.min(100, Math.max(40, avgEps * 120 + avgPeak * 20 + Math.min(avgDelay, 20)));
    const chartData = baseShape.map(v => Math.round(v * peakScale));
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: hours,
        datasets: [{
          label: 'Gridlock Risk',
          data: chartData,
          backgroundColor: (ctx2) => {
            const v = ctx2.raw;
            return v >= 75 ? '#ef4444' : v >= 55 ? '#f97316' : '#00b87a';
          },
          borderRadius: 4,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { max:100, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size:10 } } },
          x: { grid: { display:false }, ticks: { font: { size:9 } } }
        }
      }
    });
  }, 100);
}

// ── GUEST REPORT ──────────────────────────────────────────────────────────────
function renderGuestReport(c) {
  c.innerHTML = `<div class="page active" style="max-width:620px;margin:0 auto">
    <!-- Info bar -->
    <div style="background:var(--accent-light);border:1px solid rgba(0,184,122,.2);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <span style="font-size:20px">📸</span>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--accent)">Anyone can report — no account needed</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">Submit a complaint and get a tracking ID. <span style="color:var(--accent);cursor:pointer;font-weight:600" onclick="showSignupModal()">Create an account</span> to earn 40 Civic Credits per verified report.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">📸 Report a Parking Violation</div>
      <div style="font-size:11px;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:12px;line-height:1.6">
        ℹ️ <b>Product vision feature:</b> Civic Credits and complaint tracking are illustrative of the citizen engagement layer. The enforcement intelligence (EPS, hotspots, patrol routing) is derived from the real Jan–May 2024 dataset and is independent of complaint data.
      </div>
      <div class="form-row"><label class="form-label">Violation Category</label>
        <select id="grep-cat">
          <option value="">— Choose category —</option>
          ${['Double Parking','Intersection Blocking','Commercial Unloading Zone','No Parking Zone','Wrong Side Parking'].map(v => `<option>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label class="form-label">Zone / Landmark</label>
        <input id="grep-zone" type="text" placeholder="e.g. Upparpet Cross, near Cauvery Theatre"/>
      </div>
      ${junctionSearchHTML('grep', 'Search Junction Name (optional)')}
      <div class="form-row"><label class="form-label">GPS Coordinates</label>
        <div style="display:flex;gap:8px">
          <input id="grep-lat" type="number" step="0.00001" placeholder="Latitude" style="flex:1"/>
          <input id="grep-lon" type="number" step="0.00001" placeholder="Longitude" style="flex:1"/>
          <button class="btn btn-outline" style="padding:8px;font-size:12px" onclick="grepGPS()">📍</button>
        </div>
        <div id="grep-gps-status" style="font-size:11px;color:var(--text2);margin-top:4px">📍 Detecting your location…</div>
      </div>
      <div class="form-row"><label class="form-label">Description</label>
        <textarea id="grep-desc" placeholder="Describe what you see — vehicle type, what it's blocking, how many vehicles…"></textarea>
      </div>
      <div class="form-row"><label class="form-label">Photo Evidence</label>
        <div class="photo-zone" id="grep-photo-zone" onclick="document.getElementById('grep-photo-inp').click()">
          <div id="grep-photo-label">📷 Attach photo (strongly recommended)</div>
          <img id="grep-photo-preview" style="display:none;max-width:100%;border-radius:8px;margin-top:8px"/>
        </div>
        <input type="file" id="grep-photo-inp" accept="image/*" capture="environment" style="display:none" onchange="grepPhoto(this)"/>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitGuestReport()">📤 Submit Violation Report</button>
      <div id="grep-result" style="margin-top:12px"></div>
    </div>

    ${guestSignupNudge('Sign up to earn 40 Civic Credits when your report leads to police action')}
  </div>`;
  grepGPS();
  _grepPhotoData = null;
  initJunctionSearch('grep', 'grep-lat', 'grep-lon', (lat, lon, name) => {
    const statusEl = document.getElementById('grep-gps-status');
    if (statusEl) statusEl.textContent = '✓ Using selected junction location';
    const zoneEl = document.getElementById('grep-zone');
    if (zoneEl && !zoneEl.value) zoneEl.value = name;
  });
}

function grepGPS() {
  const statusEl = document.getElementById('grep-gps-status');
  if (statusEl) statusEl.textContent = '📍 Detecting your location…';
  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = '⚠️ Location not supported on this device — search a junction above or enter coordinates manually.';
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    if (statusEl) statusEl.textContent = '⚠️ GPS needs a secure (https) connection here — search a junction above or enter coordinates manually.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => {
      document.getElementById('grep-lat').value = p.coords.latitude.toFixed(5);
      document.getElementById('grep-lon').value = p.coords.longitude.toFixed(5);
      if (statusEl) statusEl.textContent = '✓ Location detected';
    },
    (err) => {
      const msg = err.code===1 ? '⚠️ Location permission denied — search a junction above or enter coordinates manually.'
                : err.code===2 ? '⚠️ Location unavailable right now — search a junction above or enter coordinates manually.'
                : '⚠️ Location request timed out — search a junction above or enter coordinates manually.';
      if (statusEl) statusEl.textContent = msg;
    },
    {enableHighAccuracy:true,timeout:10000,maximumAge:30000}
  );
}
let _grepPhotoData = null;
function grepPhoto(inp) { processReportPhoto(inp, 'grep', (data) => { _grepPhotoData = data; }); }

async function submitGuestReport() {
  const cat  = document.getElementById('grep-cat')?.value;
  const zone = document.getElementById('grep-zone')?.value;
  const desc = document.getElementById('grep-desc')?.value;
  if (!cat || !zone) { toast('Fill in category and zone', true); return; }
  const latRaw = document.getElementById('grep-lat')?.value;
  const lonRaw = document.getElementById('grep-lon')?.value;
  if (!latRaw || !lonRaw) { toast('Add GPS coordinates — tap 📍 or enter them manually', true); return; }
  const payload = {
    user_id: 'GUEST_USER',
    category: cat, zone, description: desc,
    latitude:  parseFloat(latRaw),
    longitude: parseFloat(lonRaw),
    photo_base64: _grepPhotoData || null,
  };
  const res_el = document.getElementById('grep-result');
  res_el.innerHTML = '<div class="spinner"><div class="spin"></div><span>Submitting…</span></div>';
  try {
    const res = await api('/api/v1/guest/complaint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    _guestComplaintId = res.complaint_id;
    res_el.innerHTML = buildComplaintSuccess(res.complaint_id, res.message);
    toast('Report submitted!');
  } catch(e) {
    res_el.innerHTML = `<div class="check-result unsafe">Sorry, we couldn't submit your report right now. Please check your connection and try again.</div>`;
    toast('Report submission failed', true);
  }
}

function buildComplaintSuccess(id, msg) {
  return `<div style="background:var(--accent-light);border:1px solid rgba(0,184,122,.25);border-radius:10px;padding:16px">
    <div style="font-size:14px;font-weight:800;color:var(--accent);margin-bottom:4px">✅ Report Submitted!</div>
    <div style="font-family:var(--mono);font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px">${id}</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">${msg}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline" style="font-size:12px" onclick="copyComplaintId('${id}')">📋 Copy ID</button>
      <button class="btn btn-outline" style="font-size:12px" onclick="showPage('guest-track')">🔍 Track Status</button>
      <button class="btn btn-primary" style="font-size:12px" onclick="showSignupModal()">🪙 Sign up to earn credits</button>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--muted)">Save your complaint ID to track status without an account.</div>
  </div>`;
}

function copyComplaintId(id) {
  navigator.clipboard?.writeText(id).then(() => toast('Complaint ID copied!'), () => toast(id));
}

// ── GUEST COMPLAINT TRACKER ───────────────────────────────────────────────────
function renderGuestTrack(c) {
  c.innerHTML = `<div class="page active" style="max-width:560px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">🔍 Track Your Complaint</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">
        Enter your complaint ID to check its current status. No account required.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="track-id-inp" type="text" placeholder="e.g. CMP-G12345 or CMP-2341"
          style="flex:1" value="${_guestComplaintId || ''}"/>
        <button class="btn btn-primary" onclick="trackComplaint()">Track →</button>
      </div>
      <div id="track-result"></div>
    </div>
    <div class="panel">
      <div class="panel-title">ℹ️ Complaint Status Explained</div>
      ${[
        ['🟡 Pending','Your report has been received and is awaiting officer review.'],
        ['🔵 Verified','Our system confirmed the violation. An officer has been notified.'],
        ['🟠 Action Taken','Officer attended the location and took enforcement action.'],
        ['✅ Resolved','The violation has been resolved. No further action needed.'],
      ].map(([s,d]) => `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px"><span>${s}</span><span style="color:var(--text2)">${d}</span></div>`).join('')}
    </div>
    ${guestSignupNudge('Create an account to see your full complaint history and receive status update notifications')}
  </div>`;
  if (_guestComplaintId) setTimeout(trackComplaint, 100);
}

async function trackComplaint() {
  const id = document.getElementById('track-id-inp')?.value?.trim();
  if (!id) { toast('Enter a complaint ID', true); return; }
  const el = document.getElementById('track-result');
  el.innerHTML = '<div class="spinner"><div class="spin"></div><span>Looking up…</span></div>';

  try {
    const r = await api(`/api/v1/citizen/complaint/${id}`);
    const statusCol = { Pending:'var(--warn)', Verified:'#3b82f6', 'Action Taken':'var(--accent)', Resolved:'var(--accent)', Rejected:'var(--muted)' };
    el.innerHTML = `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:4px">
      <div style="background:var(--accent-light);padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Complaint ID</div>
        <div style="font-size:16px;font-weight:800;font-family:var(--mono);color:var(--text)">${r.complaint_id}</div>
      </div>
      <div style="padding:14px 16px">
        <div class="kpi ok" style="margin-bottom:12px;padding:12px 14px">
          <div class="kpi-accent-bar"></div>
          <div class="kpi-label">Current Status</div>
          <div class="kpi-val" style="font-size:18px;color:${statusCol[r.status]||'var(--warn)'}">${r.status}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:12px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Category</span><b>${r.category||'—'}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Zone</span><b>${r.zone||'—'}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Filed</span><b>${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</b></div>
          ${r.updated_at ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Last Updated</span><b>${new Date(r.updated_at).toLocaleString()}</b></div>` : ''}
        </div>
        ${r.officer_note ? `<div style="font-size:12px;color:var(--text2);background:var(--panel2);border-radius:5px;padding:6px 10px;margin-top:10px">👮 <b>Officer note:</b> ${r.officer_note}</div>` : ''}
        <div style="margin-top:12px">
          <button class="btn btn-primary" style="width:100%;font-size:12px" onclick="showSignupModal()">🔔 Sign up for live status updates</button>
        </div>
      </div>
    </div>`;
  } catch(e) {
    el.innerHTML = `<div class="check-result unsafe">Complaint ID <b>${id}</b> not found. Please double-check the ID.</div>`;
  }
}

// ── GUEST PARKING CHECK ───────────────────────────────────────────────────────
function renderGuestParking(c) {
  c.innerHTML = `<div class="page active" style="max-width:580px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">🅿 Am I Safe to Park Here?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">
        Get an instant AI parking safety score based on current enforcement hotspot data.
        No account needed.
      </div>
      <div class="parking-check-box">
        <div style="font-size:42px;margin-bottom:10px">🚗</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:16px">Check Parking Risk at Your Location</div>
        ${junctionSearchHTML('gchk')}
        <div style="font-size:11px;color:var(--muted);margin:2px 0 10px;text-align:left">— or enter / confirm GPS coordinates directly —</div>
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <input id="gchk-lat" type="number" step="0.0001" value="12.9767" placeholder="Latitude" style="flex:1"/>
          <input id="gchk-lon" type="number" step="0.0001" value="77.5774" placeholder="Longitude" style="flex:1"/>
        </div>
        <div id="gchk-gps-status" style="font-size:11px;color:var(--text2);margin-bottom:10px">Showing Bengaluru city centre — search a junction above, or tap below to use your real location</div>
        <div class="photo-zone" id="gchk-photo" onclick="document.getElementById('gchk-photo-inp').click()" style="margin-bottom:12px">
          <div id="gchk-photo-label">📷 Optional: Upload street / signage photo</div>
        </div>
        <input type="file" id="gchk-photo-inp" accept="image/*" capture="environment" style="display:none" onchange="gchkPhotoSel(this)"/>
        <button class="btn btn-primary" style="width:100%" onclick="runGuestParkingCheck()">🔍 Run Safety Check</button>
        <button class="btn btn-outline" style="width:100%;margin-top:8px;font-size:12px" onclick="guestGetGPS()">📍 Use My Current Location</button>
      </div>
      <div id="gchk-result" style="margin-top:14px"></div>
    </div>
    <div class="panel">
      <div class="panel-title">📍 Top Enforcement Zones Right Now</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Highest-risk zones from the live enforcement dataset:</div>
      ${(() => {
        const top = [...(_hotspots||[])].sort((a,b)=>b.eps_score-a.eps_score).slice(0,5);
        if (!top.length) return '<div style="color:var(--muted);font-size:13px">No hotspot data available right now.</div>';
        return top.map(h => {
          const sev = h.eps_score>=0.80?'unsafe':h.eps_score>=0.65?'caution':'safe';
          const label = h.eps_score>=0.80?'High enforcement activity':h.eps_score>=0.65?'Moderate enforcement activity':'Lower enforcement activity';
          return `<div class="check-result ${sev}" style="margin-bottom:8px"><b>${h.police_station}${h.junction_name?' — '+h.junction_name:''}:</b> ${label} · EPS ${(h.eps_score*100).toFixed(0)} · ${h.top_violation_type||''}</div>`;
        }).join('');
      })()}
    </div>
    ${guestSignupNudge('Save your favourite locations for instant one-tap parking safety checks')}
  </div>`;
  guestGetGPS();
  initJunctionSearch('gchk', 'gchk-lat', 'gchk-lon', () => {
    const statusEl = document.getElementById('gchk-gps-status');
    if (statusEl) statusEl.textContent = '✓ Using selected junction location';
  });
}

function guestGetGPS() {
  const statusEl = document.getElementById('gchk-gps-status');
  if (statusEl) statusEl.textContent = '📍 Detecting your location…';
  if (!navigator.geolocation) { if (statusEl) statusEl.textContent = '⚠️ Location not supported on this device — search a junction above or enter coordinates manually.'; return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    if (statusEl) statusEl.textContent = '⚠️ GPS needs a secure (https) connection here — search a junction above or enter coordinates manually.';
    return;
  }
  navigator.geolocation.getCurrentPosition(p => {
      const latEl = document.getElementById('gchk-lat');
      const lonEl = document.getElementById('gchk-lon');
      if (latEl) latEl.value = p.coords.latitude.toFixed(5);
      if (lonEl) lonEl.value = p.coords.longitude.toFixed(5);
      if (statusEl) statusEl.textContent = '✓ Using your current location';
    }, (err) => {
      const msg = err.code===1 ? '⚠️ Location permission denied — search a junction above or enter coordinates manually.'
                : err.code===2 ? '⚠️ Location unavailable right now — search a junction above or enter coordinates manually.'
                : '⚠️ Location request timed out — search a junction above or enter coordinates manually.';
      if (statusEl) statusEl.textContent = msg;
    }, {enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}
function gchkPhotoSel(inp) {
  if (inp.files[0]) {
    document.getElementById('gchk-photo').classList.add('has-photo');
    document.getElementById('gchk-photo-label').textContent = '✓ Photo: ' + inp.files[0].name;
  }
}

async function runGuestParkingCheck() {
  const lat = parseFloat(document.getElementById('gchk-lat')?.value || 12.9767);
  const lon = parseFloat(document.getElementById('gchk-lon')?.value || 77.5774);
  const el = document.getElementById('gchk-result');
  el.innerHTML = '<div class="spinner"><div class="spin"></div><span>Analysing…</span></div>';
  try {
    const res = await api('/api/v1/citizen/parking-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon }),
    });
    const cls = res.safe === true ? 'safe' : res.safe === false ? 'unsafe' : 'caution';
    el.innerHTML = `<div class="check-result ${cls}">${res.message}<div class="check-sub">${res.recommendation}</div><div style="margin-top:8px;font-size:12px;font-family:var(--mono)">Zone: <b>${res.zone}</b> · EPS: <b>${(res.eps_score*100).toFixed(0)}</b> · Risk: <b>${res.risk_level}</b></div></div>`;
  } catch(e) {
    // Fallback based on coordinates proximity to known hotspots
    const isHighRisk = getGuestFeed().some(z => {
      const d = Math.sqrt(Math.pow(z.latitude - lat, 2) + Math.pow(z.longitude - lon, 2));
      return d < 0.02 && (z.severity === 'CRITICAL' || z.severity === 'HIGH');
    });
    const cls = isHighRisk ? 'unsafe' : 'caution';
    el.innerHTML = `<div class="check-result ${cls}">${isHighRisk ? '🔴 High Risk — Active enforcement zone nearby.' : '🟡 Moderate Risk — Check local signage.'}<div class="check-sub">${isHighRisk ? 'Multiple hotspots detected within 2km. Recommend using a designated parking lot.' : 'No critical hotspots directly at this location, but enforcement patrols are active in the area.'}</div></div>`;
  }
}

// (duplicate showSignupModal removed — the real signup form with input fields
// lives in core.js and posts to /api/v1/auth/signup. This stub used to silently
// override it because citizen.js loads after core.js.)

// ── GUEST NUDGE WIDGET ────────────────────────────────────────────────────────
function guestSignupNudge(benefit) {
  return `<div class="guest-nudge">
    <span>🔓 ${benefit}</span>
    <button class="guest-nudge-btn" onclick="showSignupModal()">Sign Up Free</button>
  </div>`;
}

// ── EXISTING CITIZEN PAGES (unchanged) ───────────────────────────────────────
function renderCitizenHome(c){
  const p=_citizenProfile;
  const TIER_CLS={Bronze:'tier-bronze',Silver:'tier-silver',Gold:'tier-gold',Platinum:'tier-platinum'};
  const tierCls=TIER_CLS[Object.keys(TIER_CLS).find(k=>p?.tier?.includes(k))||'Bronze'];
  const credits=p?.credits||0;
  const nextTier={Bronze:400,Silver:900,Gold:2000,Platinum:9999};
  const tier=Object.keys(TIER_CLS).find(k=>p?.tier?.includes(k))||'Bronze';
  const next=nextTier[tier]||2000;
  c.innerHTML=`<div class="page active">
    <div class="three-col">
      <div style="grid-column:1/3">
        <div class="panel">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
            <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#0066cc);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">👤</div>
            <div style="flex:1"><div style="font-size:18px;font-weight:700">${p?.name||'Citizen'}</div><div class="tier-badge ${tierCls}" style="margin-top:4px">🏅 ${p?.tier||'Bronze Sentinel'}</div></div>
            <div style="text-align:right"><div style="font-size:32px;font-weight:800;color:#d97706">${credits.toLocaleString()}</div><div style="font-size:11px;color:var(--muted)">Civic Credits</div></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px"><span>${credits} credits</span><span>${next} to next tier</span></div>
          <div class="credit-bar"><div class="credit-fill" style="width:${Math.min(100,credits/next*100)}%"></div></div>
        </div>
        <div class="three-col" style="margin-bottom:14px">
          ${[['Total Reports',p?.stats?.total_reports||0,'📋'],['Verified',p?.stats?.verified||0,'✅'],['Action Taken',p?.stats?.action_taken||0,'🎯']].map(([l,v,ic])=>`<div class="kpi ok"><div class="kpi-accent-bar"></div><div class="kpi-label">${ic} ${l}</div><div class="kpi-val">${v}</div></div>`).join('')}
        </div>
        <div class="panel">
          <div class="panel-title">📋 My Recent Reports</div>
          ${(p?.my_complaints||[]).slice(0,5).map(r=>`<div class="complaint-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span style="font-weight:600;font-size:12px">${r.category}</span><span style="font-size:11px"><span class="status-dot stat-${(r.status||'').toLowerCase().replace(/ /g,'')}"></span>${r.status}</span></div><div style="font-size:11px;color:var(--text2)">${r.zone} · ${r.description||''}</div><div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:var(--mono)">${r.complaint_id} · ${new Date(r.created_at).toLocaleDateString()}</div></div>`).join('')||'<div style="color:var(--muted);font-size:13px">No reports yet. Make your first report!</div>'}
        </div>
      </div>
      <div>
        <div class="panel"><div class="panel-title">🚨 Citywide Top Alerts</div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px">Top enforcement zones by risk score, citywide</div>
          ${(_communityFeed||[]).slice(0,4).map(z=>`<div class="feed-item ${z.severity.toLowerCase()}"><div style="font-weight:600;font-size:12px">${z.zone}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">Index ${z.delay_mins} · ${z.community_reports} reports</div><div style="font-size:11px;color:${sevColor(z.severity)};font-weight:600;margin-top:2px">${z.severity}</div></div>`).join('')}
        </div>
        <div class="panel"><div class="panel-title">⚡ Quick Actions</div>
          ${[['citizen-map','🗺 Hotspot Map'],['citizen-alerts','⚡ Live Alerts'],['citizen-analysis','📊 Analytics'],['citizen-check','🔍 Check Parking Safety'],['citizen-report','📸 Report a Violation'],['citizen-track','🔍 Track Complaint'],['citizen-wallet','🪙 Civic Credits']].map(([pg,l])=>`<button onclick="showPage('${pg}')" class="btn btn-outline" style="width:100%;margin-bottom:8px;text-align:left;font-size:13px">${l}</button>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function renderCitizenCheck(c){
  c.innerHTML=`<div class="page active" style="max-width:580px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">🔍 Am I Safe to Park?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">Enter your location to get an instant AI parking safety assessment based on enforcement hotspot data.</div>
      <div class="parking-check-box">
        <div style="font-size:42px;margin-bottom:10px">🚗</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:16px">Check Parking Risk at Your Location</div>
        ${junctionSearchHTML('chk')}
        <div style="font-size:11px;color:var(--muted);margin:2px 0 10px;text-align:left">— or enter / confirm GPS coordinates directly —</div>
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <input id="chk-lat" type="number" step="0.0001" value="12.9767" placeholder="Latitude" style="flex:1"/>
          <input id="chk-lon" type="number" step="0.0001" value="77.5774" placeholder="Longitude" style="flex:1"/>
        </div>
        <div id="chk-gps-status" style="font-size:11px;color:var(--text2);margin-bottom:10px">Showing Bengaluru city centre — search a junction above, or tap below to use your real location</div>
        <div class="photo-zone" id="chk-photo-zone" onclick="document.getElementById('chk-photo-inp').click()" style="margin-bottom:12px"><div id="chk-photo-label">📷 Optional: Upload street / signage photo</div></div>
        <input type="file" id="chk-photo-inp" accept="image/*" capture="environment" style="display:none" onchange="chkPhotoSel(this)"/>
        <button class="btn btn-primary" style="width:100%" onclick="runParkingCheck()">🔍 Run Safety Check</button>
        <button class="btn btn-outline" style="width:100%;margin-top:8px;font-size:12px" onclick="getGPS()">📍 Use My Current Location</button>
      </div>
      <div id="chk-result" style="margin-top:14px"></div>
    </div>
    <div class="panel">
      <div class="panel-title">ℹ️ How It Works</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.8">Our AI cross-references your location against:<br>🔴 <b>High EPS zones</b> — active enforcement hotspots<br>🟡 <b>Time-restricted areas</b> — school zones, market hours<br>🟢 <b>Clear zones</b> — no recent violation clusters detected</div>
    </div>
    <div class="panel">
      <div class="panel-title">🔎 Look Up Any Neighbourhood Zone</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">The live feed only shows the top 10 highest-risk zones. Search any police station to see its enforcement tier and activity level, including LOW-tier neighbourhoods.</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="zone-lookup-inp" type="text" placeholder="e.g. Yelahanka, Rajajinagar, Koramangala…" style="flex:1" oninput="filterZoneLookup()" onfocus="filterZoneLookup()"/>
      </div>
      <div id="zone-lookup-results" style="display:none;max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:10px"></div>
      <div id="zone-lookup-detail"></div>
    </div>
  </div>`;
  initJunctionSearch('chk', 'chk-lat', 'chk-lon', () => {
    const statusEl = document.getElementById('chk-gps-status');
    if (statusEl) statusEl.textContent = '✓ Using selected junction location';
  });
  window._zoneLookupData = [...(_hotspots||[])].sort((a,b)=>a.police_station.localeCompare(b.police_station));
}

function filterZoneLookup(){
  const q=(document.getElementById('zone-lookup-inp')?.value||'').trim().toLowerCase();
  const res=document.getElementById('zone-lookup-results');
  if(!res) return;
  const data=window._zoneLookupData||[];
  const seen=new Set();
  const filtered=data.filter(h=>{
    if(seen.has(h.police_station)) return false;
    if(q && !h.police_station.toLowerCase().includes(q)) return false;
    seen.add(h.police_station);
    return true;
  }).slice(0,12);
  if(!filtered.length){res.style.display='none';return;}
  res.innerHTML=filtered.map(h=>{
    const col=h.hotspot_tier==='CRITICAL'?'var(--danger)':h.hotspot_tier==='HIGH'?'var(--warn)':h.hotspot_tier==='MEDIUM'?'#f59e0b':'var(--accent)';
    return `<div onclick="showZoneLookupDetail('${h.police_station.replace(/'/g,"&#39;")}')" style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center" onmouseover="this.style.background='var(--panel2)'" onmouseout="this.style.background=''">
      <span style="font-size:13px;font-weight:600">${h.police_station}</span>
      <span style="font-size:10px;font-weight:700;color:${col};padding:2px 7px;border-radius:4px;background:${col}18">${h.hotspot_tier}</span>
    </div>`;
  }).join('');
  res.style.display='block';
}

function showZoneLookupDetail(station){
  document.getElementById('zone-lookup-inp').value=station;
  document.getElementById('zone-lookup-results').style.display='none';
  const cells=(_hotspots||[]).filter(h=>h.police_station===station);
  if(!cells.length) return;
  const top=cells.reduce((a,b)=>a.eps_score>b.eps_score?a:b);
  const tier=top.hotspot_tier;
  const col=tier==='CRITICAL'?'var(--danger)':tier==='HIGH'?'var(--warn)':tier==='MEDIUM'?'#f59e0b':'var(--accent)';
  const cls=tier==='CRITICAL'||tier==='HIGH'?'unsafe':tier==='MEDIUM'?'caution':'safe';
  const totalViol=cells.reduce((s,h)=>s+h.total_violations,0);
  const avgAction=(cells.reduce((s,h)=>s+(h.action_rate||0),0)/cells.length*100).toFixed(0);
  document.getElementById('zone-lookup-detail').innerHTML=`<div class="check-result ${cls}" style="margin-top:0">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b style="font-size:14px">${station}</b>
      <span style="font-size:11px;font-weight:700;color:${col};background:${col}18;border:1px solid ${col}33;border-radius:4px;padding:2px 8px">${tier}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:8px">
      <div>📋 <b>${totalViol.toLocaleString()}</b> total violations</div>
      <div>✅ <b>${avgAction}%</b> avg action rate</div>
      <div>🎯 <b>${cells.length}</b> H3 cell${cells.length===1?'':'s'} in zone</div>
      <div>⚡ EPS: <b>${(top.eps_score*100).toFixed(0)}</b> / 100</div>
    </div>
    ${top.top_violation_type?`<div style="font-size:11px;color:var(--text2);margin-bottom:6px">Top violation: <b>${top.top_violation_type}</b></div>`:''}
    <div class="check-sub">${tier==='CRITICAL'||tier==='HIGH'?'Active enforcement zone — high risk of towing and challans.':tier==='MEDIUM'?'Moderate enforcement activity — avoid peak hours (8–10am, 5–8pm).':'Lower enforcement activity in this neighbourhood — relatively safer for parking, but always check local signage.'}</div>
  </div>`;
}
function chkPhotoSel(inp){if(inp.files[0]){document.getElementById('chk-photo-zone').classList.add('has-photo');document.getElementById('chk-photo-label').textContent='✓ Photo: '+inp.files[0].name;}}
function getGPS(){
  const statusEl = document.getElementById('chk-gps-status');
  if (statusEl) statusEl.textContent = '📍 Detecting your location…';
  if (!navigator.geolocation) { if (statusEl) statusEl.textContent = '⚠️ Location not supported on this device — search a junction above or enter coordinates manually.'; toast('GPS unavailable',true); return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    if (statusEl) statusEl.textContent = '⚠️ GPS needs a secure (https) connection here — search a junction above or enter coordinates manually.';
    toast('GPS requires HTTPS', true); return;
  }
  navigator.geolocation.getCurrentPosition(p=>{
    document.getElementById('chk-lat').value=p.coords.latitude.toFixed(5);
    document.getElementById('chk-lon').value=p.coords.longitude.toFixed(5);
    if (statusEl) statusEl.textContent = '✓ Using your current location';
  },(err)=>{
    const msg = err.code===1 ? '⚠️ Location permission denied — enable it in your browser/app settings, or search a junction above.'
              : err.code===2 ? '⚠️ Location unavailable right now — search a junction above or enter coordinates manually.'
              : '⚠️ Location request timed out — search a junction above or enter coordinates manually.';
    if (statusEl) statusEl.textContent = msg;
    toast('GPS unavailable',true);
  },{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}
async function runParkingCheck(){
  const lat=parseFloat(document.getElementById('chk-lat')?.value||12.9767);
  const lon=parseFloat(document.getElementById('chk-lon')?.value||77.5774);
  const res_el=document.getElementById('chk-result');
  res_el.innerHTML='<div class="spinner"><div class="spin"></div><span>Analysing…</span></div>';
  try{
    const res=await api('/api/v1/citizen/parking-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:lat,longitude:lon})});
    const cls=res.safe===true?'safe':res.safe===false?'unsafe':'caution';
    res_el.innerHTML=`<div class="check-result ${cls}">${res.message}<div class="check-sub">${res.recommendation}</div><div style="margin-top:8px;font-size:12px;font-family:var(--mono)">Zone: <b>${res.zone}</b> · EPS: <b>${(res.eps_score*100).toFixed(0)}</b> · Risk: <b>${res.risk_level}</b></div></div>`;
  }catch(e){res_el.innerHTML=`<div class="check-result unsafe">Error: ${e.message}</div>`;}
}


function renderCitizenReport(c){
  c.innerHTML=`<div class="page active" style="max-width:580px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">📸 Report a Parking Violation</div>
      <div style="font-size:12px;color:var(--accent);background:var(--accent-light);border:1px solid rgba(0,184,122,.2);border-radius:6px;padding:10px 14px;margin-bottom:10px">🪙 Earn <b>40 Civic Credits</b> when your report leads to police action</div>
      <div style="font-size:11px;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:14px;line-height:1.6">
        ℹ️ <b>Product vision feature:</b> The civic credits and complaint tracking system is illustrative of the citizen-facing product vision. The enforcement intelligence (EPS scores, ghost zones, patrol routing) is 100% derived from the real dataset. Complaint counts do <b>not</b> feed into the EPS formula.
      </div>
      <div class="form-row"><label class="form-label">Violation Category</label><select id="rep-cat"><option value="">— Choose category —</option>${['Double Parking','Intersection Blocking','Commercial Unloading Zone','No Parking Zone','Wrong Side Parking'].map(v=>`<option>${v}</option>`).join('')}</select></div>
      <div class="form-row"><label class="form-label">Zone / Landmark</label><input id="rep-zone" type="text" placeholder="e.g. Upparpet Cross, near Cauvery Theatre"/></div>
      ${junctionSearchHTML('rep', 'Search Junction Name (optional)')}
      <div class="form-row"><label class="form-label">GPS Coordinates</label><div style="display:flex;gap:8px"><input id="rep-lat" type="number" step="0.00001" placeholder="Latitude" style="flex:1"/><input id="rep-lon" type="number" step="0.00001" placeholder="Longitude" style="flex:1"/><button class="btn btn-outline" style="padding:8px;font-size:12px" onclick="repGPS()">📍</button></div><div id="rep-gps-status" style="font-size:11px;color:var(--text2);margin-top:4px">📍 Detecting your location…</div></div>
      <div class="form-row"><label class="form-label">Description</label><textarea id="rep-desc" placeholder="Describe what you see — vehicle type, blocking what, how many vehicles..."></textarea></div>
      <div class="form-row"><label class="form-label">Photo Evidence</label><div class="photo-zone" id="rep-photo-zone" onclick="document.getElementById('rep-photo-inp').click()"><div id="rep-photo-label">📷 Attach photo (strongly recommended)</div><img id="rep-photo-preview" style="display:none;max-width:100%;border-radius:8px;margin-top:8px"/></div><input type="file" id="rep-photo-inp" accept="image/*" capture="environment" style="display:none" onchange="repPhoto(this)"/></div>
      <button class="btn btn-primary" style="width:100%" onclick="submitReport()">📤 Submit Violation Report</button>
      <div id="rep-result" style="margin-top:12px"></div>
    </div>
  </div>`;
  repGPS();
  _repPhotoData = null;
  initJunctionSearch('rep', 'rep-lat', 'rep-lon', (lat, lon, name) => {
    const statusEl = document.getElementById('rep-gps-status');
    if (statusEl) statusEl.textContent = '✓ Using selected junction location';
    const zoneEl = document.getElementById('rep-zone');
    if (zoneEl && !zoneEl.value) zoneEl.value = name;
  });
}
function repGPS(){
  const statusEl = document.getElementById('rep-gps-status');
  if (statusEl) statusEl.textContent = '📍 Detecting your location…';
  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = '⚠️ Location not supported on this device — search a junction above or enter coordinates manually.';
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    if (statusEl) statusEl.textContent = '⚠️ GPS needs a secure (https) connection here — search a junction above or enter coordinates manually.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => {
      document.getElementById('rep-lat').value = p.coords.latitude.toFixed(5);
      document.getElementById('rep-lon').value = p.coords.longitude.toFixed(5);
      if (statusEl) statusEl.textContent = '✓ Location detected';
    },
    (err) => {
      const msg = err.code===1 ? '⚠️ Location permission denied — search a junction above or enter coordinates manually.'
                : err.code===2 ? '⚠️ Location unavailable right now — search a junction above or enter coordinates manually.'
                : '⚠️ Location request timed out — search a junction above or enter coordinates manually.';
      if (statusEl) statusEl.textContent = msg;
    },
    {enableHighAccuracy:true,timeout:10000,maximumAge:30000}
  );
}

let _repPhotoData = null;
// Downscales + JPEG-compresses the selected photo client-side before it's
// attached to the report — a raw phone-camera photo can be 5-10MB, which is
// way too large to store as base64 in a JSON file repeatedly. Capping the
// longest side to 1280px and re-encoding at 70% quality keeps each photo to
// roughly 100-300KB while still being clear enough for an officer to review.
// Shared by both the citizen and guest report forms (different element id
// prefixes, same compression logic) via the `onDone` callback.
function processReportPhoto(inp, idPrefix, onDone){
  const file = inp.files[0];
  if(!file) return;
  const label = document.getElementById(`${idPrefix}-photo-label`);
  const preview = document.getElementById(`${idPrefix}-photo-preview`);
  label.textContent = '⏳ Processing photo…';
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1280;
      let {width, height} = img;
      if (width > maxSide || height > maxSide) {
        if (width > height) { height = Math.round(height * maxSide / width); width = maxSide; }
        else { width = Math.round(width * maxSide / height); height = maxSide; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById(`${idPrefix}-photo-zone`).classList.add('has-photo');
      label.textContent = '✓ ' + file.name;
      if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
      onDone(dataUrl);
    };
    img.onerror = () => { label.textContent = '⚠️ Could not read photo — try another file'; onDone(null); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function repPhoto(inp){ processReportPhoto(inp, 'rep', (data) => { _repPhotoData = data; }); }
async function submitReport(){
  const cat=document.getElementById('rep-cat')?.value,zone=document.getElementById('rep-zone')?.value,desc=document.getElementById('rep-desc')?.value;
  if(!cat||!zone){toast('Fill in category and zone',true);return;}
  if(!_user?.user_id){toast('Please log in again to submit a report',true);return;}
  const latRaw = document.getElementById('rep-lat')?.value;
  const lonRaw = document.getElementById('rep-lon')?.value;
  if (!latRaw || !lonRaw) { toast('Add GPS coordinates — tap 📍 or enter them manually', true); return; }
  const payload={user_id:_user.user_id,category:cat,zone,latitude:parseFloat(latRaw),longitude:parseFloat(lonRaw),description:desc,photo_base64:_repPhotoData||null};
  try{
    const res=await api('/api/v1/citizen/complaint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    document.getElementById('rep-result').innerHTML=`<div class="check-result safe">✅ <b>${res.complaint_id}</b> submitted successfully.<br><span class="check-sub">${res.message}</span></div>`;
    toast('Report submitted!');
  }catch(e){toast('Submit failed: '+e.message,true);}
}

async function renderCitizenWallet(c){
  c.innerHTML = '<div class="spinner"><div class="spin"></div><span>Loading your wallet…</span></div>';
  try {
    if (_user?.user_id) _citizenProfile = await api('/api/v1/citizen/profile?user_id=' + _user.user_id);
  } catch(e) { /* fall back to whatever was last loaded */ }
  const p=_citizenProfile;
  const TIER_CLS={Bronze:'tier-bronze',Silver:'tier-silver',Gold:'tier-gold',Platinum:'tier-platinum'};
  const tierCls=TIER_CLS[Object.keys(TIER_CLS).find(k=>p?.tier?.includes(k))||'Bronze'];
  const credits=p?.credits||0;
  const tiers=[['🥉 Bronze Sentinel',0,400,'First steps as a civic guardian'],['🥈 Silver Warden',400,900,'Active community reporter'],['🥇 Gold Traffic Marshal',900,2000,'Top enforcement contributor'],['💎 Platinum Guardian',2000,9999,'City-level impact contributor']];
  c.innerHTML=`<div class="page active"><div class="two-col">
    <div><div class="panel">
      <div class="panel-title">🪙 Civic Credits Wallet</div>
      <div style="text-align:center;padding:20px 0">
        <div class="tier-badge ${tierCls}" style="font-size:15px;padding:10px 20px;justify-content:center;display:inline-flex">${p?.tier||'Bronze Sentinel'}</div>
        <div style="font-size:42px;font-weight:900;color:#d97706;margin:12px 0">${credits.toLocaleString()}</div>
        <div style="font-size:13px;color:var(--muted)">Total Civic Credits Earned</div>
      </div>
      ${tiers.map(([name,min,max,desc])=>{const active=credits>=min&&credits<max,done=credits>=max;return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:9px;margin-bottom:6px;background:${active?'var(--accent-light)':'var(--panel2)'};border:1px solid ${active?'rgba(0,184,122,.3)':'var(--border)'}"><div style="font-size:18px">${done?'✅':active?'⭐':'⬜'}</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:${active?'var(--accent)':done?'var(--accent)':'var(--text2)'}">${name}</div><div style="font-size:11px;color:var(--muted)">${desc}</div></div><div style="font-size:11px;color:var(--muted)">${min}–${max>9000?'∞':max}</div></div>`}).join('')}
      <div style="background:var(--panel2);border-radius:8px;padding:12px;font-size:12px;color:var(--text2);line-height:1.8;margin-top:8px;border:1px solid var(--border)">🪙 <b>How credits work:</b><br>You earn <b>+40 Civic Credits</b> when a report you submit leads to police action (status moves to "Action Taken" or "Resolved"). Reports that are still pending or only verified don't earn credits yet.</div>
    </div></div>
    <div>
      <div class="panel"><div class="panel-title">📊 Contribution Stats</div>
        ${[['Reports Submitted',p?.stats?.total_reports||0],['Verified by System',p?.stats?.verified||0],['Led to Police Action',p?.stats?.action_taken||0],['Pending Review',p?.stats?.pending||0]].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">${l}</span><span style="font-weight:700;font-family:var(--mono)">${v}</span></div>`).join('')}
      </div>
    </div>
  </div></div>`;
}

// Community Feed page removed: it rendered the same _communityFeed data and
// the same Leaflet map (just under a different element id) as the Hotspot
// Map tab, with no additional information — see renderCitizenHotspotMap and
// renderCitizenAlerts below for the live versions of this data.

// ══════════════════════════════════════════════════════════════════════════════
// CITIZEN PAGES — Analysis, Hotspot Map, Live Alerts, Track Complaint + Copilot
// ══════════════════════════════════════════════════════════════════════════════

// ── CITIZEN HOTSPOT MAP ───────────────────────────────────────────────────────
let _citizenHsMap = null;
function renderCitizenHotspotMap(c) {
  const feed = getGuestFeed();
  c.innerHTML = `<div class="page active">
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-title">🗺 Live Hotspot Map — Bengaluru</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">All active parking enforcement hotspots. Tap any marker for details.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${[['#ef4444','CRITICAL'],['#f97316','HIGH'],['#f59e0b','MEDIUM']].map(([col,l])=>`<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><span style="width:10px;height:10px;background:${col};border-radius:50%;display:inline-block"></span>${l}</div>`).join('')}
      </div>
    </div>
    <div class="panel" style="padding:0;overflow:hidden;border-radius:10px">
      <div id="citizen-hs-map" style="height:500px"></div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="panel-title">📍 Hotspot List</div>
      ${feed.map(z => `<div class="feed-item ${z.severity.toLowerCase()}" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between">
          <div><div style="font-weight:700;font-size:13px">${z.zone}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">Index: ${z.delay_mins} · ${z.community_reports} reports</div></div>
          <div style="font-size:18px;font-weight:800;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
        </div>
      </div>`).join('')}
    </div>
    ${buildCitizenCopilotBtn()}
  </div>`;
  setTimeout(initCitizenHsMap, 80);
}

function initCitizenHsMap() {
  if (_citizenHsMap) { try { _citizenHsMap.remove(); } catch(e) {} _citizenHsMap = null; }
  _citizenHsMap = L.map('citizen-hs-map', { zoomControl: true }).setView([12.975, 77.58], 12);
  L.tileLayer(getTileUrl(), { maxZoom: 19, subdomains: 'abcd' }).addTo(_citizenHsMap);
  const feed = getGuestFeed();
  feed.forEach(z => {
    if (!z.latitude || !z.longitude) return;
    const col = z.severity === 'CRITICAL' ? '#ef4444' : z.severity === 'HIGH' ? '#f97316' : '#f59e0b';
    L.circleMarker([z.latitude, z.longitude], { radius: 14, color: col, fillColor: col, fillOpacity: 0.45, weight: 2 })
      .addTo(_citizenHsMap)
      .bindPopup(`<b>${z.zone}</b><br>Severity: <b style="color:${col}">${z.severity}</b><br>Congestion index: ${z.delay_mins}<br>${z.community_reports} community reports<br>${z.latest_report ? `<i>"${z.latest_report}"</i>` : ''}`);
  });
}

// ── CITIZEN LIVE ALERTS ───────────────────────────────────────────────────────
async function renderCitizenAlerts(c) {
  c.innerHTML = '<div class="spinner"><div class="spin"></div><span>Loading alerts…</span></div>';
  let feedError = false;
  try {
    const res = await api('/api/v1/citizen/community-feed');
    _communityFeed = disambiguateFeedZones(res.feed);
  } catch(e) {
    feedError = true;
    if (!_communityFeed || !_communityFeed.length) {
      c.innerHTML = `<div class="page active"><div class="panel" style="text-align:center;padding:40px 20px">
        <div style="font-size:32px;margin-bottom:12px">⚠️</div>
        <div style="font-weight:700;font-size:15px;margin-bottom:8px">Unable to load live alerts</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:16px">The live enforcement feed couldn't be reached. Please check your connection and try again.</div>
        <button class="btn btn-primary" onclick="renderCitizenAlerts(document.getElementById('content'))">↻ Retry</button>
      </div></div>`;
      return;
    }
  }
  const feed = getGuestFeed();
  const critCount = feed.filter(z => z.severity === 'CRITICAL').length;
  const highCount = feed.filter(z => z.severity === 'HIGH').length;
  c.innerHTML = `<div class="page active">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      <div class="kpi"><div class="kpi-accent-bar" style="background:var(--danger)"></div><div class="kpi-label">🔴 Critical</div><div class="kpi-val">${critCount}</div></div>
      <div class="kpi"><div class="kpi-accent-bar" style="background:var(--warn)"></div><div class="kpi-label">🟠 High Risk</div><div class="kpi-val">${highCount}</div></div>
      <div class="kpi"><div class="kpi-accent-bar"></div><div class="kpi-label">📡 Total Alerts</div><div class="kpi-val">${feed.length}</div></div>
    </div>
    ${feedError ? `<div style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.3);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">⚠️</span>
      <div style="flex:1;font-size:12px;color:var(--warn)"><b>Live feed unavailable</b> — showing last cached data. <button class="btn btn-outline" style="font-size:11px;padding:3px 10px;margin-left:8px" onclick="renderCitizenAlerts(document.getElementById('content'))">↻ Retry</button></div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-title">🚨 Top Enforcement Zones — Citywide</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Top 10 zones by current risk score, refreshed each time you open this page. Not filtered by your location yet.</div>
      ${feed.map(z => `<div class="feed-item ${z.severity.toLowerCase()}" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:700;font-size:13px">${z.zone}${z.forecast_uncertainty_high ? ` <span title="This zone's forecast had the highest prediction error in backtesting (±${Math.round(z.validation_mae)} violations/day)" style="font-size:9px;font-weight:700;color:var(--warn);background:var(--warn-light);border:1px solid rgba(249,115,22,.25);border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:middle">⚠ forecast uncertainty: high</span>` : ''}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">Congestion index: <b>${z.delay_mins}</b> · ${z.community_reports} community reports</div>
            ${z.latest_report ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;font-style:italic">"${z.latest_report}"</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px">
            <div style="font-size:22px;font-weight:900;color:${sevColor(z.severity)}">${(z.risk_now*100).toFixed(0)}</div>
            <div style="font-size:10px;font-weight:700;color:${sevColor(z.severity)}">${z.severity}</div>
          </div>
        </div>
      </div>`).join('')}
    </div>
    ${buildCitizenCopilotBtn()}
  </div>`;
}

// ── CITIZEN ANALYSIS ──────────────────────────────────────────────────────────
function renderCitizenAnalysis(c) {
  const p = _citizenProfile;
  const feed = getGuestFeed();
  const byZone = feed.sort((a,b) => b.risk_now - a.risk_now);
  c.innerHTML = `<div class="page active">
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-title">📊 Bengaluru Parking Intelligence — Analysis</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Data from the ParkInsight enforcement network across Bengaluru.</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        ${[
          ['Total Active Zones', feed.length, '🗺'],
          ['Critical Zones', feed.filter(z=>z.severity==='CRITICAL').length, '🔴'],
          ['Avg Congestion Index', (feed.reduce((a,z)=>a+z.delay_mins,0)/Math.max(1,feed.length)).toFixed(1), '⏱'],
          ['My Reports', p?.stats?.total_reports||0, '📋'],
          ['Verified Reports', p?.stats?.verified||0, '✅'],
          ['Credits Earned', p?.credits||0, '🪙'],
        ].map(([l,v,ic]) => `<div class="kpi ok"><div class="kpi-accent-bar"></div><div class="kpi-label">${ic} ${l}</div><div class="kpi-val">${v}</div></div>`).join('')}
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="panel-title">📊 Risk Ranking — All Zones</div>
        ${byZone.map((z,i) => {
          const col = z.severity === 'CRITICAL' ? 'var(--danger)' : z.severity === 'HIGH' ? 'var(--warn)' : '#f59e0b';
          const pct = Math.round(z.risk_now * 100);
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="color:var(--text1);font-weight:600">${i+1}. ${z.zone}${z.forecast_uncertainty_high ? ` <span title="Highest prediction error in backtesting (±${Math.round(z.validation_mae)} violations/day)" style="font-size:8px;font-weight:700;color:var(--warn);background:var(--warn-light);border:1px solid rgba(249,115,22,.25);border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle">⚠ uncertain</span>` : ''}</span>
              <span style="color:${col};font-weight:700">${pct}</span>
            </div>
            <div style="background:var(--panel2);border-radius:4px;height:5px;overflow:hidden">
              <div style="background:${col};height:100%;width:${pct}%;transition:width .5s"></div>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Congestion index ${z.delay_mins} · ${z.community_reports} reports</div>
          </div>`;
        }).join('')}
      </div>
      <div>
        <div class="panel" style="margin-bottom:14px">
          <div class="panel-title">📈 Severity Breakdown</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${[['CRITICAL','var(--danger)'],['HIGH','var(--warn)'],['MEDIUM','#f59e0b']].map(([sev,col]) => {
              const count = feed.filter(z=>z.severity===sev).length;
              const pct = Math.round(count/Math.max(1,feed.length)*100);
              return `<div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:${col};font-weight:700">${sev}</span>
                  <span style="color:var(--text2)">${count} zones (${pct}%)</span>
                </div>
                <div style="background:var(--panel2);border-radius:4px;height:8px;overflow:hidden">
                  <div style="background:${col};height:100%;width:${pct}%"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">🏅 Your Civic Standing</div>
          <div style="text-align:center;padding:16px 0">
            <div style="font-size:40px;margin-bottom:8px">🏅</div>
            <div style="font-size:22px;font-weight:800;color:var(--accent)">${p?.credits||0}</div>
            <div style="font-size:12px;color:var(--muted)">Civic Credits</div>
            <div style="margin-top:12px;font-size:13px;color:var(--text2)">${p?.tier||'Bronze Sentinel'}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px">${p?.stats?.total_reports||0} reports submitted · ${p?.stats?.verified||0} verified</div>
          </div>
        </div>
      </div>
    </div>
    ${buildCitizenCopilotBtn()}
  </div>`;
}

// ── CITIZEN TRACK COMPLAINT ───────────────────────────────────────────────────
async function renderCitizenTrackComplaint(c) {
  c.innerHTML = '<div class="spinner"><div class="spin"></div><span>Loading your complaints…</span></div>';
  try {
    if (_user?.user_id) _citizenProfile = await api('/api/v1/citizen/profile?user_id=' + _user.user_id);
  } catch(e) { /* fall back to whatever was last loaded */ }
  const p = _citizenProfile;
  c.innerHTML = `<div class="page active" style="max-width:680px;margin:0 auto">
    <div class="panel">
      <div class="panel-title">🔍 Track My Complaint</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Enter your complaint ID to get a live status update.</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="ctz-track-inp" type="text" placeholder="e.g. CMP-1001" style="flex:1"/>
        <button class="btn btn-primary" onclick="citizenTrackComplaint()">Track →</button>
      </div>
      <div id="ctz-track-result"></div>
    </div>
    <div class="panel">
      <div class="panel-title">📋 My All Complaints</div>
      ${(p?.my_complaints||[]).length === 0 ? '<div style="color:var(--muted);font-size:13px">No complaints filed yet.</div>' : ''}
      ${(p?.my_complaints||[]).map(r => {
        const statusCol = { Pending:'var(--warn)', Verified:'#3b82f6', 'Action Taken':'var(--accent)', Resolved:'var(--accent)', Rejected:'var(--muted)' };
        return `<div class="complaint-card" style="border-left:3px solid ${statusCol[r.status]||'var(--warn)'}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div>
              <div style="font-weight:700;font-size:13px">${r.category}</div>
              <div style="font-size:11px;color:var(--text2)">${r.zone}</div>
              <div style="font-size:10px;color:var(--muted);font-family:var(--mono)">${r.complaint_id} · ${new Date(r.created_at).toLocaleDateString()}</div>
            </div>
            <span style="background:${statusCol[r.status]||'var(--warn)'}22;color:${statusCol[r.status]||'var(--warn)'};border:1px solid ${statusCol[r.status]||'var(--warn)'}44;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;flex-shrink:0">${r.status}</span>
          </div>
          ${r.description ? `<div style="font-size:12px;color:var(--text1);background:var(--panel2);border-radius:5px;padding:6px 10px;margin-top:4px">📝 ${r.description}</div>` : ''}
          ${r.photo_base64 ? `<img src="${r.photo_base64}" style="max-width:100%;max-height:180px;border-radius:8px;margin-top:6px;display:block"/>` : ''}
          ${r.officer_note ? `<div style="font-size:11px;color:var(--text2);background:var(--panel2);border-radius:5px;padding:6px 10px;margin-top:4px">👮 Officer note: ${r.officer_note}</div>` : ''}
          ${r.status === 'Action Taken' || r.status === 'Resolved' ? `<div style="font-size:11px;color:var(--accent);margin-top:4px">🪙 +40 Civic Credits awarded!</div>` : ''}
          <button onclick="document.getElementById('ctz-track-inp').value='${r.complaint_id}';citizenTrackComplaint()" class="btn btn-outline" style="font-size:11px;padding:4px 10px;margin-top:6px">Track Status</button>
        </div>`;
      }).join('')}
    </div>
    ${buildCitizenCopilotBtn()}
  </div>`;
}

async function citizenTrackComplaint() {
  const id = document.getElementById('ctz-track-inp')?.value?.trim();
  if (!id) { toast('Enter a complaint ID', true); return; }
  const el = document.getElementById('ctz-track-result');
  el.innerHTML = '<div class="spinner"><div class="spin"></div><span>Checking…</span></div>';
  try {
    const r = await api(`/api/v1/citizen/complaint/${id}`);
    const statusCol = { Pending:'var(--warn)', Verified:'#3b82f6', 'Action Taken':'var(--accent)', Resolved:'var(--accent)', Rejected:'var(--muted)' };
    el.innerHTML = `<div class="check-result ${r.status==='Action Taken'||r.status==='Resolved'?'safe':r.status==='Rejected'?'unsafe':'caution'}">
      <div style="font-size:14px;font-weight:700">${r.complaint_id}</div>
      <div style="font-size:13px;margin-top:4px">Status: <b style="color:${statusCol[r.status]||'var(--warn)'}">${r.status}</b></div>
      <div class="check-sub">${r.category} · ${r.zone}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Filed: ${new Date(r.created_at).toLocaleString()}</div>
      ${r.updated_at ? `<div style="font-size:11px;color:var(--muted)">Updated: ${new Date(r.updated_at).toLocaleString()}</div>` : ''}
      ${r.description ? `<div style="font-size:12px;color:var(--text1);background:var(--panel2);border-radius:5px;padding:8px 10px;margin-top:8px">📝 ${r.description}</div>` : ''}
      ${r.photo_base64 ? `<img src="${r.photo_base64}" style="max-width:100%;max-height:240px;border-radius:8px;margin-top:8px;display:block"/>` : ''}
      ${r.officer_note ? `<div style="font-size:12px;color:var(--text2);background:var(--panel2);border-radius:5px;padding:6px 10px;margin-top:8px">👮 <b>Officer note:</b> ${r.officer_note}</div>` : ''}
      ${r.status === 'Action Taken' || r.status === 'Resolved' ? `<div style="font-size:13px;color:var(--accent);margin-top:8px;font-weight:700">🪙 +40 Civic Credits have been credited to your wallet!</div>` : ''}
    </div>`;
  } catch(e) {
    // Fallback: search in profile
    const found = (_citizenProfile?.my_complaints||[]).find(r => r.complaint_id === id);
    if (found) {
      el.innerHTML = `<div class="check-result caution"><div style="font-weight:700">${found.complaint_id}</div><div>Status: <b>${found.status}</b></div><div class="check-sub">${found.category} · ${found.zone}</div></div>`;
    } else {
      el.innerHTML = `<div class="check-result unsafe">Complaint ID <b>${id}</b> not found. Please double-check the ID.</div>`;
    }
  }
}

// ── CITIZEN AI COPILOT ────────────────────────────────────────────────────────
function buildCitizenCopilotBtn() {
  return `<button onclick="openCitizenCopilot()" style="position:fixed;bottom:24px;right:24px;z-index:999;background:linear-gradient(135deg,var(--accent),#0066cc);color:#fff;border:none;border-radius:50px;padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(0,184,122,.4)">💬 AI Assistant</button>
  <div id="citizen-copilot-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:flex-end;justify-content:center">
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:16px 16px 0 0;width:min(520px,100vw);max-height:75vh;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;color:var(--text1);font-size:15px">💬 ParkInsight Assistant</div>
        <button onclick="document.getElementById('citizen-copilot-modal').style.display='none'" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="ctz-copilot-msgs" style="flex:1;overflow-y:auto;padding:14px;min-height:150px;scrollbar-width:thin">
        <div style="background:var(--accent-light);border:1px solid rgba(0,184,122,.2);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px;color:var(--text1)">
          <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:3px">PARKINSIGHT AI</div>
          Hi! I can help you check parking safety, track complaints, find safe parking, or explain alerts. What do you need?
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px;border-top:1px solid var(--border)">
        ${['Is it safe to park at MG Road?','Track my complaint','Best safe parking near me','What are active hotspots?'].map(q=>`<button onclick="citizenCopilotQuery('${q}')" style="background:var(--panel2);border:1px solid var(--border);color:var(--text2);border-radius:20px;padding:4px 10px;font-size:11px;cursor:pointer">${q}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--border)">
        <input id="ctz-copilot-input" placeholder="Ask about parking, complaints, alerts…" onkeydown="if(event.key==='Enter')citizenCopilotSend()" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--panel2);color:var(--text1);outline:none"/>
        <button onclick="citizenCopilotSend()" style="background:var(--accent);border:none;border-radius:8px;padding:9px 14px;color:#fff;font-size:14px;cursor:pointer">➤</button>
      </div>
    </div>
  </div>`;
}

function openCitizenCopilot() {
  document.getElementById('citizen-copilot-modal').style.display = 'flex';
}

function citizenCopilotQuery(q) {
  document.getElementById('ctz-copilot-input').value = q;
  citizenCopilotSend();
}

async function citizenCopilotSend() {
  const inp = document.getElementById('ctz-copilot-input');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  const msgs = document.getElementById('ctz-copilot-msgs');
  if (!msgs) return;
  msgs.innerHTML += `<div style="text-align:right;margin-bottom:8px"><span style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:13px;color:var(--text1);display:inline-block;max-width:85%">${q}</span></div>`;
  const thinkId = 'ctz-think-' + Date.now();
  msgs.innerHTML += `<div id="${thinkId}" style="background:var(--accent-light);border:1px solid rgba(0,184,122,.2);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px;color:var(--text1)"><div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:3px">PARKINSIGHT AI</div><span style="opacity:.4">Thinking…</span></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  // Calls our own backend (/api/v1/copilot/authed for signed-in citizens,
  // /api/v1/copilot for guests), which holds the real API key server-side
  // and builds context from the live data snapshot — never the browser-side
  // api.anthropic.com call this used to make.
  const page = document.querySelector('nav button.active')?.dataset.page || 'citizen';
  try {
    const reply = await askCopilot(q, page);
    const el = document.getElementById(thinkId);
    if (el) el.innerHTML = `<div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:3px">PARKINSIGHT AI</div>${reply || 'I could not get a response right now.'}`;
  } catch(e) {
    const el = document.getElementById(thinkId);
    if (el) el.innerHTML = `<div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:3px">PARKINSIGHT AI</div>Sorry, I couldn't reach the assistant right now. Please try again shortly.`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}