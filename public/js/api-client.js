import { state } from "./state.js";

const SESSION_STORAGE_KEY = "videoidSandboxSession";
const SESSION_COOKIE_KEY = "videoidSandboxSessionCookie";
const RATE_STORAGE_KEY = "videoidSandboxRateWindow";
const STATIC_MAX_CONCURRENT_REQUESTS = 2;
const STATIC_MIN_REQUEST_GAP_MS = 750;
const STATIC_RATE_WINDOW_MS = 60_000;
const STATIC_RATE_WINDOW_LIMIT = 30;

export async function api(path, options = {}) {
  if (state.apiMode === "static") {
    return staticApi(path, options);
  }

  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw new Error(
      `Could not reach the local API server for ${options.method || "GET"} ${path}. Start the app with npm start and open http://127.0.0.1:3000. Original error: ${error.message}`
    );
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

export function isStaticHostingLikely() {
  return window.location.protocol === "file:" || window.location.hostname.endsWith(".github.io");
}

function getDefaultRedirectUrl() {
  return new URL("callback.html", window.location.href).toString();
}

export function loadStaticAuth() {
  const cookieAuth = readSessionCookieAuth();
  if (cookieAuth) {
    return cookieAuth;
  }

  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function readSessionCookieAuth() {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_KEY}=`));

  if (!cookie) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(cookie.slice(SESSION_COOKIE_KEY.length + 1)));
  } catch (_error) {
    return null;
  }
}

function writeSessionCookieAuth(auth) {
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE_KEY}=${encodeURIComponent(
    JSON.stringify(auth)
  )}; Path=${getCookiePath()}; SameSite=Lax${secureFlag}`;
}

function clearSessionCookieAuth() {
  document.cookie = `${SESSION_COOKIE_KEY}=; Path=${getCookiePath()}; Max-Age=0; SameSite=Lax`;
}

function getCookiePath() {
  const path = window.location.pathname;
  if (path.endsWith("/")) {
    return path;
  }

  const slashIndex = path.lastIndexOf("/");
  if (slashIndex === -1) {
    return "/";
  }

  return path.slice(0, slashIndex + 1) || "/";
}

function clearPersistentStaticAuth() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("videoidSandboxPersistentSession")) {
        localStorage.removeItem(key);
      }
    }
  } catch (_error) {
    // Ignore unavailable storage.
  }
}

function persistStaticAuth(auth) {
  clearPersistentStaticAuth();
  writeSessionCookieAuth(auth);

  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(auth));
  } catch (_error) {
    // Session storage is a fallback only; ignore if unavailable.
  }
}

function saveStaticAuth(auth) {
  state.staticAuth = {
    ...auth,
    staticMode: true,
  };
  persistStaticAuth(state.staticAuth);
}

function clearStaticAuth() {
  clearPersistentStaticAuth();
  clearSessionCookieAuth();

  state.staticAuth = {
    apiBaseUrl: "https://api.signicat.com",
    authMode: "client_credentials",
    expectedIdNumber: "",
    staticMode: true,
  };
  persistStaticAuth(state.staticAuth);
}

export function buildStaticSettings() {
  const auth = state.staticAuth || loadStaticAuth();
  state.staticAuth = auth;
  const authMode = auth.authMode === "token" ? "token" : "client_credentials";
  const hasClientCredentials = Boolean(auth.clientId && auth.clientSecret);
  const hasApiToken = Boolean(auth.apiToken);

  return {
    apiBaseUrl: (auth.apiBaseUrl || "https://api.signicat.com").replace(/\/$/, ""),
    authMode,
    hasToken: authMode === "token" ? hasApiToken : hasClientCredentials,
    hasClientId: Boolean(auth.clientId),
    hasClientSecret: Boolean(auth.clientSecret || auth.apiToken),
    appBaseUrl: window.location.origin,
    defaultRedirectUrl: getDefaultRedirectUrl(),
    authSource: "this browser",
    tokenConfigured: hasApiToken,
    clientCredentialsConfigured: hasClientCredentials,
    expectedIdNumber: auth.expectedIdNumber || "",
  };
}

function getStaticApiBaseUrl() {
  return buildStaticSettings().apiBaseUrl;
}

function readJsonResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadRateWindow() {
  try {
    const windowState = JSON.parse(sessionStorage.getItem(RATE_STORAGE_KEY) || "{}");
    if (
      !windowState.startedAt ||
      !Number.isFinite(windowState.count) ||
      Date.now() - windowState.startedAt > STATIC_RATE_WINDOW_MS
    ) {
      return { startedAt: Date.now(), count: 0 };
    }
    return windowState;
  } catch (_error) {
    return { startedAt: Date.now(), count: 0 };
  }
}

function saveRateWindow(windowState) {
  sessionStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(windowState));
}

