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
    NET: 'color: #ccc2dc; font-weight: bold;',
    MAP: 'color: #81c784; font-weight: bold;',
    FILTER: 'color: #ffb74d; font-weight: bold;',
    MODAL: 'color: #eaddff; font-weight: bold;',
    THEME: 'color: #d0bcff; font-weight: bold;',
    RADAR: 'color: #efb8c8; font-weight: bold;',
    ERROR: 'color: #f2b8b5; font-weight: bold;'
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
    const colorStyle = COLORS[tag] || 'color: #cac4d0; font-weight: bold;';
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
  preset: '',
  has_enseigne: false,
  branch_type: 'all',
  workforce: 'all',
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
let isBusinessPinsActive = false;
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

  if (isBusinessPinsActive && zoom >= 11) {
    clearTimeout(viewportBizDebounce);
    viewportBizDebounce = setTimeout(() => {
      loadViewportBusinesses();
    }, 350);
  } else if (!isBusinessPinsActive) {
    // If not inspecting a specific commune/city or pin, clear markers
    if (!state.selectedCommune && !currentBizMarker && businessMarkersLayerGroup) {
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

// Dynamic Color Gradient for Business Density (Material 3 Tonal Progression)
// Follows official Material 3 primary/tonal scale: #eaddff -> #d0bcff -> #9a82db -> #6750a4 -> #381e72
function getChoroplethColor(value, maxVal) {
  if (!value || value <= 0) return '#1d1b20';

  if (state.activeMode === 'sector' && state.selectedSector) {
    const ratio = maxVal > 0 ? value / maxVal : 0;
    if (ratio > 0.60) return '#381e72'; // Tier 1: Peak Commercial Hub (M3 Deep Tone 20)
    if (ratio > 0.35) return '#6750a4'; // Tier 2: High Concentration (M3 Primary Tone 40)
    if (ratio > 0.18) return '#9a82db'; // Tier 3: Moderate Concentration (M3 Primary Tone 60)
    if (ratio > 0.06) return '#d0bcff'; // Tier 4: Moderate-Low Concentration (M3 Tone 80)
    return '#eaddff';                   // Tier 5: Low Concentration (M3 Tone 90)
  }

  // National 5-tier Quintile Scale (Equal Distribution across 96 departments)
  // Material 3 Tonal Palette: Soft Lavender (90) -> Light Purple (80) -> Purple (60) -> Primary (40) -> Deep Purple (20)
  if (value >= deptQuantiles.p80) return '#381e72'; // Tier 1: Peak Metropolises (Paris, Lyon, Marseille)
  if (value >= deptQuantiles.p60) return '#6750a4'; // Tier 2: High Regional Hubs (Bordeaux, Toulouse, Nantes)
  if (value >= deptQuantiles.p40) return '#9a82db'; // Tier 3: Moderate Commercial Hubs
  if (value >= deptQuantiles.p20) return '#d0bcff'; // Tier 4: Moderate-Low Density
  return '#eaddff';                                 // Tier 5: Sparse / Rural Baseline (<55k)
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
    ? '#d0bcff' 
    : (isGoogle ? (currentZoom >= 10 ? 'rgba(208, 188, 255, 0.25)' : '#141218') : '#444746');

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
            l.setStyle({ weight: 2, color: '#6750a4', fillOpacity: 0 });
            return;
          }
          // Darker, rich highlight for city/department hover (M3 Deep Tone #381e72 / #6750a4)
          l.setStyle({
            weight: 2.5,
            color: '#6750a4',
            fillColor: '#381e72',
            fillOpacity: 0.75
          });
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

  const btnBizPins = document.getElementById('btnToggleBizPins');
  if (btnBizPins) {
    btnBizPins.addEventListener('click', () => toggleBusinessPins());
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

  // Compact Expandable Search in Business Directory
  const filterSearchCompact = document.getElementById('filterSearchCompact');
  const btnSearchToggle = document.getElementById('btnSearchToggle');
  const bizSearchInput = document.getElementById('bizSearchInput');
  const btnClearSearchText = document.getElementById('btnClearSearchText');

  if (btnSearchToggle && filterSearchCompact && bizSearchInput) {
    btnSearchToggle.addEventListener('click', () => {
      filterSearchCompact.classList.add('is-open');
      bizSearchInput.focus();
    });

    bizSearchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      filterSearchCompact.classList.toggle('has-value', Boolean(val));
      if (btnClearSearchText) {
        btnClearSearchText.style.display = val ? 'inline-flex' : 'none';
      }
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        modalState.query = val;
        modalState.offset = 0;
        fetchAndRenderBusinesses(false);
      }, 280);
    });

    if (btnClearSearchText) {
      btnClearSearchText.addEventListener('click', () => {
        bizSearchInput.value = '';
        btnClearSearchText.style.display = 'none';
        filterSearchCompact.classList.remove('has-value', 'is-open');
        modalState.query = '';
        modalState.offset = 0;
        fetchAndRenderBusinesses(false);
      });
    }

    document.addEventListener('click', (e) => {
      if (filterSearchCompact && !filterSearchCompact.contains(e.target) && !bizSearchInput.value.trim()) {
        filterSearchCompact.classList.remove('is-open');
      }
    });
  }

  // City Dropdown Filter
  const bizCitySelect = document.getElementById('bizCitySelect');
  if (bizCitySelect) {
    bizCitySelect.addEventListener('change', (e) => {
      modalState.city = e.target.value;
      modalState.offset = 0;
      fetchAndRenderBusinesses(false);
    });
  }

  // Niche / Industry Dropdown Filter (Presets + NAF Codes)
  const bizNafSelect = document.getElementById('bizNafSelect');
  if (bizNafSelect) {
    bizNafSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val.startsWith('preset:')) {
        modalState.preset = val.replace('preset:', '');
        modalState.naf = '';
      } else {
        modalState.preset = '';
        modalState.naf = val;
      }
      modalState.offset = 0;
      fetchAndRenderBusinesses(false);
    });
  }

  // Edge-to-edge hitbox activation for all filter pills
  document.querySelectorAll('.filter-field-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const sel = pill.querySelector('select');
      if (sel && e.target !== sel) {
        if (typeof sel.showPicker === 'function') {
          try {
            sel.showPicker();
            return;
          } catch (err) {}
        }
        sel.focus();
        sel.click();
      }
    });
  });

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
    const btnVerify = document.getElementById('btnDrawerVerify') || document.getElementById('btnDrawerDossier');
    if (btnVerify) btnVerify.style.display = 'none';

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
    const btnVerify = document.getElementById('btnDrawerVerify') || document.getElementById('btnDrawerDossier');
    if (btnVerify) btnVerify.style.display = 'none';

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
        fillColor: '#6750a4',
        color: '#1d1b20',
        weight: 2.5,
        opacity: 1,
        fillOpacity: 0.90
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
  
  const activeVal = modalState.preset ? `preset:${modalState.preset}` : (modalState.naf || '');
  
  let html = `<option value="">All Niches &amp; Industries (${modalState.nichesList.length} top sectors)</option>`;

  // 1. Grouped Commercial Niche Presets
  html += `
    <optgroup label="Commercial Niche Presets">
      <option value="preset:horeca" ${activeVal === 'preset:horeca' ? 'selected' : ''}>Restaurants, Bars &amp; Hotels (HoReCa)</option>
      <option value="preset:auto" ${activeVal === 'preset:auto' ? 'selected' : ''}>Automotive, Detailing &amp; Repair</option>
      <option value="preset:health" ${activeVal === 'preset:health' ? 'selected' : ''}>Dental, Medical &amp; Spas</option>
      <option value="preset:realestate" ${activeVal === 'preset:realestate' ? 'selected' : ''}>Real Estate &amp; Renovation</option>
      <option value="preset:retail" ${activeVal === 'preset:retail' ? 'selected' : ''}>Retail Boutiques &amp; Bakeries</option>
    </optgroup>
  `;

  // 2. All Individual NAF Specific Sectors
  html += `<optgroup label="All NAF Specific Sectors">`;
  modalState.nichesList.forEach(n => {
    const isSelected = activeVal === n.code ? 'selected' : '';
    const labelShort = n.label.length > 44 ? n.label.substring(0, 44) + '...' : n.label;
    html += `
      <option value="${n.code}" ${isSelected}>
        [${n.code}] ${escapeStr(labelShort)} (${n.total.toLocaleString('en-US')})
      </option>
    `;
  });
  html += `</optgroup>`;

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
  const p = {
    dept: modalState.dept,
    city: modalState.city,
    naf: modalState.naf,
    q: modalState.query
  };
  if (modalState.preset) p.preset = modalState.preset;
  if (modalState.has_enseigne) p.has_enseigne = 'true';
  if (modalState.branch_type && modalState.branch_type !== 'all') p.branch_type = modalState.branch_type;
  if (modalState.workforce && modalState.workforce !== 'all') p.workforce = modalState.workforce;
  const params = new URLSearchParams(p);
  exportBtn.href = `/api/businesses/export?${params.toString()}`;
}

