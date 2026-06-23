/* ════════════════════════════════════════════════════════════════════════
   ADMIN-MAP.JS — Hotspot Map page: layer switching, filters, evidence panel,
   analysis tabs (Overview / Hotspots / Plan / Method), CSV/PDF export
   ════════════════════════════════════════════════════════════════════════ */
function renderAdminMap(c){
  const topH=_hotspots[0]||{};
  c.innerHTML=`<div class="page active">
    <div class="hero-bar">
      <div class="hero-cell"><div class="hero-eyebrow">Highest Risk</div><div class="hero-val">${topH.police_station||'—'}</div><div class="hero-sub">${((topH.eps_score||0)*100).toFixed(1)} impact score</div></div>
      <div class="hero-cell"><div class="hero-eyebrow">Best First Deployment</div><div class="hero-val">${_summary.optimized_beat_count ?? '—'} beats</div><div class="hero-sub">${(_summary.total_violations_covered||0).toLocaleString()} cases in priority zones</div></div>
      <div class="hero-cell"><div class="hero-eyebrow">Highest Burden Station</div><div class="hero-val">${(_hotspots[0]||{}).police_station||'—'}</div><div class="hero-sub">${((_hotspots[0]||{}).total_violations||0).toLocaleString()} violations · ${((_hotspots[0]||{}).pct_of_citywide_impact||0).toFixed(1)}% citywide impact</div></div>
      <div class="hero-cell"><div class="hero-eyebrow">Patrol Coverage</div><div class="hero-val">${_allocations.length} officers</div><div class="hero-sub">${_allocations.reduce((s,a)=>s+a.n_stops,0)} stops across ${((_summary.critical_hotspot_zones||0)+(_summary.citizen_accountability_blind_spots||0))} priority zones</div></div>
    </div>
    <div class="map-layout">
      <div>
        <div class="panel" style="padding:0;overflow:hidden">
          <div class="stats-strip">
            ${[['Violations Analyzed','⚠️',(_hotspots.reduce((s,h)=>s+h.total_violations,0)).toLocaleString()],['H3 Cells Scored','🎯',(_hotspots.length).toString()],['Junction-Linked (wt.)','🔗','~50%'],['CRITICAL + HIGH','🔥',(_hotspots.filter(h=>h.hotspot_tier==='CRITICAL'||h.hotspot_tier==='HIGH').length).toString()]].map(([l,ic,v])=>`<div class="stats-cell"><div class="stats-eyebrow"><span>${l}</span><span>${ic}</span></div><div class="stats-val">${v}</div></div>`).join('')}
          </div>
          <div class="filter-bar">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-right:2px">Station</div>
            <select class="station-sel" id="station-filter" onchange="applyMapFilters()">
              <option value="">All police stations</option>
              ${[...new Set(_hotspots.map(h=>h.police_station))].sort().map(s=>`<option>${s}</option>`).join('')}
            </select>
            <div class="sev-pills">
              <button class="sev-pill active" onclick="setSev(this,'all')">All</button>
              <button class="sev-pill critical" onclick="setSev(this,'critical')">Critical</button>
              <button class="sev-pill high" onclick="setSev(this,'high')">High</button>
              <button class="sev-pill watch" onclick="setSev(this,'watch')">Watch</button>
            </div>
          </div>
          <div class="layer-bar">
            <button class="layer-pill active" id="lp-impact" onclick="switchMapLayer('impact')">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.5"/><circle cx="6.5" cy="6.5" r="2.5" fill="currentColor"/></svg>Impact
            </button>
            <button class="layer-pill" id="lp-volume" onclick="switchMapLayer('volume')">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="6" width="3" height="6" rx="1" fill="currentColor"/><rect x="5" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="1" width="3" height="11" rx="1" fill="currentColor"/></svg>Volume
            </button>
            <button class="layer-pill" id="lp-junction" onclick="switchMapLayer('junction')">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6.5" cy="6.5" r="2" fill="currentColor"/></svg>Junction
            </button>
            <button class="layer-pill" id="lp-gap" onclick="switchMapLayer('gap')" style="color:#a78bfa">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3,2"/><line x1="4" y1="4" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Coverage Gap
            </button>
            <span id="map-info" style="margin-left:auto;font-size:11px;color:var(--muted);font-weight:500"></span>
          </div>
          <div style="position:relative">
            <div id="hotspot-map" style="height:430px"></div>
            <div class="map-tooltip" id="layer-tooltip">
              <div class="mtt-title" id="ltt-title">Impact layer</div>
              <div class="mtt-sub" id="ltt-sub">Combined EPS priority score</div>
              <div class="mtt-detail" id="ltt-zones">${_hotspots.length} visible hotspots · layer: impact</div>
              <div class="mtt-detail" style="margin-top:2px">Focus: Bengaluru overview</div>
            </div>
          </div>
        </div>
        <div id="evidence-sidebar" style="display:none;margin-top:14px"></div>
      </div>
      <div>
        <div class="analysis-panel">
          <div class="a-tabs">
            <button class="a-tab active" id="atab-overview" onclick="switchATab('overview')">Overview</button>
            <button class="a-tab" id="atab-hotspots" onclick="switchATab('hotspots')">Hotspots</button>
            <button class="a-tab" id="atab-plan" onclick="switchATab('plan')">Plan</button>
            <button class="a-tab" id="atab-method" onclick="switchATab('method')">Method</button>
          </div>
          <div class="a-body" id="a-body"></div>
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>{initHotspotMap();switchATab('overview');},100);
}

function setSev(btn,sev){
  _sevFilter=sev;
  document.querySelectorAll('.sev-pill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  applyMapFilters();
}
function applyMapFilters(){
  const station=document.getElementById('station-filter')?.value;
  if(station&&PRECINCT_COORDS[station]) snapToPrecinct(station);
  refreshHotspotMap();
}

function switchATab(tab){
  document.querySelectorAll('.a-tab').forEach(b=>b.classList.toggle('active',b.id==='atab-'+tab));
  const body=document.getElementById('a-body'); if(!body) return;
  if(tab==='overview'){
    const hours=[3200,2100,1400,900,1200,2800,6400,14200,21800,26400,24100,22300,18600,16200,14800,13200,17400,19800,17200,12400,8600,6200,4800,3800];
    const vtypeCounts={};_hotspots.forEach(h=>{if(h.top_violation_type)vtypeCounts[h.top_violation_type]=(vtypeCounts[h.top_violation_type]||0)+h.total_violations;});const totalVT=Object.values(vtypeCounts).reduce((a,b)=>a+b,1);const primaryViols=Object.entries(vtypeCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([l,n])=>({l,p:Math.round(n/totalVT*100)}));
    body.innerHTML=`
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;font-style:italic;padding:10px;background:var(--panel2);border-radius:8px;border:1px solid var(--border);line-height:1.5">Dominant issue is wrong parking around 09:00–12:00 IST</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><div style="font-size:13px;font-weight:700">Priority Plan Coverage</div><div style="font-size:11px;color:var(--muted)">${_allocations.length} officers · ${_allocations.reduce((s,a)=>s+a.n_stops,0)} stops across CRITICAL/HIGH zones</div></div>
        <span style="background:var(--accent);color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700">${_allocations.length} beats</span>
      </div>
      <div style="margin-bottom:12px">
        <div class="cov-row"><span style="font-weight:600">Priority violations in patrol routes</span><span style="font-weight:700">${_allocations.reduce((s,a)=>s+(a.priority_violations||0),0).toLocaleString()} cases</span></div>
        <div class="cov-bar"><div class="cov-fill-r" style="width:${Math.min(100,Math.round(_allocations.reduce((s,a)=>s+(a.priority_violations||0),0)/(_hotspots.reduce((s,h)=>s+h.total_violations,0)||1)*100))}%"></div></div>
        <div class="cov-note">${Math.round(_allocations.reduce((s,a)=>s+(a.priority_violations||0),0)/(_hotspots.reduce((s,h)=>s+h.total_violations,0)||1)*100)}% of total violation burden in patrol scope</div>
      </div>
      <div style="margin-bottom:16px;font-size:11px;color:var(--muted);background:var(--panel2);border-radius:6px;padding:8px 10px;border:1px solid var(--border)">
        ℹ️ Coverage reflects CP-SAT route optimisation against priority score, not raw violation count. PCU obstruction metric requires real traffic-speed data and is not computed from this dataset.
      </div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">Violation Rhythm</div>
      <div class="chart-wrap"><canvas id="rhythm-chart"></canvas></div>
      <div style="text-align:center;font-size:10px;color:var(--muted);margin-top:4px">Hour of day (IST)</div>
      <div style="font-size:12px;font-weight:700;margin-top:14px;margin-bottom:8px">Primary Violations</div>
      ${primaryViols.map(v=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--text2)">${v.l}</span><span style="font-weight:700">${v.p}%</span></div><div style="height:4px;background:${v.p>30?'var(--danger)':v.p>20?'var(--warn)':'var(--accent)'};width:${v.p}%;border-radius:2px;margin-bottom:2px"></div>`).join('')}
    `;
    setTimeout(()=>{
      const ctx=document.getElementById('rhythm-chart'); if(!ctx) return;
      const isDark=_currentTheme==='dark';
      const gridColor=isDark?'#1e2d45':'#f1f5f9'; const tickColor=isDark?'#4b6080':'#94a3b8';
      new Chart(ctx,{type:'line',data:{labels:['12AM','3AM','6AM','9AM','12PM','3PM','6PM','9PM'],datasets:[{data:[hours[0],hours[3],hours[6],hours[9],hours[12],hours[15],hours[18],hours[21]],fill:true,backgroundColor:isDark?'rgba(0,217,142,.06)':'rgba(0,184,122,.08)',borderColor:'#00b87a',borderWidth:2.5,pointBackgroundColor:'#00b87a',pointRadius:3,tension:.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>`${ctx.parsed.y.toLocaleString()} violations`}}},scales:{y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:10},maxTicksLimit:5,callback:(v)=>v>=1000?(v/1000).toFixed(0)+'k':v}},x:{grid:{display:false},ticks:{color:tickColor,font:{size:10}}}}}});
    },50);
  } else if(tab==='hotspots'){
    body.innerHTML=`<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${_hotspots.length} hotspot zones ranked by EPS</div>`+
      _hotspots.slice(0,15).map((h,i)=>`<div onclick="showEvidencePanel(${JSON.stringify(h).replace(/"/g,'&quot;')})" style="display:flex;align-items:center;gap:10px;padding:9px;border-radius:8px;cursor:pointer;transition:background .15s;margin-bottom:2px" onmouseenter="this.style.background='var(--panel2)'" onmouseleave="this.style.background=''">
        <div style="width:22px;height:22px;border-radius:50%;background:${epsColor(h.eps_score)};opacity:.15;flex-shrink:0;position:relative"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${epsColorHex(h.eps_score)};opacity:1">${i+1}</div></div>
        <div style="font-size:10px;color:var(--muted)">${h.total_violations.toLocaleString()} violations · ${h.pct_of_citywide_impact?.toFixed(2)||'—'}% citywide impact</div>
        <div style="font-size:15px;font-weight:800;color:${epsColor(h.eps_score)}">${(h.eps_score*100).toFixed(0)}</div>
      </div>`).join('');
  } else if(tab==='plan'){
    body.innerHTML=`<div style="font-size:12px;font-weight:700;margin-bottom:10px">Optimised Patrol Beats</div>`+
      _allocations.slice(0,6).map((a,i)=>`<div style="padding:10px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-weight:700;font-size:13px;color:var(--text)">${a.route_id}</span><span style="font-size:10px;font-weight:600;background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:4px">${(a.assigned_vehicle_type||'').split(' ')[0]}</span></div><div style="font-size:11px;color:var(--text2)">${(a.station_sequence||[]).slice(0,3).join(' → ')}${(a.station_sequence||[]).length>3?'…':''}</div><div style="font-size:10px;color:var(--muted);margin-top:3px">${a.officer_id} · ~${a.estimated_coverage_mins}m</div></div>`).join('');
  } else {
    body.innerHTML=`<div style="font-size:12px;font-weight:700;margin-bottom:12px">Methodology</div>`+
      [['EPS Score','Enforcement Priority Score — real pipeline formula: violation volume (35%) + daily persistence (20%) + peak-hour concentration (15%) + junction proximity (20%) + repeat-offender rate (10%). Tiers are percentile-based from the dataset: CRITICAL = top 3%, HIGH = top 15%, MEDIUM = top 40%. Citizen complaints are NOT part of the EPS formula.'],['Ghost Violations','Zones where prior_avg ≥ 1.0 violation/day AND ≥ 5 active days in the prior window, but zero recent activity. TRUE_GHOST = complete cessation; INTERMITTENT = sporadic recent activity. Dataset found 2 true ghost zones + 7 intermittent (9 total).'],['H3 Clustering','Hexagonal spatial binning at resolution 8 (~460m). Each cell scored independently and merged where cells share a police station. 703 merged hotspots from 776 raw scored cells.'],['Blind Spots / Under-enforced','Zones in the top quartile of violation volume AND the bottom quartile of action rate — meaning high-crime areas where enforcement response is weakest. Derived entirely from enforcement_effectiveness.csv; no citizen complaints involved.'],['Patrol Optimisation','OR-Tools CP-SAT constraint programming assigns officers to zones, respecting geographic bounding boxes. 20 officers × 8 stops = 160 coverage slots vs. 119 CRITICAL/HIGH cells → enforcement resource gap = 0.']].map(([t,d])=>`<div style="margin-bottom:14px;padding:12px;background:var(--panel2);border-radius:8px;border:1px solid var(--border)"><div style="font-size:12px;font-weight:700;margin-bottom:5px">${t}</div><div style="font-size:12px;color:var(--text2);line-height:1.6">${d}</div></div>`).join('');
  }
}

function switchMapLayer(layer){
  _activeLayer=layer;
  ['impact','volume','junction','gap'].forEach(l=>document.getElementById('lp-'+l)?.classList.toggle('active',l===layer));
  const titles={impact:'Impact layer',volume:'Volume layer',junction:'Junction layer',gap:'Coverage Gap layer'};
  const subs={impact:'Combined EPS priority score',volume:'Raw illegal-parking case density',junction:'Intersection and crossing obstruction risk',gap:'HIGH/MEDIUM zones with no assigned patrol officer'};
  document.getElementById('ltt-title').textContent=titles[layer]||layer;
  document.getElementById('ltt-sub').textContent=subs[layer]||'';
  refreshHotspotMap();
}

function initHotspotMap(){
  // The map container div is destroyed and recreated every time the page is
  // re-rendered (innerHTML swap on navigation), but `leafMap` is a module-level
  // JS variable that survives that swap. If we only check "is leafMap truthy"
  // we end up calling .invalidateSize() on a Leaflet instance that's still
  // bound to the OLD, now-detached DOM node — so the map silently never
  // appears in the new container. Always tear down and rebuild fresh.
  if(leafMap){ try{leafMap.remove();}catch(e){} leafMap=null; }
  const el=document.getElementById('hotspot-map');
  if(!el) return;
  leafMap=L.map('hotspot-map',{zoomControl:true,attributionControl:false}).setView([12.975,77.580],12);
  L.tileLayer(getTileUrl(),{maxZoom:19,subdomains:'abcd'}).addTo(leafMap);
  refreshHotspotMap();
}

function refreshHotspotMap(){
  if(!leafMap) return;
  _mapLayers.forEach(l=>{try{leafMap.removeLayer(l)}catch(e){}});_mapLayers=[];
  if(_clusterGroup){try{leafMap.removeLayer(_clusterGroup)}catch(e){}_clusterGroup=null;}
  const stationVal=document.getElementById('station-filter')?.value||'';
  let hs=stationVal?_hotspots.filter(h=>h.police_station===stationVal):_hotspots;
  if(_sevFilter==='critical') hs=hs.filter(h=>h.eps_score>=.80);
  else if(_sevFilter==='high') hs=hs.filter(h=>h.eps_score>=.65&&h.eps_score<.80);
  else if(_sevFilter==='watch') hs=hs.filter(h=>h.eps_score<.65);
  _clusterGroup=L.markerClusterGroup({maxClusterRadius:40,spiderfyOnMaxZoom:true,zoomToBoundsOnClick:true,showCoverageOnHover:false,iconCreateFunction:function(cluster){const count=cluster.getChildCount();const sz=count<10?'small':count<50?'medium':'large';return L.divIcon({html:`<div><span>${count}</span></div>`,className:`marker-cluster marker-cluster-${sz}`,iconSize:L.point(count<10?32:count<50?38:44,count<10?32:count<50?38:44)})}});
  const maxViol=Math.max(..._hotspots.map(x=>x.total_violations),1);
  hs.forEach(h=>{
    let col,radius;
    if(_activeLayer==='volume'){const norm=h.total_violations/maxViol;col=norm>.7?'#ef4444':norm>.4?'#f97316':'#00b87a';radius=8+norm*24;}
    else if(_activeLayer==='junction'){col=h.congestion_delay_mins>30?'#ef4444':h.congestion_delay_mins>15?'#f97316':'#7c3aed';radius=7+h.congestion_delay_mins*.6;}
    else{col=epsColorHex(h.eps_score);radius=10+h.eps_score*20;}
    const heavyEnforcement=h.top_violation_type==='H T V PROHIBITED';
    const vIcon=heavyEnforcement?'🚛':h.top_violation_type==='PARKING IN A MAIN ROAD'?'🚗':'🏍';
    const m=L.circleMarker([h.latitude,h.longitude],{radius,color:col,fillColor:col,fillOpacity:.25,weight:2,dashArray:h.blind_spot?'6,3':null});
    m.bindPopup(`<div class="ps-popup"><div class="ps-popup-title">${vIcon} ${h.police_station}</div>${h.blind_spot?'<span style="background:var(--warn-light);border:1px solid rgba(249,115,22,.2);color:var(--warn);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700">BLIND SPOT</span>':''}<div style="margin:8px 0"><div class="ps-popup-stat"><span>Impact index</span><b>${h.pct_of_citywide_impact?.toFixed(2)||'—'}% citywide</b></div><div class="ps-popup-stat"><span>Cases</span><b>${h.total_violations.toLocaleString()}</b></div><div class="ps-popup-stat"><span>Congestion Proxy</span><b>${h.congestion_delay_mins}m</b></div><div class="ps-popup-stat"><span>Open complaints</span><b>${h.unresolved_citizen_complaints}</b></div></div><button class="ps-popup-action" onclick="showEvidencePanel(${JSON.stringify(h).replace(/"/g,'&quot;').replace(/'/g,'&#39;')})">View Evidence Panel →</button></div>`);
    m.on('click',()=>showEvidencePanel(h));
    _clusterGroup.addLayer(m);_mapLayers.push(m);
  });
  leafMap.addLayer(_clusterGroup);
  const seen=new Set();
  _forecasts.filter(f=>f.is_ghost_violation).forEach(g=>{
    const k=`${g.latitude},${g.longitude}`;if(seen.has(k)||!g.latitude) return;seen.add(k);
    const m=L.circleMarker([g.latitude,g.longitude],{radius:7,color:'#7c3aed',fillColor:'#7c3aed',fillOpacity:.5,weight:1.5}).addTo(leafMap);
    m.bindPopup(`<div class="ps-popup"><div class="ps-popup-title">👻 Ghost Violation</div><div>${g.police_station}</div><div style="color:var(--muted);font-size:11px;margin-top:4px">${g.ghost_reason||''}</div></div>`);
    _mapLayers.push(m);
  });
  if(_activeLayer==='gap'){
    api('/api/v1/admin/unassigned-cells').then(res=>{
      const cells=res.cells||[];
      cells.forEach(cell=>{
        const col=cell.hotspot_tier==='HIGH'?'#f97316':'#a78bfa';
        const m=L.circleMarker([cell.latitude,cell.longitude],{
          radius:14,color:col,fillColor:col,fillOpacity:0.15,weight:2.5,dashArray:'5,3'
        }).addTo(leafMap);
        m.bindPopup(`<div class="ps-popup">
          <div class="ps-popup-title" style="color:${col}">⚠ Unpatrolled Zone</div>
          <div style="font-weight:600;margin-bottom:4px">${cell.police_station}</div>
          ${cell.junction_name?`<div style="font-size:11px;color:var(--muted);margin-bottom:6px">📍 ${cell.junction_name}</div>`:''}
          <div class="ps-popup-stat"><span>Tier</span><b style="color:${col}">${cell.hotspot_tier}</b></div>
          <div class="ps-popup-stat"><span>EPS Score</span><b>${(cell.eps_score*100).toFixed(0)}</b></div>
          <div style="font-size:11px;color:var(--danger);margin-top:8px;font-weight:600">No officer assigned — outside current 20-officer capacity</div>
        </div>`);
        _mapLayers.push(m);
      });
      const lttZones=document.getElementById('ltt-zones');
      if(lttZones) lttZones.textContent=`${cells.length} unpatrolled zones · ${cells.filter(c=>c.hotspot_tier==='HIGH').length} HIGH · ${cells.filter(c=>c.hotspot_tier==='MEDIUM').length} MEDIUM`;
      document.getElementById('map-info').textContent=`Coverage Gap · ${cells.length} unpatrolled zones`;
    }).catch(()=>{});
    return;
  }
  const lttZones=document.getElementById('ltt-zones');
  if(lttZones) lttZones.textContent=`${hs.length} visible hotspots · layer: ${_activeLayer}`;
  document.getElementById('map-info').textContent=`${_activeLayer.charAt(0).toUpperCase()+_activeLayer.slice(1)} · ${hs.length} zones`;
}

