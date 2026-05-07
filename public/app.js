const state = {
  documentTypes: [],
  settings: null,
  apiMode: "server",
  staticAuth: null,
  activeStaticRequests: 0,
  lastStaticRequestAt: 0,
};

const SESSION_STORAGE_KEY = "videoidSandboxSession";
const RATE_STORAGE_KEY = "videoidSandboxRateWindow";
const STATIC_MAX_CONCURRENT_REQUESTS = 2;
const STATIC_MIN_REQUEST_GAP_MS = 750;
const STATIC_RATE_WINDOW_MS = 60_000;
const STATIC_RATE_WINDOW_LIMIT = 30;

const starterConfig = {
  pageTitle: "VideoID Sandbox Demo",
  favicon: "",
  fontName: "",
  fontUrl: "",
  primaryColor: "",
  fontColor: "",
  buttonsColor: "",
  buttonsHoverColor: "",
  buttonsTextColor: "",
  spinnerColor: "",
  defaultCountry: "",
  allowFileUpload: [],
  allowTakePhoto: [],
  allowZoomOnPreview: [],
  useSignicatTheming: false,
  enableMobileHandover: true,
  enableOrientationConfirmation: false,
  autoCapture: false,
  detectGlare: [],
  customRedactionError: false,
  takeSelfie: false,
  smsDefaultCountry: "",
  maxRetries: 0,
  showModalBeforeRedirect: true,
  mobileHandoverTimeout: 0,
  mobileHandoverModes: [],
  forceMobileHandover: false,
  useNativeCamera: false,
  customCss: "",
  documentTypes: ["passport", "identityCard", "driversLicense"],
  documentCountries: [],
  defaultDocumentCountry: "",
  languages: ["en"],
  defaultLanguage: "en",
  showPrerequisitesScreen: true,
  showConsentPage: false,
  showCountryBeforeDocumentType: true,
  showAccessibilityLink: true,
  showDocumentInstructionsScreen: false,
  prerequisitesScreenItems: [],
  documentInstructionsScreenItems: [],
  translations: {},
  signicatvideoidConfig: {
    checkRequirements: false,
    useModal: false,
    minRequirementsMandatory: true,
    allowedIdTypes: [],
    sdkLoadTimeout: 8,
  },
};

const configPresets = {
  starter: {
    label: "Starter preset",
    config: starterConfig,
  },
  finlandOnly: {
    label: "Finland only",
    config: {
      ...starterConfig,
      documentCountries: {
        passport: ["FIN"],
        identityCard: ["FIN"],
        driversLicense: ["FIN"],
      },
      defaultCountry: "FIN",
      defaultDocumentCountry: "FIN",
      smsDefaultCountry: "FIN",
    },
  },
  norwayOnly: {
    label: "Norway only",
    config: {
      ...starterConfig,
      documentCountries: {
        passport: ["NOR"],
        identityCard: ["NOR"],
        driversLicense: ["NOR"],
      },
      defaultCountry: "NOR",
      defaultDocumentCountry: "NOR",
      smsDefaultCountry: "NOR",
    },
  },
  passportOnly: {
    label: "Passport only",
    config: {
      ...starterConfig,
      documentTypes: ["passport"],
      documentCountries: {
        passport: ["FIN", "NOR", "SWE"],
      },
      defaultCountry: "FIN",
      defaultDocumentCountry: "FIN",
      smsDefaultCountry: "FIN",
    },
  },
  visualProof: {
    label: "Visual proof test",
    config: {
      ...starterConfig,
      pageTitle: "VISUAL PROOF TEST",
      primaryColor: "#FF0BAE",
      fontColor: "#FF0BAE",
      buttonsColor: "#FF0BAE",
      buttonsHoverColor: "#D1008C",
      buttonsTextColor: "#FFFFFF",
      spinnerColor: "#FF0BAE",
      defaultCountry: "FIN",
      defaultDocumentCountry: "FIN",
      smsDefaultCountry: "FIN",
      documentCountries: {
        passport: ["FIN"],
        identityCard: ["FIN"],
        driversLicense: ["FIN"],
      },
    },
  },
};

function byId(id) {
  return document.getElementById(id);
}

function createElement(tagName, attributes = {}, children = []) {
  const element = document.createElement(tagName);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }

    if (key === "className") {
      element.className = value;
    } else if (key === "textContent") {
      element.textContent = value;
    } else if (key === "checked") {
      element.checked = Boolean(value);
    } else {
      element.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    element.append(child);
  }

  return element;
}

function setResult(id, value) {
  byId(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setDocumentTypesResult(value) {
  setResult("documentTypesResult", value);
}

function unwrapApiData(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
}

function collectSignicatRequests(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.signicatRequests) && payload.signicatRequests.length) {
    return payload.signicatRequests;
  }

  if (payload.signicatRequest) {
    return [payload.signicatRequest];
  }

  return [];
}

