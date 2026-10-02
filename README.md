https://github.com/Gavin-gwj/bilibili-watch-panel

# Bilibili Watch Panel · B站个人观看数据面板

![version](https://img.shields.io/badge/version-0.1.0-fb7299)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-4a90d9)
![license](https://img.shields.io/badge/license-MIT-green)

一个纯本地运行的 Tampermonkey 用户脚本：统计并可视化你在 B 站网页版看了什么、看了多久、看谁的，并生成卡片式「本周使用报告」。

> 安装文件：[`bilibili-watch-panel.user.js`](./bilibili-watch-panel.user.js)

---

## ⚠️ 合规与隐私声明（请先读）

- 只统计**我自己本机浏览器**中的观看行为，数据**仅存在浏览器本地**（`GM_setValue`）。
- **不上传任何数据**，仓库中也不包含任何观看数据。
- **不爬取、不存储他人用户数据合集**。
- **不破解、不绕过任何付费/会员机制**。
- **不干扰 B 站正常功能与计费体系**。
- 只读取页面**已公开加载**的数据，不批量请求接口。
- 除「视频信息 API 兜底」（仅在页面信息缺失时触发一次并缓存 7 天）外，不额外发送任何请求。

> 观看数据只存在于你本机浏览器的 Tampermonkey 存储中，与 GitHub 仓库完全无关。卸载脚本或清除浏览器扩展数据后记录会消失，请定期使用面板内的「导出 JSON 备份」。

---

## 安装说明（一键安装）

1. 安装浏览器扩展 **篡改猴 / Tampermonkey**（Chrome、Edge 均可在扩展商店获取）。
2. 打开仓库中的 [`bilibili-watch-panel.user.js`](./bilibili-watch-panel.user.js)。
3. 点击页面右上角的 **Raw**，Tampermonkey 会自动弹出安装页；若未弹出，则：
   - 打开 Tampermonkey 面板 → 「添加新脚本」；
   - 全选删除默认内容，粘贴本脚本全文；
   - `Ctrl + S` 保存。
4. 打开任意 B 站视频页（`https://www.bilibili.com/video/...`），页面右侧会出现粉色圆形按钮。

---

## 功能说明

### 1. 个人观看数据面板

| Tab | 内容 |
| --- | --- |
| 今日 | 今日总时长、今日视频数、按 UP 主分布饼图 |
| 本周 | 近 7 天每日时长折线图、本周 Top5 UP 主柱状图 |
| 全部 | 累计总时长 / 总视频数 / 覆盖 UP 主数、最近 20 条观看记录 |
| 报告 | 卡片式本周使用报告，可导出 PNG 图片 |

### 2. 本周使用报告

- 顶部大数字卡：本周总时长、本周视频数
- 最爱 UP 主 Top5：名称 + 观看次数 + 时长（带占比条）
- 每日时长迷你折线卡
- 观看高峰时段卡：凌晨 / 上午 / 下午 / 晚上四段
- 底部一句话自动总结
- 「导出图片」按钮：生成 `bwp-week-report-YYYY-Www.png` 下载
- 每周日首次打开 B 站时，右下角轻提示，点击直达报告 Tab（`lastReminderWeek` 去重，每周一次）

### 3. 数据管理

- **导出 JSON 备份**：面板底部一键下载 `bwp-backup-YYYY-MM-DD.json`，含 `watchRecords` 与归档。
- **清空全部数据**：带**两次确认**，清空后不可恢复。
- **拖动浮动按钮**：按住拖动，松手自动吸附左右边缘，位置本地记忆。

### 4. 统计口径

- 按**实际播放进度（`video.currentTime` 推进量）**统计，不乘倍速，卡顿/缓冲不计。
- 同一自然日、同一视频只保留一条记录，重复打开累加时长并增加 `openCount`。
- 一周以**周一**为起点，周报按 ISO 周标识（如 `2026-W40`）。
- 数据超过 5000 条自动归档旧记录，保证长期使用不卡顿。

---

## 常见问题（FAQ）

| 问题 | 回答 |
| --- | --- |
| 数据存在哪？ | 只存在本机浏览器的 Tampermonkey 扩展存储里（`GM_setValue`）。仓库与任何服务器都收不到你的数据。 |
| 会不会上传我的数据？ | 不会。脚本没有任何数据上报端点，也不使用 `XMLHttpRequest`/`sendBeacon`。 |
| 怎么清空数据？ | 面板底部设置区 → 「清空全部数据」→ 两次确认。 |
| 怎么导出/迁移数据？ | 面板底部设置区 → 「导出 JSON 备份」，得到完整 JSON。当前版本暂不支持导入。 |
| 会不会拖慢 B 站？ | 心跳每 5 秒一次轻量计算；面板关闭时不渲染图表；关闭面板会销毁全部 Chart 实例；存储写入有 15 秒节流。 |
| 为什么时长比实际看的少？ | 只统计 `video.currentTime` 的真实推进；卡顿、缓冲、切后台、暂停都不计入。 |
| B 站改版后不显示数据了怎么办？ | 所有页面选择器集中在脚本的 `SELECTORS` 常量区，改版后只需更新对应选择器，不影响已有数据。 |
| 会员/番剧/直播会统计吗？ | 不会。只处理 `/video/` 路径，且不破解、不绕过任何付费机制。 |

---

## 版本历史

见 [CHANGELOG.md](./CHANGELOG.md)。

## 参与 / 反馈

本项目仅供作者自己使用，欢迎在仓库提 Issue 记录想法或问题：
<https://github.com/Gavin-gwj/bilibili-watch-panel/issues>

## License

MIT