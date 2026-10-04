// Local synthetic fixture: never reads a real Tampermonkey profile or personal records.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sourcePath = path.join(__dirname, '..', 'bilibili-watch-panel.user.js');
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const source = fs.readFileSync(sourcePath, 'utf8').replace("  if (document.readyState === 'loading') {", "  window.testApi = { CONFIG, Store, Panel, Stats, Collector, buildMediaKey, sanitizeRecord, resolveVideoInfo, maybeShowWeeklyReminder };\n  if (document.readyState === 'loading') {");
  const url = new URL(req.url, 'http://127.0.0.1:18768');
  const pathname = url.pathname;
  let pageKind = 'video';
  let prelude = '';
  if (/^\/bangumi\/play\//.test(pathname)) {
    pageKind = 'bangumi';
    const bangumiJson = '{"status":200,"data":{"result":{"video_info":{"timelength":1493182,"dash":{"duration":1494}},"arc":{"aid":710444604,"cid":26835486927,"bvid":"BV1PQ4y1N7V8"},"supplement":{"ogv_episode_info":{"episode_id":321808,"index_title":"1","long_title":"云霄飞车杀人事件"},"ogv_season_info":{"season_id":33378}}}}}';
    prelude = '<script>const playurlSSRData = ' + bangumiJson + ';window.__PLAYURL_HYDRATE_DATA__=' + bangumiJson + ';</script>';
  } else if (/^\/cheese\/play\//.test(pathname)) {
    pageKind = 'cheese';
    prelude = '<script>window.__EduPlayPiniaState__="' + JSON.stringify(JSON.stringify({ index: { viewInfo: { title: '斯坦福大学《人生设计课》读书会', season_id: 37081, ep_count: 31, up_info: { mid: 404801960, uname: '我是宋超' } }, currentEp: { id: 1209625, aid: 113407537710579, cid: 26565414318, duration: 681, title: '第六节｜设计思维的5种基本心态', index: 6 } } })).slice(1, -1) + '";</script>';
  } else {
    pageKind = 'video';
    prelude = '<script>window.__INITIAL_STATE__={"p":2,"videoData":{"aid":80433022,"bvid":"BV1GJ411x7h7","title":"合成多P视频","duration":213,"videos":3,"pages":[{"page":1,"part":"第一集","duration":100},{"page":2,"part":"第二集","duration":110},{"page":3,"part":"第三集","duration":120}]},"upData":{"mid":486906719,"name":"示例UP"}};</script>';
  }
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>v0.9 隔离验收 · ${pageKind}</title>${prelude}</head><body>
  <h1>v0.9 合成数据测试页（${pageKind}）</h1><video></video><input aria-label="页面输入框"><div contenteditable="true">可编辑区域</div>
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
