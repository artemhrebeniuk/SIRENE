/**
 * SIRENE GeoData Observatory — Client Application
 * Powered by Leaflet with Genuine Google Maps (Roadmap & Satellite),
 * Official INSEE SIRENE Registry, 96 Departments, 300+ Communes (Cities) & NAF 2008 (738 codes).
 */

/* ==========================================================================
   SIRENE Enterprise Client-Side Logging Engine
   Provides structured diagnostics, timing, network observability, and error tracking.
   ========================================================================== */
const SireneLogger = (() => {
  const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };
  let currentLevel = LOG_LEVELS.DEBUG;
  const history = [];
  const MAX_HISTORY = 1000;

  const COLORS = {
    INIT: 'color: #d0bcff; font-weight: bold;',
    NET: 'color: #38bdf8; font-weight: bold;',
    MAP: 'color: #4ade80; font-weight: bold;',
    FILTER: 'color: #fbbf24; font-weight: bold;',
    MODAL: 'color: #c084fc; font-weight: bold;',
    THEME: 'color: #2dd4bf; font-weight: bold;',
    RADAR: 'color: #f472b6; font-weight: bold;',
    ERROR: 'color: #f87171; font-weight: bold;'
  };

  function record(level, tag, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString('fr-FR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
      level,
      tag,
      message,
      data: data !== undefined ? (typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data) : null
    };
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
    return entry;
  }

  function log(levelStr, tag, message, ...extra) {
    const lvl = LOG_LEVELS[levelStr] ?? LOG_LEVELS.INFO;
    if (lvl < currentLevel) return;

    const entry = record(levelStr, tag, message, extra.length > 0 ? extra : undefined);
    const colorStyle = COLORS[tag] || 'color: #94a3b8; font-weight: bold;';
    const tagFmt = `%c[${entry.timeFormatted}] [SIRENE:${tag}]%c ${message}`;
    const tagCss = colorStyle;
    const bodyCss = 'color: inherit; font-weight: normal;';

    if (levelStr === 'ERROR') {
      console.error(tagFmt, tagCss, bodyCss, ...extra);
    } else if (levelStr === 'WARN') {
      console.warn(tagFmt, tagCss, bodyCss, ...extra);
    } else if (levelStr === 'DEBUG') {
      console.debug(tagFmt, tagCss, bodyCss, ...extra);
    } else {
      console.log(tagFmt, tagCss, bodyCss, ...extra);
    }
  }

  // Global unhandled error interception
  window.addEventListener('error', (event) => {
    log('ERROR', 'ERROR', `Unhandled Window Error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`, event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    log('ERROR', 'ERROR', `Unhandled Promise Rejection: ${event.reason?.message || event.reason}`, event.reason);
  });

  return {
    debug: (tag, msg, ...args) => log('DEBUG', tag, msg, ...args),
    info: (tag, msg, ...args) => log('INFO', tag, msg, ...args),
    warn: (tag, msg, ...args) => log('WARN', tag, msg, ...args),
    error: (tag, msg, ...args) => log('ERROR', tag, msg, ...args),
    setLevel: (lvl) => { currentLevel = LOG_LEVELS[lvl.toUpperCase()] ?? LOG_LEVELS.INFO; },
    getHistory: () => [...history],
    exportLogs: () => {
      const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sirene-client-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
    }
  };
})();

window.SireneLogger = SireneLogger;
window.exportSireneLogs = SireneLogger.exportLogs;

/**
 * Universal Instrumented Fetch Wrapper with latency timing and diagnostic error reporting.
 */
async function apiFetch(url, options = {}) {
  const start = performance.now();
  const method = (options.method || 'GET').toUpperCase();
  SireneLogger.debug('NET', `--> ${method} ${url}`);
  try {
    const res = await fetch(url, options);
    const duration = (performance.now() - start).toFixed(1);
    if (!res.ok) {
      const errText = await res.clone().text().catch(() => '');
      SireneLogger.error('NET', `<-- ${method} ${url} HTTP ${res.status} (${duration}ms): ${errText.substring(0, 150)}`);
      throw new Error(`HTTP ${res.status} on ${url}`);
    }
    SireneLogger.info('NET', `<-- ${method} ${url} ${res.status} (${duration}ms)`);
    return res;
  } catch (err) {
    const duration = (performance.now() - start).toFixed(1);
    SireneLogger.error('NET', `[FAIL] ${method} ${url} after ${duration}ms: ${err.message}`, err);
    throw err;
  }
}

// Application Reactive State
const state = {
  kpis: null,
  departments: [],
  departmentsMap: {}, // code -> dept
  communes: [],
  selectedCommune: null,
  communeMarker: null,
  sectors: [],
  nafVersion: '2008', // '2008' or '2025'
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

// Operational Layers State (Regions, Traffic, Crowd Hotspots, Parking Radar)
let isRegionsActive = true;
let isTrafficActive = false;
let isCrowdActive = false;
let isParkingRadarActive = false;
let activeParkingRadius = 300;
let activeParkingTarget = null;

let trafficTileLayer = null;
let parkingLayerGroup = null;
let parkingRadiusCircle = null;
let crowdLayerGroup = null;
let businessMarkersLayerGroup = null;
let viewportBizDebounce = null;

// Map & Basemap Layers
let map;
let currentBizMarker = null;
let searchDebounceTimer = null;

// High-Resolution @2x Retina Basemaps for Crystal Clear Geometry on All Screens
const BASEMAPS = {
  'google-roads': L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=fr&x={x}&y={y}&z={z}&scale=2', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    tileSize: 256,
    attribution: '&copy; Google Maps'
  }),
  'google-satellite': L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}&scale=2', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    tileSize: 256,
    attribution: '&copy; Google Maps Satellite'
  })
};

// Lifecycle Start
document.addEventListener('DOMContentLoaded', async () => {
  initM3Theme();
  initMap();
  bindUI();
  await loadKPIs();
  await Promise.all([loadGeoJSON(), loadDepartments(), loadCommunes(), loadSectors()]);
  updateChoropleth();

  // Support direct modal link via ?dept=75&deptName=Paris
  const urlParams = new URLSearchParams(window.location.search);
  const deptParam = urlParams.get('dept');
  if (deptParam) {
    const deptName = urlParams.get('deptName') || (deptParam === '75' ? 'Paris' : `Dept ${deptParam}`);
    setTimeout(() => {
      openBusinessModal(deptParam, deptName);
    }, 300);
  }
});

/* ==========================================================================
   Material 3 Dynamic Theme Manager (Baseline Light & Dark Schemes)
   ========================================================================== */
function initM3Theme() {
  const urlParams = new URLSearchParams(window.location.search);
  const themeParam = urlParams.get('theme');
  const savedTheme = themeParam || localStorage.getItem('sirene_m3_theme') || 'dark';
  applyM3Theme(savedTheme);
}

function toggleM3Theme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyM3Theme(newTheme);
  localStorage.setItem('sirene_m3_theme', newTheme);
}

function applyM3Theme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const darkIcon = document.querySelector('.icon-theme-dark');
  const lightIcon = document.querySelector('.icon-theme-light');
  if (darkIcon && lightIcon) {
    if (theme === 'light') {
      darkIcon.style.display = 'none';
      lightIcon.style.display = 'block';
    } else {
      darkIcon.style.display = 'block';
      lightIcon.style.display = 'none';
    }
  }
}
window.toggleM3Theme = toggleM3Theme;

/* ==========================================================================
   Map Initialization & Basemap Management
   ========================================================================== */
let activeBasemapKey = localStorage.getItem('sirene_basemap_mode');
if (!activeBasemapKey || activeBasemapKey === 'auto' || !BASEMAPS[activeBasemapKey]) {
  activeBasemapKey = 'google-roads';
}

function switchBasemap(key) {
  if (!BASEMAPS[key]) return;
  activeBasemapKey = key;
  localStorage.setItem('sirene_basemap_mode', key);
  applyBasemapLayer(key, true);
  document.querySelectorAll('.btn-basemap').forEach(b => {
    b.classList.toggle('active', b.dataset.basemap === key);
  });
}

function applyBasemapLayer(key, force = false) {
  if (!BASEMAPS[key]) return;
  if (!force && key === activeBasemapKey && map.hasLayer(BASEMAPS[key])) return;
  
  if (map.hasLayer(BASEMAPS[activeBasemapKey])) {
    map.removeLayer(BASEMAPS[activeBasemapKey]);
  }
  BASEMAPS[key].addTo(map);
  activeBasemapKey = key;

  if (isRegionsActive && state.geoJsonLayer && map.hasLayer(state.geoJsonLayer)) {
    state.geoJsonLayer.bringToFront();
    state.geoJsonLayer.setStyle(getFeatureStyle);
  }
  if (trafficTileLayer && isTrafficActive) {
    trafficTileLayer.bringToFront();
  }
  if (crowdHeatLayer && isCrowdActive && map.hasLayer(crowdHeatLayer)) {
    crowdHeatLayer.bringToFront();
  }
  if (businessMarkersLayerGroup) {
    businessMarkersLayerGroup.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
  }
  if (parkingLayerGroup) {
    parkingLayerGroup.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
  }
  if (currentBizMarker && typeof currentBizMarker.bringToFront === 'function') {
    currentBizMarker.bringToFront();
  }
}

