/* =============================================
   Gestor de Tráfico - Lógica de Autenticación (login.html)
   ============================================= */

let supabaseClient = null;

document.addEventListener('DOMContentLoaded', async () => {
    initEyeToggle();
    initSupabase();
    await checkExistingSession();
});

function initEyeToggle() {
    const btn = document.getElementById('gate-toggle-eye');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const input = document.getElementById('gate-password');
        const icon = document.getElementById('gate-eye-icon');
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) {
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            }
        } else {
            input.type = 'password';
            if (icon) {
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }
    });
}

function initSupabase() {
    if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
        supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        window.supabaseClient = supabaseClient;
    } else {
        console.error('Supabase configuration missing.');
    }
}

async function checkExistingSession() {
    if (!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        window.location.replace('/mapa/map.html');
    }
}

window.submitGateAuthForm = async function (event) {
    event.preventDefault();
    const errorEl = document.getElementById('gate-error');
    errorEl.classList.add('hidden');
    errorEl.style.color = '#dc2626';

    if (!supabaseClient) {
        errorEl.innerText = 'Error de configuración: Supabase no está listo.';
        errorEl.classList.remove('hidden');
        return;
    }

    const email = document.getElementById('gate-email').value.trim();
    const password = document.getElementById('gate-password').value;
    const btn = document.getElementById('gate-submit-btn');

    btn.disabled = true;
    btn.innerText = 'Iniciando sesión...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    btn.disabled = false;
    btn.innerHTML = 'Iniciar Sesión &nbsp;<i class="fas fa-arrow-right"></i>';

    if (error) {
        errorEl.innerText = error.message;
        errorEl.classList.remove('hidden');
        return;
    }

    window.location.replace('/mapa/map.html');
};