function normalizeSignicatDebug(payload) {
  const requests = collectSignicatRequests(payload);

  if (!requests.length) {
    return "No Signicat request has been made in this section yet.";
  }

  return requests
    .map((request, index) => {
      const body = request.body === null || request.body === undefined ? "No JSON body" : JSON.stringify(request.body, null, 2);
      return [
        requests.length > 1 ? `Request ${index + 1}` : "Request",
        `Method: ${request.method}`,
        `Endpoint: ${request.endpoint}`,
        `URL: ${request.url}`,
        "",
        "JSON body:",
        body,
      ].join("\n");
    })
    .join("\n\n----------------------------------------\n\n");
}

function setSignicatDebug(id, payload) {
  setResult(id, normalizeSignicatDebug(payload));
}

function renderSettings(settings) {
  state.settings = settings;
  byId("apiBaseUrl").textContent = settings.apiBaseUrl;
  byId("tokenState").textContent = settings.hasToken
    ? `${settings.authMode === "token" ? "bearer token" : "client credentials"} configured (${settings.authSource})`
    : `${settings.authMode === "token" ? "bearer token" : "client credentials"} missing`;
  byId("redirectUrl").textContent = settings.defaultRedirectUrl;
  byId("captureRedirectUrl").value = settings.defaultRedirectUrl;

  byId("apiBaseUrlInput").value = settings.apiBaseUrl;
  byId("authModeInput").value = settings.authMode || "client_credentials";
  byId("clientIdInput").value = "";
  byId("clientSecretInput").value = "";
  byId("expectedIdNumberInput").value = settings.expectedIdNumber || "";
}

async function api(path, options = {}) {
  if (state.apiMode === "static") {
    return staticApi(path, options);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function isStaticHostingLikely() {
  return window.location.protocol === "file:" || window.location.hostname.endsWith(".github.io");
}

function getDefaultRedirectUrl() {
  return new URL("callback.html", window.location.href).toString();
}

function loadStaticAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function saveStaticAuth(auth) {
  state.staticAuth = {
    ...auth,
    staticMode: true,
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.staticAuth));
}

function clearStaticAuth() {
  state.staticAuth = {
    apiBaseUrl: "https://api.signicat.com",
    authMode: "client_credentials",
    expectedIdNumber: "",
    staticMode: true,
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.staticAuth));
}

function buildStaticSettings() {
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
    authSource: "browser session",
    tokenConfigured: hasApiToken,
    clientCredentialsConfigured: hasClientCredentials,
    expectedIdNumber: auth.expectedIdNumber || "",
  };
}

function getStaticApiBaseUrl() {
  return buildStaticSettings().apiBaseUrl;
}

function readJsonResponse(response) {
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
    response = await fetch(`${getStaticApiBaseUrl()}/auth/open/connect/token`, {
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
      message: "Connection settings saved for this browser session only.",
      settings: buildStaticSettings(),
    };
  }

  if (method === "DELETE" && path === "/api/settings") {
    clearStaticAuth();
    return {
      message: "Browser-session connection settings cleared.",
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
    if (method === "GET") {
      const result = await signicatFetch(
        `/assure/capture/configurations/${encodeURIComponent(configId)}`
      );
      return { data: result.payload, signicatRequest: result.request };
    }
    if (method === "PUT" || method === "POST") {
      const result = await signicatFetch(
        `/assure/capture/configurations/${encodeURIComponent(configId)}`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body || {}),
        }
      );
      return { data: result.payload, signicatRequest: result.request };
    }
  }

  throw new Error("Unknown API route.");
}

function parseCommaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumericList(value) {
  return parseCommaList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
}

function parseOptionalJson(value, fieldName, fallback) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function parseBooleanSelect(id) {
  return byId(id).value === "true";
}

function extractProcessId(result) {
  return (
    result?.response?.processId ||
    result?.processId ||
    result?.response?.id ||
    result?.id ||
    ""
  );
}

function normalizeDocumentCountriesForForm(documentCountries) {
  if (!documentCountries) {
    return [];
  }
  if (Array.isArray(documentCountries)) {
    return documentCountries;
  }
  if (typeof documentCountries === "object") {
    return Array.from(
      new Set(
        Object.values(documentCountries)
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .filter(Boolean)
      )
    );
  }
  return [];
}

function buildDocumentCountriesPayload(documentTypes, countries) {
  if (!countries.length || !documentTypes.length) {
    return undefined;
  }

  return Object.fromEntries(documentTypes.map((type) => [type, countries]));
}

function normalizeArrayField(value) {
  return Array.isArray(value) ? value : [];
}

function setTextInputValue(id, value) {
  byId(id).value = value || "";
}

