# Oakbridge Publishing

Marketing site + bookstore for Oakbridge Publishing.

- **Backend:** FastAPI + MongoDB (Motor), JWT auth. All routes under `/api`.
- **Frontend:** React 19 + React Router v7 + Tailwind + shadcn/ui (Create React App via CRACO).

---

## Prerequisites

- **Python** 3.11+
- **Node** 18+ and **Yarn** (`npm i -g yarn`)
- **MongoDB** — either a local install, or run the bundled Docker one below.

---

## 1. Start MongoDB

Option A — Docker (no local Mongo needed):

```bash
docker compose up -d
```

Option B — use an existing local `mongod` on `mongodb://localhost:27017`
(or set `MONGO_URL` in `backend/.env` to any Mongo instance, e.g. Atlas).

## 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# .env already exists for local dev (copy .env.example if it doesn't)
uvicorn server:app --reload --port 8000
```

On first start the API auto-seeds 5 categories, 30 books, the admin account,
authors and coupons. Verify it's up: <http://localhost:8000/api/books>.

> **Note:** `requirements.txt` lists only what the app imports. It is kept
> byte-identical to `requirements-local.txt` (the file `render.yaml` installs
> in production) and `sanity-check.js` fails the build if the two drift. For
> the test suite, also install `requirements-dev.txt`.

## 3. Frontend

```bash
cd frontend
yarn install
# .env already exists for local dev (copy .env.example if it doesn't)
yarn start
```

App runs at <http://localhost:3000> and talks to the backend at
`REACT_APP_BACKEND_URL` (default `http://localhost:8000`).

---

## Default logins

- **Admin:** `admin@oakbridge.in` / `Oakbridge@2026` (from `backend/.env`) → `/admin`
- Register any customer account from `/register`.

## Environment variables

See `backend/.env.example` and `frontend/.env.example`. Only Mongo, `JWT_SECRET`,
`CORS_ORIGINS` and the admin credentials are required. Razorpay, Resend and the
Emergent key are optional — when blank, those features disable themselves
gracefully (payments return 503, emails are skipped, AI/storage are off).

## Tests

```bash
cd backend && pytest tests/     # set REACT_APP_BACKEND_URL if not localhost:8000
```

---

## Migrating off Emergent

This project was scaffolded on Emergent. Branding/telemetry have been removed.
Done. Nothing in this repo calls an Emergent service any more.

1. **Object storage** — replaced. `backend/features.py` writes to a private S3
   bucket when `S3_BUCKET` is set and to local disk under `STORAGE_DIR`
   otherwise; both are served through `/api/files/*`. See `COVERS-UPLOAD.md`.
2. **AI author bios** — removed. `emergentintegrations` is not imported
   anywhere and is not in `requirements.txt`.
3. **Hero images** — the last two `static.prod-images.emergentagent.com` URLs
   lived in `design_guidelines.json`, a scaffold file no code ever read. It has
   been deleted. Hero images are admin-uploaded and served from our own
   storage.