function initMap() {
  map = L.map('map', {
    center: [46.603354, 1.888334], // Center of Mainland France
    zoom: 6,
    minZoom: 4,
    maxZoom: 20,
    zoomControl: false // Clean presentation without +/- glitches
  });

  // Apply user-selected basemap or default to Google Maps
  applyBasemapLayer(activeBasemapKey, true);
  document.querySelectorAll('.btn-basemap').forEach(b => {
    b.classList.toggle('active', b.dataset.basemap === activeBasemapKey);
  });

  // Initialize operational layer groups
  parkingLayerGroup = L.layerGroup().addTo(map);
  businessMarkersLayerGroup = L.layerGroup().addTo(map);
  crowdLayerGroup = L.layerGroup();

  // Smart Zoom-Adaptive GIS Listener:
  // Re-evaluates polygon opacity, updates heatmap radius, and fetches live businesses when zooming in
  map.on('zoomend', () => {
    if (isRegionsActive && state.geoJsonLayer && map.hasLayer(state.geoJsonLayer)) {
      state.geoJsonLayer.setStyle(getFeatureStyle);
    }
    updateHeatmapOnZoom();
    handleMapMoveZoom();
  });

  map.on('moveend', () => {
    handleMapMoveZoom();
  });

  // Automatic Container Resize Observer to prevent any unrendered tile gaps or black strips
  const mapElem = document.getElementById('map');
  if (window.ResizeObserver && mapElem) {
    const mapResizeObserver = new ResizeObserver(() => {
      if (map) map.invalidateSize();
    });
    mapResizeObserver.observe(mapElem);
  }
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
}

function handleMapMoveZoom() {
  if (!map) return;
  const zoom = map.getZoom();

  // Dynamic high-precision heatmap update when zoomed in
  if (isCrowdActive && crowdHeatLayer && map.hasLayer(crowdHeatLayer)) {
    clearTimeout(viewportHeatmapDebounce);
    viewportHeatmapDebounce = setTimeout(() => {
      checkViewportHeatmap();
    }, 300);
  }

  if (zoom >= 14) {
    clearTimeout(viewportBizDebounce);
    viewportBizDebounce = setTimeout(() => {
      loadViewportBusinesses();
    }, 350);
  } else {
    // If not inspecting a specific commune/city, clear the viewport markers to keep map clean
    if (!state.selectedCommune && businessMarkersLayerGroup) {
      businessMarkersLayerGroup.clearLayers();
    }
  }
}

// Department Quintiles (Equal Distribution across 96 departments)
let deptQuantiles = { p20: 55000, p40: 85000, p60: 140000, p80: 245000 };

function computeDeptQuantiles() {
  if (!state.departments || state.departments.length === 0) return;
  const totals = state.departments.map(d => d.total).sort((a, b) => a - b);
  const n = totals.length;
  deptQuantiles = {
    p20: totals[Math.floor(n * 0.20)] || 55000,
    p40: totals[Math.floor(n * 0.40)] || 85000,
    p60: totals[Math.floor(n * 0.60)] || 140000,
    p80: totals[Math.floor(n * 0.80)] || 245000
  };
}

// Dynamic Color Gradient for Business Density (Logical Sequential Economic Ramp)
// Avoids discordant "rainbow" patchwork. Moves coherently from calm Cool Blue to Radiant Fuchsia.
function getChoroplethColor(value, maxVal) {
  if (!value || value <= 0) return '#1E293B';

  if (state.activeMode === 'sector' && state.selectedSector) {
    const ratio = maxVal > 0 ? value / maxVal : 0;
    if (ratio > 0.60) return '#F43F5E'; // Tier 1: Peak Commercial Hub
    if (ratio > 0.35) return '#A855F7'; // Tier 2: High Concentration
    if (ratio > 0.18) return '#7C3AED'; // Tier 3: Moderate Concentration
    if (ratio > 0.06) return '#4F46E5'; // Tier 4: Moderate-Low Concentration
    return '#3B82F6';                   // Tier 5: Low Concentration
  }

  // National 5-tier Quintile Scale (Equal Distribution across 96 departments)
  // Progressive sequential ramp: Cool Blue -> Royal Indigo -> Deep Violet -> Rich Purple -> Radiant Fuchsia
  if (value >= deptQuantiles.p80) return '#F43F5E'; // Tier 1: Peak Metropolises (Paris, Lyon, Marseille)
  if (value >= deptQuantiles.p60) return '#A855F7'; // Tier 2: High Regional Hubs (Bordeaux, Toulouse, Nantes)
  if (value >= deptQuantiles.p40) return '#7C3AED'; // Tier 3: Moderate Commercial Hubs
  if (value >= deptQuantiles.p20) return '#4F46E5'; // Tier 4: Moderate-Low Density
  return '#3B82F6';                                 // Tier 5: Sparse / Rural Baseline (<55k)
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
  const currentZoom = map ? map.getZoom() : 6;

  // SMART ZOOM-FADE GIS SYSTEM:
  // - Zoom <= 7 (France Overview): Vibrant, colorful departments with distinct quintiles
  // - Zoom 8 (Regional scale): Gentle fade
  // - Zoom 9 (Department scale): Very soft outline/tint
  // - Zoom >= 10 (City, district & street scale): fillOpacity is ZERO (0.0)!
  //   Leaves Google Maps streets, buildings, labels, and parks 100% natural, crisp, and clean!
  let fillOpacity = 0;
  if (currentZoom <= 7) {
    fillOpacity = isGoogle ? (isSelected ? 0.50 : 0.36) : (isSelected ? 0.75 : 0.55);
  } else if (currentZoom === 8) {
    fillOpacity = isGoogle ? (isSelected ? 0.26 : 0.16) : (isSelected ? 0.45 : 0.25);
  } else if (currentZoom === 9) {
    fillOpacity = isGoogle ? (isSelected ? 0.10 : 0.05) : (isSelected ? 0.20 : 0.08);
  } else {
    fillOpacity = 0;
  }

  // If a business is selected / located or parking radar is active, force fillOpacity to 0
  if (currentBizMarker || activeParkingTarget) {
    fillOpacity = 0;
  }

  // Border: keep delicate hairline border at high zoom, or highlight if selected
  const borderWeight = isSelected ? (currentZoom >= 10 ? 2 : 2.5) : (currentZoom >= 10 ? 0.7 : 1.1);
  const borderColor = isSelected 
    ? '#38BDF8' 
    : (isGoogle ? (currentZoom >= 10 ? 'rgba(56, 189, 248, 0.22)' : '#1E293B') : '#475569');

  return {
    fillColor: getChoroplethColor(val, maxVal),
    weight: borderWeight,
    opacity: currentZoom >= 11 ? (isSelected ? 0.8 : 0.15) : 1,
    color: borderColor,
    fillOpacity: fillOpacity
  };
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */
async function loadKPIs() {
  try {
    const res = await apiFetch('/api/kpis');
    const data = await res.json();
    state.kpis = data;

    SireneLogger.info('INIT', `Loaded KPIs: ${data.total_active_establishments.toLocaleString()} active establishments across ${data.distinct_departments} departments`);

    document.getElementById('kpiTotalActive').textContent = data.total_active_establishments.toLocaleString('en-US');
    const geocodedEl = document.getElementById('kpiGeocodedPct');
    if (geocodedEl) geocodedEl.textContent = `${data.geocoding_rate_pct}%`;
    document.getElementById('kpiDepartments').textContent = `${data.distinct_departments} / 96`;
    const nafCount = (state.nafVersion === '2025' && data.distinct_naf_2025_codes) 
      ? data.distinct_naf_2025_codes 
      : data.distinct_naf_codes;
    document.getElementById('kpiNafCodes').textContent = nafCount.toLocaleString('en-US');
  } catch (err) {
    SireneLogger.error('INIT', `Failed to load KPIs: ${err.message}`, err);
  }
}

async function loadGeoJSON() {
  try {
    const res = await apiFetch('/api/geojson');
    state.geoJsonData = await res.json();
    SireneLogger.info('MAP', `Loaded GeoJSON boundaries: ${state.geoJsonData?.features?.length || 0} department polygons`);
  } catch (err) {
    SireneLogger.error('MAP', `Failed to load GeoJSON: ${err.message}`, err);
  }
}

async function loadDepartments() {
  try {
    const res = await apiFetch('/api/departments');
    state.departments = await res.json();
    state.departmentsMap = {};
    state.departments.forEach(d => {
      state.departmentsMap[d.code] = d;
    });
    computeDeptQuantiles();
    renderDepartmentsList();
    SireneLogger.info('INIT', `Loaded ${state.departments.length} department statistics`);
  } catch (err) {
    SireneLogger.error('INIT', `Failed to load departments: ${err.message}`, err);
  }
}

async function loadCommunes() {
  try {
    const res = await apiFetch('/api/communes');
    state.communes = await res.json();
    renderCommunesList();
    SireneLogger.info('INIT', `Loaded ${state.communes.length} commune centroids`);
  } catch (err) {
    SireneLogger.error('INIT', `Failed to load communes: ${err.message}`, err);
  }
}

async function loadSectors() {
  try {
    const version = state.nafVersion || '2008';
    const res = await apiFetch(`/api/sectors?limit=250&version=${version}`);
    state.sectors = await res.json();
    renderSectorsList();
    SireneLogger.info('INIT', `Loaded ${state.sectors.length} sectors for NAF ${version}`);
  } catch (err) {
    SireneLogger.error('INIT', `Failed to load sectors: ${err.message}`, err);
  }
}

function setNafVersion(ver) {
  if (state.nafVersion === ver) return;
  state.nafVersion = ver;

  const btn08 = document.getElementById('btnNaf2008');
  const btn25 = document.getElementById('btnNaf2025');
  const colHeader = document.getElementById('colHeaderIndustry');

  if (btn08 && btn25) {
    if (ver === '2025') {
      btn08.classList.remove('active');
      btn25.classList.add('active');
      if (colHeader) colHeader.textContent = 'Industry (NAF 2025 Official)';
    } else {
      btn25.classList.remove('active');
      btn08.classList.add('active');
      if (colHeader) colHeader.textContent = 'Industry (NAF 2008)';
    }
  }

  if (state.kpis) {
    const nafEl = document.getElementById('kpiNafCodes');
    if (nafEl) {
      const count = ver === '2025' ? (state.kpis.distinct_naf_2025_codes || state.kpis.distinct_naf_codes) : state.kpis.distinct_naf_codes;
      nafEl.textContent = count.toLocaleString('en-US');
    }
  }

  state.selectedSector = null;
  loadSectors();
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
          const currentZoom = map ? map.getZoom() : 6;
          if (currentZoom >= 10) {
            l.setStyle({ weight: 2, color: '#38BDF8', fillOpacity: 0 });
            return;
          }
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
            details = `<div class="tooltip-body">Total: <b>${count.toLocaleString('en-US')}</b> • ${pct}% geocoded</div>`;
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
  });

  if (isRegionsActive) {
    state.geoJsonLayer.addTo(map);
  }

  updateLegend();
}

