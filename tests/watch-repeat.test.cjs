// 回归测试：进度条跳转不得被误记为「重复观看」。
// 用最小 DOM 桩驱动真实 Collector，不 mock 被测逻辑本身。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-watch-panel.user.js'), 'utf8');
const exposed = source.replace(
  "  if (document.readyState === 'loading') {",
  "  globalThis.testApi = { CONFIG, Store, Collector };\n  if (document.readyState === 'loading') {"
);

function createHarness() {
  const store = new Map();
  const docHandlers = Object.create(null);
  const video = { currentTime: 0, duration: 300, paused: true, ended: false, readyState: 4 };
  const document = {
    readyState: 'loading',
    hidden: false,
    addEventListener(type, fn) { (docHandlers[type] || (docHandlers[type] = [])).push(fn); },
    removeEventListener() {},
    querySelector(selector) { return selector === 'video' ? video : null; },
    dispatchEvent(event) {
      const type = event && event.type;
      (docHandlers[type] || []).forEach((fn) => fn(Object.assign({ target: video, type }, event)));
      return true;
    },
  };
  const window = { addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    document,
    window,
    location: { href: 'https://www.bilibili.com/video/BVtest', pathname: '/video/BVtest', search: '' },
    GM_getValue(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
    GM_setValue(key, value) { store.set(key, JSON.parse(JSON.stringify(value))); },
    GM_deleteValue(key) { store.delete(key); },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
  });
  vm.runInContext(exposed, context);
  const { Collector, Store } = context.testApi;
  Collector.active = true;
  Collector.videoInfo = { mediaKey: 'BVtest', bvid: 'BVtest', mediaType: 'video', durationSeconds: 300 };
  Collector.videoEl = video;
  Collector._sessionKey = 'test';
  Collector.bindEvents();
  return {
    Collector,
    Store,
    video,
    fire(type) { document.dispatchEvent({ type }); },
    play() { video.paused = false; video.ended = false; this.fire('play'); this.fire('playing'); },
    pause() { video.paused = true; this.fire('pause'); },
    seek(position) { video.currentTime = position; this.fire('seeking'); this.fire('seeked'); },
    // 以 step 秒为一步推进真实播放，触发心跳
    advance(total, step = 10) {
      let left = total;
      while (left > 0) {
        const d = Math.min(step, left);
        video.currentTime += d;
        Collector.lastTickAt -= d * 1000;
        Collector.tick();
        left -= d;
      }
    },
  };
}

function record(h) {
  return h.Store.getRecords().find((r) => r.mediaKey === 'BVtest') || null;
}
function playCount(h) {
  const r = record(h);
  return r ? r.playCount : 0;
}
function repeats(h) {
  return Math.max(0, playCount(h) - 1);
}

let checks = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('首次播放记录 playCount = 1', () => {
  const h = createHarness();
  h.play();
  h.advance(20);
  assert.equal(playCount(h), 1);
});

test('暂停后继续播放不累加重复观看', () => {
  const h = createHarness();
  h.play();
  h.advance(30);
  h.pause();
  h.play();
  h.advance(30);
  assert.equal(repeats(h), 0);
});

test('手动向前跳转到未观看区间不累加重复观看', () => {
  const h = createHarness();
  h.play();
  h.advance(30);
  h.seek(200);
  h.advance(20);
  assert.equal(repeats(h), 0);
});

test('纯跳回已观看区间但不继续播放，不累加重复观看', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.pause();
  h.seek(20);
  assert.equal(repeats(h), 0);
});

test('跳回已观看片段并继续播放，计一次重复观看', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.seek(20);
  h.advance(20);
  assert.equal(repeats(h), 1);
  assert.equal(record(h).openCount, 1, '重复观看不应增加 openCount');
});

test('同一段回看过程只计一次，不随心跳持续累加', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.seek(20);
  h.advance(35);
  assert.equal(repeats(h), 1);
});

test('看完新内容后再次回看，可再计一次', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.seek(20);
  h.advance(80);           // 20 → 100，越过 60 后回到新内容
  h.seek(30);
  h.advance(20);
  assert.equal(repeats(h), 2);
});

test('连续快速拖动只按最终落点判定，不重复计数', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.seek(80);
  h.seek(150);
  h.seek(30);
  h.advance(20);
  assert.equal(repeats(h), 1);
});

test('播放结束后从头重播，计一次重复观看', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.video.currentTime = 300;
  h.Collector.lastTickAt -= 10000;
  h.Collector.tick();
  h.video.paused = true;
  h.video.ended = true;
  h.fire('ended');
  h.seek(0);
  h.play();
  h.advance(20);
  assert.equal(repeats(h), 1);
});

// B 站点击进度条的真实事件顺序：pause → seeking → seeked → play
test('B站事件顺序（pause→seek→play）向前跳转不计重看', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.pause();
  h.video.currentTime = 200;
  h.fire('seeking');
  h.fire('seeked');
  h.play();
  h.advance(20);
  assert.equal(repeats(h), 0);
});

test('B站事件顺序（pause→seek→play）回看已看片段计一次', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.pause();
  h.video.currentTime = 20;
  h.fire('seeking');
  h.fire('seeked');
  h.play();
  h.advance(20);
  assert.equal(repeats(h), 1);
});

test('切换视频时 Collector.start 重置已观看区间与回看标志', () => {
  const h = createHarness();
  h.play();
  h.advance(60);
  h.Collector._pendingRewatch = true;
  assert.ok(h.Collector._watchedRanges.length > 0, '前置条件：会话内已有已观看区间');

  // 走真实的重建入口，而不是手工清空字段
  h.Collector.start();

  assert.equal(JSON.stringify(h.Collector._watchedRanges), '[]', '切换视频后已观看区间应清空');
  assert.equal(h.Collector._pendingRewatch, false, '切换视频后回看标志应复位');
  assert.ok(Number.isNaN(h.Collector._lastKnownTime), '切换视频后播放位置基准应复位');
  assert.ok(Number.isNaN(h.Collector._lastCurrentTime), '切换视频后计时基准应复位');

  // 新会话从头播放，不因上一支视频的区间而误判重看
  h.video.currentTime = 0;
  h.play();
  h.advance(20);
  assert.equal(repeats(h), 0, '新会话首个播放周期不额外计重看');
});

for (const [name, fn] of tests) {
  fn();
  checks += 1;
  console.log('PASS', name);
}
console.log(`\n${checks} tests passed`);
