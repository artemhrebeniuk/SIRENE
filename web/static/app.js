/**
 * SIRENE GeoData Observatory — Interactive Application Logic
 * Powered by Leaflet, DuckDB backend REST APIs & reactive state management.
 */

// Global State
const state = {
  kpis: null,
  departments: [],
  departmentsMap: {}, // code -> dept object
  sectors: [],
  geoJsonData: null,
  geoJsonLayer: null,
  activeMode: 'density', // 'density' or 'sector'
  selectedSector: null, // { code_naf, label, total_national, departments }
  selectedDepartment: null, // dept object
  activeTerritory: 'all', // 'all', 'metro', 'dom'
  activeTab: 'sectors',
  searchQuery: ''
};

// Map Instance
let map;

// Territories Bounding Boxes
const BOUNDS = {
  metro: [[41.3, -5.2], [51.2, 9.6]],
  '971': [[15.8, -61.8], [16.5, -61.0]], // Guadeloupe
  '972': [[14.3, -61.3], [14.9, -60.8]], // Martinique
  '973': [[2.1, -54.6], [5.8, -51.6]],   // Guyane
  '974': [[-21.4, 55.2], [-20.8, 55.9]], // La Réunion
  '976': [[-13.0, 45.0], [-12.6, 45.3]], // Mayotte
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  bindUIEvents();
  await loadKPIs();
  await Promise.all([loadGeoJSON(), loadDepartments(), loadSectors()]);
  updateMapChoropleth();
});

/* ==========================================================================
   Map Initialization & Styling
   ========================================================================== */
function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334],
    zoom: 6,
    minZoom: 2,
    maxZoom: 14,
    zoomControl: true
  });

  // Dark Matter tiles by CartoDB (free & open)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | INSEE SIRENE',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
}

// Color Scale Function
function getColor(value, maxVal) {
  if (!value || value === 0 || maxVal === 0) return '#1E293B';
  const ratio = Math.min(value / maxVal, 1.0);
  
  if (ratio > 0.75) return '#EF4444'; // Rose / Red
  if (ratio > 0.45) return '#F59E0B'; // Amber
  if (ratio > 0.20) return '#38BDF8'; // Cyan
  if (ratio > 0.05) return '#0284C7'; // Deep Sky
  return '#1E3A8A';                   // Navy
}

function getDepartmentStyle(feature) {
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
    fillColor: getColor(val, maxVal),
    weight: isSelected ? 3 : 1,
    opacity: 1,
    color: isSelected ? '#38BDF8' : '#334155',
    dashArray: isSelected ? '' : '1',
    fillOpacity: isSelected ? 0.9 : 0.75
  };
}

/* ==========================================================================
   Data Fetching & State
   ========================================================================== */
