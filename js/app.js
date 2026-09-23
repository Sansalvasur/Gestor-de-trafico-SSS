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
const BOUNDARY_GEOJSON_URL = 'data/san-salvador-sur.geojson';
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
    map.on('moveend', function() {
        clearTimeout(viewportLoadTimeout);
        viewportLoadTimeout = setTimeout(loadControlPointsInView, 400);
    });
    map.on('click', function(e) {
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
let isGateSignupMode = false;
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session ? session.user : null;
    if (currentUser) {
        await fetchUserProfile();
        hideAuthGate();
        startApp();
    } else {
        showAuthGate();
    }
    updateAuthUI();
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        const wasLoggedIn = !!currentUser;
        currentUser = session ? session.user : null;
        if (currentUser) {
            await fetchUserProfile();
            if (!wasLoggedIn) {
                hideAuthGate();
                startApp();
            }
        } else {
            currentUserRole = 'ciudadano';
            if (wasLoggedIn) {
                location.reload();
                return;
            }
        }
        updateAuthUI();
    });
}
function startApp() {
    if (appStarted) return;
    appStarted = true;
    initMap();
    loadControlPointsInView();
    loadBoundaryLayer();
    loadAgentLocations();
    setInterval(sweepStaleAgentMarkers, 60000);
    setTimeout(() => locateUser(true), 500);
}
function showAuthGate() {
    document.getElementById('auth-gate').classList.remove('hidden');
}
function hideAuthGate() {
    document.getElementById('auth-gate').classList.add('hidden');
}
function toggleGateAuthMode(event) {
    event.preventDefault();
    isGateSignupMode = !isGateSignupMode;
    document.getElementById('gate-name-group').classList.toggle('hidden', !isGateSignupMode);
    document.getElementById('gate-name').required = isGateSignupMode;
    document.getElementById('gate-submit-btn').innerText = isGateSignupMode ? 'Registrarme' : 'Iniciar sesión';
    document.getElementById('gate-toggle-text').innerText = isGateSignupMode ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
    document.getElementById('gate-toggle-link').innerText = isGateSignupMode ? 'Inicia sesión' : 'Regístrate';
}
async function submitGateAuthForm(event) {
    event.preventDefault();
    const errorEl = document.getElementById('gate-error');
    errorEl.classList.add('hidden');
    errorEl.style.color = '#dc2626';
    if (!supabaseClient) {
        errorEl.innerText = 'Supabase no está configurado (revisa js/config.js).';
        errorEl.classList.remove('hidden');
        return;
    }
    const email = document.getElementById('gate-email').value.trim();
    const password = document.getElementById('gate-password').value;
    const name = document.getElementById('gate-name').value.trim();
    const btn = document.getElementById('gate-submit-btn');
    btn.disabled = true;
    btn.innerText = isGateSignupMode ? 'Creando...' : 'Entrando...';
    const { error } = isGateSignupMode
        ? await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } })
        : await supabaseClient.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.innerText = isGateSignupMode ? 'Registrarme' : 'Iniciar sesión';
    if (error) {
        errorEl.innerText = error.message;
        errorEl.classList.remove('hidden');
        return;
    }
    if (isGateSignupMode) {
        errorEl.style.color = '#16a34a';
        errorEl.innerText = 'Cuenta creada. Si se requiere confirmación por correo, revísalo y luego inicia sesión.';
        errorEl.classList.remove('hidden');
    }
}
async function fetchUserProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', currentUser.id)
        .single();
    currentUserRole = (!error && data) ? data.role : 'ciudadano';
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
}
function openAdminPanel() {
    document.getElementById('admin-backdrop').classList.add('active');
    document.getElementById('admin-modal').classList.add('active');
    loadUserList();
}
function closeAdminPanel() {
    document.getElementById('admin-backdrop').classList.remove('active');
    document.getElementById('admin-modal').classList.remove('active');
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
    if (role !== 'ciudadano' && data.user) {
        const { error: roleError } = await supabaseClient
            .from('profiles')
            .update({ role })
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
            <select class="user-row-role-select" onchange="updateUserRole('${user.id}', this.value)">
                <option value="ciudadano" ${user.role === 'ciudadano' ? 'selected' : ''}>Ciudadano</option>
                <option value="agente" ${user.role === 'agente' ? 'selected' : ''}>Agente</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
        </div>
    `).join('');
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
function openAuthModal() {
    if (currentUser) {
        if (confirm(`Sesión iniciada como ${currentUser.email}. ¿Cerrar sesión?`)) {
            supabaseClient.auth.signOut();
        }
        return;
    }
    document.getElementById('auth-backdrop').classList.add('active');
    document.getElementById('auth-modal').classList.add('active');
}
function closeAuthModal() {
    document.getElementById('auth-backdrop').classList.remove('active');
    document.getElementById('auth-modal').classList.remove('active');
}
function toggleAuthMode(event) {
    event.preventDefault();
    isSignupMode = !isSignupMode;
    document.getElementById('auth-name-group').classList.toggle('hidden', !isSignupMode);
    document.getElementById('auth-name').required = isSignupMode;
    document.getElementById('auth-modal-title').innerText = isSignupMode ? 'Crear cuenta' : 'Iniciar sesión';
    document.getElementById('auth-submit-btn').innerText = isSignupMode ? 'Registrarme' : 'Iniciar sesión';
    document.getElementById('auth-toggle-text').innerText = isSignupMode ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
    document.getElementById('auth-toggle-link').innerText = isSignupMode ? 'Inicia sesión' : 'Regístrate';
}
async function submitAuthForm(event) {
    event.preventDefault();
    const name = document.getElementById('auth-name').value.trim();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit-btn');
    submitBtn.disabled = true;
    const { error } = isSignupMode
        ? await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } })
        : await supabaseClient.auth.signInWithPassword({ email, password });
    submitBtn.disabled = false;
    if (error) {
        showToast(error.message, 'error');
        return;
    }
    showToast(isSignupMode ? 'Cuenta creada. Revisa tu correo si se requiere confirmación.' : 'Sesión iniciada.', 'success');
    closeAuthModal();
}
async function loadControlPointsInView() {
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
        showToast('No se pudieron cargar los puntos de control.', 'error');
        return;
    }
    const idsInView = new Set(data.map(p => p.id));
    Object.keys(controlPointMarkers).forEach(id => {
        if (!idsInView.has(id)) {
            controlPointsCluster.removeLayer(controlPointMarkers[id]);
            delete controlPointMarkers[id];
        }
    });
    data.forEach(point => {
        if (!controlPointMarkers[point.id]) {
            renderControlPointMarker(point);
        }
    });
}
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function getControlPointIcon(type) {
    const meta = CONTROL_POINT_TYPES[type] || CONTROL_POINT_TYPES.otro;
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="control-point-icon" style="background-color:${meta.color};"><i class="fas ${meta.icon}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });
}
function renderControlPointMarker(point) {
    const marker = L.marker([point.lat, point.lng], { icon: getControlPointIcon(point.type) });
    marker.bindPopup(buildControlPointPopupHtml(point));
    controlPointsCluster.addLayer(marker);
    controlPointMarkers[point.id] = marker;
    return marker;
}
function buildControlPointPopupHtml(point) {
    const meta = CONTROL_POINT_TYPES[point.type] || CONTROL_POINT_TYPES.otro;
    const severityLabel = { baja: 'Baja', media: 'Media', alta: 'Alta' }[point.severity] || point.severity;
    const canResolve = currentUser && (currentUser.id === point.reported_by || ['agente', 'admin'].includes(currentUserRole));
    return `
        <div style="font-family:'Inter',sans-serif; min-width:170px;">
            <strong>${meta.label}</strong><br>
            <span style="font-size:12px; color:#6b7280;">Severidad: ${severityLabel}</span>
            ${point.description ? `<p style="margin:6px 0 0 0; font-size:13px;">${escapeHtml(point.description)}</p>` : ''}
            <div class="cp-popup-actions">
                <button onclick="confirmControlPoint('${point.id}')" class="cp-popup-btn">
                    <i class="fas fa-check"></i> Confirmar (<span id="cp-count-${point.id}">${point.confirmations_count || 0}</span>)
                </button>
                ${canResolve ? `<button onclick="resolveControlPoint('${point.id}')" class="cp-popup-btn cp-popup-btn-resolve">Resuelto</button>` : ''}
            </div>
        </div>
    `;
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
    const { error } = await supabaseClient
        .from('control_points')
        .update({ status: 'resuelto', resolved_at: new Date().toISOString() })
        .eq('id', pointId);
    if (error) {
        console.error('Error al resolver punto:', error.message);
        showToast('No se pudo marcar el punto como resuelto.', 'error');
        return;
    }
    const marker = controlPointMarkers[pointId];
    if (marker) {
        controlPointsCluster.removeLayer(marker);
        delete controlPointMarkers[pointId];
    }
    showToast('Punto marcado como resuelto.', 'success');
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
    listEl.innerHTML = data.map(point => {
        const meta = CONTROL_POINT_TYPES[point.type] || CONTROL_POINT_TYPES.otro;
        const resolvedDate = point.resolved_at ? new Date(point.resolved_at).toLocaleString('es-SV') : '-';
        return `
            <div class="user-row" style="cursor:pointer; align-items:flex-start;" onclick="focusHistoryPoint(${point.lat}, ${point.lng})">
                <div style="flex:1;">
                    <strong style="font-size:13px;">${meta.label}</strong><br>
                    <span style="font-size:11px; color:#6b7280;">Resuelto: ${resolvedDate}</span>
                    ${point.description ? `<p style="margin:4px 0 0 0; font-size:12px;">${escapeHtml(point.description)}</p>` : ''}
                </div>
            </div>
        `;
    }).join('');
}
function focusHistoryPoint(lat, lng) {
    closeHistoryPanel();
    map.flyTo([lat, lng], 17);
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
}
function stopSharingLocation() {
    isSharingLocation = false;
    document.getElementById('share-location-btn').classList.remove('active-mode');
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
    if (currentUser && supabaseClient) {
        supabaseClient.from('agent_locations').delete().eq('user_id', currentUser.id);
    }
    removeAgentLocationMarker(currentUser ? currentUser.id : null);
    showToast('Dejaste de compartir tu ubicación.', 'info');
}
async function sendAgentLocation(lat, lng) {
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
    const { data, error } = await supabaseClient.from('agent_locations').select('*');
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
    const listEl = document.getElementById('route-options-list');
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
    // Mejora progresiva: si Google Maps está configurado, actualizamos con el
    // tiempo real de tráfico en vivo en cuanto llegue (puede tardar un poco más).
    const trafficInfo = await getGoogleTrafficDuration(lastRouteFrom, lastRouteTo);
    if (trafficInfo && routeLine && selectedRouteIndex === index) {
        showRouteSummary(route.distance, trafficInfo.durationInTrafficSeconds, trafficInfo.durationSeconds);
    }
}
function loadGoogleMapsScript() {
    if (googleMapsLoadPromise) return googleMapsLoadPromise;
    if (typeof GOOGLE_MAPS_API_KEY === 'undefined' || !GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes('TU-')) {
        googleMapsLoadPromise = Promise.reject(new Error('Google Maps no está configurado.'));
        return googleMapsLoadPromise;
    }
    googleMapsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('No se pudo cargar Google Maps.'));
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
    document.getElementById('control-point-backdrop').classList.add('active');
    document.getElementById('control-point-modal').classList.add('active');
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
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
        type: type,
        severity: document.getElementById('cp-severity').value,
        description: document.getElementById('cp-description').value.trim() || null,
        reported_by: currentUser.id,
        expires_at: new Date(Date.now() + expirationHours * 3600 * 1000).toISOString()
    };
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
    showToast('Punto de control registrado.', 'success');
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
                userMarker = L.marker([lat, lng], {icon: userIcon, zIndexOffset: 1000}).addTo(map);
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
         if(document.getElementById('search-input').value.length > 0) {
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
    // Sincronizar con el estado del checkbox
    isTrafficVisible = checkbox.checked;
    if (isTrafficVisible) {
        // Mostrar tráfico
        trafficTileLayer.addTo(map);
        legend.style.display = 'flex';
    } else {
        // Ocultar tráfico
        map.removeLayer(trafficTileLayer);
        legend.style.display = 'none';
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
window.onload = function() {
    if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('TU-PROYECTO')) {
        console.warn('Supabase no está configurado. Edita js/config.js con tus credenciales.');
        document.getElementById('gate-error').innerText = 'La app no está configurada correctamente. Contacta al administrador.';
        document.getElementById('gate-error').classList.remove('hidden');
        showAuthGate();
        return;
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    initAuth();
};
window.addEventListener('beforeunload', function() {
    if (isSharingLocation && currentUser && supabaseClient) {
        supabaseClient.from('agent_locations').delete().eq('user_id', currentUser.id);
    }
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('sw.js').catch(function(error) {
            console.warn('No se pudo registrar el service worker:', error);
        });
    });
}