import { downloadDashboardExcel } from './dashboard-export.js';

let map;
let userMarker;
let searchMarker;
let trafficTileLayer;
let isTrafficVisible = false;
let isLayersPanelOpen = false;
let currentBaseLayerName = 'standard';
let baseLayers = {};
let currentBaseLayer;
const defaultLat = 13.6586;
const defaultLng = -89.1724;
let supabaseClient;
let isAddingPoint = false;
let pendingLatLng = null;
let controlPointMarkers = {};
let controlPointsData = {};
let agentGroupsById = {};
let currentUserGroupId = null;
const IN_PROGRESS_COLOR = '#16a34a';
const CONTROL_POINTS_REFRESH_MS = 30000;
const DISTRICTS = ['Panchimalco', 'Rosario de Mora', 'San Marcos', 'Santiago Texacuangos', 'Santo Tomás'];
let controlPointsCluster;
let viewportLoadTimeout;
const CONTROL_POINT_TYPES = {
    reten: { label: 'Retén policial', icon: 'fa-hand', color: '#2563eb' },
    accidente: { label: 'Accidente', icon: 'fa-car-burst', color: '#dc2626' },
    congestion: { label: 'Congestión', icon: 'fa-clock', color: '#f59e0b' },
    obra_vial: { label: 'Obra vial', icon: 'fa-person-digging', color: '#ea580c' },
    semaforo_danado: { label: 'Semáforo dañado', icon: 'fa-traffic-light', color: '#7c3aed' },
    otro: { label: 'Otro', icon: 'fa-circle-exclamation', color: '#6b7280' }
};
const CONTROL_POINT_DESCRIPTIONS = {
    reten: 'Control o puesto de revisión de la policía en la vía.',
    accidente: 'Choque o percance vial que puede bloquear el paso.',
    congestion: 'Tráfico lento o detenido por exceso de vehículos.',
    obra_vial: 'Trabajos en la calle: carril cerrado o paso reducido.',
    semaforo_danado: 'Semáforo apagado o que no funciona bien: cruza con precaución.',
    otro: 'Otro incidente que afecta la circulación.'
};
const EXPIRATION_HOURS = {
    reten: 6,
    accidente: 4,
    congestion: 2,
    obra_vial: 24,
    semaforo_danado: 12,
    otro: 4
};
let currentUser = null;
let currentUserRole = 'ciudadano';
let isSignupMode = false;
let isSharingLocation = false;
let locationWatchId = null;
let lastLocationSentAt = 0;
let lastSharedPosition = null;
let locationHeartbeatId = null;
let currentAccessToken = null;
const AGENT_LOCATION_HEARTBEAT_MS = 30000;
let presenceHeartbeatId = null;
let onlineUsersRefreshId = null;
const PRESENCE_HEARTBEAT_MS = 60000;
const PRESENCE_ONLINE_WINDOW_MS = 150000; // sin señal por 2.5 min = desconectado
let agentLocationMarkers = {};
let agentLocationsData = {};
const AGENT_LOCATION_STALE_MS = 2 * 60 * 1000;
let isRoutingMode = false;
let routePendingFrom = null;
let routeLine = null;
let routeFromMarker = null;
let routeToMarker = null;
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';
let routeAlternatives = [];
let selectedRouteIndex = 0;
let alternativeRouteLines = [];
let lastRouteFrom = null;
let lastRouteTo = null;
let googleMapsLoadPromise = null;
let boundaryLayer = null;
let isBoundaryVisible = true;
const BOUNDARY_GEOJSON_URL = '/data/san-salvador-sur.geojson';
let isNavigating = false;
let navigationWatchId = null;
let navigationDestination = null;
let lastNavRecalcAt = 0;
let lastNavTrafficCheckAt = 0;
let lastNavTrafficExtraSeconds = 0;
const NAVIGATION_ARRIVAL_METERS = 30;
const NAVIGATION_RECALC_MS = 10000;
const NAVIGATION_TRAFFIC_RECALC_MS = 60000;
function initMap() {
    map = L.map('map', {
        zoomControl: false
    }).setView([defaultLat, defaultLng], 14);
    baseLayers.standard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    });
    baseLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap, © CartoDB'
    });
    baseLayers.satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Imágenes © Google'
    });
    baseLayers.topographic = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '© OpenTopoMap, © OpenStreetMap contributors'
    });
    currentBaseLayer = baseLayers.standard;
    currentBaseLayer.addTo(map);
    trafficTileLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=h,traffic&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Tráfico © Google'
    });
    L.control.zoom({
        position: 'bottomleft'
    }).addTo(map);
    controlPointsCluster = L.markerClusterGroup({ maxClusterRadius: 60 });
    map.addLayer(controlPointsCluster);
    map.on('moveend', function () {
        clearTimeout(viewportLoadTimeout);
        viewportLoadTimeout = setTimeout(loadControlPointsInView, 400);
    });
    map.on('click', function (e) {
        if (isRoutingMode) {
            handleRouteModeClick(e.latlng);
            return;
        }
        if (isAddingPoint) {
            openControlPointForm(e.latlng.lat, e.latlng.lng);
            return;
        }
        closePanel();
        if (isLayersPanelOpen) {
            toggleLayersPanel();
        }
    });
}
let appStarted = false;
async function initAuth() {
    if (!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session ? session.user : null;
    currentAccessToken = session ? session.access_token : null;
    if (currentUser) {
        await fetchUserProfile();
        startApp();
    } else {
        window.location.replace('/');
        return;
    }
    updateAuthUI();
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        currentUser = session ? session.user : null;
        currentAccessToken = session ? session.access_token : null;
        if (currentUser) {
            await fetchUserProfile();
            startApp();
        } else {
            currentUserRole = 'ciudadano';
            window.location.replace('/');
        }
        updateAuthUI();
    });
}
function startApp() {
    if (appStarted) return;
    appStarted = true;
    initMap();
    loadAgentGroups().then(() => loadControlPointsInView());
    // Refresco periódico: así los demás ven cuando un punto pasa a "en proceso" o se resuelve
    setInterval(() => loadControlPointsInView(true), CONTROL_POINTS_REFRESH_MS);
    loadBoundaryLayer();
    loadAgentLocations();
    setInterval(sweepStaleAgentMarkers, 60000);
    startPresenceHeartbeat();
    setTimeout(() => locateUser(true), 500);
    fixMapSizeOnceReady();
}

// Leaflet mide el tamaño de #map en el instante en que se crea el mapa.
// Si en ese momento el CSS (styles.css, Tailwind CDN, leaflet.css) todavía
// no terminó de aplicar el layout, el mapa queda con un tamaño/posición
// incorrectos y no se autocorrige solo. Forzamos un recálculo (invalidateSize)
// en varios momentos "seguros" para que nunca dependa de que el usuario refresque.
function fixMapSizeOnceReady() {
    if (!map) return;
    // Recalcula ni bien el frame actual termina de pintar.
    requestAnimationFrame(() => map.invalidateSize());
    // Recalcula cuando TODOS los recursos externos (CSS, fuentes, CDNs) ya cargaron.
    if (document.readyState === 'complete') {
        map.invalidateSize();
    } else {
        window.addEventListener('load', () => map.invalidateSize(), { once: true });
    }
    // Red de seguridad: por si algún CSS tarda más de lo normal (dev server frío).
    setTimeout(() => map.invalidateSize(), 300);
    setTimeout(() => map.invalidateSize(), 1000);
    // Si el contenedor cambia de tamaño después (rotar el teléfono, etc.).
    window.addEventListener('resize', () => map.invalidateSize());
}
function openAuthModal() {
    const backdrop = document.getElementById('auth-modal-backdrop');
    const modal = document.getElementById('auth-modal');
    if (!backdrop || !modal) return;

    const emailEl = document.getElementById('user-profile-email');
    if (emailEl) emailEl.innerText = currentUser ? currentUser.email : 'No autenticado';

    const roleEl = document.getElementById('user-profile-role');
    if (roleEl) roleEl.innerText = currentUserRole ? currentUserRole.toUpperCase() : 'CIUDADANO';

    const name = (currentUser && currentUser.user_metadata && currentUser.user_metadata.full_name) ? currentUser.user_metadata.full_name : 'Usuario';
    const nameEl = document.getElementById('user-profile-name');
    if (nameEl) nameEl.innerText = name;

    backdrop.classList.add('active');
    modal.classList.add('active');
}
function closeAuthModal() {
    const backdrop = document.getElementById('auth-modal-backdrop');
    const modal = document.getElementById('auth-modal');
    if (backdrop) backdrop.classList.remove('active');
    if (modal) modal.classList.remove('active');
}
async function logoutUser() {
    if (supabaseClient) {
        // Quitar el punto del agente ANTES de cerrar sesión (después ya no hay permiso para borrarlo)
        stopLocationWatch();
        stopPresenceHeartbeat();
        await Promise.all([deleteOwnAgentLocation(), supabaseClient.rpc('set_presence', { p_online: false })]);
        await supabaseClient.auth.signOut();
    }
    window.location.replace('/');
}
async function fetchUserProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('role, group_id')
        .eq('id', currentUser.id)
        .single();
    currentUserRole = (!error && data) ? data.role : 'ciudadano';
    currentUserGroupId = (!error && data) ? data.group_id : null;
}
async function loadAgentGroups() {
    const { data, error } = await supabaseClient.from('agent_groups').select('id, name').order('name');
    if (error) {
        console.error('Error al cargar grupos:', error.message);
        return;
    }
    agentGroupsById = Object.fromEntries(data.map(g => [g.id, g.name]));
}
function updateAuthUI() {
    const btn = document.getElementById('auth-btn');
    const icon = btn.querySelector('i');
    if (currentUser) {
        icon.className = 'fas fa-user-check';
        btn.title = `Sesión: ${currentUser.email}`;
        btn.classList.add('logged-in');
    } else {
        icon.className = 'fas fa-user';
        btn.title = 'Iniciar sesión';
        btn.classList.remove('logged-in');
    }
    updateRoleUI();
}
function updateRoleUI() {
    const shareBtn = document.getElementById('share-location-btn');
    const canShareLocation = currentUser && ['agente', 'admin'].includes(currentUserRole);
    if (canShareLocation) {
        shareBtn.classList.remove('hidden');
    } else {
        shareBtn.classList.add('hidden');
        if (isSharingLocation) stopSharingLocation();
    }
    const adminBtn = document.getElementById('admin-panel-btn');
    if (currentUser && currentUserRole === 'admin') {
        adminBtn.classList.remove('hidden');
    } else {
        adminBtn.classList.add('hidden');
    }
    const dashboardBtn = document.getElementById('dashboard-btn');
    if (currentUser && ['agente', 'admin'].includes(currentUserRole)) {
        dashboardBtn.classList.remove('hidden');
    } else {
        dashboardBtn.classList.add('hidden');
    }
}
function openAdminPanel() {
    document.getElementById('admin-backdrop').classList.add('active');
    document.getElementById('admin-modal').classList.add('active');
    loadUserList();
    loadOnlineUsers();
    clearInterval(onlineUsersRefreshId);
    onlineUsersRefreshId = setInterval(loadOnlineUsers, 30000);
}
function closeAdminPanel() {
    document.getElementById('admin-backdrop').classList.remove('active');
    document.getElementById('admin-modal').classList.remove('active');
    clearInterval(onlineUsersRefreshId);
    onlineUsersRefreshId = null;
}
// =============================================
// Usuarios en línea (requiere supabase/schema_online_users.sql)
// =============================================
function startPresenceHeartbeat() {
    sendPresence();
    presenceHeartbeatId = setInterval(sendPresence, PRESENCE_HEARTBEAT_MS);
}
function stopPresenceHeartbeat() {
    clearInterval(presenceHeartbeatId);
    presenceHeartbeatId = null;
}
async function sendPresence() {
    if (!currentUser || !supabaseClient) return;
    const { error } = await supabaseClient.rpc('set_presence', { p_online: true });
    if (error) {
        console.warn('No se pudo registrar la presencia:', error.message);
        // Sin la migración no tiene sentido seguir intentando cada minuto
        if (error.code === 'PGRST202') stopPresenceHeartbeat();
    }
}
function formatLastSeen(isoDate) {
    if (!isoDate) return 'nunca ha entrado';
    const minutes = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return `hace ${minutes} min`;
    if (minutes < 1440) return `hace ${Math.floor(minutes / 60)} h`;
    return new Date(isoDate).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}