function showEvidencePanel(h){
  const sidebar=document.getElementById('evidence-sidebar');if(!sidebar) return;
  const heavyEnforcement=h.top_violation_type==='H T V PROHIBITED';
  const col=epsColorHex(h.eps_score);
  const severity=h.eps_score>=.85?'CRITICAL':h.eps_score>=.70?'HIGH':h.eps_score>=.50?'MEDIUM':'LOW';
  const impactIdx=(h.congestion_impact_index||0).toFixed(0);
  const citywidePct=(h.pct_of_citywide_impact||0).toFixed(2);
  const action=severity==='CRITICAL'?'IMMEDIATE DISPATCH — Deploy tow truck + challan team. Clear carriageway within 15 minutes.':severity==='HIGH'?'PRIORITY PATROL — Assign nearest officer within 30 minutes. Issue challans + photograph.':'SCHEDULED PATROL — Include in next shift route. Log for monthly audit.';
  sidebar.style.display='block';
  sidebar.innerHTML=`<div class="evidence-panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div><div style="font-size:16px;font-weight:800;margin-bottom:8px">${h.police_station}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <span class="ep-badge" style="background:${severity==='CRITICAL'?'var(--danger-light)':severity==='HIGH'?'var(--warn-light)':'var(--accent-light)'};color:${col};border:1px solid ${col}22">${severity}</span>
        <span class="ep-badge" style="background:var(--panel2);color:var(--text2);border:1px solid var(--border)">EPS ${(h.eps_score*100).toFixed(0)}</span>
        ${h.blind_spot?'<span class="ep-badge" style="background:var(--warn-light);color:var(--warn);border:1px solid rgba(249,115,22,.2)">⚠ BLIND SPOT</span>':''}
        ${heavyEnforcement?'<span class="ep-badge" style="background:var(--warn-light);color:var(--warn);border:1px solid rgba(249,115,22,.2)">🚛 HEAVY/TOW VEHICLE ZONE</span>':''}
      </div></div>
      <button onclick="document.getElementById('evidence-sidebar').style.display='none'" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:22px;padding:0;line-height:1;margin-left:10px">×</button>
    </div>
    <div class="eps-metrics">
      ${[['Total Violations',h.total_violations.toLocaleString(),col],['Impact Index',impactIdx+' pts','#f97316'],['Citywide Share',citywidePct+'%','#7c3aed'],['Open Complaints',h.unresolved_citizen_complaints,h.unresolved_citizen_complaints>150?'#ef4444':'#00b87a'],['Action Rate',((h.action_rate||0)*100).toFixed(1)+'%','#d97706'],['Repeat Vehicles',((h.repeat_vehicle_rate||0)*100).toFixed(0)+'%','var(--text2)']].map(([l,v,vc])=>`<div class="ep-metric-card"><div class="ep-metric-label">${l}</div><div class="ep-metric-val" style="color:${vc}">${v}</div></div>`).join('')}
        <div style="font-size:9px;color:var(--muted);margin-top:6px;padding:5px 8px;background:var(--panel2);border-radius:4px;border:1px solid var(--border)">⚠ Impact index is a proxy metric (violations × junction weight × peak-hour multiplier). Calibrate against real traffic-speed data when available.</div>
    </div>
    <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:.5px;margin-bottom:5px">AI Pattern Analysis</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6">${h.explanation||'Hotspot exhibits consistent parking violations during peak hours.'}</div>
    </div>
    <div style="background:var(--accent-light);border:1px solid rgba(0,184,122,.2);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:10px;color:var(--accent-dark);text-transform:uppercase;font-weight:700;letter-spacing:.5px;margin-bottom:5px">⚡ Recommended Action</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6">${action}</div>
      ${heavyTow?'<div class="heavy-tow-flag">🚛 This zone requires Heavy Tow Truck — motorcycle dispatches NOT suitable.</div>':''}
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn-export" onclick="exportZoneCSV('${h.police_station.replace(/'/g,"\\'")}')" style="font-size:12px;padding:8px 14px">📊 Zone CSV</button>
      <button class="btn btn-outline" onclick="document.getElementById('evidence-sidebar').style.display='none'" style="font-size:12px;padding:8px 14px">Close</button>
    </div>
  </div>`;
  sidebar.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function showCmdEvidencePanel(i){
  const h=_hotspots[i]; if(!h) return;
  const target=document.getElementById('cmd-evidence-panel'); if(!target) return;
  const tmpId='__ev_tmp_'+Date.now();
  const orig=document.getElementById('evidence-sidebar');
  if(orig) orig.id=tmpId;
  target.id='evidence-sidebar';
  showEvidencePanel(h);
  target.id='cmd-evidence-panel';
  if(orig) orig.id='evidence-sidebar';
}

function exportZoneCSV(zone){
  const h=_hotspots.find(x=>x.police_station===zone)||_hotspots[0]; if(!h) return;
  const rows=[['Field','Value'],['Zone',h.police_station],['EPS Score',(h.eps_score*100).toFixed(1)],['Total Violations',h.total_violations],['Congestion Impact Index (proxy)',h.congestion_impact_index||0],['Congestion Proxy (min)',h.congestion_delay_mins||0],['Citywide Impact %',h.pct_of_citywide_impact||0],['Action Rate %',((h.action_rate||0)*100).toFixed(1)],['Unresolved Citizen Complaints',h.unresolved_citizen_complaints||0],['Repeat Vehicle Rate %',((h.repeat_vehicle_rate||0)*100).toFixed(1)],['Top Violation Type',h.top_violation_type||''],['Blind Spot',h.blind_spot?'Yes':'No']];
  downloadCSV(`parkinsight-zone-${zone.replace(/[^a-z0-9]/gi,'_')}.csv`, rows);
  toast('Zone CSV downloaded');
}

// ── PAGE-AWARE EXPORT (header buttons) ────────────────────────────────────────
// These read _currentPage so "CSV Report" / "PDF Brief" always reflect what the
// admin is actually looking at, instead of dumping the same hotspot table from
// every page regardless of context.

function downloadCSV(filename, rows){
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

function getExportDataset(){
  switch(_currentPage){
    case 'admin-eps':
      return { title:'EPS Rankings', filename:'parkinsight-eps-rankings.csv',
        rows:[['#','Zone','Junction','EPS Score','Tier','Violations','Action Rate %','Congestion Proxy (min)','Citywide Impact %','Top Violation','Under-enforced'],
          ..._hotspots.map((h,i)=>[i+1,h.police_station,h.junction_name||'',(h.eps_score*100).toFixed(1),h.hotspot_tier||'',h.total_violations,((h.action_rate||0)*100).toFixed(1),(h.congestion_delay_mins||0).toFixed(1),(h.pct_of_citywide_impact||0).toFixed(2),h.top_violation_type||'',h.blind_spot?'Yes':'No'])] };
    case 'admin-forecast': {
      const windows=[[0,'Now'],[1440,'+24h'],[10080,'+7d']];
      const exportRows=[['Zone','H3 Cells','Window','Risk Score (zone avg)','Daily Violations (zone total)','7-Day Violations (zone total)','Ghost Cell in Zone','Ghost Type']];
      windows.forEach(([wm,label])=>{
        const agg=aggregateForecastByStation(_forecasts.filter(f=>f.window_minutes===wm)).sort((a,b)=>b.predicted_risk_score-a.predicted_risk_score);
        agg.forEach(f=>exportRows.push([f.police_station,f.cell_count,label,(f.predicted_risk_score*100).toFixed(1),f.predicted_daily_violations.toFixed(1),Math.round(f.predicted_7day_violations),f.is_ghost_violation?'Yes':'No',f.ghost_type||'']));
      });
      return { title:'Risk Forecast', filename:'parkinsight-risk-forecast.csv', rows: exportRows };
    }
    case 'admin-routes':
      return { title:'Officer Routing', filename:'parkinsight-officer-routes.csv',
        rows:[['Route ID','Officer','Vehicle Type','Stops','Coverage (min)','Priority Violations','Station Sequence'],
          ..._allocations.map(a=>[a.route_id,a.officer_id,a.assigned_vehicle_type,(a.station_sequence||[]).length,a.estimated_coverage_mins,a.priority_violations||0,(a.station_sequence||[]).join(' → ')])] };
    case 'admin-cmd':
      return { title:'Command Center Summary', filename:'parkinsight-command-summary.csv',
        rows:[['Metric','Value'],
          ['Critical Hotspot Zones',_summary.critical_hotspot_zones],
          ['Enforcement Blind Spots',_summary.citizen_accountability_blind_spots],
          ['Active Risk Zones Now',_summary.active_risk_zones_now],
          ['Ghost Violations Detected',_summary.ghost_violations_detected],
          ['Top-10 Citywide Impact %',_summary.top10_citywide_impact_pct],
          ['Avg Congestion Proxy (min)',_summary.avg_congestion_delay_mins],
          ['Enforcement Gap %',_summary.enforcement_gap_pct],
          ['Officers Deployed',_summary.officers_deployed]] };
    case 'admin-map':
    default:
      return { title:'Hotspot Map', filename:'parkinsight-hotspot-map.csv',
        rows:[['#','Zone','EPS Score','Violations','Congestion Proxy','Citywide Impact %','Top Violation Type','Blind Spot'],
          ..._hotspots.map((h,i)=>[i+1,h.police_station,(h.eps_score*100).toFixed(1),h.total_violations,h.congestion_delay_mins||0,(h.pct_of_citywide_impact||0).toFixed(2),h.top_violation_type||'',h.blind_spot?'Yes':'No'])] };
  }
}

function exportCSVReport(){
  const {title,filename,rows} = getExportDataset();
  downloadCSV(filename, rows);
  toast(`✅ ${title} CSV exported`);
}

function exportPDFBrief(){
  const {title,rows} = getExportDataset();
  const [header,...body] = rows;
  const html=`<!DOCTYPE html><html><head><title>ParkInsight — ${title}</title><style>body{font-family:system-ui;max-width:900px;margin:40px auto;color:#0f172a}h1{font-size:26px;font-weight:800;color:#00b87a;margin-bottom:2px}.sub{color:#64748b;font-size:13px;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f1f5f9;padding:8px;text-align:left;border:1px solid #e2e8f0}td{padding:7px 8px;border:1px solid #e2e8f0}</style></head><body><h1>ParkInsight</h1><div class="sub">${title} · Bengaluru Illegal Parking Intelligence · Generated ${new Date().toLocaleString()}</div><table><tr>${header.map(h=>`<th>${h}</th>`).join('')}</tr>${body.map(r=>`<tr>${r.map(v=>`<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
  const w=window.open('','_blank');
  if(!w){ toast('Allow pop-ups to open the PDF brief', true); return; }
  w.document.write(html); w.document.close(); setTimeout(()=>w.print(),300);
  toast(`📄 ${title} brief opened for printing`);
}