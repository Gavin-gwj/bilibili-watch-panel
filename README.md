<p align="center">
  <img src="./docs/assets/banner.png?v=20261005-plugin" alt="Bilibili Watch Panel 项目封面">
</p>

<p align="center">
  <strong>Bilibili Watch Panel</strong><br>
  本地优先的 B 站观看数据统计与可视化 Tampermonkey 用户脚本
</p>

<p align="center">
  <a href="https://github.com/Gavin-gwj/bilibili-watch-panel/releases/tag/v0.9.1"><img src="https://img.shields.io/badge/version-0.9.1-fb7299" alt="version"></a>
  <img src="https://img.shields.io/badge/Tampermonkey-compatible-4a90d9" alt="Tampermonkey compatible">
  <img src="https://img.shields.io/badge/storage-local--only-6c757d" alt="local only">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license">
</p>

<p align="center">
  <a href="https://gavin-gwj.github.io/bilibili-watch-panel/">在线展示</a> ·
  <a href="https://bilibili-watch-panel.liuyigavin2025.workers.dev">备用展示地址</a> ·
  <a href="./bilibili-watch-panel.user.js">安装脚本</a> ·
  <a href="./CHANGELOG.md">版本记录</a>
</p>

---

## 项目简介

Bilibili Watch Panel 是一个运行在 B 站页面上的 Tampermonkey 用户脚本。它会记录你实际观看视频时的播放进度，并在浏览器本地整理成可查询的观看档案。

它适合想知道下面这些问题的人：

- 我今天、本周和累计看了多久？
- 最近看了哪些视频、番剧、课程和分 P？
- 哪些 UP 主占用了最多观看时间？
- 我的完播率、平均进度和重复观看情况怎么样？
- 最近的观看节奏和播放会话是否稳定？

项目不提供账号体系，不把观看记录上传到服务器，也不会替其他用户批量采集数据。

## 核心功能

### 观看记录

- 统计今日、本周、全部和本周报告
- 记录视频、番剧、课程以及多 P 视频的分集信息
- 统计观看时长、视频数量、完播率、平均进度和重复观看
- 记录播放会话、暂停次数、切后台次数、跳转次数和结束原因
- 查看 UP 主排行、每日趋势、近一年热力图和观看记录详情

### 数据管理

- 导出 JSON 本地备份
- 导入 JSON 并合并重复记录与播放会话
- 导出本周报告 PNG
- 清空记录前二次确认
- 记录数量较大时自动归档，并保留归档提示

### 使用体验

- 可拖动的悬浮入口
- 面板宽度、主题、按钮尺寸和快捷键设置
- `Alt + Shift + W` 快捷键打开或关闭面板
- 分层 `Esc` 关闭详情、设置和面板
- 只读数据健康检查

## 界面预览

下面的总览图展示了插件面板的主要视图。在线展示页只是项目的可视化演示，不是数据服务端；观看记录始终保存在当前浏览器中。

<p align="center">
  <img src="./docs/assets/overview.png?v=20261005-plugin" alt="Bilibili Watch Panel 五个界面总览">
</p>

面板包含四个主要视图：

| 视图 | 主要内容 |
| --- | --- |
| 今日 | 当前观看时长、视频数、质量指标和播放会话 |
| 本周 | 近 7 / 30 天趋势、连续观看、环比和本周洞察 |
| 全部 | 累计统计、热力图、搜索和完整观看记录 |
| 报告 | 本周总览、UP 主排行、每日时长和高峰时段 |

## 工作原理

脚本只在视频播放页采集播放事件，并通过 `video.currentTime` 的真实推进计算有效观看时长：

```text
B 站公开页面信息
        │
        ▼
播放事件采集 → 本地记录合并 → 统计指标计算 → Shadow DOM 面板渲染
                         │
                         ├─ JSON 导出 / 导入
                         └─ 本周报告 PNG 导出
```

- 暂停、卡顿、切换后台和未发生真实推进的时间不会被当作有效观看时长。
- 手动向前跳转不会被误记为重复观看；只有回到本次已观看区间并继续播放才计入重看。
- 普通视频、番剧和课程使用不同的媒体标识，多 P 视频的每个分 P 独立统计。
- 本地数据使用 schema 版本管理，升级时会兼容旧记录并补齐缺失字段。

## 隐私与权限

- 只匹配 `https://*.bilibili.com/*` 页面。
- 使用 Tampermonkey 的 `GM_getValue`、`GM_setValue` 和 `GM_deleteValue` 保存本地数据。
- 使用 Chart.js 绘制统计图表，使用 html2canvas 导出报告图片。
- 不建立账号，不上传观看记录，不设置项目服务端。
- 只读取 B 站页面已经公开加载的信息，不批量爬取、不破解、不绕过会员或付费机制。

卸载脚本或清除浏览器扩展数据后，本地记录会消失。建议定期使用「导出 JSON」备份。

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 [`bilibili-watch-panel.user.js`](./bilibili-watch-panel.user.js)。
3. 点击 GitHub 页面右上角的 **Raw**，Tampermonkey 会打开安装页。
4. 确认安装后打开任意 B 站页面。
5. 点击页面右侧的粉色悬浮按钮，开始查看面板。

脚本支持自动更新，更新地址指向本仓库的 `main` 分支：

```text
https://raw.githubusercontent.com/Gavin-gwj/bilibili-watch-panel/main/bilibili-watch-panel.user.js
```

## 开发与验证

仓库中的逻辑回归测试可以直接使用 Node.js 运行：

```bash
node tests/v0.8.test.cjs
node tests/v0.9.test.cjs
node tests/watch-repeat.test.cjs
```

当前版本为 `0.9.1`，重点覆盖多媒体类型解析、旧数据迁移、播放时长统计和重复观看判断。

## 常见问题

| 问题 | 回答 |
| --- | --- |
| 数据存在哪里？ | 存在当前浏览器的 Tampermonkey 本地存储中，仓库和展示页都收不到观看记录。 |
| 为什么时长比实际看的少？ | 只统计视频播放进度真实推进的时间，暂停、卡顿、后台和缓冲不会计入。 |
| 为什么拖动进度条没有增加重看？ | 向前跳转或跳到未观看位置不会计入；回到本次已观看区间并继续播放才会计入。 |
| 如何迁移到新设备？ | 在旧设备导出 JSON，在新设备安装脚本后使用「导入 JSON」。 |
| B 站改版后没有数据怎么办？ | 刷新页面并检查脚本是否更新；如果仍然异常，请提交包含页面类型和控制台信息的 Issue。 |

## License

MIT