async function loadOnlineUsers() {
    const listEl = document.getElementById('online-users-list');
    const countEl = document.getElementById('online-users-count');
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, role, last_seen_at, is_online')
        .order('last_seen_at', { ascending: false, nullsFirst: false });
    if (error) {
        console.error('Error al cargar usuarios en línea:', error.message);
        countEl.innerText = '';
        listEl.innerHTML = `<p class="text-sm text-red-500">${error.code === '42703'
            ? 'Falta ejecutar supabase/schema_online_users.sql en el SQL Editor de Supabase.'
            : 'No se pudo cargar quién está en línea.'}</p>`;
        return;
    }
    const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
    const isOnline = (u) => u.is_online && u.last_seen_at && new Date(u.last_seen_at).getTime() > cutoff;
    const roleLabel = { ciudadano: 'Ciudadano', agente: 'Agente', admin: 'Admin' };
    const online = data.filter(isOnline);
    const offline = data.filter(u => !isOnline(u));
    countEl.innerText = `${online.length} de ${data.length}`;
    const row = (u, on) => `
        <div class="user-row">
            <span class="presence-dot ${on ? 'presence-on' : 'presence-off'}"></span>
            <span class="user-row-email">
                <b>${escapeHtml(u.full_name || u.email || u.id)}</b>${u.id === currentUser.id ? ' (tú)' : ''}<br>
                <small>${roleLabel[u.role] || u.role} · ${on ? 'en línea' : `últ. vez ${formatLastSeen(u.last_seen_at)}`}</small>
            </span>
        </div>
    `;
    listEl.innerHTML = (online.length ? online.map(u => row(u, true)).join('') : '<p class="text-sm text-gray-500">Nadie en línea.</p>')
        + (offline.length ? `
            <details class="presence-offline">
                <summary>Desconectados (${offline.length})</summary>
                ${offline.map(u => row(u, false)).join('')}
            </details>` : '');
}
async function submitCreateUser(event) {
    event.preventDefault();
    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    const btn = document.getElementById('create-user-btn');
    btn.disabled = true;
    btn.innerText = 'Creando...';
    const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await tempClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) {
        showToast(error.message, 'error');
        btn.disabled = false;
        btn.innerText = 'Crear usuario';
        return;
    }
    const district = document.getElementById('new-user-district').value || null;
    if ((role !== 'ciudadano' || district) && data.user) {
        const { error: roleError } = await supabaseClient
            .from('profiles')
            .update({ role, district })
            .eq('id', data.user.id);
        if (roleError) {
            console.error('Error al asignar rol:', roleError.message);
            showToast('Usuario creado, pero no se pudo asignar el rol. Cámbialo desde la lista.', 'error');
        }
    }
    showToast('Usuario creado correctamente.', 'success');
    document.getElementById('create-user-form').reset();
    btn.disabled = false;
    btn.innerText = 'Crear usuario';
    loadUserList();
}
async function loadUserList() {
    const listEl = document.getElementById('user-list');
    listEl.innerHTML = '<p class="text-sm text-gray-500">Cargando...</p>';
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) {
        console.error('Error al cargar usuarios:', error.message);
        listEl.innerHTML = '<p class="text-sm text-red-500">No se pudo cargar la lista.</p>';
        return;
    }
    listEl.innerHTML = data.map(user => `
        <div class="user-row">
            <span class="user-row-email" title="${user.full_name || user.email || user.id}">
                ${user.full_name ? `<b>${user.full_name}</b><br><small>${user.email}</small>` : (user.email || user.id)}
            </span>
            <select class="user-row-role-select" title="Distrito" onchange="updateUserDistrict('${user.id}', this.value)">
                <option value="">Sin distrito</option>
                ${DISTRICTS.map(d => `<option value="${d}" ${user.district === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            <select class="user-row-role-select" onchange="updateUserRole('${user.id}', this.value)">
                <option value="ciudadano" ${user.role === 'ciudadano' ? 'selected' : ''}>Ciudadano</option>
                <option value="agente" ${user.role === 'agente' ? 'selected' : ''}>Agente</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
        </div>
    `).join('');
}
async function updateUserDistrict(userId, district) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({ district: district || null })
        .eq('id', userId);
    if (error) {
        console.error('Error al actualizar distrito:', error.message);
        showToast('No se pudo actualizar el distrito.', 'error');
        return;
    }
    showToast('Distrito actualizado.', 'success');
}
async function updateUserRole(userId, newRole) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);
    if (error) {
        console.error('Error al actualizar rol:', error.message);
        showToast('No se pudo actualizar el rol.', 'error');
        return;
    }
    showToast('Rol actualizado.', 'success');
}

async function loadControlPointsInView(silent = false) {
    if (!supabaseClient) return;
    const bounds = map.getBounds();
    const { data, error } = await supabaseClient.rpc('control_points_in_bbox', {
        min_lat: bounds.getSouth(),
        min_lng: bounds.getWest(),
        max_lat: bounds.getNorth(),
        max_lng: bounds.getEast()
    });
    if (error) {
        console.error('Error al cargar puntos de control:', error.message);
        if (silent !== true) showToast('No se pudieron cargar los puntos de control.', 'error');
        return;
    }
    const idsInView = new Set(data.map(p => p.id));
    Object.keys(controlPointMarkers).forEach(id => {
        if (!idsInView.has(id)) removeControlPointMarker(id);
    });
    data.forEach(point => {
        if (!controlPointMarkers[point.id]) {
            renderControlPointMarker(point);
        } else {
            refreshControlPointMarker(point);
        }
    });
}
function removeControlPointMarker(pointId) {
    if (controlPointMarkers[pointId]) {
        controlPointsCluster.removeLayer(controlPointMarkers[pointId]);
        delete controlPointMarkers[pointId];
    }
    delete controlPointsData[pointId];
}
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function getControlPointIcon(type, inProgress) {
    const meta = CONTROL_POINT_TYPES[type] || CONTROL_POINT_TYPES.otro;
    // En proceso (ya hay alguien en el lugar): el marcador se pinta de verde
    const color = inProgress ? IN_PROGRESS_COLOR : meta.color;
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="control-point-icon${inProgress ? ' in-progress' : ''}" style="background-color:${color};"><i class="fas ${meta.icon}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });
}
function openLegendPanel() {
    const row = (color, icon, title, text) => `
        <div class="legend-row">
            <div class="control-point-icon" style="background-color:${color};"><i class="fas ${icon}"></i></div>
            <div><b>${title}</b><br><small>${text}</small></div>
        </div>`;
    document.getElementById('legend-list').innerHTML =
        Object.entries(CONTROL_POINT_TYPES).map(([key, meta]) =>
            row(meta.color, meta.icon, meta.label, CONTROL_POINT_DESCRIPTIONS[key])).join('')
        + row(IN_PROGRESS_COLOR, 'fa-location-dot', 'En proceso', 'Cualquier símbolo en verde: un agente ya está en el lugar atendiendo el punto.');
    document.getElementById('legend-backdrop').classList.add('active');
    document.getElementById('legend-modal').classList.add('active');
}
function closeLegendPanel() {
    document.getElementById('legend-backdrop').classList.remove('active');
    document.getElementById('legend-modal').classList.remove('active');
}
function renderControlPointMarker(point) {
    controlPointsData[point.id] = point;
    const marker = L.marker([point.lat, point.lng], { icon: getControlPointIcon(point.type, !!point.attention_started_at) });
    // Contenido como función: se arma cada vez que se abre, con el estado más reciente
    marker.bindPopup(() => buildControlPointPopupHtml(controlPointsData[point.id]));
    controlPointsCluster.addLayer(marker);
    controlPointMarkers[point.id] = marker;
    return marker;
}
function refreshControlPointMarker(point) {
    const previous = controlPointsData[point.id];
    const marker = controlPointMarkers[point.id];
    controlPointsData[point.id] = point;
    if (!marker || !previous) return;
    const changed = previous.attention_started_at !== point.attention_started_at
        || previous.assigned_group_id !== point.assigned_group_id
        || previous.confirmations_count !== point.confirmations_count;
    if (!changed) return;
    marker.setIcon(getControlPointIcon(point.type, !!point.attention_started_at));
    if (marker.isPopupOpen()) marker.getPopup().update();
}
function minutesBetween(fromIso, toIso) {
    return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000;
}
function formatClock(iso) {
    return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}
// Admin: siempre. Agente: si el punto no tiene grupo asignado o si es de su grupo.
function canAttendPoint(point) {
    if (!currentUser) return false;
    if (currentUserRole === 'admin') return true;
    return currentUserRole === 'agente' && (!point.assigned_group_id || point.assigned_group_id === currentUserGroupId);
}
function buildControlPointPopupHtml(point) {
    const meta = CONTROL_POINT_TYPES[point.type] || CONTROL_POINT_TYPES.otro;
    const severityLabel = { baja: 'Baja', media: 'Media', alta: 'Alta' }[point.severity] || point.severity;
    const inProgress = !!point.attention_started_at;
    const canAttend = canAttendPoint(point);
    const canResolve = canAttend || (currentUser && currentUser.id === point.reported_by);
    const groupName = point.assigned_group_id ? (agentGroupsById[point.assigned_group_id] || 'Grupo') : null;
    return `
        <div style="font-family:'Inter',sans-serif; min-width:190px;">
            <strong>${meta.label}</strong><br>
            <span style="font-size:12px; color:#6b7280;">Severidad: ${severityLabel}${point.district ? ` · ${escapeHtml(point.district)}` : ''}</span>
            ${point.description ? `<p style="margin:6px 0 0 0; font-size:13px;">${escapeHtml(point.description)}</p>` : ''}
            <p class="cp-popup-meta"><i class="fas fa-people-group"></i> ${groupName ? `Asignado a: <b>${escapeHtml(groupName)}</b>` : 'Sin grupo asignado'}</p>
            ${inProgress
            ? `<p class="cp-popup-status in-progress"><i class="fas fa-circle"></i> En proceso desde las ${formatClock(point.attention_started_at)} (${formatDuration(minutesBetween(point.attention_started_at, new Date().toISOString()))})</p>`
            : '<p class="cp-popup-status"><i class="fas fa-circle"></i> Pendiente: nadie ha llegado al lugar</p>'}
            <div class="cp-popup-actions">
                <button onclick="confirmControlPoint('${point.id}')" class="cp-popup-btn">
                    <i class="fas fa-check"></i> Confirmar (<span id="cp-count-${point.id}">${point.confirmations_count || 0}</span>)
                </button>
                ${!inProgress && canAttend ? `<button onclick="startControlPointAttention('${point.id}')" class="cp-popup-btn cp-popup-btn-start"><i class="fas fa-location-dot"></i> Ya estoy en el lugar</button>` : ''}
                ${canResolve ? `<button onclick="resolveControlPoint('${point.id}')" class="cp-popup-btn cp-popup-btn-resolve">${inProgress ? '<i class="fas fa-flag-checkered"></i> Finalizar' : 'Resuelto'}</button>` : ''}
            </div>
        </div>
    `;
}
async function startControlPointAttention(pointId) {
    const { data, error } = await supabaseClient
        .from('control_points')
        .update({ attention_started_at: new Date().toISOString() })
        .eq('id', pointId)
        .is('attention_started_at', null)
        .select();
    if (error) {
        console.error('Error al iniciar la atención:', error.message);
        showToast(error.code === '42501' ? 'Solo el grupo asignado puede atender este punto.' : 'No se pudo marcar el inicio.', 'error');
        return;
    }
    if (!data.length) {
        showToast('Alguien más ya marcó el inicio en este punto.', 'info');
        loadControlPointsInView();
        return;
    }
    refreshControlPointMarker(data[0]);
    showToast('Inicio marcado: el punto queda en proceso.', 'success');
}
async function confirmControlPoint(pointId) {
    if (!currentUser) {
        showToast('Inicia sesión para confirmar un punto.', 'info');
        openAuthModal();
        return;
    }
    const { error } = await supabaseClient
        .from('control_point_confirmations')
        .insert({ control_point_id: pointId, user_id: currentUser.id });
    if (error) {
        if (error.code === '23505') {
            showToast('Ya confirmaste este punto.', 'info');
        } else {
            console.error('Error al confirmar punto:', error.message);
            showToast('No se pudo confirmar el punto.', 'error');
        }
        return;
    }
    const countEl = document.getElementById(`cp-count-${pointId}`);
    if (countEl) countEl.innerText = parseInt(countEl.innerText, 10) + 1;
    showToast('¡Gracias por confirmar!', 'success');
}
async function resolveControlPoint(pointId) {
    const { data, error } = await supabaseClient
        .from('control_points')
        .update({ status: 'resuelto', resolved_at: new Date().toISOString() })
        .eq('id', pointId)
        .select();
    if (error) {
        console.error('Error al resolver punto:', error.message);
        showToast('No se pudo marcar el punto como resuelto.', 'error');
        return;
    }
    removeControlPointMarker(pointId);
    const point = data && data[0];
    if (point && point.resolved_at) {
        const total = formatDuration(minutesBetween(point.created_at, point.resolved_at));
        showToast(point.attention_started_at
            ? `Finalizado. En el lugar: ${formatDuration(minutesBetween(point.attention_started_at, point.resolved_at))} · activo en total: ${total}.`
            : `Punto resuelto. Estuvo activo ${total}.`, 'success');
    } else {
        showToast('Punto marcado como resuelto.', 'success');
    }
}
// =============================================
// Historial de Puntos Resueltos (por zona/fecha)
// =============================================
function openHistoryPanel() {
    document.getElementById('history-backdrop').classList.add('active');
    document.getElementById('history-modal').classList.add('active');
    if (!document.getElementById('history-from').value) {
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
        document.getElementById('history-from').value = weekAgo.toISOString().slice(0, 10);
        document.getElementById('history-to').value = today.toISOString().slice(0, 10);
    }
}
function closeHistoryPanel() {
    document.getElementById('history-backdrop').classList.remove('active');
    document.getElementById('history-modal').classList.remove('active');
}
async function loadHistory() {
    const listEl = document.getElementById('history-list');
    if (!supabaseClient) {
        listEl.innerHTML = '<p class="text-sm text-red-500">Supabase no está configurado.</p>';
        return;
    }
    const fromDate = document.getElementById('history-from').value;
    const toDate = document.getElementById('history-to').value;
    if (!fromDate || !toDate) {
        showToast('Elige un rango de fechas.', 'error');
        return;
    }
    listEl.innerHTML = '<p class="text-sm text-gray-500">Buscando...</p>';
    const bounds = map.getBounds();
    const { data, error } = await supabaseClient.rpc('resolved_control_points_in_bbox', {
        min_lat: bounds.getSouth(),
        min_lng: bounds.getWest(),
        max_lat: bounds.getNorth(),
        max_lng: bounds.getEast(),
        from_date: `${fromDate}T00:00:00Z`,
        to_date: `${toDate}T23:59:59Z`
    });
    if (error) {
        console.error('Error al cargar historial:', error.message);
        listEl.innerHTML = '<p class="text-sm text-red-500">No se pudo cargar el historial.</p>';
        return;
    }
    if (data.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-gray-500">Sin puntos resueltos en esta área y rango de fechas.</p>';
        return;
    }
    historyPointsById = Object.fromEntries(data.map(p => [p.id, p]));
    listEl.innerHTML = data.map(point => {
        const meta = CONTROL_POINT_TYPES[point.type] || CONTROL_POINT_TYPES.otro;
        const resolvedDate = point.resolved_at ? new Date(point.resolved_at).toLocaleString('es-SV') : '-';
        return `
            <div class="user-row" style="cursor:pointer; align-items:flex-start;" onclick="focusHistoryPoint('${point.id}')">
                <div style="flex:1;">
                    <strong style="font-size:13px;">${meta.label}</strong><br>
                    <span style="font-size:11px; color:#6b7280;">Resuelto: ${resolvedDate}</span>
                    ${point.resolved_at ? `<br><span style="font-size:11px; color:#6b7280;">Activo en total: ${formatDuration(minutesBetween(point.created_at, point.resolved_at))}${point.attention_started_at ? ` · en el lugar: ${formatDuration(minutesBetween(point.attention_started_at, point.resolved_at))} (desde las ${formatClock(point.attention_started_at)})` : ''}</span>` : ''}
                    ${point.assigned_group_id ? `<br><span style="font-size:11px; color:#6b7280;">Grupo: ${escapeHtml(agentGroupsById[point.assigned_group_id] || 'Grupo')}</span>` : ''}
                    ${point.description ? `<p style="margin:4px 0 0 0; font-size:12px;">${escapeHtml(point.description)}</p>` : ''}
                </div>
            </div>
        `;
    }).join('');
}
// Los puntos resueltos no están en el mapa: se muestra uno temporal para ubicarlo
let historyPointsById = {};
let historyHighlightMarker = null;
function focusHistoryPoint(pointId) {
    const point = historyPointsById[pointId];
    if (!point) return;
    closeHistoryPanel();
    if (historyHighlightMarker) map.removeLayer(historyHighlightMarker);
    const meta = CONTROL_POINT_TYPES[point.type] || CONTROL_POINT_TYPES.otro;
    const district = point.district ? ` · ${escapeHtml(point.district)}` : '';
    historyHighlightMarker = L.marker([point.lat, point.lng], { icon: getControlPointIcon(point.type, false), opacity: 0.85 })
        .addTo(map)
        .bindPopup(`<div style="font-family:'Inter',sans-serif;"><strong>${meta.label}</strong> (resuelto)<br><span style="font-size:12px; color:#6b7280;">${point.resolved_at ? new Date(point.resolved_at).toLocaleString('es-SV') : ''}${district}</span></div>`);
    map.flyTo([point.lat, point.lng], 17);
    map.once('moveend', () => historyHighlightMarker && historyHighlightMarker.openPopup());
    historyHighlightMarker.on('popupclose', () => {
        if (historyHighlightMarker) map.removeLayer(historyHighlightMarker);
        historyHighlightMarker = null;
    });
}
// =============================================
// Dashboard de Atención a Reportes + Grupos de Agentes
// (requiere supabase/schema_dashboard_groups.sql)
// =============================================
const DASHBOARD_MAX_DAYS = 92;
let lastDashboardExport = null; // { stats, fromDate, toDate } de lo que se ve en pantalla
const DASHBOARD_MISSING_SQL = 'Falta ejecutar supabase/schema_dashboard_groups.sql en el SQL Editor de Supabase.';
function openDashboard() {
    document.getElementById('dashboard-backdrop').classList.add('active');
    document.getElementById('dashboard-modal').classList.add('active');
    if (!document.getElementById('dashboard-from').value) {
        const today = new Date();
        const monthAgo = new Date(today.getTime() - 29 * 24 * 3600 * 1000);
        document.getElementById('dashboard-from').value = toDateInputValue(monthAgo);
        document.getElementById('dashboard-to').value = toDateInputValue(today);
    }
    loadDashboard();
}
function closeDashboard() {
    document.getElementById('dashboard-backdrop').classList.remove('active');
    document.getElementById('dashboard-modal').classList.remove('active');
}
function toDateInputValue(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function isMissingDashboardSchema(error) {
    return ['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(error.code);
}
function formatDuration(minutes) {
    if (minutes == null) return '—';
    const total = Math.round(minutes);
    if (total < 60) return `${total} min`;
    if (total < 1440) return `${Math.floor(total / 60)} h ${total % 60} min`;
    return `${Math.floor(total / 1440)} d ${Math.floor((total % 1440) / 60)} h`;
}
async function loadDashboard() {
    const contentEl = document.getElementById('dashboard-content');
    const fromDate = document.getElementById('dashboard-from').value;
    const toDate = document.getElementById('dashboard-to').value;
    if (!fromDate || !toDate || fromDate > toDate) {
        showToast('Elige un rango de fechas válido.', 'error');
        return;
    }
    const from = new Date(`${fromDate}T00:00:00`);
    const to = new Date(`${toDate}T23:59:59.999`);
    if ((to - from) / (24 * 3600 * 1000) > DASHBOARD_MAX_DAYS) {
        showToast(`El rango máximo es de ${DASHBOARD_MAX_DAYS} días.`, 'error');
        return;
    }
    contentEl.innerHTML = '<p class="text-sm text-gray-500">Cargando...</p>';
    lastDashboardExport = null;
    document.getElementById('dashboard-export-btn').disabled = true;
    const { data, error } = await supabaseClient.rpc('attention_stats', {
        from_date: from.toISOString(),
        to_date: to.toISOString()
    });
    if (error) {
        console.error('Error al cargar estadísticas:', error.message);
        contentEl.innerHTML = `<p class="text-sm text-red-500">${isMissingDashboardSchema(error) ? DASHBOARD_MISSING_SQL : 'No se pudieron cargar las estadísticas.'}</p>`;
        return;
    }
    // Opcional: si aún no se ejecutó schema_districts.sql, el dashboard sigue funcionando sin esta sección
    const { data: byDistrict } = await supabaseClient.rpc('attention_by_district', {
        from_date: from.toISOString(),
        to_date: to.toISOString()
    });
    data.by_district = byDistrict || [];
    contentEl.innerHTML = buildDashboardHtml(data);
    lastDashboardExport = { stats: data, fromDate, toDate };
    document.getElementById('dashboard-export-btn').disabled = false;
    const groupsSection = document.getElementById('dashboard-groups-section');
    if (currentUserRole === 'admin') {
        groupsSection.classList.remove('hidden');
        loadGroups();
    } else {
        groupsSection.classList.add('hidden');
    }
}
function buildDashboardHtml(stats) {
    const t = stats.totals;
    const pct = (n) => t.reported ? `${Math.round((n / t.reported) * 100)}%` : '—';
    const tiles = [
        { label: 'Reportes recibidos', value: t.reported, note: 'en el rango elegido' },
        { label: 'Atendidos', value: t.resolved, note: `${pct(t.resolved)} de los recibidos` },
        { label: 'Tiempo promedio de atención', value: formatDuration(t.avg_minutes), note: `mediana ${formatDuration(t.median_minutes)}` },
        { label: 'Pendientes', value: t.active, note: 'siguen activos' },
        { label: 'Expirados sin atender', value: t.expired, note: `${pct(t.expired)} de los recibidos` }
    ];
    const tilesHtml = tiles.map(tile => `
        <div class="dash-tile">
            <span class="dash-tile-label">${tile.label}</span>
            <span class="dash-tile-value">${tile.value}</span>
            <span class="dash-tile-note">${tile.note}</span>
        </div>
    `).join('');
    if (!t.reported && !stats.by_day.some(d => d.resolved)) {
        return `<div class="dash-tiles">${tilesHtml}</div><p class="text-sm text-gray-500">Sin reportes en este rango de fechas.</p>`;
    }
    return `
        <div class="dash-tiles">${tilesHtml}</div>
        <h4 class="dash-section-title">Reportes por tipo</h4>
        ${buildTypeBarsHtml(stats.by_type)}
        ${stats.by_district && stats.by_district.length ? `
        <h4 class="dash-section-title">Reportes por distrito</h4>
        ${buildDistrictBarsHtml(stats.by_district)}` : ''}
        <h4 class="dash-section-title">Recibidos y atendidos por día</h4>
        ${buildDailyChartHtml(stats.by_day)}
        <h4 class="dash-section-title">Atención por agente</h4>
        ${buildAgentTableHtml(stats.by_agent, stats.unattributed)}
        <h4 class="dash-section-title">Atención por grupo</h4>
        ${buildGroupTableHtml(stats.by_group)}
    `;
}
function buildTypeBarsHtml(byType) {
    if (!byType.length) return '<p class="text-sm text-gray-500">Sin datos.</p>';
    const max = Math.max(...byType.map(r => r.reported));
    return `<div class="dash-bars">${byType.map(row => {
        const meta = CONTROL_POINT_TYPES[row.type] || CONTROL_POINT_TYPES.otro;
        const detail = `${row.resolved} de ${row.reported} atendidos · ${formatDuration(row.avg_minutes)} en promedio`;
        return `
            <div class="dash-bar-row" title="${meta.label}: ${detail}">
                <span class="dash-bar-label">${meta.label}</span>
                <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${(row.reported / max) * 100}%"></div></div>
                <span class="dash-bar-value">${row.reported}</span>
                <span class="dash-bar-detail">${detail}</span>
            </div>
        `;
    }).join('')}</div>`;
}
function buildDistrictBarsHtml(byDistrict) {
    const max = Math.max(...byDistrict.map(r => r.reported));
    return `<div class="dash-bars">${byDistrict.map(row => {
        const detail = `${row.resolved} de ${row.reported} atendidos`;
        return `
            <div class="dash-bar-row" title="${escapeHtml(row.district)}: ${detail}">
                <span class="dash-bar-label">${escapeHtml(row.district)}</span>
                <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${(row.reported / max) * 100}%"></div></div>
                <span class="dash-bar-value">${row.reported}</span>
                <span class="dash-bar-detail">${detail}</span>
            </div>
        `;
    }).join('')}</div>`;
}
function buildDailyChartHtml(byDay) {
    const max = Math.max(1, ...byDay.map(d => Math.max(d.reported, d.resolved)));
    const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
    const columns = byDay.map(d => `
        <div class="dash-day" title="${dayLabel(d.day)}: ${d.reported} recibidos, ${d.resolved} atendidos">
            <div class="dash-day-bar dash-series-reported" style="height:${(d.reported / max) * 100}%"></div>
            <div class="dash-day-bar dash-series-resolved" style="height:${(d.resolved / max) * 100}%"></div>
        </div>
    `).join('');
    return `
        <div class="dash-legend">
            <span><i class="dash-swatch dash-series-reported"></i> Recibidos</span>
            <span><i class="dash-swatch dash-series-resolved"></i> Atendidos</span>
            <span class="dash-legend-max">máx. ${max} por día</span>
        </div>
        <div class="dash-days">${columns}</div>
        <div class="dash-days-axis">
            <span>${dayLabel(byDay[0].day)}</span>
            <span>${dayLabel(byDay[byDay.length - 1].day)}</span>
        </div>
    `;
}
function buildAgentTableHtml(byAgent, unattributed) {
    if (!byAgent.length) return '<p class="text-sm text-gray-500">No hay agentes registrados.</p>';
    const rows = byAgent.map(a => `
        <tr>
            <td>${escapeHtml(a.name || 'Sin nombre')}${a.is_leader ? ' <span class="dash-badge">Encargado</span>' : ''}</td>
            <td>${a.group_name ? escapeHtml(a.group_name) : '—'}</td>
            <td class="dash-num">${a.resolved}</td>
            <td class="dash-num">${formatDuration(a.avg_minutes)}</td>
        </tr>
    `).join('');
    return `
        <table class="dash-table">
            <thead><tr><th>Agente</th><th>Grupo</th><th class="dash-num">Atendidos</th><th class="dash-num">Tiempo prom.</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${unattributed ? `<p class="dash-footnote">${unattributed} atenciones no tienen agente registrado (son anteriores a este dashboard o las cerró quien reportó).</p>` : ''}
    `;
}
function buildGroupTableHtml(byGroup) {
    if (!byGroup.length) return '<p class="text-sm text-gray-500">Aún no hay grupos creados.</p>';
    const rows = byGroup.map(g => `
        <tr>
            <td>${escapeHtml(g.name)}</td>
            <td>${g.leader_name ? escapeHtml(g.leader_name) : '<span class="dash-muted">Sin encargado</span>'}</td>
            <td class="dash-num">${g.members}</td>
            <td class="dash-num">${g.resolved}</td>
            <td class="dash-num">${formatDuration(g.avg_minutes)}</td>
        </tr>
    `).join('');
    return `
        <table class="dash-table">
            <thead><tr><th>Grupo</th><th>Encargado</th><th class="dash-num">Agentes</th><th class="dash-num">Atendidos</th><th class="dash-num">Tiempo prom.</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}
async function exportDashboardExcel() {
    if (!lastDashboardExport) return;
    const btn = document.getElementById('dashboard-export-btn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerText = 'Generando...';
    try {
        const typeLabels = Object.fromEntries(Object.entries(CONTROL_POINT_TYPES).map(([key, meta]) => [key, meta.label]));
        await downloadDashboardExcel(lastDashboardExport.stats, {
            fromDate: lastDashboardExport.fromDate,
            toDate: lastDashboardExport.toDate,
            typeLabels
        });
        showToast('Excel descargado.', 'success');
    } catch (error) {
        console.error('Error al exportar a Excel:', error);
        showToast('No se pudo generar el archivo de Excel.', 'error');
    }
    btn.innerHTML = originalHtml;
    btn.disabled = !lastDashboardExport;
}
async function loadGroups() {
    const listEl = document.getElementById('dashboard-groups-list');
    const [groupsRes, agentsRes] = await Promise.all([
        supabaseClient.from('agent_groups').select('*').order('name'),
        supabaseClient.from('profiles').select('id, full_name, email, role, group_id').in('role', ['agente', 'admin']).order('full_name')
    ]);
    const error = groupsRes.error || agentsRes.error;
    if (error) {
        console.error('Error al cargar grupos:', error.message);
        listEl.innerHTML = `<p class="text-sm text-red-500">${isMissingDashboardSchema(error) ? DASHBOARD_MISSING_SQL : 'No se pudieron cargar los grupos.'}</p>`;
        return;
    }
    const agents = agentsRes.data;
    const agentName = (a) => escapeHtml(a.full_name || a.email || a.id);
    if (!groupsRes.data.length) {
        listEl.innerHTML = '<p class="text-sm text-gray-500">Aún no hay grupos. Crea el primero arriba.</p>';
        return;
    }
    listEl.innerHTML = groupsRes.data.map(group => {
        const members = agents.filter(a => a.group_id === group.id);
        const outsiders = agents.filter(a => a.group_id !== group.id);
        return `
            <div class="dash-group-card">
                <div class="dash-group-head">
                    <strong>${escapeHtml(group.name)}</strong>
                    <button type="button" class="dash-link-danger" onclick="deleteGroup('${group.id}')">Eliminar grupo</button>
                </div>
                <label class="cp-label">Encargado</label>
                <select class="cp-input" onchange="setGroupLeader('${group.id}', this.value)">
                    <option value="">Sin encargado</option>
                    ${agents.map(a => `<option value="${a.id}" ${a.id === group.leader_id ? 'selected' : ''}>${agentName(a)}${a.group_id === group.id ? '' : ' (se unirá al grupo)'}</option>`).join('')}
                </select>
                <label class="cp-label">Agentes del grupo (${members.length})</label>
                <div class="dash-members">
                    ${members.length ? members.map(a => `
                        <span class="dash-member">
                            ${agentName(a)}${a.id === group.leader_id ? ' <span class="dash-badge">Encargado</span>' : ''}
                            <button type="button" title="Quitar del grupo" onclick="setAgentGroup('${a.id}', '')"><i class="fas fa-times"></i></button>
                        </span>
                    `).join('') : '<span class="dash-muted">Sin agentes asignados.</span>'}
                </div>
                <select class="cp-input dash-add-member" onchange="setAgentGroup(this.value, '${group.id}')" ${outsiders.length ? '' : 'disabled'}>
                    <option value="">${outsiders.length ? 'Agregar agente…' : 'No hay más agentes disponibles'}</option>
                    ${outsiders.map(a => `<option value="${a.id}">${agentName(a)}${a.group_id ? ' (se moverá de su grupo actual)' : ''}</option>`).join('')}
                </select>
            </div>
        `;
    }).join('');
}
async function submitCreateGroup(event) {
    event.preventDefault();
    const input = document.getElementById('new-group-name');
    const name = input.value.trim();
    if (!name) return;
    const { error } = await supabaseClient.from('agent_groups').insert({ name });
    if (error) {
        console.error('Error al crear grupo:', error.message);
        showToast(error.code === '23505' ? 'Ya existe un grupo con ese nombre.' : 'No se pudo crear el grupo.', 'error');
        return;
    }
    input.value = '';
    showToast('Grupo creado.', 'success');
    loadDashboard();
}
async function setGroupLeader(groupId, leaderId) {
    const { error } = await supabaseClient.rpc('set_group_leader', {
        p_group_id: groupId,
        p_leader_id: leaderId || null
    });
    if (error) {
        console.error('Error al delegar encargado:', error.message);
        showToast('No se pudo delegar el encargado.', 'error');
    } else {
        showToast(leaderId ? 'Encargado delegado.' : 'El grupo quedó sin encargado.', 'success');
    }
    loadDashboard();
}
async function setAgentGroup(agentId, groupId) {
    if (!agentId) return;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ group_id: groupId || null })
        .eq('id', agentId);
    if (error) {
        console.error('Error al asignar grupo:', error.message);
        showToast('No se pudo actualizar el grupo del agente.', 'error');
    } else {
        showToast(groupId ? 'Agente agregado al grupo.' : 'Agente quitado del grupo.', 'success');
    }
    loadDashboard();
}
async function deleteGroup(groupId) {
    if (!confirm('¿Eliminar este grupo? Sus agentes quedarán sin grupo.')) return;
    const { error } = await supabaseClient.from('agent_groups').delete().eq('id', groupId);
    if (error) {
        console.error('Error al eliminar grupo:', error.message);
        showToast('No se pudo eliminar el grupo.', 'error');
        return;
    }
    showToast('Grupo eliminado.', 'success');
    loadDashboard();
}
// =============================================
// Ubicación en Vivo del Agente de Tráfico
// =============================================
function toggleShareLocation() {
    if (isSharingLocation) {
        stopSharingLocation();
    } else {
        startSharingLocation();
    }
}
function startSharingLocation() {
    if (!navigator.geolocation) {
        showToast('La geolocalización no es compatible con tu navegador.', 'error');
        return;
    }
    isSharingLocation = true;
    document.getElementById('share-location-btn').classList.add('active-mode');
    showToast('Compartiendo tu ubicación en vivo.', 'success');
    locationWatchId = navigator.geolocation.watchPosition(
        (position) => sendAgentLocation(position.coords.latitude, position.coords.longitude),
        (error) => {
            console.error('Error de geolocalización (agente):', error.message);
            showToast('No se pudo obtener tu ubicación para compartir.', 'error');
        },
        { enableHighAccuracy: true, maximumAge: 0 }
    );
    // Si el agente está quieto el GPS deja de avisar; reenviamos la última posición
    // para que los demás no lo den por desconectado mientras sigue en el sistema.
    locationHeartbeatId = setInterval(() => {
        if (lastSharedPosition) sendAgentLocation(lastSharedPosition.lat, lastSharedPosition.lng);
    }, AGENT_LOCATION_HEARTBEAT_MS);
}
function stopLocationWatch() {
    isSharingLocation = false;
    lastSharedPosition = null;
    document.getElementById('share-location-btn').classList.remove('active-mode');
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
    if (locationHeartbeatId !== null) {
        clearInterval(locationHeartbeatId);
        locationHeartbeatId = null;
    }
}
async function deleteOwnAgentLocation() {
    if (!currentUser || !supabaseClient) return;
    const userId = currentUser.id;
    removeAgentLocationMarker(userId);
    // El await es necesario: sin él supabase-js nunca llega a enviar la petición
    const { error } = await supabaseClient.from('agent_locations').delete().eq('user_id', userId);
    if (error) {
        console.error('Error al quitar la ubicación del agente:', error.message);
    }
}
async function stopSharingLocation() {
    stopLocationWatch();
    await deleteOwnAgentLocation();
    showToast('Dejaste de compartir tu ubicación.', 'info');
}
async function sendAgentLocation(lat, lng) {
    if (!isSharingLocation || !currentUser) return;
    lastSharedPosition = { lat, lng };
    const now = Date.now();
    if (now - lastLocationSentAt < 8000) return; // enviar como máximo cada 8s
    lastLocationSentAt = now;
    const { error } = await supabaseClient
        .from('agent_locations')
        .upsert({ user_id: currentUser.id, lat, lng, updated_at: new Date().toISOString() });
    if (error) {
        console.error('Error al compartir ubicación:', error.message);
    }
}
async function loadAgentLocations() {
    if (!supabaseClient) return;
    // Solo agentes con señal reciente: una fila vieja es de alguien que ya no está en el sistema
    const staleCutoff = new Date(Date.now() - AGENT_LOCATION_STALE_MS).toISOString();
    const { data, error } = await supabaseClient.from('agent_locations').select('*').gt('updated_at', staleCutoff);
    if (error) {
        console.error('Error al cargar ubicaciones de agentes:', error.message);
        return;
    }
    data.forEach(renderAgentLocationMarker);
    subscribeAgentLocations();
}
function renderAgentLocationMarker(row) {
    agentLocationsData[row.user_id] = row;
    const latlng = [row.lat, row.lng];
    if (agentLocationMarkers[row.user_id]) {
        agentLocationMarkers[row.user_id].setLatLng(latlng);
        return;
    }
    const icon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="agent-location-icon"><i class="fas fa-shield-halved"></i></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });
    const marker = L.marker(latlng, { icon, zIndexOffset: 900 })
        .addTo(map)
        .bindPopup('Agente de tráfico en vivo (Cargando...)');
    agentLocationMarkers[row.user_id] = marker;
    // Buscar y actualizar el popup con el nombre (o correo)
    supabaseClient.rpc('get_user_name', { uid: row.user_id }).then(({ data, error }) => {
        if (!error && data) {
            marker.bindPopup(`Agente: <b>${escapeHtml(data)}</b>`);
        } else {
            marker.bindPopup('Agente de tráfico en vivo');
        }
    });
}
function removeAgentLocationMarker(userId) {
    if (!userId) return;
    delete agentLocationsData[userId];
    if (agentLocationMarkers[userId]) {
        map.removeLayer(agentLocationMarkers[userId]);
        delete agentLocationMarkers[userId];
    }
}
function subscribeAgentLocations() {
    supabaseClient
        .channel('agent-locations-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_locations' }, (payload) => {
            if (payload.eventType === 'DELETE') {
                removeAgentLocationMarker(payload.old.user_id);
            } else {
                renderAgentLocationMarker(payload.new);
            }
        })
        .subscribe();
}
function sweepStaleAgentMarkers() {
    const now = Date.now();
    Object.keys(agentLocationsData).forEach((userId) => {
        const updatedAt = new Date(agentLocationsData[userId].updated_at).getTime();
        if (now - updatedAt > AGENT_LOCATION_STALE_MS) {
            removeAgentLocationMarker(userId);
        }
    });
}
// =============================================
// Cálculo de Rutas (OSRM)
// =============================================
function toggleRouteMode() {
    if (isRoutingMode) {
        exitRouteMode();
        return;
    }
    if (isAddingPoint) {
        isAddingPoint = false;
        document.getElementById('add-point-btn').classList.remove('active-mode');
    }
    clearRoute();
    closePanel();
    isRoutingMode = true;
    routePendingFrom = null;
    document.getElementById('route-mode-btn').classList.add('active-mode');
    showToast('Toca el punto de partida en el mapa.', 'info');
}
function exitRouteMode() {
    isRoutingMode = false;
    routePendingFrom = null;
    document.getElementById('route-mode-btn').classList.remove('active-mode');
}
function handleRouteModeClick(latlng) {
    if (!routePendingFrom) {
        routePendingFrom = { lat: latlng.lat, lng: latlng.lng };
        placeRouteMarker('from', latlng.lat, latlng.lng);
        showToast('Ahora toca el destino.', 'info');
        return;
    }
    const from = routePendingFrom;
    const to = { lat: latlng.lat, lng: latlng.lng };
    placeRouteMarker('to', to.lat, to.lng);
    exitRouteMode();
    calculateRoute(from, to);
}
function getRoutePointIcon(label, color) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="route-point-icon" style="background-color:${color};">${label}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });
}
function placeRouteMarker(which, lat, lng) {
    const icon = which === 'from' ? getRoutePointIcon('A', '#16a34a') : getRoutePointIcon('B', '#dc2626');
    const marker = L.marker([lat, lng], { icon, zIndexOffset: 950 }).addTo(map);
    if (which === 'from') {
        if (routeFromMarker) map.removeLayer(routeFromMarker);
        routeFromMarker = marker;
    } else {
        if (routeToMarker) map.removeLayer(routeToMarker);
        routeToMarker = marker;
    }
}
async function calculateRoute(from, to) {
    showToast('Calculando rutas...', 'info');
    try {
        const url = `${OSRM_ROUTE_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=true`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            showToast('No se encontró una ruta entre esos puntos.', 'error');
            return;
        }
        lastRouteFrom = from;
        lastRouteTo = to;
        routeAlternatives = data.routes.map((r) => ({
            distance: r.distance,
            duration: r.duration,
            latlngs: r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        }));
        if (routeAlternatives.length === 1) {
            selectRouteOption(0); // solo hay una opción, no hace falta mostrar el selector
        } else {
            showRouteOptions();
        }
    } catch (error) {
        console.error('Error al calcular la ruta:', error);
        showToast('No se pudo calcular la ruta. Intenta de nuevo.', 'error');
    }
}
function showRouteOptions() {
    const fastestIndex = routeAlternatives.reduce(
        (best, cur, idx) => (cur.duration < routeAlternatives[best].duration ? idx : best),
        0
    );
    const listEl = document.getElementById('route-options');
    listEl.innerHTML = routeAlternatives.map((r, i) => `
        <div class="route-option-row" onclick="selectRouteOption(${i})">
            <div class="route-option-main">
                <strong>${formatDurationText(r.duration)}</strong>
                <span class="route-option-sub">${formatDistanceText(r.distance)}</span>
            </div>
            ${i === fastestIndex ? '<span class="route-option-badge">Más rápida</span>' : ''}
        </div>
    `).join('');
    clearAlternativeLines();
    routeAlternatives.forEach((r, i) => {
        const line = L.polyline(r.latlngs, { color: '#9ca3af', weight: 4, opacity: 0.6 })
            .addTo(map)
            .on('click', () => selectRouteOption(i));
        alternativeRouteLines.push(line);
    });
    const allPoints = routeAlternatives.flatMap((r) => r.latlngs);
    map.fitBounds(L.latLngBounds(allPoints), { padding: [60, 60] });
    document.getElementById('place-title').innerText = 'Elige una ruta';
    document.getElementById('place-address').innerText = `${routeAlternatives.length} opciones encontradas`;
    document.getElementById('route-options').classList.remove('hidden');
    document.getElementById('route-summary').classList.add('hidden');
    document.getElementById('place-actions').classList.add('hidden');
    document.getElementById('route-actions').classList.add('hidden');
    document.getElementById('bottom-panel').classList.add('active');
}
function clearAlternativeLines() {
    alternativeRouteLines.forEach((line) => map.removeLayer(line));
    alternativeRouteLines = [];
}
async function selectRouteOption(index) {
    const route = routeAlternatives[index];
    if (!route) return;
    selectedRouteIndex = index;
    clearAlternativeLines();
    document.getElementById('route-options').classList.add('hidden');
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(route.latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });
    showRouteSummary(route.distance, route.duration);
    await loadRouteTraffic();
}
// Mejora progresiva: si Google Maps está configurado, actualizamos el resumen con el
// tiempo real de tráfico en vivo en cuanto llegue (puede tardar un poco más).
async function loadRouteTraffic() {
    const route = routeAlternatives[selectedRouteIndex];
    if (!route || !routeLine || isNavigating) return;
    const index = selectedRouteIndex;
    const from = lastRouteFrom;
    // Si mientras tanto se canceló o cambió la ruta, el resultado ya no aplica
    const isStale = () => !routeLine || isNavigating || selectedRouteIndex !== index || lastRouteFrom !== from;
    setRouteTraffic('loading');
    let trafficInfo = await getGoogleTrafficDuration(lastRouteFrom, lastRouteTo);
    if (isStale()) return;
    // Un fallo suele ser pasajero (señal débil): un segundo intento antes de darlo por no disponible
    if (!trafficInfo && isGoogleMapsConfigured()) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (isStale()) return;
        trafficInfo = await getGoogleTrafficDuration(lastRouteFrom, lastRouteTo);
        if (isStale()) return;
    }
    if (trafficInfo) {
        showRouteSummary(route.distance, trafficInfo.durationInTrafficSeconds);
        setRouteTraffic('ready', trafficInfo);
    } else {
        setRouteTraffic('unavailable');
    }
}
// Fila "embotellamiento" del resumen de ruta: cuánto tiempo añade el tráfico entre A y B
function setRouteTraffic(state, trafficInfo) {
    const el = document.getElementById('route-traffic');
    el.classList.remove('hidden');
    if (state === 'loading') {
        el.style.color = '#6b7280';
        el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando tráfico en vivo...';
        return;
    }
    if (state === 'unavailable') {
        el.style.color = '#6b7280';
        el.innerHTML = isGoogleMapsConfigured()
            ? '<i class="fas fa-circle-info"></i> Tráfico en vivo no disponible: el tiempo mostrado es sin tráfico. <button type="button" class="route-traffic-retry" onclick="loadRouteTraffic()">Reintentar</button>'
            : '<i class="fas fa-circle-info"></i> Tráfico en vivo no configurado: el tiempo mostrado es sin tráfico.';
        return;
    }
    const delaySeconds = trafficInfo.durationInTrafficSeconds - trafficInfo.durationSeconds;
    const delayMinutes = Math.round(delaySeconds / 60);
    const normalText = formatDurationText(trafficInfo.durationSeconds);
    if (delayMinutes < 1) {
        el.style.color = '#15803d';
        el.innerHTML = `<i class="fas fa-circle-check"></i> Sin embotellamiento: tráfico fluido (${normalText} normalmente).`;
        return;
    }
    // Retraso fuerte: 10 min o más, o la mitad del tiempo normal del trayecto
    const isHeavy = delayMinutes >= 10 || delaySeconds >= trafficInfo.durationSeconds * 0.5;
    el.style.color = isHeavy ? '#b91c1c' : '#b45309';
    el.innerHTML = `<i class="fas fa-car-side"></i> Embotellamiento: +${formatDurationText(delayMinutes * 60)} de retraso por tráfico (sin tráfico: ${normalText}).`;
}
function isGoogleMapsConfigured() {
    return typeof GOOGLE_MAPS_API_KEY !== 'undefined' && !!GOOGLE_MAPS_API_KEY && !GOOGLE_MAPS_API_KEY.includes('TU-');
}
function loadGoogleMapsScript() {
    if (googleMapsLoadPromise) return googleMapsLoadPromise;
    if (!isGoogleMapsConfigured()) {
        return Promise.reject(new Error('Google Maps no está configurado.'));
    }
    googleMapsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            // Sin esto el fallo quedaba guardado y ya no se volvía a intentar hasta recargar la página
            googleMapsLoadPromise = null;
            script.remove();
            reject(new Error('No se pudo cargar Google Maps.'));
        };
        document.head.appendChild(script);
    });
    return googleMapsLoadPromise;
}
async function getGoogleTrafficDuration(from, to) {
    try {
        await loadGoogleMapsScript();
        if (!window.google || !google.maps || !google.maps.DirectionsService) return null;
        const directionsService = new google.maps.DirectionsService();
        const result = await directionsService.route({
            origin: { lat: from.lat, lng: from.lng },
            destination: { lat: to.lat, lng: to.lng },
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS
            }
        });
        const leg = result.routes[0].legs[0];
        if (!leg.duration_in_traffic) return null;
        return {
            durationSeconds: leg.duration.value,
            durationInTrafficSeconds: leg.duration_in_traffic.value
        };
    } catch (error) {
        console.warn('No se pudo obtener el tráfico en vivo de Google:', error.message || error);
        return null;
    }
}
function formatDistanceText(distanceMeters) {
    return distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(1)} km`
        : `${Math.round(distanceMeters)} m`;
}
function formatDurationText(durationSeconds, normalDurationSeconds) {
    const durationMinutes = Math.round(durationSeconds / 60);
    let text = durationMinutes >= 60
        ? `${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60} min`
        : `${durationMinutes} min`;
    if (normalDurationSeconds) {
        const extraMinutes = Math.round((durationSeconds - normalDurationSeconds) / 60);
        if (extraMinutes > 0) {
            text += ` (+${extraMinutes} min por tráfico)`;
        }
    }
    return text;
}
function showRouteSummary(distanceMeters, durationSeconds, normalDurationSeconds) {
    document.getElementById('route-distance').innerText = formatDistanceText(distanceMeters);
    document.getElementById('route-duration').innerText = formatDurationText(durationSeconds, normalDurationSeconds);
    document.getElementById('place-title').innerText = 'Ruta calculada';
    document.getElementById('place-address').innerText = 'Trayecto en vehículo (según vías disponibles).';
    document.getElementById('route-summary').classList.remove('hidden');
    document.getElementById('place-actions').classList.add('hidden');
    document.getElementById('route-actions').classList.remove('hidden');
    document.getElementById('bottom-panel').classList.add('active');
}
function clearRoute() {
    if (isNavigating) {
        isNavigating = false;
        if (navigationWatchId !== null) {
            navigator.geolocation.clearWatch(navigationWatchId);
            navigationWatchId = null;
        }
        navigationDestination = null;
        lastNavRecalcAt = 0;
        lastNavTrafficCheckAt = 0;
        lastNavTrafficExtraSeconds = 0;
    }
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    if (routeFromMarker) {
        map.removeLayer(routeFromMarker);
        routeFromMarker = null;
    }
    if (routeToMarker) {
        map.removeLayer(routeToMarker);
        routeToMarker = null;
    }
    clearAlternativeLines();
    routeAlternatives = [];
    selectedRouteIndex = 0;
    lastRouteFrom = null;
    lastRouteTo = null;
    document.getElementById('route-summary').classList.add('hidden');
    document.getElementById('route-traffic').classList.add('hidden');
    document.getElementById('route-options').classList.add('hidden');
    document.getElementById('route-actions').classList.add('hidden');
    document.getElementById('navigation-actions').classList.add('hidden');
    document.getElementById('place-actions').classList.remove('hidden');
}
function cancelRoute() {
    clearRoute();
    closePanel();
}
// =============================================
// Navegación: seguimiento en vivo hasta el destino
// =============================================
function startNavigation() {
    if (!routeLine || !lastRouteTo) {
        showToast('No hay una ruta activa para iniciar.', 'error');
        return;
    }
    if (!navigator.geolocation) {
        showToast('La geolocalización no es compatible con tu navegador.', 'error');
        return;
    }
    navigationDestination = { lat: lastRouteTo.lat, lng: lastRouteTo.lng };
    isNavigating = true;
    lastNavRecalcAt = 0;
    lastNavTrafficCheckAt = 0;
    lastNavTrafficExtraSeconds = 0;
    // El pin "A" ya no representa tu posición actual; a partir de ahora te sigue el punto azul
    if (routeFromMarker) {
        map.removeLayer(routeFromMarker);
        routeFromMarker = null;
    }
    document.getElementById('route-actions').classList.add('hidden');
    document.getElementById('navigation-actions').classList.remove('hidden');
    // Durante la navegación el retraso por tráfico va junto al tiempo restante
    document.getElementById('route-traffic').classList.add('hidden');
    document.getElementById('place-title').innerText = 'En camino...';
    showToast('Navegación iniciada. Te avisamos al llegar.', 'success');
    navigationWatchId = navigator.geolocation.watchPosition(
        (position) => handleNavigationPosition(position.coords.latitude, position.coords.longitude),
        (error) => {
            console.error('Error de geolocalización (navegación):', error.message);
            showToast('No se pudo seguir tu ubicación.', 'error');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
}
function stopNavigation() {
    showToast('Navegación detenida.', 'info');
    clearRoute();
    closePanel();
}
function handleNavigationPosition(lat, lng) {
    if (!isNavigating) return;
    if (userMarker) {
        userMarker.setLatLng([lat, lng]);
    } else {
        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color:#3b82f6; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
    }
    map.panTo([lat, lng], { animate: true });
    const distanceToDestination = haversineMeters({ lat, lng }, navigationDestination);
    if (distanceToDestination <= NAVIGATION_ARRIVAL_METERS) {
        arriveAtDestination();
        return;
    }
    const now = Date.now();
    if (now - lastNavRecalcAt >= NAVIGATION_RECALC_MS) {
        lastNavRecalcAt = now;
        updateNavigationRoute({ lat, lng }, navigationDestination);
    }
}
function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function updateNavigationRoute(from, to) {
    try {
        const url = `${OSRM_ROUTE_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        if (!isNavigating || data.code !== 'Ok' || !data.routes || !data.routes.length) return;
        const route = data.routes[0];
        const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
        // El retraso por tráfico se refresca como máximo cada 60s (Google cuesta dinero);
        // mientras tanto se sigue sumando al tiempo restante que sí se recalcula cada 10s con OSRM.
        const now = Date.now();
        if (now - lastNavTrafficCheckAt >= NAVIGATION_TRAFFIC_RECALC_MS) {
            lastNavTrafficCheckAt = now;
            const trafficInfo = await getGoogleTrafficDuration(from, to);
            if (trafficInfo && isNavigating) {
                lastNavTrafficExtraSeconds = Math.max(0, trafficInfo.durationInTrafficSeconds - trafficInfo.durationSeconds);
            }
        }
        if (!isNavigating) return;
        const durationSeconds = route.duration + lastNavTrafficExtraSeconds;
        const normalDurationSeconds = lastNavTrafficExtraSeconds > 0 ? route.duration : null;
        document.getElementById('route-distance').innerText = `${formatDistanceText(route.distance)} restantes`;
        document.getElementById('route-duration').innerText = formatDurationText(durationSeconds, normalDurationSeconds);
    } catch (error) {
        console.error('Error al recalcular la ruta durante la navegación:', error);
    }
}
function arriveAtDestination() {
    showToast('¡Has llegado a tu destino!', 'success');
    clearRoute();
    closePanel();
}
function routeToSearchedPlace() {
    if (!searchMarker) return;
    if (!navigator.geolocation) {
        showToast('La geolocalización no es compatible con tu navegador.', 'error');
        return;
    }
    const destination = searchMarker.getLatLng();
    showToast('Obteniendo tu ubicación...', 'info');
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const from = { lat: position.coords.latitude, lng: position.coords.longitude };
            const to = { lat: destination.lat, lng: destination.lng };
            calculateRoute(from, to);
        },
        (error) => {
            console.error('Error de geolocalización (ruta):', error.message);
            showToast('No se pudo obtener tu ubicación para trazar la ruta.', 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}
// =============================================
// Modo "Agregar Punto de Control"
// =============================================
function toggleAddPointMode() {
    if (!currentUser) {
        showToast('Inicia sesión para registrar un punto de control.', 'info');
        openAuthModal();
        return;
    }
    if (isRoutingMode) exitRouteMode();
    isAddingPoint = !isAddingPoint;
    const btn = document.getElementById('add-point-btn');
    if (isAddingPoint) {
        btn.classList.add('active-mode');
        showToast('Toca el mapa para ubicar el punto de control.', 'info');
    } else {
        btn.classList.remove('active-mode');
    }
}
function openControlPointForm(lat, lng) {
    pendingLatLng = { lat, lng };
    // Salir del modo de colocación
    isAddingPoint = false;
    document.getElementById('add-point-btn').classList.remove('active-mode');
    document.getElementById('control-point-coords').innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('control-point-form').reset();
    fillControlPointGroupSelect();
    loadAgentGroups().then(fillControlPointGroupSelect);
    document.getElementById('control-point-backdrop').classList.add('active');
    document.getElementById('control-point-modal').classList.add('active');
}
// Solo agentes/admins delegan; se oculta si aún no hay grupos creados
function fillControlPointGroupSelect() {
    const field = document.getElementById('cp-group-field');
    const select = document.getElementById('cp-group');
    const groups = Object.entries(agentGroupsById);
    if (!['agente', 'admin'].includes(currentUserRole) || !groups.length) {
        field.classList.add('hidden');
        select.value = '';
        return;
    }
    const selected = select.value;
    select.innerHTML = '<option value="">Sin asignar</option>'
        + groups.map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
    select.value = agentGroupsById[selected] ? selected : '';
    field.classList.remove('hidden');
}
function closeControlPointForm() {
    pendingLatLng = null;
    document.getElementById('control-point-backdrop').classList.remove('active');
    document.getElementById('control-point-modal').classList.remove('active');
}
async function submitControlPoint(event) {
    event.preventDefault();
    if (!supabaseClient) {
        showToast('Supabase no está configurado. Revisa js/config.js.', 'error');
        return;
    }
    if (!currentUser) {
        showToast('Inicia sesión para registrar un punto de control.', 'info');
        openAuthModal();
        return;
    }
    if (!pendingLatLng) return;
    const submitBtn = document.getElementById('cp-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Guardando...';
    const type = document.getElementById('cp-type').value;
    const expirationHours = EXPIRATION_HOURS[type] || 4;
    const newPoint = {
        district: document.getElementById('cp-district').value,
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
        type: type,
        severity: document.getElementById('cp-severity').value,
        description: document.getElementById('cp-description').value.trim() || null,
        reported_by: currentUser.id,
        expires_at: new Date(Date.now() + expirationHours * 3600 * 1000).toISOString()
    };
    const assignedGroupId = document.getElementById('cp-group').value;
    if (assignedGroupId) newPoint.assigned_group_id = assignedGroupId;
    const { data, error } = await supabaseClient
        .from('control_points')
        .insert(newPoint)
        .select()
        .single();
    submitBtn.disabled = false;
    submitBtn.innerText = 'Guardar';
    if (error) {
        console.error('Error al guardar el punto de control:', error.message);
        showToast('No se pudo guardar el punto de control.', 'error');
        return;
    }
    renderControlPointMarker(data);
    showToast(data.assigned_group_id
        ? `Punto registrado y delegado a ${agentGroupsById[data.assigned_group_id] || 'el grupo'}.`
        : 'Punto de control registrado.', 'success');
    closeControlPointForm();
}
// =============================================
// Panel de Capas
// =============================================
function toggleLayersPanel() {
    const panel = document.getElementById('layers-panel');
    const backdrop = document.getElementById('layers-backdrop');
    const btnIcon = document.querySelector('#layers-btn i');
    isLayersPanelOpen = !isLayersPanelOpen;
    if (isLayersPanelOpen) {
        panel.classList.add('active');
        backdrop.classList.add('active');
        btnIcon.classList.remove('text-blue-500');
        btnIcon.classList.add('text-indigo-600');
    } else {
        panel.classList.remove('active');
        backdrop.classList.remove('active');
        btnIcon.classList.remove('text-indigo-600');
        btnIcon.classList.add('text-blue-500');
    }
}
// =============================================
// Cambio de Mapa Base
// =============================================
function switchBaseLayer(layerName) {
    // No hacer nada si ya es la capa activa
    if (layerName === currentBaseLayerName) return;
    // Remover capa base actual
    map.removeLayer(currentBaseLayer);
    // Añadir nueva capa base
    currentBaseLayer = baseLayers[layerName];
    currentBaseLayer.addTo(map);
    // Si el tráfico está activo, asegurar que quede encima de la capa base
    if (isTrafficVisible) {
        trafficTileLayer.bringToFront();
    }
    // Actualizar estado visual de los botones
    document.querySelectorAll('.base-layer-option').forEach(opt => {
        opt.classList.remove('active');
    });
    document.getElementById('layer-' + layerName).classList.add('active');
    currentBaseLayerName = layerName;
}
// =============================================
// Sistema de Notificaciones (Toast)
// =============================================
function showToast(message, type = 'error') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bgClass = { error: 'bg-red-500', success: 'bg-green-600', info: 'bg-gray-800' }[type] || 'bg-gray-800';
    toast.className = `px-4 py-2 rounded-full text-white text-sm shadow-lg transition-opacity duration-300 ${bgClass}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
// =============================================
// Geolocalización del Usuario
// =============================================
function locateUser(silent = false) {
    if (!navigator.geolocation) {
        if (!silent) showToast("La geolocalización no es compatible con tu navegador.", "error");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            // Volar a la ubicación
            map.flyTo([lat, lng], 16, {
                animate: true,
                duration: 1.5
            });
            // Añadir o actualizar marcador de usuario
            if (userMarker) {
                userMarker.setLatLng([lat, lng]);
            } else {
                // Crear un icono personalizado estilo "punto azul"
                const userIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background-color:#3b82f6; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
            }
        },
        (error) => {
            console.error("Error de geolocalización:", error.message);
            let errorMessage = "No se pudo obtener tu ubicación.";
            if (error.message.includes("permissions policy") || error.code === error.PERMISSION_DENIED) {
                errorMessage = "Permiso de ubicación denegado por el navegador o entorno.";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMessage = "La información de ubicación no está disponible en este momento.";
            } else if (error.code === error.TIMEOUT) {
                errorMessage = "Se agotó el tiempo de espera al intentar obtener tu ubicación.";
            }
            // Solo mostramos el error si el usuario hizo clic explícitamente en el botón
            if (!silent) {
                showToast(errorMessage, "error");
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}
// =============================================
// Búsqueda de Lugares (Nominatim API)
// =============================================
async function handleSearch(event) {
    if (event.key === 'Enter') {
        const query = document.getElementById('search-input').value.trim();
        const clearBtn = document.getElementById('clear-btn');
        if (query.length > 0) {
            clearBtn.classList.remove('hidden');
            try {
                // Llamada a la API de Nominatim
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
                const data = await response.json();
                if (data && data.length > 0) {
                    const result = data[0];
                    const lat = parseFloat(result.lat);
                    const lon = parseFloat(result.lon);
                    const displayName = result.display_name;
                    // Centrar mapa
                    map.flyTo([lat, lon], 15);
                    // Poner marcador
                    if (searchMarker) {
                        searchMarker.setLatLng([lat, lon]);
                    } else {
                        searchMarker = L.marker([lat, lon]).addTo(map);
                    }
                    // Mostrar panel con información
                    showPlacePanel(displayName.split(',')[0], displayName);
                } else {
                    showToast("No se encontraron resultados para: " + query, "error");
                }
            } catch (error) {
                console.error("Error en la búsqueda:", error);
                showToast("Error al buscar. Intenta de nuevo.", "error");
            }
        }
    } else {
        const clearBtn = document.getElementById('clear-btn');
        if (document.getElementById('search-input').value.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
}
function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('clear-btn').classList.add('hidden');
    if (searchMarker) {
        map.removeLayer(searchMarker);
        searchMarker = null;
    }
    closePanel();
}
// =============================================
// Capa de Tráfico (Google Maps Traffic)
// =============================================
function toggleTrafficLayer() {
    const legend = document.getElementById('traffic-legend');
    const checkbox = document.getElementById('traffic-toggle');
    isTrafficVisible = checkbox ? checkbox.checked : !isTrafficVisible;
    if (isTrafficVisible) {
        trafficTileLayer.addTo(map);
        if (legend) legend.style.display = 'flex';
    } else {
        map.removeLayer(trafficTileLayer);
        if (legend) legend.style.display = 'none';
    }
}
// =============================================
// Límite Administrativo (San Salvador Sur)
// =============================================
// Elimina la altitud (tercer valor) de coordenadas 3D que Leaflet no soporta
function strip3DCoords(coords) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') return [coords[0], coords[1]]; // [lng, lat, alt?] -> [lng, lat]
    return coords.map(strip3DCoords);
}
function flattenGeoJSON(geojson) {
    if (!geojson || !geojson.features) return geojson;
    geojson.features = geojson.features.map(f => {
        if (f.geometry && f.geometry.coordinates) {
            f.geometry.coordinates = strip3DCoords(f.geometry.coordinates);
        }
        return f;
    });
    return geojson;
}
async function loadBoundaryLayer() {
    try {
        const response = await fetch(BOUNDARY_GEOJSON_URL);
        const geojson = flattenGeoJSON(await response.json());
        boundaryLayer = L.geoJSON(geojson, {
            style: styleBoundaryFeature,
            onEachFeature: bindBoundaryPopup
        });
        if (isBoundaryVisible) {
            boundaryLayer.addTo(map);
        }
    } catch (error) {
        console.error('Error al cargar el límite de San Salvador Sur:', error);
    }
}
function styleBoundaryFeature() {
    return {
        color: '#7c3aed',
        weight: 2,
        opacity: 0.8,
        fill: false,
        dashArray: '6 4'
    };
}
function bindBoundaryPopup(feature, layer) {
    const props = feature.properties || {};
    const municipio = props.Municipio || 'Municipio';
    const poblacion = props.Total != null ? props.Total : '-';
    layer.bindPopup(`
        <div style="font-family:'Inter',sans-serif; min-width:160px;">
            <strong>${escapeHtml(municipio)}</strong><br>
            <span style="font-size:12px; color:#6b7280;">Distrito San Salvador Sur</span><br>
            <span style="font-size:12px; color:#6b7280;">Población del sector: ${poblacion}</span>
        </div>
    `);
}
function toggleBoundaryLayer() {
    const checkbox = document.getElementById('boundary-toggle');
    isBoundaryVisible = checkbox.checked;
    if (!boundaryLayer) return;
    if (isBoundaryVisible) {
        boundaryLayer.addTo(map);
    } else {
        map.removeLayer(boundaryLayer);
    }
}
function showPlacePanel(title, address) {
    clearRoute();
    document.getElementById('place-title').innerText = title || 'Lugar Seleccionado';
    document.getElementById('place-address').innerText = address || 'Dirección no disponible';
    document.getElementById('bottom-panel').classList.add('active');
}
function closePanel() {
    document.getElementById('bottom-panel').classList.remove('active');
}
window.toggleLayersPanel = toggleLayersPanel;
window.switchBaseLayer = switchBaseLayer;
window.toggleTrafficLayer = toggleTrafficLayer;
window.toggleBoundaryLayer = toggleBoundaryLayer;
window.handleSearch = handleSearch;
window.clearSearch = clearSearch;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.logoutUser = logoutUser;
window.openHistoryPanel = openHistoryPanel;
window.closeHistoryPanel = closeHistoryPanel;
window.loadHistory = loadHistory;
window.locateUser = locateUser;
window.toggleAddPointMode = toggleAddPointMode;
window.toggleRouteMode = toggleRouteMode;
window.toggleShareLocation = toggleShareLocation;
window.openAdminPanel = openAdminPanel;
window.closeAdminPanel = closeAdminPanel;
window.submitCreateUser = submitCreateUser;
window.updateUserDistrict = updateUserDistrict;
window.openLegendPanel = openLegendPanel;
window.closeLegendPanel = closeLegendPanel;
window.openControlPointForm = openControlPointForm;
window.closeControlPointForm = closeControlPointForm;
window.submitControlPoint = submitControlPoint;
window.submitControlPointForm = submitControlPoint;
window.confirmControlPoint = confirmControlPoint;
window.resolveControlPoint = resolveControlPoint;
window.startControlPointAttention = startControlPointAttention;
window.calculateRouteToSelected = routeToSearchedPlace; // alias from HTML
window.cancelRoute = cancelRoute;
window.startNavigation = startNavigation;
window.stopNavigation = stopNavigation;
window.routeToSearchedPlace = routeToSearchedPlace;
window.closePanel = closePanel;
window.updateUserRole = updateUserRole;
window.selectRouteOption = selectRouteOption;
window.loadRouteTraffic = loadRouteTraffic;
window.focusHistoryPoint = focusHistoryPoint;
window.openDashboard = openDashboard;
window.closeDashboard = closeDashboard;
window.loadDashboard = loadDashboard;
window.exportDashboardExcel = exportDashboardExcel;
window.submitCreateGroup = submitCreateGroup;
window.setGroupLeader = setGroupLeader;
window.setAgentGroup = setAgentGroup;
window.deleteGroup = deleteGroup;

async function startAppInitialization() {
    const sUrl = window.SUPABASE_URL || (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '');
    const sKey = window.SUPABASE_ANON_KEY || (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '');

    if (!sUrl || !sKey || sUrl.includes('TU-PROYECTO')) {
        console.error('Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env (o en las variables de entorno de Vercel).');
        showToast('La app no está configurada correctamente. Contacta al administrador.');
        return;
    }
    supabaseClient = window.supabase.createClient(sUrl, sKey);
    window.supabaseClient = supabaseClient;
    await initAuth();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(startAppInitialization, 100);
} else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(startAppInitialization, 100));
}

// Al cerrar la pestaña o salir de la página: quitar el punto del agente.
// fetch con keepalive es lo único que el navegador garantiza enviar mientras la página se cierra.
window.addEventListener('pagehide', function () {
    if (!currentUser || !currentAccessToken) return;
    fetch(`${window.SUPABASE_URL}/rest/v1/rpc/set_presence`, {
        method: 'POST',
        keepalive: true,
        headers: {
            apikey: window.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${currentAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_online: false })
    }).catch(() => {});
    if (!isSharingLocation) return;
    fetch(`${window.SUPABASE_URL}/rest/v1/agent_locations?user_id=eq.${currentUser.id}`, {
        method: 'DELETE',
        keepalive: true,
        headers: {
            apikey: window.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${currentAccessToken}`
        }
    }).catch(() => {});
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function (error) {
            console.warn('No se pudo registrar el service worker:', error);
        });
    });
}