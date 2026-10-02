// ==UserScript==
// @name         Bilibili Watch Panel
// @namespace    https://github.com/Gavin-gwj/bilibili-watch-panel
// @version      0.1.0
// @description  本地B站观看数据统计与可视化面板
// @author       Gavin-gwj
// @match        https://*.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/**
 * Bilibili Watch Panel
 * 本地 B 站个人观看数据统计与可视化面板
 *
 * 合规声明：
 * 1. 只统计本机浏览器中的本人观看行为；
 * 2. 所有数据仅存储在浏览器本地（GM_setValue），绝不联网上传；
 * 3. 只读取 B 站页面已公开加载的数据，不批量爬取、不破解、不触碰付费内容；
 * 4. 不干扰 B 站正常功能与计费体系。
 *
 * 模块分区：
 * ① CONFIG   配置常量
 * ② SELECTORS 选择器集中区
 * ③ Utils    通用工具
 * ④ Store    本地存储
 * ⑤ Collector 数据采集（阶段 3）
 * ⑥ Stats    数据聚合（阶段 4）
 * ⑦ UI       面板界面（阶段 4）
 * ⑧ Report   本周报告（阶段 5）
 * ⑨ Bootstrap 入口初始化
 */

(function () {
  'use strict';

  /* ============================================================
   * ① CONFIG 配置区
   * ============================================================ */
  const CONFIG = {
    /** 心跳间隔（毫秒），每 5 秒累加一次观看时长 */
    HEARTBEAT_MS: 5000,
    /** 面板宽度（像素） */
    PANEL_WIDTH: 380,
    /** 主记录超过该条数时触发归档 */
    ARCHIVE_THRESHOLD: 5000,
    /** 归档后主数组保留条数 */
    ARCHIVE_KEEP: 3000,
    /** 归档数组最大条数 */
    ARCHIVE_MAX: 20000,
    /** 视频信息缓存有效期（毫秒），默认 7 天 */
    VIDEO_CACHE_TTL: 7 * 24 * 60 * 60 * 1000,
    /** 存储写入节流间隔（毫秒），避免每次心跳都写磁盘 */
    SAVE_THROTTLE_MS: 15000,
    /** 单次心跳最多累加的秒数，防止标签页休眠后虚增 */
    MAX_TICK_SECONDS: 10,
    /** 视频信息 API 兜底请求超时（毫秒） */
    API_TIMEOUT_MS: 6000,
    /** 存储 key 统一定义 */
    KEYS: {
      RECORDS: 'watchRecords',
      ARCHIVE: 'watchRecordsArchive',
      VIDEO_CACHE: 'videoInfoCache',
      DEBUG: 'debug',
      SCHEMA: 'schemaVersion',
      REMINDER: 'lastReminderWeek',
    },
    /** 当前数据结构版本 */
    SCHEMA_VERSION: 1,
    /** 主题色 */
    THEME: {
      pink: '#fb7299',
      pinkLight: '#ff9db8',
      pinkLighter: '#ffc0d1',
      pinkDark: '#e05c82',
      pinkDarker: '#b84466',
    },
  };

  /* ============================================================
   * ② SELECTORS 选择器集中区
   * B 站改版时只需修改这里
   * ============================================================ */
  const SELECTORS = {
    /** 视频标题（按优先级依次尝试） */
    title: [
      'h1.video-title',
      '.video-title',
      'h1[title]',
      '#viewbox_report h1',
    ],
    /** UP 主名称 */
    uploader: [
      '.up-name',
      '.up-info-name',
      '.up-info .name',
      'a.up-name',
      '#v_upinfo .up-name',
    ],
    /** UP 主主页链接（用于解析 mid） */
    uploaderLink: [
      '.up-name',
      '.up-info-name a',
      '#v_upinfo a.up-name',
    ],
    /** 页面主视频元素 */
    video: [
      'video',
    ],
  };

  /* ============================================================
   * ③ Utils 通用工具区
   * ============================================================ */

  /** 安全执行，出错仅记录日志，不影响 B 站页面 */
  function safe(fn, label) {
    try {
      return fn();
    } catch (err) {
      logError(label || 'safe', err);
      return undefined;
    }
  }

  /** 调试日志（受 debug 开关控制） */
  function debugEnabled() {
    try {
      return GM_getValue(CONFIG.KEYS.DEBUG, true) !== false;
    } catch (err) {
      return false;
    }
  }

  function log() {
    if (!debugEnabled()) return;
    console.log('[BWP]', ...arguments);
  }

  function logError(label, err) {
    // 错误始终输出，便于排查；不抛出，避免影响页面
    console.warn('[BWP][' + label + ']', err);
  }

  /** 补零 */
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 将 Date 格式化为 YYYY-MM-DD（本地时区） */
  function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 今天的 YYYY-MM-DD */
  function todayStr() {
    return formatDate(new Date());
  }

  /** 将毫秒转换为「x小时y分」可读文本 */
  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + '小时' + m + '分';
    if (m > 0) return m + '分' + (s % 60) + '秒';
    return s + '秒';
  }

  /** ISO 周计算：返回 {year, week}，周一为一周起点 */
  function getIsoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // 周日=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 移到本周周四
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return { year: d.getUTCFullYear(), week: week };
  }

  /** 周标识，如 2026-W40 */
  function weekKey(date) {
    const w = getIsoWeek(date);
    return w.year + '-W' + pad2(w.week);
  }

  /** 返回某天的周一 00:00 */
  function startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay() || 7; // 周一=1 ... 周日=7
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * 包装 history.pushState / replaceState，派发自定义事件。
   * B 站是 SPA，URL 变化没有原生事件，必须自行桥接。
   */
  function wrapHistory() {
    try {
      if (window.__bwpHistoryWrapped) return;
      window.__bwpHistoryWrapped = true;
      ['pushState', 'replaceState'].forEach(function (name) {
        const original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function () {
          const ret = original.apply(this, arguments);
          try {
            window.dispatchEvent(new Event(name === 'pushState' ? 'pushstate' : 'replacestate'));
          } catch (err) { /* 事件派发失败不影响页面 */ }
          return ret;
        };
      });
    } catch (err) {
      logError('wrapHistory', err);
    }
  }

  /** 防抖 */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  /* ============================================================
   * ④ Store 本地存储区
   * 所有 GM_* 调用集中在此，业务层不直接操作
   * ============================================================ */

  /** 判断一条记录结构是否合法 */
  function isValidRecord(r) {
    return !!r && typeof r === 'object'
      && typeof r.id === 'string' && r.id.length > 0
      && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
      && typeof r.bvid === 'string' && r.bvid.length > 0
      && Number.isFinite(r.watchedSeconds) && r.watchedSeconds >= 0
      && Number.isFinite(r.timestamp)
      && Number.isFinite(r.lastActive);
  }

  /** 清洗单条记录，坏数据返回 null */
  function sanitizeRecord(r) {
    if (!isValidRecord(r)) return null;
    return {
      id: r.id,
      date: r.date,
      videoId: typeof r.videoId === 'string' ? r.videoId : '',
      videoTitle: typeof r.videoTitle === 'string' ? r.videoTitle : '',
      uploader: typeof r.uploader === 'string' ? r.uploader : '',
      uploaderId: typeof r.uploaderId === 'string' ? r.uploaderId : '',
      bvid: r.bvid,
      timestamp: r.timestamp,
      watchedSeconds: r.watchedSeconds,
      lastActive: r.lastActive,
      openCount: Number.isFinite(r.openCount) && r.openCount > 0 ? r.openCount : 1,
    };
  }

  const Store = {
    /** 读取主记录，自动过滤坏数据 */
    getRecords() {
      try {
        const raw = GM_getValue(CONFIG.KEYS.RECORDS, []);
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (let i = 0; i < raw.length; i++) {
          const r = sanitizeRecord(raw[i]);
          if (r) out.push(r);
        }
        return out;
      } catch (err) {
        logError('Store.getRecords', err);
        return [];
      }
    },

    /** 写入主记录（带容量控制） */
    setRecords(records) {
      try {
        const list = Array.isArray(records) ? records.filter(isValidRecord) : [];
        GM_setValue(CONFIG.KEYS.RECORDS, list);
        return true;
      } catch (err) {
        logError('Store.setRecords', err);
        return false;
      }
    },

    /** 读取归档 */
    getArchive() {
      try {
        const raw = GM_getValue(CONFIG.KEYS.ARCHIVE, []);
        if (!Array.isArray(raw)) return [];
        return raw.map(sanitizeRecord).filter(Boolean);
      } catch (err) {
        logError('Store.getArchive', err);
        return [];
      }
    },

    /** 写入归档（带容量控制） */
    setArchive(records) {
      try {
        const list = Array.isArray(records) ? records.filter(isValidRecord) : [];
        GM_setValue(CONFIG.KEYS.ARCHIVE, list);
        return true;
      } catch (err) {
        logError('Store.setArchive', err);
        return false;
      }
    },

    /** 清空全部数据 */
    clearAll() {
      try {
        GM_deleteValue(CONFIG.KEYS.RECORDS);
        GM_deleteValue(CONFIG.KEYS.ARCHIVE);
        GM_deleteValue(CONFIG.KEYS.VIDEO_CACHE);
        log('数据已清空');
        return true;
      } catch (err) {
        logError('Store.clearAll', err);
        return false;
      }
    },

    /** 初始化 schema 版本 */
    initSchema() {
      try {
        const v = GM_getValue(CONFIG.KEYS.SCHEMA, 0);
        if (v !== CONFIG.SCHEMA_VERSION) {
          GM_setValue(CONFIG.KEYS.SCHEMA, CONFIG.SCHEMA_VERSION);
        }
      } catch (err) {
        logError('Store.initSchema', err);
      }
    },
  };

  /* ============================================================
   * ⑤ Collector 数据采集区
   * 只统计视频页本机播放行为：/video/ 路径 + <video> 元素
   * ============================================================ */

  /** 从 URL 或页面数据中解析 bvid */
  function parseBvid(url) {
    const m = String(url || location.href).match(/\/(BV[0-9A-Za-z]{10,})/);
    return m ? m[1] : '';
  }

  /** 从 URL 解析 aid（部分老链接为 /video/av12345） */
  function parseAid(url) {
    const m = String(url || location.href).match(/\/video\/av(\d+)/i);
    return m ? m[1] : '';
  }

  /** 解析 B 站 up 主空间链接里的 mid */
  function parseMidFromHref(href) {
    const m = String(href || '').match(/space\.bilibili\.com\/(\d+)/);
    return m ? m[1] : '';
  }

  /** 读取页面自带的 __INITIAL_STATE__ 数据（只读，不发请求） */
  function readInitialState() {
    try {
      const s = window.__INITIAL_STATE__;
      if (!s || typeof s !== 'object') return null;
      const vd = s.videoData || s.videoInfo || null;
      const up = s.upData || s.upInfo || null;
      if (!vd && !up) return null;
      return {
        videoId: vd && (vd.aid || vd.avid) ? String(vd.aid || vd.avid) : '',
        bvid: vd && vd.bvid ? String(vd.bvid) : '',
        videoTitle: vd && (vd.title || vd.videoTitle) ? String(vd.title || vd.videoTitle) : '',
        uploader: up && (up.name || up.uname) ? String(up.name || up.uname) : '',
        uploaderId: up && (up.mid || up.uid) ? String(up.mid || up.uid) : '',
      };
    } catch (err) {
      logError('readInitialState', err);
      return null;
    }
  }

  /** 从 DOM 读取信息（多选择器降级） */
  function readFromDom() {
    function pick(selectorList) {
      for (let i = 0; i < selectorList.length; i++) {
        try {
          const el = document.querySelector(selectorList[i]);
          if (el) return el;
        } catch (err) { /* 单个选择器非法时跳过 */ }
      }
      return null;
    }

    const titleEl = pick(SELECTORS.title);
    const upEl = pick(SELECTORS.uploader);
    const upLinkEl = pick(SELECTORS.uploaderLink);
    return {
      videoTitle: titleEl ? String(titleEl.textContent || titleEl.getAttribute('title') || '').trim() : '',
      uploader: upEl ? String(upEl.textContent || '').trim() : '',
      uploaderId: upLinkEl ? parseMidFromHref(upLinkEl.getAttribute('href') || upLinkEl.href) : '',
      videoId: '',
      bvid: '',
    };
  }

  /** 清洗页面标题：去掉 "视频标题_哔哩哔哩_bilibili" 后缀 */
  function cleanDocumentTitle(title) {
    return String(title || '')
      .replace(/[_\-|]\s*哔哩哔哩\s*[_\-|]?\s*bilibili\s*$/i, '')
      .replace(/[_\-|]\s*bilibili\s*$/i, '')
      .replace(/^\s*【[^】]*】\s*/, '')
      .trim();
  }

  /** 视频信息缓存读写 */
  const VideoCache = {
    getAll() {
      try {
        const raw = GM_getValue(CONFIG.KEYS.VIDEO_CACHE, {});
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      } catch (err) {
        logError('VideoCache.getAll', err);
        return {};
      }
    },

    /** 返回命中的缓存信息，未命中返回 null */
    get(bvid) {
      if (!bvid) return null;
      const cache = this.getAll();
      const item = cache[bvid];
      if (!item || typeof item !== 'object') return null;
      if (!item.expireAt || item.expireAt < Date.now()) return null;
      return item;
    },

    /** 写入缓存，顺带清理已过期条目，避免无限膨胀 */
    set(bvid, info) {
      if (!bvid || !info) return;
      try {
        const cache = this.getAll();
        cache[bvid] = {
          videoId: info.videoId || '',
          videoTitle: info.videoTitle || '',
          uploader: info.uploader || '',
          uploaderId: info.uploaderId || '',
          expireAt: Date.now() + CONFIG.VIDEO_CACHE_TTL,
        };
        const keys = Object.keys(cache);
        if (keys.length > 300) {
          keys.sort(function (a, b) {
            const ea = cache[a] && cache[a].expireAt ? cache[a].expireAt : 0;
            const eb = cache[b] && cache[b].expireAt ? cache[b].expireAt : 0;
            return ea - eb;
          });
          for (let i = 0; i < keys.length - 300; i++) delete cache[keys[i]];
        }
        GM_setValue(CONFIG.KEYS.VIDEO_CACHE, cache);
      } catch (err) {
        logError('VideoCache.set', err);
      }
    },
  };

  /**
   * 解析当前视频信息。
   * 优先级：__INITIAL_STATE__ → DOM → URL 兜底；仅在信息缺失时兜底请求一次 API 并缓存。
   */
  function resolveVideoInfo() {
    const urlBvid = parseBvid(location.href);
    const urlAid = parseAid(location.href);

    let info = { videoId: urlAid, bvid: urlBvid, videoTitle: '', uploader: '', uploaderId: '' };

    const init = readInitialState();
    if (init) {
      info.videoId = init.videoId || info.videoId;
      info.bvid = init.bvid || info.bvid;
      info.videoTitle = init.videoTitle || info.videoTitle;
      info.uploader = init.uploader || info.uploader;
      info.uploaderId = init.uploaderId || info.uploaderId;
    }

    const dom = readFromDom();
    info.videoTitle = info.videoTitle || dom.videoTitle || cleanDocumentTitle(document.title);
    info.uploader = info.uploader || dom.uploader || '';
    info.uploaderId = info.uploaderId || dom.uploaderId || '';
    info.bvid = info.bvid || urlBvid;

    // 缓存命中优先补齐
    const cached = VideoCache.get(info.bvid);
    if (cached) {
      info.videoId = info.videoId || cached.videoId || '';
      info.videoTitle = info.videoTitle || cached.videoTitle || '';
      info.uploader = info.uploader || cached.uploader || '';
      info.uploaderId = info.uploaderId || cached.uploaderId || '';
    }

    // 信息残缺才允许一次 API 兜底（仅在视频页触发，结果缓存）
    if (info.bvid && (!info.videoTitle || !info.uploader) && !cached) {
      const apiUrl = 'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(info.bvid);
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CONFIG.API_TIMEOUT_MS) : null;
      return fetch(apiUrl, { method: 'GET', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (json) {
          const data = json && json.code === 0 && json.data ? json.data : null;
          if (data) {
            info.videoId = info.videoId || (data.aid ? String(data.aid) : '');
            info.videoTitle = info.videoTitle || (data.title ? String(data.title) : '');
            info.uploader = info.uploader || (data.owner && data.owner.name ? String(data.owner.name) : '');
            info.uploaderId = info.uploaderId || (data.owner && data.owner.mid ? String(data.owner.mid) : '');
            VideoCache.set(info.bvid, info);
          }
          return info;
        })
        .catch(function (err) {
          log('视频信息 API 兜底失败，使用页面数据', err && err.message);
          return info;
        })
        .finally(function () { if (timer) clearTimeout(timer); });
    }

    if (info.bvid) VideoCache.set(info.bvid, info);
    return Promise.resolve(info);
  }

  /** 采集器：负责心跳、结算与合并写入 */
  const Collector = {
    active: false,
    videoEl: null,
    videoInfo: null,
    /** 当前会话内累计的秒数（尚未写入的记录） */
    pendingSeconds: 0,
    /** 上次心跳时间戳 */
    lastTickAt: 0,
    /** 上次保存时间戳 */
    lastSaveAt: 0,
    /** 是否允许累加（播放且页面可见） */
    canAccumulate: false,
    /** 是否处于缓冲等待状态 */

    _buffering: false,

    /** 上次心跳时的播放进度（秒），用于按实际推进量计时 */

    _lastCurrentTime: NaN,
    /** 是否已经记录过本次打开 */
    opened: false,
    _timer: null,
    _bound: false,

    /** 判断当前是否为视频详情页 */
    isVideoPage() {
      return /^\/video\//.test(location.pathname);
    },

    /** 启动采集（幂等） */
    start() {
      if (!this.isVideoPage()) return;
      this.stop();
      this.active = true;
      this.videoEl = document.querySelector(SELECTORS.video[0]) || document.querySelector('video');
      this.canAccumulate = !!(this.videoEl && !this.videoEl.paused && !this.videoEl.ended);
      this._buffering = false;
      this.pendingSeconds = 0;
      this.lastTickAt = Date.now();
      this.lastSaveAt = 0;
      this.opened = false;
      this._lastCurrentTime = NaN;

      const self = this;
      resolveVideoInfo().then(function (info) {
        if (!self.active) return;
        self.videoInfo = info;
        log('采集已启动', info);
      }).catch(function (err) {
        logError('Collector.start.resolve', err);
      });

      this.bindEvents();
      this._timer = setInterval(function () { self.tick(); }, CONFIG.HEARTBEAT_MS);
      log('心跳已启动，间隔 ' + CONFIG.HEARTBEAT_MS + 'ms');
    },

    /** 停止采集并结算 */
    stop(save) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      if (this.active && save !== false) this.flush(true);
      this.active = false;
      this.videoEl = null;
      this.videoInfo = null;
      this.pendingSeconds = 0;
      this.canAccumulate = false;
      this._buffering = false;
    },

    /** 绑定播放器与页面生命周期事件（只绑定一次） */
    bindEvents() {
      if (this._bound) return;
      this._bound = true;
      const self = this;

      // 播放状态：以视频元素实际推进为准
      document.addEventListener('play', function () {
        const v = self.videoEl || document.querySelector('video');
        self.videoEl = v;
        self.lastTickAt = Date.now();
        self._lastCurrentTime = v && Number.isFinite(v.currentTime) ? v.currentTime : NaN;
        self._buffering = false;
        self.canAccumulate = true;
      }, true);
      document.addEventListener('pause', function () {
        self.settleTick();
        self.canAccumulate = false;
        self.flush(true);
      }, true);
      document.addEventListener('ended', function () {
        self.settleTick();
        self.canAccumulate = false;
        self.flush(true);
      }, true);
      document.addEventListener('waiting', function () {
        self._buffering = true;
        self.canAccumulate = false;
      }, true);
      document.addEventListener('playing', function () {
        const v = self.videoEl || document.querySelector('video');
        self.videoEl = v;
        self.lastTickAt = Date.now();
        self._lastCurrentTime = v && Number.isFinite(v.currentTime) ? v.currentTime : NaN;
        self._buffering = false;
        self.canAccumulate = true;
      }, true);

      // 切后台立即停止累加并保存
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.canAccumulate = false;
          self.flush(true);
        } else {
          self.settleTick();
          self.lastTickAt = Date.now();
          const v = self.videoEl || document.querySelector('video');
          self.videoEl = v;
          self.canAccumulate = !!(v && !v.paused && !v.ended && !self._buffering);
        }
      });

      // 页面关闭前最终结算
      window.addEventListener('pagehide', function () { self.flush(true); });
      window.addEventListener('beforeunload', function () { self.flush(true); });

      // B 站是 SPA，URL 变化时重建采集会话
      let lastHref = location.href;
      const onUrlChange = debounce(function () {
        if (location.href === lastHref) return;
        lastHref = location.href;
        log('URL 变化，重建采集会话', location.href);
        ensureCollector();
      }, 500);
      window.addEventListener('popstate', onUrlChange);
      window.addEventListener('pushstate', onUrlChange);
      window.addEventListener('replacestate', onUrlChange);
      setInterval(onUrlChange, 2000);

      log('采集事件已绑定');
    },

    /** 记录一次"打开"：同天同视频 openCount +1 */
    recordOpen() {
      if (!this.videoInfo || !this.videoInfo.bvid) return;
      this.opened = true;
      const date = todayStr();
      const records = Store.getRecords();
      const idx = findRecordIndex(records, date, this.videoInfo.bvid);
      if (idx >= 0) {
        records[idx].openCount = (Number(records[idx].openCount) || 1) + 1;
        records[idx].lastActive = Date.now();
        if (this.videoInfo.videoTitle) records[idx].videoTitle = this.videoInfo.videoTitle;
        if (this.videoInfo.uploader) records[idx].uploader = this.videoInfo.uploader;
        if (this.videoInfo.uploaderId) records[idx].uploaderId = this.videoInfo.uploaderId;
        if (this.videoInfo.videoId) records[idx].videoId = this.videoInfo.videoId;
      } else {
        records.push({
          id: date + '_' + this.videoInfo.bvid,
          date: date,
          videoId: this.videoInfo.videoId || '',
          videoTitle: this.videoInfo.videoTitle || '',
          uploader: this.videoInfo.uploader || '',
          uploaderId: this.videoInfo.uploaderId || '',
          bvid: this.videoInfo.bvid,
          timestamp: Date.now(),
          watchedSeconds: 0,
          lastActive: Date.now(),
          openCount: 1,
        });
      }
      Store.setRecords(records);
      log('已记录打开', date, this.videoInfo.bvid);
    },

    /** 暂停/结束时结算一次：把上次心跳到当前时刻的播放时长计入 */
    settleTick() {
      if (!this.active || !this.videoInfo) return;
      const now = Date.now();
      const video = this.videoEl || document.querySelector('video');
      this.videoEl = video;
      if (this.canAccumulate && video && !this._buffering) {
        const ctDelta = Number.isFinite(this._lastCurrentTime) && Number.isFinite(video.currentTime)
          ? Math.max(0, video.currentTime - this._lastCurrentTime)
          : 0;
        const delta = Math.min(ctDelta, CONFIG.HEARTBEAT_MS / 1000, CONFIG.MAX_TICK_SECONDS);
        if (delta > 0) this.pendingSeconds += delta;
      }
      this._lastCurrentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : NaN;
      this.lastTickAt = now;
      this.canAccumulate = false;
    },

    /**
     * 5 秒心跳：以 video.currentTime 实际推进量为准。
     * 只有真正播放才累加，暂停/切后台/休眠不会虚增。
     */
    tick() {
      if (!this.active || !this.videoInfo) return;
      try {
        const now = Date.now();
        const video = this.videoEl || document.querySelector('video');
        this.videoEl = video;
        if (!video) { this.lastTickAt = now; return; }
        // 脚本可能在播放中途注入，播放中但标志未同步时自动恢复
        if (!video.paused && !video.ended && !this._buffering && !this.canAccumulate) {
          this.canAccumulate = true;
        }
        if (!this.canAccumulate || this._buffering || document.hidden || video.paused || video.ended || video.readyState < 2) {
          this.lastTickAt = now;
          return;
        }
        // 第一次心跳只建立播放进度基准，保证后续只统计真实推进量
        if (!Number.isFinite(this._lastCurrentTime)) {
          this._lastCurrentTime = Number.isFinite(video.currentTime) ? video.currentTime : NaN;
          this.lastTickAt = now;
          if (!this.opened) this.recordOpen();
          return;
        }
        const ctDelta = Math.max(0, video.currentTime - this._lastCurrentTime);
        const delta = Math.min(ctDelta, CONFIG.HEARTBEAT_MS / 1000, CONFIG.MAX_TICK_SECONDS);
        this.lastTickAt = now;
        if (!this.opened) this.recordOpen();
        this.pendingSeconds += delta;
        this._lastCurrentTime = video.currentTime;
        log('心跳累加 +' + delta.toFixed(1) + 's，待写入 ' + this.pendingSeconds.toFixed(1) + 's');

        if (now - this.lastSaveAt >= CONFIG.SAVE_THROTTLE_MS) this.flush(false);
      } catch (err) {
        logError('Collector.tick', err);
      }
    },

    /** 结算并写入存储；saveThrottle 为 true 时受节流限制 */
    flush(force) {
      if (!this.active && !this.pendingSeconds) return;
      if (!this.videoInfo || !this.videoInfo.bvid) return;
      if (this.pendingSeconds <= 0) return;
      const now = Date.now();
      if (!force && now - this.lastSaveAt < CONFIG.SAVE_THROTTLE_MS) return;

      try {
        const seconds = this.pendingSeconds;
        this.pendingSeconds = 0;
        this.lastSaveAt = now;
        mergeWatchedSeconds(this.videoInfo, seconds, now);
      } catch (err) {
        logError('Collector.flush', err);
      }
    },
  };

  /** 在记录数组中查找「日期 + bvid」的位置 */
  function findRecordIndex(records, date, bvid) {
    for (let i = 0; i < records.length; i++) {
      if (records[i].date === date && records[i].bvid === bvid) return i;
    }
    return -1;
  }

  /**
   * 把观看秒数合并进记录。
   * 跨零点时按当天边界拆分，保证两天各记一条。
   */
  function mergeWatchedSeconds(info, seconds, endAt) {
    if (!info || !info.bvid || !(seconds > 0)) return;
    const end = new Date(endAt);
    const startAt = endAt - seconds * 1000;
    const start = new Date(startAt);
    const sameDay = formatDate(start) === formatDate(end);

    if (sameDay) {
      applySeconds(formatDate(end), info, seconds, endAt);
      return;
    }
    const midnight = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0).getTime();
    const before = Math.max(0, (midnight - startAt) / 1000);
    const after = Math.max(0, (endAt - midnight) / 1000);
    if (before > 0) applySeconds(formatDate(start), info, before, midnight - 1);
    if (after > 0) applySeconds(formatDate(end), info, after, endAt);
  }

  /** 单日单条记录秒数累加（同天同视频合并） */
  function applySeconds(date, info, seconds, activeAt) {
    const records = Store.getRecords();
    const idx = findRecordIndex(records, date, info.bvid);
    if (idx >= 0) {
      records[idx].watchedSeconds = (Number(records[idx].watchedSeconds) || 0) + seconds;
      records[idx].lastActive = activeAt;
      if (info.videoTitle) records[idx].videoTitle = info.videoTitle;
      if (info.uploader) records[idx].uploader = info.uploader;
      if (info.uploaderId) records[idx].uploaderId = info.uploaderId;
      if (info.videoId) records[idx].videoId = info.videoId;
      if (!Number.isFinite(records[idx].openCount) || records[idx].openCount < 1) records[idx].openCount = 1;
    } else {
      records.push({
        id: date + '_' + info.bvid,
        date: date,
        videoId: info.videoId || '',
        videoTitle: info.videoTitle || '',
        uploader: info.uploader || '',
        uploaderId: info.uploaderId || '',
        bvid: info.bvid,
        timestamp: activeAt,
        watchedSeconds: seconds,
        lastActive: activeAt,
        openCount: 1,
      });
    }
    Store.setRecords(records);
    log('已写入观看时长', date, info.bvid, seconds.toFixed(1) + 's');
    // 容量控制：达到阈值时归档旧记录，保持面板与存储轻量
    if (records.length > CONFIG.ARCHIVE_THRESHOLD) archiveIfNeeded();
  }

  /** 容量控制：主数组超过阈值时把旧记录移入归档 */
  function archiveIfNeeded() {
    try {
      const records = Store.getRecords();
      if (records.length <= CONFIG.ARCHIVE_THRESHOLD) return;
      records.sort(function (a, b) { return (b.lastActive || 0) - (a.lastActive || 0); });
      const keep = records.slice(0, CONFIG.ARCHIVE_KEEP);
      const moveOut = records.slice(CONFIG.ARCHIVE_KEEP);
      const archive = Store.getArchive().concat(moveOut);
      archive.sort(function (a, b) { return (b.lastActive || 0) - (a.lastActive || 0); });
      Store.setRecords(keep);
      Store.setArchive(archive.slice(0, CONFIG.ARCHIVE_MAX));
      log('归档完成：主 ' + keep.length + ' 条，归档 ' + Math.min(archive.length, CONFIG.ARCHIVE_MAX) + ' 条');
    } catch (err) {
      logError('archiveIfNeeded', err);
    }
  }

  /* ============================================================
   * ⑥ Stats 数据聚合区
   * 阶段 4 实现
   * ============================================================ */

  /* ============================================================
   * ⑦ UI 面板区
   * 阶段 4 实现
   * ============================================================ */

  /* ============================================================
   * ⑧ Report 本周报告区
   * 阶段 5 实现
   * ============================================================ */

  /* ============================================================
   * ⑨ Bootstrap 入口
   * ============================================================ */

  /** SPA 路由守护：根据当前路径自动启停采集 */
  function ensureCollector() {
    if (Collector.isVideoPage()) {
      if (!Collector.active) Collector.start();
    } else if (Collector.active) {
      Collector.stop(true);
    }
  }

  /** 入口初始化 */
  function bootstrap() {
    safe(function () {
      Store.initSchema();
      wrapHistory();
      log('脚本已加载，版本 0.1.0', location.href);

      // 阶段 3：仅视频页启用采集（SPA 路由切换由守护定时器处理）
      safe(function () { ensureCollector(); }, 'ensureCollector');
      safe(function () { archiveIfNeeded(); }, 'archiveIfNeeded');
      setInterval(function () {
        safe(function () { ensureCollector(); }, 'ensureCollector.tick');
      }, 2000);

      // 阶段 4/5 将在此接入 UI 与报告
    }, 'bootstrap');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();