function updateLegend() {
  let maxVal = 100;
  if (state.activeMode === 'sector' && state.selectedSector) {
    maxVal = Math.max(...Object.values(state.selectedSector.departments), 1);
  } else if (state.departments.length > 0) {
    maxVal = state.departments[0].total;
  }

  const minEl = document.getElementById('legendMin');
  if (minEl) minEl.textContent = '0';
  const midEl = document.getElementById('legendMid');
  if (midEl) midEl.textContent = Math.round(maxVal / 2).toLocaleString('en-US');
  const maxEl = document.getElementById('legendMax');
  if (maxEl) maxEl.textContent = maxVal.toLocaleString('en-US');
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

  // Operational Layer Toggle Buttons (Regions, Traffic, Crowd Zones, Parking Radar)
  const btnRegions = document.getElementById('btnToggleRegions');
  if (btnRegions) {
    btnRegions.addEventListener('click', toggleRegionsLayer);
  }

  const btnTraffic = document.getElementById('btnToggleTraffic');
  if (btnTraffic) {
    btnTraffic.addEventListener('click', toggleTrafficLayer);
  }

  const btnCrowd = document.getElementById('btnToggleCrowd');
  if (btnCrowd) {
    btnCrowd.addEventListener('click', toggleCrowdHeatmap);
  }

  // Heatmap Radius Control Chips
  document.querySelectorAll('#heatmapRadiusGroup .segment-btn, #heatmapRadiusGroup .radius-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      setHeatmapRadius(btn.dataset.radius);
    });
  });

  const btnParking = document.getElementById('btnToggleParking');
  if (btnParking) {
    btnParking.addEventListener('click', toggleParkingRadar);
  }

  // Draggable Sidebar Splitter Resizer
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebarContainer');
  let isResizing = false;

  // Restore saved width safely (guaranteeing map has at least 380px)
  const savedWidth = localStorage.getItem('sirene_sidebar_width');
  if (savedWidth && sidebar) {
    const parsed = parseInt(savedWidth, 10);
    const maxAllowed = Math.max(300, Math.min(750, window.innerWidth - 380));
    if (!isNaN(parsed) && parsed >= 300 && parsed <= maxAllowed) {
      sidebar.style.width = `${parsed}px`;
    } else {
      sidebar.style.width = '390px';
    }
  }

  if (resizer && sidebar) {
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizer.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const maxAllowed = Math.max(300, Math.min(750, window.innerWidth - 380));
      const targetWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.min(Math.max(targetWidth, 300), maxAllowed);
      sidebar.style.width = `${clampedWidth}px`;
      if (map) map.invalidateSize();
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('sirene_sidebar_width', sidebar.offsetWidth);
        if (map) map.invalidateSize();
      }
    });
  }

  // Modal Fullscreen / Maximize Toggle
  const btnMaxModal = document.getElementById('btnMaximizeBizModal');
  const modalBox = document.getElementById('bizModalCard');
  if (btnMaxModal && modalBox) {
    btnMaxModal.addEventListener('click', () => {
      modalBox.classList.toggle('is-maximized');
    });
  }

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
      
      // Auto-collapse inspector if switching tabs to give full height to the active tab
      const drawer = document.getElementById('inspectorDrawer');
      if (state.activeTab !== 'departments') {
        drawer.style.display = 'none';
      } else if (state.selectedDepartment) {
        drawer.style.display = 'block';
      }
      
      const searchInput = document.getElementById('searchInput');
      if (state.activeTab === 'departments') {
        searchInput.placeholder = 'Search department...';
      } else if (state.activeTab === 'communes') {
        searchInput.placeholder = 'Search city...';
      } else {
        searchInput.placeholder = 'Search industry...';
      }
    });
  });

  // Main Search Input
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearch');
  const lookupDropdown = document.getElementById('enterpriseLookupDropdown');
  let lookupDebounce = null;

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

    // Smart Enterprise Lookup: SIRET, SIREN or Company Name
    clearTimeout(lookupDebounce);
    if (state.searchQuery.length >= 3) {
      lookupDebounce = setTimeout(() => {
        performEnterpriseLookup(state.searchQuery);
      }, 280);
    } else if (lookupDropdown) {
      lookupDropdown.style.display = 'none';
      lookupDropdown.innerHTML = '';
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearBtn.style.display = 'none';
    if (lookupDropdown) {
      lookupDropdown.style.display = 'none';
      lookupDropdown.innerHTML = '';
    }
    renderDepartmentsList();
    renderCommunesList();
    renderSectorsList();
  });

  // Close lookup dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container') && lookupDropdown) {
      lookupDropdown.style.display = 'none';
    }
  });

  // Reset View
  const btnReset = document.getElementById('btnReset');
  if (btnReset) {
    btnReset.addEventListener('click', resetAll);
  }

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

  // City Dropdown Filter
  const bizCitySelect = document.getElementById('bizCitySelect');
  if (bizCitySelect) {
    bizCitySelect.addEventListener('change', (e) => {
      modalState.city = e.target.value;
      modalState.offset = 0;
      fetchAndRenderBusinesses(false);
    });
  }

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

  // Design Maestro Global Keyboard Navigation (⌘K, /, ESC)
  document.addEventListener('keydown', (e) => {
    // ESC closes modal or inspector drawer
    if (e.key === 'Escape') {
      const bizModal = document.getElementById('bizModal');
      const inspectorDrawer = document.getElementById('inspectorDrawer');
      if (bizModal && bizModal.style.display !== 'none') {
        bizModal.style.display = 'none';
        e.preventDefault();
        return;
      }
      if (inspectorDrawer && inspectorDrawer.style.display !== 'none') {
        inspectorDrawer.style.display = 'none';
        state.selectedDepartment = null;
        state.selectedCommune = null;
        if (state.communeMarker) {
          map.removeLayer(state.communeMarker);
          state.communeMarker = null;
        }
        updateChoropleth();
        e.preventDefault();
        return;
      }
    }

    // ⌘K or Ctrl+K or '/' to focus search
    const isModifierKey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    const isSlashKey = e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'TEXTAREA';
    if (isModifierKey || isSlashKey) {
      e.preventDefault();
      const bizModal = document.getElementById('bizModal');
      if (bizModal && bizModal.style.display !== 'none') {
        const bizSearch = document.getElementById('bizSearchInput');
        if (bizSearch) {
          bizSearch.focus();
          bizSearch.select();
        }
      } else {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    }
  });
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
    container.innerHTML = `<div class="loading-state">No matching cities found.</div>`;
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
           s.label.toLowerCase().includes(state.searchQuery) ||
           (s.label_fr && s.label_fr.toLowerCase().includes(state.searchQuery));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state">No matching industries found.</div>`;
    return;
  }

  const is2025 = state.nafVersion === '2025';

  container.innerHTML = filtered.map(s => {
    const isSelected = state.selectedSector && state.selectedSector.code_naf === s.code;

    return `
      <div class="entity-row ${isSelected ? 'selected' : ''}" onclick="selectSector('${s.code}')">
        <div class="entity-info">
          <span class="code-tag ${is2025 ? 'badge-naf-2025' : ''}">${s.code}</span>
          <span class="entity-name" title="${s.label_fr ? s.label + ' (' + s.label_fr + ')' : s.label}">${s.label}</span>
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
    SireneLogger.info('FILTER', `Selecting department: ${deptCode}`);
    const [deptRes, citiesRes] = await Promise.all([
      apiFetch(`/api/department/${deptCode}`),
      apiFetch(`/api/department/${deptCode}/cities`)
    ]);

    const data = await deptRes.json();
    const cities = await citiesRes.json();
    SireneLogger.info('FILTER', `Loaded department ${deptCode} (${data.name}): ${data.total} establishments, ${cities.length} cities`);

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

function setMapHeaderMeta(title, subtitle) {
  const titleEl = document.getElementById('mapViewTitle');
  if (titleEl) titleEl.textContent = title;
  const subEl = document.getElementById('mapViewSubtitle');
  if (subEl) subEl.textContent = subtitle;
}

    // Update Overlay Header
    setMapHeaderMeta(`${data.name} (${data.code})`, `${data.total.toLocaleString('en-US')} establishments • ${data.geocoded_pct}% geocoded`);

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'Department';
    document.getElementById('inspectorTitle').textContent = `${data.name} (${data.code})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    const exploreBtn = document.getElementById('btnOpenBizModal');
    exploreBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
      Browse Businesses
    `;

    const drawerExportBtn = document.getElementById('btnExportDrawerCsv');
    if (drawerExportBtn) {
      drawerExportBtn.href = `/api/businesses/export?dept=${encodeURIComponent(deptCode)}`;
    }

    // Render Top Industries in Inspector
    const industriesList = data.top_sectors.slice(0, 3).map(s => `
      <div class="breakdown-row" onclick="openBusinessModal('${deptCode}', '${data.name}', '', '${s.code_naf}')">
        <span title="${s.label}"><b class="breakdown-code">${s.code_naf}</b> ${s.label.length > 24 ? s.label.substring(0, 24) + '...' : s.label}</span>
        <span style="font-weight:700; color:var(--md-sys-color-primary);">${s.count.toLocaleString('en-US')}</span>
      </div>
    `).join('');

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top:6px;">
        <div style="font-weight:600; color:var(--md-sys-color-on-surface-variant); margin-bottom:4px; font-size:0.67rem; text-transform:uppercase; letter-spacing:0.03em;">Top Industries in ${data.name}:</div>
        ${industriesList}
      </div>
    `;

    zoomToDepartment(deptCode);
    renderDepartmentsList();
    updateChoropleth();
  } catch (err) {
    SireneLogger.error('FILTER', `Error selecting department ${deptCode}: ${err.message}`, err);
  }
}

