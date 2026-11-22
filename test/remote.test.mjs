/* 리모컨(remote.js) 시험: 리모컨 기기 하나를 고르고, 칸마다 정해진 것(기본 명령 또는 학습한 버튼)을 보내기.
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
  /* 설정 화면의 리모컨 기기 고르기 */
  const devSel = () => {
    let found = null;
    (function walk(n) { n.kids.forEach((k) => (k.attrs.id === "rbDev" ? (found = k) : walk(k))); })(ids.rbSlots);
    return found;
  };
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const pick = (sel, v) => { sel.value = v; assert.strictEqual(sel.value, v, "고를 수 없는 값: " + v); sel.fire("change"); };
  const type = (inp, v) => { inp.value = v; inp.fire("input"); };
  const saved = () => JSON.parse(store["nundam-remote"]);
  return { R, ids, devSel, pick, type, saved, plain, notices, calls, waits, world, store };
}
const RELAY = JSON.stringify({ url: "https://relay.example.workers.dev", pass: "open-sesame", v: 4, targets: [], dev: "" });
const TV = { deviceId: "01-TV", deviceName: "거실 TV", remoteType: "TV" };
const AC = { deviceId: "02-AC", deviceName: "안방 에어컨", remoteType: "Air Conditioner" };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  통과  " + name); }
  catch (err) { failed++; console.log("  실패  " + name + "\n        " + err.message); }
}

const NAMES = ["위", "왼쪽", "선택", "오른쪽", "아래", "이전",
  "볼륨 위로", "채널 위로", "음소거", "편성표", "볼륨 아래로", "채널 아래로", "넷플릭스", "디즈니 플러스", "나가기"];
const at = (name) => NAMES.indexOf(name);
const TVS = { deviceList: [{ deviceId: "HUB", deviceName: "허브", deviceType: "Hub Mini" }], infraredRemoteList: [TV, AC] };
const sentBody = (n, k = 0) => JSON.parse(n.calls[k].init.body);

await test("기기를 고르기 전에도 리모컨 화면의 자리는 그대로 보인다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  assert.deepStrictEqual(n.plain(n.R.screen()), {
    1: { label: "채널 및 볼륨 설정", sub: "묶음", group: "chvol" },
    2: { label: "위", sub: "기기 연결 전", i: 0 },
    3: { label: "OTT 설정", sub: "묶음", group: "ott" },
    4: { label: "왼쪽", sub: "기기 연결 전", i: 1 },
    5: { label: "선택", sub: "기기 연결 전", i: 2 },
    6: { label: "오른쪽", sub: "기기 연결 전", i: 3 },
    8: { label: "아래", sub: "기기 연결 전", i: 4 },
    9: { label: "이전", sub: "기기 연결 전", i: 5 },
  });
  assert.deepStrictEqual(n.plain(n.R.screen("chvol")), {
    1: { label: "볼륨 위로", sub: "기기 연결 전", i: 6 },
    2: { label: "2개씩", sub: "한 번에 두 번 보내기로", twice: false },
    3: { label: "채널 위로", sub: "기기 연결 전", i: 7 },
    4: { label: "음소거", sub: "기기 연결 전", i: 8 },
    6: { label: "편성표", sub: "기기 연결 전", i: 9 },
    7: { label: "볼륨 아래로", sub: "기기 연결 전", i: 10 },
    9: { label: "채널 아래로", sub: "기기 연결 전", i: 11 },
  });
  assert.deepStrictEqual(n.plain(n.R.screen("ott")), {
    1: { label: "넷플릭스", sub: "기기 연결 전", i: 12, leave: true },
    2: { label: "디즈니 플러스", sub: "기기 연결 전", i: 13, leave: true },
  });
  assert.strictEqual(n.R.count(), 0);
  assert.deepStrictEqual(n.plain(n.R.all()), NAMES.map((label, i) => ({ i, label, ready: false })));
});

await test("기기를 고르지 않은 채 칸을 확인하면 보내지 않고 알려 준다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  assert.strictEqual(await n.R.send(at("위")), false);
  assert.strictEqual(n.calls.length, 0);
  assert.match(n.notices[0], /리모컨 기기를 아직 고르지 않았습니다/);
});

await test("TV 종류 리모컨이 하나뿐이면 불러올 때 알아서 고른다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: TVS });
  await n.R.load();
  assert.strictEqual(n.saved().dev, "ir:01-TV");
  assert.deepStrictEqual(n.saved().targets.map((t) => t.key), ["ir:01-TV", "ir:02-AC"], "허브는 목록에 넣지 않습니다");
  assert.strictEqual(n.devSel().value, "ir:01-TV");
  assert.match(n.ids.rbNote.textContent, /리모컨 2개를 불러왔습니다. 거실 TV 을\(를\) 골랐습니다/);
  assert.strictEqual(n.R.screen()[2].sub, "거실 TV");
  assert.strictEqual(n.R.count(), NAMES.length);
  assert.ok(n.R.all().every((x) => x.ready));
});

