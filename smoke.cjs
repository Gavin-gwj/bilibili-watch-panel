// 临时冒烟测试：用最小 DOM/GM 桩执行用户脚本，验证顶层无未定义引用
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('bilibili-watch-panel.user.js', 'utf8');

const store = {};
const noop = function () {};
const elStub = () => ({
  style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop },
  addEventListener: noop, appendChild: noop, removeChild: noop, remove: noop,
  querySelector: () => null, querySelectorAll: () => [], setAttribute: noop,
  getAttribute: () => '', attachShadow() { return elStub(); },
  textContent: '', innerHTML: '', offsetLeft: 0, offsetTop: 0, offsetWidth: 46, offsetHeight: 46,
  parentNode: null,
});

const documentStub = {
  readyState: 'complete',
  hidden: false,
  title: '测试视频_哔哩哔哩_bilibili',
  body: elStub(),
  documentElement: elStub(),
  addEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => elStub(),
};

const sandbox = {
  console,
  document: documentStub,
  location: { pathname: '/video/BV1xx411c7mD', search: '', href: 'https://www.bilibili.com/video/BV1xx411c7mD' },
  navigator: { userAgent: 'node' },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
  GM_setValue: (k, v) => { store[k] = v; },
  GM_getValue: (k, d) => (k in store ? store[k] : d),
  GM_deleteValue: (k) => { delete store[k]; },
  GM_addStyle: noop,
  Chart: function () { this.destroy = noop; },
  html2canvas: () => Promise.resolve({ toBlob: (cb) => cb(new Blob([])) }),
  Blob, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
  Event: function () {}, AbortController,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { aid: 1, title: 'T', owner: { name: 'U', mid: 2 } } }) }),
  alert: noop, confirm: () => false,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.history = { pushState: noop, replaceState: noop };

let uncaught = null;
process.on('uncaughtException', (e) => { uncaught = e; });
try {
  vm.runInNewContext(src, sandbox, { filename: 'bilibili-watch-panel.user.js' });
} catch (e) {
  uncaught = e;
}
setTimeout(() => {
  console.log('uncaught:', uncaught ? (uncaught.stack || uncaught.message) : 'none');
  console.log('keys written:', Object.keys(store).join(',') || '(none)');
  process.exit(uncaught ? 1 : 0);
}, 50);