async function selectCommune(cityName, deptCode, lat, lng) {
  try {
    SireneLogger.info('FILTER', `Selecting commune: ${cityName} (Dept ${deptCode})`, { lat, lng });
    const res = await apiFetch(`/api/commune/${encodeURIComponent(cityName)}?dept=${deptCode}`);
    const data = await res.json();
    state.selectedCommune = data;
    state.selectedDepartment = null;

    modalState.dept = deptCode;
    modalState.deptName = data.city;
    modalState.city = data.city;

    // Update Overlay Header
    setMapHeaderMeta(`${data.city} (Dept ${data.dept})`, `${data.total.toLocaleString('en-US')} establishments • ${data.geocoded_pct}% geocoded`);

    // Open Inspector Drawer
    const drawer = document.getElementById('inspectorDrawer');
    drawer.style.display = 'block';
    document.getElementById('inspectorTag').textContent = 'City';
    document.getElementById('inspectorTitle').textContent = `${data.city} (${data.dept})`;
    document.getElementById('inspectorCount').textContent = data.total.toLocaleString('en-US');
    document.getElementById('inspectorGeocoded').textContent = `${data.geocoded_pct}%`;

    const exploreBtn = document.getElementById('btnOpenBizModal');
    exploreBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
      Browse Businesses
    `;

    const drawerExportBtn = document.getElementById('btnExportDrawerCsv');
    if (drawerExportBtn) {
      drawerExportBtn.href = `/api/businesses/export?dept=${encodeURIComponent(deptCode)}&city=${encodeURIComponent(cityName)}`;
    }

    const industriesList = data.top_sectors.map(s => `
      <div class="breakdown-row" onclick="openBusinessModal('${data.dept}', '${data.city}', '${data.city}', '${s.code_naf}')">
        <span title="${s.label}"><b class="breakdown-code">${s.code_naf}</b> ${s.label.substring(0, 22)}...</span>
        <span style="font-weight:700; color:var(--md-sys-color-primary);">${s.count.toLocaleString('en-US')} (${s.pct}%)</span>
      </div>
    `).join('');

    document.getElementById('inspectorDetails').innerHTML = `
      <div style="margin-top:6px;">
        <div style="font-weight:600; color:var(--md-sys-color-on-surface-variant); margin-bottom:4px; font-size:0.68rem; text-transform:uppercase;">Top Industries in ${data.city}:</div>
        ${industriesList}
      </div>
    `;

    // Fly to city center on Google Maps with pulse marker and load actual businesses
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

      map.flyTo([lat, lng], 14, { duration: 1.2 });
      
      // Load real geocoded businesses of this commune onto the map
      loadCityEstablishments(data.city, data.dept);
    }

    renderCommunesList();
  } catch (err) {
    SireneLogger.error('FILTER', `Error selecting commune ${cityName}: ${err.message}`, err);
  }
}

async function selectSector(nafCode) {
  try {
    const version = state.nafVersion || '2008';
    SireneLogger.info('FILTER', `Selecting NAF sector: ${nafCode} (version: ${version})`);
    const res = await apiFetch(`/api/sector/${nafCode}?version=${version}`);
    const data = await res.json();
    state.selectedSector = data;
    state.activeMode = 'sector';

    // Update Overlay Header
    setMapHeaderMeta(`${data.code_naf} — ${data.label}`, `National total: ${data.total_national.toLocaleString('en-US')} active establishments`);

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
      <div style="font-weight:600; color:var(--md-sys-color-on-surface-variant); margin-top:4px; font-size:0.68rem; text-transform:uppercase;">Top Regional Concentrations:</div>
      ${topDepts.map(([code, count]) => {
        const name = state.departmentsMap[code] ? state.departmentsMap[code].name : `Dept ${code}`;
        return `
          <div class="breakdown-row" onclick="selectDepartment('${code}')">
            <span><b class="breakdown-code">${code}</b> ${name}</span>
            <span style="font-weight:700; color:var(--md-sys-color-primary);">${count.toLocaleString('en-US')}</span>
          </div>
        `;
      }).join('')}
    `;

    renderSectorsList();
    updateChoropleth();
  } catch (err) {
    SireneLogger.error('FILTER', `Error selecting sector ${nafCode}: ${err.message}`, err);
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

  SireneLogger.info('MODAL', `Opening business modal for Dept ${deptCode} (${deptName})`, { initialCity, initialNaf });

  const modal = document.getElementById('bizModal');
  modal.style.display = 'flex';

  document.getElementById('bizModalPill').textContent = `Department ${deptCode}`;
  document.getElementById('bizModalTitle').textContent = `Registered Businesses in ${deptName}`;
  document.getElementById('bizSearchInput').value = '';

  try {
    const version = state.nafVersion || '2008';
    const [citiesRes, nichesRes] = await Promise.all([
      apiFetch(`/api/department/${deptCode}/cities`),
      apiFetch(`/api/department/${deptCode}/niches?version=${version}`)
    ]);

    modalState.citiesList = await citiesRes.json();
    modalState.nichesList = await nichesRes.json();

    renderCitySelect();
    renderNicheSelect();
  } catch (err) {
    SireneLogger.error('MODAL', `Failed to load filter metadata for modal: ${err.message}`, err);
  }

  fetchAndRenderBusinesses(false);
}

function renderCitySelect() {
  const select = document.getElementById('bizCitySelect');
  if (!select) return;
  
  const totalInCities = modalState.citiesList.reduce((acc, c) => acc + c.total, 0);
  let html = `<option value="">All Cities in Dept (${totalInCities.toLocaleString('en-US')})</option>`;
  
  modalState.citiesList.forEach(c => {
    const isSelected = modalState.city.toUpperCase() === c.city.toUpperCase() ? 'selected' : '';
    html += `
      <option value="${escapeStr(c.city)}" ${isSelected}>
        ${c.city} (${c.total.toLocaleString('en-US')})
      </option>
    `;
  });

  select.innerHTML = html;
}

function renderNicheSelect() {
  const select = document.getElementById('bizNafSelect');
  if (!select) return;
  
  let html = `<option value="">All Niches & Industries (${modalState.nichesList.length} top sectors)</option>`;
  
  modalState.nichesList.forEach(n => {
    const isSelected = modalState.naf === n.code ? 'selected' : '';
    const labelShort = n.label.length > 42 ? n.label.substring(0, 42) + '...' : n.label;
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
  const citySelect = document.getElementById('bizCitySelect');
  if (citySelect) citySelect.value = cityName;
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
    const version = state.nafVersion || '2008';
    let url = `/api/businesses?dept=${modalState.dept}&limit=${limitVal}&offset=${offsetVal}&version=${version}`;
    if (modalState.city) {
      url += `&city=${encodeURIComponent(modalState.city)}`;
    }
    if (modalState.naf) {
      url += `&naf=${encodeURIComponent(modalState.naf)}`;
    }
    if (modalState.query) {
      url += `&q=${encodeURIComponent(modalState.query)}`;
    }

    SireneLogger.info('MODAL', `Fetching businesses page [offset=${offsetVal}, limit=${limitVal}]`, { dept: modalState.dept, city: modalState.city, naf: modalState.naf, query: modalState.query });
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();

    modalState.total = data.total;
    modalState.loadedCount += data.items.length;
    SireneLogger.info('MODAL', `Loaded ${data.items.length} businesses (total: ${data.total})`);

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
      const actionBtn = b.has_gps ? `
        <button class="btn-locate" onclick="pinBusinessOnMap('${b.siret}', ${b.lat}, ${b.lng}, '${escapeStr(b.name)}', '${escapeStr(b.postal_code || '')} ${escapeStr(b.city || '')}', '${b.naf_code}', '${escapeStr(b.naf_label)}', '${escapeStr(b.naf_label_fr || '')}', '${escapeStr(b.google_maps_url || '')}', '${escapeStr(b.gov_verify_url)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          <span>Locate</span>
        </button>
      ` : `<span class="biz-no-gps">No GPS</span>`;

      return `
        <tr>
          <td class="biz-name-cell">
            <div class="biz-name-main">${b.name}</div>
            ${b.enseigne && b.enseigne !== b.name ? `<div class="biz-name-sub"><span class="trade-sign-tag">Enseigne</span><span class="trade-sign-val">${b.enseigne}</span></div>` : ''}
          </td>
          <td>
            <div class="biz-siret-wrap">
              <span class="biz-siret-val">${b.siret}</span>
              <a href="${b.gov_verify_url}" target="_blank" class="biz-verify-chip" title="Verify on official French registry">
                <span>Verify</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            </div>
          </td>
          <td>
            <div class="biz-location-wrap">
              <div class="biz-location-city">${b.city || 'N/A'}</div>
              <div class="biz-location-zip">${b.postal_code || ''}</div>
            </div>
          </td>
          <td>
            <div class="biz-industry-wrap">
              <div class="biz-industry-row">
                <span class="badge-naf">${b.naf_code}</span>
                <span class="biz-industry-title">${b.naf_label}</span>
              </div>
              ${b.naf_code_2025 ? `
                <div class="biz-industry-row sub-naf">
                  <span class="badge-naf-2025" title="NAF 2025">${b.naf_code_2025}</span>
                  <span class="biz-industry-sub">${b.naf_2025_label || ''}</span>
                </div>
              ` : ''}
              ${b.naf_label_fr ? `<div class="biz-industry-official">${b.naf_label_fr}</div>` : ''}
            </div>
          </td>
          <td style="text-align: center;">${actionBtn}</td>
        </tr>
      `;
    }).join('');

    if (append) {
      tbody.insertAdjacentHTML('beforeend', rowsHtml);
    } else {
      tbody.innerHTML = rowsHtml;
    }

  } catch (err) {
    SireneLogger.error('MODAL', `Error fetching businesses: ${err.message}`, err);
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
  SireneLogger.info('MAP', `Pinning business ${siret} on map: "${name}"`, { lat, lng });
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
      <div class="biz-popup-tag">Establishment Target</div>
      <div class="biz-popup-title">${name}</div>
      <div class="biz-popup-sub">SIRET: <code>${siret}</code></div>
      <div class="biz-popup-sub">Location: <b>${address}</b></div>
      <div class="biz-popup-badge">${nafCode} • ${nafLabel}</div>
      ${nafLabelFr ? `<div style="font-size:0.67rem; color:#94A3B8; margin-top:3px;">Official (FR): ${nafLabelFr}</div>` : ''}
      
      <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
        <a href="${googleUrl}" target="_blank" class="btn-google-ext" style="display:flex; align-items:center; justify-content:center; padding:5px 8px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          Open in Google Maps
        </a>
        <a href="${govUrl}" target="_blank" class="btn-gov-verify" style="display:flex; align-items:center; justify-content:center;">
          Official Verification ↗
        </a>
      </div>
    </div>
  `, {
    offset: [0, -8],
    maxWidth: 300
  }).openPopup();

  map.flyTo([lat, lng], 17, { duration: 1.2 });

  // Store active parking target
  activeParkingTarget = { siret, lat, lng, name, address, nafCode, nafLabel, googleUrl, govUrl };

  // Update Drawer to show Business Profile & Truck Parking Radar
  showBusinessInInspector(siret, lat, lng, name, address, nafCode, nafLabel, googleUrl, govUrl);

  // If Parking Radar is enabled, scan nearby spots
  if (isParkingRadarActive) {
    loadNearbyParkings(lat, lng, name, activeParkingRadius);
  }
}

/* ==========================================================================
   Business Inspector Drawer & Truck Logistics Integration
   ========================================================================== */
function showBusinessInInspector(siret, lat, lng, name, address, nafCode, nafLabel, googleUrl, govUrl) {
  const drawer = document.getElementById('inspectorDrawer');
  if (!drawer) return;

  drawer.style.display = 'block';

  const tagEl = document.getElementById('inspectorTag');
  if (tagEl) tagEl.textContent = 'Establishment';

  const titleEl = document.getElementById('inspectorTitle');
  if (titleEl) titleEl.textContent = name;

  const subEl = document.getElementById('inspectorSubtitle');
  if (subEl) {
    subEl.style.display = 'block';
    subEl.innerHTML = `SIRET: <code style="color:var(--md-sys-color-primary); font-family:var(--font-mono);">${siret}</code> • ${address}`;
  }

  const countEl = document.getElementById('inspectorCount');
  if (countEl) countEl.textContent = 'Active';

  const geocodedEl = document.getElementById('inspectorGeocoded');
  if (geocodedEl) geocodedEl.textContent = 'Verified';

  const btnOpenModal = document.getElementById('btnOpenBizModal');
  if (btnOpenModal) {
    btnOpenModal.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
        <line x1="9" y1="3" x2="9" y2="18"></line>
        <line x1="15" y1="6" x2="15" y2="21"></line>
      </svg>
      Center on Target
    `;
    btnOpenModal.onclick = () => {
      map.flyTo([lat, lng], 18, { duration: 0.8 });
      if (currentBizMarker) currentBizMarker.openPopup();
    };
  }

  // Initial placeholder while parking radar queries Overpass
  renderParkingDrawerPanel(name, activeParkingRadius, null, true);
}

