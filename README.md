# VideoID Sandbox Lab

A small browser tool for trying Signicat VideoID and Capture flows with your own sandbox
credentials.

Use it to load supported document types, build a Capture configuration, create a dossier, launch a
VideoID flow, and inspect the exact Signicat API requests made along the way. It is meant for
testing and integration discovery, not production traffic.

This is an independent community tool provided as-is for testing and educational purposes. It is not
an official Signicat repository, and it is not endorsed, sponsored, or maintained by Signicat. Use
Signicat's public developer documentation as the source of truth for API behavior.

## Open The App

Hosted version:

- [https://thatjamesw.github.io/videoid-sandbox/](https://thatjamesw.github.io/videoid-sandbox/)

You can use the hosted version directly if your Signicat tenant allows browser requests from that
origin. If the browser blocks requests with CORS errors, run the app locally instead; the local
server includes a small same-origin proxy.

## What You Need

- A Signicat sandbox tenant
- Either a client ID and client secret, or a bearer API token
- Permission to create Capture configurations, dossiers, and capture processes
- Hosted redirect URL: `https://thatjamesw.github.io/videoid-sandbox/callback.html`
- Local redirect URL: `http://127.0.0.1:3000/callback`

## What It Does

- Loads supported documents for `signicatvideoid`, `signicatpictureid`, or `onfido`
- Maps Signicat's numeric document IDs into `signicatvideoidConfig.allowedIdTypes`
- Creates or updates a Capture configuration
- Creates, lists, and deletes dossiers
- Starts a Capture flow with a selected provider and optional `uiProfile`
- Shows the exact method, URL, and JSON body for the latest Signicat request
- Checks the callback result against an expected ID number, when you provide one

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file:

```bash
cp dev/.env.example dev/.env
```

3. Edit `dev/.env` with your sandbox values:

```bash
SIGNICAT_CLIENT_ID="your-sandbox-client-id"
SIGNICAT_CLIENT_SECRET="your-client-secret"
SIGNICAT_API_BASE_URL="https://api.signicat.com"
PORT=3000
APP_BASE_URL="http://127.0.0.1:3000"
```

You can also leave credentials out of `dev/.env` and paste them into the Connection section in the
UI. UI-entered credentials live only for the current app session.

4. Start the app:

```bash
npm start
```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Suggested First Run

1. In Connection, confirm the API base URL and add your sandbox credentials.
2. Click `Load document types` with `signicatvideoid` selected.
3. Tick a few document IDs you want to allow.
4. Click `Load starter template`.
5. Save the Capture configuration as something like `videoid-sandbox-demo`.
6. Click `Create dossier`.
7. Add the ID number you expect to match, if you want callback matching.
8. Start the Capture flow with `uiProfile=videoid-sandbox-demo`.
9. Complete or cancel the flow, then inspect the callback page and request debug output.

## Credential Notes

The hosted version is a static page, so credentials you enter there are visible to that page's
JavaScript while the browser session is active. They are stored in `sessionStorage` and are not
committed to this repository.

The local version keeps environment credentials server-side and proxies `/api/*` requests to
Signicat. Credentials pasted into the local UI are stored only in memory while the local server is
running.

Use sandbox, scoped, revocable credentials. The browser-side request limits in this tool are only to
reduce accidental repeated calls; real abuse protection must come from Signicat-side quotas, scoped
credentials, or a backend you control.

## Helpful Signicat Docs

- [Assure API reference, including OpenAPI details](https://developer.signicat.com/apis/id-document-and-biometric-verification/)
- [Assure OpenAPI JSON](https://api.signicat.com/assure/v3/api-docs)
- [Capture service docs](https://developer.signicat.com/docs/id-document-and-biometric-verification/services/capture/)
- [VideoID integration guide](https://developer.signicat.com/docs/id-document-and-biometric-verification/provider-specific-integrations/signicat-videoid/integration-steps/)

## Repository Layout

```text
public/   Static frontend used by both the hosted app and the local server
dev/      Local Node server and Signicat proxy
```

Extra notes:

- [Signicat Capture And Assure Flow Explainer](CAPTURE_FLOW_EXPLAINER.md)
