/* 리모컨(remote.js) 시험: 정해진 자리(방향, 선택, 이전과 묶음 둘)에 기기와 동작을 정하기,
   기기 없이 칸을 미리 정해 두고 나중에 연결하기.
   화면(DOM), 저장소, 중계는 가짜로 바꿉니다.
   실행: node test/remote.test.mjs */
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../remote.js", import.meta.url), "utf8");

/* ---------- 가짜 화면 ---------- */
function node(tag) {
  const e = {
    tag, attrs: {}, kids: [], on: {}, hidden: false, placeholder: "", _text: "", _value: "", _sel: -1,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.kids.push(c); if (tag === "select" && this._sel < 0 && this.options.length) this._sel = 0; return c; },
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); },
    fire(t) { (this.on[t] || []).forEach((fn) => fn()); },
    get options() {
      const out = [];
      (function walk(n) { n.kids.forEach((k) => (k.tag === "option" ? out.push(k) : walk(k))); })(this);
      return out;
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.kids = []; this._sel = -1; },
    get selectedIndex() { return this._sel; },
    set selectedIndex(i) { this._sel = i; },
    get value() {
      if (tag !== "select") return this._value;
      const o = this.options[this._sel];
      return o ? o.attrs.value : "";
    },
    set value(v) {
      if (tag !== "select") { this._value = String(v); return; }
      this._sel = this.options.findIndex((o) => o.attrs.value === String(v));
    },
  };
  return e;
}

/* 눈담 한 벌: 저장소 내용과 스위치봇 기기 목록을 받아 remote.js 를 돌립니다 */
function boot({ store = {}, devices = { deviceList: [], infraredRemoteList: [] }, scenes = [] } = {}) {
  const ids = { rbSlots: node("div"), rbNote: node("p"), rbUrl: node("input"), rbPass: node("input"), rbLoad: node("button") };
  const notices = [], calls = [], waits = [];
  const world = { devices, scenes };
  const window = { Nundam: { render() {}, notice(t) { notices.push(t); } } };
  const ctx = {
    window,
    document: { getElementById: (id) => ids[id] || null, createElement: node },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const body = /\/scenes$/.test(url) ? world.scenes : /\/devices$/.test(url) ? world.devices : {};
      return { status: 200, json: async () => ({ statusCode: 100, body }) };
    },
    Promise, JSON, String, Array,
    setTimeout: (fn) => { waits.push(1); fn(); },   /* 두 번 보낼 때의 간격은 기다리지 않습니다 */
  };
  vm.runInNewContext(SRC, ctx);
  const R = window.NundamRemote;
  /* 칸 i 의 입력들: 기기, 동작, 값, 안내.
     0~5 위, 왼쪽, 선택, 오른쪽, 아래, 이전. 6~9 채널 위로, 볼륨 위로, 채널 아래로, 볼륨 아래로. 10 11 넷플릭스, 디즈니 플러스 */
  const slot = (i) => {
    let found = null;
    (function walk(n) { n.kids.forEach((k) => (k.attrs["data-i"] === String(i) ? (found = k) : walk(k))); })(ids.rbSlots);
    const k = found.kids;
    return { dev: k[1], act: k[2], extra: k[3], state: k[4] };
  };
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const pick = (sel, v) => { sel.value = v; assert.strictEqual(sel.value, v, "고를 수 없는 값: " + v); sel.fire("change"); };
  const type = (inp, v) => { inp.value = v; inp.fire("input"); };
  const saved = () => JSON.parse(store["nundam-remote"]);
  return { R, ids, slot, pick, type, saved, plain, notices, calls, waits, world, store };
}
const RELAY = JSON.stringify({ url: "https://relay.example.workers.dev", pass: "open-sesame", v: 2, targets: [], buttons: [] });
const TV = { deviceId: "01-TV", deviceName: "거실 TV", remoteType: "TV" };
const AC = { deviceId: "02-AC", deviceName: "안방 에어컨", remoteType: "Air Conditioner" };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  통과  " + name); }
  catch (err) { failed++; console.log("  실패  " + name + "\n        " + err.message); }
}

const UP = 0, CH_UP = 6, VOL_UP = 7, CH_DOWN = 8, NETFLIX = 10, DISNEY = 11;

