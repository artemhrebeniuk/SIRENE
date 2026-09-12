/**
 * SIRENE GeoData Observatory — Client Application
 * Powered by Leaflet with Genuine Google Maps (Roadmap & Satellite),
 * Official INSEE SIRENE Registry, 96 Departments, 300+ Communes (Cities) & NAF 2008 (738 codes).
 */

// Application Reactive State
const state = {
  kpis: null,
  departments: [],
  departmentsMap: {}, // code -> dept
  communes: [],
  selectedCommune: null,
  communeMarker: null,
  sectors: [],
  geoJsonData: null,
  geoJsonLayer: null,
  activeMode: 'density', // 'density' or 'sector'
  selectedSector: null,
  selectedDepartment: null,
  activeTab: 'departments', // DEPARTMENTS DEFAULT
  searchQuery: ''
};

// Modal & Pin State
const modalState = {
  dept: '75',
  deptName: 'Paris',
  city: '',
  naf: '',
  query: '',
  offset: 0,
  limit: 50,
  total: 0,
  loadedCount: 0,
  citiesList: [],
  nichesList: [],
  isLoading: false
};

// Map & Basemap Layers
let map;
let currentBizMarker = null;
let searchDebounceTimer = null;
let activeBasemapKey = 'google-roads';

const BASEMAPS = {
  'google-roads': L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    attribution: '&copy; Google Maps'
  }),
  'google-satellite': L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    attribution: '&copy; Google Maps Satellite'
  }),
  'esri-dark': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
    attribution: '&copy; Esri, HERE | INSEE SIRENE'
  })
};

// Lifecycle Start
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  bindUI();
  await loadKPIs();
  await Promise.all([loadGeoJSON(), loadDepartments(), loadCommunes(), loadSectors()]);
  updateChoropleth();
});

/* ==========================================================================
   Map Initialization with Genuine Google Maps Basemap
   ========================================================================== */
function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334], // Center of Mainland France
    zoom: 6,
    minZoom: 4,
    maxZoom: 20,
    zoomControl: true
  });

  // Add Google Maps Roadmap as default basemap
  BASEMAPS['google-roads'].addTo(map);
}

function switchBasemap(key) {
  if (!BASEMAPS[key] || key === activeBasemapKey) return;
  
  map.removeLayer(BASEMAPS[activeBasemapKey]);
  BASEMAPS[key].addTo(map);
  activeBasemapKey = key;

  if (state.geoJsonLayer) {
    state.geoJsonLayer.bringToFront();
    state.geoJsonLayer.setStyle(getFeatureStyle);
  }
  if (currentBizMarker && typeof currentBizMarker.bringToFront === 'function') {
    currentBizMarker.bringToFront();
  }

  document.querySelectorAll('.btn-basemap').forEach(b => {
    b.classList.toggle('active', b.dataset.basemap === key);
  });
}