async function loadKPIs() {
  try {
    const res = await fetch('/api/kpis');
    const data = await res.json();
    state.kpis = data;

    document.getElementById('kpiTotalActive').textContent = data.total_active_establishments.toLocaleString('fr-FR');
    document.getElementById('kpiGeocodedPct').textContent = `${data.geocoding_rate_pct}%`;
    document.getElementById('kpiGeocodedCount').textContent = `${data.geocoded_establishments.toLocaleString('fr-FR')} localisés WGS84`;
    document.getElementById('kpiDepartments').textContent = `${data.distinct_departments} / 101`;
    document.getElementById('kpiNafCodes').textContent = data.distinct_naf_codes.toLocaleString('fr-FR');

    if (data.is_sample) {
      document.getElementById('badgeText').textContent = 'Mode Démonstration Rapide (Échantillon)';
      document.getElementById('datasetBadge').style.borderColor = 'rgba(245, 158, 11, 0.4)';
      document.getElementById('datasetBadge').style.color = '#F59E0B';
    } else {
      document.getElementById('badgeText').textContent = 'INSEE SIRENE • France Entière';
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
    const res = await fetch('/api/sectors?limit=150');
    state.sectors = await res.json();
    renderSectorsList();
  } catch (err) {
    console.error('Failed to load sectors:', err);
  }
}

/* ==========================================================================
   Map Layers & Choropleth Logic
   ========================================================================== */
function updateMapChoropleth() {
  if (!state.geoJsonData) return;

  if (state.geoJsonLayer) {
    map.removeLayer(state.geoJsonLayer);
  }

  state.geoJsonLayer = L.geoJSON(state.geoJsonData, {
    style: getDepartmentStyle,
    onEachFeature: (feature, layer) => {
      const code = feature.properties.code || feature.properties.CODE_DEPT || feature.properties.insee;
      const deptName = feature.properties.nom || feature.properties.NOM_DEPT || `Département ${code}`;

      layer.on({
        mouseover: (e) => {
          const l = e.target;
          l.setStyle({ weight: 2.5, color: '#FFF', fillOpacity: 0.95 });
          l.bringToFront();

          let count = 0;
          let extraInfo = '';
          if (state.activeMode === 'sector' && state.selectedSector) {
            count = state.selectedSector.departments[code] || 0;
            extraInfo = `<div class="tooltip-count">Activité: <b>${count.toLocaleString('fr-FR')}</b></div>`;
          } else {
            const dept = state.departmentsMap[code];
            count = dept ? dept.total : 0;
            extraInfo = `<div class="tooltip-count">Établissements: <b>${count.toLocaleString('fr-FR')}</b> (${dept ? dept.geocoded_pct : 0}% géocodés)</div>`;
          }

          layer.bindTooltip(`
            <div class="custom-tooltip">
              <div class="tooltip-title">${deptName} (${code})</div>
              ${extraInfo}
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
  document.getElementById('legendMid').textContent = Math.round(maxVal / 2).toLocaleString('fr-FR');
  document.getElementById('legendMax').textContent = maxVal.toLocaleString('fr-FR');
}

/* ==========================================================================
   UI Event Bindings & Interactions
   ========================================================================== */
function bindUIEvents() {
  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      const targetPane = btn.dataset.tab === 'sectors' ? 'paneSectors' : 'paneDepartments';
      document.getElementById(targetPane).classList.add('active');
    });
  });

  // Search Filter
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    if (state.activeTab === 'sectors') {
      renderSectorsList();
    } else {
      renderDepartmentsList();
    }
  });

  // Territory Pills
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeTerritory = pill.dataset.territory;

      if (pill.dataset.territory === 'metro') {
        map.fitBounds(BOUNDS.metro);
      } else if (pill.dataset.territory === 'all') {
        map.setView([46.6, 2.0], 6);
      } else if (pill.dataset.territory === 'dom') {
        map.fitBounds(BOUNDS['971']);
      }
    });
  });

  // DOM Chips Click
  document.querySelectorAll('.dom-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const deptCode = chip.dataset.dept;
      if (BOUNDS[deptCode]) {
        map.fitBounds(BOUNDS[deptCode], { maxZoom: 10 });
      }
      selectDepartment(deptCode);
    });
  });

  // Reset Button
  document.getElementById('btnReset').addEventListener('click', resetSelection);

  // Close Inspector Button
  document.getElementById('btnCloseInspector').addEventListener('click', () => {
    document.getElementById('inspectorCard').style.display = 'none';
    state.selectedDepartment = null;
    updateMapChoropleth();
  });
}

/* ==========================================================================
   List Renderers: Sectors & Departments
   ========================================================================== */
function renderSectorsList() {
  const container = document.getElementById('sectorsList');
  const filtered = state.sectors.filter(s => {
    if (!state.searchQuery) return true;
    return s.code.toLowerCase().includes(state.searchQuery) ||
           s.label.toLowerCase().includes(state.searchQuery);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state">Aucun secteur correspondant trouvé.</div>`;
    return;
  }

  const maxCount = state.sectors.length > 0 ? state.sectors[0].total : 1;

  container.innerHTML = filtered.map(s => {
    const isSelected = state.selectedSector && state.selectedSector.code_naf === s.code;
    const barWidth = Math.max(Math.round((s.total / maxCount) * 100), 2);

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" onclick="selectSector('${s.code}')">
        <div class="item-row-top">
          <div class="item-title-group">
            <span class="badge-code">${s.code}</span>
            <span class="item-name" title="${s.label}">${s.label}</span>
          </div>
          <span class="item-count">${s.total.toLocaleString('fr-FR')}</span>
        </div>
        <div class="item-bar-bg">
          <div class="item-bar-fill" style="width: ${barWidth}%"></div>
        </div>
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
    container.innerHTML = `<div class="loading-state">Aucun département correspondant trouvé.</div>`;
    return;
  }

  const maxCount = state.departments.length > 0 ? state.departments[0].total : 1;

  container.innerHTML = filtered.map(d => {
    const isSelected = state.selectedDepartment && state.selectedDepartment.code === d.code;
    const barWidth = Math.max(Math.round((d.total / maxCount) * 100), 2);

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" onclick="selectDepartment('${d.code}')">
        <div class="item-row-top">
          <div class="item-title-group">
            <span class="badge-code">${d.code}</span>
            <span class="item-name">${d.name}</span>
          </div>
          <span class="item-count">${d.total.toLocaleString('fr-FR')}</span>
        </div>
        <div class="item-bar-bg">
          <div class="item-bar-fill" style="width: ${barWidth}%; background: linear-gradient(90deg, #10B981, #38BDF8)"></div>
        </div>
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

    // Update Title Toolbar
    document.getElementById('mapViewTitle').textContent = `Répartition : ${data.code_naf} — ${data.label}`;
    document.getElementById('mapViewSubtitle').textContent = `Total national : ${data.total_national.toLocaleString('fr-FR')} établissements actifs`;

    // Update Inspector
    const inspector = document.getElementById('inspectorCard');
    inspector.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Secteur d\'Activité Sélectionné';
    document.getElementById('inspectorTitle').textContent = `${data.code_naf} — ${data.label}`;
    document.getElementById('inspectorCount').textContent = data.total_national.toLocaleString('fr-FR');
    document.getElementById('inspectorGeocoded').textContent = `${Object.keys(data.departments).length} Dépts`;

    // Sort Top Departments for this Sector
    const topDepts = Object.entries(data.departments)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top: 6px; font-weight: 600; color: #94A3B8; font-size: 0.74rem;">Top 5 Départements :</div>
      ${topDepts.map(([code, cnt]) => {
        const deptName = state.departmentsMap[code] ? state.departmentsMap[code].name : `Dépt ${code}`;
        return `
          <div class="sub-sector-item">
            <span><b class="sub-sector-code">${code}</b> ${deptName}</span>
            <span style="font-weight: 700; color: #38BDF8">${cnt.toLocaleString('fr-FR')}</span>
          </div>
        `;
      }).join('')}
    `;

    renderSectorsList();
    updateMapChoropleth();
  } catch (err) {
    console.error('Error selecting sector:', err);
  }
}

async function selectDepartment(deptCode) {
  try {
    const res = await fetch(`/api/department/${deptCode}`);
    const data = await res.json();
    state.selectedDepartment = data;

    // Update Inspector
    const inspector = document.getElementById('inspectorCard');
    inspector.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Département Sélectionné';
    document.getElementById('inspectorTitle').textContent = `${data.name} (${data.code})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('fr-FR');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    // Top sectors in this department
    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top: 6px; font-weight: 600; color: #94A3B8; font-size: 0.74rem;">Top 5 Activités Locales :</div>
      ${data.top_sectors.slice(0, 5).map(s => `
        <div class="sub-sector-item">
          <span title="${s.label}"><b class="sub-sector-code">${s.code_naf}</b> ${s.label.substring(0, 26)}...</span>
          <span style="font-weight: 700; color: #10B981">${s.count.toLocaleString('fr-FR')} (${s.pct}%)</span>
        </div>
      `).join('')}
    `;

    renderDepartmentsList();
    updateMapChoropleth();
  } catch (err) {
    console.error('Error selecting department:', err);
  }
}

function resetSelection() {
  state.activeMode = 'density';
  state.selectedSector = null;
  state.selectedDepartment = null;
  state.searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('inspectorCard').style.display = 'none';

  document.getElementById('mapViewTitle').textContent = 'Densité Nationale des Établissements';
  document.getElementById('mapViewSubtitle').textContent = 'Survolez un département pour afficher les détails';

  map.setView([46.603354, 1.888334], 6);
  renderSectorsList();
  renderDepartmentsList();
  updateMapChoropleth();
}
