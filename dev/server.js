const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadDotEnv();

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const SIGNICAT_API_BASE_URL = (
  process.env.SIGNICAT_API_BASE_URL || "https://api.signicat.com"
).replace(/\/$/, "");
const SIGNICAT_API_TOKEN = process.env.SIGNICAT_API_TOKEN || "";
const SIGNICAT_CLIENT_ID = process.env.SIGNICAT_CLIENT_ID || "";
const SIGNICAT_CLIENT_SECRET = process.env.SIGNICAT_CLIENT_SECRET || "";
const EXPECTED_ID_NUMBER = process.env.EXPECTED_ID_NUMBER || "";
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DEFAULT_REDIRECT_PATH = process.env.DEFAULT_REDIRECT_PATH || "/callback";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

let cachedAccessToken = null;
let runtimeAuth = createRuntimeAuthState();

function createRuntimeAuthState() {
  return {
    apiBaseUrl: SIGNICAT_API_BASE_URL,
    apiToken: SIGNICAT_API_TOKEN,
    clientId: SIGNICAT_CLIENT_ID,
    clientSecret: SIGNICAT_CLIENT_SECRET,
    expectedIdNumber: EXPECTED_ID_NUMBER,
    authMode: SIGNICAT_API_TOKEN ? "token" : "client_credentials",
    source: "env",
  };
}

