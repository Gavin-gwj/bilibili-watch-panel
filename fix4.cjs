const fs = require('fs');
const p = 'bilibili-watch-panel.user.js';
let s = fs.readFileSync(p, 'utf8');

// ensureCollector：进入视频页时挂载面板（覆盖 SPA 从首页切到视频页的场景）
const oldEnsure = "      if (!Collector.active) Collector.start();";
const newEnsure = "      if (!Collector.active) Collector.start();\n      if (!Panel.mounted) safe(function () { Panel.mount(); }, 'Panel.mount.spa');";
if (!s.includes(oldEnsure)) throw new Error('ensureCollector start 锚点未找到');
if (!s.includes("Panel.mount.spa")) s = s.replace(oldEnsure, newEnsure);

// 浮动按钮可拖动，位置持久化；关闭按钮固定在面板 header 右上角
const oldFabCss = "  position: fixed; right: 18px; top: 72px; z-index: 2147483000;";
const newFabCss = "  position: fixed; z-index: 2147483000; cursor: grab; touch-action: none;";
if (!s.includes(oldFabCss)) throw new Error('FAB CSS 锚点未找到');
s = s.replace(oldFabCss, newFabCss);

// 拖动逻辑：绑定在 bind() 内
const oldBindTail = [
  "      // ESC 关闭",
  "      document.addEventListener('keydown', function (e) {",
  "        if (e.key === 'Escape' && self.open) self.hide();",
  "      });",
  "    },"
].join('\n');
const newBindTail = [
  "      // ESC 关闭",
  "      document.addEventListener('keydown', function (e) {",
  "        if (e.key === 'Escape' && self.open) self.hide();",
  "      });",
  "      // 浮动按钮拖动（位置持久化，关闭按钮固定不动）",
  "      this.bindFabDrag();",
  "    },",
  "",
  "    /** 浮动按钮拖拽：拖动结束后吸附到最近的左右边缘 */",
  "    bindFabDrag() {",
  "      const fab = this.el.fab;",
  "      if (!fab) return;",
  "      const self = this;",
  "      let dragging = false, moved = false, startX = 0, startY = 0;",
  "      try {",
  "        const saved = GM_getValue('fabPos', null);",
  "        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) self.placeFab(saved.x, saved.y);",
  "      } catch (err) { /* 位置读取失败用默认值 */ }",
  "",
  "      fab.addEventListener('pointerdown', function (e) {",
  "        dragging = true; moved = false;",
  "        startX = e.clientX - fab.offsetLeft;",
  "        startY = e.clientY - fab.offsetTop;",
  "        fab.style.cursor = 'grabbing';",
  "        if (fab.setPointerCapture) { try { fab.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }",
  "      });",
  "      fab.addEventListener('pointermove', function (e) {",
  "        if (!dragging) return;",
  "        if (Math.abs(e.clientX - (startX + fab.offsetLeft)) > 4 || Math.abs(e.clientY - (startY + fab.offsetTop)) > 4) moved = true;",
  "        self.placeFab(e.clientX - startX, e.clientY - startY);",
  "      });",
  "      fab.addEventListener('pointerup', function () {",
  "        dragging = false;",
  "        fab.style.cursor = 'grab';",
  "        if (!moved) return;",
  "        // 吸附到最近的左右边缘",
  "        const left = fab.offsetLeft < (window.innerWidth - fab.offsetWidth) / 2;",
  "        const x = left ? 12 : window.innerWidth - fab.offsetWidth - 12;",
  "        const y = Math.min(Math.max(fab.offsetTop, 60), window.innerHeight - fab.offsetHeight - 12);",
  "        self.placeFab(x, y, true);",
  "        fab.dataset.dragged = '1';",
  "      });",
  "      // 拖动后不触发点击开关",
  "      fab.addEventListener('click', function (e) {",
  "        if (fab.dataset.dragged === '1') { e.stopImmediatePropagation(); fab.dataset.dragged = ''; }",
  "      }, true);",
  "    },",
  "",
  "    /** 设置浮动按钮位置并持久化 */",
  "    placeFab(x, y, persist) {",
  "      const fab = this.el.fab;",
  "      if (!fab) return;",
  "      const maxX = Math.max(0, window.innerWidth - fab.offsetWidth - 4);",
  "      const maxY = Math.max(0, window.innerHeight - fab.offsetHeight - 4);",
  "      const nx = Math.min(Math.max(0, x), maxX);",
  "      const ny = Math.min(Math.max(0, y), maxY);",
  "      fab.style.left = nx + 'px';",
  "      fab.style.top = ny + 'px';",
  "      fab.style.right = 'auto';",
  "      fab.style.bottom = 'auto';",
  "      if (persist) {",
  "        try { GM_setValue('fabPos', { x: nx, y: ny }); } catch (err) { /* 忽略 */ }",
  "      }",
  "    },"
].join('\n');
if (!s.includes(oldBindTail)) throw new Error('bind 尾部锚点未找到');
s = s.replace(oldBindTail, newBindTail);

// 默认位置：右上角
s = s.replace("        this.buildTabs();", "        this.el.fab.style.left = (window.innerWidth - 64) + 'px';\n        this.el.fab.style.top = '72px';\n        this.buildTabs();");

fs.writeFileSync(p, s, 'utf8');
console.log('stage4 patch ok');
