// 官网显示偏好、产品预览与导航。用户脚本功能独立于本文件。

// 视图数据：文案与数值都按语言分开
const views = {
  today: {
    destination: { zh: "Today / Local record", en: "Today / Local record" },
    name: { zh: "今日观看", en: "Today" },
    copy: {
      zh: "查看今日总时长、视频数量、完播状态、平均进度与最近活跃时段。记录少时，会用近 7 天节奏补足上下文。",
      en: "Today's total watch time, video count, completion status, average progress and most recent activity. When there are few records, the last 7 days fill in the context."
    },
    rows: [
      [{ zh: "今日总时长", en: "Today's total" }, { zh: "39秒", en: "39s" }],
      [{ zh: "今日视频数", en: "Videos today" }, { zh: "1 个", en: "1" }],
      [{ zh: "完播率", en: "Completion rate" }, { zh: "100%", en: "100%" }],
      [{ zh: "平均单次会话", en: "Avg session" }, { zh: "12秒", en: "12s" }]
    ],
    image: "docs/screenshots/panel-today.png",
    alt: { zh: "今日观看数据面板示例画面", en: "Sample of the today view panel" }
  },
  week: {
    destination: { zh: "Week / Rhythm", en: "Week / Rhythm" },
    name: { zh: "本周节奏", en: "This week" },
    copy: {
      zh: "把近 7 天的时长、连续观看、重复观看与平均单次放在同一条节奏线上，快速判断这一周看得多不多。",
      en: "Watch time, streak, repeat watching and average session for the last 7 days on one rhythm line, so you can tell at a glance how heavy this week was."
    },
    rows: [
      [{ zh: "近 7 天总时长", en: "Last 7 days" }, { zh: "16分53秒", en: "16m 53s" }],
      [{ zh: "连续观看", en: "Streak" }, { zh: "4 天", en: "4 days" }],
      [{ zh: "平均进度", en: "Avg progress" }, { zh: "59%", en: "59%" }],
      [{ zh: "平均单次会话", en: "Avg session" }, { zh: "19秒", en: "19s" }]
    ],
    image: "docs/screenshots/panel-week.png",
    alt: { zh: "本周观看节奏面板示例画面", en: "Sample of the weekly rhythm panel" }
  },
  all: {
    destination: { zh: "Archive / All time", en: "Archive / All time" },
    name: { zh: "全部档案", en: "Archive" },
    copy: {
      zh: "用累计数据、53 周热力图与搜索筛选回看长期档案。所有记录仍留在当前浏览器中，不上传，也不依赖账号。",
      en: "Cumulative totals, a 53-week heatmap and search to review the long-term archive. Every record stays in this browser. Nothing is uploaded and no account is needed."
    },
    rows: [
      [{ zh: "累计总时长", en: "All-time total" }, { zh: "16分53秒", en: "16m 53s" }],
      [{ zh: "总视频数", en: "Total videos" }, { zh: "12 个", en: "12" }],
      [{ zh: "覆盖 UP 主", en: "Creators covered" }, { zh: "11 位", en: "11" }],
      [{ zh: "平均单视频时长", en: "Avg per video" }, { zh: "1分32秒", en: "1m 32s" }]
    ],
    image: "docs/screenshots/panel-all.png",
    alt: { zh: "全部观看档案面板示例画面", en: "Sample of the full archive panel" }
  },
  report: {
    destination: { zh: "Report / Weekly", en: "Report / Weekly" },
    name: { zh: "本周报告", en: "Weekly report" },
    copy: {
      zh: "汇总本周总览、UP 主 Top5 与每日趋势，并导出为一张 PNG 周报，适合保存或主动分享。",
      en: "This week's overview, top 5 creators and a daily trend, exportable as a single PNG report you can save or share."
    },
    rows: [
      [{ zh: "本周总时长", en: "This week" }, { zh: "42秒", en: "42s" }],
      [{ zh: "本周视频数", en: "Videos this week" }, { zh: "1 个", en: "1" }],
      [{ zh: "最爱 UP 主", en: "Top creator" }, { zh: "Voidmatrix", en: "Voidmatrix" }],
      [{ zh: "高峰时段", en: "Peak hours" }, { zh: "下午", en: "Afternoon" }]
    ],
    image: "docs/screenshots/panel-report.png",
    alt: { zh: "本周观看报告面板示例画面", en: "Sample of the weekly report panel" }
  }
};

