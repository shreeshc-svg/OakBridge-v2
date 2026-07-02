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

> **Note:** `emergentintegrations` in `requirements.txt` is the Emergent
> platform SDK and may not resolve from public PyPI. If `pip install` fails on
> it, comment that one line out — the app boots fine without it (AI author-bio
> drafting is simply disabled). See "Migrating off Emergent" below.

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
Three functional integrations still reference Emergent services and need
replacements before a fully independent production launch:

1. **Object storage** (`backend/features.py`) — book covers / eBook PDFs upload
   to Emergent object storage. Swap to S3 or Cloudflare R2.
2. **AI author bios** (`backend/extensions.py`, `emergentintegrations`) — uses
   the Emergent LLM proxy. Swap to a direct provider (OpenAI / Gemini / Anthropic).
3. **Hero images** (`design_guidelines.json`, `frontend/src/pages/Solutions.jsx`,
   `Verticals.jsx`) — hosted on Emergent's CDN; self-host for independence.

None of these block local development.