// Dynamic Color Gradient for Business Density
function getChoroplethColor(value, maxVal) {
  if (!value || value === 0 || maxVal === 0) return '#1E293B';
  const ratio = Math.min(value / maxVal, 1.0);
  
  if (ratio > 0.70) return '#DC2626'; // Red / Highest Density (Paris, Lyon, Marseille)
  if (ratio > 0.40) return '#D97706'; // Amber
  if (ratio > 0.15) return '#0284C7'; // Cyan
  if (ratio > 0.04) return '#2563EB'; // Blue
  return '#1E3A8A';                   // Deep Blue
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
  const isGoogle = activeBasemapKey.startsWith('google');
  const baseOpacity = isGoogle ? 0.28 : 0.72;
  const selectOpacity = isGoogle ? 0.45 : 0.90;

  return {
    fillColor: getChoroplethColor(val, maxVal),
    weight: isSelected ? 3 : 1.2,
    opacity: 1,
    color: isSelected ? '#38BDF8' : (isGoogle ? '#1E293B' : '#475569'),
    fillOpacity: isSelected ? selectOpacity : baseOpacity
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
    document.getElementById('kpiDepartments').textContent = `${data.distinct_departments} / 96`;
    document.getElementById('kpiNafCodes').textContent = data.distinct_naf_codes.toLocaleString('en-US');
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

async function loadCommunes() {
  try {
    const res = await fetch('/api/communes');
    state.communes = await res.json();
    renderCommunesList();
  } catch (err) {
    console.error('Failed to load communes:', err);
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
   Choropleth Rendering & Department Hover / Click
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
          l.setStyle({ weight: 2.5, color: '#38BDF8', fillOpacity: 0.65 });
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
  // Basemap Switcher Buttons
  document.querySelectorAll('.btn-basemap').forEach(btn => {
    btn.addEventListener('click', () => {
      switchBasemap(btn.dataset.basemap);
    });
  });

  // Tab Switching (Departments, Communes, Sectors)
  document.querySelectorAll('.tab-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-trigger').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      
      const paneMap = {
        'departments': 'paneDepartments',
        'communes': 'paneCommunes',
        'sectors': 'paneSectors'
      };
      const target = paneMap[btn.dataset.tab] || 'paneDepartments';
      document.getElementById(target).classList.add('active');
      
      const searchInput = document.getElementById('searchInput');
      if (state.activeTab === 'departments') {
        searchInput.placeholder = 'Search department (e.g. Paris, Rhône, 13)...';
      } else if (state.activeTab === 'communes') {
        searchInput.placeholder = 'Search commune / city (e.g. Lyon, Nice, Bordeaux)...';
      } else {
        searchInput.placeholder = 'Search industry (e.g. Software, Restaurant, 62.01)...';
      }
    });
  });

  // Main Search Input
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearch');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    clearBtn.style.display = state.searchQuery ? 'block' : 'none';

    if (state.activeTab === 'departments') {
      renderDepartmentsList();
    } else if (state.activeTab === 'communes') {
      renderCommunesList();
    } else {
      renderSectorsList();
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.style.display = 'none';
    renderDepartmentsList();
    renderCommunesList();
    renderSectorsList();
  });

  // Reset View
  document.getElementById('btnReset').addEventListener('click', resetAll);

  // Close Inspector Drawer
  document.getElementById('btnCloseInspector').addEventListener('click', () => {
    document.getElementById('inspectorDrawer').style.display = 'none';
    state.selectedDepartment = null;
    state.selectedCommune = null;
    if (state.communeMarker) {
      map.removeLayer(state.communeMarker);
      state.communeMarker = null;
    }
    updateChoropleth();
  });

  // Open Business Modal from Drawer
  document.getElementById('btnOpenBizModal').addEventListener('click', () => {
    if (state.selectedCommune) {
      openBusinessModal(state.selectedCommune.dept, state.selectedCommune.city, state.selectedCommune.city);
    } else if (state.selectedDepartment) {
      openBusinessModal(state.selectedDepartment.code, state.selectedDepartment.name);
    } else {
      const topDept = state.departments[0] || { code: '75', name: 'Paris' };
      openBusinessModal(topDept.code, topDept.name);
    }
  });

  // Modal Close
  document.getElementById('btnCloseBizModal').addEventListener('click', () => {
    document.getElementById('bizModal').style.display = 'none';
  });

  // Close modal when clicking backdrop
  document.getElementById('bizModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('bizModal')) {
      document.getElementById('bizModal').style.display = 'none';
    }
  });

  // Live Search inside Business Directory
  const bizSearchInput = document.getElementById('bizSearchInput');
  bizSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      modalState.query = e.target.value.trim();
      modalState.offset = 0;
      fetchAndRenderBusinesses(false);
    }, 280);
  });

  // Niche / Industry Dropdown Filter
  const bizNafSelect = document.getElementById('bizNafSelect');
  if (bizNafSelect) {
    bizNafSelect.addEventListener('change', (e) => {
      modalState.naf = e.target.value;
      modalState.offset = 0;
      fetchAndRenderBusinesses(false);
    });
  }

  // Load More Button
  const loadMoreBtn = document.getElementById('btnLoadMoreBiz');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      loadMoreBusinesses();
    });
  }

  // Infinite Scroll on Business Table Container
  const tableContainer = document.getElementById('bizTableContainer');
  if (tableContainer) {
    tableContainer.addEventListener('scroll', () => {
      if (tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight - 120) {
        loadMoreBusinesses();
      }
    });
  }
}

/* ==========================================================================
   List Renderers
   ========================================================================== */
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

