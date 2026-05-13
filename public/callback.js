const FINAL_STATUSES = new Set(["accepted", "rejected", "inconclusive", "canceled", "failed"]);
const STORAGE_KEY = "videoidSandboxSession";
const SESSION_COOKIE_KEY = "videoidSandboxSessionCookie";
const RATE_STORAGE_KEY = "videoidSandboxRateWindow";
const STATIC_RATE_WINDOW_MS = 60_000;
const STATIC_RATE_WINDOW_LIMIT = 30;
const CALLBACK_POLL_INTERVAL_MS = 5_000;
const CALLBACK_MAX_POLL_MS = 120_000;
const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
const callbackData = document.getElementById("callbackData");
const processData = document.getElementById("processData");
const matchData = document.getElementById("matchData");
const pollStatus = document.getElementById("pollStatus");

callbackData.textContent = JSON.stringify(params, null, 2);
processData.textContent = "Waiting for process lookup...";
matchData.textContent = "Waiting for a final process result...";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStaticHostingLikely() {
  return window.location.protocol === "file:" || window.location.hostname.endsWith(".github.io");
}

function shouldUseStaticMode(settings) {
  return Boolean(settings.staticMode) || isStaticHostingLikely();
}

function hasStaticCredentials(settings) {
  if (settings.authMode === "token") {
    return Boolean(settings.apiToken);
  }
  return Boolean(settings.clientId && settings.clientSecret);
}

async function readJsonResponse(response, context) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const preview = text.trim().slice(0, 160);
  throw new Error(
    `${context} returned ${contentType || "an unknown content type"} instead of JSON${
      preview ? `: ${preview}` : "."
    }`
  );
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

function trackStaticRequestLimit() {
  const windowState = loadRateWindow();
  if (windowState.count >= STATIC_RATE_WINDOW_LIMIT) {
    const retryAfterMs = Math.max(0, STATIC_RATE_WINDOW_MS - (Date.now() - windowState.startedAt));
    throw new Error(
      `Static mode request limit reached. Wait ${Math.ceil(retryAfterMs / 1000)} seconds before calling Signicat again.`
    );
  }
  windowState.count += 1;
  saveRateWindow(windowState);
}