async function waitForStaticRequestSlot() {
  while (state.activeStaticRequests >= STATIC_MAX_CONCURRENT_REQUESTS) {
    await sleep(250);
  }

  const sinceLastRequest = Date.now() - state.lastStaticRequestAt;
  if (sinceLastRequest < STATIC_MIN_REQUEST_GAP_MS) {
    await sleep(STATIC_MIN_REQUEST_GAP_MS - sinceLastRequest);
  }

  const windowState = loadRateWindow();
  if (windowState.count >= STATIC_RATE_WINDOW_LIMIT) {
    const retryAfterMs = Math.max(0, STATIC_RATE_WINDOW_MS - (Date.now() - windowState.startedAt));
    throw new Error(
      `Static mode request limit reached. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before calling Signicat again.`
    );
  }

  windowState.count += 1;
  saveRateWindow(windowState);
  state.activeStaticRequests += 1;
  state.lastStaticRequestAt = Date.now();

  return () => {
    state.activeStaticRequests = Math.max(0, state.activeStaticRequests - 1);
  };
}

async function getStaticAccessToken() {
  const auth = state.staticAuth || loadStaticAuth();
  state.staticAuth = auth;

  if (auth.authMode === "token") {
    if (!auth.apiToken) {
      throw new Error("API token mode is selected, but no browser-session API token is configured.");
    }
    return auth.apiToken;
  }

  if (auth.accessToken && auth.accessTokenExpiresAt > Date.now() + 30_000) {
    return auth.accessToken;
  }

  if (!auth.clientId || !auth.clientSecret) {
    throw new Error("Missing browser-session Signicat client ID or client secret.");
  }

  const releaseSlot = await waitForStaticRequestSlot();
  let response;
  let payload;
  try {
    const tokenUrl = `${getStaticApiBaseUrl()}/auth/open/connect/token`;
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${auth.clientId}:${auth.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "signicat-api",
      }).toString(),
    });
    payload = await readJsonResponse(response);
  } catch (error) {
    throw new Error(
      `Browser request to Signicat token endpoint was blocked or failed. If you are using the hosted/static app, this is usually CORS; run the local server with npm start and open http://127.0.0.1:3000. Original error: ${error.message}`
    );
  } finally {
    releaseSlot();
  }

  if (!response.ok) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Signicat token request failed with ${response.status}. If this is a browser CORS error, use the server-backed mode.`
    );
  }

  saveStaticAuth({
    ...auth,
    accessToken: payload.access_token,
    accessTokenExpiresAt: Date.now() + Number(payload.expires_in || 600) * 1000,
  });

  return payload.access_token;
}

function normalizeRequestBody(body, headers = {}) {
  if (body === undefined || body === null || body === "") {
    return null;
  }

  const contentType = headers["Content-Type"] || headers["content-type"] || "";
  if (typeof body !== "string") {
    return body;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch (_error) {
      return body;
    }
  }

  return body;
}

async function signicatFetch(endpoint, options = {}) {
  const url = `${getStaticApiBaseUrl()}${endpoint}`;
  const accessToken = await getStaticAccessToken();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...options.headers,
  };
  const releaseSlot = await waitForStaticRequestSlot();
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body,
    });
    payload = await readJsonResponse(response);
  } catch (error) {
    throw new Error(
      `Browser request to Signicat failed for ${options.method || "GET"} ${endpoint}. If you are using the hosted/static app, this is usually CORS; run the local server with npm start and open http://127.0.0.1:3000. Original error: ${error.message}`
    );
  } finally {
    releaseSlot();
  }

  if (!response.ok) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Signicat request failed with ${response.status}. If this is a browser CORS error, use the server-backed mode.`
    );
  }

  return {
    status: response.status,
    payload,
    request: {
      url,
      endpoint,
      method: options.method || "GET",
      body: normalizeRequestBody(options.body, headers),
    },
  };
}

async function staticApi(path, options = {}) {
  const method = options.method || "GET";

  if (method === "GET" && path === "/api/settings") {
    return buildStaticSettings();
  }

  if (method === "POST" && path === "/api/settings") {
    const body = options.body || {};
    const authMode = body.authMode === "token" ? "token" : "client_credentials";
    saveStaticAuth({
      apiBaseUrl: String(body.apiBaseUrl || "https://api.signicat.com").trim().replace(/\/$/, ""),
      authMode,
      apiToken: authMode === "token" ? String(body.clientSecret || body.apiToken || "").trim() : "",
      clientId: authMode === "client_credentials" ? String(body.clientId || "").trim() : "",
      clientSecret: authMode === "client_credentials" ? String(body.clientSecret || "").trim() : "",
      expectedIdNumber: String(body.expectedIdNumber || "").trim(),
    });
    return {
      message: "Connection settings saved in this browser for hosted callbacks.",
      settings: buildStaticSettings(),
    };
  }

  if (method === "DELETE" && path === "/api/settings") {
    clearStaticAuth();
    return {
      message: "Browser connection settings cleared.",
      settings: buildStaticSettings(),
    };
  }

  if (method === "POST" && path === "/api/document-types") {
    const body = options.body || {};
    const provider = body.provider || "signicatvideoid";
    const result = await signicatFetch(`/assure/${encodeURIComponent(provider)}/document-types`);
    return { data: result.payload, signicatRequest: result.request };
  }

  if (method === "GET" && path === "/api/capture-configurations") {
    const result = await signicatFetch("/assure/capture/configurations");
    return { data: result.payload, signicatRequest: result.request };
  }

  if (method === "POST" && path === "/api/dossiers") {
    const result = await signicatFetch("/assure/dossiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return { data: result.payload, signicatRequest: result.request };
  }

  if (method === "GET" && path === "/api/dossiers") {
    const result = await signicatFetch("/assure/dossiers");
    return { data: result.payload, signicatRequest: result.request };
  }

  if (method === "DELETE" && path === "/api/dossiers") {
    const result = await signicatFetch("/assure/dossiers");
    const dossiers = Array.isArray(result.payload) ? result.payload : [];
    const deletedIds = [];
    const signicatRequests = [result.request];

    for (const dossier of dossiers) {
      const dossierId = dossier.dossierId || dossier.id;
      if (!dossierId) {
        continue;
      }
      const deleteResult = await signicatFetch(`/assure/dossiers/${encodeURIComponent(dossierId)}`, {
        method: "DELETE",
      });
      deletedIds.push(dossierId);
      signicatRequests.push(deleteResult.request);
    }

    return {
      message: `Deleted ${deletedIds.length} dossier(s).`,
      deletedIds,
      signicatRequests,
    };
  }

  const dossierMatch = path.match(/^\/api\/dossiers\/([^/]+)$/);
  if (method === "DELETE" && dossierMatch) {
    const dossierId = decodeURIComponent(dossierMatch[1]);
    const result = await signicatFetch(`/assure/dossiers/${encodeURIComponent(dossierId)}`, {
      method: "DELETE",
    });
    return {
      message: "Dossier deleted successfully.",
      dossierId,
      signicatRequest: result.request,
    };
  }

  if (method === "POST" && path === "/api/capture/start") {
    const body = options.body || {};
    if (!body.dossierId) {
      throw new Error("dossierId is required.");
    }

    const payload = {
      providers: [
        {
          provider: body.provider || "signicatvideoid",
          processType: body.processType || "substantialFullyAuto",
        },
      ],
      sdk: body.sdk || "native",
      redirectUrl: body.redirectUrl || getDefaultRedirectUrl(),
    };

    if (body.requestDomain) {
      payload.requestDomain = body.requestDomain;
    }

    const captureParameters = { ...(body.captureParameters || {}) };
    if (body.uiProfile) {
      captureParameters.uiProfile = body.uiProfile;
    }
    if (Object.keys(captureParameters).length > 0) {
      payload.captureParameters = captureParameters;
    }

    let resolvedUiProfile = null;
    let resolvedUiProfileRequest = null;
    if (body.uiProfile) {
      const configResult = await signicatFetch(
        `/assure/capture/configurations/${encodeURIComponent(body.uiProfile)}`
      );
      resolvedUiProfile = configResult.payload;
      resolvedUiProfileRequest = configResult.request;
    }

    const result = await signicatFetch(
      `/assure/dossiers/${encodeURIComponent(body.dossierId)}/capture`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    return {
      request: payload,
      requestChain: {
        dossierId: body.dossierId,
        uiProfile: body.uiProfile || null,
        resolvedCaptureConfigurationId: resolvedUiProfile ? resolvedUiProfile.id || body.uiProfile : null,
        resolvedCaptureConfiguration: resolvedUiProfile,
      },
      response: result.payload,
      signicatRequests: [resolvedUiProfileRequest, result.request].filter(Boolean),
    };
  }

  const processMatch = path.match(/^\/api\/dossiers\/([^/]+)\/processes\/([^/]+)$/);
  if ((method === "GET" || method === "DELETE") && processMatch) {
    const dossierId = decodeURIComponent(processMatch[1]);
    const processId = decodeURIComponent(processMatch[2]);
    const result = await signicatFetch(
      `/assure/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`,
      method === "DELETE" ? { method: "DELETE" } : {}
    );
    return method === "DELETE"
      ? {
          message: "Process deleted successfully.",
          dossierId,
          processId,
          signicatRequest: result.request,
        }
      : { data: result.payload, signicatRequest: result.request };
  }

  const configMatch = path.match(/^\/api\/capture-configurations\/([^/]+)$/);
  if (configMatch) {
    const configId = decodeURIComponent(configMatch[1]);
    const endpoint = `/assure/capture/configurations/${encodeURIComponent(configId)}`;
    if (method === "GET") {
      const result = await signicatFetch(endpoint);
      return { data: result.payload, signicatRequest: result.request };
    }

    if (method === "PUT") {
      const deleteResult = await signicatFetch(endpoint, { method: "DELETE" });
      const createResult = await signicatFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body || {}),
      });
      return {
        data: createResult.payload,
        method: "DELETE+POST",
        message: "Existing configuration overwritten from static browser mode.",
        signicatRequests: [deleteResult.request, createResult.request],
      };
    }

    if (method === "POST") {
      const result = await signicatFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body || {}),
      });
      return { data: result.payload, signicatRequest: result.request };
    }
  }

  throw new Error("Unknown API route.");
}
