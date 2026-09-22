/* =============================================
   Configuración de Supabase
   Reemplaza estos dos valores con los de tu proyecto:
   Dashboard de Supabase > Project Settings > API
   ============================================= */

const SUPABASE_URL = 'https://wqtszetqkqvzfcswtbyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxdHN6ZXRxa3F2emZjc3d0YnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1OTczOTksImV4cCI6MjEwMzE3MzM5OX0.LEgMLoNIkW_Z8ElaQKbmQJHpiQkWMHC-58yO3jDMzvk';

/* API de Google Directions (opcional) - agrega el retraso real por tráfico en vivo
   a las rutas calculadas ("Indicaciones" / "Trazar ruta"). Requiere una cuenta de
   Google Cloud con facturación activada (tiene $200 USD/mes gratis, normalmente
   de sobra para este uso - pon una alerta de presupuesto en Cloud Console por si acaso):
   1. https://console.cloud.google.com > crea/selecciona un proyecto
   2. Habilita "Directions API" y "Maps JavaScript API"
   3. Crea una API key y restríngela por dominio (HTTP referrers) a tu sitio
   Deja el valor por defecto si no la configuras: las rutas siguen funcionando
   igual que antes, solo sin el dato de tráfico en vivo. */
const GOOGLE_MAPS_API_KEY = 'AIzaSyCHQn6OlJHU4AfJ0_p4LZLbc5McnWKsnkw';