async function fetchJson(path) {
  const staticResult = await fetchStaticJson(path);
  if (staticResult) {
    return staticResult;
  }

  const response = await fetch(path, {
    headers: {
      Accept: "application/json",
    },
  });
  const payload = await readJsonResponse(response, path);
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function loadSessionSettings() {
  const cookieSettings = readSessionCookieSettings();
  if (cookieSettings) {
    return cookieSettings;
  }

  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function readSessionCookieSettings() {
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

function getApiBaseUrl(settings) {
  return String(settings.apiBaseUrl || "https://api.signicat.com").replace(/\/$/, "");
}

async function getStaticAccessToken(settings) {
  if (settings.authMode === "token") {
    if (!settings.apiToken) {
      throw new Error(
        "This callback page is using static browser mode, but no API token was found in this browser. Save Connection settings on the hosted page before starting the flow, then return to this callback URL."
      );
    }
    return settings.apiToken;
  }

  if (settings.accessToken && settings.accessTokenExpiresAt > Date.now() + 30000) {
    return settings.accessToken;
  }

  if (!settings.clientId || !settings.clientSecret) {
    throw new Error(
      "This callback page is using static browser mode, but no client ID/client secret was found in this browser. Save Connection settings on the hosted page before starting the flow, then return to this callback URL."
    );
  }

  trackStaticRequestLimit();
  const response = await fetch(`${getApiBaseUrl(settings)}/auth/open/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "signicat-api",
    }).toString(),
  });
  const payload = await readJsonResponse(response, "Signicat token request");
  if (!response.ok) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Signicat token request failed with ${response.status}.`
    );
  }

  settings.accessToken = payload.access_token;
  settings.accessTokenExpiresAt = Date.now() + Number(payload.expires_in || 600) * 1000;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings.accessToken;
}

async function fetchStaticJson(path) {
  const settings = loadSessionSettings();
  if (!shouldUseStaticMode(settings)) {
    return null;
  }

  if (path === "/api/settings") {
    return {
      expectedIdNumber: settings.expectedIdNumber || "",
    };
  }

  const processMatch = path.match(/^\/api\/dossiers\/([^/]+)\/processes\/([^/]+)$/);
  if (!processMatch) {
    return null;
  }

  if (!hasStaticCredentials(settings)) {
    throw new Error(
      "This callback cannot fetch the live process result because this browser does not have Signicat credentials for the hosted page. Save Connection settings on the hosted page, then start the flow again."
    );
  }

  const accessToken = await getStaticAccessToken(settings);
  const dossierId = decodeURIComponent(processMatch[1]);
  const processId = decodeURIComponent(processMatch[2]);
  trackStaticRequestLimit();
  const response = await fetch(
    `${getApiBaseUrl(settings)}/assure/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const payload = await readJsonResponse(response, "Signicat process lookup");
  if (!response.ok) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Signicat request failed with ${response.status}.`
    );
  }
  return { data: payload };
}

function unwrapApiData(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
}

function hasMatchCandidateValue(value) {
  return value !== undefined && value !== null && String(value) !== "";
}

function buildMatchOutcome(processResult, expectedIdNumber) {
  const finalResult = processResult && processResult.finalResult;

  if (!expectedIdNumber) {
    return {
      outcome: "skipped",
      matchedField: null,
      message: "No ID Number is configured in Connection settings.",
    };
  }

  if (!finalResult || typeof finalResult !== "object") {
    return {
      outcome: "failed",
      matchedField: null,
      expectedIdNumber,
      message: "No finalResult object was returned for this process.",
    };
  }

  const candidates = [
    {
      field: "personalIdentificationNumber",
      value: finalResult.personalIdentificationNumber,
    },
    {
      field: "documentNumber",
      value: finalResult.documentNumber,
    },
  ].filter((candidate) => hasMatchCandidateValue(candidate.value));

  const matched = candidates.find((candidate) => String(candidate.value) === expectedIdNumber);

  return {
    outcome: matched ? "matched" : "failed",
    matchedField: matched ? matched.field : null,
    expectedIdNumber,
    checkedFields: candidates.map((candidate) => ({
      field: candidate.field,
      value: String(candidate.value),
    })),
    message: matched
      ? `Matched on finalResult.${matched.field}.`
      : "No configured ID Number match was found in finalResult.",
  };
}

async function pollProcessResult() {
  const { dossierId, processId } = params;
  if (!dossierId || !processId) {
    pollStatus.textContent = "No dossierId/processId was returned in the callback URL.";
    processData.textContent = JSON.stringify(
      { error: "Cannot fetch the process result without both dossierId and processId." },
      null,
      2
    );
    matchData.textContent = JSON.stringify(
      {
        outcome: "skipped",
        matchedField: null,
        message: "Cannot match without both dossierId and processId.",
      },
      null,
      2
    );
    return;
  }

  const startedAt = Date.now();
  let expectedIdNumber = "";

  try {
    expectedIdNumber = String((await fetchJson("/api/settings")).expectedIdNumber || "").trim();
  } catch (_error) {
    matchData.textContent = JSON.stringify(
      {
        outcome: "skipped",
        matchedField: null,
        message: "Connection settings could not be loaded for matching.",
      },
      null,
      2
    );
  }

  while (true) {
    try {
      if (document.hidden) {
        pollStatus.textContent = "Polling is paused while this tab is in the background.";
        await sleep(CALLBACK_POLL_INTERVAL_MS);
        continue;
      }

      pollStatus.textContent = "Checking Signicat for the latest process status...";
      const result = await fetchJson(
        `/api/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`
      );
      const processResult = unwrapApiData(result);
      processData.textContent = JSON.stringify(result, null, 2);

      if (FINAL_STATUSES.has(processResult.status)) {
        pollStatus.textContent = `Final status received: ${processResult.status}.`;
        matchData.textContent = JSON.stringify(
          buildMatchOutcome(processResult, expectedIdNumber),
          null,
          2
        );
        return;
      }

      if (Date.now() - startedAt > CALLBACK_MAX_POLL_MS) {
        pollStatus.textContent =
          "Still waiting after 2 minutes. Reload this page to keep checking for the final result.";
        return;
      }

      pollStatus.textContent = `Current process status: ${processResult.status || "unknown"}. Checking again in 5 seconds...`;
    } catch (error) {
      processData.textContent = JSON.stringify({ error: error.message }, null, 2);
      pollStatus.textContent = "Process lookup failed. Reload this page to try again.";
      matchData.textContent = JSON.stringify(
        {
          outcome: "skipped",
          matchedField: null,
          message: "Process lookup failed before matching could run.",
        },
        null,
        2
      );
      return;
    }

    await sleep(CALLBACK_POLL_INTERVAL_MS);
  }
}

pollProcessResult();