function loadDotEnv() {
  const envPaths = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function getEffectiveApiBaseUrl() {
  return (runtimeAuth.apiBaseUrl || SIGNICAT_API_BASE_URL).replace(/\/$/, "");
}

function getEffectiveAuthMode() {
  if (runtimeAuth.authMode === "token" && runtimeAuth.apiToken) {
    return "token";
  }
  return "client_credentials";
}

function getBasicAuthHeaderValue() {
  const clientId = runtimeAuth.clientId || SIGNICAT_CLIENT_ID;
  const clientSecret = runtimeAuth.clientSecret || SIGNICAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

async function getAccessToken() {
  const apiToken = runtimeAuth.apiToken || SIGNICAT_API_TOKEN;
  if (getEffectiveAuthMode() === "token") {
    if (!apiToken) {
      throw new Error("API token mode is selected, but no API token is configured.");
    }
    return apiToken;
  }

  if (
    cachedAccessToken &&
    cachedAccessToken.value &&
    cachedAccessToken.expiresAt > Date.now() + 30_000
  ) {
    return cachedAccessToken.value;
  }

  const basicAuthValue = getBasicAuthHeaderValue();
  if (!basicAuthValue) {
    throw new Error(
      "Missing Signicat credentials. Add a client ID and client secret in the UI, or provide an API token."
    );
  }

  let response;
  try {
    response = await fetch(`${getEffectiveApiBaseUrl()}/auth/open/connect/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuthValue}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "signicat-api",
      }).toString(),
    });
  } catch (error) {
    const tokenError = new Error(`Could not reach Signicat token endpoint: ${error.message}`);
    tokenError.status = 502;
    throw tokenError;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(`Signicat token request failed with ${response.status}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 600) * 1000,
  };

  return cachedAccessToken.value;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
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
  const url = `${getEffectiveApiBaseUrl()}${endpoint}`;
  const accessToken = await getAccessToken();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...options.headers,
  };

  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body,
    });
  } catch (error) {
    const fetchError = new Error(
      `Could not reach Signicat for ${options.method || "GET"} ${endpoint}: ${error.message}`
    );
    fetchError.status = 502;
    throw fetchError;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(`Signicat request failed with ${response.status}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
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

function buildSettingsPayload() {
  const effectiveApiBaseUrl = getEffectiveApiBaseUrl();
  const effectiveAuthMode = getEffectiveAuthMode();
  const hasApiToken = Boolean(runtimeAuth.apiToken || SIGNICAT_API_TOKEN);
  const hasClientCredentials = Boolean(
    (runtimeAuth.clientId || SIGNICAT_CLIENT_ID) && (runtimeAuth.clientSecret || SIGNICAT_CLIENT_SECRET)
  );

  return {
    apiBaseUrl: effectiveApiBaseUrl,
    authMode: effectiveAuthMode,
    hasToken: effectiveAuthMode === "token" ? hasApiToken : hasClientCredentials,
    hasClientId: Boolean(runtimeAuth.clientId || SIGNICAT_CLIENT_ID),
    hasClientSecret: Boolean(runtimeAuth.clientSecret || SIGNICAT_CLIENT_SECRET),
    appBaseUrl: APP_BASE_URL,
    defaultRedirectUrl: buildRedirectUrl(),
    authSource: runtimeAuth.source,
    tokenConfigured: hasApiToken,
    clientCredentialsConfigured: hasClientCredentials,
    expectedIdNumber: runtimeAuth.expectedIdNumber || EXPECTED_ID_NUMBER,
  };
}

function buildRedirectUrl() {
  return `${APP_BASE_URL}${DEFAULT_REDIRECT_PATH}`;
}

function serveStaticFile(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Not found");
        return;
      }
      sendText(res, 500, "Internal server error");
      return;
    }

    const ext = path.extname(filePath);
    sendText(res, 200, content, MIME_TYPES[ext] || "application/octet-stream");
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, buildSettingsPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(req);

    runtimeAuth = {
      apiBaseUrl: String(body.apiBaseUrl || SIGNICAT_API_BASE_URL).trim().replace(/\/$/, ""),
      apiToken: String(body.apiToken || "").trim(),
      clientId: String(body.clientId || "").trim(),
      clientSecret: String(body.clientSecret || "").trim(),
      expectedIdNumber: String(body.expectedIdNumber || "").trim(),
      authMode: body.authMode === "token" ? "token" : "client_credentials",
      source: "ui",
    };
    cachedAccessToken = null;

    sendJson(res, 200, {
      message: "Connection settings updated for this running app session.",
      settings: buildSettingsPayload(),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/settings") {
    runtimeAuth = createRuntimeAuthState();
    cachedAccessToken = null;
    sendJson(res, 200, {
      message: "Connection settings reset to environment defaults.",
      settings: buildSettingsPayload(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/document-types") {
    const body = await readBody(req);
    const provider = body.provider || "signicatvideoid";
    const result = await signicatFetch(`/assure/${encodeURIComponent(provider)}/document-types`);
    sendJson(res, 200, {
      data: result.payload,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/capture-configurations") {
    const result = await signicatFetch("/assure/capture/configurations");
    sendJson(res, 200, {
      data: result.payload,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dossiers") {
    const result = await signicatFetch("/assure/dossiers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    sendJson(res, 200, {
      data: result.payload,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/dossiers") {
    const result = await signicatFetch("/assure/dossiers");
    sendJson(res, 200, {
      data: result.payload,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/dossiers") {
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

    sendJson(res, 200, {
      message: `Deleted ${deletedIds.length} dossier(s).`,
      deletedIds,
      signicatRequests,
    });
    return;
  }

  const dossierMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)$/);
  if (req.method === "DELETE" && dossierMatch) {
    const dossierId = decodeURIComponent(dossierMatch[1]);
    const result = await signicatFetch(`/assure/dossiers/${encodeURIComponent(dossierId)}`, {
      method: "DELETE",
    });
    sendJson(res, 200, {
      message: "Dossier deleted successfully.",
      dossierId,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/capture/start") {
    const body = await readBody(req);
    const dossierId = body.dossierId;

    if (!dossierId) {
      sendJson(res, 400, { error: "dossierId is required." });
      return;
    }

    const payload = {
      providers: [
        {
          provider: body.provider || "signicatvideoid",
          processType: body.processType || "substantialFullyAuto",
        },
      ],
      sdk: body.sdk || "native",
      redirectUrl: body.redirectUrl || buildRedirectUrl(),
    };

    if (body.requestDomain) {
      payload.requestDomain = body.requestDomain;
    }

    const captureParameters = {
      ...(body.captureParameters || {}),
    };

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
      `/assure/dossiers/${encodeURIComponent(dossierId)}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    sendJson(res, 200, {
      request: payload,
      requestChain: {
        dossierId,
        uiProfile: body.uiProfile || null,
        resolvedCaptureConfigurationId: resolvedUiProfile ? resolvedUiProfile.id || body.uiProfile : null,
        resolvedCaptureConfiguration: resolvedUiProfile,
      },
      response: result.payload,
      signicatRequests: [resolvedUiProfileRequest, result.request].filter(Boolean),
    });
    return;
  }

  const processMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/processes\/([^/]+)$/);
  if (req.method === "GET" && processMatch) {
    const dossierId = decodeURIComponent(processMatch[1]);
    const processId = decodeURIComponent(processMatch[2]);
    const result = await signicatFetch(
      `/assure/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`
    );
    sendJson(res, 200, {
      data: result.payload,
      signicatRequest: result.request,
    });
    return;
  }

  if (req.method === "DELETE" && processMatch) {
    const dossierId = decodeURIComponent(processMatch[1]);
    const processId = decodeURIComponent(processMatch[2]);
    const result = await signicatFetch(
      `/assure/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`,
      {
        method: "DELETE",
      }
    );
    sendJson(res, 200, {
      message: "Process deleted successfully.",
      dossierId,
      processId,
      signicatRequest: result.request,
    });
    return;
  }

  const configMatch = url.pathname.match(/^\/api\/capture-configurations\/([^/]+)$/);
  if (configMatch) {
    const configId = decodeURIComponent(configMatch[1]);

    if (req.method === "GET") {
      const result = await signicatFetch(
        `/assure/capture/configurations/${encodeURIComponent(configId)}`
      );
      sendJson(res, 200, {
        data: result.payload,
        signicatRequest: result.request,
      });
      return;
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      const result = await signicatFetch(
        `/assure/capture/configurations/${encodeURIComponent(configId)}`,
        {
          method: req.method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      sendJson(res, 200, {
        data: result.payload,
        signicatRequest: result.request,
      });
      return;
    }
  }

  sendJson(res, 404, { error: "Unknown API route." });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_BASE_URL);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed");
      return;
    }

    if (url.pathname === "/callback") {
      serveStaticFile(res, "/callback.html");
      return;
    }

    serveStaticFile(res, url.pathname);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message,
      details: error.payload || null,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VideoID sandbox app running at ${APP_BASE_URL}`);
});
