import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, toJsonSchema, ModelError } from '../src/llm.js';

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
};

test('Gemini-style schema becomes plain JSON Schema', () => {
  const out = toJsonSchema({ type: 'OBJECT', properties: { owner: { type: 'STRING', nullable: true }, n: { type: 'INTEGER' } } });
  assert.deepEqual(out, { type: 'object', properties: { owner: { type: ['string', 'null'] }, n: { type: 'integer' } } });
});

test('no key: callModel throws a 501 ModelError without calling anything', async () => {
  await withEnv({ API_KEY: undefined, OPENAI_API_KEY: undefined, LLM_MOCK_FILE: undefined }, async () => {
    await assert.rejects(callModel({ system: 's', user: 'u' }), (e) => e instanceof ModelError && e.status === 501);
  });
});

test('calls API_BASE_URL/chat/completions with MODEL_NAME and JSON mode, and returns the text', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"decisions":[],"suspicious_messages":[]}' } }] }), { status: 200 });
  };
  try {
    await withEnv({ API_KEY: 'stub-key', API_BASE_URL: 'https://gateway.test/v1/', MODEL_NAME: 'stub-model', LLM_MOCK_FILE: undefined }, async () => {
      const text = await callModel({ system: 'sys', user: 'chat', schema: { type: 'OBJECT' } });
      assert.equal(text, '{"decisions":[],"suspicious_messages":[]}');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen[0].url, 'https://gateway.test/v1/chat/completions');
  assert.equal(seen[0].body.model, 'stub-model');
  assert.deepEqual(seen[0].body.response_format, { type: 'json_object' });
  assert.equal(seen[0].headers.Authorization, 'Bearer stub-key');
});

test('provider failure becomes a 502 ModelError (never 429/503, which belong to the rate limiter)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  try {
    await withEnv({ API_KEY: 'stub-key', LLM_MOCK_FILE: undefined }, async () => {
      await assert.rejects(callModel({ system: 's', user: 'u' }), (e) => e instanceof ModelError && e.status === 502);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
