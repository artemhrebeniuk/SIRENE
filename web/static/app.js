/**
 * SIRENE GeoData Observatory — Client Application
 * Powered by Leaflet (ESRI Dark Gray Basemap, zero API key), DuckDB REST API.
 */

// Application Reactive State
const state = {
  kpis: null,
  departments: [],
  departmentsMap: {}, // code -> dept
  sectors: [],
  geoJsonData: null,
  geoJsonLayer: null,
  activeMode: 'density', // 'density' or 'sector'
  selectedSector: null,
  selectedDepartment: null,
  activeTerritory: 'all',
  activeTab: 'sectors',
  searchQuery: ''
};

// Leaflet Map Instance
let map;

// Territories Bounding Boxes
const BOUNDS = {
  metro: [[41.3, -5.2], [51.2, 9.6]],
  '971': [[15.8, -61.8], [16.5, -61.0]], // Guadeloupe
  '972': [[14.3, -61.3], [14.9, -60.8]], // Martinique
  '973': [[2.1, -54.6], [5.8, -51.6]],   // French Guiana
  '974': [[-21.4, 55.2], [-20.8, 55.9]], // Reunion Island
  '976': [[-13.0, 45.0], [-12.6, 45.3]], // Mayotte
};

// Lifecycle Start
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  bindUI();
  await loadKPIs();
  await Promise.all([loadGeoJSON(), loadDepartments(), loadSectors()]);
  updateChoropleth();
});

/* ==========================================================================
   Map Initialization with ESRI World Dark Gray (Zero Watermarks, No API Key)
   ========================================================================== */
function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334],
    zoom: 6,
    minZoom: 2,
    maxZoom: 14,
    zoomControl: true
  });

  // ESRI World Dark Gray Canvas — Completely free, no API key, zero watermark
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, HERE, DeLorme, MapmyIndia | INSEE SIRENE',
    maxZoom: 16
  }).addTo(map);
}

// Dynamic Color Gradient
function getChoroplethColor(value, maxVal) {
  if (!value || value === 0 || maxVal === 0) return '#1E293B';
  const ratio = Math.min(value / maxVal, 1.0);
  
  if (ratio > 0.70) return '#EF4444'; // Red / High
  if (ratio > 0.40) return '#F59E0B'; // Amber
  if (ratio > 0.15) return '#38BDF8'; // Cyan
  if (ratio > 0.04) return '#0284C7'; // Blue
  return '#1E3A8A';                   // Navy / Low
}

