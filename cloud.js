/*
 * Nube de NutriLab (Supabase): cuentas de nutricionistas, suscripción, datos y fotos.
 * Solo se usa si config.js tiene la URL y la clave pública del proyecto.
 */
import { createClient } from './vendor/supabase-js-2.117.2.mjs';

let sb = null;

export function init(cfg) {
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'nutrilab-auth' },
  });
}

const AUTH_ERRORS = [
  [/invalid login credentials/i, 'Email o contraseña incorrectos'],
  [/email not confirmed/i, 'Confirma tu email: te hemos enviado un enlace'],
  [/already registered|already been registered/i, 'Ya existe una cuenta con ese email'],
  [/password should be at least/i, 'La contraseña debe tener al menos 8 caracteres'],
  [/rate limit|too many/i, 'Demasiados intentos. Espera un momento'],
  [/fetch|network/i, 'Sin conexión. Revisa tu internet'],
];
const authMsg = (e) => AUTH_ERRORS.find(([re]) => re.test(e?.message || ''))?.[1] || e?.message || 'Error de acceso';

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}
export const onAuthChange = (cb) => sb.auth.onAuthStateChange((event, session) => cb(event, session?.user || null));

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authMsg(error));
  return data.user;
}
export async function signUp(name, email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(authMsg(error));
  return { user: data.user, needsConfirm: !data.session };
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(authMsg(error));
}
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(authMsg(error));
}
export const signOut = () => sb.auth.signOut();

export async function profile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (error) throw new Error('No se pudo leer tu cuenta');
  return data;
}

// Acceso: suscripción activa, unos días de margen si falla un cobro, o prueba gratuita vigente (igual que en la base de datos).
export function hasAccess(p) {
  if (!p) return false;
  const now = Date.now();
  if (['active', 'trialing'].includes(p.subscription_status)) return true;
  if (p.subscription_status === 'past_due' && (!p.current_period_end || Date.parse(p.current_period_end) > now - 7 * 864e5)) return true;
  return !!p.trial_ends_at && Date.parse(p.trial_ends_at) > now;
}

// Solo la fecha de la última modificación: así no se descarga todo si nada ha cambiado.
export async function stamp(uid) {
  const { data, error } = await sb.from('workspaces').select('updated_at').eq('owner', uid).maybeSingle();
  if (error) throw new Error('No se pudo conectar con tu cuenta');
  return data?.updated_at || null;
}
export async function pull(uid) {
  const { data, error } = await sb.from('workspaces').select('data, updated_at').eq('owner', uid).maybeSingle();
  if (error) throw new Error('No se pudieron descargar tus datos');
  return data;
}
export async function push(uid, doc) {
  const { data, error } = await sb.from('workspaces').upsert({ owner: uid, data: doc }).select('updated_at').single();
  if (error) throw new Error(error.code === '42501' ? 'Tu suscripción no está activa: los cambios solo se guardan en este dispositivo' : 'No se pudieron guardar tus datos en la nube');
  return data.updated_at;
}

export async function uploadPhoto(uid, id, blob, type) {
  const { error } = await sb.storage.from('photos').upload(`${uid}/${id}`, blob, { contentType: type, upsert: true });
  if (error) throw new Error('No se pudo subir una foto');
}
export async function downloadPhoto(uid, id) {
  const { data, error } = await sb.storage.from('photos').download(`${uid}/${id}`);
  if (error) throw new Error('La foto aún no está en la nube');
  return data;
}
export async function removePhotos(uid, ids) {
  if (ids.length) await sb.storage.from('photos').remove(ids.map((id) => `${uid}/${id}`));
}

// Funciones del servidor: create-checkout (pagar) y billing-portal (gestionar suscripción).
export async function callFunction(name) {
  const { data, error } = await sb.functions.invoke(name, { method: 'POST' });
  if (error) {
    let msg = 'No se pudo conectar con el servidor';
    try { msg = (await error.context.json()).error || msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data;
}
