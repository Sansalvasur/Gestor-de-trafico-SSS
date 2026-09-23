/* =============================================
   Configuración de Supabase y APIs
   Las claves se leen desde el archivo .env (nunca se sube a GitHub).
   Para desarrollo: crea un archivo .env copiando .env.example
   ============================================= */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Exponer como globales para que app.js (script normal) pueda usarlos
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_API_KEY;
