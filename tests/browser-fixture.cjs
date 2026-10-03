// Local synthetic fixture: never reads a real Tampermonkey profile or personal records.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sourcePath = path.join(__dirname, '..', 'bilibili-watch-panel.user.js');
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const source = fs.readFileSync(sourcePath, 'utf8').replace("  if (document.readyState === 'loading') {", "  window.testApi = { CONFIG, Store, Panel, maybeShowWeeklyReminder };\n  if (document.readyState === 'loading') {");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>v0.8 隔离验收</title></head><body>
  <h1>v0.8 合成数据测试页</h1><input aria-label="页面输入框"><div contenteditable="true">可编辑区域</div>
  <script>
  window.testWrites=[]; window.failWrite=false; window.failRead='';
  window.GM_getValue=(key,fallback)=>{if(window.failRead===key)throw Error('read denied');const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw);};
  window.GM_setValue=(key,value)=>{if(window.failWrite)throw Error('write denied');localStorage.setItem(key,JSON.stringify(value));testWrites.push(key);};
  window.GM_deleteValue=key=>{if(window.failWrite)throw Error('delete denied');localStorage.removeItem(key);testWrites.push(key);};
  if (!localStorage.getItem('fixtureSeeded')) {
    const now=new Date(); now.setHours(12,0,0,0);const date=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    GM_setValue('watchRecords',[{id:'fixture',date,bvid:'BVfixture',videoTitle:'合成测试视频',uploader:'示例UP',watchedSeconds:1200,durationSeconds:1800,maxPositionSeconds:1600,timestamp:+now,lastActive:+now,sessions:[{startAt:+now,endAt:+now+1200000,watchedSeconds:1200,endReason:'pause'}]}]);
    localStorage.setItem('fixtureSeeded','true');
  }
  </script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
  <script>${source.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
}).listen(18768, '127.0.0.1', () => console.log('Fixture http://127.0.0.1:18768 — synthetic data only'));