await test("아무것도 정하지 않아도 리모컨 화면의 자리는 그대로 보인다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  assert.deepStrictEqual(n.plain(n.R.screen()), {
    1: { label: "채널 및 볼륨 설정", sub: "묶음", group: "chvol" },
    2: { label: "위", sub: "설정 전", i: 0 },
    3: { label: "OTT 설정", sub: "묶음", group: "ott" },
    4: { label: "왼쪽", sub: "설정 전", i: 1 },
    5: { label: "선택", sub: "설정 전", i: 2 },
    6: { label: "오른쪽", sub: "설정 전", i: 3 },
    8: { label: "아래", sub: "설정 전", i: 4 },
    9: { label: "이전", sub: "설정 전", i: 5 },
  });
  assert.deepStrictEqual(n.plain(n.R.screen("chvol")), {
    1: { label: "채널 위로", sub: "설정 전", i: 6 },
    2: { label: "2개씩", sub: "한 번에 두 번 보내기로", twice: false },
    3: { label: "볼륨 위로", sub: "설정 전", i: 7 },
    4: { label: "채널 아래로", sub: "설정 전", i: 8 },
    6: { label: "볼륨 아래로", sub: "설정 전", i: 9 },
  });
  assert.deepStrictEqual(n.plain(n.R.screen("ott")), {
    1: { label: "넷플릭스", sub: "설정 전", i: 10, leave: true },
    2: { label: "디즈니 플러스", sub: "설정 전", i: 11, leave: true },
  });
  assert.strictEqual(n.R.count(), 0);
});

await test("정하지 않은 칸을 확인하면 보내지 않고 알려 준다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  assert.strictEqual(await n.R.send(UP), false);
  assert.strictEqual(await n.R.send(NETFLIX), false);
  assert.strictEqual(n.calls.length, 0);
  assert.match(n.notices[0], /아직 정해지지 않았습니다/);
});

await test("칸 이름은 정해져 있어 기기와 동작만 정한다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: { deviceList: [], infraredRemoteList: [TV] } });
  await n.R.load();
  const s = n.slot(UP);
  n.pick(s.dev, "ir:01-TV");
  n.pick(s.act, "*custom");
  n.type(s.extra, "UP");
  assert.deepStrictEqual(n.saved().buttons[UP], { label: "위", key: "ir:01-TV", cmd: "*custom", param: "UP" });
  assert.deepStrictEqual(n.plain(n.R.screen()[2]), { label: "위", sub: "거실 TV", i: 0 });
  assert.strictEqual(n.R.count(), 1);
  n.calls.length = 0;
  assert.strictEqual(await n.R.send(UP), true);
  assert.deepStrictEqual(JSON.parse(n.calls[0].init.body), { command: "UP", parameter: "default", commandType: "customize" });
});

await test("2개씩을 켜면 채널 및 볼륨 묶음의 칸만 두 번 보낸다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: { deviceList: [], infraredRemoteList: [TV] } });
  await n.R.load();
  n.pick(n.slot(VOL_UP).dev, "ir:01-TV");
  n.pick(n.slot(VOL_UP).act, "volumeAdd");
  n.pick(n.slot(UP).dev, "ir:01-TV");
  n.pick(n.slot(NETFLIX).dev, "ir:01-TV");
  n.calls.length = 0;
  await n.R.send(VOL_UP);
  assert.strictEqual(n.calls.length, 1);
  n.R.setTwice(true);
  assert.deepStrictEqual(n.plain(n.R.screen("chvol")[2]), { label: "1개씩", sub: "한 번에 한 번 보내기로", twice: true });
  n.calls.length = 0; n.notices.length = 0;
  assert.strictEqual(await n.R.send(VOL_UP), true);
  assert.strictEqual(n.calls.length, 2);
  assert.strictEqual(n.waits.length, 1);
  assert.deepStrictEqual(JSON.parse(n.calls[1].init.body), { command: "volumeAdd", parameter: "default", commandType: "command" });
  assert.strictEqual(n.notices[0], "볼륨 위로 두 번 보냈습니다");
  n.calls.length = 0;
  await n.R.send(UP);
  await n.R.send(NETFLIX);
  assert.strictEqual(n.calls.length, 2);
  n.R.setTwice(false);
  n.calls.length = 0;
  await n.R.send(VOL_UP);
  assert.strictEqual(n.calls.length, 1);
});

await test("기기를 불러오지 않아도 종류를 골라 칸을 저장한다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  const s = n.slot(VOL_UP);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "volumeAdd");
  assert.deepStrictEqual(n.saved().buttons[VOL_UP], { label: "볼륨 위로", key: "plan:ir:TV", cmd: "volumeAdd", param: "" });
  assert.match(s.state.textContent, /기기 연결 전/);
});

await test("기기 연결 전인 칸은 보내지 않는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(NETFLIX).dev, "plan:ir:TV");
  assert.deepStrictEqual(n.plain(n.R.screen("ott")[1]), { label: "넷플릭스", sub: "기기 연결 전", i: NETFLIX, leave: true });
  assert.strictEqual(await n.R.send(NETFLIX), false);
  assert.strictEqual(n.calls.length, 0);
  assert.match(n.notices[0], /아직 기기를 연결하지 않았습니다/);
});

await test("값이 필요한 동작은 값을 넣기 전까지 설정 전으로 남는다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  const s = n.slot(DISNEY);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "*custom");
  assert.strictEqual(n.R.screen("ott")[2].sub, "설정 전");
  assert.strictEqual(s.state.textContent, "값을 넣어 주세요");
  n.type(s.extra, "Disney+");
  assert.strictEqual(n.R.screen("ott")[2].sub, "기기 연결 전");
});

