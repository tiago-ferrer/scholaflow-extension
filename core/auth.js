/**
 * auth.js — Authentication management for Scholaflow
 *
 * Handles JWT token storage, retrieval, expiration, and session persistence.
 * Tokens are stored exclusively in chrome.storage.local and never exposed
 * to page scripts.
 */

const AUTH_STORAGE_KEY = "scholaflow_auth";
const API_BASE = "https://b-paperhub.tferrer.dev";

/**
 * @typedef {Object} AuthSession
 * @property {string} token
 * @property {string} token_type
 * @property {number} expires_at  — Unix timestamp (ms) when token expires
 * @property {string} username
 */

/**
 * Login with username + password. Stores session on success.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<AuthSession>}
 */
export async function login(username, password) {
  const response = await fetch(`${API_BASE}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed (${response.status}): ${body}`);
  }

  const data = await response.json();

  const session = {
    token: data.token,
    token_type: data.token_type ?? "Bearer",
    expires_at: Date.now() + (data.expires_in ?? 86400) * 1000,
    username,
  };

  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: session });
  return session;
}

/**
 * Retrieve the current valid session, or null if not authenticated / expired.
 * @returns {Promise<AuthSession|null>}
 */
export async function getSession() {
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  const session = result[AUTH_STORAGE_KEY];

  if (!session) return null;

  // Consider token expired 60s before actual expiry to avoid race conditions
  if (Date.now() >= session.expires_at - 60_000) {
    await clearSession();
    return null;
  }

  return session;
}

/**
 * Returns true if the user is currently authenticated with a valid token.
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  return (await getSession()) !== null;
}

/**
 * Returns the Bearer token string for use in Authorization headers.
 * Throws if not authenticated.
 * @returns {Promise<string>}
 */
export async function getAuthHeader() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return `${session.token_type} ${session.token}`;
}

/**
 * Clear the stored session (logout).
 * @returns {Promise<void>}
 */
export async function clearSession() {
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

/**
 * Returns the logged-in username, or null.
 * @returns {Promise<string|null>}
 */
export async function getUsername() {
  const session = await getSession();
  return session?.username ?? null;
}
