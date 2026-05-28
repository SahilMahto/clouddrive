# Copilot Instructions

This repo is a small CloudDrive-style file portal with a browser UI and an Azure/local-file storage backend. There are two backend implementations present, so confirm the active runtime before editing.

## Key architecture
- Frontend is plain HTML/CSS/JS: `templates/index.html`, `static/main.js`, `static/style.css`.
- Backend is implemented in both:
  - `app.py` -- Python Flask server matching the README and `requirements.txt`
  - `server.js` -- Node/Express server matching `package.json`
- Both backends expose the same primary API contract:
  - `GET /api/status`
  - `GET /api/files`
  - `POST /api/upload`
  - `DELETE /api/files/:filename`
  - `GET /api/download/:filename`
- The UI relies on the server response shape from `/api/files`: each file object must include `name`, `size`, `last_modified`, `url`, and `download_url`.

## Important workflows
- Python workflow: `python app.py`
- Node workflow: `npm start`
- Node dev watcher: `npm run dev`
- No frontend build tools or bundlers are used; edits to `static/*` and `templates/*` can be verified by reloading the browser.
- Environment config is loaded from `.env` via `dotenv`/`python-dotenv`.

## Configuration and mode behavior
- `AZURE_STORAGE_CONNECTION_STRING` toggles Azure mode.
- `AZURE_CONTAINER_NAME` defaults to `uploads`.
- `PORT` defaults to `8080`.
- When Azure is unavailable, both backends fall back to local storage under `local_storage/` and show demo-mode UI.
- The client also queries `/api/status` to determine whether it is in Azure or local demo mode.

## Project-specific conventions
- Upload limit is enforced at 10 MB on both client and server.
- Filenames are sanitized before saving:
  - Flask uses `werkzeug.utils.secure_filename`
  - Node uses a regex replacement of invalid chars
- `static/main.js` drives search/filter logic entirely client-side. It classifies files by extension (`pdf`, `image`, `doc`, `archive`, `other`).
- `server.js` uses `multer.memoryStorage()` so files are uploaded to Azure directly from memory rather than disk.
- Download behavior: the app exposes a proxy download route for private Azure containers, but the UI also stores direct blob URLs.

## What to preserve when changing code
- Keep the `/api/status` contract stable because the UI uses it to toggle the demo banner and badge state.
- Keep file-list objects compatible with `static/main.js` rendering and actions.
- Preserve the local storage fallback path because it is part of the demo mode experience.
- If you change one backend implementation, do not assume the other is dead; note that the README and `package.json` currently point to different server runtimes.

## Notes for code edits
- There is no test suite or GitHub Actions config in this repository.
- `README.md` currently documents Flask setup, while `package.json` points to Node/Express. This is an important repo-specific inconsistency to avoid breaking.
- When adding API behavior, update both backend variants only if the project is intended to support both; otherwise, mark which runtime is being targeted.

## Useful files
- `README.md` — current user-facing setup guide
- `package.json` — Node dependency and startup scripts
- `requirements.txt` — Python dependencies
- `app.py` — Flask backend
- `server.js` — Express backend
- `templates/index.html` — UI markup
- `static/main.js` — client behavior and API integration
