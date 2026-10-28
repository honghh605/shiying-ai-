# 动效优化 · 验收与审查记录

## 冻结版本

- `app/web/app.js` 2026-10-25 02:01
- `app/web/release-motion.css` 2026-10-25 02:01
- `app/web/release-motion.js` 2026-10-25 01:53
- 打包产物：`dist/拾影-v1.0.0-win64.zip`、`dist/拾影-安装包-v1.0.0.exe`、`dist/拾影-升级包-v1.0.0.exe`

## 自动验收

`scripts/qa_release_final.py`（只读，不创建活动、不写照片决定、不改偏好）：

- **35/35 PASS**，无 console/page error。
- 覆盖：页面帘幕、设置 jump 8 项、弹窗遮罩/玻璃退场、滚动进度、筛选 active、批量栏视口固定/网格与栏不重叠/入场、右键菜单 Esc、Agent 开关、照片详情入/出/单栏滚动/提示、灯箱、Toast 对比度/3 条上限、快速导航、900 宽筛选可达。
- 验证环境：Edge (Chromium) 1440×900，demo 服务 `127.0.0.1:8945`，liquid + light + glass 69 + motion on。

## 关键问题修复表

| 轮次发现 | 修复 |
|---|---|
| 批量栏随 grid 滚动、遮住最后一行 | `#batch-actions` portal 到 body，视口固定；多选时 grid 底部留 84px 空间，批量栏不再覆盖任何行 |
| 页面切换整页透明 / 旧页透字 / 白闪 | 移除玻璃快照/`#app` transform，改为真实 DOM 磨砂帘幕 `#rm-page-veil`，旧页-新页不叠字，顶栏稳定 |
| 弹窗关闭遮罩硬切、内容磨砂块 | scrim/玻璃壳同步 CSS 淡出，不再在带 backdrop-filter 的父层内动子层 opacity |
| 照片详情关闭无退场、打开无动画 | 关闭显式 `closing` 220ms；打开先提交 closed 帧再 add `open`，220ms 淡入 |
| Agent 关闭瞬移、motion off 仍动画 | 去掉 fill:both 入场 animation 与退场 transition 冲突；480ms spring；`html[data-motion=off]` 高特异性全面静止 |
| 详情栏收起瞬跳 | 高特异性补回 `grid-template-columns`/opacity/transform 过渡，标准与液态一致 |
| 设置 jump active 错位、底部关于不亮 | 按 DOM 实际 top 排序，底部强制最后一项；只绑定一次，清理 scroll/resize/observer |
| 动效关闭仍平滑滚动 | `html[data-motion=off] { scroll-behavior:auto!important; }` + `canAnimate()` |
| Toast 浅色不可读、退场瞬隐 | 深色浮动玻璃 + 高对比文字；WAAPI 180ms 退场；最多 3 条 |
| 更多菜单/右键菜单 Esc、反向重开 | 全局 Escape 处理；更多菜单 token 反向中断；关闭从当前帧开始 |
| 浅色主题小字/面包屑/设置说明 | 文字胶囊、阴影、深色玻璃提示条 |
| 筛选 active 太弱 / 900 窄屏裁切 | accent 胶囊+左色条+计数变色；窄屏筛选换行 |
| 处理中提示压按钮 | 移到左下 |
| 首配弹窗 motion off 仍 760ms | 关闭时 `animation:none`，遮罩静态 |
| 低性能/software 大面积模糊 | 页面帘幕/modal/photo inspect/batch 关闭 backdrop-filter |
| 被 ui-polish 覆盖的 topnav/roll 过渡 | 移除全局 transition 覆盖，roll 高特异性补 transform |

## 人工证据

- 截图 + 录屏：`D:\AAAA乱七八糟\ui-audit\final-run2`
  - 01 活动列表、02 页面帘幕、03 设置、04 jump、05 弹窗、06–08 活动/概览/更多、09–13 复核/筛选/批量/右键、14–15 照片详情（含滚动提示）、16 灯箱、17 Agent、18 窄屏、19 Toast、20 滚动。
  - 录屏：`page@554667c0c9af8c219358951105073fc9.webm`（25s 级完整交互）。

## 已知非阻塞

- 连续 5 次触发 Toast 时最旧一条直接移除（最多显示 3 条）。
- 页面切换实现为磨砂帘幕，而非计划文字中的“内容淡入 + 上浮”；已做低性能降级，无透字/白闪。
- 未在本轮执行会写入数据的批量保留/删除/导出与真实 AI 发送（按只读验收约束）。