function setAdPreset(preset) {
  modalState.preset = preset;
  if (preset) {
    modalState.naf = '';
    const nafSelect = document.getElementById('bizNafSelect');
    if (nafSelect) nafSelect.value = `preset:${preset}`;
  } else {
    const nafSelect = document.getElementById('bizNafSelect');
    if (nafSelect) nafSelect.value = '';
  }
  modalState.offset = 0;
  fetchAndRenderBusinesses(false);
}

function toggleLeadEnseigne() {
  modalState.has_enseigne = !modalState.has_enseigne;
  const select = document.getElementById('selectBranchType');
  if (select) {
    select.value = modalState.has_enseigne ? 'storefront' : 'all';
  }
  modalState.offset = 0;
  fetchAndRenderBusinesses(false);
}

function onBranchTypeChange(val) {
  if (val === 'storefront') {
    modalState.has_enseigne = true;
    modalState.branch_type = 'all';
  } else {
    modalState.has_enseigne = false;
    modalState.branch_type = val;
  }
  modalState.offset = 0;
  fetchAndRenderBusinesses(false);
}

function onWorkforceChange(val) {
  modalState.workforce = val;
  modalState.offset = 0;
  SireneLogger.info('MODAL', `Workforce filter set to ${val}`);
  fetchAndRenderBusinesses(false);
}