/* ==========================================================================
   Regional Business Density Layer (Department Shading & Boundaries)
   ========================================================================== */
function toggleRegionsLayer() {
  isRegionsActive = !isRegionsActive;

  const btn = document.getElementById('btnToggleRegions');
  if (btn) btn.classList.toggle('active', isRegionsActive);

  const miniToggle = document.getElementById('legendToggleRegions');
  if (miniToggle) {
    miniToggle.classList.toggle('off', !isRegionsActive);
    const span = miniToggle.querySelector('.toggle-state-text');
    if (span) span.textContent = isRegionsActive ? 'ON' : 'OFF';
  }

  const block = document.getElementById('legendRegionsBlock');
  if (block) {
    block.classList.toggle('is-disabled', !isRegionsActive);
  }

  if (state.geoJsonLayer) {
    if (isRegionsActive) {
      if (!map.hasLayer(state.geoJsonLayer)) {
        map.addLayer(state.geoJsonLayer);
      }
      state.geoJsonLayer.setStyle(getFeatureStyle);
    } else {
      if (map.hasLayer(state.geoJsonLayer)) {
        map.removeLayer(state.geoJsonLayer);
      }
    }
  }
}

/* ==========================================================================
   STEP 1: Real-Time Traffic Congestion Layer (Google Traffic Overlay)
   ========================================================================== */
function toggleTrafficLayer() {
  const btn = document.getElementById('btnToggleTraffic');
  isTrafficActive = !isTrafficActive;

  if (btn) btn.classList.toggle('active', isTrafficActive);

  const miniToggle = document.getElementById('legendToggleTraffic');
  if (miniToggle) {
    miniToggle.classList.toggle('off', !isTrafficActive);
    const span = miniToggle.querySelector('.toggle-state-text');
    if (span) span.textContent = isTrafficActive ? 'ON' : 'OFF';
  }

  const block = document.getElementById('legendTrafficBlock');
  if (block) {
    block.classList.toggle('is-disabled', !isTrafficActive);
  }

  if (isTrafficActive) {
    if (!trafficTileLayer) {
      trafficTileLayer = L.tileLayer('https://mt{s}.google.com/vt?lyrs=h,traffic|seconds_into_week:-1&hl=fr&x={x}&y={y}&z={z}&scale=2', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        tileSize: 256,
        opacity: 0.95,
        zIndex: 500
      });
    }
    trafficTileLayer.addTo(map);
    trafficTileLayer.bringToFront();
  } else {
    if (trafficTileLayer && map.hasLayer(trafficTileLayer)) {
      map.removeLayer(trafficTileLayer);
    }
  }
}

/* ==========================================================================
   STEP 2: Truck Parking Radar & Search Radius
   ========================================================================== */
function toggleParkingRadar() {
  const btn = document.getElementById('btnToggleParking');
  isParkingRadarActive = !isParkingRadarActive;

  if (btn) btn.classList.toggle('active', isParkingRadarActive);

  const miniToggle = document.getElementById('legendToggleParking');
  if (miniToggle) {
    miniToggle.classList.toggle('off', !isParkingRadarActive);
    const span = miniToggle.querySelector('.toggle-state-text');
    if (span) span.textContent = isParkingRadarActive ? 'ON' : 'OFF';
  }

  const block = document.getElementById('legendParkingBlock');
  if (block) {
    block.classList.toggle('is-disabled', !isParkingRadarActive);
  }

  if (!isParkingRadarActive) {
    if (parkingRadiusCircle && map.hasLayer(parkingRadiusCircle)) {
      map.removeLayer(parkingRadiusCircle);
      parkingRadiusCircle = null;
    }
    if (parkingLayerGroup) parkingLayerGroup.clearLayers();
  } else if (activeParkingTarget) {
    loadNearbyParkings(activeParkingTarget.lng ? activeParkingTarget.lat : activeParkingTarget.lat, activeParkingTarget.lng, activeParkingTarget.name, activeParkingRadius);
  }
}

