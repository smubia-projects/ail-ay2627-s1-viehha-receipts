import 'dotenv/config';
import express from 'express';
import { analyzeChat } from './analyze.js';
import { MODEL, aiReady } from './llm.js';
import { createRateLimiter } from './rateLimitEngine.js';

/**
 * Receipts API (Cloud Run). API-only and stateless: the static frontend is deployed separately on
 * Vercel (app/public) and sends the chat with each request. Nothing is stored.
 *
 *   GET  /api/health    -> {"status":"ok", ...}
 *   POST /api/analyze   -> sort a chat's plans into confirmed / unconfirmed / disputed / cancelled   [rate limited: analyze]
 */

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// CORS from CORS_ORIGINS (comma-separated). Unset (local dev) = any origin.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '3mb' }));

// Shared AI Lodge rate limiter: slug = full project folder name, one bucket for the AI route.
// No Upstash credentials (local dev) = limiting off.
const limiter = createRateLimiter({
  project: 'ail-ay2627-s1-viehha-receipts',
  buckets: { analyze: Number(process.env.RATE_LIMIT_ANALYZE_MAX || 5) },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});
const limitAnalyze = limiter('analyze');

/** Runs the limiter inside the handler, right before the model call; false when it has already answered 429/503. */
function passLimit(req, res) {
  return new Promise((resolve, reject) => {
    let passed = false;
    Promise.resolve(limitAnalyze(req, res, (err) => (err ? reject(err) : ((passed = true), resolve(true)))))
      .then(() => {
        if (!passed) resolve(false);
      })
      .catch(reject);
  });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', aiReady: aiReady(), model: MODEL() });
});

app.post('/api/analyze', async (req, res) => {
  const { timeZone, compareNaive, from, to } = req.body || {};
  let messages = req.body?.messages;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'Send a list of messages.' });
  if (messages.length > 5000) return res.status(413).json({ error: 'Too many messages. Pick a shorter time window.' });
  const lo = Number.isFinite(from) ? from : -Infinity;
  const hi = Number.isFinite(to) ? to : Infinity;
  messages = messages.filter((m) => m && Number(m.ts) >= lo && Number(m.ts) <= hi);
  if (messages.length < 2) return res.status(400).json({ error: 'Need at least 2 messages in the selected time window.' });
  if (!aiReady()) return res.status(501).json({ error: 'AI is not configured on this server.' });

  // One hit per analysis (it makes one or two model calls: the checked analysis and, if asked, the plain summary).
  if (!(await passLimit(req, res))) return;

  try {
    const result = await analyzeChat(messages, { timeZone, compareNaive: !!compareNaive });
    res.json(result);
  } catch (e) {
    const status = e.status === 501 || e.status === 502 ? e.status : 502;
    console.error('analyze failed:', e.message);
    res.status(status).json({ error: e.message || 'Analysis failed.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found. This is the Receipts API; the app itself is on the frontend.' }));

app.use((err, req, res, _next) => {
  const status = Number(err.status) || 500;
  if (status === 413) return res.status(413).json({ error: 'That chat is too large.' });
  if (status === 400) return res.status(400).json({ error: 'Expected JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Receipts API listening on 0.0.0.0:${PORT}`);
  if (!aiReady()) console.warn('No API key set: /api/analyze answers 501 until API_KEY is configured.');
  else console.log(`AI model: ${MODEL()}`);
});