// 界面文案词典
const I18N = {
  zh: {
    "meta.title": "Bilibili Watch Panel | 私人放映时刻表",
    "meta.desc": "Bilibili Watch Panel，本地优先的 B 站个人观看数据面板。记录真实播放进度，不上传观看数据。",
    "brand.name": "BWP / 观看数据面板",
    "brand.tag": "LOCAL WATCH LEDGER",
    "brand.home": "Bilibili Watch Panel 首页",
    "skip": "跳转到主要内容",
    "nav.aria": "主导航",
    "nav.toggle": "展开导航菜单",
    "nav.close": "收起导航菜单",
    "nav.github": "在 GitHub 查看项目",
    "nav.overview": "概览",
    "nav.method": "统计口径",
    "nav.privacy": "隐私说明",
    "nav.installStep": "安装步骤",
    "nav.install": "获取脚本",
    "nav.stars": "GitHub star 数",
    "pref.group": "显示偏好",
    "pref.themeToLight": "切换到白天模式",
    "pref.themeToDark": "切换到黑夜模式",
    "pref.langLabel": "Switch to English",
    "hero.title": "你的观看记录，应该有它自己的时刻表。",
    "hero.lead": "Bilibili Watch Panel 把真实播放进度、播放会话和观看质量整理成一份本地档案。没有账号，没有服务器，没有数据上传。",
    "hero.install": "获取脚本",
    "hero.github": "查看 GitHub",
    "hero.metaAria": "项目信息",
    "hero.meta.local": "本地存储",
    "hero.meta.license": "MIT License",
    "board.aria": "产品数据面板预览",
    "board.title": "Private watch ledger",
    "board.local": "Stored on this browser",
    "board.tabsAria": "四种面板视图",
    "board.sample": "示例数据",
    "board.note": "示例预览 · 脚本运行后将在 B 站页面显示",
    "preview.open": "查看大图",
    "preview.close": "关闭预览",
    "preview.detail": "观看记录详情",
    "preview.note": "示例数据",
    "tab.today": "今日",
    "tab.week": "本周",
    "tab.all": "全部",
    "tab.report": "报告",
    "statement.title": "它不猜测你看了多久，它只记录真正发生过的播放。",
    "statement.copy": "真正在播的每一秒都会被记下来，没在看的时段不会混进来。",
    "records.title": "观看时长不是猜出来的。",
    "records.copy": "很多时间统计会把挂着没看的时段也算进去。这个面板只认真实播放过的时间，你可以随时打开核对。",
    "records.r1.evidence": "没在播就不计时",
    "records.r2.evidence": "时长经得起核对",
    "records.r3.evidence": "跨天也不会重复计",
    "records.r1.title": "暂停、缓冲、切到别的标签页，都不算进时长。",
    "records.r1.copy": "只有视频真的在走，时间才往前走。脚本每隔几秒对一次表，只把真正播放的部分记下来。",
    "records.r2.title": "看到一半去干别的，它不会当成你一直在看。",
    "records.r2.copy": "每次播放从开始到结束算一段，中途暂停、跳进度、关掉页面都会记下来，所以每条时长都站得住。",
    "records.r3.title": "看到过了半夜，两天的时长也不会算错。",
    "records.r3.copy": "跨零点的观看会按日期切开，分别算进前一天和后一天，既不漏记也不会重复计算。",
    "records.detail.title": "点开任意一条，都能看到完整的观看过程。",
    "records.detail.copy": "看了多久、看到哪里、有没有看完、中间跳了几次、第一次和最近一次是什么时候，每条记录里都写得很清楚。",
    "records.detail.alt": "单条观看记录详情示例，展示观看时长、进度与会话数据",
    "support.s1.title": "视频、番剧、课程",
    "support.s1.copy": "覆盖 /video、/bangumi/play 与 /cheese/play 三类播放页。",
    "support.s2.title": "分 P 与分集",
    "support.s2.copy": "mediaKey 会保留分 P 或分集序号，避免不同内容混成一条记录。",
    "support.s3.title": "JSON 导入导出",
    "support.s3.copy": "换浏览器时由你主动导出和导入，合并记录并去重会话。",
    "support.s4.title": "周报 PNG",
    "support.s4.copy": "把本周总览、最爱 UP 主和每日时长整理成一张可保存的报告。",
    "privacy.title": "你的观看记录，只存在你的电脑",
    "privacy.copy": "全程在浏览器本地运行，<strong>不上传任何观看数据到外网</strong>。无服务器、无账号，数据控制权完全在你手里。",
    "privacy.platformNote": "仅支持PC端 Chrome / Edge 等可安装 Tampermonkey 的浏览器，移动端暂无法运行脚本。",
    "faq.title": "常见问题",
    "faq.seal": "本地读写，无上传",
    "faq.user1": "匿名读者 01",
    "faq.user2": "匿名读者 02",
    "faq.user3": "匿名读者 03",
    "faq.sample": "示例",
    "faq.owner": "楼主",
    "faq.count": "3 条问答",
    "faq.collapse": "收起回复",
    "faq.expand": "展开 1 条回复",
    "faq.empty": "暂无常见问题",
    "faq.loading": "正在加载问答…",
    "faq.tag1": "数据会丢",
    "faq.tag2": "手动步骤",
    "faq.tag3": "可自查",
    "faq.note1": "备份是你唯一的副本",
    "faq.note2": "换设备前先导出一次",
    "faq.note3": "全部请求见源码",
    "faq.floor1": "#1楼 · 匿名读者 · 示例",
    "faq.floor2": "#2楼 · 匿名读者 · 示例",
    "faq.floor3": "#3楼 · 匿名读者 · 示例",
    "faq.replyAuthor": "作者回复",
    "faq.replyLv": "Lv5",
    "faq.q1": "清除浏览器数据会怎样？",
    "faq.a1": "观看记录保存在浏览器本地存储。清除站点数据或卸载扩展会直接删除，<strong>无法找回</strong>，建议定期导出 JSON 备份。",
    "faq.q2": "换浏览器或换电脑怎么迁移？",
    "faq.a2": "无云端自动同步。新环境装好脚本，导入 JSON 备份，记录自动合并去重，<strong>需要手动迁移</strong>。",
    "faq.q3": "脚本会上传观看数据吗？",
    "faq.a3": "<strong>不会上传</strong>观看记录，仅本地存储读写；仅调用 B 站公开接口获取视频标题封面。",
    "privacy.f1": "观看数据上传请求",
    "privacy.f2": "固定 GM 存储权限",
    "privacy.f3": "开放源代码许可证",
    "install.eyebrow": "安装路径",
    "install.title": "三步装好，让观看记录开始留下来。",
    "install.copy": "先装浏览器扩展 Tampermonkey，再点击本站的安装脚本。确认一次，打开任意 B 站视频页，右侧就会出现可拖动的观看数据入口。",
    "install.tm": "安装 Tampermonkey",
    "install.cta": "一键安装脚本",
    "install.trust": "脚本运行在浏览器本地，不需要账号，也不会上传观看数据。",
    "install.artAlt": "浏览器扩展安装与脚本启用流程示意图",
    "install.artCaption": "Extension → script → local panel",
    "install.stepsTitle": "照着做，半分钟就能开始记录。",
    "install.stepsAria": "安装步骤",
    "install.guide": "打开完整安装说明",
    "install.step1.title": "先安装 Tampermonkey",
    "install.step1.visual": "浏览器扩展",
    "install.step1.copy": "打开 Tampermonkey 官网，按浏览器选择对应版本并完成安装。",
    "install.step1.cta": "去官网安装",
    "install.step2.title": "点击本站的一键安装",
    "install.step2.alt": "Tampermonkey 安装确认页示意图",
    "install.step2.copy": "回到本站，点击“一键安装脚本”。Tampermonkey 会自动打开确认页，点一次安装即可。",
    "install.step2.cta": "立即安装脚本",
    "install.step3.title": "打开 B 站，开始记录",
    "install.step3.alt": "观看数据面板示例",
    "install.step3.copy": "打开任意 B 站视频页，播放几秒钟，右侧会出现可以拖动的面板入口。",
    "install.step3.note": "数据只保存在当前浏览器",
    "install.sideAria": "项目终点信息",
    "install.code": "Destination",
    "install.dest": "本地观看档案",
    "install.m1": "运行方式",
    "install.m2": "数据位置",
    "install.m2v": "浏览器本地",
    "install.m3": "服务器",
    "install.m3v": "无",
    "install.m4": "版本",
    "footer.copy": "Bilibili Watch Panel 是一个纯本地运行的 Tampermonkey 用户脚本。页面截图中的数据来自本机浏览器示例，仅用于展示界面。",
    "footer.status": "本地运行 · 无服务器",
    "footer.statusTip": "所有数据仅保存在浏览器本地，不会上传",
    "footer.colProject": "项目",
    "footer.colDocs": "说明",
    "footer.readme": "使用说明",
    "footer.metaRuntime": "Tampermonkey",
    "footer.metaStorage": "本地存储",
    "footer.aria": "页脚导航"
  },
  en: {
    "meta.title": "Bilibili Watch Panel | A private viewing timetable",
    "meta.desc": "Bilibili Watch Panel, a local-first personal watch-data dashboard for Bilibili. It records real playback progress and never uploads your viewing data.",
    "brand.name": "BWP / Watch Panel",
    "brand.tag": "LOCAL WATCH LEDGER",
    "brand.home": "Bilibili Watch Panel home",
    "skip": "Skip to main content",
    "nav.aria": "Main navigation",
    "nav.toggle": "Open navigation menu",
    "nav.close": "Close navigation menu",
    "nav.github": "View project on GitHub",
    "nav.overview": "Overview",
    "nav.method": "Method",
    "nav.privacy": "Privacy",
    "nav.installStep": "Install",
    "nav.install": "Get script",
    "nav.stars": "GitHub star count",
    "pref.group": "Display preferences",
    "pref.themeToLight": "Switch to light mode",
    "pref.themeToDark": "Switch to dark mode",
    "pref.langLabel": "切换到中文",
    "hero.title": "Your watch history deserves a timetable of its own.",
    "hero.lead": "Bilibili Watch Panel turns real playback progress, viewing sessions and watch quality into a local ledger. No account, no server, nothing uploaded.",
    "hero.install": "Get script",
    "hero.github": "View GitHub",
    "hero.metaAria": "Project facts",
    "hero.meta.local": "Local storage",
    "hero.meta.license": "MIT License",
    "board.aria": "Product dashboard preview",
    "board.title": "Private watch ledger",
    "board.local": "Stored on this browser",
    "board.tabsAria": "Four panel views",
    "board.sample": "Sample data",
    "board.note": "Sample preview · appears on Bilibili once the script runs",
    "preview.open": "View larger",
    "preview.close": "Close preview",
    "preview.detail": "Record detail",
    "preview.note": "Sample data",
    "tab.today": "Today",
    "tab.week": "Week",
    "tab.all": "All",
    "tab.report": "Report",
    "statement.title": "It never guesses how long you watched. It only records playback that actually happened.",
    "statement.copy": "Every second that really played gets counted, and time you were not watching never slips in.",
    "records.title": "Watch time is not a guess.",
    "records.copy": "Plenty of time trackers also count the stretches you left running. This panel only counts time that actually played, and you can open it any time to check.",
    "records.r1.evidence": "Not playing, not counting",
    "records.r2.evidence": "Numbers you can check",
    "records.r3.evidence": "No double counting",
    "records.r1.title": "Pausing, buffering and switching tabs never count.",
    "records.r1.copy": "Time only moves forward while the video really plays. The script checks in every few seconds and records just the part that played.",
    "records.r2.title": "Wandering off halfway does not read as still watching.",
    "records.r2.copy": "Each playback counts as one stretch from start to finish. Pausing, skipping ahead or closing the page all get noted, so every number holds up.",
    "records.r3.title": "Watching past midnight still adds up correctly.",
    "records.r3.copy": "Viewing that crosses midnight is split by date into the day before and the day after, so nothing is missed and nothing is counted twice.",
    
    "records.detail.title": "Open any record and see the whole session.",
    "records.detail.copy": "How long you watched, how far you got, whether you finished, how many times you skipped, and when you first and last watched, all laid out in one record.",
    "records.detail.alt": "Sample watch record detail showing watch time, progress and session data",
    "support.s1.title": "Videos, bangumi, courses",
    "support.s1.copy": "Covers all three playback page types: /video, /bangumi/play and /cheese/play.",
    "support.s2.title": "Parts and episodes",
    "support.s2.copy": "mediaKey keeps the part or episode index, so different content never collapses into one record.",
    "support.s3.title": "JSON import & export",
    "support.s3.copy": "When you change browsers, export and import on your own terms. Records are merged and sessions de-duplicated.",
    "support.s4.title": "Weekly PNG report",
    "support.s4.copy": "Turns the week's overview, top creator and daily durations into one saveable report.",
    "privacy.title": "Your watch history stays on your own computer",
    "privacy.copy": "Everything runs locally in your browser, and <strong>no viewing data is ever uploaded</strong>. No server, no account. You keep full control of your data.",
    "privacy.platformNote": "Runs only on desktop Chrome or Edge with Tampermonkey installed. Mobile browsers cannot run the script.",
    "faq.title": "Frequently asked",
    "faq.seal": "Local only, no upload",
    "faq.user1": "Reader 01",
    "faq.user2": "Reader 02",
    "faq.user3": "Reader 03",
    "faq.sample": "Sample",
    "faq.owner": "Author",
    "faq.count": "3 discussions",
    "faq.collapse": "Hide reply",
    "faq.expand": "Show 1 reply",
    "faq.empty": "No questions yet",
    "faq.loading": "Loading questions…",
    "faq.tag1": "Data can vanish",
    "faq.tag2": "Manual step",
    "faq.tag3": "Verifiable",
    "faq.note1": "Your backup is the only copy",
    "faq.note2": "Export before switching",
    "faq.note3": "Every request is in the source",
    "faq.floor1": "Floor 1 · anonymous reader · sample",
    "faq.floor2": "Floor 2 · anonymous reader · sample",
    "faq.floor3": "Floor 3 · anonymous reader · sample",
    "faq.replyAuthor": "Author reply",
    "faq.replyLv": "Lv5",
    "faq.q1": "What happens if I clear my browser data?",
    "faq.a1": "Watch records live in this browser's local storage. Clearing site data or uninstalling the extension deletes them outright, with <strong>no way to recover</strong>. Export a JSON backup regularly.",
    "faq.q2": "How do I move to another browser or computer?",
    "faq.a2": "There is no cloud sync. Install the script in the new environment, import your JSON backup, and records merge and de-duplicate automatically, but <strong>the move is manual</strong>.",
    "faq.q3": "Does the script upload my watch data?",
    "faq.a3": "It <strong>never uploads</strong> watch records, only reading and writing local storage. The only outbound request fetches public video titles and covers from a Bilibili public endpoint.",
    "privacy.f1": "Upload requests for viewing data",
    "privacy.f2": "Fixed GM storage permissions",
    "privacy.f3": "Open-source license",
    "install.eyebrow": "Install path",
    "install.title": "Three steps, then your watch history starts to stay with you.",
    "install.copy": "Install the Tampermonkey browser extension first, then click the script installer here. Confirm once, open any Bilibili video page, and the draggable watch panel appears on the right.",
    "install.tm": "Install Tampermonkey",
    "install.cta": "Install script",
    "install.trust": "Runs in this browser. No account required, and no watch data is uploaded.",
    "install.artAlt": "Illustration of the browser extension and userscript installation flow",
    "install.artCaption": "Extension → script → local panel",
    "install.stepsTitle": "Follow the path and start recording in under a minute.",
    "install.stepsAria": "Installation steps",
    "install.guide": "Open the full install guide",
    "install.step1.title": "Install Tampermonkey first",
    "install.step1.visual": "Browser extension",
    "install.step1.copy": "Open the Tampermonkey site, choose the version for your browser, and finish the extension install.",
    "install.step1.cta": "Install from the site",
    "install.step2.title": "Click the one-click installer",
    "install.step2.alt": "Illustration of the Tampermonkey install confirmation page",
    "install.step2.copy": "Return here and click “Install script”. Tampermonkey opens a confirmation page; confirm once to finish.",
    "install.step2.cta": "Install the script",
    "install.step3.title": "Open Bilibili and start watching",
    "install.step3.alt": "Sample watch-data panel",
    "install.step3.copy": "Open any Bilibili video page and play for a few seconds. The draggable panel entry appears on the right.",
    "install.step3.note": "Data stays in this browser",
    "install.sideAria": "Project destination facts",
    "install.code": "Destination",
    "install.dest": "Local watch archive",
    "install.m1": "Runtime",
    "install.m2": "Data location",
    "install.m2v": "This browser",
    "install.m3": "Server",
    "install.m3v": "None",
    "install.m4": "Version",
    "footer.copy": "Bilibili Watch Panel is a Tampermonkey userscript that runs entirely locally. The data in the page screenshots comes from a sample browser on this machine and is shown only to illustrate the interface.",
    "footer.status": "Runs locally · no server",
    "footer.statusTip": "All data stays in your browser and is never uploaded",
    "footer.colProject": "Project",
    "footer.colDocs": "Docs",
    "footer.readme": "Getting started",
    "footer.metaRuntime": "Tampermonkey",
    "footer.metaStorage": "Local storage",
    "footer.aria": "Footer navigation"
  }
};