function renderCommunesList() {
  const container = document.getElementById('communesList');
  const filtered = state.communes.filter(c => {
    if (!state.searchQuery) return true;
    return c.city.toLowerCase().includes(state.searchQuery) ||
           c.dept.toLowerCase().includes(state.searchQuery);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state">No matching communes found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const isSelected = state.selectedCommune && state.selectedCommune.city === c.city && state.selectedCommune.dept === c.dept;

    return `
      <div class="entity-row ${isSelected ? 'selected' : ''}" onclick="selectCommune('${escapeStr(c.city)}', '${c.dept}', ${c.lat}, ${c.lng})">
        <div class="entity-info">
          <span class="code-tag">${c.dept}</span>
          <span class="entity-name">${c.city}</span>
        </div>
        <span class="entity-value">${c.total.toLocaleString('en-US')}</span>
      </div>
    `;
  }).join('');
}

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

/* ==========================================================================
   Department, Commune & Industry Selections
   ========================================================================== */
async function selectDepartment(deptCode) {
  try {
    const [deptRes, citiesRes] = await Promise.all([
      fetch(`/api/department/${deptCode}`),
      fetch(`/api/department/${deptCode}/cities`)
    ]);

    const data = await deptRes.json();
    const cities = await citiesRes.json();

    state.selectedDepartment = data;
    state.selectedCommune = null;
    modalState.dept = deptCode;
    modalState.deptName = data.name;
    modalState.city = '';
    modalState.citiesList = cities;

    // Reset commune marker if any
    if (state.communeMarker) {
      map.removeLayer(state.communeMarker);
      state.communeMarker = null;
    }

    // Update Overlay Header
    document.getElementById('mapViewTitle').textContent = `${data.name} (${data.code})`;
    document.getElementById('mapViewSubtitle').textContent = `${data.total.toLocaleString('en-US')} active establishments • ${data.geocoded_pct}% geocoded`;

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Selected Department';
    document.getElementById('inspectorTitle').textContent = `${data.name} (${data.code})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    const exploreBtn = document.getElementById('btnOpenBizModal');
    exploreBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
      Browse Individual Businesses
    `;

    // Render Top Cities & Top Industries in Inspector
    const citiesPills = cities.slice(0, 6).map(c => 
      `<span class="city-pill" onclick="openBusinessModal('${deptCode}', '${data.name}', '${escapeStr(c.city)}')">${c.city} (${c.total.toLocaleString('en-US')})</span>`
    ).join('');

    const industriesList = data.top_sectors.slice(0, 4).map(s => `
      <div class="breakdown-row" onclick="selectSector('${s.code_naf}')">
        <span title="${s.label}"><b class="breakdown-code">${s.code_naf}</b> ${s.label.substring(0, 22)}...</span>
        <span style="font-weight:700; color:#10B981">${s.count.toLocaleString('en-US')} (${s.pct}%)</span>
      </div>
    `).join('');

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top:6px;">
        <div style="font-weight:600; color:#94A3B8; margin-bottom:4px; font-size:0.68rem; text-transform:uppercase;">Top Communes / Cities:</div>
        <div style="display:flex; flex-wrap:wrap; gap:3px; margin-bottom:8px;">${citiesPills}</div>
      </div>
      <div>
        <div style="font-weight:600; color:#94A3B8; margin-bottom:4px; font-size:0.68rem; text-transform:uppercase;">Top Industries:</div>
        ${industriesList}
      </div>
    `;

    zoomToDepartment(deptCode);
    renderDepartmentsList();
    updateChoropleth();
  } catch (err) {
    console.error('Error selecting department:', err);
  }
}

async function selectCommune(cityName, deptCode, lat, lng) {
  try {
    const res = await fetch(`/api/commune/${encodeURIComponent(cityName)}?dept=${deptCode}`);
    const data = await res.json();
    state.selectedCommune = data;
    state.selectedDepartment = null;

    modalState.dept = deptCode;
    modalState.deptName = data.city;
    modalState.city = data.city;

    // Update Overlay Header
    document.getElementById('mapViewTitle').textContent = `${data.city} (Dept ${data.dept})`;
    document.getElementById('mapViewSubtitle').textContent = `${data.total.toLocaleString('en-US')} active establishments • ${data.geocoded_pct}% geocoded`;

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Selected Commune / City';
    document.getElementById('inspectorTitle').textContent = `${data.city} (${data.dept})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    const exploreBtn = document.getElementById('btnOpenBizModal');
    exploreBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
      Browse Businesses in ${data.city}
    `;

    const industriesList = data.top_sectors.map(s => `
      <div class="breakdown-row" onclick="openBusinessModal('${data.dept}', '${data.city}', '${data.city}', '${s.code_naf}')">
        <span title="${s.label}"><b class="breakdown-code">${s.code_naf}</b> ${s.label.substring(0, 22)}...</span>
        <span style="font-weight:700; color:#10B981">${s.count.toLocaleString('en-US')} (${s.pct}%)</span>
      </div>
    `).join('');

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top:6px;">
        <div style="font-weight:600; color:#94A3B8; margin-bottom:4px; font-size:0.68rem; text-transform:uppercase;">Top Industries in ${data.city}:</div>
        ${industriesList}
      </div>
    `;

    // Fly to city center on Google Maps with pulse marker
    if (lat && lng) {
      if (state.communeMarker) {
        map.removeLayer(state.communeMarker);
      }
      state.communeMarker = L.circleMarker([lat, lng], {
        radius: 12,
        fillColor: '#38BDF8',
        color: '#FFFFFF',
        weight: 2.5,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map);

      map.flyTo([lat, lng], 13, { duration: 1.2 });
    }

    renderCommunesList();
  } catch (err) {
    console.error('Error selecting commune:', err);
  }
}

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

    const topDepts = Object.entries(data.departments)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="font-weight:600; color:#94A3B8; margin-top:4px; font-size:0.68rem; text-transform:uppercase;">Top Regional Concentrations:</div>
      ${topDepts.map(([code, count]) => {
        const name = state.departmentsMap[code] ? state.departmentsMap[code].name : `Dept ${code}`;
        return `
          <div class="breakdown-row" onclick="selectDepartment('${code}')">
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

function zoomToDepartment(deptCode) {
  if (!state.geoJsonLayer) return;
  state.geoJsonLayer.eachLayer(layer => {
    const code = layer.feature.properties.code || layer.feature.properties.CODE_DEPT || layer.feature.properties.insee;
    if (code === deptCode) {
      map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 10 });
    }
  });
}

/* ==========================================================================
   Business Directory Modal & City/Niche Breakdown (Infinite List)
   ========================================================================== */
async function openBusinessModal(deptCode, deptName, initialCity = '', initialNaf = '') {
  modalState.dept = deptCode;
  modalState.deptName = deptName;
  modalState.city = initialCity;
  modalState.naf = initialNaf;
  modalState.query = '';
  modalState.offset = 0;
  modalState.limit = 50; // Always explicitly set
  modalState.loadedCount = 0;
  modalState.isLoading = false;

  const modal = document.getElementById('bizModal');
  modal.style.display = 'flex';

  document.getElementById('bizModalPill').textContent = `Department ${deptCode}`;
  document.getElementById('bizModalTitle').textContent = `Registered Businesses in ${deptName}`;
  document.getElementById('bizSearchInput').value = '';

  try {
    const [citiesRes, nichesRes] = await Promise.all([
      fetch(`/api/department/${deptCode}/cities`),
      fetch(`/api/department/${deptCode}/niches`)
    ]);

    modalState.citiesList = await citiesRes.json();
    modalState.nichesList = await nichesRes.json();

    renderCityChips();
    renderNicheSelect();
  } catch (err) {
    console.error('Failed to load filter metadata for modal:', err);
  }

  fetchAndRenderBusinesses(false);
}

function renderCityChips() {
  const container = document.getElementById('cityChipsContainer');
  
  let html = `
    <button class="city-chip ${!modalState.city ? 'active' : ''}" onclick="setModalCity('')">
      All Cities (${modalState.citiesList.reduce((acc, c) => acc + c.total, 0).toLocaleString('en-US')})
    </button>
  `;

  modalState.citiesList.slice(0, 12).forEach(c => {
    const isActive = modalState.city.toUpperCase() === c.city.toUpperCase();
    html += `
      <button class="city-chip ${isActive ? 'active' : ''}" onclick="setModalCity('${escapeStr(c.city)}')">
        ${c.city} (${c.total.toLocaleString('en-US')})
      </button>
    `;
  });

  container.innerHTML = html;
}

function renderNicheSelect() {
  const select = document.getElementById('bizNafSelect');
  
  let html = `<option value="">All Niches & Industries (${modalState.nichesList.length} top sectors)</option>`;
  
  modalState.nichesList.forEach(n => {
    const isSelected = modalState.naf === n.code ? 'selected' : '';
    const labelShort = n.label.length > 45 ? n.label.substring(0, 45) + '...' : n.label;
    html += `
      <option value="${n.code}" ${isSelected}>
        [${n.code}] ${labelShort} (${n.total.toLocaleString('en-US')})
      </option>
    `;
  });

  select.innerHTML = html;
}

function setModalCity(cityName) {
  modalState.city = cityName;
  modalState.offset = 0;
  modalState.limit = 50;
  renderCityChips();
  fetchAndRenderBusinesses(false);
}

function updateExportLink() {
  const exportBtn = document.getElementById('btnExportBizCsv');
  if (!exportBtn) return;
  const params = new URLSearchParams({
    dept: modalState.dept,
    city: modalState.city,
    naf: modalState.naf,
    q: modalState.query
  });
  exportBtn.href = `/api/businesses/export?${params.toString()}`;
}

async function fetchAndRenderBusinesses(append = false) {
  if (modalState.isLoading) return;
  modalState.isLoading = true;

  const tbody = document.getElementById('bizTableBody');
  const loadMoreBtn = document.getElementById('btnLoadMoreBiz');

  updateExportLink();

  if (!append) {
    modalState.offset = 0;
    modalState.loadedCount = 0;
    modalState.limit = modalState.limit || 50;
    tbody.innerHTML = `<tr><td colspan="5" class="loading-state">Querying French National Registry...</td></tr>`;
  } else {
    loadMoreBtn.textContent = 'Loading more establishments...';
  }

  try {
    const limitVal = modalState.limit || 50;
    const offsetVal = modalState.offset || 0;
    let url = `/api/businesses?dept=${modalState.dept}&limit=${limitVal}&offset=${offsetVal}`;
    if (modalState.city) {
      url += `&city=${encodeURIComponent(modalState.city)}`;
    }
    if (modalState.naf) {
      url += `&naf=${encodeURIComponent(modalState.naf)}`;
    }
    if (modalState.query) {
      url += `&q=${encodeURIComponent(modalState.query)}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();

    modalState.total = data.total;
    modalState.loadedCount += data.items.length;

    document.getElementById('bizCountSummary').textContent = 
      `Showing ${modalState.loadedCount.toLocaleString('en-US')} of ${modalState.total.toLocaleString('en-US')} total establishments`;

    if (modalState.loadedCount >= modalState.total) {
      loadMoreBtn.textContent = `All ${modalState.total.toLocaleString('en-US')} Businesses Loaded`;
      loadMoreBtn.disabled = true;
      loadMoreBtn.style.opacity = '0.5';
    } else {
      loadMoreBtn.textContent = `Load More Businesses (+50)`;
      loadMoreBtn.disabled = false;
      loadMoreBtn.style.opacity = '1';
    }

    if (data.items.length === 0 && !append) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading-state">No matching businesses found in this niche / city.</td></tr>`;
      modalState.isLoading = false;
      return;
    }

    const rowsHtml = data.items.map(b => {
      const pinBtn = b.has_gps ? `
        <div style="display:flex; flex-direction:column; gap:4px;">
          <button class="btn-map-pin" onclick="pinBusinessOnMap('${b.siret}', ${b.lat}, ${b.lng}, '${escapeStr(b.name)}', '${escapeStr(b.postal_code || '')} ${escapeStr(b.city || '')}', '${b.naf_code}', '${escapeStr(b.naf_label)}', '${escapeStr(b.naf_label_fr || '')}', '${escapeStr(b.google_maps_url || '')}', '${escapeStr(b.gov_verify_url)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            Show on Map
          </button>
          <a href="${b.google_maps_url}" target="_blank" class="btn-google-ext" title="Open directly in Google Maps with Street View">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            Google Maps
          </a>
        </div>
      ` : `<span class="text-dim" style="font-size:0.7rem;">No GPS</span>`;

      return `
        <tr>
          <td class="biz-name-cell">
            <div style="font-size:0.84rem; font-weight:700;">${b.name}</div>
            ${b.enseigne && b.enseigne !== b.name ? `<div style="font-size:0.68rem; color:#94A3B8;">Sign: ${b.enseigne}</div>` : ''}
          </td>
          <td class="biz-siret-cell">
            <div>${b.siret}</div>
            <a href="${b.gov_verify_url}" target="_blank" class="btn-gov-verify" title="Official French Government Certificate on data.gouv.fr">
              Verify Gouv ↗
            </a>
          </td>
          <td>
            <div style="font-weight:600; color:#F8FAFC;">${b.city || 'N/A'}</div>
            <div style="font-size:0.68rem; color:#94A3B8;">${b.postal_code || ''}</div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:5px;">
              <span class="badge-naf">${b.naf_code}</span>
              <span style="font-weight:600; color:#F1F5F9; font-size:0.74rem;">${b.naf_label}</span>
            </div>
            ${b.naf_label_fr ? `<div style="font-size:0.68rem; color:#94A3B8; margin-top:2px;">FR: ${b.naf_label_fr}</div>` : ''}
          </td>
          <td>${pinBtn}</td>
        </tr>
      `;
    }).join('');

    if (append) {
      tbody.insertAdjacentHTML('beforeend', rowsHtml);
    } else {
      tbody.innerHTML = rowsHtml;
    }

  } catch (err) {
    console.error('Error fetching businesses:', err);
    if (!append) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading-state">Error loading businesses: ${escapeStr(err.message)}</td></tr>`;
    }
  } finally {
    modalState.isLoading = false;
  }
}

