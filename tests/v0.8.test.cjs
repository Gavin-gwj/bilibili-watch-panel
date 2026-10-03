const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-watch-panel.user.js'), 'utf8');
const exposed = source.replace("  if (document.readyState === 'loading') {", "  globalThis.testApi = { CONFIG, Store, Panel, normalizeUiSettings, inspectRecordStorage, sanitizeRecord, mergeSessions, maybeShowWeeklyReminder };\n  if (document.readyState === 'loading') {");
const data = new Map();
const writes = [];
let failRead = '', failWrite = false, silentWrite = false;
const context = vm.createContext({
  console: { log() {}, error() {}, warn() {} },
  document: { readyState: 'loading', addEventListener() {} },
  GM_getValue(key, fallback) { if (key === failRead) throw Error('read denied'); return data.has(key) ? data.get(key) : fallback; },
  GM_setValue(key, value) { if (failWrite) throw Error('write denied'); if (!silentWrite) data.set(key, value); writes.push(key); },
  GM_deleteValue(key) { if (failWrite) throw Error('delete denied'); data.delete(key); writes.push(key); },
});
vm.runInContext(exposed, context);
const { CONFIG, Store, Panel, normalizeUiSettings: normalize, inspectRecordStorage: inspect, sanitizeRecord, mergeSessions } = context.testApi;
const plain = v => JSON.parse(JSON.stringify(v));
const record = (extra = {}) => ({ id: 'r', date: '2026-10-03', bvid: 'BVtest', watchedSeconds: 60, timestamp: 1, lastActive: 2, ...extra });
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS', name); }
const defaults = { theme: 'system', panelWidth: 380, fabSize: 48, weeklyReminder: true, shortcutEnabled: false };
test('设置缺失/非法对象返回默认且不写入', () => {
  for (const raw of [undefined, null, [], false, 'bad', 42, new Date(), new (class Settings { constructor(){ this.theme='dark'; } })(), Object.create({theme:'dark'})]) assert.deepEqual(plain(normalize(raw)), defaults);
  assert.deepEqual(plain(Store.getUiSettings()), defaults); assert.equal(writes.length, 0);
});
test('严格验证各字段、宽度夹取与步进', () => {
  assert.deepEqual(plain(normalize({ theme: 'bad', panelWidth: NaN, fabSize: '56', weeklyReminder: 'false', shortcutEnabled: 1 })), defaults);
  for (const [width, expected] of [[319, 320], [331, 340], [521, 520], [Infinity, 380], ['400', 380]]) assert.equal(normalize({ panelWidth: width }).panelWidth, expected);
  assert.equal(normalize({ weeklyReminder: false }).weeklyReminder, false);
});
test('仅写独立设置 key，保持旧存储', () => {
  const old = { watchRecords: [record()], watchRecordsArchive: [], weeklyGoalSeconds: 900, fabPos: { x: 12, y: 80 }, lastReminderWeek: 'old', schemaVersion: 3 };
  Object.entries(old).forEach(([k,v]) => data.set(k,v));
  assert.equal(Store.setUiSettings({ theme: 'dark', weeklyReminder: false }), true);
  for (const [k,v] of Object.entries(old)) assert.deepEqual(data.get(k),v);
  assert.deepEqual(writes, ['uiSettings']);
});
test('写入抛错/静默失败不报告已保存', () => {
  failWrite = true; assert.equal(Store.setUiSettings({ theme: 'light' }), false); failWrite = false;
  silentWrite = true; assert.equal(Store.setUiSettings({ theme: 'light' }), false); silentWrite = false;
  assert.equal(Store.getUiSettings().theme,'dark');
});
test('空数据检查', () => { const r = inspect([], [], null); assert.equal(r.status, 'ok'); assert.deepEqual(plain(r.counts), { records: 0, archive: 0 }); });
test('格式错误与无效记录分区计数', () => {
  assert.equal(inspect({}, [], null).findings[0].code, 'storage-format');
  const r = inspect([record(), record({ date:'bad' }), record({ watchedSeconds:-1 })], [record({ bvid:'' })], null);
  assert.deepEqual(plain(r.findings.filter(f=>f.code==='invalid-record')), [{ code:'invalid-record',source:'records',count:2 }, { code:'invalid-record',source:'archive',count:1 }]);
});
test('跨主/归档重复计整组条数且不合并', () => {
  const main = [record(),record()], archive=[record()];
  const before=JSON.stringify([main,archive]); const r=inspect(main,archive,null);
  assert.deepEqual(plain(r.findings), [{code:'duplicate-record',source:'combined',count:1,involved:3}]);
  assert.equal(JSON.stringify([main,archive]),before);
});
test('数值异常不把重看/倍速标错', () => {
  assert.equal(inspect([record({ durationSeconds: 30, maxPositionSeconds: 30 })], [], null).status,'ok');
  const r=inspect([record({ durationSeconds:-1,maxPositionSeconds:Infinity })],[],null);
  assert.equal(r.findings.find(f=>f.code==='invalid-number').count,2);
  assert.equal(inspect([record()],[],null).status,'ok');
});
test('旧记录缺会话兼容；会话格式与起止异常分开', () => {
  const r=inspect([record({bvid:'a'}),record({bvid:'b',sessions:'bad'}),record({bvid:'c',sessions:[null,{startAt:20,endAt:10},{startAt:Infinity,endAt:Infinity},{startAt:1,endAt:2}]})],[],null);
  assert.equal(r.findings.find(f=>f.code==='sessions-format').count,1);
  assert.equal(r.findings.find(f=>f.code==='invalid-session').count,3);
});
test('历史裁剪仅提示，不恢复数据', () => { const r=inspect([],[],{dropped:10}); assert.equal(r.findings[0].code,'archive-trimmed'); });
test('检查完全只读，读取异常为未完成', () => {
  const before = JSON.stringify([...data]), count=writes.length;
  Store.inspectHealth(); assert.equal(JSON.stringify([...data]),before); assert.equal(writes.length,count);
  for (const key of ['watchRecords','watchRecordsArchive','archiveNotice']) {
    failRead=key; const r=Store.inspectHealth(); assert.equal(r.status,'incomplete'); assert.ok(r.findings.some(f=>f.code==='read-error'));
  }
  failRead=''; assert.equal(writes.length,count);
});
test('异常巨大数组和巨大会话有安全截止', () => {
  assert.equal(inspect(Array(CONFIG.ARCHIVE_THRESHOLD+1).fill(record()),[],null).status,'incomplete');
  assert.equal(inspect([],Array(CONFIG.ARCHIVE_MAX+1).fill(record()),null).status,'incomplete');
  assert.equal(inspect([record({sessions:Array(100001).fill({startAt:1,endAt:2})})],[],null).status,'incomplete');
});
test('默认外观写入范围不覆盖操作设置', () => {
  Store.setUiSettings({theme:'dark',fabSize:56,panelWidth:520,weeklyReminder:false,shortcutEnabled:true});
  Store.setUiSettings({theme:'system',fabSize:48,panelWidth:380});
  assert.deepEqual(plain(Store.getUiSettings()),{...defaults,weeklyReminder:false,shortcutEnabled:true});
});
test('重置按钮位置只删除 fabPos，失败保留现有位置', () => {
  context.window={innerWidth:1000}; Panel.el.fab={offsetWidth:48};
  let placed=null; const original=Panel.placeFab; Panel.placeFab=(...v)=>{placed=v;};
  const before=JSON.stringify(data.get('watchRecords')); assert.equal(Panel.resetFabPosition(),true);
  assert.equal(data.has('fabPos'),false); assert.deepEqual(placed,[936,72]); assert.equal(JSON.stringify(data.get('watchRecords')),before);
  failWrite=true; placed=null; assert.equal(Panel.resetFabPosition(),false); assert.equal(placed,null); failWrite=false; Panel.placeFab=original;
});
test('图表明暗颜色更新且保留 tooltip 回调/网格显示选项', () => {
  const callback=()=>{}; const options={plugins:{tooltip:{callbacks:{label:callback}},legend:{labels:{}}},scales:{x:{grid:{display:false},ticks:{}}}};
  Panel.colorChart(options,true); assert.equal(options.scales.x.ticks.color,'#c2c7d0'); assert.equal(options.scales.x.grid.display,false);
  Panel.colorChart(options,false); assert.equal(options.plugins.tooltip.callbacks.label,callback); assert.equal(options.plugins.legend.labels.color,'#61666d');
});
test('关闭周提醒不读取/写入提醒周', () => {
  Store.setUiSettings({weeklyReminder:false}); const before=writes.length;
  context.testApi.maybeShowWeeklyReminder(); assert.equal(writes.length,before);
});
test('旧记录清洗与会话重复导入兼容', () => {
  assert.ok(sanitizeRecord(record())); const session={startAt:1,endAt:2,endReason:'pause'};
  assert.equal(mergeSessions([session],[session]).length,1); assert.equal(CONFIG.SCHEMA_VERSION,3);
});
test('用户脚本不增加权限或外部依赖', () => {
  const cp=require('node:child_process'); const base=cp.execFileSync('git',['show','HEAD:bilibili-watch-panel.user.js'],{encoding:'utf8',cwd:path.join(__dirname,'..')});
  const meta=s=>s.split(/\r?\n/).filter(l=>/^\/\/ @(grant|require|match)\s/.test(l)); assert.deepEqual(meta(source),meta(base));
  assert.match(source,/@version\s+0\.8\.0/);
});
console.log(`\n${checks} tests passed`);
