# 动效优化 · 最终发布记录（motion4 + 视觉收尾）

## 最终冻结

| 文件 | 大小 | 时间 | SHA-256 |
|---|---|---|---|
| `app/web/app.js` | 299,604 | 03:03:18 | `EE3D408D6D6DEFFCE744F4D626EA4CC3D7BA23CE10EA25A867819221CA05C565` |
| `app/web/release-motion.css` | 44,999 | 02:55:00 | `6A4277D9A3363AFB9A25F348A4437120A6449E4692C6BEE3E92D479AC8393D8A` |
| `app/web/release-motion.js` | 18,388 | 01:53:10 | `8ACE20470B656BA00A5B0AF60B74F2BF918B87499995009908FC0E8795E962DB` |
| `app/web/index.html` | 6,612 | 02:48:59 | `0E85D79A8C56734282466597F683B5CAEA5E1B55B69A65880DAE3A447896E3C5`（全部 `?v=20261025-motion4`） |
| `scripts/qa_release_final.py` | 10,127 | 02:21:35 | `35272F50D5BFA69E100A7583B83AEA6C9387B095876650E609B36FFE58215FFF` |

## 最终证据

- 23 张截图 + contact：`D:\AAAA乱七八糟\ui-audit\final-run11`
- 终版录屏：`D:\AAAA乱七八糟\ui-audit\final-run11\page@58aa921b8c674843325aa0a8f053bf98.webm`
- QA：36/36 PASS，无 console/page error，不写 demo 数据。
- dist/zip/安装包已按 motion4 重建并安装到 `%LOCALAPPDATA%\Programs\ActivityPhotoCull`。

## 关键修复

- **复核 FLIP Q 弹恢复**：折叠左侧筛选、开合详情栏中间照片 340ms 弹性 FLIP；QA 精确断言 340ms。
- 页面切换真实 DOM 磨砂帘幕，无玻璃快照/旧页透字/白闪，顶栏稳定。
- 批量栏 body portal + fixed；grid 上移 84px，最后一行不遮挡；深玻璃高对比。
- 弹窗 scrim/壳同步退；入场 transform-only；首配 760ms Q（motion off 静止）；回焦 token。
- 照片详情 220/180ms；右栏单滚动+提示；900 单列照片 430px + 右栏 38vh 滚动。
- 更多菜单 z-index 抬层；Esc 走局部 closeMore，150ms 退场且关闭中可反向重开。
- 设置 jump 8 项、吸顶深玻璃背板；筛选 active 深字；设置 tab 深色 puck；Toast/CTA 深玻璃；900 详情抽屉小图+标题/操作首屏。
- 低性能/software 模糊全关；motion off 全静止；缓存 motion4。

## 已知非阻塞（P3）

- 连续 5 次 Toast 最旧一条立即移除。
- 页面帘幕约 0.33s 全屏虚焦偏重。
- 照片详情滚动提示会短暂压住最后一行状态字。
- 900 卡片第三标签“保留”会省掉（行完整）。
- 会写数据的批量保留/删除/导出、真实 AI 发送未执行。