await test("TV 종류 리모컨이 여럿이면 고르지 않고 보호자가 고른다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY },
    devices: { deviceList: [], infraredRemoteList: [TV, { deviceId: "03-TV", deviceName: "안방 TV", remoteType: "DIY TV" }] } });
  await n.R.load();
  assert.strictEqual(n.saved().dev, "");
  assert.match(n.ids.rbNote.textContent, /아래에서 쓸 리모컨을 골라 주세요/);
  n.pick(n.devSel(), "ir:03-TV");
  assert.strictEqual(n.saved().dev, "ir:03-TV");
  assert.strictEqual(n.R.screen()[5].sub, "안방 TV");
});

await test("볼륨과 채널은 기본 명령으로, 나머지는 정해진 이름의 학습한 버튼으로 보낸다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: TVS });
  await n.R.load();
  const want = {
    "볼륨 위로": ["volumeAdd", "command"], "볼륨 아래로": ["volumeSub", "command"],
    "채널 위로": ["channelAdd", "command"], "채널 아래로": ["channelSub", "command"],
    "위": ["up", "customize"], "왼쪽": ["left", "customize"], "선택": ["ok", "customize"], "오른쪽": ["right", "customize"],
    "아래": ["down", "customize"], "이전": ["back", "customize"], "편성표": ["편성표", "customize"], "나가기": ["나가기", "customize"],
    "넷플릭스": ["넷플릭스", "customize"], "디즈니 플러스": ["디즈니", "customize"], "음소거": ["음소거", "customize"],
  };
  assert.deepStrictEqual(Object.keys(want).sort(), NAMES.slice().sort());
  for (const name of NAMES) {
    n.calls.length = 0;
    assert.strictEqual(await n.R.send(at(name)), true, name);
    assert.match(n.calls[0].url, /\/v1\.1\/devices\/01-TV\/commands$/);
    assert.deepStrictEqual(sentBody(n), { command: want[name][0], parameter: "default", commandType: want[name][1] }, name);
  }
});

await test("2개씩을 켜면 볼륨과 채널 위아래만 두 번 보낸다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: TVS });
  await n.R.load();
  n.R.setTwice(true);
  assert.deepStrictEqual(n.plain(n.R.screen("chvol")[2]), { label: "1개씩", sub: "한 번에 한 번 보내기로", twice: true });
  n.calls.length = 0; n.notices.length = 0;
  assert.strictEqual(await n.R.send(at("볼륨 위로")), true);
  assert.strictEqual(n.calls.length, 2);
  assert.strictEqual(n.waits.length, 1);
  assert.strictEqual(n.notices[0], "볼륨 위로 두 번 보냈습니다");
  n.calls.length = 0;
  await n.R.send(at("위")); await n.R.send(at("넷플릭스")); await n.R.send(at("음소거")); await n.R.send(at("나가기"));
  assert.strictEqual(n.calls.length, 4);
  n.R.setTwice(false);
  n.calls.length = 0;
  await n.R.send(at("볼륨 위로"));
  assert.strictEqual(n.calls.length, 1);
});

await test("볼륨과 채널 명령이 없는 종류를 고르면 알려 준다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY },
    devices: { deviceList: [], infraredRemoteList: [{ deviceId: "09-ETC", deviceName: "기타 리모컨", remoteType: "Others" }] } });
  await n.R.load();
  assert.strictEqual(n.saved().dev, "", "알아서 고르지 않습니다");
  n.pick(n.devSel(), "ir:09-ETC");
  const state = n.ids.rbSlots.kids[0].kids[2];
  assert.match(state.textContent, /볼륨과 채널의 기본 명령이 없을 수 있습니다/);
});

await test("고른 기기는 다시 열어도 남아 있다", async () => {
  const first = boot({ store: { "nundam-remote": RELAY }, devices: TVS });
  await first.R.load();
  const again = boot({ store: first.store });
  assert.strictEqual(again.devSel().value, "ir:01-TV");
  assert.strictEqual(again.R.screen()[2].sub, "거실 TV");
});

await test("스위치봇 앱에서 리모컨이 없어지면 기기 연결 전으로 돌아간다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: TVS });
  await n.R.load();
  n.world.devices = { deviceList: [], infraredRemoteList: [AC] };
  await n.R.load();
  assert.strictEqual(n.saved().dev, "");
  assert.strictEqual(n.R.screen()[2].sub, "기기 연결 전");
});

await test("칸마다 기기를 정하던 때의 설정에서는 그 칸들이 쓰던 리모컨을 고른다", () => {
  const old = JSON.stringify({ url: "https://relay.example.workers.dev", pass: "open-sesame", v: 3,
    targets: [{ key: "ir:01-TV", kind: "ir", id: "01-TV", name: "거실 TV", type: "TV" }, { key: "scene:S1", kind: "scene", id: "S1", name: "잘 자요", type: "장면" }],
    buttons: [null, { label: "왼쪽", key: "plan:ir:TV", cmd: "*custom", param: "L" }, { label: "선택", key: "ir:01-TV", cmd: "*custom", param: "OK" }] });
  const n = boot({ store: { "nundam-remote": old } });
  assert.strictEqual(n.devSel().value, "ir:01-TV");
  assert.strictEqual(n.R.screen()[5].sub, "거실 TV");
  assert.strictEqual(n.ids.rbUrl.value, "https://relay.example.workers.dev");
  assert.strictEqual(n.devSel().options.length, 2, "장면은 목록에서 빠집니다");
});

console.log("\n" + passed + "개 통과, " + failed + "개 실패");
process.exit(failed ? 1 : 0);