await test("불러온 기기가 종류마다 하나뿐이면 미리 정한 칸을 알아서 연결한다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(VOL_UP).dev, "plan:ir:TV");
  n.pick(n.slot(VOL_UP).act, "volumeAdd");
  n.world.devices = { deviceList: [{ deviceId: "HUB", deviceName: "허브", deviceType: "Hub Mini" }], infraredRemoteList: [TV, AC] };
  await n.R.load();
  assert.deepStrictEqual(n.saved().buttons[VOL_UP], { label: "볼륨 위로", key: "ir:01-TV", cmd: "volumeAdd", param: "" });
  assert.strictEqual(n.slot(VOL_UP).dev.value, "ir:01-TV");
  assert.strictEqual(n.slot(VOL_UP).act.value, "volumeAdd");
  assert.match(n.ids.rbNote.textContent, /미리 정해 둔 칸 1개를 기기에 연결했습니다/);
  n.calls.length = 0;
  assert.strictEqual(await n.R.send(VOL_UP), true);
  assert.match(n.calls[0].url, /\/v1\.1\/devices\/01-TV\/commands$/);
});

await test("같은 종류가 여럿이면 그대로 두고, 직접 고르면 동작과 값이 남는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(NETFLIX).dev, "plan:ir:TV");
  n.pick(n.slot(NETFLIX).act, "*custom");
  n.type(n.slot(NETFLIX).extra, "Netflix");
  n.world.devices = { deviceList: [], infraredRemoteList: [TV, { deviceId: "03-TV", deviceName: "안방 TV", remoteType: "DIY TV" }] };
  await n.R.load();
  assert.strictEqual(n.saved().buttons[NETFLIX].key, "plan:ir:TV");
  assert.match(n.ids.rbNote.textContent, /미리 정해 둔 칸 1개는 아래에서 기기를 골라 주세요/);
  n.pick(n.slot(NETFLIX).dev, "ir:03-TV");
  assert.deepStrictEqual(n.saved().buttons[NETFLIX], { label: "넷플릭스", key: "ir:03-TV", cmd: "*custom", param: "Netflix" });
  assert.strictEqual(n.slot(NETFLIX).state.textContent, "");
});

await test("스위치봇 기기와 장면은 알아서 연결하지 않는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(NETFLIX).dev, "plan:dev:");
  n.pick(n.slot(DISNEY).dev, "plan:scene:");
  n.world.devices = { deviceList: [{ deviceId: "HUB", deviceName: "허브", deviceType: "Hub Mini" }], infraredRemoteList: [] };
  n.world.scenes = [{ sceneId: "S1", sceneName: "잘 자요" }];
  await n.R.load();
  assert.strictEqual(n.saved().buttons[NETFLIX].key, "plan:dev:");
  assert.strictEqual(n.saved().buttons[DISNEY].key, "plan:scene:");
});

await test("다른 종류의 기기로 바꾸면 없는 동작은 첫 동작으로 돌아간다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: { deviceList: [], infraredRemoteList: [TV, AC] } });
  await n.R.load();
  const s = n.slot(CH_UP);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "channelAdd");
  n.pick(s.dev, "ir:02-AC");
  assert.strictEqual(n.saved().buttons[CH_UP].cmd, "turnOn");
});

await test("정한 칸은 다시 열어도 남아 있다", () => {
  const first = boot({ store: { "nundam-remote": RELAY } });
  first.pick(first.slot(CH_DOWN).dev, "plan:ir:TV");
  first.pick(first.slot(CH_DOWN).act, "channelSub");
  const again = boot({ store: first.store });
  const s = again.slot(CH_DOWN);
  assert.deepStrictEqual([s.dev.value, s.act.value], ["plan:ir:TV", "channelSub"]);
  assert.strictEqual(again.R.screen("chvol")[4].sub, "기기 연결 전");
});

await test("예전 8칸 배치로 저장한 칸은 버리고 중계 주소와 기기 목록은 남긴다", () => {
  const old = JSON.stringify({ url: "https://relay.example.workers.dev", pass: "open-sesame",
    targets: [{ key: "ir:01-TV", kind: "ir", id: "01-TV", name: "거실 TV", type: "TV" }],
    buttons: [{ label: "켜기", key: "ir:01-TV", cmd: "turnOn", param: "" }] });
  const n = boot({ store: { "nundam-remote": old } });
  assert.strictEqual(n.R.count(), 0);
  assert.strictEqual(n.R.screen()[2].sub, "설정 전");
  assert.strictEqual(n.ids.rbUrl.value, "https://relay.example.workers.dev");
  n.pick(n.slot(UP).dev, "ir:01-TV");
  assert.strictEqual(n.saved().v, 2);
});

console.log("\n" + passed + "개 통과, " + failed + "개 실패");
process.exit(failed ? 1 : 0);
