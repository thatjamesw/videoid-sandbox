const FINAL_STATUSES = new Set(["accepted", "rejected", "inconclusive", "canceled", "failed"]);
const STORAGE_KEY = "videoidSandboxSession";
const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
const callbackData = document.getElementById("callbackData");
const processData = document.getElementById("processData");
const matchData = document.getElementById("matchData");
const pollStatus = document.getElementById("pollStatus");

callbackData.textContent = JSON.stringify(params, null, 2);
processData.textContent = "Waiting for process lookup...";
matchData.textContent = "Waiting for a final process result...";

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
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function loadSessionSettings() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function getApiBaseUrl(settings) {
  return String(settings.apiBaseUrl || "https://api.signicat.com").replace(/\/$/, "");
}

async function getStaticAccessToken(settings) {
  if (settings.authMode === "token") {
    if (!settings.apiToken) {
      throw new Error("No browser-session API token is configured.");
    }
    return settings.apiToken;
  }

  if (settings.accessToken && settings.accessTokenExpiresAt > Date.now() + 30000) {
    return settings.accessToken;
  }

  if (!settings.clientId || !settings.clientSecret) {
    throw new Error("No browser-session client credentials are configured.");
  }

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
  const payload = await response.json();
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
  if (!settings.staticMode) {
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

  const accessToken = await getStaticAccessToken(settings);
  const dossierId = decodeURIComponent(processMatch[1]);
  const processId = decodeURIComponent(processMatch[2]);
  const response = await fetch(
    `${getApiBaseUrl(settings)}/assure/dossiers/${encodeURIComponent(dossierId)}/processes/${encodeURIComponent(processId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const payload = await response.json();
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

      if (Date.now() - startedAt > 120000) {
        pollStatus.textContent =
          "Still waiting after 2 minutes. Reload this page to keep checking for the final result.";
        return;
      }

      pollStatus.textContent = `Current process status: ${processResult.status || "unknown"}. Checking again in 3 seconds...`;
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

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

pollProcessResult();
