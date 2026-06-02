import { showToast } from "./ui.js";

export let supabaseClient = null;
export let currentUser = null;

// Initialize Supabase Client dynamically
export function initSupabase(url, anonKey) {
  let supabaseUrl = url.trim().replace(/\/rest\/v1\/?$/, "");
  if (supabaseUrl.endsWith("/")) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }
  
  console.log("⚡ Initializing Supabase client with URL:", supabaseUrl);
  supabaseClient = window.supabase.createClient(supabaseUrl, anonKey.trim());
  return supabaseClient;
}

// Supabase Authentication Operations
export async function signIn(email, password) {
  if (!supabaseClient) throw new Error("Supabase is not initialized.");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return data;
}

export async function signUp(email, password) {
  if (!supabaseClient) throw new Error("Supabase is not initialized.");
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentUser = null;
    showToast("Signed out successfully.", "");
  }
}

// Bind observer callbacks on Auth State shifts
export function onAuthChange(callback) {
  if (!supabaseClient) return;
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    callback(event, session);
  });
}