let activeParkingData = [];

async function loadNearbyParkings(lat, lon, businessName, radius) {
  if (!isParkingRadarActive) return;

  activeParkingRadius = radius || activeParkingRadius || 300;

  // 1. Draw or update circular radar zone on map
  if (parkingRadiusCircle && map.hasLayer(parkingRadiusCircle)) {
    map.removeLayer(parkingRadiusCircle);
  }

  parkingRadiusCircle = L.circle([lat, lon], {
    radius: activeParkingRadius,
    color: '#38BDF8',
    fillColor: '#38BDF8',
    fillOpacity: 0.07,
    weight: 1.5,
    dashArray: '5, 5'
  }).addTo(map);

  if (parkingLayerGroup) parkingLayerGroup.clearLayers();

  // 2. Render loading skeleton in drawer
  renderParkingDrawerPanel(businessName, activeParkingRadius, null, true);

  try {
    SireneLogger.info('RADAR', `Scanning nearby truck parkings around [${lat}, ${lon}] within ${activeParkingRadius}m for: "${businessName}"`);
    const res = await apiFetch(`/api/parking/nearby?lat=${lat}&lon=${lon}&radius=${activeParkingRadius}`);
    const data = await res.json();
    const parkings = data.parkings || [];
    activeParkingData = parkings;
    SireneLogger.info('RADAR', `Found ${parkings.length} parking spots (${data.truck_friendly_count || 0} truck-friendly) within ${activeParkingRadius}m`);

    // Render custom pins on map
    parkings.forEach((p, idx) => {
      const isTruck = p.is_truck_friendly;
      const icon = L.divIcon({
        className: isTruck ? 'parking-pin-truck' : 'parking-pin-garage',
        html: isTruck ? '<span>P</span>' : '<span>P</span>',
        iconSize: isTruck ? [28, 28] : [24, 24],
        iconAnchor: isTruck ? [14, 14] : [12, 12]
      });

      const marker = L.marker([p.lat, p.lon], { icon });

      marker.bindPopup(`
        <div class="parking-popup">
          <div class="parking-popup-badge ${isTruck ? 'badge-truck' : 'badge-garage'}">
            ${isTruck ? '✓ Truck-Friendly Surface' : '⚠ Underground / Restricted'}
          </div>
          <div class="parking-popup-name">${p.name}</div>
          <div class="parking-popup-meta">
            Distance: <b>${p.distance_m}m</b> from business<br>
            Type: <b>${p.type || 'Standard'}</b><br>
            ${p.capacity ? `Capacity: <b>${p.capacity} spots</b><br>` : ''}
            ${p.maxheight ? `Max Clearance: <b>${p.maxheight}</b><br>` : ''}
            Fee: <b>${p.fee === 'yes' ? 'Paid Parking' : (p.fee === 'no' ? 'Free Parking' : 'Standard')}</b>
          </div>
        </div>
      `, { offset: [0, -8], maxWidth: 240 });

      p._markerId = idx;
      marker._spotIdx = idx;
      parkingLayerGroup.addLayer(marker);
    });

    // 3. Render loaded drawer panel
    renderParkingDrawerPanel(businessName, activeParkingRadius, data, false);

  } catch (err) {
    SireneLogger.error('RADAR', `Failed to load nearby parkings: ${err.message}`, err);
    renderParkingDrawerPanel(businessName, activeParkingRadius, { count: 0, truck_friendly_count: 0, parkings: [] }, false);
  }
}

function setParkingRadius(newRadius) {
  activeParkingRadius = newRadius;
  if (activeParkingTarget) {
    loadNearbyParkings(activeParkingTarget.lat, activeParkingTarget.lng, activeParkingTarget.name, activeParkingRadius);
  }
}

function focusOnParking(spotIdx) {
  const spot = activeParkingData[spotIdx];
  if (!spot) return;

  map.flyTo([spot.lat, spot.lon], 18, { duration: 0.8 });

  parkingLayerGroup.eachLayer(layer => {
    if (layer._spotIdx === spotIdx) {
      setTimeout(() => layer.openPopup(), 400);
    }
  });
}

function renderParkingDrawerPanel(businessName, radius, data, isLoading) {
  const container = document.getElementById('inspectorDetails');
  if (!container) return;

  if (isLoading) {
    container.innerHTML = `
      <div class="truck-parking-panel">
        <div class="truck-parking-header">
          <div class="truck-parking-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="4"></rect>
              <path d="M9 17V7h4a3 3 0 0 1 0 6H9"></path>
            </svg>
            Truck Parking Radar
          </div>
          <div class="radius-chips-group">
            <button class="radius-chip ${radius === 150 ? 'active' : ''}" onclick="setParkingRadius(150)">150m</button>
            <button class="radius-chip ${radius === 300 ? 'active' : ''}" onclick="setParkingRadius(300)">300m</button>
            <button class="radius-chip ${radius === 500 ? 'active' : ''}" onclick="setParkingRadius(500)">500m</button>
          </div>
        </div>
        <div class="loading-state" style="padding:14px 0; font-size:0.75rem;">
          Scanning live spots within ${radius}m radius...
        </div>
      </div>
    `;
    return;
  }

  const parkings = data.parkings || [];
  const truckCount = data.truck_friendly_count || 0;
  const undergroundCount = Math.max(data.count - truckCount, 0);

  const spotsHtml = parkings.length > 0 ? parkings.map((p, idx) => {
    const isTruck = p.is_truck_friendly;
    return `
      <div class="parking-row-item">
        <div class="parking-row-info">
          <div class="parking-row-name" title="${escapeStr(p.name)}">${p.name}</div>
          <div class="parking-row-sub">
            <span class="${isTruck ? 'badge-truck-tag' : 'badge-garage-tag'}">
              ${isTruck ? '✓ Surface' : '⚠ Underground'}
            </span>
            <span>•</span>
            <span>${p.distance_m}m</span>
            ${p.capacity ? `<span>• ${p.capacity} spots</span>` : ''}
          </div>
        </div>
        <button class="btn-focus-spot" onclick="focusOnParking(${idx})" title="Center map on this parking">
          Focus
        </button>
      </div>
    `;
  }).join('') : `
    <div style="font-size:0.73rem; color:#94A3B8; text-align:center; padding:12px;">
      No registered parking spots found within ${radius}m.<br>
      <span style="font-size:0.67rem; color:#64748B;">Try selecting 500m radius.</span>
    </div>
  `;

  container.innerHTML = `
    <div class="truck-parking-panel">
      <div class="truck-parking-header">
        <div class="truck-parking-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="4"></rect>
            <path d="M9 17V7h4a3 3 0 0 1 0 6H9"></path>
          </svg>
          Truck Parking Radar
        </div>
        <div class="radius-chips-group">
          <button class="radius-chip ${radius === 150 ? 'active' : ''}" onclick="setParkingRadius(150)">150m</button>
          <button class="radius-chip ${radius === 300 ? 'active' : ''}" onclick="setParkingRadius(300)">300m</button>
          <button class="radius-chip ${radius === 500 ? 'active' : ''}" onclick="setParkingRadius(500)">500m</button>
        </div>
      </div>

      <div class="truck-stats-row">
        <div class="truck-stat-card">
          <div class="truck-stat-label">Truck Friendly</div>
          <div class="truck-stat-value text-emerald">${truckCount}</div>
        </div>
        <div class="truck-stat-card">
          <div class="truck-stat-label">Underground / Height</div>
          <div class="truck-stat-value text-amber">${undergroundCount}</div>
        </div>
      </div>

      <div class="parking-list-scroller">
        ${spotsHtml}
      </div>
    </div>
  `;
}

/* ==========================================================================
   STEP 3: Continuous Smooth Thermal Footfall Heatmap (matching Screenshot 3)
   ========================================================================== */
const HEATMAP_GRADIENT = {
  0.25: '#00d2ff',  // Soft Cyan (secondary activity)
  0.45: '#00f59b',  // Bright Lime Green (active trade zone)
  0.65: '#ffe600',  // Warm Solar Yellow (regional metropolis)
  0.82: '#ff7700',  // Deep Orange (major commercial hub)
  1.00: '#ff0033'   // Fiery Crimson Red (peak national density: Paris core)
};

let crowdHeatLayer = null;
let heatmapRadius = 28;
let heatmapBlur = 18;
let cachedHeatmapData = null;
let viewportHeatmapDebounce = null;
let isViewportHeatmapLoaded = false;

let heatmapRadiusMultiplier = 1.0; // 0.7 (Tight), 1.0 (Balanced), 1.4 (Broad)