/* Material 3 Active Filter Feed Engine */
function renderActiveFilters() {
  const container = document.getElementById('activeChipsList');
  const btnReset = document.getElementById('btnClearAllFilters');
  const feedCount = document.getElementById('bizCountFeed');
  if (!container) return;

  const chips = [];

  // 1. City
  if (modalState.city) {
    chips.push({
      type: 'city',
      label: `City: ${escapeStr(modalState.city)}`
    });
  }

  // 2. Niche / Preset
  if (modalState.preset) {
    const presetLabels = {
      'horeca': 'HoReCa (Restaurants & Bars)',
      'auto': 'Automotive & Repair',
      'health': 'Dental & Medical',
      'realestate': 'Real Estate',
      'retail': 'Retail & Fashion'
    };
    chips.push({
      type: 'niche',
      label: `Niche: ${presetLabels[modalState.preset] || modalState.preset}`
    });
  } else if (modalState.naf) {
    chips.push({
      type: 'niche',
      label: `NAF: ${modalState.naf}`
    });
  }

  // 3. Workforce / Staff
  if (modalState.workforce && modalState.workforce !== 'all') {
    const wfLabels = {
      'with_staff': 'With Staff (1+)',
      '10_plus': 'SMB (10+ Staff)',
      '50_plus': 'Large Target (50+)',
      'micro': 'Solo / Micro'
    };
    chips.push({
      type: 'workforce',
      label: `Staff: ${wfLabels[modalState.workforce] || modalState.workforce}`
    });
  }

  // 4. Presence / Type
  if (modalState.has_enseigne) {
    chips.push({
      type: 'branch_type',
      label: `Type: Storefront Sign`
    });
  } else if (modalState.branch_type && modalState.branch_type !== 'all') {
    const typeLabels = {
      'secondary': 'Branches & Outlets',
      'siege': 'Headquarters (Sièges)'
    };
    chips.push({
      type: 'branch_type',
      label: `Type: ${typeLabels[modalState.branch_type] || modalState.branch_type}`
    });
  }

  // 5. Query
  if (modalState.query) {
    chips.push({
      type: 'query',
      label: `Search: "${escapeStr(modalState.query)}"`
    });
  }

  // Render chips HTML
  if (chips.length === 0) {
    container.innerHTML = `<span style="color:var(--md-sys-color-outline); font-size:0.72rem; font-style:italic;">All businesses in department (no sub-filters active)</span>`;
    if (btnReset) btnReset.style.display = 'none';
  } else {
    container.innerHTML = chips.map(c => `
      <span class="active-chip">
        <span class="active-chip-label">${c.label}</span>
        <button class="active-chip-remove" onclick="removeActiveFilter('${c.type}')" title="Remove filter">✕</button>
      </span>
    `).join('');
    if (btnReset) btnReset.style.display = 'inline-block';
  }

  // Visual pills highlight
  const cityPill = document.getElementById('bizCitySelect')?.closest('.filter-field-pill');
  if (cityPill) cityPill.classList.toggle('has-value', !!modalState.city);

  const nafPill = document.getElementById('bizNafSelect')?.closest('.filter-field-pill');
  if (nafPill) nafPill.classList.toggle('has-value', !!(modalState.preset || modalState.naf));

  const wfPill = document.getElementById('selectWorkforce')?.closest('.filter-field-pill');
  if (wfPill) wfPill.classList.toggle('has-value', !!(modalState.workforce && modalState.workforce !== 'all'));

  const typePill = document.getElementById('selectBranchType')?.closest('.filter-field-pill');
  if (typePill) typePill.classList.toggle('has-value', !!(modalState.has_enseigne || (modalState.branch_type && modalState.branch_type !== 'all')));

  // Summary count in feed
  if (feedCount && modalState.total !== undefined) {
    feedCount.textContent = `${modalState.total.toLocaleString('en-US')} establishments found`;
  }
}

function removeActiveFilter(type) {
  if (type === 'city') {
    modalState.city = '';
    const sel = document.getElementById('bizCitySelect');
    if (sel) sel.value = '';
  } else if (type === 'niche') {
    modalState.preset = '';
    modalState.naf = '';
    const sel = document.getElementById('bizNafSelect');
    if (sel) sel.value = '';
  } else if (type === 'workforce') {
    modalState.workforce = 'all';
    const sel = document.getElementById('selectWorkforce');
    if (sel) sel.value = 'all';
  } else if (type === 'branch_type') {
    modalState.branch_type = 'all';
    modalState.has_enseigne = false;
    const sel = document.getElementById('selectBranchType');
    if (sel) sel.value = 'all';
  } else if (type === 'query') {
    modalState.query = '';
    const inp = document.getElementById('bizSearchInput');
    if (inp) inp.value = '';
    const sc = document.getElementById('filterSearchCompact');
    if (sc) sc.classList.remove('has-value', 'is-open');
    const clr = document.getElementById('btnClearSearchText');
    if (clr) clr.style.display = 'none';
  }
  modalState.offset = 0;
  fetchAndRenderBusinesses(false);
}

function resetAllFilters() {
  modalState.city = '';
  modalState.preset = '';
  modalState.naf = '';
  modalState.workforce = 'all';
  modalState.branch_type = 'all';
  modalState.has_enseigne = false;
  modalState.query = '';

  const citySel = document.getElementById('bizCitySelect');
  if (citySel) citySel.value = '';
  const nafSel = document.getElementById('bizNafSelect');
  if (nafSel) nafSel.value = '';
  const wfSel = document.getElementById('selectWorkforce');
  if (wfSel) wfSel.value = 'all';
  const typeSel = document.getElementById('selectBranchType');
  if (typeSel) typeSel.value = 'all';
  const searchInp = document.getElementById('bizSearchInput');
  if (searchInp) searchInp.value = '';
  const sc = document.getElementById('filterSearchCompact');
  if (sc) sc.classList.remove('has-value', 'is-open');
  const clr = document.getElementById('btnClearSearchText');
  if (clr) clr.style.display = 'none';

  modalState.offset = 0;
  fetchAndRenderBusinesses(false);
}

