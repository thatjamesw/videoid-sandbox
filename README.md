# VideoID Sandbox Lab

Static Signicat VideoID sandbox for testing document support, capture configuration, and flow launch
with user-provided credentials.

It lets you:

- fetch supported document types for `signicatvideoid`, `signicatpictureid`, or `onfido`
- map Signicat's numeric document IDs into `signicatvideoidConfig.allowedIdTypes`
- create or update a capture configuration with `POST` or `PUT /assure/capture/configurations/{configurationId}`
- create a dossier
- start a capture flow and pass a `uiProfile` to it
- compare a configured ID Number against the process `finalResult` on callback
- override the Signicat API base URL and client credentials in the UI for the current browser session

## Project layout

```text
public/   Static app served by GitHub Pages and by the local dev server
dev/      Optional local Node server that serves public/ and proxies /api/* requests
```

GitHub Pages and local development use the same frontend files in `public/`. The local server only
adds a same-origin `/api/*` proxy for accounts or browsers where direct Signicat calls are not
available.

## GitHub Pages / static hosting

This app can run as a GitHub Pages-style static API explorer. In that mode, the HTML, CSS, and
JavaScript are served statically and your Signicat credential is entered in the browser each session.

Security model:

- no shared Signicat secret is committed to the repository or embedded in the static files
- browser-entered credentials are stored in `sessionStorage` for the current browser session
- credentials are still visible to the page JavaScript while the session is active, just like an
  interactive API docs console
- use sandbox, scoped, revocable credentials for this mode
- direct browser calls require Signicat's API and token endpoints to allow CORS for the Pages origin
- static mode limits this page to 2 concurrent Signicat requests and 30 Signicat requests per
  browser session per minute to reduce accidental hammering

To publish the static version, configure GitHub Pages to serve the `public/` directory, then open
`index.html`. The app automatically switches to static browser mode on `*.github.io`, and callback
URLs use `callback.html` so project subpaths work correctly.

If Signicat blocks direct browser requests with CORS, keep using the Node server locally or deploy a
small backend proxy that keeps credentials server-side.

These browser-side limits are not a DDoS protection boundary. A determined actor can bypass static
site JavaScript and call Signicat directly with their own scripts or tools. Real abuse protection has
to come from Signicat-side quotas/rate limits, scoped credentials, or a backend proxy you control.

## Why this app is useful

The Signicat docs show that:

- provider-specific VideoID restrictions live in `signicatvideoidConfig.allowedIdTypes`
- generic Capture restrictions live in `documentTypes`
- Start capture flow can receive a `uiProfile` created through the Capture configuration endpoints

Sources:

- [Assure API reference](https://developer.signicat.com/apis/id-document-and-biometric-verification/)
- [Capture service docs](https://developer.signicat.com/docs/id-document-and-biometric-verification/services/capture/)
- [VideoID integration guide](https://developer.signicat.com/docs/id-document-and-biometric-verification/provider-specific-integrations/signicat-videoid/integration-steps/)

## Run Locally

1. Copy `dev/.env.example` to `dev/.env`, or export the variables directly:

```bash
export SIGNICAT_CLIENT_ID="your-sandbox-client-id"
export SIGNICAT_CLIENT_SECRET="your client secret"
export SIGNICAT_API_BASE_URL="https://api.signicat.com"
export PORT=3000
export APP_BASE_URL="http://127.0.0.1:3000"
```

2. Start the app:

```bash
npm start
```

3. Open [http://localhost:3000](http://localhost:3000)

You can keep using environment variables as defaults, then change the client ID, client secret, and
expected ID Number directly in the `Connection` section of the UI. Those UI overrides are stored only
in memory for the current server run and reset when you restart the app or click `Clear session credentials`.

## Suggested first test

1. Click `Load document types` with `signicatvideoid`.
2. Tick a few document IDs you want to allow.
3. Click `Load starter template`.
4. Save the configuration as something like `videoid-sandbox-demo`.
5. Click `Create dossier`.
6. Add the ID Number you expect to match in the `Connection` section.
7. Start capture flow with `uiProfile=videoid-sandbox-demo`.
8. Complete or cancel the flow and inspect the callback page at `/callback`.

## Notes

- For VideoID, use `sdk=native`.
- The app now exchanges `SIGNICAT_CLIENT_ID` and `SIGNICAT_CLIENT_SECRET` for an OAuth bearer token automatically.
- In some Signicat setups, the value shown to you as an API token may actually be the secret you should paste into the `Client secret` field in this app.
- UI-entered credentials are not written to disk; in local proxy mode they only live in memory while
  the local server is running.
- The callback match checks `finalResult.personalIdentificationNumber` first, then `finalResult.documentNumber`.
- The app does not store secrets or config locally beyond your environment variables.
- If your Signicat account requires a specific domain setup for redirect or request domain, add that in the form before starting the flow.

## Extra docs

- [Signicat Capture And Assure Flow Explainer](CAPTURE_FLOW_EXPLAINER.md)