function getZoomAdaptiveHeatmapParams() {
  const currentZoom = map ? map.getZoom() : 6;
  let baseR = 12;
  let baseBlur = 10;
  let maxZ = 8;
  let minOp = 0.22;
  let maxVal = 2.0;

  if (currentZoom <= 6) {
    baseR = 11;
    baseBlur = 9;
    maxZ = 8;
    minOp = 0.25;
    maxVal = 2.4; // Calibrated for Greater Paris 4-cell overlap so only Paris center reaches crimson
  } else if (currentZoom === 7) {
    baseR = 13;
    baseBlur = 10;
    maxZ = 9;
    minOp = 0.24;
    maxVal = 2.0;
  } else if (currentZoom === 8) {
    baseR = 15;
    baseBlur = 12;
    maxZ = 10;
    minOp = 0.22;
    maxVal = 1.8;
  } else if (currentZoom === 9) {
    baseR = 18;
    baseBlur = 14;
    maxZ = 11;
    minOp = 0.20;
    maxVal = 1.5;
  } else if (currentZoom === 10) {
    baseR = 20;
    baseBlur = 16;
    maxZ = 12;
    minOp = 0.18;
    maxVal = 1.3;
  } else if (currentZoom === 11) {
    baseR = 22;
    baseBlur = 18;
    maxZ = 13;
    minOp = 0.16;
    maxVal = 1.1;
  } else if (currentZoom === 12) {
    baseR = 25;
    baseBlur = 20;
    maxZ = 14;
    minOp = 0.15;
    maxVal = 1.0;
  } else if (currentZoom >= 13) {
    baseR = 28;
    baseBlur = 22;
    maxZ = 16;
    minOp = 0.14;
    maxVal = 1.0;
  }

  const finalR = Math.round(baseR * heatmapRadiusMultiplier);
  const finalBlur = Math.round(baseBlur * heatmapRadiusMultiplier);
  return { radius: finalR, blur: finalBlur, maxZoom: maxZ, minOpacity: minOp, max: maxVal };
}

function updateHeatmapOnZoom() {
  if (!crowdHeatLayer || !isCrowdActive || !map.hasLayer(crowdHeatLayer)) return;
  const p = getZoomAdaptiveHeatmapParams();
  crowdHeatLayer.setOptions({
    radius: p.radius,
    blur: p.blur,
    maxZoom: p.maxZoom,
    max: p.max,
    minOpacity: p.minOpacity
  });
}

async function checkViewportHeatmap() {
  if (!crowdHeatLayer || !isCrowdActive || !map || !map.hasLayer(crowdHeatLayer)) return;
  const zoom = map.getZoom();

  if (zoom >= 10) {
    const bounds = map.getBounds();
    const minLat = bounds.getSouth().toFixed(3);
    const maxLat = bounds.getNorth().toFixed(3);
    const minLng = bounds.getWest().toFixed(3);
    const maxLng = bounds.getEast().toFixed(3);

    try {
      SireneLogger.debug('MAP', `Updating viewport crowd heatmap for bounds [${minLat}, ${minLng}] -> [${maxLat}, ${maxLng}]`);
      const res = await apiFetch(`/api/crowd/heatmap?min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLng}&max_lon=${maxLng}`);
      if (!res.ok) return;
      const pts = await res.json();
      if (pts && pts.length > 0 && crowdHeatLayer) {
        crowdHeatLayer.setLatLngs(pts);
        isViewportHeatmapLoaded = true;
        SireneLogger.debug('MAP', `Applied ${pts.length} high-resolution viewport heatmap points`);
      }
    } catch (e) {
      SireneLogger.error('MAP', `Failed to load viewport heatmap: ${e.message}`, e);
    }
  } else {
    // Revert back to calibrated national density if zoomed out
    if (isViewportHeatmapLoaded && cachedHeatmapData && crowdHeatLayer) {
      crowdHeatLayer.setLatLngs(cachedHeatmapData);
      isViewportHeatmapLoaded = false;
      SireneLogger.debug('MAP', 'Reverted heatmap to national cached density');
    }
  }
}

async function toggleCrowdHeatmap() {
  const btn = document.getElementById('btnToggleCrowd');
  isCrowdActive = !isCrowdActive;
  SireneLogger.info('MAP', `Crowd Heatmap layer toggled: ${isCrowdActive ? 'ON' : 'OFF'}`);

  if (btn) btn.classList.toggle('active', isCrowdActive);

  const miniToggle = document.getElementById('legendToggleCrowd');
  if (miniToggle) {
    miniToggle.classList.toggle('off', !isCrowdActive);
    const span = miniToggle.querySelector('.toggle-state-text');
    if (span) span.textContent = isCrowdActive ? 'ON' : 'OFF';
  }

  const block = document.getElementById('legendHeatmapBlock');
  if (block) {
    block.classList.toggle('is-disabled', !isCrowdActive);
  }

  if (!isCrowdActive) {
    if (crowdHeatLayer && map.hasLayer(crowdHeatLayer)) {
      map.removeLayer(crowdHeatLayer);
    }
    return;
  }

  if (!cachedHeatmapData) {
    try {
      const res = await apiFetch('/api/crowd/heatmap');
      cachedHeatmapData = await res.json();
      SireneLogger.info('MAP', `Loaded national heatmap points: ${cachedHeatmapData.length}`);
    } catch (e) {
      SireneLogger.error('MAP', `Failed to load heatmap coordinates: ${e.message}`, e);
      return;
    }
  }

  renderHeatmapLayer(cachedHeatmapData);
}

function renderHeatmapLayer(points) {
  if (crowdHeatLayer && map.hasLayer(crowdHeatLayer)) {
    map.removeLayer(crowdHeatLayer);
  }

  const params = getZoomAdaptiveHeatmapParams();

  // Create smooth canvas heatmap layer with continuous thermal gradient from actual registry
  crowdHeatLayer = L.heatLayer(points, {
    radius: params.radius,
    blur: params.blur,
    maxZoom: params.maxZoom,
    max: params.max,
    minOpacity: params.minOpacity,
    gradient: HEATMAP_GRADIENT
  }).addTo(map);

  // If already at high zoom, load viewport high-res points
  if (map.getZoom() >= 10) {
    checkViewportHeatmap();
  }
}

function setHeatmapRadius(r) {
  const val = parseInt(r);
  if (val <= 20) heatmapRadiusMultiplier = 0.72;
  else if (val >= 40) heatmapRadiusMultiplier = 1.45;
  else heatmapRadiusMultiplier = 1.0;

  document.querySelectorAll('#heatmapRadiusGroup .segment-btn, #heatmapRadiusGroup .radius-chip').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.radius) === val);
  });

  updateHeatmapOnZoom();
}

/* ==========================================================================
   Actual Geocoded Establishments on Map (Real INSEE SIRENE Coordinates)
   ========================================================================== */
async function loadViewportBusinesses() {
  if (!map || map.getZoom() < 14) return;
  const bounds = map.getBounds();
  const minLat = bounds.getSouth();
  const maxLat = bounds.getNorth();
  const minLng = bounds.getWest();
  const maxLng = bounds.getEast();

  try {
    SireneLogger.debug('MAP', `Loading viewport establishments at zoom ${map.getZoom()}`);
    const res = await apiFetch(`/api/businesses/map?min_lat=${minLat}&max_lat=${maxLat}&min_lng=${minLng}&max_lng=${maxLng}&limit=60`);
    if (!res.ok) return;
    const data = await res.json();
    SireneLogger.debug('MAP', `Rendered ${data.items ? data.items.length : 0} establishments in current viewport`);
    renderBusinessMarkers(data.items);
  } catch (e) {
    SireneLogger.error('MAP', `Failed to load viewport businesses: ${e.message}`, e);
  }
}

async function loadCityEstablishments(cityName, deptCode) {
  try {
    SireneLogger.info('MAP', `Loading establishments for city: ${cityName} (Dept ${deptCode})`);
    const res = await apiFetch(`/api/businesses/map?city=${encodeURIComponent(cityName)}&dept=${encodeURIComponent(deptCode)}&limit=60`);
    if (!res.ok) return;
    const data = await res.json();
    SireneLogger.info('MAP', `Rendered ${data.items ? data.items.length : 0} establishments for ${cityName}`);
    renderBusinessMarkers(data.items);
  } catch (e) {
    SireneLogger.error('MAP', `Failed to load city establishments for ${cityName}: ${e.message}`, e);
  }
}

