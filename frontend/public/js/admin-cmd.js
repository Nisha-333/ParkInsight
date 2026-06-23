/* ════════════════════════════════════════════════════════════════════════
   ADMIN-CMD.JS — Command Center page + Inter-Agency Dispatch map
   ════════════════════════════════════════════════════════════════════════ */
function renderAdminCmd(c){
  const s=_summary, alerts=(s.urgent_alerts||[]), blinds=_hotspots.filter(h=>h.blind_spot);
  c.innerHTML=`<div class="page active">
    <div class="kpi-grid">
    <div class="kpi danger"><div class="kpi-accent-bar"></div><div class="kpi-label">Top-10 Citywide Impact</div><div class="kpi-val">${s.top10_citywide_impact_pct?.toFixed(1)||'—'}%</div><div class="kpi-sub">Of total violation-flow disruption (proxy index)</div></div>
      <div class="kpi warn"><div class="kpi-accent-bar"></div><div class="kpi-label">Critical Hotspots</div><div class="kpi-val">${s.critical_hotspot_zones}</div><div class="kpi-sub">EPS ≥ 0.75 zones</div></div>
      <div class="kpi warn"><div class="kpi-accent-bar"></div><div class="kpi-label">Enforcement Blind Spots</div><div class="kpi-val">${s.citizen_accountability_blind_spots}</div><div class="kpi-sub">High complaints, low action</div></div>
      <div class="kpi danger"><div class="kpi-accent-bar"></div><div class="kpi-label">Active Risk Zones</div><div class="kpi-val">${s.active_risk_zones_now}</div><div class="kpi-sub">Current window forecast</div></div>
      <div class="kpi purple"><div class="kpi-accent-bar"></div><div class="kpi-label">Ghost Violations</div><div class="kpi-val">${s.ghost_violations_detected}</div><div class="kpi-sub">Anomalous speed-drop zones</div></div>
      <div class="kpi ok"><div class="kpi-accent-bar"></div><div class="kpi-label">Avg Congestion Proxy</div><div class="kpi-val">${s.avg_congestion_delay_mins}m</div><div class="kpi-sub">Derived proxy — not observed dwell-time data</div></div>
      <div class="kpi warn"><div class="kpi-accent-bar"></div><div class="kpi-label">Enforcement Gap</div><div class="kpi-val">${s.enforcement_gap_pct}%</div><div class="kpi-sub">Complaint-to-action ratio</div></div>
      <div class="kpi ok"><div class="kpi-accent-bar"></div><div class="kpi-label">Officers Active</div><div class="kpi-val">${s.officers_deployed}</div><div class="kpi-sub">On optimised patrol routes</div></div>
    </div>
    <div class="two-col">
      <div>
        <div class="panel">
          <div class="panel-title">🚨 Urgent Dispatch Alerts</div>
          ${alerts.length===0?'<div style="color:var(--accent);font-size:13px;padding:8px 0">✓ No critical alerts active</div>':alerts.map(a=>`<div class="alert-card ghost"><div class="alert-z" style="color:var(--purple)">👻 Ghost Violation — ${a.zone}</div><div class="alert-m">${a.message||'Anomalous activity detected'}</div><div class="alert-t">${new Date(a.timestamp||Date.now()).toLocaleTimeString()}</div></div>`).join('')}
          <div id="sos-section" style="margin-top:10px"></div>
        </div>
        <div class="panel">
          <div class="panel-title">⚠️ Enforcement Blind Spots</div>
          ${blinds.map(h=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--panel2);border-radius:8px;margin-bottom:8px;border-left:3px solid var(--warn)"><span>⚠️</span><div><div style="font-weight:600;font-size:13px">${h.police_station}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${h.total_violations?.toLocaleString()} violations · Action rate ${((h.action_rate||0)*100).toFixed(1)}% · EPS ${(h.eps_score*100).toFixed(0)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${h.explanation||''}</div></div></div>`).join('')||'<div style="color:var(--accent);font-size:13px">No under-enforced zones currently flagged</div>'}
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="panel-title">📍 Top Zones — EPS Ranked</div>
          ${_hotspots.slice(0,8).map((h,i)=>`<div onclick="showCmdEvidencePanel(${i})" style="display:flex;align-items:center;gap:10px;padding:9px;border-radius:8px;cursor:pointer;transition:background .15s;margin-bottom:2px" onmouseenter="this.style.background='var(--panel2)'" onmouseleave="this.style.background=''">
            <div style="width:24px;height:24px;border-radius:50%;background:${epsColor(h.eps_score)};opacity:.15;position:relative;flex-shrink:0"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${epsColorHex(h.eps_score)};opacity:1">${i+1}</div></div>
            <div style="font-size:10px;color:var(--muted)">${h.total_violations.toLocaleString()} violations · ${h.pct_of_citywide_impact?.toFixed(2)||'—'}% citywide impact</div>
            <div style="font-size:16px;font-weight:800;color:${epsColor(h.eps_score)}">${(h.eps_score*100).toFixed(0)}</div>
          </div>`).join('')}
          <div id="cmd-evidence-panel" style="margin-top:12px"></div>
        </div>
        <div class="panel" style="padding:14px">
          <div class="panel-title">🗺 Inter-Agency Dispatch Tracker</div>
          <div class="map-wrap"><div id="dispatch-map" style="height:280px"></div></div>
        </div>
        <div class="panel" id="pending-police-panel">
  <div class="panel-title">🚔 Pending Officer Access Requests</div>
  <div id="pending-police-list" style="font-size:12px;color:var(--text2)">Loading…</div>
