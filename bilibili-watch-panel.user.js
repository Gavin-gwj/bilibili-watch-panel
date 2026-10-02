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
      return GM_getValue(CONFIG.KEYS.DEBUG, false) === true;
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
   * 阶段 3 实现
   * ============================================================ */

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

  /** 入口初始化 */
  function bootstrap() {
    safe(function () {
      Store.initSchema();
      log('脚本已加载，版本 0.1.0', location.href);
      // 阶段 3/4/5 将在此接入采集与 UI
    }, 'bootstrap');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();