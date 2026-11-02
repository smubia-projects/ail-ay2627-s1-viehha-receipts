import fs from 'node:fs';

// One OpenAI-compatible chat-completions client, configured by env so the gateway and model can change
// without code edits: API_BASE_URL (default apiyi), API_KEY, MODEL_NAME. The original OPENAI_BASE_URL /
// OPENAI_API_KEY / OPENAI_MODEL names are still read as fallbacks.

const DEFAULT_BASE_URL = 'https://api.apiyi.com/v1';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const apiKey = () => (process.env.API_KEY || process.env.OPENAI_API_KEY || '').trim();
const baseUrl = () => (process.env.API_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

export const MODEL = () => (process.env.MODEL_NAME || process.env.OPENAI_MODEL || DEFAULT_MODEL).trim();

export const aiReady = () => !!(apiKey() || process.env.LLM_MOCK_FILE);

/** An error the API turns into a status: 501 when no key is set, 502 when the provider fails. */
export class ModelError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The prompt's schema uses Gemini-style types (uppercase, nullable); this turns it into plain JSON Schema
// so it can be shown to any OpenAI-compatible model.
export function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'nullable') continue;
    else out[k] = toJsonSchema(v);
  }
  if (s.nullable && out.type) out.type = [out.type, 'null'];
  return out;
}

async function post(body, timeoutMs) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` };
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl()}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt < 2) continue;
      throw new ModelError(`Could not reach the AI service (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`, 502);
    }
    const data = await res.json().catch(() => ({}));
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      if (res.status === 400 && body.response_format && /response_format|json_object|json/i.test(msg)) {
        // Some models reject JSON mode: ask again without it (the prompt still asks for JSON only).
        delete body.response_format;
        continue;
      }
      if (res.status === 404 || /not a valid model|model.*not found/i.test(msg)) {
        throw new ModelError(`The AI model "${MODEL()}" is not available. Set MODEL_NAME to a current model.`, 502);
      }
      if (res.status === 401 || res.status === 403) throw new ModelError('The AI service rejected the API key.', 502);
      throw new ModelError(`The AI service returned an error (${res.status}). Try again in a moment.`, 502);
    }
    return data;
  }
}

/**
 * Sends one prompt to the model and returns its text (a JSON string when `schema` is given).
 * LLM_MOCK_FILE points to a JSON file ({ "analysis": {...}, "naive": "..." }) for UI work without a key.
 */
export async function callModel({ system, user, schema, timeoutMs = 90_000 }) {
  if (process.env.LLM_MOCK_FILE) {
    const mock = JSON.parse(fs.readFileSync(process.env.LLM_MOCK_FILE, 'utf8'));
    await sleep(400);
    return schema ? JSON.stringify(mock.analysis) : mock.naive;
  }
  if (!apiKey()) throw new ModelError('AI is not configured on this server (no API key).', 501);

  const sys = schema
    ? `${system}\n\nRespond with a single JSON object only, no code fences, matching this JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}`
    : system;
  const body = {
    model: MODEL(),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  };
  if (schema) body.response_format = { type: 'json_object' };
  const data = await post(body, timeoutMs);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new ModelError(`The AI returned no answer (${data?.choices?.[0]?.finish_reason || 'unknown reason'}).`, 502);
  return text;
}
