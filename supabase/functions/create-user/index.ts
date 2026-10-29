// Edge Function: un admin crea un usuario (con rol y distrito) sin enviar correo de confirmación.
// Evita el límite de correos de Supabase y permite cerrar los registros públicos.
// Cuerpo: { email, password, full_name, role, district }
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los provee Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLES = ['ciudadano', 'agente', 'admin'];
const DISTRICTS = ['Panchimalco', 'Rosario de Mora', 'San Marcos', 'Santiago Texacuangos', 'Santo Tomás'];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No autorizado' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Solo un administrador puede crear usuarios
    const { data: caller } = await admin.from('profiles').select('role').eq('id', userData.user.id).single();
    if (caller?.role !== 'admin') return json({ error: 'Solo un administrador puede crear usuarios' }, 403);

    let body: Record<string, string | null>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Solicitud inválida' }, 400);
    }
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'ciudadano');
    const district = body.district ? String(body.district) : null;

    if (!email || !fullName) return json({ error: 'Faltan el nombre o el correo' }, 400);
    if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Rol inválido' }, 400);
    if (district && !DISTRICTS.includes(district)) return json({ error: 'Distrito inválido' }, 400);
    if (role === 'agente' && !district) return json({ error: 'El distrito es obligatorio para agentes' }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
        const message = createError?.message ?? 'No se pudo crear el usuario';
        return json({ error: /already|registered|exists/i.test(message) ? 'Ya existe un usuario con ese correo' : message }, 400);
    }

    // El perfil lo crea un trigger al insertar el usuario; aquí se completa
    const profile = { id: created.user.id, email, full_name: fullName, role, district };
    const { error: profileError } = await admin.from('profiles').upsert(profile);
    if (profileError) {
        console.error('Usuario creado, pero falló el perfil:', profileError.message);
        return json({ id: created.user.id, warning: 'Usuario creado, pero no se pudo asignar el rol o el distrito. Cámbialos desde la lista.' });
    }

    return json({ id: created.user.id });
});
