/* 스위치봇 중계(worker/switchbot-relay.js) 시험. 스위치봇 서버는 가짜로 바꿉니다.
   실행: node test/switchbot-relay.test.mjs */
import assert from "node:assert";
import crypto from "node:crypto";
import worker from "../worker/switchbot-relay.js";

const env = { SWITCHBOT_TOKEN: "tok-123", SWITCHBOT_SECRET: "sec-456", PASS: "open-sesame" };
let calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ statusCode: 100, body: {}, message: "success" }), { status: 200 });
};
const req = (method, path, { pass = "open-sesame", body, origin = "https://waltzo.github.io" } = {}) =>
  new Request("https://relay.example.workers.dev" + path, {
    method, body,
    headers: { ...(pass === null ? {} : { "X-Nundam-Pass": pass }), Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}) },
  });

let passed = 0, failed = 0;
async function test(name, fn) {
  calls = [];
  try { await fn(); passed++; console.log("  통과  " + name); }
  catch (err) { failed++; console.log("  실패  " + name + "\n        " + err.message); }
}

await test("사전 요청(OPTIONS)에 CORS 헤더로 답한다", async () => {
  const r = await worker.fetch(new Request("https://relay.example.workers.dev/v1.1/devices", { method: "OPTIONS", headers: { Origin: "https://waltzo.github.io" } }), env);
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://waltzo.github.io");
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Nundam-Pass/);
  assert.strictEqual(calls.length, 0);
});
await test("기기 목록을 서명을 붙여 전달한다", async () => {
  const r = await worker.fetch(req("GET", "/v1.1/devices"), env);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).statusCode, 100);
  assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://waltzo.github.io");
  assert.strictEqual(calls.length, 1);
  const { url, init } = calls[0];
  assert.strictEqual(url, "https://api.switch-bot.com/v1.1/devices");
  assert.strictEqual(init.method, "GET");
  assert.strictEqual(init.headers.Authorization, "tok-123");
  assert.match(init.headers.t, /^\d{13}$/);
  /* 공식 예제와 같은 방법으로 다시 계산해 서명이 맞는지 봅니다 */
  const want = crypto.createHmac("sha256", "sec-456").update("tok-123" + init.headers.t + init.headers.nonce).digest("base64");
  assert.strictEqual(init.headers.sign, want);
  assert.strictEqual(init.body, undefined);
});
await test("기기 조작과 장면 실행을 본문 그대로 전달한다", async () => {
  const body = JSON.stringify({ command: "volumeAdd", parameter: "default", commandType: "command" });
  await worker.fetch(req("POST", "/v1.1/devices/02-202008110034-13/commands", { body }), env);
  assert.strictEqual(calls[0].url, "https://api.switch-bot.com/v1.1/devices/02-202008110034-13/commands");
  assert.strictEqual(calls[0].init.method, "POST");
  assert.strictEqual(calls[0].init.body, body);
  await worker.fetch(req("POST", "/v1.1/scenes/T02-20200804130110/execute"), env);
  assert.strictEqual(calls[1].url, "https://api.switch-bot.com/v1.1/scenes/T02-20200804130110/execute");
  await worker.fetch(req("GET", "/v1.1/scenes/"), env);
  assert.strictEqual(calls[2].url, "https://api.switch-bot.com/v1.1/scenes");
});
await test("암호가 없거나 틀리면 스위치봇에 보내지 않는다", async () => {
  for (const pass of [null, "", "wrong", "open-sesam", "open-sesame1"]) {
    const r = await worker.fetch(req("GET", "/v1.1/devices", { pass }), env);
    assert.strictEqual(r.status, 401, "암호 " + JSON.stringify(pass));
    assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://waltzo.github.io", "거절해도 페이지가 이유를 읽을 수 있어야 합니다");
  }
  assert.strictEqual(calls.length, 0);
});
await test("정해진 네 가지 말고는 전달하지 않는다", async () => {
  const bad = [["GET", "/v1.1/devices/abc/status"], ["POST", "/v1.1/devices"], ["GET", "/v1.1/webhook/setupWebhook"], ["POST", "/v1.1/webhook/setupWebhook"],
    ["GET", "/"], ["DELETE", "/v1.1/devices"], ["POST", "/v1.1/devices/../scenes/x/execute/commands"], ["GET", "/v1.0/devices"]];
  for (const [m, p] of bad) {
    const r = await worker.fetch(req(m, p, m === "POST" ? { body: "{}" } : {}), env);
    assert.strictEqual(r.status, 404, m + " " + p);
  }
  assert.strictEqual(calls.length, 0);
});
await test("토큰과 비밀 키는 응답에 섞여 나가지 않는다", async () => {
  for (const r of [await worker.fetch(req("GET", "/v1.1/devices"), env), await worker.fetch(req("GET", "/v1.1/devices", { pass: "x" }), env), await worker.fetch(req("GET", "/nope"), env)]) {
    const text = (await r.text()) + JSON.stringify([...r.headers]);
    assert.ok(!text.includes("tok-123") && !text.includes("sec-456") && !text.includes("open-sesame"));
  }
});
await test("ALLOW_ORIGIN 을 정하면 다른 주소의 요청을 거절한다", async () => {
  const e = { ...env, ALLOW_ORIGIN: "https://waltzo.github.io" };
  assert.strictEqual((await worker.fetch(req("GET", "/v1.1/devices", { origin: "https://evil.example" }), e)).status, 403);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual((await worker.fetch(req("GET", "/v1.1/devices"), e)).status, 200);
});
await test("설정이 빠졌거나 스위치봇에 닿지 못하면 이유를 알린다", async () => {
  assert.strictEqual((await worker.fetch(req("GET", "/v1.1/devices"), { PASS: "open-sesame" })).status, 500);
  const keep = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("down"); };
  const r = await worker.fetch(req("GET", "/v1.1/devices"), env);
  globalThis.fetch = keep;
  assert.strictEqual(r.status, 502);
  assert.match((await r.json()).message, /닿지 못했습니다/);
});

globalThis.fetch = realFetch;
console.log("\n통과 " + passed + "개, 실패 " + failed + "개");
process.exit(failed ? 1 : 0);
