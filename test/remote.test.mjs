/* 리모컨(remote.js) 시험: 기기 없이 칸을 미리 정해 두고 나중에 연결하기.
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
  const notices = [], calls = [];
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
  };
  vm.runInNewContext(SRC, ctx);
  const R = window.NundamRemote;
  /* 칸 i 의 입력들: 이름, 기기, 동작, 값, 안내 */
  const slot = (i) => {
    const k = ids.rbSlots.kids[i].kids;
    return { name: k[1], dev: k[2], act: k[3], extra: k[4], state: k[5] };
  };
  const pick = (sel, v) => { sel.value = v; assert.strictEqual(sel.value, v, "고를 수 없는 값: " + v); sel.fire("change"); };
  const type = (inp, v) => { inp.value = v; inp.fire("input"); };
  const saved = () => JSON.parse(store["nundam-remote"]);
  return { R, ids, slot, pick, type, saved, notices, calls, world, store };
}
const RELAY = JSON.stringify({ url: "https://relay.example.workers.dev", pass: "open-sesame", targets: [], buttons: [] });
const TV = { deviceId: "01-TV", deviceName: "거실 TV", remoteType: "TV" };
const AC = { deviceId: "02-AC", deviceName: "안방 에어컨", remoteType: "Air Conditioner" };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  통과  " + name); }
  catch (err) { failed++; console.log("  실패  " + name + "\n        " + err.message); }
}

await test("기기를 불러오지 않아도 종류를 골라 칸을 저장한다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  const s = n.slot(0);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "volumeAdd");
  assert.strictEqual(s.name.value, "음량 +");
  assert.deepStrictEqual(n.saved().buttons[0], { label: "음량 +", key: "plan:ir:TV", cmd: "volumeAdd", param: "" });
  assert.match(s.state.textContent, /기기 연결 전/);
});

await test("기기 연결 전인 칸은 자판에 보이지만 보내지 않는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(0).dev, "plan:ir:TV");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(n.R.buttons()[0])), { label: "켜기", sub: "기기 연결 전" });
  assert.strictEqual(await n.R.send(0), false);
  assert.strictEqual(n.calls.length, 0);
  assert.match(n.notices[0], /아직 기기를 연결하지 않았습니다/);
});

await test("값이 필요한 동작은 값을 넣기 전까지 자판에 보이지 않는다", () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  const s = n.slot(1);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "SetChannel");
  assert.strictEqual(n.R.buttons()[1], null);
  n.type(s.extra, "11");
  assert.strictEqual(n.R.buttons()[1].label, "채널 번호로");
});

await test("불러온 기기가 종류마다 하나뿐이면 미리 정한 칸을 알아서 연결한다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(0).dev, "plan:ir:TV");
  n.pick(n.slot(0).act, "volumeAdd");
  n.type(n.slot(0).name, "소리 크게");
  n.world.devices = { deviceList: [{ deviceId: "HUB", deviceName: "허브", deviceType: "Hub Mini" }], infraredRemoteList: [TV, AC] };
  await n.R.load();
  assert.deepStrictEqual(n.saved().buttons[0], { label: "소리 크게", key: "ir:01-TV", cmd: "volumeAdd", param: "" });
  assert.strictEqual(n.slot(0).dev.value, "ir:01-TV");
  assert.strictEqual(n.slot(0).act.value, "volumeAdd");
  assert.match(n.ids.rbNote.textContent, /미리 정해 둔 칸 1개를 기기에 연결했습니다/);
  n.calls.length = 0;
  assert.strictEqual(await n.R.send(0), true);
  assert.match(n.calls[0].url, /\/v1\.1\/devices\/01-TV\/commands$/);
  assert.deepStrictEqual(JSON.parse(n.calls[0].init.body), { command: "volumeAdd", parameter: "default", commandType: "command" });
});

await test("같은 종류가 여럿이면 그대로 두고, 직접 고르면 동작과 값이 남는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(2).dev, "plan:ir:TV");
  n.pick(n.slot(2).act, "SetChannel");
  n.type(n.slot(2).extra, "11");
  n.type(n.slot(2).name, "뉴스");
  n.world.devices = { deviceList: [], infraredRemoteList: [TV, { deviceId: "03-TV", deviceName: "안방 TV", remoteType: "DIY TV" }] };
  await n.R.load();
  assert.strictEqual(n.saved().buttons[2].key, "plan:ir:TV");
  assert.match(n.ids.rbNote.textContent, /미리 정해 둔 칸 1개는 아래에서 기기를 골라 주세요/);
  n.pick(n.slot(2).dev, "ir:03-TV");
  assert.deepStrictEqual(n.saved().buttons[2], { label: "뉴스", key: "ir:03-TV", cmd: "SetChannel", param: "11" });
  assert.strictEqual(n.slot(2).state.textContent, "");
});

await test("스위치봇 기기와 장면은 알아서 연결하지 않는다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY } });
  n.pick(n.slot(0).dev, "plan:dev:");
  n.pick(n.slot(1).dev, "plan:scene:");
  n.world.devices = { deviceList: [{ deviceId: "HUB", deviceName: "허브", deviceType: "Hub Mini" }], infraredRemoteList: [] };
  n.world.scenes = [{ sceneId: "S1", sceneName: "잘 자요" }];
  await n.R.load();
  assert.strictEqual(n.saved().buttons[0].key, "plan:dev:");
  assert.strictEqual(n.saved().buttons[1].key, "plan:scene:");
});

await test("다른 종류의 기기로 바꾸면 없는 동작은 첫 동작으로 돌아간다", async () => {
  const n = boot({ store: { "nundam-remote": RELAY }, devices: { deviceList: [], infraredRemoteList: [TV, AC] } });
  await n.R.load();
  const s = n.slot(0);
  n.pick(s.dev, "plan:ir:TV");
  n.pick(s.act, "channelAdd");
  n.pick(s.dev, "ir:02-AC");
  assert.strictEqual(n.saved().buttons[0].cmd, "turnOn");
});

await test("미리 정한 칸은 다시 열어도 남아 있다", () => {
  const first = boot({ store: { "nundam-remote": RELAY } });
  first.pick(first.slot(3).dev, "plan:ir:Air Conditioner");
  first.pick(first.slot(3).act, "setAll");
  first.type(first.slot(3).extra, "26,2,1,on");
  first.type(first.slot(3).name, "냉방");
  const again = boot({ store: first.store });
  const s = again.slot(3);
  assert.deepStrictEqual([s.name.value, s.dev.value, s.act.value, s.extra.value], ["냉방", "plan:ir:Air Conditioner", "setAll", "26,2,1,on"]);
  assert.strictEqual(again.R.buttons()[3].sub, "기기 연결 전");
});

console.log("\n" + passed + "개 통과, " + failed + "개 실패");
process.exit(failed ? 1 : 0);