</div>
      </div>
    </div>
  </div>
${buildAdminCopilotBtn()}
`;

// Load pending officer requests
  // Load pending officer requests into command center panel
  loadPendingPoliceRequests();
  setTimeout(()=>{initDispatchMap();loadSOSQueue();},100);
}

async function loadSOSQueue(){
  try{
    const data=await api('/api/v1/admin/sos-queue');
    const sec=document.getElementById('sos-section');
    if(!sec||data.count===0) return;
    sec.innerHTML=`<div style="font-size:11px;color:var(--warn);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🆘 SOS Queue (${data.count})</div>`+
      data.flags.slice(0,3).map(f=>`<div class="alert-card sos"><div class="alert-z" style="color:var(--warn)">SOS — ${f.flag_id}</div><div class="alert-m">${f.issue||'Emergency assistance requested'}${f.needs_heavy_tow?' · 🚛 Needs Heavy Tow':''}</div><div class="alert-t">Officer: ${f.officer_id||'Unknown'} · ${f.created_at}</div></div>`).join('');
  }catch(e){}
}

function initDispatchMap(){
  if(dispatchMap){ try{dispatchMap.remove();}catch(e){} dispatchMap=null; }
  const el=document.getElementById('dispatch-map');if(!el)return;
  dispatchMap=L.map('dispatch-map',{zoomControl:false}).setView([12.975,77.580],12);
  L.tileLayer(getTileUrl(),{maxZoom:19,subdomains:'abcd'}).addTo(dispatchMap);
  api('/api/v1/admin/officers/live').then(data=>{
    data.officers.forEach(o=>{
      const col=o.vehicle.includes('TOWING')?'#f97316':o.vehicle.includes('PATROL')?'#3b82f6':'#a78bfa';
      L.circleMarker([o.current_lat,o.current_lon],{radius:8,color:col,fillColor:col,fillOpacity:.85,weight:2}).addTo(dispatchMap)
        .bindPopup(`<div class="ps-popup"><b>${o.name}</b><br>${o.route_id} · ${o.vehicle}<br>Status: <b>${o.status}</b></div>`);
    });
  }).catch(()=>{});
  _hotspots.forEach(h=>{
    L.circleMarker([h.latitude,h.longitude],{radius:5+h.eps_score*10,color:epsColorHex(h.eps_score),fillColor:epsColorHex(h.eps_score),fillOpacity:.12,weight:1}).addTo(dispatchMap);
  });
}