const STORE_THEME = "bwp-theme";
const STORE_LANG = "bwp-lang";

const readStore = (key) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const writeStore = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch {}
};

const pickLang = () => {
  const saved = readStore(STORE_LANG);
  if (saved === "zh" || saved === "en") return saved;
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  return langs.some((tag) => /^zh/i.test(tag || "")) ? "zh" : "en";
};

let theme = readStore(STORE_THEME);
// 站点默认暗色：只有用户显式切过浅色才用浅色，不跟随系统
if (theme !== "light") theme = "dark";
let lang = pickLang();

const refs = {
  board: document.getElementById("departureBoard"),
  boardPanel: document.getElementById("heroBoardPanel"),
  destination: document.getElementById("boardDestination"),
  viewName: document.getElementById("boardViewName"),
  viewCopy: document.getElementById("boardViewCopy"),
  rows: document.getElementById("boardRows"),
  previewSlot: document.getElementById("previewSlot"),
  previewImage: document.getElementById("boardPreviewImage"),
  deck: document.getElementById("previewDeck"),
  themeToggle: document.getElementById("themeToggle"),
  langToggle: document.getElementById("langToggle"),
  langMark: document.getElementById("langMark"),
  navToggle: document.getElementById("navToggle"),
  previewDialog: document.getElementById("previewDialog"),
  previewDialogTitle: document.getElementById("previewDialogTitle"),
  previewDialogImage: document.getElementById("previewDialogImage")
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// 触屏 / 无悬停设备不做 3D 翻页，改用轻量淡入（见 flipDeck 的 touchMode）
const touchMode = window.matchMedia("(hover: none), (pointer: coarse)");
let activeView = "today";

const t = (key) => (I18N[lang] && I18N[lang][key]) || (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
const pick = (node) => (node && typeof node === "object" ? (node[lang] || node.zh) : node);
// 主题按钮的说明文字随当前主题变化，描述“点下去会发生什么”
const themeLabelKey = () => (theme === "light" ? "pref.themeToDark" : "pref.themeToLight");

const applyTheme = (next, persist) => {
  if (persist && !reduceMotion.matches) {
    document.documentElement.classList.remove("theme-transition");
    void document.documentElement.offsetWidth;
    document.documentElement.classList.add("theme-transition");
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 560);
  }
  theme = next;
  document.documentElement.setAttribute("data-theme", theme);
  if (persist) writeStore(STORE_THEME, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f7f6f3" : "#08090a");
  if (refs.themeToggle) {
    // aria-pressed 表示「白天模式已开启」
    refs.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    refs.themeToggle.setAttribute("aria-label", t(themeLabelKey()));
  }
};

// 语言切换后重建标题字符，保留原有入场效果。
const splitHeadline = () => {
  document.querySelectorAll(".privacy-headline").forEach((el) => {
    if (el.dataset.split === "true") return;
    el.dataset.split = "true";
    const text = el.textContent;
    el.textContent = "";
    const step = document.documentElement.getAttribute("lang") === "en" ? 12 : 34;
    // 英文按单词入场，避免窄屏把一个单词从中间拆开。
    const parts = document.documentElement.lang === "en" ? (text.match(/\S+\s*|\s+/g) || []) : [...text];
    parts.forEach((char, index) => {
      const span = document.createElement("span");
      span.className = "char";
      // 空格不占一格动画，但仍要保留宽度
      span.textContent = char;
      span.style.setProperty("--char-delay", index * step + "ms");
      el.appendChild(span);
    });
  });
};

const applyLang = (next, persist) => {
  lang = next;
  document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  if (persist) writeStore(STORE_LANG, lang);

  // 只有预先定义的强调文案允许 HTML，其余内容均作为纯文本写入。
  const MARKUP_KEYS = new Set(["privacy.copy", "faq.a1", "faq.a2", "faq.a3"]);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const value = t(key);
    if (key === "hero.title") {
      const lines = lang === "zh"
        ? ["你的观看记录，", "应该有它自己的", "时刻表。"]
        : ["Your watch history ", "deserves a timetable ", "of its own."];
      el.replaceChildren(...lines.map((line, index) => {
        const span = document.createElement("span");
        span.className = "hero-title-line" + (index === 2 ? " hero-title-accent" : "");
        span.textContent = line;
        return span;
      }));
    } else if (MARKUP_KEYS.has(key)) el.innerHTML = value;
    else el.textContent = value;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => { el.setAttribute("alt", t(el.dataset.i18nAlt)); });
  // CSS 气泡的内容来自 data-tip，需随语言一起切换
  document.querySelectorAll("[data-i18n-tip]").forEach((el) => { el.setAttribute("data-tip", t(el.dataset.i18nTip)); });

  const title = document.querySelector("title");
  if (title) title.textContent = t("meta.title");
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", t("meta.desc"));

  if (refs.langMark) refs.langMark.textContent = lang === "zh" ? "中" : "EN";
  if (refs.langToggle) refs.langToggle.setAttribute("aria-label", t("pref.langLabel"));
  if (refs.themeToggle) refs.themeToggle.setAttribute("aria-label", t(themeLabelKey()));
  if (refs.navToggle) refs.navToggle.setAttribute("aria-label", t(refs.navToggle.getAttribute("aria-expanded") === "true" ? "nav.close" : "nav.toggle"));

  // 视图区文案随语言重建
  renderView(activeView, "lang");
  if (refs.previewDialog && refs.previewDialog.open) syncPreview();

  // 标题文本刚被重写，需要重新逐字切分（切分结果不跨语言复用）
  const headline = document.querySelector(".privacy-headline");
  if (headline) delete headline.dataset.split;
  splitHeadline();
};

if (refs.themeToggle) {
  refs.themeToggle.addEventListener("click", () => {
    applyTheme(theme === "light" ? "dark" : "light", true);
  });
}
if (refs.langToggle) {
  refs.langToggle.addEventListener("click", () => {
    applyLang(lang === "zh" ? "en" : "zh", true);
  });
}

const buildRows = (rows) => {
  refs.rows.replaceChildren();
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    row.className = "board-row";
    term.textContent = pick(label);
    detail.textContent = pick(value);
    row.append(term, detail);
    refs.rows.append(row);
  });
};