/* Material 3 Authentic Popup HTML Generator */
function createBusinessPopupHtml({
  siret,
  name,
  address,
  nafCode,
  nafLabel,
  enseigne,
  isClosed = false,
  presenceLabel = '',
  svUrl = '',
  gmapsUrl = '',
  govUrl = '',
  lat = null,
  lng = null
}) {
  const safeName = escapeStr(name || 'Unknown Business');
  const safeAddress = escapeStr(address || 'Address on file');
  const safeNaf = escapeStr(nafCode || '');
  const safeNafLabel = escapeStr(nafLabel || 'Commercial activity');
  const safeEnseigne = escapeStr(enseigne || '');
  
  const streetView = svUrl || (lat && lng ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}` : '#');
  const gMaps = gmapsUrl || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(safeName + ' ' + (address || ''))}`);
  const gGov = govUrl || `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;

  return `
    <div class="m3-popup-card">
      <div class="m3-popup-header">
        <div class="m3-popup-badges">
          <span class="m3-status-chip ${isClosed ? 'is-closed' : 'is-active'}">
            <span class="m3-status-dot"></span>
            ${isClosed ? 'Closed' : 'Active'}
          </span>
          ${presenceLabel ? `<span class="m3-presence-chip">${escapeStr(presenceLabel)}</span>` : ''}
        </div>
        ${safeNaf ? `<span class="m3-naf-tag" title="${safeNafLabel}">${safeNaf}</span>` : ''}
      </div>

      <div class="m3-popup-body">
        <h4 class="m3-popup-title" title="${safeName}">${safeName}</h4>
        ${safeEnseigne && safeEnseigne !== safeName ? `
          <div class="m3-popup-enseigne">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span>Sign: ${safeEnseigne}</span>
          </div>` : ''}
        <div class="m3-popup-subtitle">${safeNafLabel}</div>
      </div>

      <div class="m3-popup-details">
        <div class="m3-detail-item" onclick="copySiretToClipboard('${siret}', event)" title="Click to copy SIRET">
          <svg class="m3-detail-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span class="m3-detail-text font-mono">${siret}</span>
          <span class="m3-copy-hint">Copy</span>
        </div>
        <div class="m3-detail-item">
          <svg class="m3-detail-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          <span class="m3-detail-text">${safeAddress}</span>
        </div>
      </div>

      <div class="m3-popup-actions">
        <a href="${gGov}" target="_blank" rel="noopener noreferrer" class="m3-popup-btn m3-popup-btn-primary" title="Vérifier sur l'Annuaire officiel des Entreprises (data.gouv.fr)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <polyline points="9 12 11 14 15 10"></polyline>
          </svg>
          <span>Verify</span>
        </a>
        <a href="${streetView}" target="_blank" rel="noopener noreferrer" class="m3-popup-btn m3-popup-btn-tonal" title="Street View 360°">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          <span>360° View</span>
        </a>
        <a href="${gMaps}" target="_blank" rel="noopener noreferrer" class="m3-popup-btn m3-popup-btn-tonal" title="Open in Google Maps">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          <span>Maps</span>
        </a>
      </div>
    </div>
  `;
}

window.setAdPreset = setAdPreset;
window.toggleLeadEnseigne = toggleLeadEnseigne;
window.onBranchTypeChange = onBranchTypeChange;
window.onWorkforceChange = onWorkforceChange;
window.renderActiveFilters = renderActiveFilters;
window.removeActiveFilter = removeActiveFilter;
window.resetAllFilters = resetAllFilters;
window.createBusinessPopupHtml = createBusinessPopupHtml;

window.copySiretToClipboard = function(siret, evt) {
  if (evt) evt.stopPropagation();
  if (!siret) return;
  navigator.clipboard.writeText(siret).then(() => {
    SireneLogger.info('SYSTEM', `Copied SIRET ${siret} to clipboard`);
  }).catch(() => {});
};

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
    tbody.innerHTML = `<tr><td colspan="6" class="loading-state">Querying French National Registry & Lead Intelligence...</td></tr>`;
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
    if (modalState.preset) {
      url += `&preset=${encodeURIComponent(modalState.preset)}`;
    } else if (modalState.naf) {
      url += `&naf=${encodeURIComponent(modalState.naf)}`;
    }
    if (modalState.has_enseigne) {
      url += `&has_enseigne=true`;
    }
    if (modalState.branch_type && modalState.branch_type !== 'all') {
      url += `&branch_type=${encodeURIComponent(modalState.branch_type)}`;
    }
    if (modalState.workforce && modalState.workforce !== 'all') {
      url += `&workforce=${encodeURIComponent(modalState.workforce)}`;
    }
    if (modalState.query) {
      url += `&q=${encodeURIComponent(modalState.query)}`;
    }

    SireneLogger.info('MODAL', `Fetching businesses page [offset=${offsetVal}, limit=${limitVal}]`, { dept: modalState.dept, city: modalState.city, naf: modalState.naf, preset: modalState.preset, workforce: modalState.workforce, query: modalState.query });
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();

    modalState.total = data.total;
    modalState.loadedCount += data.items.length;
    SireneLogger.info('MODAL', `Loaded ${data.items.length} businesses (total: ${data.total})`);

    const summaryEl = document.getElementById('bizCountSummary');
    if (summaryEl) {
      summaryEl.textContent = `Showing ${modalState.loadedCount.toLocaleString('en-US')} of ${modalState.total.toLocaleString('en-US')} total establishments`;
    }

    renderActiveFilters();

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
      tbody.innerHTML = `<tr><td colspan="6" class="loading-state">No matching businesses found in this niche / criteria.</td></tr>`;
      modalState.isLoading = false;
      return;
    }

    const rowsHtml = data.items.map(b => {
      const isClosed = b.is_closed;
      const statusBadge = isClosed 
        ? `<span class="badge-status-closed">Closed</span>`
        : '';

      const branchBadge = b.is_siege 
        ? `<span class="badge-branch-tag badge-role-siege" title="Registered corporate headquarters">Siège</span>`
        : `<span class="badge-branch-tag badge-role-branch" title="Operating physical branch / outlet">Branch</span>`;

      const presenceType = b.presence_type || (b.has_enseigne ? 'storefront' : (b.is_siege ? 'siege' : 'branch'));
      const presenceLabel = b.presence_label || (b.has_enseigne ? 'Physical Storefront' : (b.is_siege ? 'Headquarters' : 'Operating Branch'));
      const presenceDesc = b.presence_desc || '';

      // Workforce and revenue factual labels

      const streetViewLink = b.has_gps ? `
        <a href="${b.street_view_url || `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${b.lat},${b.lng}`}" target="_blank" rel="noopener" class="btn-table-action btn-streetview" title="Inspect storefront in Google Street View 360°">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
            <path d="M2 12h20"></path>
          </svg>
          <span>360°</span>
        </a>
      ` : '';

      const fullAddressStr = `${b.street_address ? b.street_address + ', ' : ''}${b.postal_code || ''} ${b.city || ''}`.trim();

      const actionBtn = `
        <div class="biz-actions-cell">
          ${b.has_gps ? `
            <button class="btn-table-action btn-locate" onclick="pinBusinessOnMap('${b.siret}', ${b.lat}, ${b.lng}, '${escapeStr(b.name)}', '${escapeStr(fullAddressStr)}', '${b.naf_code}', '${escapeStr(b.naf_label)}', '${escapeStr(b.enseigne || '')}', '${escapeStr(b.google_maps_url || '')}', '${escapeStr(b.gov_verify_url)}', '${escapeStr(b.street_view_url || '')}', '${escapeStr(b.status || '')}')" title="Locate on Leaflet map">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>Locate</span>
            </button>
            ${streetViewLink}
          ` : `<span class="biz-no-gps">No GPS</span>`}
          <a class="btn-table-action btn-verify" href="${b.gov_verify_url || ('https://annuaire-entreprises.data.gouv.fr/etablissement/' + b.siret)}" target="_blank" rel="noopener noreferrer" title="Vérifier sur l'Annuaire officiel des Entreprises (data.gouv.fr)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <polyline points="9 12 11 14 15 10"></polyline>
            </svg>
            <span>Verify</span>
          </a>
        </div>
      `;

      const streetLine = b.street_address ? `<div class="biz-street-address">${escapeStr(b.street_address)}</div>` : '';
      const compLine = b.complement_address ? `<div class="biz-complement-address">${escapeStr(b.complement_address)}</div>` : '';

      return `
        <tr class="${isClosed ? 'biz-row-closed' : ''}">
          <td class="biz-name-cell">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; flex-wrap:wrap;">
              <span class="biz-name-main">${escapeStr(b.name)}</span>
              ${statusBadge}
            </div>
            ${b.enseigne && b.enseigne !== b.name ? `
              <div class="biz-name-sub">
                <span class="trade-sign-tag">Sign</span>
                <span class="trade-sign-val">${escapeStr(b.enseigne)}</span>
              </div>
            ` : ''}
          </td>
          <td>
            <div class="biz-siret-wrap">
              <span class="biz-siret-chip font-mono" onclick="copySiretToClipboard('${b.siret}', event)" title="Click to copy SIRET">
                ${b.siret}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </span>
              ${branchBadge}
            </div>
          </td>
          <td>
            <div class="biz-location-wrap">
              ${streetLine}
              ${compLine}
              <div class="biz-location-city">${escapeStr(b.postal_code || '')} ${escapeStr(b.city || 'N/A')}</div>
              <div class="biz-location-tags">
                <span class="badge-presence badge-presence-${presenceType}" title="${escapeStr(presenceDesc)}">${escapeStr(presenceLabel)}</span>
              </div>
            </div>
          </td>
          <td>
            <div class="biz-industry-wrap">
              <div class="biz-industry-row">
                <span class="badge-naf">${b.naf_code}</span>
                <span class="biz-industry-title">${escapeStr(b.naf_label)}</span>
              </div>
            </div>
          </td>
          <td>
            <div class="biz-staff-info">
              <div class="biz-workforce-tag">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                <span>${escapeStr(b.workforce_label || 'Solo Operator')}</span>
              </div>
              <div class="biz-turnover-tag">
                <span class="fin-prefix">Est. Turnover:</span>
                <span class="fin-value">${escapeStr(b.est_revenue || '< 150k €')}</span>
              </div>
            </div>
          </td>
          <td class="biz-actions-td">${actionBtn}</td>
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
      tbody.innerHTML = `<tr><td colspan="6" class="loading-state">Error loading businesses: ${escapeStr(err.message)}</td></tr>`;
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
   Official French Registry Verification (Annuaire des Entreprises - data.gouv.fr)
   ========================================================================== */
