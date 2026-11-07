# Receipts

Who actually agreed to what in a group chat, with the messages to prove it. Built by Viehha Muralitharan for the
AI Lodge Hackathon 2026. The project lives in [`app/`](app/README.md) (renamed from `receipts.`, which Windows
cannot check out).

## AI Lodge showcase deployment

| Part | Where | What |
|---|---|---|
| Frontend | Vercel, root `app`, preset Other | Static `app/public` (home page at `/`, the app at `/app`); `build.js` writes `config.js` from `RECEIPTS_API_BASE` |
| API | Cloud Run `ail-ay2627-s1-viehha-receipts` | `app/Dockerfile` (context `app/`): `GET /api/health`, `POST /api/analyze` (rate limited) |

`.github/workflows/deploy.yml` builds the API image on pushes to `main` and deploys it with env from the `DOTENV`
repo secret (`gh secret set DOTENV < app/.env`). Every env var is documented in `app/.env.example`.

The showcase is stateless: chats are analysed and forgotten. The Telegram bot, message store, share links and
feedback log are not deployed.