const tabLabels = {
  today: "heroTabToday",
  week: "heroTabWeek",
  all: "heroTabAll",
  report: "heroTabReport"
};

const setTabs = (key, focusTab = false) => {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const selected = tab.dataset.view === key;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
  });
  refs.boardPanel.setAttribute("aria-labelledby", tabLabels[key]);
};

const renderView = (key, source = "user") => {
  if (!views[key]) return;
  const view = views[key];
  const shouldAnimate = source !== "initial" && !reduceMotion.matches && key !== activeView;
  activeView = key;
  setTabs(key);

  // 文字区（destination / viewName / viewCopy）随标签立即更新
  refs.destination.textContent = pick(view.destination);
  refs.viewName.textContent = pick(view.name);
  refs.viewCopy.textContent = pick(view.copy);
  buildRows(view.rows);

  // 每张卡始终对应自己的图片与描述，切换视图只调整层叠顺序。
  cardByView.forEach((card, viewKey) => {
    const image = card.querySelector("img");
    if (image && views[viewKey]) image.alt = pick(views[viewKey].alt);
  });

  flipDeck(key, shouldAnimate);
};

/* ===== 卡片牌组：点击标签 → 对应卡片翻页到最上层 =====
   状态模型很薄：只有「谁在最前面」+「谁正在让位」。
   每张卡片的物理位置完全由 data-slot 排名推导，所以任何一次点击
   都只是重算一轮排名，不存在需要回滚的中间状态。 */
