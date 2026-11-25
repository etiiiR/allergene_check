# GutFeeling in 10 slides

A 3–5 minute English walkthrough with presenter notes and screenshots of the German UI. All records in the screenshots are fictional.

From the repository root, using Node 22.12 or later:

```sh
npm --prefix pitch-deck ci
npm --prefix pitch-deck run dev
```

Open http://localhost:3030. Use the arrow keys to move between slides. The presenter view is at http://localhost:3030/presenter. To build the standalone site, run `npm --prefix pitch-deck run build`. Slidev's browser export is available at http://localhost:3030/export.

## Refresh the screenshots

Use a new disposable Compose project. The script only seeds an unconfigured app on port 3020 and creates an encrypted fixture with simulated records.

```sh
npm --prefix web ci
npm --prefix web exec -- playwright install chromium
export SURREALDB_USER=root SURREALDB_PASS="$(openssl rand -hex 32)"
export ACCOUNT_SETUP_TOKEN="$(openssl rand -hex 32)" ALLOW_DEMO_SEED=1
export APP_URL=http://localhost:3020 APP_HOST_PORT=3020
export ML_SERVICE_HOST_PORT=18221
docker-compose --parallel 1 --env-file /dev/null -p gutfeeling-slide-demo up -d --build --wait
node pitch-deck/capture-demo.mjs
docker-compose --env-file /dev/null -p gutfeeling-slide-demo down --volumes
unset SURREALDB_USER SURREALDB_PASS ACCOUNT_SETUP_TOKEN ALLOW_DEMO_SEED
unset APP_URL APP_HOST_PORT ML_SERVICE_HOST_PORT
```

The final Compose command removes this demo's disposable database volume. Use a dedicated terminal so its exported settings are only used for the demo.
