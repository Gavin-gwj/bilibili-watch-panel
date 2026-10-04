const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-watch-panel.user.js'), 'utf8');
const exposed = source.replace(
  "  if (document.readyState === 'loading') {",
  "  globalThis.testApi = { CONFIG, Store, Stats, sanitizeRecord, buildMediaKey, findRecordIndex, parseBangumiHydrate, parseCheeseState, resolveMediaType, mediaKeyOf };\n  if (document.readyState === 'loading') {"
);
const data = new Map();
const context = vm.createContext({
  console: { log() {}, error() {}, warn() {} },
  document: { readyState: 'loading', addEventListener() {} },
  location: { href: 'https://www.bilibili.com/video/BV1GJ411x7h7', pathname: '/video/BV1GJ411x7h7', search: '' },
  GM_getValue(key, fallback) { return data.has(key) ? data.get(key) : fallback; },
  GM_setValue(key, value) { data.set(key, value); },
  GM_deleteValue(key) { data.delete(key); },
});
vm.runInContext(exposed, context);
const { CONFIG, Stats, sanitizeRecord, buildMediaKey, findRecordIndex, parseBangumiHydrate, parseCheeseState, resolveMediaType, mediaKeyOf } = context.testApi;

const record = (extra = {}) => ({
  id: 'r', date: '2026-10-03', bvid: 'BVtest', watchedSeconds: 60,
  timestamp: 1, lastActive: 2, ...extra,
});
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS', name); }

const bangumiFixture = [
  'const playurlSSRData = {"status":200,"data":{"result":{"video_info":{"timelength":1493182,"dash":{"duration":1494}},"arc":{"aid":710444604,"cid":26835486927,"bvid":"BV1PQ4y1N7V8"},',
  '"supplement":{"ogv_episode_info":{"episode_id":321808,"index_title":"1","long_title":"云霄飞车杀人事件"},"ogv_season_info":{"season_id":33378}}}}}',
].join('');
const cheeseFixture = [
  'window.__EduPlayPiniaState__="',
  JSON.stringify(JSON.stringify({
    index: {
      viewInfo: { title: '斯坦福大学《人生设计课》读书会', season_id: 37081, up_info: { mid: 404801960, uname: '我是宋超' } },
      currentEp: { id: 1209625, aid: 113407537710579, cid: 26565414318, duration: 681, title: '第六节｜设计思维的5种基本心态', index: 6 },
    },
  })).slice(1, -1),
  '";',
].join('');

test('v3 旧记录迁移到 v4 且数值不变', () => {
  const out = sanitizeRecord(record({ bvid: 'BV1xx', watchedSeconds: 60 }));
  assert.equal(out.mediaKey, 'BV1xx');
  assert.equal(out.mediaType, 'video');
  assert.equal(out.page, 1);
  assert.equal(out.partTitle, '');
  assert.equal(out.seasonTitle, '');
  assert.equal(out.watchedSeconds, 60);
  assert.equal(CONFIG.SCHEMA_VERSION, 4);
});

test('缺少 mediaKey 的旧记录仍被视为合法', () => {
  assert.ok(sanitizeRecord(record()));
});

test('单 P 视频 mediaKey 与旧 bvid 一致', () => {
  assert.equal(buildMediaKey({ mediaType: 'video', bvid: 'BV1xx', page: 1, pageCount: 1 }), 'BV1xx');
  assert.equal(buildMediaKey({ mediaType: 'video', bvid: 'BV1xx' }), 'BV1xx');
});

test('多 P 视频按分 P 生成唯一 mediaKey', () => {
  assert.equal(buildMediaKey({ mediaType: 'video', bvid: 'BV1xx', page: 2, pageCount: 3 }), 'BV1xx_p2');
  assert.equal(buildMediaKey({ mediaType: 'video', bvid: 'BV1xx', page: 1, pageCount: 3 }), 'BV1xx_p1');
});

test('番剧与课程 mediaKey 规则', () => {
  assert.equal(buildMediaKey({ mediaType: 'bangumi', epId: '321808' }), 'ep321808');
  assert.equal(buildMediaKey({ mediaType: 'cheese', epId: '1209625' }), 'cheese_ep1209625');
});

test('媒体类型由路径判定', () => {
  assert.equal(resolveMediaType('/video/BV1xx'), 'video');
  assert.equal(resolveMediaType('/bangumi/play/ep321808'), 'bangumi');
  assert.equal(resolveMediaType('/cheese/play/ep1209625'), 'cheese');
  assert.equal(resolveMediaType('/index.html'), '');
});

test('mediaKeyOf 对旧记录回退到 bvid', () => {
  assert.equal(mediaKeyOf({ bvid: 'BVold' }), 'BVold');
  assert.equal(mediaKeyOf({ bvid: 'BVold', mediaKey: 'BVold_p2' }), 'BVold_p2');
});

test('番剧 SSR 数据解析出剧集与时长', () => {
  const info = parseBangumiHydrate(bangumiFixture);
  assert.equal(info.mediaType, 'bangumi');
  assert.equal(info.epId, '321808');
  assert.equal(info.bvid, 'BV1PQ4y1N7V8');
  assert.equal(info.durationSeconds, 1494);
  assert.equal(info.page, 1);
  assert.equal(info.partTitle, '云霄飞车杀人事件');
});

test('课程 Pinia 数据解析出课时与课程名', () => {
  const info = parseCheeseState(cheeseFixture);
  assert.equal(info.mediaType, 'cheese');
  assert.equal(info.epId, '1209625');
  assert.equal(info.durationSeconds, 681);
  assert.equal(info.seasonTitle, '斯坦福大学《人生设计课》读书会');
  assert.equal(info.page, 6);
  assert.equal(info.partTitle, '第六节｜设计思维的5种基本心态');
});

test('解析函数遇到坏输入返回 null 而不抛错', () => {
  assert.equal(parseBangumiHydrate('not a script'), null);
  assert.equal(parseCheeseState('window.__EduPlayPiniaState__="";'), null);
  assert.equal(parseBangumiHydrate(null), null);
});

test('多 P 视频同一天分两条记录', () => {
  const a = record({ bvid: 'BV1xx', mediaKey: 'BV1xx_p1', page: 1 });
  const b = record({ bvid: 'BV1xx', mediaKey: 'BV1xx_p2', page: 2 });
  assert.equal(findRecordIndex([a], '2026-10-03', 'BV1xx_p2'), -1);
  assert.equal(findRecordIndex([a, b], '2026-10-03', 'BV1xx_p2'), 1);
});

test('统计按 mediaKey 去重而非 bvid', () => {
  const list = [
    record({ bvid: 'BV1xx', mediaKey: 'BV1xx_p1', durationSeconds: 100, maxPositionSeconds: 100, completed: true }),
    record({ bvid: 'BV1xx', mediaKey: 'BV1xx_p2', durationSeconds: 100, maxPositionSeconds: 50, completed: false }),
  ];
  const q = Stats.quality(list, { dedupeByBvid: true });
  assert.equal(q.distinctVideoCount, 2);
});

console.log(`\n${checks} tests passed`);