const deck = refs.deck;
const deckCards = deck ? Array.from(deck.querySelectorAll("[data-preview-slot]")) : [];
// 标签 → 卡片：按 data-view 精确配对，不依赖 DOM 顺序
const cardByView = new Map();
deckCards.forEach((card) => {
  const view = card.dataset.view;
  if (view && !cardByView.has(view)) cardByView.set(view, card);
});
// 兜底：无标签的卡片，按 DOM 顺序挂到还没被认领的标签上
const idleCards = deckCards.filter((card) => !cardByView.has(card.dataset.view));
Object.keys(views).forEach((view) => {
  if (!cardByView.has(view) && idleCards.length) cardByView.set(view, idleCards.shift());
});
idleCards.forEach((card) => { card.hidden = true; }); // 卡多标签少的余量卡先收起
if (deck) deck.dataset.deck = String(deckCards.filter((c) => !c.hidden).length);

const deckOrder = deckCards.filter((card) => cardByView.get(card.dataset.view) === card);
const cardsForView = (view) => {
  const own = cardByView.get(view);
  if (!own) return [];
  // 最前面那张排在 0 位，其余按「上一张、上上张…」的顺序压到它身后
  const from = deckOrder.indexOf(own);
  return deckOrder.slice(from).concat(deckOrder.slice(0, from));
};

let deckFront = deckCards.find((card) => card.classList.contains("is-front")) || deckOrder[0] || null;
let pageOutCard = null;
let pageCleanupTimer = 0;

const flipDeck = (view, animate) => {
  if (!deck) return;
  const front = cardsForView(view)[0];
  // 重复点击当前已激活的标签：卡片本来就在最上层，什么都不做
  if (!front || front === deckFront) return;

  const outgoing = deckFront;
  // 正在让位的卡片被打断时立刻归位，否则它会被永远留在离场姿态
  if (pageOutCard && pageOutCard !== outgoing) {
    pageOutCard.removeAttribute("data-phase");
    pageOutCard = null;
  }
  window.clearTimeout(pageCleanupTimer);

  const order = cardsForView(view);
  deckFront = front;

  const paint = () => {
    order.forEach((card, index) => {
      card.dataset.slot = String(index);
      card.classList.toggle("is-front", index === 0);
      card.classList.toggle("is-away", index > 1);
      // 只有最上层那张进入无障碍树，其余对读屏器隐身
      card.setAttribute("aria-hidden", index === 0 ? "false" : "true");
    });
  };

  if (!animate) {
    // reduce-motion / 初始 / 语言切换：直接落到终态，不播任何位移。
    // 注意这里必须在 paint() 之后再清一次相位，paint() 只知道排名，
    // 不知道「谁刚刚让过位」，离场姿态得由这里统一收掉。
    paint();
    deckCards.forEach((card) => card.removeAttribute("data-phase"));
    pageOutCard = null;
    return;
  }

  // 触屏 / 无悬停设备：跳过 3D 翻页，只做一次干净的交叉淡入。
  // 手机上 640ms 的 rotateY + 大位移容易掉帧，观感也偏「晃」。
  if (touchMode.matches) {
    paint();
    void deck.offsetWidth;
    if (outgoing) outgoing.dataset.phase = "fade-out";
    front.dataset.phase = "fade-in";
    pageOutCard = outgoing;
    pageCleanupTimer = window.setTimeout(() => {
      if (front.isConnected) front.removeAttribute("data-phase");
      if (pageOutCard && pageOutCard.isConnected) pageOutCard.removeAttribute("data-phase");
      pageOutCard = null;
    }, 460);
    return;
  }

  // 一场翻页 = 一次重排 + 一次重绘。
  // 重排把「谁在最前」定下来（旧的退到后排、新的拿到 z-index 50），
  // 重绘再挂上各自的离场/入场姿态，两个相位因此在同一帧内成立，
  // 不会出现「旧卡已下沉、新卡还没上来」的空档。
  paint();
  void deck.offsetWidth;
  if (outgoing) outgoing.dataset.phase = "out";
  front.dataset.phase = "in";
  pageOutCard = outgoing;

  pageCleanupTimer = window.setTimeout(() => {
    if (front.isConnected) front.removeAttribute("data-phase");
    // 让位卡必须等它自己的离场过渡（transform 640ms + opacity 300ms）
    // 走完再撤相位，否则 !important 一旦失效，卡片会从场外被拽回
    // 半途的堆叠位置，视觉上就是「翻出去的牌又弹回来」。
    if (pageOutCard && pageOutCard.isConnected) pageOutCard.removeAttribute("data-phase");
    pageOutCard = null;
  }, 820);
};