function renderBusinessMarkers(items) {
  if (!businessMarkersLayerGroup) return;
  businessMarkersLayerGroup.clearLayers();

  if (!items || items.length === 0) return;

  items.forEach(b => {
    if (!b.lat || !b.lng) return;

    const icon = L.divIcon({
      className: 'biz-node-icon',
      html: `
        <div class="biz-node-pin">
          <div class="biz-node-dot"></div>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker([b.lat, b.lng], { icon: icon });

    marker.bindTooltip(`
      <div class="biz-mini-tooltip">
        <b>${escapeStr(b.name)}</b>
        <div style="font-size:0.67rem; color:#94A3B8; margin-top:1px;">${b.naf_code} • ${escapeStr(b.naf_label)}</div>
      </div>
    `, { direction: 'top', offset: [0, -6] });

    marker.bindPopup(`
      <div class="biz-popup">
        <div class="biz-popup-tag">Verified Establishment</div>
        <div class="biz-popup-title">${escapeStr(b.name)}</div>
        ${b.enseigne && b.enseigne !== b.name ? `<div class="biz-popup-sub">Trade sign: <b>${escapeStr(b.enseigne)}</b></div>` : ''}
        <div class="biz-popup-sub">SIRET: <code>${b.siret}</code></div>
        <div class="biz-popup-sub">Location: <b>${escapeStr(b.postal_code || '')} ${escapeStr(b.city || '')}</b></div>
        <div class="biz-popup-badge">${b.naf_code} • ${escapeStr(b.naf_label)}</div>
        ${b.naf_code_2025 ? `<div style="margin-top:4px;"><span class="badge-naf-2025">${b.naf_code_2025}</span> <span style="font-size:0.68rem; color:var(--md-sys-color-on-surface-variant);">NAF 2025: ${escapeStr(b.naf_2025_label || '')}</span></div>` : ''}
        ${b.naf_label_fr ? `<div style="font-size:0.67rem; color:var(--md-sys-color-on-surface-variant); margin-top:3px;">Official (FR): ${escapeStr(b.naf_label_fr)}</div>` : ''}
        
        <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
          <a href="${b.google_maps_url}" target="_blank" class="btn-google-ext" style="display:flex; align-items:center; justify-content:center; padding:5px 8px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            Open in Google Maps
          </a>
          <a href="${b.gov_verify_url}" target="_blank" class="btn-gov-verify" style="display:flex; align-items:center; justify-content:center;">
            Official Registry ↗
          </a>
        </div>
      </div>
    `, { offset: [0, -6], maxWidth: 300 });

    marker.on('click', () => {
      showBusinessInInspector(b.siret, b.lat, b.lng, b.name, `${b.postal_code || ''} ${b.city || ''}`, b.naf_code, b.naf_label, b.google_maps_url, b.gov_verify_url);
      if (isParkingRadarActive) {
        loadNearbyParkings(b.lat, b.lng, b.name, activeParkingRadius);
      }
    });

    businessMarkersLayerGroup.addLayer(marker);
  });
}

/* ==========================================================================
   Unified Collapsible Map Legend Controller
   ========================================================================== */
let isUnifiedLegendExpanded = false;

function toggleUnifiedLegend() {
  const panel = document.getElementById('unifiedLegendPanel');
  const trigger = document.getElementById('legendPillTrigger');
  const container = document.getElementById('unifiedLegendContainer');
  if (!panel || !container) return;

  isUnifiedLegendExpanded = !isUnifiedLegendExpanded;
  panel.style.display = isUnifiedLegendExpanded ? 'block' : 'none';
  if (trigger) {
    trigger.style.display = isUnifiedLegendExpanded ? 'none' : 'inline-flex';
  }
  container.classList.toggle('expanded', isUnifiedLegendExpanded);
}

/* ==========================================================================
   YouTube-Style Immersive Fullscreen Map Mode
   ========================================================================== */
function toggleMapFullscreen() {
  const isFs = document.body.classList.contains('map-fullscreen');
  const btn = document.getElementById('btnToggleFullscreen');

  if (!isFs) {
    document.body.classList.add('map-fullscreen');
    if (btn) {
      btn.classList.add('active', 'is-fullscreen-exit');
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Exit Fullscreen';
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
      }
    }
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } else {
    document.body.classList.remove('map-fullscreen');
    if (btn) {
      btn.classList.remove('active', 'is-fullscreen-exit');
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Fullscreen';
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
      }
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 150);
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('map-fullscreen')) {
    document.body.classList.remove('map-fullscreen');
    const btn = document.getElementById('btnToggleFullscreen');
    if (btn) {
      btn.classList.remove('active', 'is-fullscreen-exit');
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Fullscreen';
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
      }
    }
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 150);
  }
});

/* ==========================================================================
   Reset All
   ========================================================================== */
function resetAll() {
  state.activeMode = 'density';
  state.selectedSector = null;
  state.selectedDepartment = null;
  state.selectedCommune = null;
  state.searchQuery = '';
  activeParkingTarget = null;

  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearch').style.display = 'none';
  document.getElementById('inspectorDrawer').style.display = 'none';

  if (currentBizMarker) {
    map.removeLayer(currentBizMarker);
    currentBizMarker = null;
  }

  if (parkingRadiusCircle && map.hasLayer(parkingRadiusCircle)) {
    map.removeLayer(parkingRadiusCircle);
    parkingRadiusCircle = null;
  }

  if (parkingLayerGroup) {
    parkingLayerGroup.clearLayers();
  }

  if (state.communeMarker) {
    map.removeLayer(state.communeMarker);
    state.communeMarker = null;
  }

  setMapHeaderMeta('National Overview', 'Click any department or city to inspect');

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

/* ==========================================================================
   Real-Time Enterprise Lookup & Direct Map Pinpointing
   ========================================================================== */
async function performEnterpriseLookup(query) {
  const dropdown = document.getElementById('enterpriseLookupDropdown');
  if (!dropdown) return;
  if (!query || query.length < 3) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  try {
    const version = state.nafVersion || '2008';
    SireneLogger.info('SEARCH', `Enterprise search query: "${query}" (version: ${version})`);
    const res = await apiFetch(`/api/businesses?q=${encodeURIComponent(query)}&limit=6&version=${version}`);
    if (!res.ok) return;
    const data = await res.json();
    SireneLogger.info('SEARCH', `Found ${data.total || 0} establishments matching "${query}"`);

    if (!data.items || data.items.length === 0) {
      if (/^\d{5,}$/.test(query)) {
        dropdown.innerHTML = `
          <div style="padding:10px; font-size:0.75rem; color:#94A3B8; text-align:center;">
            No registered establishment found for "<b>${escapeStr(query)}</b>"
          </div>`;
        dropdown.style.display = 'block';
      } else {
        dropdown.style.display = 'none';
      }
      return;
    }

    dropdown.innerHTML = `
      <div style="padding: 4px 8px 6px; font-size:0.67rem; text-transform:uppercase; color:#94A3B8; font-weight:700; letter-spacing:0.04em;">
        Enterprises matching "${escapeStr(query)}" (${data.total.toLocaleString()} total):
      </div>
      ${data.items.map(b => `
        <div class="lookup-item" onclick="focusBusinessOnMap('${escapeStr(b.siret)}', ${b.lat || 'null'}, ${b.lng || 'null'}, '${escapeStr(b.name)}', '${escapeStr(b.naf_code || '')}', '${escapeStr(b.naf_label || '')}', '${escapeStr(b.postal_code || '')}', '${escapeStr(b.city || '')}', '${escapeStr(b.naf_code_2025 || '')}', '${escapeStr(b.naf_2025_label || '')}')">
          <div class="lookup-header">
            <span class="lookup-name">${escapeStr(b.name || 'Enterprise')}</span>
            <span class="lookup-badge">${b.has_gps ? 'GPS Verified' : 'Registered'}</span>
          </div>
          <div class="lookup-details">
            <span class="lookup-siret">${b.siret}</span>
            <span>•</span>
            <span>${b.postal_code || ''} ${b.city || ''} (${b.department})</span>
          </div>
          <div class="lookup-action">
            ${b.has_gps ? '📍 Locate on Map' : '📋 Inspect Enterprise'} →
          </div>
        </div>
      `).join('')}
    `;
    dropdown.style.display = 'block';
  } catch (err) {
    SireneLogger.error('SEARCH', `Enterprise lookup error: ${err.message}`, err);
  }
}

window.focusBusinessOnMap = function(siret, lat, lng, name, nafCode, nafLabel, postalCode, city, naf2025Code, naf2025Label) {
  const dropdown = document.getElementById('enterpriseLookupDropdown');
  if (dropdown) dropdown.style.display = 'none';

  if (lat && lng) {
    map.flyTo([lat, lng], 17, { duration: 1.2 });

    const icon = L.divIcon({
      className: 'biz-node-icon pulse-active',
      html: `
        <div class="biz-node-pin" style="transform:scale(1.4);">
          <div class="biz-node-dot" style="background:#10B981; box-shadow:0 0 16px #10B981;"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lng], { icon: icon }).addTo(businessMarkersLayerGroup);
    
    marker.bindPopup(`
      <div class="biz-popup">
        <div class="biz-popup-tag">Direct Verified SIRENE Match</div>
        <div class="biz-popup-title">${escapeStr(name)}</div>
        <div class="biz-popup-meta">
          <div class="biz-popup-row">
            <span class="biz-popup-label">SIRET</span>
            <span class="biz-popup-val font-mono" style="color:var(--md-sys-color-primary);">${siret}</span>
          </div>
          <div class="biz-popup-row">
            <span class="biz-popup-label">Address</span>
            <span class="biz-popup-val">${postalCode} ${city}</span>
          </div>
          <div class="biz-popup-row">
            <span class="biz-popup-label">NAF 2008</span>
            <span class="biz-popup-val"><b>${nafCode}</b> ${escapeStr(nafLabel)}</span>
          </div>
          ${naf2025Code ? `
          <div class="biz-popup-row">
            <span class="biz-popup-label" style="color:var(--md-sys-color-tertiary);">NAF 2025</span>
            <span class="biz-popup-val"><b>${naf2025Code}</b> ${escapeStr(naf2025Label)}</span>
          </div>
          ` : ''}
        </div>
        <div class="biz-popup-actions" style="margin-top:8px; display:flex; gap:6px;">
          <a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}" target="_blank" class="btn-gov-verify" style="flex:1;">
            Gouv.fr Record ↗
          </a>
          <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="btn-google-ext" style="flex:1;">
            Google Maps ↗
          </a>
        </div>
      </div>
    `).openPopup();
  } else {
    // If no coordinates, open directory modal filtered by SIRET
    openBusinessModal('', '', '', '');
    setTimeout(() => {
      const searchField = document.getElementById('bizSearchInput');
      if (searchField) {
        searchField.value = siret;
        modalState.query = siret;
        fetchAndRenderBusinesses(false);
      }
    }, 150);
  }
};