// ── ADMIN AI COPILOT ──────────────────────────────────────────────────────────
function buildAdminCopilotBtn() {
  return `<button onclick="openAdminCopilot()" style="position:fixed;bottom:24px;right:24px;z-index:999;background:linear-gradient(135deg,#dc2626,#9333ea);color:#fff;border:none;border-radius:50px;padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(220,38,38,.4)">🛰 AI Command Copilot</button>
  <div id="admin-copilot-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center">
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:14px;width:min(540px,95vw);max-height:78vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(220,38,38,.1),rgba(147,51,234,.1))">
        <div style="font-weight:700;color:var(--text1);font-size:15px">🛰 ParkInsight Admin Copilot</div>
        <button onclick="document.getElementById('admin-copilot-modal').style.display='none'" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="adm-copilot-msgs" style="flex:1;overflow-y:auto;padding:14px;min-height:200px;scrollbar-width:thin">
        <div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:12px;margin-bottom:10px;font-size:13px;color:var(--text1)">
          <div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT COMMAND AI</div>
          Command Center ready. I can analyze hotspot trends, recommend officer deployments, flag blind spots, and summarize enforcement performance.
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--border)">
        ${['Blind spot analysis','Officer deployment gaps','Top risk zones today','Generate shift brief','Forecast next 2 hours'].map(q=>`<button onclick="adminCopilotQuery('${q}')" style="background:var(--panel2);border:1px solid var(--border);color:var(--text2);border-radius:20px;padding:5px 12px;font-size:11px;cursor:pointer">${q}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border)">
        <input id="adm-copilot-input" placeholder="Ask about enforcement data, deployments…" onkeydown="if(event.key==='Enter')adminCopilotSend()" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:13px;background:var(--panel2);color:var(--text1);outline:none"/>
        <button onclick="adminCopilotSend()" style="background:#dc2626;border:none;border-radius:8px;padding:10px 16px;color:#fff;font-size:14px;cursor:pointer">➤</button>
      </div>
    </div>
  </div>`;
}

function openAdminCopilot() {
  document.getElementById('admin-copilot-modal').style.display = 'flex';
}

function adminCopilotQuery(q) {
  document.getElementById('adm-copilot-input').value = q;
  adminCopilotSend();
}

async function adminCopilotSend() {
  const inp = document.getElementById('adm-copilot-input');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  const msgs = document.getElementById('adm-copilot-msgs');
  if (!msgs) return;
  msgs.innerHTML += `<div style="text-align:right;margin-bottom:8px"><span style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--text1);display:inline-block;max-width:85%">${q}</span></div>`;
  const thinkId = 'adm-think-' + Date.now();
  msgs.innerHTML += `<div id="${thinkId}" style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:12px;margin-bottom:10px;font-size:13px;color:var(--text1)"><div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT COMMAND AI</div><span style="opacity:.4">Analysing…</span></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  // Calls our own backend (/api/v1/copilot/authed), which holds the real API
  // key server-side and builds context from the live citywide data snapshot —
  // never the browser-side api.anthropic.com call this used to make.
  try {
    const reply = await askCopilot(q, 'admin-cmd');
    const el = document.getElementById(thinkId);
    if (el) {
      const formatted = (typeof marked !== 'undefined')
        ? marked.parse(reply || 'Analysis unavailable.')
        : (reply || 'Analysis unavailable.').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br>');
      el.innerHTML = `<div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT COMMAND AI</div><div class="copilot-md">${formatted}</div>`;
    }
  } catch(e) {
    const el = document.getElementById(thinkId);
    if (el) el.innerHTML = `<div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT COMMAND AI</div>Sorry, I couldn't reach the assistant right now. Please try again shortly.`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}