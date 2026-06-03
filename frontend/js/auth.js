import { showToast } from "./ui.js";

let client = null;
let currentUser = null;

export const getClient = () => client;
export const getUser   = () => currentUser;

export function initSupabase(url, anonKey) {
  const cleanUrl = url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  client = window.supabase.createClient(cleanUrl, anonKey.trim());
  return client;
}

export async function signIn(email, password) {
  if (!client) throw new Error("Supabase not initialized.");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return data;
}

export async function signUp(email, password) {
  if (!client) throw new Error("Supabase not initialized.");
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  currentUser = null;
  showToast("Signed out.", "");
}

export async function getToken() {
  if (!client) return null;
  try {
    const { data: { session } } = await client.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function onAuthChange(callback) {
  if (!client) return;
  client.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    callback(event, session);
  });
}