document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => renderView(tab.dataset.view, "user"));
});

// 牌组落到初始排布：activeView 那张在最前，其余按顺序压在身后。
// 同时也负责给「未手动切换过」的首次加载铺好堆叠视觉。
if (deckFront) {
  cardsForView(activeView).forEach((card, index) => {
    card.dataset.slot = String(index);
    card.classList.toggle("is-front", index === 0);
    card.classList.toggle("is-away", index > 1);
    card.setAttribute("aria-hidden", index === 0 ? "false" : "true");
  });
  deckFront = cardByView.get(activeView) || deckFront;
}

document.querySelectorAll('[role="tablist"]').forEach((list) => {
  list.addEventListener("keydown", (event) => {
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === current) return;

    renderView(tabs[next].dataset.view, "keyboard");
    tabs[next].focus();
  });
});

let previewView = "today";
let previewTrigger = null;

const syncPreview = () => {
  const detail = previewView === "detail";
  const view = views[previewView] || views.today;
  refs.previewDialogTitle.textContent = detail ? t("preview.detail") : pick(view.name);
  refs.previewDialogImage.alt = detail ? t("records.detail.alt") : pick(view.alt);
  refs.previewDialogImage.src = detail ? "docs/screenshots/panel-detail.png" : view.image;
};

if (refs.previewDialog && refs.previewDialogTitle && refs.previewDialogImage) {
  document.querySelectorAll("[data-preview-open]").forEach((button) => {
    button.addEventListener("click", () => {
      previewView = button.dataset.previewOpen === "detail" ? "detail" : activeView;
      syncPreview();
      if (typeof refs.previewDialog.showModal !== "function") {
        window.open(refs.previewDialogImage.src, "_blank", "noopener");
        return;
      }
      previewTrigger = button;
      refs.previewDialog.showModal();
      document.documentElement.classList.add("is-preview-open");
    });
  });

  refs.previewDialog.querySelectorAll("[data-preview-close]").forEach((button) => {
    button.addEventListener("click", () => refs.previewDialog.close());
  });
  refs.previewDialog.addEventListener("click", (event) => {
    if (event.target !== refs.previewDialog) return;
    const bounds = refs.previewDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      refs.previewDialog.close();
    }
  });
  refs.previewDialog.addEventListener("close", () => {
    document.documentElement.classList.remove("is-preview-open");
    if (previewTrigger && previewTrigger.isConnected) previewTrigger.focus({ preventScroll: true });
    previewTrigger = null;
  });
}

if (refs.board) {
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  refs.board.addEventListener("pointermove", (event) => {
    if (reduceMotion.matches) return;
    const bounds = refs.board.getBoundingClientRect();
    pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
    pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      refs.board.style.setProperty("--mx", pointerX.toFixed(2) + "%");
      refs.board.style.setProperty("--my", pointerY.toFixed(2) + "%");
      pointerFrame = 0;
    });
  });
  refs.board.addEventListener("pointerleave", () => {
    refs.board.style.setProperty("--mx", "46%");
    refs.board.style.setProperty("--my", "18%");
  });
}

// 顶栏导航高亮：只让当前所在区块对应的那一条亮起
const siteNav = document.querySelector("[data-site-nav]");
if (siteNav) {
  const navLinks = Array.from(siteNav.querySelectorAll("a[data-nav-section]"));
  const navTargets = navLinks
    .map((link) => {
      const target = document.getElementById(link.dataset.navSection);
      return target ? { link, target } : null;
    })
    .filter(Boolean);

  let navLocked = false;
  let navLockTimer = 0;

  const paintNav = (id) => {
    navLinks.forEach((link) => {
      if (link.dataset.navSection === id) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const pickNavSection = () => {
    // 以视口上方三分之一处为准，取最接近锚点的区块
    const anchorLine = window.scrollY + window.innerHeight * 0.34;
    let current = navTargets[0];
    navTargets.forEach((entry) => {
      if (entry.target.offsetTop <= anchorLine) current = entry;
    });
    // 页面触底时，最后一个区块直接点亮
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 2) {
      current = navTargets[navTargets.length - 1];
    }
    return current ? current.link.dataset.navSection : null;
  };

  const syncNav = () => {
    if (navLocked) return;
    const id = pickNavSection();
    if (id) paintNav(id);
  };

  // 点到哪一项，哪一项立刻亮起
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      paintNav(link.dataset.navSection);
      navLocked = true;
      window.clearTimeout(navLockTimer);
      navLockTimer = window.setTimeout(() => {
        navLocked = false;
        syncNav();
      }, 700);
    });
  });

  let navFrame = 0;
  const onNavScroll = () => {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      syncNav();
    });
  };

  window.addEventListener("scroll", onNavScroll, { passive: true });
  window.addEventListener("resize", onNavScroll);
  syncNav();
}

// 顶栏滚动状态：离开首屏后由透明变为带模糊的实底，让内容在其下滚动时仍保有层次
const siteHeader = document.querySelector("[data-site-header]");
if (siteHeader) {
  const SCROLLED_AT = 24;
  let headerFrame = 0;
  const syncHeader = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > SCROLLED_AT);
  };
  const onHeaderScroll = () => {
    if (headerFrame) return;
    headerFrame = requestAnimationFrame(() => {
      headerFrame = 0;
      syncHeader();
    });
  };
  window.addEventListener("scroll", onHeaderScroll, { passive: true });
  window.addEventListener("resize", onHeaderScroll);
  syncHeader();
}

