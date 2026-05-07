export function byId(id) {
  return document.getElementById(id);
}

export function createElement(tagName, attributes = {}, children = []) {
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

export function setResult(id, value) {
  byId(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function unwrapApiData(payload) {
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
      const body =
        request.body === null || request.body === undefined
          ? "No JSON body"
          : JSON.stringify(request.body, null, 2);
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

export function setSignicatDebug(id, payload) {
  setResult(id, normalizeSignicatDebug(payload));
}