function loadMoreBusinesses() {
  if (modalState.isLoading || modalState.loadedCount >= modalState.total) return;
  modalState.offset += (modalState.limit || 50);
  fetchAndRenderBusinesses(true);
}

/* ==========================================================================
   Pin Individual Business on Genuine Google Map
   ========================================================================== */
function pinBusinessOnMap(siret, lat, lng, name, address, nafCode, nafLabel, nafLabelFr, googleUrl, govUrl) {
  document.getElementById('bizModal').style.display = 'none';

  if (currentBizMarker) {
    map.removeLayer(currentBizMarker);
  }

  const icon = L.divIcon({
    className: 'custom-biz-pin',
    html: '<div class="pin-pulse"></div><div class="pin-dot"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  currentBizMarker = L.marker([lat, lng], { icon: icon }).addTo(map);

  currentBizMarker.bindPopup(`
    <div class="biz-popup">
      <div class="biz-popup-tag">Selected Establishment</div>
      <div class="biz-popup-title">${name}</div>
      <div class="biz-popup-sub">SIRET: <code>${siret}</code></div>
      <div class="biz-popup-sub">Location: <b>${address}</b></div>
      <div class="biz-popup-badge">${nafCode} • ${nafLabel}</div>
      ${nafLabelFr ? `<div style="font-size:0.67rem; color:#94A3B8; margin-top:3px;">FR: ${nafLabelFr}</div>` : ''}
      
      <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
        <a href="${googleUrl}" target="_blank" class="btn-google-ext" style="display:flex; align-items:center; justify-content:center; padding:5px 8px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          Open in Google Maps (Street View)
        </a>
        <a href="${govUrl}" target="_blank" class="btn-gov-verify" style="display:flex; align-items:center; justify-content:center;">
          Official French Gov Registry ↗
        </a>
      </div>
    </div>
  `, {
    offset: [0, -8],
    maxWidth: 300
  }).openPopup();

  map.flyTo([lat, lng], 17, { duration: 1.2 });
}

/* ==========================================================================
   Reset All
   ========================================================================== */
function resetAll() {
  state.activeMode = 'density';
  state.selectedSector = null;
  state.selectedDepartment = null;
  state.selectedCommune = null;
  state.searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearch').style.display = 'none';
  document.getElementById('inspectorDrawer').style.display = 'none';

  if (currentBizMarker) {
    map.removeLayer(currentBizMarker);
    currentBizMarker = null;
  }

  if (state.communeMarker) {
    map.removeLayer(state.communeMarker);
    state.communeMarker = null;
  }

  document.getElementById('mapViewTitle').textContent = 'National Business Density (Mainland France)';
  document.getElementById('mapViewSubtitle').textContent = 'Hover over any department or click to inspect its cities & businesses';

  map.setView([46.603354, 1.888334], 6);
  renderDepartmentsList();
  renderCommunesList();
  renderSectorsList();
  updateChoropleth();
}

// Utility Helper to prevent XSS / quote issues
function escapeStr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