// 汉堡菜单：仅在窄屏出现，展开/收起区块导航面板
const navToggle = refs.navToggle;
if (navToggle && siteNav) {
  const mobileNav = window.matchMedia("(max-width: 840px)");
  let navOpen = false;

  const setNavOpen = (open) => {
    navOpen = open;
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", t(open ? "nav.close" : "nav.toggle"));
    siteNav.dataset.navOpen = String(open);
  };

  navToggle.addEventListener("click", () => setNavOpen(!navOpen));

  // 选中某一条后即收起，避免面板盖住刚滚到的内容
  siteNav.querySelectorAll("a[data-nav-section]").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navOpen) {
      setNavOpen(false);
      navToggle.focus();
    }
  });

  // 点面板以外区域收起
  document.addEventListener("pointerdown", (event) => {
    if (!navOpen) return;
    if (siteHeader && siteHeader.contains(event.target)) return;
    setNavOpen(false);
  });

  // 视口回到桌面宽度时复位，避免残留的展开态影响桌面布局
  const resetOnDesktop = () => {
    if (!mobileNav.matches) setNavOpen(false);
  };
  mobileNav.addEventListener("change", resetOnDesktop);
  resetOnDesktop();
}

// 分割线的展开与 .reveal 同一套观察逻辑：进入视口后播放一次，然后解除观察
const ruleItems = document.querySelectorAll(".section-rule");
const revealItems = document.querySelectorAll(".reveal");
if (reduceMotion.matches || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
  ruleItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  revealItems.forEach((item) => observer.observe(item));
  // 分割线所在区块很高，阈值取小值，保证刚露头就展开
  const ruleObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      ruleObserver.unobserve(entry.target);
    });
  }, { threshold: 0.02, rootMargin: "0px 0px -4% 0px" });
  ruleItems.forEach((item) => ruleObserver.observe(item));
}

// 入场：指标卡片、风险提示、FAQ 卡片、记录区卡片与底纹各自一次。
// 各类元素错峰出现，但共用同一套「进视口播放一次就解除观察」的机制。
const entranceGroups = [
  document.querySelectorAll(".privacy-facts"),
  document.querySelectorAll(".platform-note"),
  document.querySelectorAll(".faq"),
  document.querySelectorAll(".ledger"),
  document.querySelectorAll(".records-illustration"),
].filter((group) => group.length);

if (entranceGroups.length) {
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    entranceGroups.forEach((group) => group.forEach((el) => el.classList.add("is-visible")));
  } else {
    const entranceObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        entranceObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
    entranceGroups.forEach((group) => group.forEach((el) => entranceObserver.observe(el)));
  }
}

// 第六屏票根：进入视口后从右侧滑入
const destinationPlates = document.querySelectorAll(".destination-plate");
if (destinationPlates.length) {
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    destinationPlates.forEach((plate) => plate.classList.add("is-settled"));
  } else {
    const plateObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-settled");
        plateObserver.unobserve(entry.target);
      });
    }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });
    destinationPlates.forEach((plate) => plateObserver.observe(plate));
  }
}

// 安装教程：数字步骤保持可点击、可键盘操作，并把当前步骤的视觉重点交给用户。
const installSteps = document.querySelector("[data-install-steps]");
if (installSteps) {
  const stepItems = Array.from(installSteps.querySelectorAll("[data-install-step]"));
  const stepButtons = Array.from(installSteps.querySelectorAll("[data-install-trigger]"));
  const setInstallStep = (step, shouldScroll = false) => {
    stepItems.forEach((item) => {
      const active = item.dataset.installStep === String(step);
      item.classList.toggle("is-active", active);
    });
    stepButtons.forEach((button) => {
      const active = button.dataset.installTrigger === String(step);
      button.setAttribute("aria-pressed", String(active));
    });
    if (shouldScroll) {
      const target = stepItems.find((item) => item.dataset.installStep === String(step));
      target?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    }
  };

  stepButtons.forEach((button) => {
    button.addEventListener("click", () => setInstallStep(button.dataset.installTrigger, true));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const current = stepButtons.indexOf(button);
      const next = event.key === "ArrowRight"
        ? (current + 1) % stepButtons.length
        : (current - 1 + stepButtons.length) % stepButtons.length;
      stepButtons[next].focus();
      setInstallStep(stepButtons[next].dataset.installTrigger, true);
    });
  });
  setInstallStep("1");
}

// 先落地主题与语言（不带持久化，避免覆盖用户已有选择），再渲染视图
applyTheme(theme, false);
applyLang(lang, false);

// 安装教程的深浅两张插画叠在同一容器里靠 opacity 切换，浏览器会无视
// loading="lazy" 把两张都拉下来，而每张原图接近 2 MB —— 等于每个访客白下
// 一张永远看不见的图。这里改成按当前主题决定给谁设 src，另一张永不下载。
//
// 判断依据是 data-theme 而不是 opacity：主题属性一变 MutationObserver 立刻
// 回调，此时 520ms 的 opacity 过渡还没开始，按 opacity 判断会读到切换前的
// 旧值，导致切过去的那张永远不加载。
const themeArt = document.querySelectorAll("img[data-theme-art]");
const loadThemeArt = () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  themeArt.forEach((img) => {
    const wanted = img.classList.contains("install-art-image-light") === isLight;
    if (!wanted) return;
    const pending = img.dataset.src;
    if (pending && img.getAttribute("src") !== pending) img.setAttribute("src", pending);
  });
};
if (themeArt.length) {
  loadThemeArt();
  new MutationObserver(loadThemeArt).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });
}

const starChip = document.querySelector("[data-stars]");
if (starChip) {
  const renderStars = (value) => {
    if (!Number.isInteger(value) || value < 0) return;
    starChip.textContent = String(value);
    starChip.hidden = false;
  };
  const cacheKey = "bwp-github-stars";
  // 限流恢复前先记住旧值：GitHub 未认证接口每小时仅 60 次/IP，
  // 同一网络下任何人刷爆配额，所有人都会拿到 403。
  let cached = null;
  try {
    cached = localStorage.getItem(cacheKey);
    if (cached !== null) renderStars(Number.parseInt(cached, 10));
  } catch {
    cached = null;
  }
  // 直接问 GitHub；失败再退到 shields.io（它用自有凭据取数，不受同一配额限制）
  const sources = [
    () => fetch("https://api.github.com/repos/Gavin-gwj/bilibili-watch-panel", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000)
    }).then((r) => {
      if (!r.ok) throw new Error("GitHub API unavailable");
      return r.json();
    }).then((d) => d.stargazers_count),
    () => fetch("https://img.shields.io/github/stars/Gavin-gwj/bilibili-watch-panel.json", {
      signal: AbortSignal.timeout(5000)
    }).then((r) => {
      if (!r.ok) throw new Error("shields.io unavailable");
      return r.json();
    }).then((d) => Number.parseInt(d.value, 10))
  ];
  const trySource = (index) => {
    if (index >= sources.length) {
      // 全部失败：保留已渲染的缓存值，没有缓存才隐藏
      if (cached === null) starChip.hidden = true;
      return;
    }
    Promise.resolve().then(sources[index]).then((value) => {
      if (!Number.isInteger(value) || value < 0) throw new Error("bad value");
      renderStars(value);
      try {
        localStorage.setItem(cacheKey, String(value));
        cached = String(value);
      } catch {}
    }).catch(() => trySource(index + 1));
  };
  trySource(0);
}
/* 记录区的背景时序插图用 preserveAspectRatio="none" 压扁，
   好处是不必逐一改坐标就能收窄纵向高度，代价是圆点被拉成椭圆。
   这里量出实际的横纵缩放比，把反向拉伸量写进 --illu-squash，
   让节点重新变回正圆；文字与线宽不受影响。 */
