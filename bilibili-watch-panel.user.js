// ==UserScript==
// @name         Bilibili Watch Panel
// @namespace    https://github.com/Gavin-gwj/bilibili-watch-panel
// @version      0.2.1
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
    /** 当前会话标识（URL + bvid），避免守护定时器重复重启 */
    _sessionKey: '',

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
      this._sessionKey = location.pathname + location.search;

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
   * 只做纯计算，不涉及 DOM 与网络
   * ============================================================ */

  /** 求和工具 */
  function sumSeconds(list) {
    return (list || []).reduce(function (acc, r) {
      const v = Number(r && r.watchedSeconds);
      return acc + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }

  /** 按 UP 主聚合：返回 [{name, seconds, count}]，按时长倒序 */
  function groupByUploader(list) {
    const map = Object.create(null);
    (list || []).forEach(function (r) {
      const name = (r && r.uploader) ? String(r.uploader) : '未知UP主';
      if (!map[name]) map[name] = { name: name, seconds: 0, count: 0 };
      map[name].seconds += Number(r.watchedSeconds) || 0;
      map[name].count += Math.max(1, Number(r.openCount) || 1);
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.seconds - a.seconds; });
  }

  /** 近 N 天（含今天）的日期字符串数组，从早到晚 */
  function recentDates(days, endDate) {
    const end = endDate || new Date();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      out.push(formatDate(d));
    }
    return out;
  }

  /** 判断记录日期是否落在某个日期所在的 ISO 周（周一起） */
  function isSameIsoWeek(dateStr, baseDate) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return weekKey(d) === weekKey(baseDate);
    } catch (err) {
      return false;
    }
  }

  /** 观看时段划分：凌晨 / 上午 / 下午 / 晚上 */
  const TIME_SLOTS = [
    { name: '凌晨', from: 0, to: 6 },
    { name: '上午', from: 6, to: 12 },
    { name: '下午', from: 12, to: 18 },
    { name: '晚上', from: 18, to: 24 },
  ];

  const Stats = {
    /** 全部记录（主数组 + 归档） */
    allRecords() {
      return Store.getRecords().concat(Store.getArchive());
    },

    /** 今日汇总 */
    today() {
      const date = todayStr();
      const list = Store.getRecords().filter(function (r) { return r.date === date; });
      return {
        date: date,
        seconds: sumSeconds(list),
        count: list.length,
        byUploader: groupByUploader(list),
      };
    },

    /** 近 7 天趋势 + 本周（周一起）Top5 UP 主 */
    week() {
      const records = Store.getRecords();
      const dates = recentDates(7);
      const daily = dates.map(function (d) {
        const list = records.filter(function (r) { return r.date === d; });
        return { date: d, label: d.slice(5), seconds: sumSeconds(list) };
      });
      const weekRecords = records.filter(function (r) { return isSameIsoWeek(r.date, new Date()); });
      return {
        daily: daily,
        totalSeconds: daily.reduce(function (a, d) { return a + d.seconds; }, 0),
        topUploaders: groupByUploader(weekRecords).slice(0, 5),
        weekKey: weekKey(new Date()),
      };
    },

    /** 全部汇总 */
    all() {
      const list = this.allRecords();
      const uploaders = Object.create(null);
      list.forEach(function (r) { uploaders[r.uploader || '未知UP主'] = 1; });
      const recent = list.slice()
        .sort(function (a, b) { return (b.lastActive || 0) - (a.lastActive || 0); })
        .slice(0, 20);
      return {
        seconds: sumSeconds(list),
        count: list.length,
        uploaderCount: Object.keys(uploaders).length,
        recent: recent,
      };
    },

    /** 本周报告数据（周一为一周起点） */
    report() {
      const records = Store.getRecords();
      const now = new Date();
      const weekRecords = records.filter(function (r) { return isSameIsoWeek(r.date, now); });
      const start = startOfWeek(now);
      const dates = [];
      for (let i = 0; i < 7; i++) {
        dates.push(formatDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
      }
      const daily = dates.map(function (d) {
        const list = weekRecords.filter(function (r) { return r.date === d; });
        return { date: d, label: d.slice(5), seconds: sumSeconds(list) };
      });
      const slots = TIME_SLOTS.map(function (s) {
        let sec = 0;
        weekRecords.forEach(function (r) {
          const h = new Date(r.lastActive || r.timestamp || Date.now()).getHours();
          if (h >= s.from && h < s.to) sec += Number(r.watchedSeconds) || 0;
        });
        return { name: s.name, seconds: sec };
      }).sort(function (a, b) { return b.seconds - a.seconds; });
      const top = groupByUploader(weekRecords).slice(0, 5);
      const peak = slots[0] && slots[0].seconds > 0 ? slots[0].name : '';
      const fav = top[0] ? top[0].name : '';
      let summary = '本周还没有观看记录，去 B 站看个视频吧～';
      if (weekRecords.length > 0) {
        summary = '本周共看 ' + weekRecords.length + ' 个视频，'
          + (peak ? '最常在' + peak + '打开B站' : '观看时段较分散')
          + (fav ? '，最爱「' + fav + '」' : '') + '。';
      }
      return {
        weekKey: weekKey(now),
        totalSeconds: sumSeconds(weekRecords),
        totalVideos: weekRecords.length,
        topUploaders: top,
        daily: daily,
        slots: slots,
        peakSlot: peak,
        summary: summary,
      };
    },
  };


  /* ============================================================
   * ⑦ UI 面板区
   * 全部 UI 挂在 Shadow DOM，避免与 B 站样式互相污染
   * ============================================================ */

  /** 图表色板：B 站粉及近似色系 */
  const CHART_COLORS = ['#fb7299', '#ffb0c9', '#e05c82', '#ffd6e2', '#b84466', '#f7a2bb', '#c9ccd1'];

  /** 面板 HTML 与样式模板（视觉层：设计令牌 + 组件样式 + 结构） */
  const PANEL_HTML = [
    '<style>',
    ':host { all: initial; }',
    ':host, * { box-sizing: border-box; }',
    '* { font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }',
    /* ---------- 浮动按钮 ---------- */
    '.bwp-fab {',
    '  position: fixed; z-index: 2147483000; cursor: grab; touch-action: none;',
    '  width: 48px; height: 48px; padding: 0; border: none; border-radius: 16px;',
    '  display: flex; align-items: center; justify-content: center;',
    '  background: linear-gradient(140deg,#ff8fb1 0%,#fb7299 55%,#e8578a 100%);',
    '  color: #fff; box-shadow: 0 6px 18px rgba(251,114,153,.42), 0 2px 6px rgba(184,68,102,.28);',
    '  transition: transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .22s ease;',
    '}',
    '.bwp-fab svg { width: 22px; height: 22px; display: block; pointer-events: none; }',
    '.bwp-fab::after { content: ""; position: absolute; inset: -5px; border-radius: 21px; border: 1px solid rgba(251,114,153,.4); opacity: 0; transition: opacity .22s ease; }',
    '.bwp-fab:hover { transform: translateY(-1px) scale(1.06); box-shadow: 0 10px 26px rgba(251,114,153,.5), 0 2px 8px rgba(184,68,102,.3); }',
    '.bwp-fab:hover::after { opacity: 1; }',
    '.bwp-fab:active { transform: scale(.94); }',
    /* ---------- 焦点态（可访问性） ---------- */
    '.bwp-fab:focus-visible, .bwp-close:focus-visible, .bwp-tab:focus-visible, .bwp-btn:focus-visible { outline: 2px solid rgba(251,114,153,.55); outline-offset: 2px; }',
    /* ---------- 抽屉面板 ---------- */
    '.bwp-panel {',
    '  position: fixed; top: 0; right: 0; z-index: 2147483001;',
    '  width: 380px; max-width: 96vw; height: 100vh;',
    '  display: flex; flex-direction: column;',
    '  background: linear-gradient(180deg,#ffffff 0%,#fffafc 100%);',
    '  border-left: 1px solid rgba(251,114,153,.14); border-radius: 20px 0 0 20px;',
    '  box-shadow: -10px 0 40px rgba(97,102,109,.16), -2px 0 8px rgba(97,102,109,.06);',
    '  transform: translateX(105%); transition: transform .32s cubic-bezier(.32,.72,0,1);',
    '  color: #18191c; overflow: hidden;',
    '}',
    '.bwp-panel.open { transform: translateX(0); }',
    /* ---------- 头部 ---------- */
    '.bwp-header { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 16px 17px; color: #fff; overflow: hidden; background: linear-gradient(135deg,#ff85ab 0%,#fb7299 45%,#ef5f8d 100%); }',
    '.bwp-header::before { content: ""; position: absolute; right: -70px; top: -110px; width: 180px; height: 180px; border-radius: 50%; background: rgba(255,255,255,.18); }',
    '.bwp-header::after { content: ""; position: absolute; left: -50px; bottom: -90px; width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,.12); }',
    '.bwp-brand { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }',
    '.bwp-logo { flex: none; width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3); }',
    '.bwp-logo svg { width: 18px; height: 18px; }',
    '.bwp-brand-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
    '.bwp-title { font-size: 14.5px; font-weight: 600; line-height: 1.2; letter-spacing: .01em; }',
    '.bwp-subtitle { font-size: 10.5px; letter-spacing: .03em; color: rgba(255,255,255,.82); }',
    '.bwp-close { position: relative; z-index: 1; flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 10px; background: rgba(255,255,255,.16); color: #fff; font-size: 18px; line-height: 1; cursor: pointer; transition: background .2s ease, transform .25s ease; }',
    '.bwp-close:hover { background: rgba(255,255,255,.3); transform: rotate(90deg); }',
    /* ---------- 分段式 Tab ---------- */
    '.bwp-tabs { display: flex; gap: 4px; margin: 14px 14px 0; padding: 4px; background: #f5f5f7; border-radius: 13px; }',
    '.bwp-tab { flex: 1; padding: 8px 0; border: none; border-radius: 10px; background: transparent; color: #61666d; font-size: 12.5px; font-weight: 500; text-align: center; cursor: pointer; transition: color .2s ease, background .2s ease, box-shadow .2s ease; }',
    '.bwp-tab:hover { color: #fb7299; }',
    '.bwp-tab.active { background: #fff; color: #e8578a; font-weight: 600; box-shadow: 0 2px 8px rgba(97,102,109,.12); }',
    /* ---------- 内容区 ---------- */
    '.bwp-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px 16px 20px; scrollbar-width: thin; scrollbar-color: #ffd0dd transparent; }',
    '.bwp-body::-webkit-scrollbar { width: 6px; }',
    '.bwp-body::-webkit-scrollbar-thumb { background: #ffd0dd; border-radius: 3px; }',
    '.bwp-body::-webkit-scrollbar-track { background: transparent; }',
    '.bwp-cards { display: flex; gap: 10px; margin-bottom: 14px; }',
    '.bwp-card { position: relative; flex: 1; min-width: 0; padding: 13px 13px 12px; border-radius: 15px; border: 1px solid rgba(251,114,153,.16); background: linear-gradient(160deg,#ffffff 0%,#fff5f8 100%); box-shadow: 0 4px 14px rgba(251,114,153,.08); overflow: hidden; }',
    '.bwp-card::before { content: ""; position: absolute; left: 13px; top: 0; width: 26px; height: 3px; border-radius: 0 0 3px 3px; background: linear-gradient(90deg,#fb7299,#ff9db8); }',
    '.bwp-card .num { font-size: 21px; font-weight: 700; line-height: 1.15; letter-spacing: -.01em; color: #e8578a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.bwp-card .lbl { margin-top: 5px; font-size: 11.5px; color: #9499a0; }',
    '.bwp-card.compact .num { font-size: 15px; letter-spacing: .01em; }',
    '.bwp-cards-3 .bwp-card { padding: 12px 11px; }',
    '.bwp-cards-3 .bwp-card .num { font-size: 17px; }',
    '.bwp-sub { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; font-size: 12px; font-weight: 600; color: #61666d; letter-spacing: .02em; }',
    '.bwp-sub::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: linear-gradient(180deg,#fb7299,#ff9db8); }',
    '.bwp-chart { position: relative; height: 200px; margin-bottom: 16px; padding: 10px 6px 4px; background: #fff; border: 1px solid #f2f3f5; border-radius: 15px; box-shadow: 0 2px 10px rgba(97,102,109,.05); }',
    '.bwp-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 46px 16px; text-align: center; font-size: 12.5px; color: #9499a0; }',
    '.bwp-empty .dot { display: flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 20px; color: #fb7299; background: linear-gradient(160deg,#fff0f5,#ffe4ee); border: 1px solid rgba(251,114,153,.18); box-shadow: 0 8px 20px rgba(251,114,153,.14); }',
    '.bwp-empty .dot svg { width: 26px; height: 26px; }',
    '.bwp-list { display: flex; flex-direction: column; gap: 9px; }',
    '.bwp-item { padding: 10px 12px; border-radius: 13px; background: #fff; border: 1px solid #f0f1f3; box-shadow: 0 1px 4px rgba(97,102,109,.04); transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }',
    '.bwp-item:hover { transform: translateY(-1px); border-color: #ffdce8; box-shadow: 0 6px 16px rgba(251,114,153,.12); }',
    '.bwp-item .t { font-size: 12.5px; font-weight: 600; line-height: 1.45; color: #18191c; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.bwp-item .m { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 10.5px; color: #9499a0; }',
    '.bwp-item .m span:first-child { color: #e8578a; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.bwp-item .m span:last-child { flex: none; }',
    /* ---------- 底部操作 ---------- */
    '.bwp-footer { display: flex; gap: 9px; padding: 12px 16px 14px; border-top: 1px solid #f0f1f3; background: rgba(255,255,255,.92); }',
    '.bwp-btn { flex: 1; padding: 9px 0; border: 1px solid transparent; border-radius: 11px; font-size: 12px; font-weight: 600; cursor: pointer; color: #fff; background: linear-gradient(135deg,#ff8fb1,#fb7299); box-shadow: 0 4px 12px rgba(251,114,153,.28); transition: transform .18s ease, box-shadow .18s ease, background .18s ease, color .18s ease; }',
    '.bwp-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(251,114,153,.36); }',
    '.bwp-btn:active { transform: translateY(0) scale(.99); }',
    '.bwp-btn.danger { background: #fff; color: #e05c82; border-color: #ffd6e2; box-shadow: none; }',
    '.bwp-btn.danger:hover { background: #fff5f8; box-shadow: 0 4px 12px rgba(251,114,153,.14); }',
    /* ---------- 卡片错峰入场动效 ---------- */
    '@keyframes bwp-rise { from { opacity: 0; transform: translateY(9px) scale(.985); } to { opacity: 1; transform: none; } }',
    '.bwp-anim { animation: bwp-rise .36s cubic-bezier(.22,.9,.3,1) backwards; animation-delay: calc(var(--bwp-i, 0) * 46ms); }',
    '@keyframes bwp-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }',
    '.bwp-rp-bar i { transform-origin: left center; animation: bwp-bar .52s cubic-bezier(.22,.9,.3,1) backwards; }',
    '.bwp-empty .dot { animation: bwp-rise .4s cubic-bezier(.22,.9,.3,1) backwards; }',
    '@media (prefers-reduced-motion: reduce) { .bwp-anim, .bwp-empty .dot, .bwp-toast, .bwp-rp-bar i { animation: none; } }',
    /* ---------- 小屏适配与动效偏好 ---------- */
    '@media (max-width: 480px) { .bwp-panel { width: 100vw; max-width: 100vw; border-radius: 0; } .bwp-tabs { margin: 12px 12px 0; } .bwp-body { padding: 14px 12px 18px; } .bwp-cards-3 .bwp-card .num { font-size: 15.5px; } .bwp-cards-3 .bwp-card { padding: 11px 9px; } }',
    '@media (prefers-reduced-motion: reduce) { .bwp-fab, .bwp-panel, .bwp-tab, .bwp-btn, .bwp-item, .bwp-close { transition: none; } .bwp-close:hover { transform: none; } }',
    '</style>',
    '<button class="bwp-fab" title="B站观看数据面板" aria-label="打开B站观看数据面板">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M2 20h20"/></svg>',
    '</button>',
    '<aside class="bwp-panel" role="dialog" aria-label="B站观看数据面板">',
    '  <header class="bwp-header">',
    '    <div class="bwp-brand">',
    '      <span class="bwp-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l5-6 4 4 6-8"/><path d="M3 21h18"/></svg></span>',
    '      <span class="bwp-brand-text">',
    '        <span class="bwp-title">B站观看数据</span>',
    '        <span class="bwp-subtitle">仅存本机 · 不上传</span>',
    '      </span>',
    '    </div>',
    '    <button class="bwp-close" title="关闭" aria-label="关闭面板">×</button>',
    '  </header>',
    '  <nav class="bwp-tabs"></nav>',
    '  <div class="bwp-body"></div>',
    '  <footer class="bwp-footer">',
    '    <button class="bwp-btn" data-act="export">导出 JSON</button>',
    '    <button class="bwp-btn danger" data-act="clear">清空数据</button>',
    '  </footer>',
    '</aside>',
  ].join('\n');

  const Panel = {
    host: null,
    root: null,
    el: {},
    charts: {},
    current: '今日',
    open: false,
    mounted: false,

    /** 挂载面板到页面（幂等） */
    mount() {
      if (this.mounted && this.host && document.documentElement.contains(this.host)) return;
      try {
        const old = document.getElementById('bwp-host');
        if (old) old.remove();

        const host = document.createElement('div');
        host.id = 'bwp-host';
        // 宿主本身不占位，交互交给 Shadow DOM 内部元素
        host.style.cssText = 'all:initial;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = PANEL_HTML;

        this.host = host;
        this.root = root;
        this.el.fab = root.querySelector('.bwp-fab');
        this.el.panel = root.querySelector('.bwp-panel');
        this.el.close = root.querySelector('.bwp-close');
        this.el.tabs = root.querySelector('.bwp-tabs');
        this.el.body = root.querySelector('.bwp-body');
        this.el.footer = root.querySelector('.bwp-footer');

        // 注入报告与提醒样式（同处 Shadow DOM，保证导出与展示一致）
        const extra = document.createElement('style');
        extra.textContent = (typeof REPORT_CSS === 'string' ? REPORT_CSS : '') + '\n' + (typeof TOAST_CSS === 'string' ? TOAST_CSS : '');
        root.appendChild(extra);

        this.el.fab.style.left = (window.innerWidth - 64) + 'px';
        this.el.fab.style.top = '72px';
        this.buildTabs();
        this.bind();
        document.body.appendChild(host);
        this.mounted = true;
        log('面板已挂载');
      } catch (err) {
        logError('Panel.mount', err);
      }
    },

    /** 构建 Tab 按钮 */
    buildTabs() {
      const self = this;
      const tabs = this.tabList();
      this.el.tabs.innerHTML = '';
      tabs.forEach(function (name) {
        const btn = document.createElement('button');
        btn.className = 'bwp-tab';
        btn.textContent = name;
        btn.dataset.tab = name;
        btn.addEventListener('click', function () { self.switchTab(name); });
        self.el.tabs.appendChild(btn);
      });
      this.syncTabs();
    },

    /** Tab 列表：阶段 5 会追加「报告」 */
    tabList() {
      return ['今日', '本周', '全部', '报告'];
    },

    /** 同步 Tab 高亮 */
    syncTabs() {
      const self = this;
      Array.prototype.forEach.call(this.el.tabs.querySelectorAll('.bwp-tab'), function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === self.current);
      });
    },

    /** 绑定交互事件 */
    bind() {
      const self = this;
      this.el.fab.addEventListener('click', function () { self.toggle(); });
      this.el.close.addEventListener('click', function () { self.hide(); });
      this.el.footer.addEventListener('click', function (e) {
        const act = e.target && e.target.dataset ? e.target.dataset.act : '';
        if (act === 'export') self.exportJSON();
        if (act === 'clear') self.clearAll();
      });
      // ESC 关闭
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.open) self.hide();
      });
      // 浮动按钮拖动（位置持久化，关闭按钮固定不动）
      this.bindFabDrag();
    },

    /** 浮动按钮拖拽：拖动结束后吸附到最近的左右边缘 */
    bindFabDrag() {
      const fab = this.el.fab;
      if (!fab) return;
      const self = this;
      let dragging = false, moved = false, startX = 0, startY = 0;
      try {
        const saved = GM_getValue('fabPos', null);
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) self.placeFab(saved.x, saved.y);
      } catch (err) { /* 位置读取失败用默认值 */ }

      fab.addEventListener('pointerdown', function (e) {
        dragging = true; moved = false;
        startX = e.clientX - fab.offsetLeft;
        startY = e.clientY - fab.offsetTop;
        fab.style.cursor = 'grabbing';
        if (fab.setPointerCapture) { try { fab.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
      });
      fab.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        if (Math.abs(e.clientX - (startX + fab.offsetLeft)) > 4 || Math.abs(e.clientY - (startY + fab.offsetTop)) > 4) moved = true;
        self.placeFab(e.clientX - startX, e.clientY - startY);
      });
      fab.addEventListener('pointerup', function () {
        dragging = false;
        fab.style.cursor = 'grab';
        if (!moved) return;
        // 吸附到最近的左右边缘
        const left = fab.offsetLeft < (window.innerWidth - fab.offsetWidth) / 2;
        const x = left ? 12 : window.innerWidth - fab.offsetWidth - 12;
        const y = Math.min(Math.max(fab.offsetTop, 60), window.innerHeight - fab.offsetHeight - 12);
        self.placeFab(x, y, true);
        fab.dataset.dragged = '1';
      });
      // 拖动后不触发点击开关
      fab.addEventListener('click', function (e) {
        if (fab.dataset.dragged === '1') { e.stopImmediatePropagation(); fab.dataset.dragged = ''; }
      }, true);
    },

    /** 设置浮动按钮位置并持久化 */
    placeFab(x, y, persist) {
      const fab = this.el.fab;
      if (!fab) return;
      const maxX = Math.max(0, window.innerWidth - fab.offsetWidth - 4);
      const maxY = Math.max(0, window.innerHeight - fab.offsetHeight - 4);
      const nx = Math.min(Math.max(0, x), maxX);
      const ny = Math.min(Math.max(0, y), maxY);
      fab.style.left = nx + 'px';
      fab.style.top = ny + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      if (persist) {
        try { GM_setValue('fabPos', { x: nx, y: ny }); } catch (err) { /* 忽略 */ }
      }
    },

    toggle() { this.open ? this.hide() : this.show(); },

    /** 打开面板并渲染当前 Tab */
    show(tab) {
      const self = this;
      safe(function () {
        if (!self.mounted || !self.host || !document.documentElement.contains(self.host)) self.mount();
        if (tab) self.current = tab;
        self.syncTabs();
        self.el.panel.classList.add('open');
        self.open = true;
        self.render();
      }, 'Panel.show');
    },

    /** 关闭面板并销毁图表，防止内存泄漏 */
    hide() {
      const self = this;
      safe(function () {
        self.el.panel.classList.remove('open');
        self.open = false;
        self.destroyCharts();
      }, 'Panel.hide');
    },

    /** 切换 Tab（关闭时清图表，打开时才渲染） */
    switchTab(name) {
      this.current = name;
      this.syncTabs();
      this.destroyCharts();
      if (this.open) this.render();
    },

    /** 销毁全部 Chart 实例 */
    destroyCharts() {
      Object.keys(this.charts).forEach(function (k) {
        try { if (this.charts[k]) this.charts[k].destroy(); } catch (err) { /* 忽略 */ }
        delete this.charts[k];
      }, this);
    },

    /** 渲染当前 Tab */
    render() {
      if (!this.open) return;
      const self = this;
      safe(function () {
        self.el.body.innerHTML = '';
        if (self.current === '今日') self.renderToday();
        else if (self.current === '本周') self.renderWeek();
        else if (self.current === '全部') self.renderAll();
        else if (self.current === '报告' && typeof self.renderReportTab === 'function') self.renderReportTab();
      }, 'Panel.render.' + self.current);
    },

    /** 今日 Tab */
    renderToday() {
      const data = Stats.today();
      if (data.count === 0) { this.empty('今天还没有观看记录'); return; }
      this.el.body.appendChild(this.cards([
        { num: formatDuration(data.seconds), lbl: '今日总时长' },
        { num: String(data.count), lbl: '今日视频数' },
      ]));
      this.el.body.appendChild(this.subTitle('按 UP 主分布'));
      const box = this.chartBox('todayUploader');
      this.el.body.appendChild(box);
      this.makeChart('todayUploader', {
        type: 'doughnut',
        data: {
          labels: data.byUploader.slice(0, 8).map(function (u) { return u.name; }),
          datasets: [{
            data: data.byUploader.slice(0, 8).map(function (u) { return Math.round(u.seconds); }),
            backgroundColor: CHART_COLORS,
            borderWidth: 0,
          }],
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
      });
    },

    /** 本周 Tab */
    renderWeek() {
      const data = Stats.week();
      this.el.body.appendChild(this.cards([
        { num: formatDuration(data.totalSeconds), lbl: '近7天总时长' },
        { num: data.weekKey, lbl: '本周（周一起）', compact: true },
      ]));
      this.el.body.appendChild(this.subTitle('近 7 天每日时长'));
      this.el.body.appendChild(this.chartBox('weekDaily'));
      this.makeChart('weekDaily', {
        type: 'line',
        data: {
          labels: data.daily.map(function (d) { return d.label; }),
          datasets: [{
            label: '分钟',
            data: data.daily.map(function (d) { return Math.round(d.seconds / 60); }),
            borderColor: CHART_COLORS[0],
            backgroundColor: 'rgba(251,114,153,.14)',
            fill: true, tension: .35, pointRadius: 3,
          }],
        },
        options: { plugins: { legend: { display: false } } },
      });
      this.el.body.appendChild(this.subTitle('本周 Top5 UP 主'));
      if (data.topUploaders.length === 0) {
        this.el.body.appendChild(this.emptyNode('本周暂无数据'));
        return;
      }
      this.el.body.appendChild(this.chartBox('weekUploader'));
      this.makeChart('weekUploader', {
        type: 'bar',
        data: {
          labels: data.topUploaders.map(function (u) { return u.name; }),
          datasets: [{
            label: '分钟',
            data: data.topUploaders.map(function (u) { return Math.round(u.seconds / 60); }),
            backgroundColor: CHART_COLORS.slice(0, data.topUploaders.length),
            borderRadius: 8, borderSkipped: false, maxBarThickness: 30,
          }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    },

    /** 全部 Tab */
    renderAll() {
      const data = Stats.all();
      if (data.count === 0) { this.empty('还没有任何观看记录'); return; }
      this.el.body.appendChild(this.cards([
        { num: formatDuration(data.seconds), lbl: '累计总时长' },
        { num: String(data.count), lbl: '总视频数' },
        { num: String(data.uploaderCount), lbl: '覆盖UP主' },
      ]));
      this.el.body.appendChild(this.subTitle('最近 20 条观看记录'));
      const list = document.createElement('div');
      list.className = 'bwp-list';
      data.recent.forEach(function (r, i) {
        const item = document.createElement('div');
        item.className = 'bwp-item bwp-anim';
        item.style.setProperty('--bwp-i', Math.min(i, 8));
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = r.videoTitle || r.bvid || '未知视频';
        const m = document.createElement('div');
        m.className = 'm';
        const left = document.createElement('span');
        left.textContent = (r.uploader || '未知UP主') + ' · ' + formatDuration(r.watchedSeconds);
        const right = document.createElement('span');
        right.textContent = r.date;
        m.appendChild(left); m.appendChild(right);
        item.appendChild(t); item.appendChild(m);
        list.appendChild(item);
      });
      this.el.body.appendChild(list);
    },

    /* ---------- 小组件 ---------- */

    cards(items) {
      const wrap = document.createElement('div');
      wrap.className = 'bwp-cards' + (items.length >= 3 ? ' bwp-cards-3' : '');
      items.forEach(function (it, i) {
        const c = document.createElement('div');
        c.className = 'bwp-card bwp-anim' + (it.compact ? ' compact' : '');
        c.style.setProperty('--bwp-i', i);
        const n = document.createElement('div');
        n.className = 'num';
        n.textContent = it.num;
        const l = document.createElement('div');
        l.className = 'lbl';
        l.textContent = it.lbl;
        c.appendChild(n); c.appendChild(l);
        wrap.appendChild(c);
      });
      return wrap;
    },

    subTitle(text) {
      const el = document.createElement('div');
      el.className = 'bwp-sub';
      el.textContent = text;
      return el;
    },

    chartBox(id) {
      const box = document.createElement('div');
      box.className = 'bwp-chart bwp-anim';
      const cv = document.createElement('canvas');
      cv.id = id;
      box.appendChild(cv);
      return box;
    },

    empty(text) {
      this.el.body.appendChild(this.emptyNode(text));
    },

    emptyNode(text) {
      const el = document.createElement('div');
      el.className = 'bwp-empty';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M8 3.5 12 7l4-3.5"/><path d="M8.5 12.5h7"/></svg>';
      const t = document.createElement('div');
      t.textContent = text;
      el.appendChild(dot); el.appendChild(t);
      return el;
    },

    /** 创建一个 Chart 实例并登记（懒加载） */
    makeChart(key, config) {
      try {
        if (typeof Chart === 'undefined') {
          const box = this.root.querySelector('#' + key);
          if (box && box.parentNode) {
            const tip = this.emptyNode('图表库未加载，请检查网络后刷新');
            box.parentNode.replaceChild(tip, box);
          }
          return;
        }
        const canvas = this.root.querySelector('#' + key);
        if (!canvas) return;
        config.options = config.options || {};
        config.options.responsive = true;
        config.options.maintainAspectRatio = false;
        config.options.animation = { duration: 320, easing: 'easeOutQuart' };
        // 统一图表排版：淡网格、圆角、系统字体、粉系 tooltip
        config.options.font = config.options.font || { family: '"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif', size: 11 };
        config.options.color = config.options.color || '#9499a0';
        config.options.plugins = config.options.plugins || {};
        if (config.options.plugins.legend && !config.options.plugins.legend.labels) config.options.plugins.legend.labels = {};
        if (config.options.plugins.legend && config.options.plugins.legend.labels) {
          const lbl = config.options.plugins.legend.labels;
          if (lbl.color === undefined) lbl.color = '#61666d';
          if (lbl.boxWidth === undefined) lbl.boxWidth = 9;
          if (lbl.boxHeight === undefined) lbl.boxHeight = 9;
          if (lbl.usePointStyle === undefined) lbl.usePointStyle = true;
          if (lbl.padding === undefined) lbl.padding = 12;
        }
        if (config.options.plugins.tooltip === undefined) {
          config.options.plugins.tooltip = {
            backgroundColor: 'rgba(24,25,28,.92)', padding: 10, cornerRadius: 10,
            titleFont: { size: 11.5 }, bodyFont: { size: 11.5 }, displayColors: true, boxPadding: 4,
          };
        }
        config.options.scales = config.options.scales || {};
        Object.keys(config.options.scales).forEach(function (k) {
          const sc = config.options.scales[k];
          if (!sc || typeof sc !== 'object') return;
          sc.grid = sc.grid || {};
          sc.grid.color = sc.grid.color || 'rgba(97,102,109,.08)';
          sc.grid.drawTicks = sc.grid.drawTicks === undefined ? false : sc.grid.drawTicks;
          sc.border = sc.border || {};
          sc.border.display = sc.border.display === undefined ? false : sc.border.display;
          sc.ticks = sc.ticks || {};
          if (sc.ticks.color === undefined) sc.ticks.color = '#9499a0';
          if (sc.ticks.padding === undefined) sc.ticks.padding = 6;
        });
        this.charts[key] = new Chart(canvas.getContext('2d'), config);
      } catch (err) {
        logError('Panel.makeChart.' + key, err);
      }
    },

    /* ---------- 数据管理 ---------- */

    exportJSON() {
      try {
        const payload = {
          exportedAt: new Date().toISOString(),
          schemaVersion: CONFIG.SCHEMA_VERSION,
          watchRecords: Store.getRecords(),
          watchRecordsArchive: Store.getArchive(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, 'bwp-backup-' + todayStr() + '.json');
        log('已导出 JSON 备份');
      } catch (err) {
        logError('Panel.exportJSON', err);
      }
    },

    clearAll() {
      try {
        if (!window.confirm('确定要清空全部本地观看数据吗？此操作不可恢复。')) return;
        if (!window.confirm('再次确认：清空后无法找回，建议先导出 JSON 备份。确定继续？')) return;
        Store.clearAll();
        this.destroyCharts();
        this.render();
      } catch (err) {
        logError('Panel.clearAll', err);
      }
    },

    /** 通用 Blob 下载 */
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1000);
    },
  };



  /* ============================================================
   * ⑧ Report 本周报告区
   * 卡片式周报 + PNG 导出 + 周日提醒
   * ============================================================ */

  const REPORT_CSS = [
    '.bwp-report { width: 100%; padding: 16px 14px 6px; border-radius: 18px; border: 1px solid rgba(251,114,153,.16); background: linear-gradient(180deg,#fff6fa 0%,#ffffff 40%); box-shadow: 0 10px 30px rgba(251,114,153,.08); }',
    '.bwp-rp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }',
    '.bwp-rp-title { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 700; color: #18191c; }',
    '.bwp-rp-title::before { content: ""; width: 4px; height: 15px; border-radius: 2px; background: linear-gradient(180deg,#fb7299,#ffb0c9); }',
    '.bwp-rp-week { flex: none; padding: 4px 9px; border-radius: 999px; border: 1px solid #ffdce8; background: #fff; color: #e8578a; font-size: 10.5px; font-weight: 600; }',
    '.bwp-rp-big { display: flex; gap: 10px; margin-bottom: 12px; }',
    '.bwp-rp-big div { position: relative; flex: 1; min-width: 0; padding: 13px; border-radius: 15px; color: #fff; overflow: hidden; background: linear-gradient(140deg,#ff8fb1 0%,#fb7299 60%,#ef5f8d 100%); box-shadow: 0 8px 18px rgba(251,114,153,.24); }',
    '.bwp-rp-big div::after { content: ""; position: absolute; right: -24px; top: -28px; width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,.16); }',
    '.bwp-rp-big .n { position: relative; font-size: 20px; font-weight: 700; line-height: 1.2; }',
    '.bwp-rp-big .l { position: relative; margin-top: 5px; font-size: 10.5px; opacity: .9; }',
    '.bwp-rp-sec { margin-bottom: 10px; padding: 12px 12px 4px; border-radius: 15px; border: 1px solid #f2f3f5; background: #fff; box-shadow: 0 2px 10px rgba(97,102,109,.05); }',
    '.bwp-rp-sec h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 11.5px; font-weight: 600; color: #61666d; letter-spacing: .02em; }',
    '.bwp-rp-sec h4::before { content: ""; width: 3px; height: 11px; border-radius: 2px; background: #ffb0c9; }',
    '.bwp-rp-up { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
    '.bwp-rp-up .idx { flex: none; display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border-radius: 7px; color: #fff; font-size: 10px; font-weight: 700; background: linear-gradient(140deg,#ff9db8,#fb7299); box-shadow: 0 2px 6px rgba(251,114,153,.28); }',
    '.bwp-rp-up .nm { flex: 1; min-width: 0; font-size: 12px; color: #18191c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.bwp-rp-up .mt { flex: none; font-size: 10.5px; color: #9499a0; }',
    '.bwp-rp-bar { height: 6px; margin: 0 0 10px 27px; border-radius: 999px; background: #fff0f5; overflow: hidden; }',
    '.bwp-rp-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg,#ffb0c9,#fb7299); }',
    '.bwp-rp-chart { position: relative; height: 120px; padding: 4px 2px 2px; }',
    '.bwp-rp-slots { display: flex; gap: 7px; padding-bottom: 8px; }',
    '.bwp-rp-slot { flex: 1; padding: 9px 2px; text-align: center; border-radius: 12px; border: 1px solid #f0f1f3; background: #fafafb; }',
    '.bwp-rp-slot.hot { border-color: #ffd0dd; background: linear-gradient(160deg,#fff2f7,#ffffff); box-shadow: 0 4px 12px rgba(251,114,153,.12); }',
    '.bwp-rp-slot .s { font-size: 10.5px; color: #61666d; }',
    '.bwp-rp-slot .v { margin-top: 4px; font-size: 12px; font-weight: 700; color: #e8578a; }',
    '.bwp-rp-slot.hot .s { color: #e8578a; font-weight: 600; }',
    '.bwp-rp-sum { position: relative; margin-bottom: 12px; padding: 12px 13px 12px 34px; border-radius: 15px; border: 1px solid #ffdce8; background: #fff; font-size: 12px; line-height: 1.65; color: #61666d; box-shadow: 0 2px 10px rgba(251,114,153,.06); }',
    '.bwp-rp-sum::before { content: ""; position: absolute; left: 13px; top: 15px; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 35%,#ffc0d1,#fb7299); box-shadow: 0 0 0 3px rgba(251,114,153,.12); }',
    '.bwp-rp-sum b { color: #e8578a; }',
    '.bwp-rp-empty { display: flex; flex-direction: column; gap: 6px; padding: 30px 8px; text-align: center; font-size: 12px; color: #9499a0; }',
  ].join('\n');

  const TOAST_CSS = [
    '.bwp-toast { position: fixed; right: 20px; bottom: 26px; z-index: 2147483002; display: flex; align-items: center; gap: 10px; max-width: 270px; padding: 12px 14px; border-radius: 16px; border: 1px solid rgba(251,114,153,.2); background: rgba(255,255,255,.96); box-shadow: 0 12px 32px rgba(251,114,153,.22), 0 2px 8px rgba(97,102,109,.08); font-size: 12px; line-height: 1.55; color: #18191c; cursor: pointer; animation: bwp-toast-in .3s cubic-bezier(.32,.72,0,1); transition: transform .2s ease, box-shadow .2s ease; }',
    '.bwp-toast:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(251,114,153,.3), 0 2px 8px rgba(97,102,109,.08); }',
    '.bwp-toast > span { min-width: 0; }',
    '.bwp-toast b { color: #e8578a; }',
    '.bwp-toast .x { order: 2; flex: none; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 6px; color: #9499a0; }',
    '.bwp-toast .x:hover { background: #f5f5f7; color: #61666d; }',
    '@keyframes bwp-toast-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }',
  ].join('\n');

  /** 渲染报告卡片内容（返回报告根元素） */
  function buildReportNode(data) {
    const root = document.createElement('div');
    root.className = 'bwp-report';

    if (data.totalVideos === 0) {
      const empty = document.createElement('div');
      empty.className = 'bwp-rp-empty';
      empty.textContent = '本周还没有观看记录，先去看几个视频吧～';
      root.appendChild(empty);
      return root;
    }

    // 头部
    const head = document.createElement('div');
    head.className = 'bwp-rp-head';
    const title = document.createElement('span');
    title.className = 'bwp-rp-title';
    title.textContent = '本周使用报告';
    const wk = document.createElement('span');
    wk.className = 'bwp-rp-week';
    wk.textContent = data.weekKey;
    head.appendChild(title); head.appendChild(wk);
    head.className = 'bwp-rp-head bwp-anim';
    head.style.setProperty('--bwp-i', 0);
    root.appendChild(head);

    // 大数字卡
    const big = document.createElement('div');
    big.className = 'bwp-rp-big';
    [
      { n: formatDuration(data.totalSeconds), l: '本周总时长' },
      { n: data.totalVideos + ' 个', l: '本周视频数' },
    ].forEach(function (it, i) {
      const d = document.createElement('div');
      d.className = 'bwp-anim';
      d.style.setProperty('--bwp-i', 1 + i);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = it.n;
      const l = document.createElement('div'); l.className = 'l'; l.textContent = it.l;
      d.appendChild(n); d.appendChild(l);
      big.appendChild(d);
    });
    root.appendChild(big);

    // 最爱 UP 主 Top5
    const upSec = document.createElement('div');
    upSec.className = 'bwp-rp-sec bwp-anim';
    upSec.style.setProperty('--bwp-i', 3);
    const h1 = document.createElement('h4');
    h1.textContent = '最爱 UP 主 Top5';
    upSec.appendChild(h1);
    const maxSec = data.topUploaders[0] ? data.topUploaders[0].seconds : 1;
    data.topUploaders.forEach(function (u, i) {
      const row = document.createElement('div');
      row.className = 'bwp-rp-up';
      const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = u.name;
      const mt = document.createElement('span'); mt.className = 'mt';
      mt.textContent = u.count + ' 次 · ' + formatDuration(u.seconds);
      row.appendChild(idx); row.appendChild(nm); row.appendChild(mt);
      upSec.appendChild(row);
      const bar = document.createElement('div');
      bar.className = 'bwp-rp-bar';
      const inner = document.createElement('i');
      inner.style.width = Math.max(6, Math.round(u.seconds / maxSec * 100)) + '%';
      inner.style.animationDelay = (160 + i * 70) + 'ms';
      bar.appendChild(inner);
      upSec.appendChild(bar);
    });
    root.appendChild(upSec);

    // 每日迷你折线
    const daySec = document.createElement('div');
    daySec.className = 'bwp-rp-sec bwp-anim';
    daySec.style.setProperty('--bwp-i', 4);
    const h2 = document.createElement('h4');
    h2.textContent = '每日观看时长';
    daySec.appendChild(h2);
    const chartBox = document.createElement('div');
    chartBox.className = 'bwp-rp-chart';
    const cv = document.createElement('canvas');
    cv.id = 'reportDaily';
    chartBox.appendChild(cv);
    daySec.appendChild(chartBox);
    root.appendChild(daySec);

    // 高峰时段
    const slotSec = document.createElement('div');
    slotSec.className = 'bwp-rp-sec bwp-anim';
    slotSec.style.setProperty('--bwp-i', 5);
    const h3 = document.createElement('h4');
    h3.textContent = '观看高峰时段';
    slotSec.appendChild(h3);
    const slots = document.createElement('div');
    slots.className = 'bwp-rp-slots';
    data.slots.forEach(function (s) {
      const d = document.createElement('div');
      d.className = 'bwp-rp-slot' + (s.name === data.peakSlot ? ' hot' : '');
      const n = document.createElement('div'); n.className = 's'; n.textContent = s.name;
      const v = document.createElement('div'); v.className = 'v'; v.textContent = Math.round(s.seconds / 60) + '分';
      d.appendChild(n); d.appendChild(v);
      slots.appendChild(d);
    });
    slotSec.appendChild(slots);
    root.appendChild(slotSec);

    // 一句话总结
    const sum = document.createElement('div');
    sum.className = 'bwp-rp-sum bwp-anim';
    sum.style.setProperty('--bwp-i', 6);
    sum.innerHTML = '本周共看 <b>' + data.totalVideos + '</b> 个视频，'
      + (data.peakSlot ? '最常在<b>' + data.peakSlot + '</b>打开B站' : '观看时段较分散')
      + (data.topUploaders[0] ? '，最爱 <b>' + escapeHTML(data.topUploaders[0].name) + '</b>' : '') + '。';
    root.appendChild(sum);

    return root;
  }

  /** 简单 HTML 转义，避免 UP 主昵称破坏结构 */
  function escapeHTML(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 渲染「报告」Tab */
  Panel.renderReportTab = function () {
    const self = this;
    const data = Stats.report();
    const node = buildReportNode(data);
    self.el.body.appendChild(node);

    // 每日迷你折线图
    if (data.totalVideos > 0) {
      self.makeChart('reportDaily', {
        type: 'line',
        data: {
          labels: data.daily.map(function (d) { return d.label; }),
          datasets: [{
            label: '分钟',
            data: data.daily.map(function (d) { return Math.round(d.seconds / 60); }),
            borderColor: CHART_COLORS[0],
            backgroundColor: 'rgba(251,114,153,.14)',
            fill: true, tension: .35, pointRadius: 2, borderWidth: 2,
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } },
        },
      });
    }

    // 导出按钮（放在报告卡之外，避免被截图）
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
    const btn = document.createElement('button');
    btn.className = 'bwp-btn';
    btn.textContent = '导出图片';
    btn.style.flex = '1';
    btn.addEventListener('click', function () { self.exportReport(); });
    bar.appendChild(btn);
    self.el.body.appendChild(bar);
  };

  /** 把报告区域导出为 PNG（含 canvas 快照处理） */
  Panel.exportReport = function () {
    const self = this;
    safe(function () {
      const node = self.root.querySelector('.bwp-report');
      if (!node) return;
      if (typeof html2canvas === 'undefined') {
        window.alert('图片导出库未加载成功，请检查网络后刷新页面重试。');
        return;
      }

      // 克隆到临时容器：Shadow DOM 内容 html2canvas 无法直接渲染
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:360px;background:#fff;';
      const style = document.createElement('style');
      style.textContent = REPORT_CSS;
      wrap.appendChild(style);
      const clone = node.cloneNode(true);
      // 截图前彻底关闭克隆体内的动画：html2canvas 会按计算样式复制子树，
      // 入场动画/进度条动画会让元素停在起始帧（透明或 scaleX(0)），
      // 导致导出的 PNG 出现空白区块或空进度条。
      [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'))).forEach(function (el) {
        if (!el || !el.style) return;
        el.style.animation = 'none';
        el.style.webkitAnimation = 'none';
        el.style.transition = 'none';
        el.style.opacity = '';
        el.style.transform = '';
        el.style.animationDelay = '';
      });

      // canvas 内容不会随 cloneNode 复制，改用快照图片
      const srcCanvas = node.querySelectorAll('canvas');
      const dstCanvas = clone.querySelectorAll('canvas');
      for (let i = 0; i < srcCanvas.length && i < dstCanvas.length; i++) {
        try {
          const img = document.createElement('img');
          img.src = srcCanvas[i].toDataURL('image/png');
          img.style.cssText = 'width:100%;height:auto;display:block;';
          dstCanvas[i].parentNode.replaceChild(img, dstCanvas[i]);
        } catch (err) { /* 单张画布快照失败不影响整体导出 */ }
      }

      wrap.appendChild(clone);
      document.body.appendChild(wrap);

      const weekLabel = Stats.report().weekKey;
      html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false })
        .then(function (canvas) {
          return new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
              if (blob) self.downloadBlob(blob, 'bwp-week-report-' + weekLabel + '.png');
              resolve();
            }, 'image/png');
          });
        })
        .catch(function (err) { logError('Panel.exportReport', err); })
        .then(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
    }, 'Panel.exportReport');
  };

  /** 周日首次打开时的轻提示（每周只提醒一次） */
  function maybeShowWeeklyReminder() {
    try {
      const now = new Date();
      if (now.getDay() !== 0) return;          // 仅周日
      const wk = weekKey(now);
      if (GM_getValue(CONFIG.KEYS.REMINDER, '') === wk) return;
      GM_setValue(CONFIG.KEYS.REMINDER, wk);

      if (!Panel.mounted) Panel.mount();
      const old = Panel.root.querySelector('.bwp-toast');
      if (old) old.remove();

      const toast = document.createElement('div');
      toast.className = 'bwp-toast';
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      const txt = document.createElement('span');
      txt.innerHTML = '本周B站报告已生成，<b>点击查看</b>';
      toast.appendChild(x); toast.appendChild(txt);
      toast.addEventListener('click', function (e) {
        if (e.target === x) { toast.remove(); return; }
        toast.remove();
        Panel.show('报告');
      });
      Panel.root.appendChild(toast);
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 12000);
      log('已显示本周报告提醒', wk);
    } catch (err) {
      logError('maybeShowWeeklyReminder', err);
    }
  }


  /* ============================================================
   * ⑨ Bootstrap 入口
   * ============================================================ */

  /** SPA 路由守护：根据当前路径自动启停采集 */
  function ensureCollector() {
    if (Collector.isVideoPage()) {
      const key = location.pathname + location.search;
      // 同一视频页会话保持，不重复重启，避免 openCount 重复累加
      if (!Collector.active) Collector.start();
      if (!Panel.mounted) safe(function () { Panel.mount(); }, 'Panel.mount.spa');
      else if (Collector._sessionKey !== key) Collector.start();
    } else if (Collector.active) {
      Collector.stop(true);
    }
  }

  /** 入口初始化 */
  function bootstrap() {
    safe(function () {
      Store.initSchema();
      wrapHistory();
      log('脚本已加载，版本 0.2.1', location.href);

      // 阶段 3：仅视频页启用采集（SPA 路由切换由守护定时器处理）
      safe(function () { ensureCollector(); }, 'ensureCollector');
      safe(function () { archiveIfNeeded(); }, 'archiveIfNeeded');
      setInterval(function () {
        safe(function () { ensureCollector(); }, 'ensureCollector.tick');
      }, 2000);

      // 阶段 5：周日首次打开提醒查看本周报告
      safe(function () { maybeShowWeeklyReminder(); }, 'maybeShowWeeklyReminder');

      // 阶段 4：仅在视频页挂载面板（图表懒加载，仅打开时渲染）
      if (Collector.isVideoPage()) {
        safe(function () { Panel.mount(); }, 'Panel.mount');
      }
    }, 'bootstrap');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