function getFeatureStyle(feature) {
  const code = feature.properties.code || feature.properties.CODE_DEPT || feature.properties.insee;
  let val = 0;
  let maxVal = 1;

  if (state.activeMode === 'sector' && state.selectedSector) {
    val = state.selectedSector.departments[code] || 0;
    maxVal = Math.max(...Object.values(state.selectedSector.departments), 1);
  } else {
    const dept = state.departmentsMap[code];
    val = dept ? dept.total : 0;
    maxVal = Math.max(...state.departments.map(d => d.total), 1);
  }

  const isSelected = state.selectedDepartment && state.selectedDepartment.code === code;

  return {
    fillColor: getChoroplethColor(val, maxVal),
    weight: isSelected ? 2.5 : 1,
    opacity: 1,
    color: isSelected ? '#38BDF8' : '#334155',
    fillOpacity: isSelected ? 0.9 : 0.72
  };
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */
async function loadKPIs() {
  try {
    const res = await fetch('/api/kpis');
    const data = await res.json();
    state.kpis = data;

    document.getElementById('kpiTotalActive').textContent = data.total_active_establishments.toLocaleString('en-US');
    document.getElementById('kpiGeocodedPct').textContent = `${data.geocoding_rate_pct}%`;
    document.getElementById('kpiDepartments').textContent = `${data.distinct_departments} / 101`;
    document.getElementById('kpiNafCodes').textContent = data.distinct_naf_codes.toLocaleString('en-US');

    if (data.is_sample) {
      document.getElementById('badgeText').textContent = 'Fast Demo (Sample)';
      document.getElementById('datasetBadge').style.borderColor = 'rgba(245, 158, 11, 0.4)';
      document.getElementById('datasetBadge').style.color = '#F59E0B';
    } else {
      document.getElementById('badgeText').textContent = 'Full Registry (101 Depts)';
    }
  } catch (err) {
    console.error('Failed to load KPIs:', err);
  }
}

async function loadGeoJSON() {
  try {
    const res = await fetch('/api/geojson');
    state.geoJsonData = await res.json();
  } catch (err) {
    console.error('Failed to load GeoJSON:', err);
  }
}

async function loadDepartments() {
  try {
    const res = await fetch('/api/departments');
    state.departments = await res.json();
    state.departmentsMap = {};
    state.departments.forEach(d => {
      state.departmentsMap[d.code] = d;
    });
    renderDepartmentsList();
  } catch (err) {
    console.error('Failed to load departments:', err);
  }
}

async function loadSectors() {
  try {
    const res = await fetch('/api/sectors?limit=200');
    state.sectors = await res.json();
    renderSectorsList();
  } catch (err) {
    console.error('Failed to load sectors:', err);
  }
}

/* ==========================================================================
   Choropleth Rendering & Interactivity
   ========================================================================== */
function updateChoropleth() {
  if (!state.geoJsonData) return;

  if (state.geoJsonLayer) {
    map.removeLayer(state.geoJsonLayer);
  }

  state.geoJsonLayer = L.geoJSON(state.geoJsonData, {
    style: getFeatureStyle,
    onEachFeature: (feature, layer) => {
      const code = feature.properties.code || feature.properties.CODE_DEPT || feature.properties.insee;
      const deptName = feature.properties.nom || feature.properties.NOM_DEPT || `Department ${code}`;

      layer.on({
        mouseover: (e) => {
          const l = e.target;
          l.setStyle({ weight: 2.2, color: '#FFF', fillOpacity: 0.95 });
          l.bringToFront();

          let details = '';
          if (state.activeMode === 'sector' && state.selectedSector) {
            const count = state.selectedSector.departments[code] || 0;
            details = `<div class="tooltip-body">Industry Count: <b>${count.toLocaleString('en-US')}</b></div>`;
          } else {
            const dept = state.departmentsMap[code];
            const count = dept ? dept.total : 0;
            const pct = dept ? dept.geocoded_pct : 0;
            details = `<div class="tooltip-body">Active Units: <b>${count.toLocaleString('en-US')}</b> (${pct}% geocoded)</div>`;
          }

          layer.bindTooltip(`
            <div>
              <div class="tooltip-title">${deptName} (${code})</div>
              ${details}
            </div>
          `, { sticky: true, direction: 'top', className: 'custom-tooltip-wrapper' }).openTooltip();
        },
        mouseout: (e) => {
          state.geoJsonLayer.resetStyle(e.target);
        },
        click: () => {
          selectDepartment(code);
        }
      });
    }
  }).addTo(map);

  updateLegend();
}

function updateLegend() {
  let maxVal = 100;
  if (state.activeMode === 'sector' && state.selectedSector) {
    maxVal = Math.max(...Object.values(state.selectedSector.departments), 1);
  } else if (state.departments.length > 0) {
    maxVal = state.departments[0].total;
  }

  document.getElementById('legendMin').textContent = '0';
  document.getElementById('legendMid').textContent = Math.round(maxVal / 2).toLocaleString('en-US');
  document.getElementById('legendMax').textContent = maxVal.toLocaleString('en-US');
}

/* ==========================================================================
   UI Event Bindings
   ========================================================================== */
function bindUI() {
  // Tab Switching
  document.querySelectorAll('.tab-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-trigger').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      const target = btn.dataset.tab === 'sectors' ? 'paneSectors' : 'paneDepartments';
      document.getElementById(target).classList.add('active');
    });
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearch');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    clearBtn.style.display = state.searchQuery ? 'block' : 'none';

    if (state.activeTab === 'sectors') {
      renderSectorsList();
    } else {
      renderDepartmentsList();
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.style.display = 'none';
    renderSectorsList();
    renderDepartmentsList();
  });

  // Territory Toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const territory = btn.dataset.territory;

      if (territory === 'metro') {
        map.fitBounds(BOUNDS.metro);
      } else if (territory === 'all') {
        map.setView([46.603354, 1.888334], 6);
      } else if (territory === 'dom') {
        map.fitBounds(BOUNDS['971']);
      }
    });
  });

  // DOM Buttons
  document.querySelectorAll('.dom-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.dept;
      if (BOUNDS[code]) {
        map.fitBounds(BOUNDS[code], { maxZoom: 10 });
      }
      selectDepartment(code);
    });
  });

  // Reset
  document.getElementById('btnReset').addEventListener('click', resetAll);

  // Close Inspector Drawer
  document.getElementById('btnCloseInspector').addEventListener('click', () => {
    document.getElementById('inspectorDrawer').style.display = 'none';
    state.selectedDepartment = null;
    updateChoropleth();
  });
}

/* ==========================================================================
   List Renderers (De-Cluttered & Fast)
   ========================================================================== */
