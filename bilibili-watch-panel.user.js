// ==UserScript==
// @name         Bilibili Watch Panel
// @namespace    https://github.com/Gavin-gwj/bilibili-watch-panel
// @version      0.7.1
// @description  本地B站观看数据统计与可视化面板
// @author       Gavin-gwj
// @match        https://*.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @noframes
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Gavin-gwj/bilibili-watch-panel/main/bilibili-watch-panel.user.js
// @downloadURL  https://raw.githubusercontent.com/Gavin-gwj/bilibili-watch-panel/main/bilibili-watch-panel.user.js
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
      ARCHIVE_NOTICE: 'archiveNotice',
      FAB_POS: 'fabPos',
      WEEKLY_GOAL: 'weeklyGoalSeconds',
    },
    /** 当前数据结构版本 */
    SCHEMA_VERSION: 3,
    COMPLETION_TOLERANCE_SECONDS: 2,
    COMPLETION_PROGRESS_THRESHOLD: 0.95,
    DEFAULT_WEEKLY_GOAL_SECONDS: 3600,
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

  function formatPercent(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Math.round(Number(value) * 100) + '%';
  }

  /** 时间戳格式化为 HH:MM（本地时区） */
  function formatClock(ts) {
    const d = new Date(Number(ts) || Date.now());
    if (isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatDateTime(ts) {
    if (!Number(ts)) return '—';
    return formatDate(new Date(Number(ts))) + ' ' + formatClock(ts);
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

  /** 清洗单条播放会话；旧记录没有会话时保持空数组，不推断历史数据。 */
  function sanitizeSession(s) {
    if (!s || typeof s !== 'object') return null;
    const startAt = Number(s.startAt);
    const endAt = Number(s.endAt);
    if (!(startAt > 0) || !(endAt >= startAt)) return null;
    const reason = ['ended', 'pause', 'hidden', 'route', 'pagehide', 'unload', 'unknown'].indexOf(s.endReason) >= 0
      ? s.endReason : 'unknown';
    return {
      startAt: startAt,
      endAt: endAt,
      watchedSeconds: Math.max(0, Number(s.watchedSeconds) || 0),
      pauseCount: Math.max(0, Math.floor(Number(s.pauseCount) || 0)),
      backgroundCount: Math.max(0, Math.floor(Number(s.backgroundCount) || 0)),
      seekCount: Math.max(0, Math.floor(Number(s.seekCount) || 0)),
      endReason: reason,
    };
  }

  function sessionKey(s) {
    return [s.startAt, s.endAt, s.endReason].join(':');
  }

  /** 合并并去重会话，保证重复导入同一备份不会复制会话。 */
  function mergeSessions() {
    const map = Object.create(null);
    for (let i = 0; i < arguments.length; i++) {
      const list = Array.isArray(arguments[i]) ? arguments[i] : [];
      list.forEach(function (raw) {
        const s = sanitizeSession(raw);
        if (s) map[sessionKey(s)] = s;
      });
    }
    return Object.keys(map).map(function (key) { return map[key]; })
      .sort(function (a, b) { return a.startAt - b.startAt; });
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
      durationSeconds: Number.isFinite(r.durationSeconds) && r.durationSeconds > 0 ? r.durationSeconds : 0,
      maxPositionSeconds: Number.isFinite(r.maxPositionSeconds) && r.maxPositionSeconds >= 0
        ? r.maxPositionSeconds
        : Math.min(Number(r.watchedSeconds) || 0, Number(r.durationSeconds) || 0),
      playCount: Number.isFinite(r.playCount) && r.playCount > 0
        ? Math.floor(r.playCount) : Math.max(1, Number(r.openCount) || 1),
      completed: r.completed === true,
      completedAt: Number.isFinite(r.completedAt) ? r.completedAt : 0,
      sessions: mergeSessions(r.sessions),
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
        GM_deleteValue(CONFIG.KEYS.ARCHIVE_NOTICE);
        log('数据已清空');
        return true;
      } catch (err) {
        logError('Store.clearAll', err);
        return false;
      }
    },

    /** 归档裁剪提示（读取后不清除，用户可自行导出备份） */
    getArchiveNotice() {
      try {
        const raw = GM_getValue(CONFIG.KEYS.ARCHIVE_NOTICE, null);
        return raw && typeof raw === 'object' && Number(raw.dropped) > 0 ? raw : null;
      } catch (err) {
        logError('Store.getArchiveNotice', err);
        return null;
      }
    },

    /** 初始化 schema 版本 */
    initSchema() {
      try {
        const v = GM_getValue(CONFIG.KEYS.SCHEMA, 0);
        if (v !== CONFIG.SCHEMA_VERSION) {
          // 旧记录通过读取时 sanitizeRecord 补齐字段，避免重写用户数据。
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

    let info = { videoId: urlAid, bvid: urlBvid, videoTitle: '', uploader: '', uploaderId: '', durationSeconds: 0 };

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
    pendingMaxPosition: 0,
    pendingCompleted: false,
    pendingCompletedAt: 0,
    pendingSession: null,
    currentSession: null,
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
    playCountedForCurrentPlay: false,
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
      this.pendingMaxPosition = 0;
      this.pendingCompleted = false;
      this.pendingCompletedAt = 0;
      this.pendingSession = null;
      this.currentSession = null;
      this.lastTickAt = Date.now();
      this.lastSaveAt = 0;
      this.opened = false;
      this.playCountedForCurrentPlay = false;
      this._lastCurrentTime = NaN;
      this._sessionKey = location.pathname + location.search;

      const self = this;
      resolveVideoInfo().then(function (info) {
        if (!self.active) return;
        self.videoInfo = info;
        self.updateDuration(self.videoEl);
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
      if (this.active && save !== false) {
        this.settleTick();
        this.endSession('route', Date.now());
        this.flush(true);
      }
      this.active = false;
      this.videoEl = null;
      this.videoInfo = null;
      this.pendingSeconds = 0;
      this.pendingMaxPosition = 0;
      this.pendingCompleted = false;
      this.pendingCompletedAt = 0;
      this.pendingSession = null;
      this.currentSession = null;
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
        self.playCountedForCurrentPlay = false;
        self.beginSession();
        self.lastTickAt = Date.now();
        self._lastCurrentTime = v && Number.isFinite(v.currentTime) ? v.currentTime : NaN;
        self._buffering = false;
        self.canAccumulate = true;
        self.updateDuration(v);
      }, true);
      document.addEventListener('pause', function () {
        self.settleTick();
        if (self.currentSession) self.currentSession.pauseCount += 1;
        self.endSession('pause', Date.now());
        self.canAccumulate = false;
        self.flush(true);
      }, true);
      document.addEventListener('ended', function () {
        self.settleTick();
        self.markCompleted(Date.now());
        self.endSession('ended', Date.now());
        self.canAccumulate = false;
        self.flush(true);
      }, true);
      document.addEventListener('seeking', function () {
        if (self.currentSession) self.currentSession.seekCount += 1;
        self._lastCurrentTime = NaN;
        self.canAccumulate = false;
      }, true);
      document.addEventListener('seeked', function () {
        const v = self.videoEl || document.querySelector('video');
        self.videoEl = v;
        self._lastCurrentTime = v && Number.isFinite(v.currentTime) ? v.currentTime : NaN;
        self.lastTickAt = Date.now();
        self.canAccumulate = !!(v && !v.paused && !v.ended && !self._buffering && !document.hidden);
      }, true);
      document.addEventListener('waiting', function () {
        self._buffering = true;
        self.canAccumulate = false;
      }, true);
      document.addEventListener('playing', function () {
        const v = self.videoEl || document.querySelector('video');
        self.videoEl = v;
        if (!self.currentSession) self.playCountedForCurrentPlay = false;
        self.beginSession();
        self.lastTickAt = Date.now();
        self._lastCurrentTime = v && Number.isFinite(v.currentTime) ? v.currentTime : NaN;
        self._buffering = false;
        self.canAccumulate = true;
        self.updateDuration(v);
      }, true);
      document.addEventListener('loadedmetadata', function (event) {
        const v = event.target && event.target.tagName === 'VIDEO' ? event.target : self.videoEl;
        self.updateDuration(v);
      }, true);

      // 切后台立即停止累加并保存
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.settleTick();
          if (self.currentSession) self.currentSession.backgroundCount += 1;
          self.endSession('hidden', Date.now());
          self.playCountedForCurrentPlay = false;
          self.canAccumulate = false;
          self.flush(true);
        } else {
          self.settleTick();
          self.lastTickAt = Date.now();
          const v = self.videoEl || document.querySelector('video');
          self.videoEl = v;
          if (v && !v.paused && !v.ended && !self._buffering) {
            self.playCountedForCurrentPlay = false;
            self.beginSession();
          }
          self.canAccumulate = !!(v && !v.paused && !v.ended && !self._buffering);
        }
      });

      // 页面关闭前最终结算
      window.addEventListener('pagehide', function () {
        self.settleTick();
        self.endSession('pagehide', Date.now());
        self.flush(true);
      });
      window.addEventListener('beforeunload', function () {
        self.settleTick();
        self.endSession('unload', Date.now());
        self.flush(true);
      });

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
      // 轮询兜底统一由 Bootstrap 的路由守护负责，这里不再另起定时器

      log('采集事件已绑定');
    },

    /** 开始一次有效播放会话；同一播放周期内重复 playing 不重复创建。 */
    beginSession() {
      if (this.currentSession) return;
      this.currentSession = {
        startAt: Date.now(),
        endAt: 0,
        watchedSeconds: 0,
        pauseCount: 0,
        backgroundCount: 0,
        seekCount: 0,
        endReason: 'unknown',
      };
      if (this.videoInfo && !this.playCountedForCurrentPlay) {
        this.recordPlaySession();
        this.playCountedForCurrentPlay = true;
      }
    },

    /** 结束当前会话；重复触发 pagehide/beforeunload 时保持幂等。 */
    endSession(reason, at) {
      if (!this.currentSession) return;
      this.currentSession.endAt = Number(at) || Date.now();
      this.currentSession.endReason = reason || 'unknown';
      this.pendingSession = this.currentSession;
      this.currentSession = null;
    },

    /** 记录一次"打开"：同天同视频 openCount +1 */
    recordOpen() {
      if (!this.videoInfo || !this.videoInfo.bvid) return;
      const firstSession = !this.opened;
      this.opened = true;
      const date = todayStr();
      const records = Store.getRecords();
      const idx = findRecordIndex(records, date, this.videoInfo.bvid);
      if (idx >= 0) {
        records[idx].openCount = (Number(records[idx].openCount) || 1) + 1;
        records[idx].playCount = Math.max(1, Math.floor(Number(records[idx].playCount) || 1)) + (firstSession ? 1 : 0);
        records[idx].durationSeconds = Math.max(Number(records[idx].durationSeconds) || 0, Number(this.videoInfo.durationSeconds) || 0);
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
          playCount: 1,
          durationSeconds: Number(this.videoInfo.durationSeconds) || 0,
          maxPositionSeconds: 0,
          completed: false,
          completedAt: 0,
           sessions: [],
        });
      }
      Store.setRecords(records);
      log('已记录打开', date, this.videoInfo.bvid);
    },

    /** 记录一次从暂停到播放的有效播放会话。 */
    recordPlaySession() {
      if (!this.videoInfo || !this.videoInfo.bvid) return;
      const date = todayStr();
      const records = Store.getRecords();
      const idx = findRecordIndex(records, date, this.videoInfo.bvid);
      if (!this.opened || idx < 0) {
        this.recordOpen();
        return;
      }
      records[idx].playCount = Math.max(1, Math.floor(Number(records[idx].playCount) || 1)) + 1;
      records[idx].lastActive = Date.now();
      Store.setRecords(records);
    },

    updateDuration(video) {
      const duration = Number(video && video.duration);
      if (!this.videoInfo || !Number.isFinite(duration) || duration <= 0 || duration >= 24 * 60 * 60) return;
      this.videoInfo.durationSeconds = duration;
    },

    markCompleted(at) {
      if (!this.videoInfo || !this.videoInfo.bvid || this.pendingCompleted) return;
      this.pendingCompleted = true;
      this.pendingCompletedAt = Number(at) || Date.now();
    },

    /** 暂停/结束时结算一次：把上次心跳到当前时刻的播放时长计入 */
    settleTick() {
      if (!this.active || !this.videoInfo) return;
      const now = Date.now();
      const video = this.videoEl || document.querySelector('video');
      this.videoEl = video;
      if (this.canAccumulate && video && !this._buffering) {
        this.updateDuration(video);
        const ctDelta = Number.isFinite(this._lastCurrentTime) && Number.isFinite(video.currentTime)
          ? Math.max(0, video.currentTime - this._lastCurrentTime)
          : 0;
        const delta = Math.min(ctDelta, CONFIG.HEARTBEAT_MS / 1000, CONFIG.MAX_TICK_SECONDS);
        if (delta > 0) {
          this.pendingSeconds += delta;
          if (this.currentSession) this.currentSession.watchedSeconds += delta;
        }
      }
      if (video && Number.isFinite(video.currentTime)) {
        this.pendingMaxPosition = Math.max(this.pendingMaxPosition, video.currentTime);
        this.updateDuration(video);
        this.checkCompletion(video, false);
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
        this.updateDuration(video);
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
          this.beginSession();
          this._lastCurrentTime = Number.isFinite(video.currentTime) ? video.currentTime : NaN;
          this.lastTickAt = now;
          if (!this.playCountedForCurrentPlay) {
            this.recordPlaySession();
            this.playCountedForCurrentPlay = true;
          }
          return;
        }
        const ctDelta = Math.max(0, video.currentTime - this._lastCurrentTime);
        const delta = Math.min(ctDelta, CONFIG.HEARTBEAT_MS / 1000, CONFIG.MAX_TICK_SECONDS);
        this.lastTickAt = now;
        this.beginSession();
        if (!this.playCountedForCurrentPlay) {
          this.recordPlaySession();
          this.playCountedForCurrentPlay = true;
        }
        this.pendingSeconds += delta;
        if (this.currentSession) this.currentSession.watchedSeconds += delta;
        this.pendingMaxPosition = Math.max(this.pendingMaxPosition, Number(video.currentTime) || 0);
        this.checkCompletion(video, delta > 0);
        this._lastCurrentTime = video.currentTime;
        log('心跳累加 +' + delta.toFixed(1) + 's，待写入 ' + this.pendingSeconds.toFixed(1) + 's');

        if (now - this.lastSaveAt >= CONFIG.SAVE_THROTTLE_MS) this.flush(false);
      } catch (err) {
        logError('Collector.tick', err);
      }
    },

    /** 结算并写入存储；saveThrottle 为 true 时受节流限制 */
    flush(force) {
      if (!this.active && !this.pendingSeconds && !this.pendingSession) return;
      if (!this.videoInfo || !this.videoInfo.bvid) return;
      if (this.pendingSeconds <= 0 && this.pendingMaxPosition <= 0 && !this.pendingCompleted && !this.pendingSession) return;
      const now = Date.now();
      if (!force && now - this.lastSaveAt < CONFIG.SAVE_THROTTLE_MS) return;

      try {
        const seconds = this.pendingSeconds;
        this.pendingSeconds = 0;
        const maxPosition = this.pendingMaxPosition;
        const completed = this.pendingCompleted;
        const completedAt = this.pendingCompletedAt;
        const session = this.pendingSession;
        this.pendingMaxPosition = 0;
        this.pendingCompleted = false;
        this.pendingCompletedAt = 0;
        this.pendingSession = null;
        this.lastSaveAt = now;
        mergeWatchedSeconds(this.videoInfo, seconds, now, maxPosition, completed, completedAt, session);
      } catch (err) {
        logError('Collector.flush', err);
      }
    },

    checkCompletion(video, progressed) {
      const duration = Number(this.videoInfo && this.videoInfo.durationSeconds);
      const position = Number(video && video.currentTime);
      if (!(duration > 0) || !Number.isFinite(position)) return;
      const nearEnd = position >= duration - CONFIG.COMPLETION_TOLERANCE_SECONDS;
      const threshold = position / duration >= CONFIG.COMPLETION_PROGRESS_THRESHOLD;
      if (video.ended || nearEnd || (progressed && threshold)) this.markCompleted(Date.now());
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
  function mergeWatchedSeconds(info, seconds, endAt, maxPosition, completed, completedAt, session) {
    if (!info || !info.bvid || (!(seconds > 0) && !(maxPosition > 0) && !completed && !session)) return;
    const end = new Date(endAt);
    const startAt = endAt - seconds * 1000;
    const start = new Date(startAt);
    const sameDay = formatDate(start) === formatDate(end);

    if (sameDay) {
      applySeconds(formatDate(end), info, seconds, endAt, maxPosition, completed, completedAt, session);
      return;
    }
    const midnight = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0).getTime();
    const before = Math.max(0, (midnight - startAt) / 1000);
    const after = Math.max(0, (endAt - midnight) / 1000);
    if (before > 0) applySeconds(formatDate(start), info, before, midnight - 1, maxPosition, completed, completedAt);
    if (after > 0) applySeconds(formatDate(end), info, after, endAt, maxPosition, completed, completedAt);
    if (session) applySeconds(formatDate(new Date(session.startAt)), info, 0, session.endAt, 0, false, 0, session);
  }

  /** 单日单条记录秒数累加（同天同视频合并） */
  function applySeconds(date, info, seconds, activeAt, maxPosition, completed, completedAt, session) {
    const records = Store.getRecords();
    const idx = findRecordIndex(records, date, info.bvid);
    if (idx >= 0) {
      records[idx].watchedSeconds = (Number(records[idx].watchedSeconds) || 0) + seconds;
      records[idx].durationSeconds = Math.max(Number(records[idx].durationSeconds) || 0, Number(info.durationSeconds) || 0);
      records[idx].maxPositionSeconds = Math.max(Number(records[idx].maxPositionSeconds) || 0, Number(maxPosition) || 0);
      if (completed) {
        records[idx].completed = true;
        if (!Number(records[idx].completedAt)) records[idx].completedAt = completedAt || activeAt;
      }
      records[idx].lastActive = activeAt;
      if (info.videoTitle) records[idx].videoTitle = info.videoTitle;
      if (info.uploader) records[idx].uploader = info.uploader;
      if (info.uploaderId) records[idx].uploaderId = info.uploaderId;
      if (info.videoId) records[idx].videoId = info.videoId;
      if (!Number.isFinite(records[idx].openCount) || records[idx].openCount < 1) records[idx].openCount = 1;
      records[idx].sessions = mergeSessions(records[idx].sessions, session ? [session] : []);
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
        durationSeconds: Number(info.durationSeconds) || 0,
        maxPositionSeconds: Number(maxPosition) || 0,
        playCount: 1,
        completed: completed === true,
        completedAt: completed ? (completedAt || activeAt) : 0,
        sessions: session ? mergeSessions([session]) : [],
      });
    }
    Store.setRecords(records);
    log('已写入观看数据', date, info.bvid, seconds.toFixed(1) + 's');
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
      const archived = archive.slice(0, CONFIG.ARCHIVE_MAX);
      const dropped = archive.length - archived.length;
      Store.setRecords(keep);
      Store.setArchive(archived);
      if (dropped > 0) {
        // 归档已满：最旧记录被裁剪，显式提示而不是静默丢弃
        logError('archiveIfNeeded', '归档已达上限，裁剪最旧 ' + dropped + ' 条记录');
        try { GM_setValue(CONFIG.KEYS.ARCHIVE_NOTICE, { at: Date.now(), dropped: dropped }); } catch (err) { /* 忽略 */ }
      }
      log('归档完成：主 ' + keep.length + ' 条，归档 ' + archived.length + ' 条');
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

    recordProgress(record) {
      const duration = Number(record && record.durationSeconds);
      const position = Number(record && record.maxPositionSeconds);
      return duration > 0 && Number.isFinite(position) ? Math.min(1, Math.max(0, position / duration)) : null;
    },

    completionRate(records) {
      const valid = (records || []).filter(function (r) { return Stats.recordProgress(r) !== null; });
      if (!valid.length) return null;
      return Math.min(1, Math.max(0, valid.filter(function (r) { return r.completed === true; }).length / valid.length));
    },

    averageVideoDuration(records) {
      const list = records || [];
      const byVideo = Object.create(null);
      list.forEach(function (r) {
        if (!r || !r.bvid) return;
        const sec = Number(r.watchedSeconds) || 0;
        if (!byVideo[r.bvid]) byVideo[r.bvid] = { seconds: 0 };
        byVideo[r.bvid].seconds += Math.max(0, sec);
      });
      const keys = Object.keys(byVideo);
      return keys.length ? keys.reduce(function (sum, k) { return sum + byVideo[k].seconds; }, 0) / keys.length : null;
    },

    repeatWatchCount(records) {
      return (records || []).reduce(function (sum, r) {
        return sum + Math.max(0, Math.floor(Number(r && r.playCount) || 1) - 1);
      }, 0);
    },

    sessionStats(records) {
      const sessions = [];
      (records || []).forEach(function (r) {
        if (r && Array.isArray(r.sessions)) sessions.push.apply(sessions, r.sessions);
      });
      const total = sessions.length;
      const interrupted = sessions.filter(function (s) { return s.endReason !== 'ended'; }).length;
      const watched = sessions.reduce(function (sum, s) { return sum + (Number(s.watchedSeconds) || 0); }, 0);
      return {
        sessionCount: total,
        interruptedSessionCount: interrupted,
        interruptionRate: total ? interrupted / total : null,
        averageSessionSeconds: total ? watched / total : null,
        pauseCount: sessions.reduce(function (sum, s) { return sum + (Number(s.pauseCount) || 0); }, 0),
        backgroundCount: sessions.reduce(function (sum, s) { return sum + (Number(s.backgroundCount) || 0); }, 0),
        seekCount: sessions.reduce(function (sum, s) { return sum + (Number(s.seekCount) || 0); }, 0),
      };
    },

    quality(records, options) {
      let list = Array.isArray(records) ? records.slice() : [];
      const opts = options || {};
      if (opts.dedupeByBvid) {
        const map = Object.create(null);
        list.forEach(function (r) {
          if (!r || !r.bvid) return;
          const cur = map[r.bvid];
          if (!cur) { map[r.bvid] = Object.assign({}, r); return; }
          cur.watchedSeconds = (Number(cur.watchedSeconds) || 0) + (Number(r.watchedSeconds) || 0);
          cur.maxPositionSeconds = Math.max(Number(cur.maxPositionSeconds) || 0, Number(r.maxPositionSeconds) || 0);
          cur.durationSeconds = Math.max(Number(cur.durationSeconds) || 0, Number(r.durationSeconds) || 0);
          cur.playCount = (Number(cur.playCount) || 1) + (Number(r.playCount) || 1);
          cur.completed = cur.completed === true || r.completed === true;
          if (r.completedAt && (!cur.completedAt || r.completedAt < cur.completedAt)) cur.completedAt = r.completedAt;
          cur.sessions = mergeSessions(cur.sessions, r.sessions);
        });
        list = Object.keys(map).map(function (k) { return map[k]; });
      }
      const progress = list.map(Stats.recordProgress).filter(function (v) { return v !== null; });
      const sessions = Stats.sessionStats(list);
      return {
        validProgressCount: progress.length,
        completedCount: list.filter(function (r) { return Stats.recordProgress(r) !== null && r.completed === true; }).length,
        completionRate: Stats.completionRate(list),
        averageProgress: progress.length ? progress.reduce(function (a, v) { return a + v; }, 0) / progress.length : null,
        totalWatchedSeconds: sumSeconds(list),
        distinctVideoCount: new Set(list.map(function (r) { return r && r.bvid; }).filter(Boolean)).size,
        averageVideoDuration: Stats.averageVideoDuration(list),
        repeatWatchCount: Stats.repeatWatchCount(list),
        recordsWithoutDuration: list.filter(function (r) { return Stats.recordProgress(r) === null; }).length,
        sessionCount: sessions.sessionCount,
        interruptedSessionCount: sessions.interruptedSessionCount,
        interruptionRate: sessions.interruptionRate,
        averageSessionSeconds: sessions.averageSessionSeconds,
        pauseCount: sessions.pauseCount,
        backgroundCount: sessions.backgroundCount,
        seekCount: sessions.seekCount,
      };
    },

    /** 今日汇总：总量 + UP 主分布 + 活跃时段 + 昨日对比 + 观看明细 */
    today() {
      const date = todayStr();
      const records = Store.getRecords();
      const list = records.filter(function (r) { return r.date === date; });
      const seconds = sumSeconds(list);
      const quality = this.quality(list);

      // 记录只保存最后活跃时间，因此按记录数展示时段，不推算播放时长
      const slots = TIME_SLOTS.map(function (s) {
        let count = 0;
        list.forEach(function (r) {
          const h = new Date(r.lastActive || r.timestamp || Date.now()).getHours();
          if (h >= s.from && h < s.to) count++;
        });
        return { name: s.name, count: count };
      });
      let peakSlot = '';
      let peakCount = 0;
      slots.forEach(function (s) {
        if (s.count > peakCount) { peakCount = s.count; peakSlot = s.name; }
      });

      // 昨日总时长，用于「较昨日」对比
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yesterday = sumSeconds(records.filter(function (r) { return r.date === formatDate(y); }));

      // 24 小时最后活跃记录分布
      const hours = [];
      for (let h = 0; h < 24; h++) hours.push({ h: h, count: 0 });
      list.forEach(function (r) {
        const h = new Date(r.lastActive || r.timestamp || Date.now()).getHours();
        if (hours[h]) hours[h].count++;
      });

      // 今日观看明细（按最近活跃倒序）
      const detail = list.slice().sort(function (a, b) {
        return (b.lastActive || 0) - (a.lastActive || 0);
      });

      return {
        date: date,
        seconds: seconds,
        count: list.length,
        byUploader: groupByUploader(list),
        slots: slots,
        hours: hours,
        peakSlot: peakSlot,
        yesterday: yesterday,
        detail: detail,
        quality: quality,
      };
    },

    /** 统计近 N 天（含今天），供本周与近 30 天共用 */
    period(days) {
      const records = Store.getRecords();
      const dates = recentDates(days);
      const dateSet = Object.create(null);
      dates.forEach(function (d) { dateSet[d] = 1; });
      const list = records.filter(function (r) { return !!dateSet[r.date]; });
      const daily = dates.map(function (d) {
        const dayRecords = list.filter(function (r) { return r.date === d; });
        return { date: d, label: d.slice(5), seconds: sumSeconds(dayRecords), quality: Stats.quality(dayRecords) };
      });
      return {
        days: days,
        daily: daily,
        records: list,
        totalSeconds: sumSeconds(list),
        totalVideos: list.length,
        topUploaders: groupByUploader(list).slice(0, 5),
        quality: this.quality(list, { dedupeByBvid: days > 7 }),
        weekKey: weekKey(new Date()),
      };
    },

    /** 近 7 天趋势 + 本周（周一起）Top5 UP 主 */
    week() { return this.period(7); },

    /** 读取并规范化每周观看目标 */
    weeklyGoal() {
      let value = 0;
      try { value = Number(GM_getValue(CONFIG.KEYS.WEEKLY_GOAL, CONFIG.DEFAULT_WEEKLY_GOAL_SECONDS)); } catch (err) { value = CONFIG.DEFAULT_WEEKLY_GOAL_SECONDS; }
      return Number.isFinite(value) && value > 0 ? Math.round(value) : CONFIG.DEFAULT_WEEKLY_GOAL_SECONDS;
    },

    /** 全部汇总；query 非空时按标题 / UP 主过滤（大小写不敏感） */
    all(query, qualityFilter, sortKey) {
      const list = this.allRecords();
      const uploaders = Object.create(null);
      list.forEach(function (r) { uploaders[r.uploader || '未知UP主'] = 1; });
      const q = String(query || '').trim().toLowerCase();
      let matched = q ? list.filter(function (r) {
        return String(r.videoTitle || '').toLowerCase().indexOf(q) >= 0
          || String(r.uploader || '').toLowerCase().indexOf(q) >= 0
          || String(r.bvid || '').toLowerCase().indexOf(q) >= 0;
      }) : list;
      if (qualityFilter && qualityFilter !== 'all') {
        matched = matched.filter(function (r) {
          const progress = Stats.recordProgress(r);
          if (qualityFilter === 'completed') return r.completed === true && progress !== null;
          if (qualityFilter === 'incomplete') return progress !== null && r.completed !== true;
          return progress === null;
        });
      }
      const key = sortKey === 'duration' || sortKey === 'progress' ? sortKey : 'recent';
      const recent = matched.slice().sort(function (a, b) {
        if (key === 'duration') return (Number(b.watchedSeconds) || 0) - (Number(a.watchedSeconds) || 0);
        if (key === 'progress') return (Stats.recordProgress(b) || -1) - (Stats.recordProgress(a) || -1);
        return (b.lastActive || 0) - (a.lastActive || 0);
      });
      return {
        seconds: sumSeconds(list),
        count: list.length,
        uploaderCount: Object.keys(uploaders).length,
        matchedCount: matched.length,
        query: q,
        sortKey: key,
        recent: recent.slice(0, 100),
        quality: this.quality(list, { dedupeByBvid: true }),
      };
    },

    /** 连续观看天数（从今天向前连续有记录的天数） */
    streak() {
      const dates = Object.create(null);
      this.allRecords().forEach(function (r) { if (r.date) dates[r.date] = 1; });
      let n = 0;
      const d = new Date();
      while (dates[formatDate(d)]) {
        n++;
        d.setDate(d.getDate() - 1);
      }
      return n;
    },

    /** 本周与上周的观看时长、视频数、完播率和平均进度对比 */
    weekOverWeek() {
      const records = Store.getRecords();
      const now = new Date();
      const prevDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      const current = records.filter(function (r) { return isSameIsoWeek(r.date, now); });
      const previous = records.filter(function (r) { return isSameIsoWeek(r.date, prevDate); });
      const a = this.quality(current);
      const b = this.quality(previous);
      function delta(currentValue, previousValue) {
        if (previousValue === null || previousValue === undefined || previousValue === 0) return currentValue > 0 ? 100 : 0;
        return (currentValue - previousValue) / previousValue * 100;
      }
      return {
        thisWeek: sumSeconds(current), lastWeek: sumSeconds(previous),
        thisVideos: current.length, lastVideos: previous.length,
        thisCompletionRate: a.completionRate, lastCompletionRate: b.completionRate,
        thisAverageProgress: a.averageProgress, lastAverageProgress: b.averageProgress,
        delta: delta(sumSeconds(current), sumSeconds(previous)),
        videoDelta: delta(current.length, previous.length),
        completionDelta: a.completionRate === null || b.completionRate === null ? null : (a.completionRate - b.completionRate) * 100,
        progressDelta: a.averageProgress === null || b.averageProgress === null ? null : (a.averageProgress - b.averageProgress) * 100,
        hasLast: previous.length > 0,
      };
    },

    /** 根据真实数据生成简短的本周洞察，空数据不伪造结�� */
    insights() {
      const current = this.period(7);
      const wow = this.weekOverWeek();
      if (!current.records.length) return [];
      const out = [];
      out.push('本周观看 ' + current.records.length + ' 个视频' + (wow.hasLast ? '，比上周' + (wow.videoDelta >= 0 ? '多' : '少') + Math.abs(Math.round(wow.videoDelta)) + '%' : '') + '。');
      if (current.quality.averageProgress !== null) out.push('平均进度 ' + formatPercent(current.quality.averageProgress) + (wow.progressDelta === null ? '' : '，较上周' + (wow.progressDelta >= 0 ? '提升' : '下降') + Math.abs(Math.round(wow.progressDelta)) + '%') + '。');
      const peak = current.records.reduce(function (acc, r) { const h = new Date(r.lastActive || r.timestamp || Date.now()).getHours(); acc[h] = (acc[h] || 0) + (Number(r.watchedSeconds) || 0); return acc; }, {});
      const peakHour = Object.keys(peak).sort(function (a, b) { return peak[b] - peak[a]; })[0];
      if (peakHour !== undefined) out.push('主要观看时段为 ' + String(peakHour).padStart(2, '0') + ':00 - ' + String((Number(peakHour) + 2) % 24).padStart(2, '0') + ':00。');
      const repeat = current.records.slice().sort(function (a, b) { return (Number(b.playCount) || 1) - (Number(a.playCount) || 1); })[0];
      if (repeat && Number(repeat.playCount) > 1) out.push('重复观看最多的是《' + (repeat.videoTitle || repeat.bvid) + '》。');
      return out;
    },

    /** 近一年每日观看热力图（周一为列首，共 53 周 × 7 天） */
    heatmap() {
      const daily = Object.create(null);
      this.allRecords().forEach(function (r) {
        if (!r.date) return;
        daily[r.date] = (daily[r.date] || 0) + (Number(r.watchedSeconds) || 0);
      });
      const today = new Date();
      const start = startOfWeek(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364));
      const todayStr = formatDate(today);
      const cells = [];
      for (let w = 0; w < 53; w++) {
        const col = [];
        for (let d = 0; d < 7; d++) {
          const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
          const date = formatDate(cur);
          const future = date > todayStr;
          const sec = daily[date] || 0;
          let level = 0;
          if (sec > 0) level = sec < 900 ? 1 : (sec < 2700 ? 2 : (sec < 7200 ? 3 : 4));
          col.push({ date: date, seconds: sec, level: future ? -1 : level });
        }
        cells.push(col);
      }
      return cells;
    },

    /** 本周报告数据（周一为一周起点） */
    report() {
      const records = Store.getRecords();
      const now = new Date();
      const weekRecords = records.filter(function (r) { return isSameIsoWeek(r.date, now); });
      const quality = this.quality(weekRecords);
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
      if (quality.validProgressCount > 0) {
        summary += ' 完播率 ' + formatPercent(quality.completionRate) + '，平均进度 ' + formatPercent(quality.averageProgress) + '，重复观看 ' + quality.repeatWatchCount + ' 次。';
      } else if (weekRecords.length > 0) {
        summary += ' 视频总时长信息仍在收集中。';
      }
      const wow = Stats.weekOverWeek();
      return {
        weekKey: weekKey(now),
        totalSeconds: sumSeconds(weekRecords),
        totalVideos: weekRecords.length,
        topUploaders: top,
        daily: daily,
        slots: slots,
        peakSlot: peak,
        summary: summary,
        streak: Stats.streak(),
        wow: wow,
        quality: quality,
      };
    },
  };


  /* ============================================================
   * ⑦ UI 面板区
   * 全部 UI 挂在 Shadow DOM，避免与 B 站样式互相污染
   * ============================================================ */

  /** 设计令牌（Design Tokens）：Bilibili Studio 风格，集中管理颜色/间距/圆角/阴影/字体 */
  const TOKENS_CSS = [
    '/* ===== 设计令牌：Bilibili Studio 风格 ===== */',
    ':host {',
    '  --bwp-bg: #f6f7f9;', /* 工作台浅灰背景 */
    '  --bwp-surface: #ffffff;', /* 白色内容面 */
    '  --bwp-surface-muted: #f0f1f3;', /* 浅灰次级面 */
    '  --bwp-border: #e5e6eb;', /* 默认边框 */
    '  --bwp-border-strong: #cdd0d6;', /* 输入框等强调边框 */
    '  --bwp-text: #18191c;', /* 主文字 */
    '  --bwp-text-2: #61666d;', /* 次级文字 */
    '  --bwp-text-3: #9499a0;', /* 三级文字 */
    '  --bwp-text-4: #c9ccd1;', /* 四级文字：占位符/轴线 */
    '  --bwp-pink: #fb7299;', /* B 站粉（强调色） */
    '  --bwp-pink-strong: #e05c82;', /* 深粉：数字/激活态 */
    '  --bwp-pink-soft: #fff1f5;', /* 浅粉底 */
    '  --bwp-pink-border: #ffd6e2;', /* 粉边框 */
    '  --bwp-danger: #e05c82;', /* 危险色（删除/导出） */
    '  --bwp-danger-soft: #fff5f8;', /* 危险浅底 */
    '}',
    '/* 圆角 */',
    ':host { --bwp-radius-sm: 10px; --bwp-radius-md: 12px; --bwp-radius-lg: 14px; }',
    '/* 阴影：中性柔和为主，粉色仅用于 hover 强调 */',
    ':host { --bwp-shadow-sm: 0 1px 3px rgba(24,25,28,.06), 0 1px 2px rgba(24,25,28,.04); --bwp-shadow-md: 0 6px 18px rgba(24,25,28,.14), 0 2px 6px rgba(24,25,28,.08); --bwp-shadow-pink: 0 6px 16px rgba(251,114,153,.24); }',
    '/* 字体 */',
    ':host { --bwp-font: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }',
  ];

  /** 图表色板：B 站粉及近似色系 */
  const CHART_COLORS = ['#fb7299', '#ffb0c9', '#e05c82', '#ffd6e2', '#b84466', '#f7a2bb', '#c9ccd1'];

  /** 面板 HTML 与样式模板（视觉层：设计令牌 + 组件样式 + 结构） */
  const PANEL_HTML = [
    '<style>',
    ':host { all: initial; }',
    ...TOKENS_CSS,
    ':host, * { box-sizing: border-box; }',
    '* { font-family: var(--bwp-font); -webkit-font-smoothing: antialiased; }',
    /* ---------- 浮动按钮（纯色强调，轻中性阴影） ---------- */
    '.bwp-fab {',
    '  position: fixed; z-index: 2147483000; cursor: grab; touch-action: none;',
    '  width: 48px; height: 48px; padding: 0; border: none; border-radius: 14px;',
    '  display: flex; align-items: center; justify-content: center;',
    '  background: var(--bwp-pink); color: #fff; box-shadow: var(--bwp-shadow-md);',
    '  transition: transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .22s ease, background .2s ease;',
    '}',
    '.bwp-fab svg { width: 22px; height: 22px; display: block; pointer-events: none; }',
    '.bwp-fab:hover { transform: translateY(-1px) scale(1.05); background: var(--bwp-pink-strong); box-shadow: var(--bwp-shadow-pink); }',
    '.bwp-fab:active { transform: scale(.94); }',
    /* ---------- 焦点态（可访问性） ---------- */
    '.bwp-fab:focus-visible, .bwp-close:focus-visible, .bwp-tab:focus-visible, .bwp-btn:focus-visible { outline: 2px solid var(--bwp-pink); outline-offset: 2px; }',
    /* ---------- 抽屉面板（浅灰工作台背景） ---------- */
    '.bwp-panel {',
    '  position: fixed; top: 0; right: 0; z-index: 2147483001;',
    '  width: 380px; max-width: 96vw; height: 100vh;',
    '  display: flex; flex-direction: column;',
    '  background: var(--bwp-bg);',
    '  border-left: 1px solid var(--bwp-border); border-radius: 16px 0 0 16px;',
    '  box-shadow: -10px 0 36px rgba(24,25,28,.14), -2px 0 8px rgba(24,25,28,.06);',
    '  transform: translateX(105%); transition: transform .32s cubic-bezier(.32,.72,0,1);',
    '  color: var(--bwp-text); overflow: hidden;',
    '}',
    '.bwp-panel.open { transform: translateX(0); }',
    /* ---------- 头部（白色内容面，无装饰光斑） ---------- */
    '.bwp-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; background: var(--bwp-surface); border-bottom: 1px solid var(--bwp-border); color: var(--bwp-text); }',
    '.bwp-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }',
    '.bwp-logo { flex: none; width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--bwp-pink-soft); color: var(--bwp-pink-strong); }',
    '.bwp-logo svg { width: 18px; height: 18px; }',
    '.bwp-brand-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
    '.bwp-title { font-size: 14.5px; font-weight: 600; line-height: 1.2; letter-spacing: .01em; color: var(--bwp-text); }',
    '.bwp-subtitle { font-size: 10.5px; letter-spacing: .03em; color: var(--bwp-text-3); }',
    '.bwp-close { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 8px; background: var(--bwp-surface-muted); color: var(--bwp-text-2); font-size: 18px; line-height: 1; cursor: pointer; transition: background .2s ease, transform .25s ease; }',
    '.bwp-close:hover { background: var(--bwp-pink-soft); color: var(--bwp-pink-strong); transform: rotate(90deg); }',
    /* ---------- 分段式 Tab ---------- */
    '.bwp-tabs { display: flex; gap: 4px; margin: 12px 12px 0; padding: 4px; background: var(--bwp-surface-muted); border: 1px solid var(--bwp-border); border-radius: var(--bwp-radius-md); }',
    '.bwp-tab { flex: 1; min-width: 0; padding: 8px 0; border: none; border-radius: 9px; background: transparent; color: var(--bwp-text-2); font-size: 12.5px; font-weight: 500; text-align: center; cursor: pointer; transition: color .2s ease, background .2s ease, box-shadow .2s ease; }',
    '.bwp-tab:hover { color: var(--bwp-pink); }',
    '.bwp-tab.active { background: var(--bwp-surface); color: var(--bwp-pink-strong); font-weight: 600; box-shadow: var(--bwp-shadow-sm); }',
    /* ---------- 内容区 ---------- */
    '.bwp-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px 14px 20px; scrollbar-width: thin; scrollbar-color: var(--bwp-border-strong) transparent; }',
    '.bwp-body::-webkit-scrollbar { width: 6px; }',
    '.bwp-body::-webkit-scrollbar-thumb { background: var(--bwp-border-strong); border-radius: 3px; }',
    '.bwp-body::-webkit-scrollbar-track { background: transparent; }',
    /* ---------- 数字卡（白色中性卡，粉色只用于重点数字与顶部细条） ---------- */
    '.bwp-cards { display: flex; gap: 10px; margin-bottom: 12px; }',
    '.bwp-card { position: relative; flex: 1; min-width: 0; padding: 12px 12px 11px; border-radius: var(--bwp-radius-md); border: 1px solid var(--bwp-border); background: var(--bwp-surface); box-shadow: var(--bwp-shadow-sm); overflow: hidden; }',
    '.bwp-card::before { content: ""; position: absolute; left: 12px; top: 0; width: 24px; height: 2.5px; border-radius: 0 0 3px 3px; background: var(--bwp-pink); }',
    '.bwp-card .num { font-size: 21px; font-weight: 700; line-height: 1.15; letter-spacing: -.01em; color: var(--bwp-pink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.bwp-card .lbl { margin-top: 5px; font-size: 11.5px; color: var(--bwp-text-3); }',
    '.bwp-card.compact .num { font-size: 15px; letter-spacing: .01em; color: var(--bwp-text); }',
    '.bwp-cards-3 .bwp-card { padding: 11px 10px; }',
    '.bwp-cards-3 .bwp-card .lbl { font-size: 10.5px; }',
    '.bwp-cards-3 .bwp-card .num { font-size: 15.5px; white-space: normal; overflow-wrap: anywhere; line-height: 1.25; }',
    /* ---------- 区块标题（section 为大分区标题） ---------- */
    '.bwp-sub { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; font-size: 12px; font-weight: 600; color: var(--bwp-text-2); letter-spacing: .02em; }',
    '.bwp-sub::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--bwp-pink); }',
    '.bwp-sub.section { margin: 10px 0 10px; font-size: 13px; color: var(--bwp-text); }',
    '.bwp-sub.section::before { width: 4px; height: 14px; }',
    /* ---------- 图表容器 ---------- */
    '.bwp-chart { position: relative; height: 200px; margin-bottom: 14px; padding: 10px 6px 4px; background: var(--bwp-surface); border: 1px solid var(--bwp-border); border-radius: var(--bwp-radius-md); box-shadow: var(--bwp-shadow-sm); }',
    /* ---------- 空状态 ---------- */
    '.bwp-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 16px; text-align: center; font-size: 12.5px; color: var(--bwp-text-3); }',
    '.bwp-empty .dot { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 16px; color: var(--bwp-pink); background: var(--bwp-pink-soft); border: 1px solid var(--bwp-pink-border); }',
    '.bwp-empty .dot svg { width: 26px; height: 26px; }',
    /* ---------- 记录列表与质量徽标 ---------- */
    '.bwp-list { display: flex; flex-direction: column; gap: 8px; }',
    '.bwp-item { padding: 10px 12px; border-radius: var(--bwp-radius-md); background: var(--bwp-surface); border: 1px solid var(--bwp-border); box-shadow: var(--bwp-shadow-sm); transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }',
    '.bwp-item:hover { transform: translateY(-1px); border-color: var(--bwp-pink-border); box-shadow: var(--bwp-shadow-pink); }',
    '.bwp-item:focus-visible { outline: 2px solid var(--bwp-pink); outline-offset: 2px; }',
    '.bwp-item .t { font-size: 12.5px; font-weight: 600; line-height: 1.45; color: var(--bwp-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.bwp-item .m { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 10.5px; color: var(--bwp-text-3); }',
    '.bwp-item .m span:first-child { color: var(--bwp-text-2); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.bwp-item .m span:last-child { flex: none; color: var(--bwp-text-3); }',
    '.bwp-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }',
    '.bwp-tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; line-height: 1.6; color: var(--bwp-text-2); background: var(--bwp-surface-muted); border: 1px solid var(--bwp-border); white-space: nowrap; }',
    '.bwp-tag.pink { color: var(--bwp-pink-strong); background: var(--bwp-pink-soft); border-color: var(--bwp-pink-border); font-weight: 600; }',
    /* ---------- 底部操作 ---------- */
    '.bwp-footer { display: flex; gap: 9px; padding: 12px 16px 14px; border-top: 1px solid var(--bwp-border); background: var(--bwp-surface); }',
    '.bwp-btn { flex: 1; min-width: 0; padding: 9px 0; border: 1px solid transparent; border-radius: var(--bwp-radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; color: #fff; background: var(--bwp-pink); box-shadow: var(--bwp-shadow-sm); transition: transform .18s ease, box-shadow .18s ease, background .18s ease, color .18s ease; }',
    '.bwp-btn:hover { transform: translateY(-1px); background: var(--bwp-pink-strong); box-shadow: var(--bwp-shadow-pink); }',
    '.bwp-btn:active { transform: translateY(0) scale(.99); }',
    '.bwp-btn.ghost { background: var(--bwp-surface); color: var(--bwp-text-2); border-color: var(--bwp-border-strong); box-shadow: none; }',
    '.bwp-btn.ghost:hover { color: var(--bwp-pink-strong); border-color: var(--bwp-pink-border); background: var(--bwp-surface); box-shadow: none; }',
    '.bwp-btn.danger { background: var(--bwp-surface); color: var(--bwp-danger); border-color: #f3d7db; box-shadow: none; }',
    '.bwp-btn.danger:hover { background: var(--bwp-danger-soft); border-color: var(--bwp-danger); box-shadow: none; }',
    /* ---------- 卡片错峰入场动效 ---------- */
    '@keyframes bwp-rise { from { opacity: 0; transform: translateY(9px) scale(.985); } to { opacity: 1; transform: none; } }',
    '.bwp-anim { animation: bwp-rise .36s cubic-bezier(.22,.9,.3,1) backwards; animation-delay: calc(var(--bwp-i, 0) * 46ms); }',
    '@keyframes bwp-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }',
    '.bwp-rp-bar i { transform-origin: left center; animation: bwp-bar .52s cubic-bezier(.22,.9,.3,1) backwards; }',
    '.bwp-empty .dot { animation: bwp-rise .4s cubic-bezier(.22,.9,.3,1) backwards; }',
    '@media (prefers-reduced-motion: reduce) { .bwp-anim, .bwp-empty .dot, .bwp-toast, .bwp-rp-bar i, .bwp-up-bar i, .bwp-rhythm .col { animation: none; } }',
    /* ---------- 小屏适配 ---------- */
    '@media (max-width: 480px) { .bwp-panel { width: 100vw; max-width: 100vw; border-radius: 0; } .bwp-tabs { margin: 12px 12px 0; } .bwp-body { padding: 14px 12px 18px; } }',
    '@media (prefers-reduced-motion: reduce) { .bwp-fab, .bwp-panel, .bwp-tab, .bwp-btn, .bwp-item, .bwp-close { transition: none; } .bwp-close:hover { transform: none; } }',
    /* ---------- 今日 ---------- */
    '.bwp-today { display: flex; flex-direction: column; }',
    /* ---------- 今日：概览小结（轻量文本行） ---------- */
    '.bwp-summary { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border-radius: var(--bwp-radius-sm); background: var(--bwp-surface-muted); font-size: 11.5px; line-height: 1.6; color: var(--bwp-text-2); }',
    '.bwp-summary .ico { flex: none; width: 18px; height: 18px; margin-top: 1px; color: var(--bwp-pink); }',
    '.bwp-summary .ico svg { width: 18px; height: 18px; display: block; }',
    '.bwp-summary b { color: var(--bwp-pink-strong); font-weight: 600; }',
    /* ---------- 今日：24 小时时间线 ---------- */
    '.bwp-timeline { display: flex; gap: 2px; margin-bottom: 4px; }',
    '.bwp-tl-cell { flex: 1; height: 9px; border-radius: 2px; background: var(--bwp-surface-muted); }',
    '.bwp-tl-cell.h1 { background: #ffe4ee; }',
    '.bwp-tl-cell.h2 { background: #ffc9d8; }',
    '.bwp-tl-cell.h3 { background: var(--bwp-pink); }',
    '.bwp-tl-cell.h4 { background: #d9436f; }',
    '.bwp-tl-axis { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 9.5px; color: var(--bwp-text-4); }',
    /* ---------- 今日：本周节奏条 ---------- */
    '.bwp-rhythm { display: flex; align-items: flex-end; gap: 7px; flex: 0 0 84px; min-height: 84px; margin-bottom: 6px; padding: 8px 10px 0; border-radius: var(--bwp-radius-md); border: 1px solid var(--bwp-border); background: var(--bwp-surface); box-shadow: var(--bwp-shadow-sm); }',
    '.bwp-rhythm .bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 5px; height: 100%; }',
    '.bwp-rhythm .col { width: 100%; max-width: 26px; min-height: 4px; border-radius: 6px 6px 3px 3px; background: var(--bwp-pink-border); transform-origin: bottom center; animation: bwp-grow .5s cubic-bezier(.22,.9,.3,1) backwards; }',
    '.bwp-rhythm .bar.today .col { background: var(--bwp-pink); }',
    '.bwp-rhythm .day { flex: none; font-size: 9.5px; color: var(--bwp-text-4); }',
    '.bwp-rhythm .bar.today .day { color: var(--bwp-pink-strong); font-weight: 600; }',
    '@keyframes bwp-grow { from { transform: scaleY(.06); opacity: .35; } to { transform: scaleY(1); opacity: 1; } }',
    '.bwp-rhythm-cap { margin-bottom: 14px; font-size: 10.5px; color: var(--bwp-text-3); }',
    '.bwp-rhythm-cap b { color: var(--bwp-pink-strong); }',
    /* ---------- 今日：观看时段 ---------- */
    '.bwp-slots { display: flex; gap: 8px; margin-bottom: 14px; }',
    '.bwp-slot { flex: 1; min-width: 0; padding: 9px 4px; text-align: center; border-radius: var(--bwp-radius-sm); border: 1px solid var(--bwp-border); background: var(--bwp-surface); }',
    '.bwp-slot .s { font-size: 10.5px; color: var(--bwp-text-2); }',
    '.bwp-slot .v { margin-top: 4px; font-size: 12px; font-weight: 700; color: var(--bwp-text-3); }',
    '.bwp-slot.hot { border-color: var(--bwp-pink-border); background: var(--bwp-pink-soft); }',
    '.bwp-slot.hot .s { color: var(--bwp-pink-strong); font-weight: 600; }',
    '.bwp-slot.hot .v { color: var(--bwp-pink-strong); }',
    /* ---------- 今日：UP 主分布（环形图 + 排行） ---------- */
    '.bwp-today-up { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }',
    '.bwp-today-up .bwp-donut { flex: none; width: 132px; height: 132px; margin-bottom: 0; padding: 0; }',
    '.bwp-up-list { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }',
    '.bwp-up-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }',
    '.bwp-up-row .nm { flex: 1; min-width: 0; font-size: 11.5px; color: var(--bwp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.bwp-up-row .pct { flex: none; font-size: 10.5px; font-weight: 600; color: var(--bwp-pink-strong); }',
    '.bwp-up-bar { height: 5px; margin-top: 4px; border-radius: 999px; background: var(--bwp-surface-muted); overflow: hidden; }',
    '.bwp-up-bar i { display: block; height: 100%; border-radius: 999px; background: var(--bwp-pink); transform-origin: left center; animation: bwp-bar .52s cubic-bezier(.22,.9,.3,1) backwards; }',
    '@media (max-width: 380px) { .bwp-today-up { flex-direction: column; align-items: stretch; } .bwp-today-up .bwp-donut { width: 100%; height: 150px; } }',
    /* ---------- 归档提示条 ---------- */
    '.bwp-notice { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; padding: 9px 11px; border-radius: var(--bwp-radius-sm); border: 1px solid var(--bwp-pink-border); background: var(--bwp-pink-soft); font-size: 11px; line-height: 1.55; color: #b84466; }',
    '.bwp-notice button { flex: none; margin-left: auto; border: none; background: transparent; color: var(--bwp-pink-strong); font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px; }',
    /* ---------- 搜索框 ---------- */
    '.bwp-search { display: flex; align-items: center; gap: 8px; height: 36px; margin-bottom: 10px; padding: 0 12px; border-radius: var(--bwp-radius-sm); border: 1px solid var(--bwp-border-strong); background: var(--bwp-surface); transition: border-color .18s ease, box-shadow .18s ease; }',
    '.bwp-search:focus-within { border-color: var(--bwp-pink); box-shadow: 0 0 0 3px rgba(251,114,153,.12); }',
    '.bwp-search svg { flex: none; width: 15px; height: 15px; color: var(--bwp-text-3); }',
    '.bwp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 12.5px; color: var(--bwp-text); }',
    '.bwp-search input::placeholder { color: var(--bwp-text-4); }',
    '.bwp-rec-hint { margin: 0 0 8px; font-size: 10.5px; color: var(--bwp-text-3); }',
    '.bwp-quality { margin: 0 0 14px; }',
    '.bwp-quality .bwp-cards { margin-bottom: 0; }',
    '.bwp-session-title { margin-top: 12px; }',
    '.bwp-detail-drawer { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; background: var(--bwp-bg); color: var(--bwp-text); }',
    '.bwp-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; background: var(--bwp-surface); border-bottom: 1px solid var(--bwp-border); }',
    '.bwp-detail-back { border: none; background: transparent; color: var(--bwp-pink-strong); font-size: 12px; font-weight: 600; cursor: pointer; padding: 6px 2px; }',
    '.bwp-detail-body { overflow-y: auto; padding: 16px 14px 24px; }',
    '.bwp-detail-body h3 { margin: 0; font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; }',
    '.bwp-detail-meta { margin: 6px 0 14px; color: var(--bwp-text-3); font-size: 11px; }',
    '.bwp-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }',
    '.bwp-detail-grid > div { min-width: 0; padding: 10px; border: 1px solid var(--bwp-border); border-radius: var(--bwp-radius-sm); background: var(--bwp-surface); }',
    '.bwp-detail-grid .k { display: block; color: var(--bwp-text-3); font-size: 10.5px; }',
    '.bwp-detail-grid .v { display: block; margin-top: 4px; color: var(--bwp-text); font-size: 12px; overflow-wrap: anywhere; }',
    '.bwp-filter { display: flex; gap: 6px; margin-bottom: 10px; }',
    '.bwp-filter select { flex: 1; min-width: 0; padding: 8px 9px; border: 1px solid var(--bwp-border-strong); border-radius: var(--bwp-radius-sm); background: var(--bwp-surface); color: var(--bwp-text-2); font-size: 11.5px; }',
    /* ---------- 年度热力图 ---------- */
    '.bwp-heat { display: flex; gap: 2px; align-items: flex-start; margin: 2px 0 6px; }',
    '.bwp-heat-col { display: flex; flex: 1; flex-direction: column; gap: 2px; }',
    '.bwp-heat-cell { display: block; width: 100%; aspect-ratio: 1 / 1; border-radius: 2px; background: var(--bwp-surface-muted); }',
    '.bwp-heat-cell.lv1 { background: #ffe4ee; }',
    '.bwp-heat-cell.lv2 { background: #ffc9d8; }',
    '.bwp-heat-cell.lv3 { background: var(--bwp-pink); }',
    '.bwp-heat-cell.lv4 { background: #d9436f; }',
    '.bwp-heat-cell.future { background: transparent; }',
    '.bwp-heat-legend { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin: 0 0 12px; font-size: 10px; color: var(--bwp-text-3); }',
    '.bwp-heat-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: var(--bwp-surface-muted); }',
    '.bwp-heat-legend i.lv1 { background: #ffe4ee; } .bwp-heat-legend i.lv2 { background: #ffc9d8; } .bwp-heat-legend i.lv3 { background: var(--bwp-pink); } .bwp-heat-legend i.lv4 { background: #d9436f; }',
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
    '    <button class="bwp-btn" data-act="export">导出JSON</button>',
    '    <button class="bwp-btn ghost" data-act="import">导入JSON</button>',
    '    <button class="bwp-btn danger" data-act="clear">清空</button>',
    '  </footer>',
    '</aside>',
  ].join('\n');


  const Panel = {
    host: null,
    root: null,
    el: {},
    charts: {},
    current: '今日',
    allQuery: '',
    qualityFilter: 'all',
    allSort: 'recent',
    weekRangeDays: 7,
    open: false,
    mounted: false,
    detailDrawer: null,

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

        // 先挂载再测量，避免浏览器缩放后使用错误的按钮尺寸计算位置。
        document.body.appendChild(host);
        this.placeFab(window.innerWidth - this.el.fab.offsetWidth - 16, 72);
        this.buildTabs();
        this.bind();
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
        if (act === 'import') self.importJSON();
        if (act === 'clear') self.clearAll();
      });
      // ESC 关闭
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !self.open) return;
        if (self.detailDrawer) self.closeRecordDetail();
        else self.hide();
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
        const saved = GM_getValue(CONFIG.KEYS.FAB_POS, null);
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) self.placeFab(saved.x, saved.y);
      } catch (err) { /* 位置读取失败用默认值 */ }

      // 浏览器缩放会触发 resize，重新按当前视口吸附，避免按钮被留在视口外。
      if (!this._fabResizeBound) {
        this._fabResizeBound = true;
        window.addEventListener('resize', debounce(function () {
          const rect = fab.getBoundingClientRect();
          const rightSide = rect.left + rect.width / 2 > window.innerWidth / 2;
          const x = rightSide ? window.innerWidth - rect.width - 12 : rect.left;
          self.placeFab(x, rect.top, true);
        }, 100));
      }

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
        try { GM_setValue(CONFIG.KEYS.FAB_POS, { x: nx, y: ny }); } catch (err) { /* 忽略 */ }
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
        self.closeRecordDetail();
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
        self.closeRecordDetail();
        self.el.body.innerHTML = '';
        if (self.current === '今日') self.renderToday();
        else if (self.current === '本周') self.renderWeek();
        else if (self.current === '全部') self.renderAll();
        else if (self.current === '报告' && typeof self.renderReportTab === 'function') self.renderReportTab();
      }, 'Panel.render.' + self.current);
    },

    bindRecordItem(item, record) {
      const self = this;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', '查看观看记录详情');
      item.addEventListener('click', function () { self.showRecordDetail(record); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          self.showRecordDetail(record);
        }
      });
    },

    showRecordDetail(record) {
      this.closeRecordDetail();
      if (!record || !this.el.panel) return;
      const drawer = document.createElement('section');
      drawer.className = 'bwp-detail-drawer';
      const head = document.createElement('div');
      head.className = 'bwp-detail-head';
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'bwp-detail-back'; back.textContent = '‹ 返回';
      back.addEventListener('click', this.closeRecordDetail.bind(this));
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'bwp-close'; close.textContent = '×';
      close.addEventListener('click', this.closeRecordDetail.bind(this));
      head.appendChild(back); head.appendChild(close);
      drawer.appendChild(head);

      const body = document.createElement('div');
      body.className = 'bwp-detail-body';
      const title = document.createElement('h3');
      title.textContent = record.videoTitle || record.bvid || '未知视频';
      body.appendChild(title);
      const meta = document.createElement('p');
      meta.className = 'bwp-detail-meta';
      meta.textContent = (record.uploader || '未知UP主') + ' · ' + record.date;
      body.appendChild(meta);

      const sessions = Stats.sessionStats([record]);
      const sessionList = Array.isArray(record.sessions) ? record.sessions.slice().sort(function (a, b) { return a.startAt - b.startAt; }) : [];
      const firstAt = sessionList.length ? sessionList[0].startAt : record.timestamp;
      const recentAt = sessionList.length ? sessionList[sessionList.length - 1].endAt : record.lastActive;
      body.appendChild(this.cards([
        { num: formatDuration(record.watchedSeconds), lbl: '总观看时长', compact: true },
        { num: formatPercent(Stats.recordProgress(record)), lbl: '最高进度', compact: true },
        { num: record.completed ? '已完播' : '未完播', lbl: '完播状态', compact: true },
        { num: sessions.sessionCount ? String(sessions.sessionCount) : '暂无数据', lbl: '播放会话数', compact: true },
      ]));

      const grid = document.createElement('div');
      grid.className = 'bwp-detail-grid';
      const values = [
        ['首次观看', formatDateTime(firstAt)],
        ['最近观看', formatDateTime(recentAt)],
        ['中断率', sessions.sessionCount ? formatPercent(sessions.interruptionRate) : '暂无数据'],
        ['平均单次会话', sessions.sessionCount ? formatDuration(sessions.averageSessionSeconds) : '暂无数据'],
        ['暂停次数', String(sessions.pauseCount)],
        ['切后台次数', String(sessions.backgroundCount)],
        ['跳转次数', String(sessions.seekCount)],
        ['BV 号', record.bvid || '—'],
      ];
      values.forEach(function (entry) {
        const cell = document.createElement('div');
        const label = document.createElement('span'); label.className = 'k'; label.textContent = entry[0];
        const value = document.createElement('strong'); value.className = 'v'; value.textContent = entry[1];
        cell.appendChild(label); cell.appendChild(value); grid.appendChild(cell);
      });
      body.appendChild(grid);
      drawer.appendChild(body);
      this.el.panel.appendChild(drawer);
      this.detailDrawer = drawer;
    },

    closeRecordDetail() {
      if (this.detailDrawer && this.detailDrawer.parentNode) this.detailDrawer.parentNode.removeChild(this.detailDrawer);
      this.detailDrawer = null;
    },

    /** 今日 Tab：今日概览 → 观看质量 → 趋势 → 观看记录 */
    renderToday() {
      const data = Stats.today();
      if (data.count === 0) { this.empty('今天还没有观看记录'); return; }

      const deltaNum = data.yesterday > 0
        ? Math.round((data.seconds - data.yesterday) / data.yesterday * 100)
        : null;
      const deltaText = deltaNum === null
        ? '—'
        : (deltaNum >= 0 ? '▲+' : '▼') + Math.abs(deltaNum) + '%';

      // 今日内容容器
      const wrap = document.createElement('div');
      wrap.className = 'bwp-today';
      this.el.body.appendChild(wrap);

      // ① 今日概览：3 大卡 + 轻量小结条
      wrap.appendChild(this.subTitle('今日概览', 'section'));
      wrap.appendChild(this.cards([
        { num: formatDuration(data.seconds), lbl: '今日总时长' },
        { num: String(data.count), lbl: '今日视频数' },
        { num: deltaText, lbl: data.yesterday > 0 ? '较昨日' : '昨日无数据' },
      ]));
      const fav = data.byUploader[0];
      const sum = document.createElement('div');
      sum.className = 'bwp-summary bwp-anim';
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v2"/><path d="M5 7h14"/><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.innerHTML = '今天共看 <b>' + data.count + '</b> 个视频，'
        + '累计 <b>' + formatDuration(data.seconds) + '</b>'
        + (deltaNum === null ? '' : '，比昨天' + (deltaNum >= 0 ? '多' : '少') + '<b>' + Math.abs(deltaNum) + '%</b>')
        + (data.peakSlot ? '，视频记录最近多在<b>' + data.peakSlot + '</b>活跃' : '')
        + (fav ? '，最爱 <b>' + escapeHTML(fav.name) + '</b>' : '') + '。';
      sum.appendChild(ico); sum.appendChild(txt);
      wrap.appendChild(sum);

      // ② 观看质量（4 紧凑卡）
      wrap.appendChild(this.qualityBlock(data.quality, true));

      // ③ 趋势：时段 → 24 小时时间线 → 本周节奏 → UP 主分布
      wrap.appendChild(this.subTitle('趋势', 'section'));

      // 视频最后活跃时段（四段，高亮记录数最多的时段）
      wrap.appendChild(this.subTitle('视频活跃时段'));
      const slots = document.createElement('div');
      slots.className = 'bwp-slots bwp-anim';
      data.slots.forEach(function (s) {
        const d = document.createElement('div');
        d.className = 'bwp-slot' + (s.name === data.peakSlot ? ' hot' : '');
        const n = document.createElement('div'); n.className = 's'; n.textContent = s.name;
        const v = document.createElement('div'); v.className = 'v';
        v.textContent = s.count > 0 ? s.count + '个' : '—';
        d.appendChild(n); d.appendChild(v);
        slots.appendChild(d);
      });
      wrap.appendChild(slots);

      // 24 小时最后活跃时间线
      wrap.appendChild(this.subTitle('视频最近活跃时间'));
      const tl = document.createElement('div');
      tl.className = 'bwp-timeline bwp-anim';
      const maxH = Math.max.apply(null, data.hours.map(function (x) { return x.count; })) || 0;
      data.hours.forEach(function (x) {
        const cell = document.createElement('i');
        let lv = 0;
        if (x.count > 0 && maxH > 0) {
          const ratio = x.count / maxH;
          lv = ratio > 0.75 ? 4 : (ratio > 0.4 ? 3 : (ratio > 0.15 ? 2 : 1));
        }
        cell.className = 'bwp-tl-cell' + (lv ? ' h' + lv : '');
        cell.title = pad2(x.h) + ':00 · ' + (x.count > 0 ? x.count + ' 条视频记录' : '无记录');
        tl.appendChild(cell);
      });
      wrap.appendChild(tl);
      const axis = document.createElement('div');
      axis.className = 'bwp-tl-axis';
      ['00:00', '06:00', '12:00', '18:00', '23:00'].forEach(function (t) {
        const s = document.createElement('span'); s.textContent = t; axis.appendChild(s);
      });
      wrap.appendChild(axis);

      // 本周节奏：今天在近 7 天中的位置
      const week = Stats.week();
      const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
      const maxDay = Math.max.apply(null, week.daily.map(function (x) { return x.seconds; })) || 0;
      wrap.appendChild(this.subTitle('本周节奏'));
      const rhythm = document.createElement('div');
      rhythm.className = 'bwp-rhythm bwp-anim';
      week.daily.forEach(function (x, i) {
        const d = new Date(x.date + 'T00:00:00');
        const isToday = x.date === data.date;
        const bar = document.createElement('div');
        bar.className = 'bar' + (isToday ? ' today' : '');
        const col = document.createElement('div');
        col.className = 'col';
        const ratio = maxDay > 0 ? x.seconds / maxDay : 0;
        col.style.height = (x.seconds > 0 ? Math.max(8, Math.round(ratio * 100)) : 4) + '%';
        col.style.animationDelay = (i * 55) + 'ms';
        col.title = x.label + ' · ' + (x.seconds > 0 ? formatDuration(x.seconds) : '无记录');
        const day = document.createElement('div');
        day.className = 'day';
        day.textContent = DAY_LABELS[d.getDay()];
        bar.appendChild(col); bar.appendChild(day);
        rhythm.appendChild(bar);
      });
      wrap.appendChild(rhythm);
      const cap = document.createElement('div');
      cap.className = 'bwp-rhythm-cap';
      const weekTotal = week.daily.reduce(function (a, x) { return a + x.seconds; }, 0);
      const share = weekTotal > 0 ? Math.round(data.seconds / weekTotal * 100) : 0;
      cap.innerHTML = '近 7 天累计 <b>' + formatDuration(weekTotal) + '</b>，今天占 <b>' + share + '%</b>';
      wrap.appendChild(cap);

      // UP 主分布：环形图 + 占比排行
      wrap.appendChild(this.subTitle('按 UP 主分布'));
      const upWrap = document.createElement('div');
      upWrap.className = 'bwp-today-up bwp-anim';
      upWrap.appendChild(this.chartBox('todayUploader', 'bwp-donut'));

      const upList = document.createElement('div');
      upList.className = 'bwp-up-list';
      const top = data.byUploader.slice(0, 5);
      const maxSec = top.length && top[0].seconds > 0 ? top[0].seconds : 1;
      const totalSec = data.seconds || 1;
      top.forEach(function (u, i) {
        const row = document.createElement('div');
        const head = document.createElement('div');
        head.className = 'bwp-up-row';
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = u.name;
        const pct = document.createElement('span'); pct.className = 'pct';
        pct.textContent = Math.round(u.seconds / totalSec * 100) + '%';
        head.appendChild(nm); head.appendChild(pct);
        const bar = document.createElement('div');
        bar.className = 'bwp-up-bar';
        const inner = document.createElement('i');
        inner.style.width = Math.max(6, Math.round(u.seconds / maxSec * 100)) + '%';
        inner.style.animationDelay = (120 + i * 70) + 'ms';
        bar.appendChild(inner);
        row.appendChild(head); row.appendChild(bar);
        upList.appendChild(row);
      });
      upWrap.appendChild(upList);
      wrap.appendChild(upWrap);

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
        options: {
          cutout: '66%',
          plugins: { legend: { display: false } },
        },
      });

      // ④ 观看记录
      wrap.appendChild(this.subTitle('观看记录', 'section'));
      const list = document.createElement('div');
      list.className = 'bwp-list';
      data.detail.forEach(function (r, i) {
        const item = document.createElement('div');
        item.className = 'bwp-item bwp-anim';
        item.style.setProperty('--bwp-i', Math.min(i, 8));
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = r.videoTitle || r.bvid || '未知视频';
        const m = document.createElement('div');
        m.className = 'm';
        const left = document.createElement('span');
        left.textContent = r.uploader || '未知UP主';
        const right = document.createElement('span');
        right.textContent = formatClock(r.lastActive) + (r.openCount > 1 ? ' · 打开' + r.openCount + '次' : '');
        m.appendChild(left); m.appendChild(right);
        const tags = document.createElement('div');
        tags.className = 'bwp-tags';
        const progress = Stats.recordProgress(r);
        const tagP = document.createElement('span');
        tagP.className = 'bwp-tag pink';
        tagP.textContent = '进度 ' + formatPercent(progress);
        const tagT = document.createElement('span');
        tagT.className = 'bwp-tag';
        tagT.textContent = formatDuration(r.watchedSeconds);
        tags.appendChild(tagP); tags.appendChild(tagT);
        if (r.playCount > 1) {
          const tagR = document.createElement('span');
          tagR.className = 'bwp-tag';
          tagR.textContent = '重看 ' + (r.playCount - 1) + ' 次';
          tags.appendChild(tagR);
        }
        item.appendChild(t); item.appendChild(m); item.appendChild(tags);
        Panel.bindRecordItem(item, r);
        list.appendChild(item);
      });
      wrap.appendChild(list);
    },
    /** 本周 Tab */
    renderWeek() {
      const data = Stats.period(this.weekRangeDays || 7);
      const wow = Stats.weekOverWeek();
      const streak = Stats.streak();
      const deltaText = wow.hasLast
        ? (wow.delta >= 0 ? '▲+' : '▼') + Math.abs(Math.round(wow.delta)) + '%'
        : '—';
      this.el.body.appendChild(this.cards([
        { num: formatDuration(data.totalSeconds), lbl: data.days === 30 ? '近30天总时长' : '近7天总时长' },
        { num: streak > 0 ? streak + '天' : '0天', lbl: '连续观看' },
        { num: deltaText, lbl: '时长环比' },
        { num: wow.hasLast ? (wow.videoDelta >= 0 ? '▲+' : '▼') + Math.abs(Math.round(wow.videoDelta)) + '%' : '—', lbl: '视频数环比' },
      ]));
      this.el.body.appendChild(this.qualityBlock(data.quality, true));
      const comparison = document.createElement('div');
      comparison.className = 'bwp-rec-hint';
      comparison.textContent = !wow.hasLast
        ? '上周暂无可比较的观看数据'
        : '完播率 ' + (wow.completionDelta === null ? '暂无可比较数据' : (wow.completionDelta >= 0 ? '提升 ' : '下降 ') + Math.abs(Math.round(wow.completionDelta)) + ' 个百分点') + ' · 平均进度 ' + (wow.progressDelta === null ? '暂无可比较数据' : (wow.progressDelta >= 0 ? '提升 ' : '下降 ') + Math.abs(Math.round(wow.progressDelta)) + ' 个百分点');
      this.el.body.appendChild(comparison);
      const range = document.createElement('div');
      range.className = 'bwp-filter';
      [7, 30].forEach(function (days) {
        const button = document.createElement('button');
        button.textContent = days === 7 ? '近 7 天' : '近 30 天';
        button.className = days === (this.weekRangeDays || 7) ? 'active' : '';
        button.addEventListener('click', function () { this.weekRangeDays = days; this.destroyCharts(); this.render(); }.bind(this));
        range.appendChild(button);
      }, this);
      this.el.body.appendChild(range);
      const insights = Stats.insights();
      this.el.body.appendChild(this.subTitle('本周洞察'));
      if (insights.length) insights.forEach(function (text) { const node = document.createElement('div'); node.className = 'bwp-rec-hint'; node.textContent = text; this.el.body.appendChild(node); }, this);
      else this.el.body.appendChild(this.emptyNode('本周暂无足够数据生成洞察'));
      const goal = Stats.weeklyGoal();
      const goalData = Stats.period(7);
      const goalWrap = document.createElement('div');
      goalWrap.className = 'bwp-rec-hint';
      goalWrap.textContent = '每周目标：' + formatDuration(goal) + ' · 已完成 ' + formatPercent(Math.min(1, goalData.totalSeconds / goal));
      this.el.body.appendChild(goalWrap);
      const goalForm = document.createElement('div');
      goalForm.className = 'bwp-filter';
      const goalInput = document.createElement('input');
      goalInput.type = 'number'; goalInput.min = '1'; goalInput.step = '5'; goalInput.value = Math.round(goal / 60); goalInput.title = '每周目标分钟数';
      const goalButton = document.createElement('button'); goalButton.textContent = '保存目标';
      goalButton.addEventListener('click', function () { const minutes = Number(goalInput.value); if (!Number.isFinite(minutes) || minutes <= 0) return; GM_setValue(CONFIG.KEYS.WEEKLY_GOAL, Math.round(minutes * 60)); this.render(); }.bind(this));
      goalForm.appendChild(goalInput); goalForm.appendChild(document.createTextNode(' 分钟/周 ')); goalForm.appendChild(goalButton);
      this.el.body.appendChild(goalForm);
      this.el.body.appendChild(this.subTitle((data.days === 30 ? '近 30 天' : '近 7 天') + '每日时长 · ' + data.weekKey));
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
      this.el.body.appendChild(this.subTitle('每日完播率'));
      this.el.body.appendChild(this.chartBox('weekCompletion'));
      this.makeChart('weekCompletion', {
        type: 'line',
        data: { labels: data.daily.map(function (d) { return d.label; }), datasets: [{ label: '完播率', data: data.daily.map(function (d) { return Stats.completionRate(Store.getRecords().filter(function (r) { return r.date === d.date; })); }).map(function (v) { return v === null ? null : Math.round(v * 100); }), borderColor: CHART_COLORS[2], backgroundColor: 'rgba(224,92,130,.12)', fill: true, tension: .35, pointRadius: 3 }] },
        options: { scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } } }, plugins: { legend: { display: false } } },
      });
      this.el.body.appendChild(this.subTitle('每日平均观看进度'));
      this.el.body.appendChild(this.chartBox('weekProgress'));
      this.makeChart('weekProgress', {
        type: 'bar',
        data: { labels: data.daily.map(function (d) { return d.label; }), datasets: [{ label: '平均进度', data: data.daily.map(function (d) { const q = Stats.quality(Store.getRecords().filter(function (r) { return r.date === d.date; })); return q.averageProgress === null ? null : Math.round(q.averageProgress * 100); }), backgroundColor: CHART_COLORS[1], borderRadius: 8, borderSkipped: false }] },
        options: { scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } } }, plugins: { legend: { display: false } } },
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

    /** 全部 Tab：归档提示 + 年度热力图 + 记录搜索 */
    renderAll() {
      const self = this;
      const data = Stats.all(this.allQuery, this.qualityFilter, this.allSort);
      if (data.count === 0) { this.empty('还没有任何观看记录'); return; }
      this.el.body.appendChild(this.cards([
        { num: formatDuration(data.seconds), lbl: '累计总时长' },
        { num: String(data.count), lbl: '总视频数' },
        { num: String(data.uploaderCount), lbl: '覆盖UP主' },
      ]));
      this.el.body.appendChild(this.qualityBlock(data.quality, true));

      this.el.body.appendChild(this.archiveNotice());

      this.el.body.appendChild(this.subTitle('近一年观看热力图'));
      this.el.body.appendChild(this.heatmapNode());

      this.el.body.appendChild(this.subTitle('观看记录'));
      const search = this.searchBox(function (value) {
        self.allQuery = value;
        self.destroyCharts();
        self.render();
        const input = self.el.body.querySelector('.bwp-search input');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      });
      this.el.body.appendChild(search);
      const filter = document.createElement('div');
      filter.className = 'bwp-filter';
      const select = document.createElement('select');
      [['all', '全部'], ['completed', '已完播'], ['incomplete', '未完播'], ['unknown', '进度未知']].forEach(function (item) {
        const option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; option.selected = self.qualityFilter === item[0]; select.appendChild(option);
      });
      select.addEventListener('change', function () { self.qualityFilter = select.value; self.render(); });
      filter.appendChild(select);
      const sort = document.createElement('select');
      [['recent', '最近观看'], ['duration', '观看时长'], ['progress', '观看进度']].forEach(function (item) { const option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; option.selected = self.allSort === item[0]; sort.appendChild(option); });
      sort.addEventListener('change', function () { self.allSort = sort.value; self.render(); });
      filter.appendChild(sort);
      this.el.body.appendChild(filter);

      const hint = document.createElement('div');
      hint.className = 'bwp-rec-hint';
      hint.textContent = data.query
        ? '匹配 ' + data.matchedCount + ' 条，最多显示 100 条'
        : '共 ' + data.count + ' 条，按最近观看排序，最多显示 100 条';
      this.el.body.appendChild(hint);

      if (data.recent.length === 0) {
        this.el.body.appendChild(this.emptyNode('没有匹配的记录'));
        return;
      }
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
        left.textContent = r.uploader || '未知UP主';
        const right = document.createElement('span');
        right.textContent = r.date + (r.openCount > 1 ? ' · 打开' + r.openCount + '次' : '');
        m.appendChild(left); m.appendChild(right);
        const tags = document.createElement('div');
        tags.className = 'bwp-tags';
        const progress = Stats.recordProgress(r);
        const tagP = document.createElement('span');
        tagP.className = 'bwp-tag pink';
        tagP.textContent = '进度 ' + formatPercent(progress);
        const tagT = document.createElement('span');
        tagT.className = 'bwp-tag';
        tagT.textContent = formatDuration(r.watchedSeconds);
        tags.appendChild(tagP); tags.appendChild(tagT);
        if (r.playCount > 1) {
          const tagR = document.createElement('span');
          tagR.className = 'bwp-tag';
          tagR.textContent = '重看 ' + (r.playCount - 1) + ' 次';
          tags.appendChild(tagR);
        }
        item.appendChild(t); item.appendChild(m); item.appendChild(tags);
        Panel.bindRecordItem(item, r);
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

    qualityBlock(quality, compact) {
      const wrap = document.createElement('div');
      wrap.className = 'bwp-quality';
      wrap.appendChild(this.subTitle('观看质量'));
      wrap.appendChild(this.cards([
        { num: formatPercent(quality.completionRate), lbl: '完播率', compact: compact },
        { num: formatPercent(quality.averageProgress), lbl: '平均进度', compact: compact },
        { num: quality.repeatWatchCount ? quality.repeatWatchCount + '次' : '—', lbl: '重复观看', compact: compact },
        { num: quality.averageVideoDuration === null ? '—' : formatDuration(quality.averageVideoDuration), lbl: '平均单视频时长', compact: compact },
      ]));
      const sessionTitle = this.subTitle('播放会话');
      sessionTitle.className += ' bwp-session-title';
      wrap.appendChild(sessionTitle);
      wrap.appendChild(this.cards([
        { num: quality.sessionCount ? formatPercent(quality.interruptionRate) : '暂无数据', lbl: '中断率', compact: true },
        { num: quality.sessionCount ? formatDuration(quality.averageSessionSeconds) : '暂无数据', lbl: '平均单次会话', compact: true },
      ]));
      return wrap;
    },
    subTitle(text, cls) {
      const el = document.createElement('div');
      el.className = 'bwp-sub' + (cls ? ' ' + cls : '');
      el.textContent = text;
      return el;
    },

    chartBox(id, extraClass) {
      const box = document.createElement('div');
      box.className = 'bwp-chart bwp-anim' + (extraClass ? ' ' + extraClass : '');
      const cv = document.createElement('canvas');
      cv.id = id;
      box.appendChild(cv);
      return box;
    },

    /** 归档已达上限提示条；无提示返回空节点 */
    archiveNotice() {
      const notice = Store.getArchiveNotice();
      if (!notice) { const f = document.createDocumentFragment(); return f; }
      const el = document.createElement('div');
      el.className = 'bwp-notice';
      const txt = document.createElement('span');
      txt.textContent = '归档已达上限，已裁剪最早的 ' + Number(notice.dropped) + ' 条记录（' + formatDate(new Date(notice.at || Date.now())) + '）。建议先导出 JSON 备份。';
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', '关闭提示');
      x.addEventListener('click', function () { el.remove(); });
      el.appendChild(txt); el.appendChild(x);
      return el;
    },

    /** 年度热力图（53 周 × 7 天，纯 DOM 无需图表库） */
    heatmapNode() {
      const weeks = Stats.heatmap();
      const wrap = document.createElement('div');
      wrap.className = 'bwp-anim';
      const grid = document.createElement('div');
      grid.className = 'bwp-heat';
      weeks.forEach(function (col) {
        const c = document.createElement('div');
        c.className = 'bwp-heat-col';
        col.forEach(function (day) {
          const cell = document.createElement('i');
          cell.className = 'bwp-heat-cell'
            + (day.level < 0 ? ' future' : (day.level > 0 ? ' lv' + day.level : ''));
          cell.title = day.level < 0
            ? day.date + ' · 未到'
            : day.date + ' · ' + (day.seconds > 0 ? formatDuration(day.seconds) : '无记录');
          c.appendChild(cell);
        });
        grid.appendChild(c);
      });
      wrap.appendChild(grid);
      const legend = document.createElement('div');
      legend.className = 'bwp-heat-legend';
      const label0 = document.createElement('span'); label0.textContent = '少';
      legend.appendChild(label0);
      [1, 2, 3, 4].forEach(function (lv) {
        const i = document.createElement('i');
        i.className = 'lv' + lv;
        legend.appendChild(i);
      });
      const label1 = document.createElement('span'); label1.textContent = '多';
      legend.appendChild(label1);
      wrap.appendChild(legend);
      return wrap;
    },

    /** 记录搜索框 */
    searchBox(onInput) {
      const box = document.createElement('div');
      box.className = 'bwp-search';
      const icon = document.createElement('span');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = '搜索视频标题 / UP 主 / BV 号';
      input.value = this.allQuery || '';
      const onChange = debounce(function () { onInput(input.value); }, 220);
      input.addEventListener('input', onChange);
      box.appendChild(icon); box.appendChild(input);
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
          sc.grid.color = sc.grid.color || 'rgba(24,25,28,.06)';
          sc.grid.drawTicks = sc.grid.drawTicks === undefined ? false : sc.grid.drawTicks;
          sc.border = sc.border || {};
          sc.border.display = sc.border.display === undefined ? false : sc.border.display;
          sc.ticks = sc.ticks || {};
          if (sc.ticks.color === undefined) sc.ticks.color = '#9499a0';
          if (sc.ticks.padding === undefined) sc.ticks.padding = 6;
          if (sc.ticks.font === undefined) sc.ticks.font = { size: 10.5 };
          if (sc.ticks.maxRotation === undefined) sc.ticks.maxRotation = 0;
          if (sc.ticks.autoSkip === undefined) sc.ticks.autoSkip = true;
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
          weeklyGoalSeconds: Stats.weeklyGoal(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, 'bwp-backup-' + todayStr() + '.json');
        log('已导出 JSON 备份');
      } catch (err) {
        logError('Panel.exportJSON', err);
      }
    },

    /** 导入 JSON 备份：按「日期 + bvid」合并，重复条目取较大时长 */
    importJSON() {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        input.addEventListener('change', function () {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function () {
            Panel._applyImport(String(reader.result || ''), file.name);
          };
          reader.onerror = function () { window.alert('文件读取失败，请重试。'); };
          reader.readAsText(file, 'utf-8');
        });
        document.body.appendChild(input);
        input.click();
        setTimeout(function () { if (input.parentNode) input.parentNode.removeChild(input); }, 1000);
      } catch (err) {
        logError('Panel.importJSON', err);
      }
    },

    /** 解析并合并导入内容（供 importJSON 回调复用） */
    _applyImport(text, filename) {
      try {
        let payload = null;
        try { payload = JSON.parse(text); } catch (err) { payload = null; }
        if (!payload || typeof payload !== 'object') {
          window.alert('导入失败：文件不是有效的 JSON 备份。');
          return;
        }
        const incoming = []
          .concat(Array.isArray(payload.watchRecords) ? payload.watchRecords : [])
          .concat(Array.isArray(payload.watchRecordsArchive) ? payload.watchRecordsArchive : []);
        const valid = incoming.map(sanitizeRecord).filter(Boolean);
        if (valid.length === 0) {
          window.alert('导入失败：没有找到合法的观看记录。');
          return;
        }
        if (!window.confirm('即将导入 ' + valid.length + ' 条记录，与现有数据合并（同一天同一视频保留较大时长并合并播放会话）。确认继续？')) return;
        const importedGoal = Number(payload.weeklyGoalSeconds);
        if (Number.isFinite(importedGoal) && importedGoal > 0) GM_setValue(CONFIG.KEYS.WEEKLY_GOAL, Math.round(importedGoal));

        const merged = Store.getRecords();
        const index = Object.create(null);
        merged.forEach(function (r, i) { index[r.date + '|' + r.bvid] = i; });
        let added = 0, updated = 0;
        valid.forEach(function (r) {
          const key = r.date + '|' + r.bvid;
          const i = index[key];
          if (i === undefined) {
            merged.push(r);
            index[key] = merged.length - 1;
            added++;
          } else {
            const cur = merged[i];
            if (Number(r.watchedSeconds) > Number(cur.watchedSeconds)) {
              cur.watchedSeconds = Number(r.watchedSeconds) || 0;
              updated++;
            }
            cur.openCount = Math.max(Number(cur.openCount) || 1, Number(r.openCount) || 1);
            cur.durationSeconds = Math.max(Number(cur.durationSeconds) || 0, Number(r.durationSeconds) || 0);
            cur.maxPositionSeconds = Math.max(Number(cur.maxPositionSeconds) || 0, Number(r.maxPositionSeconds) || 0);
            cur.playCount = Math.max(Number(cur.playCount) || 1, Number(r.playCount) || 1);
            cur.completed = cur.completed === true || r.completed === true;
            if (r.completedAt && (!cur.completedAt || r.completedAt < cur.completedAt)) cur.completedAt = r.completedAt;
            cur.sessions = mergeSessions(cur.sessions, r.sessions);
            cur.lastActive = Math.max(Number(cur.lastActive) || 0, Number(r.lastActive) || 0);
            if (!cur.videoTitle && r.videoTitle) cur.videoTitle = r.videoTitle;
            if (!cur.uploader && r.uploader) cur.uploader = r.uploader;
            if (!cur.uploaderId && r.uploaderId) cur.uploaderId = r.uploaderId;
          }
        });
        Store.setRecords(merged);
        archiveIfNeeded();
        this.destroyCharts();
        this.render();
        log('导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条', filename);
        window.alert('导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条。\n共 ' + merged.length + ' 条记录。');
      } catch (err) {
        logError('Panel._applyImport', err);
        window.alert('导入失败：' + (err && err.message ? err.message : '未知错误'));
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
    '.bwp-report { width: 100%; padding: 16px 14px 6px; border-radius: var(--bwp-radius-lg); border: 1px solid var(--bwp-border); background: var(--bwp-surface); box-shadow: var(--bwp-shadow-md); }',
    '.bwp-rp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }',
    '.bwp-rp-title { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 700; color: var(--bwp-text); }',
    '.bwp-rp-title::before { content: ""; width: 4px; height: 15px; border-radius: 2px; background: var(--bwp-pink); }',
    '.bwp-rp-week { flex: none; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--bwp-pink-border); background: var(--bwp-surface); color: var(--bwp-pink-strong); font-size: 10.5px; font-weight: 600; }',
    '.bwp-rp-big { display: flex; gap: 10px; margin-bottom: 12px; }',
    '.bwp-rp-big > div { position: relative; flex: 1; min-width: 0; padding: 12px; border-radius: var(--bwp-radius-md); border: 1px solid var(--bwp-border); background: var(--bwp-surface); box-shadow: var(--bwp-shadow-sm); }',
    '.bwp-rp-big > div:first-child { border-color: var(--bwp-pink-border); background: var(--bwp-pink-soft); }',
    '.bwp-rp-big .n { font-size: 18px; font-weight: 700; line-height: 1.25; color: var(--bwp-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.bwp-rp-big > div:first-child .n { color: var(--bwp-pink-strong); }',
    '.bwp-rp-big .l { margin-top: 5px; font-size: 10.5px; color: var(--bwp-text-3); }',
    '.bwp-rp-sec { margin-bottom: 10px; padding: 12px 12px 4px; border-radius: var(--bwp-radius-md); border: 1px solid var(--bwp-border); background: var(--bwp-surface); box-shadow: var(--bwp-shadow-sm); }',
    '.bwp-rp-sec h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 11.5px; font-weight: 600; color: var(--bwp-text-2); letter-spacing: .02em; }',
    '.bwp-rp-sec h4::before { content: ""; width: 3px; height: 11px; border-radius: 2px; background: var(--bwp-pink); }',
    '.bwp-rp-up { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
    '.bwp-rp-up .idx { flex: none; display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border-radius: 7px; color: var(--bwp-pink-strong); font-size: 10px; font-weight: 700; background: var(--bwp-pink-soft); border: 1px solid var(--bwp-pink-border); }',
    '.bwp-rp-up .nm { flex: 1; min-width: 0; font-size: 12px; color: var(--bwp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.bwp-rp-up .mt { flex: none; font-size: 10.5px; color: var(--bwp-text-3); }',
    '.bwp-rp-bar { height: 6px; margin: 0 0 10px 27px; border-radius: 999px; background: var(--bwp-pink-soft); overflow: hidden; }',
    '.bwp-rp-bar i { display: block; height: 100%; border-radius: 999px; background: var(--bwp-pink); }',
    '.bwp-rp-chart { position: relative; height: 120px; padding: 4px 2px 2px; }',
    '.bwp-rp-slots { display: flex; gap: 7px; padding-bottom: 8px; }',
    '.bwp-rp-slot { flex: 1; padding: 9px 2px; text-align: center; border-radius: var(--bwp-radius-sm); border: 1px solid var(--bwp-border); background: var(--bwp-surface-muted); }',
    '.bwp-rp-slot.hot { border-color: var(--bwp-pink-border); background: var(--bwp-pink-soft); }',
    '.bwp-rp-slot .s { font-size: 10.5px; color: var(--bwp-text-2); }',
    '.bwp-rp-slot .v { margin-top: 4px; font-size: 12px; font-weight: 700; color: var(--bwp-text-3); }',
    '.bwp-rp-slot.hot .s { color: var(--bwp-pink-strong); font-weight: 600; }',
    '.bwp-rp-slot.hot .v { color: var(--bwp-pink-strong); }',
    '.bwp-rp-sum { position: relative; margin-bottom: 12px; padding: 12px 13px 12px 34px; border-radius: var(--bwp-radius-md); border: 1px solid var(--bwp-pink-border); background: var(--bwp-surface); font-size: 12px; line-height: 1.65; color: var(--bwp-text-2); }',
    '.bwp-rp-sum::before { content: ""; position: absolute; left: 13px; top: 15px; width: 12px; height: 12px; border-radius: 50%; background: var(--bwp-pink-soft); border: 1px solid var(--bwp-pink-border); }',
    '.bwp-rp-sum b { color: var(--bwp-pink-strong); }',
    '.bwp-rp-empty { display: flex; flex-direction: column; gap: 6px; padding: 30px 8px; text-align: center; font-size: 12px; color: var(--bwp-text-3); }',
  ].join('\n');

  const TOAST_CSS = [
    '.bwp-toast { position: fixed; right: 20px; bottom: 26px; z-index: 2147483002; display: flex; align-items: center; gap: 10px; max-width: 270px; padding: 12px 14px; border-radius: 16px; border: 1px solid rgba(251,114,153,.2); background: rgba(255,255,255,.96); box-shadow: 0 10px 28px rgba(24,25,28,.12), 0 2px 8px rgba(97,102,109,.06); font-size: 12px; line-height: 1.55; color: #18191c; cursor: pointer; animation: bwp-toast-in .3s cubic-bezier(.32,.72,0,1); transition: transform .2s ease, box-shadow .2s ease; }',
    '.bwp-toast:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(24,25,28,.16), 0 2px 8px rgba(97,102,109,.08); }',
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
      {
        n: data.wow && data.wow.hasLast
          ? (data.wow.delta >= 0 ? '+' : '-') + Math.abs(Math.round(data.wow.delta)) + '%'
          : (data.streak ? data.streak + ' 天' : '—'),
        l: data.wow && data.wow.hasLast ? '环比上周' : '连续观看',
      },
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
    const wowText = data.wow && data.wow.hasLast
      ? '，时长比上周<b>' + (data.wow.delta >= 0 ? '多' : '少') + Math.abs(Math.round(data.wow.delta)) + '%</b>'
      : '';
    sum.innerHTML = '本周共看 <b>' + data.totalVideos + '</b> 个视频，'
      + (data.peakSlot ? '最常在<b>' + data.peakSlot + '</b>打开B站' : '观看时段较分散')
      + (data.topUploaders[0] ? '，最爱 <b>' + escapeHTML(data.topUploaders[0].name) + '</b>' : '')
      + wowText + '。';
    root.appendChild(sum);

    const quality = document.createElement('div');
    quality.className = 'bwp-rp-sec bwp-anim';
    quality.style.setProperty('--bwp-i', 7);
    const qh = document.createElement('h4'); qh.textContent = '观看质量'; quality.appendChild(qh);
    const qt = document.createElement('div');
    qt.textContent = '完播率 ' + formatPercent(data.quality.completionRate)
      + ' · 平均进度 ' + formatPercent(data.quality.averageProgress)
      + ' · 重复观看 ' + data.quality.repeatWatchCount + ' 次'
      + ' · 中断率 ' + (data.quality.sessionCount ? formatPercent(data.quality.interruptionRate) : '暂无数据')
      + ' · 平均单次会话 ' + (data.quality.sessionCount ? formatDuration(data.quality.averageSessionSeconds) : '暂无数据');
    quality.appendChild(qt);
    root.appendChild(quality);

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
      log('脚本已加载，版本 0.7.0', location.href);

      // 阶段 3：仅视频页启用采集（SPA 路由切换由守护定时器处理）
      safe(function () { ensureCollector(); }, 'ensureCollector');
      safe(function () { archiveIfNeeded(); }, 'archiveIfNeeded');
      setInterval(function () {
        safe(function () { ensureCollector(); }, 'ensureCollector.tick');
      }, 2000);

      // 阶段 5：周日首次打开提醒查看本周报告
      safe(function () { maybeShowWeeklyReminder(); }, 'maybeShowWeeklyReminder');

      // 阶段 4：面板全站可用，任意 B 站页面都能打开查看数据
      // （采集仍只在 /video/ 页激活；图表懒加载，仅打开时渲染）
      safe(function () { Panel.mount(); }, 'Panel.mount');
    }, 'bootstrap');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