const measureIllustration = () => {
  const svg = document.querySelector(".records-illustration");
  if (!svg) return;

  const box = svg.getBoundingClientRect();
  if (!box.width || !box.height) return;

  // viewBox 是 0 0 560 240，两轴的实际缩放比即「屏幕像素 / 用户单位」
  const scaleX = box.width / 560;
  const scaleY = box.height / 240;
  if (!scaleX || !scaleY) return;

  // 节点默认已被压成 scaleY/scaleX 的高度比，反向拉回来
  const squash = Math.min(6, Math.max(0.2, scaleX / scaleY));
  svg.style.setProperty("--illu-squash", squash.toFixed(3));

  // 文字被横向拉伸 scaleX/scaleY 倍，做一次等量反向压缩，把字宽拉回正常
  const unsquash = Math.min(1, scaleY / scaleX);
  svg.style.setProperty("--illu-unsquash", unsquash.toFixed(3));
};

measureIllustration();
window.addEventListener("resize", measureIllustration, { passive: true });
window.addEventListener("load", measureIllustration);

// 原生 fullpage 节奏：CSS scroll-snap 负责磁吸，IntersectionObserver 只负责 cross-fade 的当前屏状态。
const initFullpageSnap = () => {
  const sections = Array.from(document.querySelectorAll("main > section"));
  if (!sections.length) return;

  document.documentElement.dataset.scrollMode = "snap";
  const setActive = (section) => {
    sections.forEach((item) => item.classList.toggle("is-crossfade-active", item === section));
  };
  setActive(sections[0]);

  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;
  document.documentElement.dataset.crossfade = "ready";

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActive(visible.target);
  }, {
    threshold: [0.18, 0.36, 0.56, 0.76],
    rootMargin: "-8% 0px -8% 0px"
  });
  sections.forEach((section) => observer.observe(section));
};

initFullpageSnap();

// 固定种子让同一条示例评论始终使用同一头像，无需读取或保存用户数据。
const avatarForSeed = (seed) => {
  const pool = [
    "docs/assets/avatars/reader-cat.webp",
    "docs/assets/avatars/reader-panda.webp",
    "docs/assets/avatars/reader-bird.webp"
  ];
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return pool[(hash >>> 0) % pool.length];
};

const siteIcon = document.querySelector('link[rel="icon"]');
document.querySelectorAll(".faq-avatar img[data-avatar-seed], .faq-avatar img[data-site-avatar]").forEach((avatar) => {
  const container = avatar.closest(".faq-avatar");
  const syncAvatar = () => {
    const loaded = avatar.naturalWidth > 0;
    avatar.hidden = !loaded;
    container.classList.toggle("is-fallback", !loaded);
  };
  avatar.addEventListener("load", syncAvatar);
  avatar.addEventListener("error", syncAvatar);
  if (avatar.hasAttribute("data-site-avatar")) {
    if (siteIcon) avatar.src = siteIcon.href;
  } else {
    avatar.src = avatarForSeed(avatar.dataset.avatarSeed);
  }
  if (avatar.complete) syncAvatar();
});

document.querySelectorAll('.faq[data-faq-state="ready"]').forEach((faq) => {
  if (!faq.querySelector(".faq-board > .faq-item")) faq.dataset.faqState = "empty";
});

const initCursorTrail = () => {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (reduceMotion.matches || !finePointer.matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "cursor-trail";
  canvas.dataset.cursorTrail = "";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.remove();
    return;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let lastPoint = null;
  let palette = [[255, 128, 164], [138, 168, 120]];
  const particles = [];

  const readPalette = () => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => {
      const values = styles.getPropertyValue(name).split(",").map((value) => Number.parseFloat(value));
      return values.length === 3 && values.every(Number.isFinite) ? values : fallback;
    };
    palette = [read("--trail-primary", palette[0]), read("--trail-secondary", palette[1])];
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles.length = 0;
  };

  const spawn = (x, y, speed) => {
    if (particles.length >= 140) particles.shift();
    const angle = Math.random() * Math.PI * 2;
    const spread = Math.min(1.4, speed * 0.025);
    const color = palette[Math.random() < 0.78 ? 0 : 1];
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * spread,
      vy: Math.sin(angle) * spread - 0.08,
      radius: 0.6 + Math.random() * 1.35,
      life: 1,
      decay: 0.022 + Math.random() * 0.018,
      color,
    });
  };

  const draw = () => {
    frame = 0;
    context.clearRect(0, 0, width, height);
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= particle.decay;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.965;
      particle.vy *= 0.965;
      const [red, green, blue] = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.min(0.62, particle.life * 0.62)})`;
      context.fill();
    }
    if (particles.length) frame = requestAnimationFrame(draw);
  };

  const requestDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const point = { x: event.clientX, y: event.clientY };
    if (!lastPoint) lastPoint = point;
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    const steps = Math.min(10, Math.max(1, Math.ceil(distance / 7)));
    for (let step = 1; step <= steps; step += 1) {
      spawn(
        lastPoint.x + ((point.x - lastPoint.x) * step) / steps,
        lastPoint.y + ((point.y - lastPoint.y) * step) / steps,
        distance,
      );
    }
    lastPoint = point;
    requestDraw();
  }, { passive: true });

  window.addEventListener("pointerleave", () => { lastPoint = null; }, { passive: true });
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    particles.length = 0;
    lastPoint = null;
    context.clearRect(0, 0, width, height);
  });
  new MutationObserver(readPalette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  readPalette();
  resize();
};

initCursorTrail();

document.documentElement.classList.add("js-ready");