function renderSectorsList() {
  const container = document.getElementById('sectorsList');
  const filtered = state.sectors.filter(s => {
    if (!state.searchQuery) return true;
    return s.code.toLowerCase().includes(state.searchQuery) ||
           s.label.toLowerCase().includes(state.searchQuery);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state">No matching industries found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const isSelected = state.selectedSector && state.selectedSector.code_naf === s.code;

    return `
      <div class="entity-row ${isSelected ? 'selected' : ''}" onclick="selectSector('${s.code}')">
        <div class="entity-info">
          <span class="code-tag">${s.code}</span>
          <span class="entity-name" title="${s.label}">${s.label}</span>
        </div>
        <span class="entity-value">${s.total.toLocaleString('en-US')}</span>
      </div>
    `;
  }).join('');
}

function renderDepartmentsList() {
  const container = document.getElementById('departmentsList');
  const filtered = state.departments.filter(d => {
    if (!state.searchQuery) return true;
    return d.code.toLowerCase().includes(state.searchQuery) ||
           d.name.toLowerCase().includes(state.searchQuery);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state">No matching departments found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(d => {
    const isSelected = state.selectedDepartment && state.selectedDepartment.code === d.code;

    return `
      <div class="entity-row ${isSelected ? 'selected' : ''}" onclick="selectDepartment('${d.code}')">
        <div class="entity-info">
          <span class="code-tag">${d.code}</span>
          <span class="entity-name">${d.name}</span>
        </div>
        <span class="entity-value">${d.total.toLocaleString('en-US')}</span>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   Selections & Deep Dives
   ========================================================================== */
async function selectSector(nafCode) {
  try {
    const res = await fetch(`/api/sector/${nafCode}`);
    const data = await res.json();
    state.selectedSector = data;
    state.activeMode = 'sector';

    // Update Overlay Header
    document.getElementById('mapViewTitle').textContent = `${data.code_naf} — ${data.label}`;
    document.getElementById('mapViewSubtitle').textContent = `National total: ${data.total_national.toLocaleString('en-US')} active establishments`;

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Selected Industry';
    document.getElementById('inspectorTitle').textContent = `${data.code_naf} — ${data.label}`;
    document.getElementById('inspectorCount').textContent = data.total_national.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${Object.keys(data.departments).length} Depts`;

    // Top 5 Departments
    const topDepts = Object.entries(data.departments)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="font-weight:600; color:#94A3B8; margin-top:4px;">Top Regional Concentrations:</div>
      ${topDepts.map(([code, count]) => {
        const name = state.departmentsMap[code] ? state.departmentsMap[code].name : `Dept ${code}`;
        return `
          <div class="breakdown-row">
            <span><b class="breakdown-code">${code}</b> ${name}</span>
            <span style="font-weight:700; color:#38BDF8">${count.toLocaleString('en-US')}</span>
          </div>
        `;
      }).join('')}
    `;

    renderSectorsList();
    updateChoropleth();
  } catch (err) {
    console.error('Error selecting sector:', err);
  }
}

async function selectDepartment(deptCode) {
  try {
    const res = await fetch(`/api/department/${deptCode}`);
    const data = await res.json();
    state.selectedDepartment = data;

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Selected Department';
    document.getElementById('inspectorTitle').textContent = `${data.name} (${data.code})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    // Top 5 Activities
    document.getElementById('inspectorDetails').innerHTML = `
      <div style="font-weight:600; color:#94A3B8; margin-top:4px;">Top Local Industries:</div>
      ${data.top_sectors.slice(0, 5).map(s => `
        <div class="breakdown-row">
          <span title="${s.label}"><b class="breakdown-code">${s.code_naf}</b> ${s.label.substring(0, 24)}...</span>
          <span style="font-weight:700; color:#10B981">${s.count.toLocaleString('en-US')} (${s.pct}%)</span>
        </div>
      `).join('')}
    `;

    renderDepartmentsList();
    updateChoropleth();
  } catch (err) {
    console.error('Error selecting department:', err);
  }
}

function resetAll() {
  state.activeMode = 'density';
  state.selectedSector = null;
  state.selectedDepartment = null;
  state.searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearch').style.display = 'none';
  document.getElementById('inspectorDrawer').style.display = 'none';

  document.getElementById('mapViewTitle').textContent = 'National Business Density';
  document.getElementById('mapViewSubtitle').textContent = 'Hover over any department for details or click to inspect';

  map.setView([46.603354, 1.888334], 6);
  renderSectorsList();
  renderDepartmentsList();
  updateChoropleth();
}