function selectedAllowedIdTypes() {
  const checked = Array.from(document.querySelectorAll("[data-doc-checkbox]:checked"));
  const idsFromTable = checked
    .map((node) => Number(node.value))
    .filter((value) => Number.isInteger(value));
  const idsFromInput = parseNumericList(byId("allowedIdTypesInput").value);
  return Array.from(new Set([...idsFromInput, ...idsFromTable])).sort((a, b) => a - b);
}

function documentTypeDisplayLabel(item) {
  return [item.countryName || item.country, item.type, item.subType].filter(Boolean).join(" / ");
}

function documentTypeSearchText(item) {
  return [
    item.id,
    item.country,
    item.countryName,
    item.type,
    item.subType,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortedDocumentTypes() {
  const sortMode = byId("documentTypeSort").value;
  const filterText = byId("documentTypeFilter").value.trim().toLowerCase();

  return [...state.documentTypes]
    .filter((item) => !filterText || documentTypeSearchText(item).includes(filterText))
    .sort((a, b) => {
      if (sortMode === "id") {
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      }

      if (sortMode === "type") {
        return (
          compareText(a.type, b.type) ||
          compareText(a.subType, b.subType) ||
          compareText(a.countryName || a.country, b.countryName || b.country) ||
          ((Number(a.id) || 0) - (Number(b.id) || 0))
        );
      }

      return (
        compareText(a.countryName || a.country, b.countryName || b.country) ||
        compareText(a.type, b.type) ||
        compareText(a.subType, b.subType) ||
        ((Number(a.id) || 0) - (Number(b.id) || 0))
      );
    });
}

function renderDocumentTypes() {
  const container = byId("documentTypeList");
  const summary = byId("documentTypeSummary");
  const coverageGroups = byId("coverageGroups");
  const selectedIds = new Set(selectedAllowedIdTypes());

  if (!state.documentTypes.length) {
    container.replaceChildren();
    summary.textContent = "No document types loaded yet.";
    coverageGroups.replaceChildren();
    byId("coverageSummary").value = "";
    setDocumentTypesResult("No document types loaded yet.");
    return;
  }

  const visibleDocumentTypes = sortedDocumentTypes();
  summary.textContent =
    visibleDocumentTypes.length === state.documentTypes.length
      ? `${state.documentTypes.length} document types returned from Signicat.`
      : `${visibleDocumentTypes.length} of ${state.documentTypes.length} document types shown.`;

  if (!visibleDocumentTypes.length) {
    container.replaceChildren(
      createElement("p", {
        className: "muted empty-state",
        textContent: "No document types match this filter.",
      })
    );
  } else {
    container.replaceChildren(
      ...visibleDocumentTypes.map((item) =>
        createElement("label", { className: "doc-item" }, [
          createElement("input", {
            type: "checkbox",
            "data-doc-checkbox": "",
            value: item.id,
            checked: selectedIds.has(Number(item.id)),
          }),
          createElement("span", { textContent: documentTypeDisplayLabel(item) }),
          createElement("code", { textContent: `#${item.id}` }),
        ])
      )
    );
  }

  renderCoverageGroups();
}

function normalizeDocTypeLabel(item) {
  const rawType = String(item.type || "").toLowerCase();
  if (rawType.includes("driver")) {
    return "driversLicense";
  }
  if (rawType.includes("passport")) {
    return "passport";
  }
  return "identityCard";
}

function buildAllowedIdTypesForConfig(config) {
  if (!state.documentTypes.length) {
    return [];
  }

  const allowedGenericTypes = new Set(config.documentTypes || []);
  const documentCountries = config.documentCountries || {};

  return state.documentTypes
    .filter((item) => {
      const genericType = normalizeDocTypeLabel(item);
      if (!allowedGenericTypes.has(genericType)) {
        return false;
      }

      const allowedCountries = documentCountries[genericType];
      if (!allowedCountries || allowedCountries === "univ") {
        return true;
      }

      return Array.isArray(allowedCountries) && allowedCountries.includes(item.country);
    })
    .map((item) => item.id)
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => a - b);
}

function buildCoverageGroups() {
  const byCountry = new Map();

  for (const item of state.documentTypes) {
    const countryCode = item.country || "UNK";
    const countryName = item.countryName || countryCode;
    const typeLabel = normalizeDocTypeLabel(item);

    if (!byCountry.has(countryCode)) {
      byCountry.set(countryCode, {
        countryCode,
        countryName,
        passport: [],
        identityCard: [],
        driversLicense: [],
      });
    }

    byCountry.get(countryCode)[typeLabel].push(item);
  }

  return Array.from(byCountry.values()).sort((a, b) =>
    a.countryName.localeCompare(b.countryName)
  );
}

function renderCoverageGroups() {
  const groups = buildCoverageGroups();
  const container = byId("coverageGroups");

  container.replaceChildren(
    ...groups.map((group) => {
      const typeParts = [
        group.passport.length ? `Passports: ${group.passport.length}` : null,
        group.identityCard.length ? `Identity cards: ${group.identityCard.length}` : null,
        group.driversLicense.length ? `Driver licenses: ${group.driversLicense.length}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      return createElement("div", { className: "coverage-group" }, [
        createElement("strong", { textContent: `${group.countryName} (${group.countryCode})` }),
        createElement("span", { textContent: typeParts }),
      ]);
    })
  );

  byId("coverageSummary").value = buildCoverageSummary(groups);
}

function buildCoverageSummary(groups = buildCoverageGroups()) {
  const total = state.documentTypes.length;
  const supportedCountries = groups.length;
  const passportCountries = groups.filter((group) => group.passport.length).length;
  const identityCardCountries = groups.filter((group) => group.identityCard.length).length;
  const driverLicenseCountries = groups.filter((group) => group.driversLicense.length).length;

  const coverageLines = groups.map((group) => {
    const types = [
      group.passport.length ? `passport (${group.passport.length})` : null,
      group.identityCard.length ? `identityCard (${group.identityCard.length})` : null,
      group.driversLicense.length ? `driversLicense (${group.driversLicense.length})` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return `- ${group.countryName} (${group.countryCode}): ${types}`;
  });

  return [
    "Current Signicat VideoID coverage in my sandbox",
    "",
    `Total enabled document types: ${total}`,
    `Countries represented: ${supportedCountries}`,
    `Countries with passport support: ${passportCountries}`,
    `Countries with identity card support: ${identityCardCountries}`,
    `Countries with driver license support: ${driverLicenseCountries}`,
    "",
    "Currently enabled documents by country:",
    ...coverageLines,
    "",
    "Please help enable additional VideoID-supported documents for my sandbox where available.",
  ].join("\n");
}

function syncAllowedIdTypeInputFromSelection() {
  byId("allowedIdTypesInput").value = selectedAllowedIdTypes().join(",");
}

function populateConfigForm(config) {
  byId("configJson").value = JSON.stringify(config, null, 2);
  byId("pageTitleInput").value = config.pageTitle || "";
  setTextInputValue("faviconInput", config.favicon);
  setTextInputValue("fontNameInput", config.fontName);
  setTextInputValue("fontUrlInput", config.fontUrl);
  setTextInputValue("primaryColorInput", config.primaryColor);
  setTextInputValue("fontColorInput", config.fontColor);
  setTextInputValue("buttonsColorInput", config.buttonsColor);
  setTextInputValue("buttonsHoverColorInput", config.buttonsHoverColor);
  setTextInputValue("buttonsTextColorInput", config.buttonsTextColor);
  setTextInputValue("spinnerColorInput", config.spinnerColor);
  setTextInputValue("defaultCountryInput", config.defaultCountry);
  byId("allowFileUploadInput").value = normalizeArrayField(config.allowFileUpload).join(",");
  byId("allowTakePhotoInput").value = normalizeArrayField(config.allowTakePhoto).join(",");
  byId("allowZoomOnPreviewInput").value = normalizeArrayField(config.allowZoomOnPreview).join(",");
  byId("useSignicatThemingInput").value = String(Boolean(config.useSignicatTheming));
  byId("enableMobileHandoverInput").value = String(
    config.enableMobileHandover === undefined ? true : Boolean(config.enableMobileHandover)
  );
  byId("enableOrientationConfirmationInput").value = String(Boolean(config.enableOrientationConfirmation));
  byId("autoCaptureInput").value = String(Boolean(config.autoCapture));
  byId("detectGlareInput").value = Array.isArray(config.detectGlare)
    ? config.detectGlare.join(",")
    : "";
  byId("customRedactionErrorInput").value = String(Boolean(config.customRedactionError));
  byId("takeSelfieInput").value = String(Boolean(config.takeSelfie));
  setTextInputValue("smsDefaultCountryInput", config.smsDefaultCountry);
  byId("maxRetriesInput").value =
    Number.isInteger(config.maxRetries) && config.maxRetries >= 0 ? String(config.maxRetries) : "";
  byId("showModalBeforeRedirectInput").value = String(
    config.showModalBeforeRedirect === undefined ? true : Boolean(config.showModalBeforeRedirect)
  );
  byId("mobileHandoverTimeoutInput").value =
    Number.isInteger(config.mobileHandoverTimeout) && config.mobileHandoverTimeout >= 0
      ? String(config.mobileHandoverTimeout)
      : "";
  byId("mobileHandoverModesInput").value = normalizeArrayField(config.mobileHandoverModes).join(",");
  byId("forceMobileHandoverInput").value = String(Boolean(config.forceMobileHandover));
  byId("useNativeCameraInput").value = String(Boolean(config.useNativeCamera));
  byId("customCssInput").value = config.customCss || "";
  byId("documentTypesInput").value = (config.documentTypes || []).join(",");
  byId("documentCountriesInput").value = normalizeDocumentCountriesForForm(config.documentCountries).join(",");
  byId("defaultDocumentCountryInput").value = config.defaultDocumentCountry || "";
  byId("languagesInput").value = (config.languages || []).join(",");
  byId("defaultLanguageInput").value = config.defaultLanguage || "";
  byId("showPrerequisitesScreenInput").value = String(Boolean(config.showPrerequisitesScreen));
  byId("showConsentPageInput").value = String(Boolean(config.showConsentPage));
  byId("showCountryBeforeDocumentTypeInput").value = String(Boolean(config.showCountryBeforeDocumentType));
  byId("showAccessibilityLinkInput").value = String(
    config.showAccessibilityLink === undefined ? true : Boolean(config.showAccessibilityLink)
  );
  byId("showDocumentInstructionsScreenInput").value = String(Boolean(config.showDocumentInstructionsScreen));
  byId("prerequisitesScreenItemsInput").value = JSON.stringify(
    config.prerequisitesScreenItems || [],
    null,
    2
  );
  byId("documentInstructionsScreenItemsInput").value = JSON.stringify(
    config.documentInstructionsScreenItems || [],
    null,
    2
  );
  byId("translationsInput").value = JSON.stringify(config.translations || {}, null, 2);
  const allowed =
    config.signicatvideoidConfig && Array.isArray(config.signicatvideoidConfig.allowedIdTypes)
      ? config.signicatvideoidConfig.allowedIdTypes
      : [];
  byId("allowedIdTypesInput").value = allowed.join(",");
  byId("sdkLoadTimeoutInput").value =
    config.signicatvideoidConfig && Number.isInteger(config.signicatvideoidConfig.sdkLoadTimeout)
      ? String(config.signicatvideoidConfig.sdkLoadTimeout)
      : "";

  const allowedSet = new Set(allowed);
  document.querySelectorAll("[data-doc-checkbox]").forEach((node) => {
    node.checked = allowedSet.has(Number(node.value));
  });
}

function buildConfigPayload() {
  let config;
  try {
    config = JSON.parse(byId("configJson").value || "{}");
  } catch (error) {
    throw new Error("Raw capture configuration JSON is invalid.");
  }

  config.pageTitle = byId("pageTitleInput").value.trim();
  config.favicon = byId("faviconInput").value.trim();
  config.fontName = byId("fontNameInput").value.trim();
  config.fontUrl = byId("fontUrlInput").value.trim();
  config.primaryColor = byId("primaryColorInput").value.trim();
  config.fontColor = byId("fontColorInput").value.trim();
  config.buttonsColor = byId("buttonsColorInput").value.trim();
  config.buttonsHoverColor = byId("buttonsHoverColorInput").value.trim();
  config.buttonsTextColor = byId("buttonsTextColorInput").value.trim();
  config.spinnerColor = byId("spinnerColorInput").value.trim();
  config.defaultCountry = byId("defaultCountryInput").value.trim();
  config.allowFileUpload = parseCommaList(byId("allowFileUploadInput").value);
  config.allowTakePhoto = parseCommaList(byId("allowTakePhotoInput").value);
  config.allowZoomOnPreview = parseCommaList(byId("allowZoomOnPreviewInput").value);
  config.useSignicatTheming = parseBooleanSelect("useSignicatThemingInput");
  config.enableMobileHandover = parseBooleanSelect("enableMobileHandoverInput");
  config.enableOrientationConfirmation = parseBooleanSelect("enableOrientationConfirmationInput");
  config.autoCapture = parseBooleanSelect("autoCaptureInput");
  config.detectGlare = parseCommaList(byId("detectGlareInput").value);
  config.customRedactionError = parseBooleanSelect("customRedactionErrorInput");
  config.takeSelfie = parseBooleanSelect("takeSelfieInput");
  config.smsDefaultCountry = byId("smsDefaultCountryInput").value.trim();
  config.showModalBeforeRedirect = parseBooleanSelect("showModalBeforeRedirectInput");
  config.mobileHandoverModes = parseCommaList(byId("mobileHandoverModesInput").value);
  config.forceMobileHandover = parseBooleanSelect("forceMobileHandoverInput");
  config.useNativeCamera = parseBooleanSelect("useNativeCameraInput");
  config.customCss = byId("customCssInput").value;
  config.documentTypes = parseCommaList(byId("documentTypesInput").value);
  config.documentCountries = buildDocumentCountriesPayload(
    config.documentTypes,
    parseCommaList(byId("documentCountriesInput").value)
  );
  config.defaultDocumentCountry = byId("defaultDocumentCountryInput").value.trim();
  config.languages = parseCommaList(byId("languagesInput").value);
  config.defaultLanguage = byId("defaultLanguageInput").value.trim();
  config.showPrerequisitesScreen = parseBooleanSelect("showPrerequisitesScreenInput");
  config.showConsentPage = parseBooleanSelect("showConsentPageInput");
  config.showCountryBeforeDocumentType = parseBooleanSelect("showCountryBeforeDocumentTypeInput");
  config.showAccessibilityLink = parseBooleanSelect("showAccessibilityLinkInput");
  config.showDocumentInstructionsScreen = parseBooleanSelect("showDocumentInstructionsScreenInput");
  config.prerequisitesScreenItems = parseOptionalJson(
    byId("prerequisitesScreenItemsInput").value,
    "Prerequisites screen items",
    []
  );
  config.documentInstructionsScreenItems = parseOptionalJson(
    byId("documentInstructionsScreenItemsInput").value,
    "Document instructions screen items",
    []
  );
  config.translations = parseOptionalJson(byId("translationsInput").value, "Translations", {});
  config.signicatvideoidConfig = {
    ...(config.signicatvideoidConfig || {}),
  };

  const allowedIdTypes = selectedAllowedIdTypes();
  if (allowedIdTypes.length) {
    config.signicatvideoidConfig.allowedIdTypes = allowedIdTypes;
  } else {
    delete config.signicatvideoidConfig.allowedIdTypes;
  }

  const sdkLoadTimeout = Number(byId("sdkLoadTimeoutInput").value);
  if (Number.isInteger(sdkLoadTimeout) && sdkLoadTimeout > 0) {
    config.signicatvideoidConfig.sdkLoadTimeout = sdkLoadTimeout;
  } else {
    delete config.signicatvideoidConfig.sdkLoadTimeout;
  }

  const maxRetries = Number(byId("maxRetriesInput").value);
  if (Number.isInteger(maxRetries) && maxRetries >= 0) {
    config.maxRetries = maxRetries;
  } else {
    delete config.maxRetries;
  }

  const mobileHandoverTimeout = Number(byId("mobileHandoverTimeoutInput").value);
  if (Number.isInteger(mobileHandoverTimeout) && mobileHandoverTimeout >= 0) {
    config.mobileHandoverTimeout = mobileHandoverTimeout;
  } else {
    delete config.mobileHandoverTimeout;
  }

  if (!config.defaultDocumentCountry) {
    delete config.defaultDocumentCountry;
  }
  if (!config.defaultLanguage) {
    delete config.defaultLanguage;
  }
  if (!config.pageTitle) {
    delete config.pageTitle;
  }
  if (!config.favicon) {
    delete config.favicon;
  }
  if (!config.fontName) {
    delete config.fontName;
  }
  if (!config.fontUrl) {
    delete config.fontUrl;
  }
  if (!config.primaryColor) {
    delete config.primaryColor;
  }
  if (!config.fontColor) {
    delete config.fontColor;
  }
  if (!config.buttonsColor) {
    delete config.buttonsColor;
  }
  if (!config.buttonsHoverColor) {
    delete config.buttonsHoverColor;
  }
  if (!config.buttonsTextColor) {
    delete config.buttonsTextColor;
  }
  if (!config.spinnerColor) {
    delete config.spinnerColor;
  }
  if (!config.defaultCountry) {
    delete config.defaultCountry;
  }
  if (!config.smsDefaultCountry) {
    delete config.smsDefaultCountry;
  }
  if (!config.allowFileUpload.length) {
    delete config.allowFileUpload;
  }
  if (!config.allowTakePhoto.length) {
    delete config.allowTakePhoto;
  }
  if (!config.allowZoomOnPreview.length) {
    delete config.allowZoomOnPreview;
  }
  if (!config.detectGlare.length) {
    delete config.detectGlare;
  }
  if (!config.mobileHandoverModes.length) {
    delete config.mobileHandoverModes;
  }
  if (!config.customCss.trim()) {
    delete config.customCss;
  }
  if (!config.documentCountries) {
    delete config.documentCountries;
  }
  if (
    config.signicatvideoidConfig &&
    Object.keys(config.signicatvideoidConfig).length === 0
  ) {
    delete config.signicatvideoidConfig;
  }

  return config;
}

function previewConfigPayload() {
  const payload = buildConfigPayload();
  byId("configJson").value = JSON.stringify(payload, null, 2);
  return payload;
}

function applyConfigPreset(presetKey) {
  const preset = configPresets[presetKey];
  if (!preset) {
    return;
  }

  const config = JSON.parse(JSON.stringify(preset.config));
  const allowedIdTypes = buildAllowedIdTypesForConfig(config);
  config.signicatvideoidConfig = {
    ...(config.signicatvideoidConfig || {}),
    allowedIdTypes,
  };

  populateConfigForm(config);
  previewConfigPayload();
  setResult("configResult", {
    message: `${preset.label} applied.`,
    matchedAllowedIdTypes: allowedIdTypes.length,
    note: state.documentTypes.length
      ? "Allowed ID types were derived from the loaded Signicat document types."
      : "Load document types first if you want the preset to auto-fill allowed ID types.",
  });
}

async function loadSettings() {
  if (isStaticHostingLikely()) {
    state.apiMode = "static";
  }

  try {
    const settings = await api("/api/settings");
    renderSettings(settings);
  } catch (error) {
    state.apiMode = "static";
    state.staticAuth = loadStaticAuth();
    renderSettings(buildStaticSettings());
    setResult("authResult", {
      message: "Running in static browser mode. Add credentials to start calling Signicat directly.",
      note: error.message,
    });
  }
}

async function main() {
  await loadSettings();
  populateConfigForm(starterConfig);
  setDocumentTypesResult("Load document types to inspect the raw API response here.");
  setResult(
    "authResult",
    state.apiMode === "static"
      ? "Static browser mode is active. Connection settings are stored only in this browser session."
      : "Connection settings are using the current server defaults."
  );
  setSignicatDebug("documentTypesDebug", null);
  setSignicatDebug("configDebug", null);
  setSignicatDebug("captureDebug", null);

  byId("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/settings", {
        method: "POST",
        body: {
          apiBaseUrl: byId("apiBaseUrlInput").value.trim(),
          authMode: byId("authModeInput").value,
          clientId: byId("clientIdInput").value.trim(),
          clientSecret: byId("clientSecretInput").value.trim(),
          apiToken: byId("authModeInput").value === "token" ? byId("clientSecretInput").value.trim() : "",
          expectedIdNumber: byId("expectedIdNumberInput").value.trim(),
        },
      });
      renderSettings(result.settings);
      setResult("authResult", {
        message: result.message,
        authSource: result.settings.authSource,
      });
    } catch (error) {
      setResult("authResult", { error: error.message });
    }
  });

  byId("resetAuthButton").addEventListener("click", async () => {
    try {
      const result = await api("/api/settings", { method: "DELETE" });
      renderSettings(result.settings);
      setResult("authResult", { message: result.message });
    } catch (error) {
      setResult("authResult", { error: error.message });
    }
  });

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const text = byId(targetId).textContent || "";

      try {
        await navigator.clipboard.writeText(text);
        setResult("authResult", { message: `Copied ${targetId} to clipboard.` });
      } catch (_error) {
        setResult("authResult", {
          message: `Clipboard copy was not available. You can still select and copy ${targetId} manually.`,
        });
      }
    });
  });

  byId("documentTypesForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/document-types", {
        method: "POST",
        body: { provider: byId("providerSelect").value },
      });
      const payload = unwrapApiData(result);
      state.documentTypes = payload;
      renderDocumentTypes();
      syncAllowedIdTypeInputFromSelection();
      setSignicatDebug("documentTypesDebug", result);
      setDocumentTypesResult(payload);
    } catch (error) {
      setSignicatDebug("documentTypesDebug", null);
      setDocumentTypesResult({ error: error.message });
    }
  });

  byId("documentTypeList").addEventListener("change", () => {
    syncAllowedIdTypeInputFromSelection();
  });

  byId("documentTypeSort").addEventListener("change", () => {
    renderDocumentTypes();
  });

  byId("documentTypeFilter").addEventListener("input", () => {
    renderDocumentTypes();
  });

  byId("exportCoverageButton").addEventListener("click", async () => {
    const summary = byId("coverageSummary").value;
    if (!summary) {
      setDocumentTypesResult({
        error: "Load document types first to generate a coverage summary.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(summary);
      setDocumentTypesResult({ message: "Coverage summary copied to clipboard." });
    } catch (_error) {
      setDocumentTypesResult({
        message: "Coverage summary generated below. Clipboard copy was not available in this browser context.",
      });
    }
  });

  byId("loadTemplateButton").addEventListener("click", () => {
    populateConfigForm(starterConfig);
    setResult("configResult", { message: "Starter template loaded." });
  });

  byId("presetStarterButton").addEventListener("click", () => {
    applyConfigPreset("starter");
  });

  byId("presetFinlandButton").addEventListener("click", () => {
    applyConfigPreset("finlandOnly");
  });

  byId("presetNorwayButton").addEventListener("click", () => {
    applyConfigPreset("norwayOnly");
  });

  byId("presetPassportButton").addEventListener("click", () => {
    applyConfigPreset("passportOnly");
  });

  byId("presetVisualProofButton").addEventListener("click", () => {
    applyConfigPreset("visualProof");
  });

  byId("previewConfigButton").addEventListener("click", () => {
    try {
      previewConfigPayload();
    } catch (error) {
      setResult("configResult", { error: error.message });
    }
  });

  byId("configForm").addEventListener("change", (event) => {
    if (event.target.id === "configJson") {
      return;
    }

    try {
      previewConfigPayload();
    } catch (_error) {
      // Keep the last valid preview visible while the user edits JSON helper fields.
    }
  });

  byId("loadConfigButton").addEventListener("click", async () => {
    try {
      const result = await api(`/api/capture-configurations/${encodeURIComponent(byId("configId").value)}`);
      const config = unwrapApiData(result);
      populateConfigForm(config);
      setSignicatDebug("configDebug", result);
      setResult("configResult", config);
    } catch (error) {
      setSignicatDebug("configDebug", null);
      setResult("configResult", {
        error: error.message,
        hint: "If this configuration does not exist yet, load the starter template and save it with POST.",
      });
    }
  });

  byId("listConfigsButton").addEventListener("click", async () => {
    try {
      const result = await api("/api/capture-configurations");
      const configs = unwrapApiData(result);
      setSignicatDebug("configDebug", result);
      setResult("configResult", configs);
    } catch (error) {
      setSignicatDebug("configDebug", null);
      setResult("configResult", { error: error.message });
    }
  });

  byId("configForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const configId = byId("configId").value.trim();
      const payload = previewConfigPayload();

      let method = "PUT";
      try {
        await api(`/api/capture-configurations/${encodeURIComponent(configId)}`);
      } catch (_error) {
        method = "POST";
      }

      const result = await api(`/api/capture-configurations/${encodeURIComponent(configId)}`, {
        method,
        body: payload,
      });
      setSignicatDebug("configDebug", result);
      setResult("configResult", { method, result: unwrapApiData(result) });
    } catch (error) {
      setSignicatDebug("configDebug", null);
      setResult("configResult", { error: error.message });
    }
  });

  byId("createDossierButton").addEventListener("click", async () => {
    try {
      const result = await api("/api/dossiers", { method: "POST", body: {} });
      const dossier = unwrapApiData(result);
      byId("dossierId").value = dossier.dossierId || dossier.id || "";
      byId("captureProcessId").value = "";
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", dossier);
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });

  byId("listDossiersButton").addEventListener("click", async () => {
    try {
      const result = await api("/api/dossiers");
      const dossiers = unwrapApiData(result);
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", dossiers);
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });

  byId("deleteAllDossiersButton").addEventListener("click", async () => {
    if (
      !window.confirm(
        "Delete all listed dossiers? This removes user data, files, and processes for your recent dossier list and cannot be undone."
      )
    ) {
      return;
    }

    try {
      const result = await api("/api/dossiers", { method: "DELETE" });
      byId("dossierId").value = "";
      byId("captureProcessId").value = "";
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", result);
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });

  byId("captureForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = {
        dossierId: byId("dossierId").value.trim(),
        provider: byId("captureProvider").value,
        processType: byId("processType").value.trim(),
        sdk: byId("sdk").value,
        uiProfile: byId("uiProfile").value.trim(),
        redirectUrl: byId("captureRedirectUrl").value.trim(),
      };

      const result = await api("/api/capture/start", {
        method: "POST",
        body: payload,
      });

      byId("captureProcessId").value = extractProcessId(result);
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", result);

      if (result.response && result.response.url) {
        window.open(result.response.url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });

  byId("deleteProcessButton").addEventListener("click", async () => {
    const dossierId = byId("dossierId").value.trim();
    const processId = byId("captureProcessId").value.trim();

    if (!dossierId || !processId) {
      setResult("captureResult", {
        error: "Both dossierId and processId are required to delete a process.",
      });
      return;
    }

    if (!window.confirm(`Delete process ${processId} from dossier ${dossierId}? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await api(
        `/api/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`,
        { method: "DELETE" }
      );
      byId("captureProcessId").value = "";
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", result);
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });

  byId("deleteDossierButton").addEventListener("click", async () => {
    const dossierId = byId("dossierId").value.trim();

    if (!dossierId) {
      setResult("captureResult", { error: "dossierId is required to delete a dossier." });
      return;
    }

    if (
      !window.confirm(
        `Delete dossier ${dossierId}? This removes user data, files, and processes and cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const result = await api(`/api/dossiers/${encodeURIComponent(dossierId)}`, {
        method: "DELETE",
      });
      byId("dossierId").value = "";
      byId("captureProcessId").value = "";
      setSignicatDebug("captureDebug", result);
      setResult("captureResult", result);
    } catch (error) {
      setSignicatDebug("captureDebug", null);
      setResult("captureResult", { error: error.message });
    }
  });
}

main().catch((error) => {
  setResult("configResult", { error: error.message });
});
