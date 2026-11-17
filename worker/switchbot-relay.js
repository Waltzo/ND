/* 눈담 스위치봇 중계 (Cloudflare Worker)

   왜 필요한가: 스위치봇 API(api.switch-bot.com)는 웹 페이지에서 바로 부를 수 없습니다(브라우저가 막음).
   이 스크립트가 눈담의 요청을 받아 서명을 붙여 스위치봇으로 대신 보냅니다.
   토큰과 비밀 키는 이 Worker 안에만 두고, 눈담에는 이 Worker 의 주소와 암호만 넣습니다.

   설치 순서
   1. 스위치봇 앱 > 프로필 > 환경설정 > 정보 > "앱 버전"을 10번 누름 > 개발자 옵션 > 토큰과 비밀 키를 복사
   2. dash.cloudflare.com 에 가입(무료) > Workers 및 Pages > 만들기 > Worker 만들기 > 이름을 정하고 배포
   3. "코드 편집"을 눌러 기본 코드를 지우고 이 파일 내용을 통째로 붙여 넣은 뒤 배포
   4. 그 Worker 의 설정 > 변수 및 비밀 에 아래 세 개를 "비밀"로 추가
        SWITCHBOT_TOKEN   스위치봇 토큰
        SWITCHBOT_SECRET  스위치봇 비밀 키
        PASS              내가 정하는 암호(길고 남이 모를 것). 눈담 설정에 똑같이 넣습니다
      (선택) ALLOW_ORIGIN  눈담 주소만 받도록 제한. 예: https://waltzo.github.io
   5. 눈담 > 설정 > 리모컨 에 Worker 주소(https://이름.계정.workers.dev)와 암호를 넣고 "기기 불러오기"

   이 중계는 아래 네 가지 요청만 전달합니다. 그 밖의 주소는 거절합니다.
     GET  /v1.1/devices                      기기 목록
     GET  /v1.1/scenes                       장면 목록
     POST /v1.1/devices/{기기}/commands      기기 조작
     POST /v1.1/scenes/{장면}/execute        장면 실행 */

const API = "https://api.switch-bot.com";
const ALLOWED = [
  ["GET", /^\/v1\.1\/devices$/],
  ["GET", /^\/v1\.1\/scenes$/],
  ["POST", /^\/v1\.1\/devices\/[A-Za-z0-9_-]+\/commands$/],
  ["POST", /^\/v1\.1\/scenes\/[A-Za-z0-9_-]+\/execute$/],
];

function cors(env, request) {
  const origin = request.headers.get("Origin") || "*";
  const allow = env.ALLOW_ORIGIN || origin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Nundam-Pass",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function reply(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
/* 암호 비교에 걸리는 시간이 맞은 글자 수에 따라 달라지지 않게 합니다. */
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/* 스위치봇 v1.1 서명: HMAC-SHA256(토큰 + 시각 + 임의값, 비밀 키) 를 base64 로 */
async function sign(token, secret, t, nonce) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(token + t + nonce)));
  let s = "";
  for (const b of mac) s += String.fromCharCode(b);
  return btoa(s);
}

export default {
  async fetch(request, env) {
    const h = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (env.ALLOW_ORIGIN && request.headers.get("Origin") && request.headers.get("Origin") !== env.ALLOW_ORIGIN) {
      return reply(403, { statusCode: 403, message: "허용하지 않은 주소에서 온 요청입니다" }, h);
    }
    if (!env.SWITCHBOT_TOKEN || !env.SWITCHBOT_SECRET || !env.PASS) {
      return reply(500, { statusCode: 500, message: "Worker 에 SWITCHBOT_TOKEN, SWITCHBOT_SECRET, PASS 를 넣어 주세요" }, h);
    }
    if (!same(request.headers.get("X-Nundam-Pass") || "", env.PASS)) {
      return reply(401, { statusCode: 401, message: "암호가 맞지 않습니다" }, h);
    }
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (!ALLOWED.some(([m, re]) => m === request.method && re.test(path))) {
      return reply(404, { statusCode: 404, message: "전달하지 않는 요청입니다" }, h);
    }
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const init = {
      method: request.method,
      headers: {
        "Authorization": env.SWITCHBOT_TOKEN,
        "sign": await sign(env.SWITCHBOT_TOKEN, env.SWITCHBOT_SECRET, t, nonce),
        "t": t,
        "nonce": nonce,
        "Content-Type": "application/json; charset=utf8",
      },
    };
    if (request.method === "POST") init.body = (await request.text()) || "{}";
    try {
      const up = await fetch(API + path, init);
      return new Response(await up.text(), {
        status: up.status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...h },
      });
    } catch (err) {
      return reply(502, { statusCode: 502, message: "스위치봇 서버에 닿지 못했습니다" }, h);
    }
  },
};