window.verifyBusiness = function(siret) {
  if (!siret) return;
  const cleanSiret = String(siret).replace(/\s+/g, '');
  SireneLogger.info('VERIFY', `Opening official French registry verification for SIRET ${cleanSiret}`);
  window.open(`https://annuaire-entreprises.data.gouv.fr/etablissement/${cleanSiret}`, '_blank', 'noopener,noreferrer');
};
window.openDossier = window.verifyBusiness;

/* ==========================================================================
   Pin Individual Business on Genuine Google Map
   ========================================================================== */
function pinBusinessOnMap(siret, lat, lng, name, address, nafCode, nafLabel, enseigne, googleUrl, govUrl, streetViewUrl, status) {
  SireneLogger.info('MAP', `Pinning business ${siret} on map: "${name}"`, { lat, lng });
  document.getElementById('bizModal').style.display = 'none';

  if (currentBizMarker) {
    map.removeLayer(currentBizMarker);
  }

  const isClosed = Boolean(status && (status.toLowerCase().includes('closed') || status === 'F'));
  const statusPill = isClosed
    ? `<span class="badge-status-closed"><span class="live-dot" style="background:#B3261E;"></span>Closed / Fermé</span>`
    : `<span class="popup-status-pill"><span class="live-dot"></span>Active Target</span>`;

  const svUrl = streetViewUrl || `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  const gMapsUrl = googleUrl || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const gGovUrl = govUrl || `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;

  const icon = L.divIcon({
    className: 'custom-biz-pin',
    html: `<div class="pin-pulse" style="${isClosed ? 'background:rgba(179,38,30,0.4);' : ''}"></div><div class="pin-dot" style="${isClosed ? 'background:#B3261E;' : ''}"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  currentBizMarker = L.marker([lat, lng], { icon: icon }).addTo(map);

  currentBizMarker.bindPopup(createBusinessPopupHtml({
    siret,
    name,
    address,
    nafCode,
    nafLabel,
    enseigne,
    isClosed,
    presenceLabel: isClosed ? 'Closed Establishment' : 'Verified Business',
    svUrl,
    gmapsUrl,
    govUrl,
    lat,
    lng
  }), {
    offset: [0, -8],
    maxWidth: 320
  }).openPopup();

  map.flyTo([lat, lng], 17, { duration: 1.2 });

  // Store active parking target
  activeParkingTarget = { siret, lat, lng, name, address, nafCode, nafLabel, googleUrl: gMapsUrl, govUrl: gGovUrl, streetViewUrl: svUrl };

  // Update Drawer to show Business Profile & Truck Parking Radar
  showBusinessInInspector(siret, lat, lng, name, address, nafCode, nafLabel, gMapsUrl, gGovUrl, svUrl, isClosed);

  // If Parking Radar is enabled, scan nearby spots
  if (isParkingRadarActive) {
    loadNearbyParkings(lat, lng, name, activeParkingRadius);
  }
}

/* ==========================================================================
   Business Inspector Drawer & Truck Logistics Integration
   ========================================================================== */
function showBusinessInInspector(siret, lat, lng, name, address, nafCode, nafLabel, googleUrl, govUrl, streetViewUrl, isClosed) {
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
  if (countEl) {
    if (isClosed) {
      countEl.textContent = 'Permanently Closed';
      countEl.style.color = '#B3261E';
    } else {
      countEl.textContent = 'Active Target';
      countEl.style.color = '#1B5E20';
    }
  }

  const geocodedEl = document.getElementById('inspectorGeocoded');
  if (geocodedEl) geocodedEl.textContent = 'Verified WGS84';

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

  const btnVerify = document.getElementById('btnDrawerVerify') || document.getElementById('btnDrawerDossier');
  if (btnVerify) {
    btnVerify.style.display = 'inline-flex';
    const targetGovUrl = govUrl || `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;
    if (btnVerify.tagName.toLowerCase() === 'a') {
      btnVerify.href = targetGovUrl;
    } else {
      btnVerify.onclick = () => window.verifyBusiness(siret);
    }
  }

  let btnStreetView = document.getElementById('btnDrawerStreetView');
  if (!btnStreetView) {
    btnStreetView = document.createElement('a');
    btnStreetView.id = 'btnDrawerStreetView';
    btnStreetView.target = '_blank';
    btnStreetView.className = 'btn-drawer-export';
    btnStreetView.style.cssText = 'color: #F57C00; background: rgba(245, 124, 0, 0.12); border-color: rgba(245, 124, 0, 0.35); text-decoration: none;';
    btnStreetView.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
      Street View
    `;
    const actions = document.querySelector('.drawer-actions');
    if (actions) actions.insertBefore(btnStreetView, actions.firstChild);
  }
  if (btnStreetView) {
    btnStreetView.href = streetViewUrl || `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  }

  const details = document.getElementById('inspectorDetails');
  if (details) {
    details.innerHTML = `
      <div id="inspectorFinancialBlock"></div>
      <div id="inspectorBranchesBlock"></div>
      <div id="inspectorParkingBlock"></div>
    `;
  }

  loadBusinessFinancialEnrichment(siret);
  loadBusinessBranches(siret);

  // Initial placeholder while parking radar queries Overpass
  renderParkingDrawerPanel(name, activeParkingRadius, null, true);
}

async function loadBusinessFinancialEnrichment(siret) {
  const block = document.getElementById('inspectorFinancialBlock');
  if (!block) return;
  try {
    const res = await apiFetch(`/api/business/${siret}/enrich`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.enriched) return;

    let caStr = 'Awaiting filing';
    if (data.turnover) {
      caStr = `${Math.round(data.turnover).toLocaleString('fr-FR')} €`;
      if (data.latest_fiscal_year) caStr += ` <span style="font-size:0.68rem; color:var(--md-sys-color-outline); font-weight:400;">(${data.latest_fiscal_year})</span>`;
    }

    let profitStr = 'Confidential';
    let profitColor = 'var(--md-sys-color-on-surface-variant)';
    if (data.net_profit !== null && data.net_profit !== undefined && data.net_profit !== 0) {
      profitStr = `${Math.round(data.net_profit).toLocaleString('fr-FR')} €`;
      profitColor = data.net_profit > 0 ? '#1B5E20' : '#B3261E';
    }

    let dirHtml = '';
    if (data.dirigeants && data.dirigeants.length > 0) {
      dirHtml = data.dirigeants.map(d => `
        <div style="font-size:0.72rem; color:var(--md-sys-color-on-surface); margin-top:2px;">
          <b style="font-weight:600;">${escapeStr(d.name)}</b> <span style="font-size:0.68rem; color:var(--md-sys-color-outline);">(${escapeStr(d.role)})</span>
        </div>
      `).join('');
    }

    block.innerHTML = `
      <div class="drawer-enrich-card">
        <div class="drawer-enrich-header">
          <div style="display:flex; align-items:center; gap:5px; font-size:0.75rem; font-weight:600; color:var(--md-sys-color-primary);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Verified Financials &amp; Governance</span>
          </div>
          <span class="badge-role-siege" style="font-size:0.62rem; padding:2px 6px;">DGFiP / INPI</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:6px;">
          <div class="drawer-stat-mini">
            <span style="font-size:0.66rem; color:var(--md-sys-color-on-surface-variant); text-transform:uppercase;">Turnover (CA)</span>
            <span style="font-size:0.88rem; font-weight:700; color:var(--md-sys-color-on-surface);">${caStr}</span>
          </div>
          <div class="drawer-stat-mini">
            <span style="font-size:0.66rem; color:var(--md-sys-color-on-surface-variant); text-transform:uppercase;">Net Result</span>
            <span style="font-size:0.88rem; font-weight:700; color:${profitColor};">${profitStr}</span>
          </div>
        </div>
        ${dirHtml ? `<div style="margin-top:8px; border-top:1px solid var(--md-sys-color-outline-variant); padding-top:6px;"><span style="font-size:0.66rem; color:var(--md-sys-color-on-surface-variant); text-transform:uppercase; font-weight:600;">Corporate Officers:</span>${dirHtml}</div>` : ''}
      </div>
    `;
  } catch (e) {
    SireneLogger.debug('ENRICH', `Enrichment card skipped: ${e.message}`);
  }
}

async function loadBusinessBranches(siret) {
  const block = document.getElementById('inspectorBranchesBlock');
  if (!block) return;
  try {
    const res = await apiFetch(`/api/business/${siret}/locations`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.locations || data.locations.length <= 1) return;

    const locItems = data.locations.filter(l => !l.is_current).slice(0, 3);
    if (locItems.length === 0) return;

    block.innerHTML = `
      <div class="drawer-branches-card">
        <div class="drawer-enrich-header">
          <div style="display:flex; align-items:center; gap:5px; font-size:0.75rem; font-weight:600; color:var(--md-sys-color-secondary);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            <span>Other Operating Locations (${data.count})</span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">
          ${locItems.map(l => `
            <div class="branch-jump-item" onclick="map.flyTo([${l.lat}, ${l.lng}], 18); showBusinessInInspector('${l.siret}', ${l.lat}, ${l.lng}, '${escapeStr(l.name)}', '${escapeStr(l.postal_code || '')} ${escapeStr(l.city || '')}', '', '', '', '', '', false);" title="Jump to this physical branch on map">
              <div style="font-size:0.74rem; font-weight:600; color:var(--md-sys-color-on-surface);">
                ${l.enseigne ? `<span class="trade-sign-tag" style="margin-right:4px;">Store</span>${escapeStr(l.enseigne)}` : escapeStr(l.name)}
              </div>
              <div style="font-size:0.68rem; color:var(--md-sys-color-on-surface-variant); display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                <span>${escapeStr(l.postal_code || '')} ${escapeStr(l.city || '')}</span>
                <span style="color:var(--md-sys-color-primary); font-weight:600;">Jump →</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    SireneLogger.debug('BRANCHES', `Branches card skipped: ${e.message}`);
  }
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
    color: '#ccc2dc',
    fillColor: '#ccc2dc',
    fillOpacity: 0.1,
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
  const container = document.getElementById('inspectorParkingBlock') || document.getElementById('inspectorDetails');
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
    <div style="font-size:0.73rem; color:var(--md-sys-color-on-surface-variant); text-align:center; padding:12px;">
      No registered parking spots found within ${radius}m.<br>
      <span style="font-size:0.67rem; color:var(--md-sys-color-outline);">Try selecting 500m radius.</span>
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
   STEP 3: Continuous Smooth Thermal Footfall Heatmap (Real Coordinates)
   ========================================================================== */
const HEATMAP_GRADIENT = {
  0.15: 'rgba(103, 80, 164, 0.40)', // M3 Primary soft translucent baseline
  0.35: 'rgba(154, 130, 219, 0.75)', // M3 Primary Tone 60
  0.55: 'rgba(103, 80, 164, 0.95)', // M3 Primary Tone 40
  0.72: '#ffb74d',                  // M3 Warm Amber (high commercial density)
  0.88: '#f57c00',                  // M3 Vivid Orange (heavy density)
  1.00: '#b3261e'                   // M3 Error / Flame Crimson (megacity core)
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
  let baseR, baseBlur, minOp, maxVal;

  if (currentZoom <= 6) {
    // National overview: glowing city nodes
    baseR = 13; baseBlur = 13; maxVal = 1.5; minOp = 0.04;
  } else if (currentZoom === 7) {
    baseR = 14; baseBlur = 13; maxVal = 1.4; minOp = 0.04;
  } else if (currentZoom === 8) {
    baseR = 15; baseBlur = 14; maxVal = 1.3; minOp = 0.04;
  } else if (currentZoom === 9) {
    baseR = 15; baseBlur = 13; maxVal = 1.2; minOp = 0.05;
  } else if (currentZoom === 10) {
    baseR = 14; baseBlur = 12; maxVal = 1.1; minOp = 0.05;
  } else if (currentZoom === 11) {
    // City overview: viewport 100m clusters – needs enough radius to blend
    baseR = 18; baseBlur = 14; maxVal = 1.5; minOp = 0.05;
  } else if (currentZoom === 12) {
    // District level: still 100m clusters, blend well
    baseR = 16; baseBlur = 12; maxVal = 1.4; minOp = 0.06;
  } else if (currentZoom === 13) {
    baseR = 13; baseBlur = 10; maxVal = 1.3; minOp = 0.06;
  } else if (currentZoom === 14) {
    // Individual establishments appear – start tightening
    baseR = 9; baseBlur = 7; maxVal = 1.0; minOp = 0.07;
  } else if (currentZoom === 15) {
    // High zoom: tight commercial ribbons along streets
    baseR = 7; baseBlur = 5; maxVal = 0.9; minOp = 0.08;
  } else {
    // Street/parcel level: individual building halos
    baseR = 5; baseBlur = 4; maxVal = 0.8; minOp = 0.09;
  }

  const finalR    = Math.max(4, Math.round(baseR    * heatmapRadiusMultiplier));
  const finalBlur = Math.max(3, Math.round(baseBlur * heatmapRadiusMultiplier));
  return {
    radius:     finalR,
    blur:       finalBlur,
    maxZoom:    currentZoom,
    minOpacity: minOp,
    max:        maxVal
  };
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

  // At zoom ≥ 11 (city/district level), national aggregates create huge blobs —
  // replace with real per-establishment viewport coordinates from the API
  if (zoom >= 11) {
    const bounds = map.getBounds();
    // Add 15% padding so panning is seamless without cutoffs at edges
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const padLat = latSpan * 0.15;
    const padLng = lngSpan * 0.15;

    const minLat = (bounds.getSouth() - padLat).toFixed(4);
    const maxLat = (bounds.getNorth() + padLat).toFixed(4);
    const minLng = (bounds.getWest() - padLng).toFixed(4);
    const maxLng = (bounds.getEast() + padLng).toFixed(4);

    try {
      SireneLogger.debug('MAP', `Updating viewport crowd heatmap for bounds [${minLat}, ${minLng}] -> [${maxLat}, ${maxLng}] (zoom ${zoom})`);
      const res = await apiFetch(`/api/crowd/heatmap?min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLng}&max_lon=${maxLng}`);
      if (!res.ok) return;
      const pts = await res.json();
      if (pts && pts.length > 0 && crowdHeatLayer) {
        crowdHeatLayer.setLatLngs(pts);
        isViewportHeatmapLoaded = true;
        SireneLogger.debug('MAP', `Applied ${pts.length} multi-resolution viewport heatmap points`);
      }
    } catch (e) {
      SireneLogger.error('MAP', `Failed to load viewport heatmap: ${e.message}`, e);
    }
  } else {
    // Revert back to calibrated national density if zoomed out (< 11)
    if (isViewportHeatmapLoaded && cachedHeatmapData && crowdHeatLayer) {
      crowdHeatLayer.setLatLngs(cachedHeatmapData);
      isViewportHeatmapLoaded = false;
      SireneLogger.debug('MAP', 'Reverted heatmap to national calibrated density');
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
  if (map.getZoom() >= 8) {
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
async function toggleBusinessPins(forceState) {
  if (typeof forceState === 'boolean') {
    isBusinessPinsActive = forceState;
  } else {
    isBusinessPinsActive = !isBusinessPinsActive;
  }
  SireneLogger.info('MAP', `Business Pins layer toggled: ${isBusinessPinsActive ? 'ON' : 'OFF'}`);

  const btn = document.getElementById('btnToggleBizPins');
  if (btn) btn.classList.toggle('active', isBusinessPinsActive);

  const miniToggle = document.getElementById('legendToggleBiz');
  if (miniToggle) {
    miniToggle.classList.toggle('off', !isBusinessPinsActive);
    const span = miniToggle.querySelector('.toggle-state-text');
    if (span) span.textContent = isBusinessPinsActive ? 'ON' : 'OFF';
  }

  const block = document.getElementById('legendBizBlock');
  if (block) {
    block.classList.toggle('is-disabled', !isBusinessPinsActive);
  }

  if (!isBusinessPinsActive) {
    if (businessMarkersLayerGroup) {
      businessMarkersLayerGroup.clearLayers();
    }
    return;
  }

  // If zoomed out, automatically zoom to active department, commune, or city center
  if (map && map.getZoom() < 12) {
    const center = map.getCenter();
    map.setView(center, 13);
  } else {
    await loadViewportBusinesses();
  }
}

async function loadViewportBusinesses() {
  if (!map || !isBusinessPinsActive) return;
  if (map.getZoom() < 11) return;

  const bounds = map.getBounds();
  const minLat = bounds.getSouth();
  const maxLat = bounds.getNorth();
  const minLng = bounds.getWest();
  const maxLng = bounds.getEast();

  try {
    SireneLogger.debug('MAP', `Loading viewport establishments at zoom ${map.getZoom()}`);
    let url = `/api/businesses/map?min_lat=${minLat}&max_lat=${maxLat}&min_lng=${minLng}&max_lng=${maxLng}&limit=120`;
    if (modalState && modalState.preset) {
      url += `&preset=${encodeURIComponent(modalState.preset)}`;
    }
    if (modalState && modalState.hasEnseigne) {
      url += `&has_enseigne=true`;
    }
    if (modalState && modalState.branchType && modalState.branchType !== 'all') {
      url += `&branch_type=${encodeURIComponent(modalState.branchType)}`;
    }
    if (state.selectedDept && !state.selectedCommune) {
      url += `&dept=${encodeURIComponent(state.selectedDept)}`;
    }

    const res = await apiFetch(url);
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
    const res = await apiFetch(`/api/businesses/map?city=${encodeURIComponent(cityName)}&dept=${encodeURIComponent(deptCode)}&limit=100`);
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

    const presenceType = b.presence_type || (b.has_enseigne ? 'storefront' : (b.is_siege ? 'siege' : 'branch'));
    const isClosed = b.is_closed;
    const pinTypeClass = isClosed ? 'pin-type-closed' : `pin-type-${presenceType}`;

    let innerSvg = '';
    if (presenceType === 'storefront') {
      innerSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>`;
    } else if (presenceType === 'siege') {
      innerSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5"><path d="M3 21h18"></path><path d="M5 21V7l8-4v18"></path></svg>`;
    } else {
      innerSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5"><circle cx="12" cy="12" r="3.5"></circle></svg>`;
    }

    const icon = L.divIcon({
      className: 'biz-node-icon',
      html: `
        <div class="biz-marker-pin ${pinTypeClass}" title="${escapeStr(b.name)}">
          <div class="biz-marker-pin-inner">
            ${innerSvg}
          </div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
      popupAnchor: [0, -20]
    });

    const marker = L.marker([b.lat, b.lng], { icon: icon });

    const presenceLabel = b.presence_label || (b.has_enseigne ? 'Physical Storefront' : (b.is_siege ? 'Headquarters' : 'Operating Branch'));
    const fullAddr = `${b.street_address ? b.street_address + ', ' : ''}${b.postal_code || ''} ${b.city || ''}`.trim();
    const svUrl = b.street_view_url || `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${b.lat},${b.lng}`;

    marker.bindTooltip(`
      <div class="biz-mini-tooltip">
        <b>${escapeStr(b.name)}</b>
        <div style="font-size:0.67rem; color:var(--md-sys-color-primary); margin-top:1px;">${escapeStr(presenceLabel)}</div>
        <div style="font-size:0.65rem; color:var(--md-sys-color-on-surface-variant);">${b.naf_code} • ${escapeStr(b.naf_label)}</div>
      </div>
    `, { direction: 'top', offset: [0, -22] });

    marker.bindPopup(createBusinessPopupHtml({
      siret: b.siret,
      name: b.name,
      address: fullAddr,
      nafCode: b.naf_code,
      nafLabel: b.naf_label,
      enseigne: b.enseigne,
      isClosed: isClosed,
      presenceLabel: presenceLabel,
      svUrl: svUrl,
      gmapsUrl: b.google_maps_url,
      govUrl: b.gov_verify_url,
      lat: b.lat,
      lng: b.lng
    }), { offset: [0, -18], maxWidth: 320 });

    marker.on('click', () => {
      showBusinessInInspector(b.siret, b.lat, b.lng, b.name, fullAddr, b.naf_code, b.naf_label, b.google_maps_url, b.gov_verify_url);
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
          <div style="padding:10px; font-size:0.75rem; color:var(--md-sys-color-on-surface-variant); text-align:center;">
            No registered establishment found for "<b>${escapeStr(query)}</b>"
          </div>`;
        dropdown.style.display = 'block';
      } else {
        dropdown.style.display = 'none';
      }
      return;
    }

    dropdown.innerHTML = `
      <div style="padding: 4px 8px 6px; font-size:0.67rem; text-transform:uppercase; color:var(--md-sys-color-on-surface-variant); font-weight:700; letter-spacing:0.04em;">
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
            ${b.has_gps ? 'Locate on Map' : 'Inspect Enterprise'} →
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
          <div class="biz-node-dot" style="background:var(--accent-emerald, #388e3c); box-shadow:0 0 16px var(--accent-emerald-glow, rgba(56, 142, 60, 0.4));"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lng], { icon: icon }).addTo(businessMarkersLayerGroup);
    
    marker.bindPopup(createBusinessPopupHtml({
      siret,
      name,
      address: `${postalCode || ''} ${city || ''}`.trim(),
      nafCode,
      nafLabel,
      isClosed: false,
      presenceLabel: 'Direct Match',
      lat,
      lng
    }), { offset: [0, -8], maxWidth: 320 });
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
