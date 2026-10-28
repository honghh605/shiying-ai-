# 拾影 · 2026-10-25 发布前动效/交互优化记录

## 改了什么

### 新增

- `app/web/release-motion.css`：统一按压/焦点/波纹、弹窗内容层、页面转场、菜单、抽屉、批量栏、照片详情暗场、滚动进度、滑块填充、Toast、处理中提示、减少动态。
- `app/web/release-motion.js`：全局按压反馈、局部状态脉冲、滚动反馈、设置分区滑块、range 填充、请求状态指示、菜单开关辅助。
- `scripts/qa_release_motion.py`：Playwright 自动验收（31 项）。
- `docs/release-motion-plan.md`：审计、动效令牌、验收清单与 3 个子代理审查门。

### 修改

- `app/web/app.js`
  - `api()` 派发 `cull:request-start/end`，为所有异步动作提供统一的低干扰处理指示。
  - `toast()`：最多三条、点击关闭、退场动画、进度线。
  - `showModal()`：玻璃底与内容分离；`.modal-inner` 负责 460ms 弹簧入场；`.modal-scrim` 负责遮罩淡入；首配弹窗保留原有 760ms 整窗 Q 弹。
  - `closeModal()`：内容层退场 + 遮罩淡出，不再瞬时 remove。
  - 路由：页面切换使用 View Transitions，只动内容层，顶栏保持稳定；根据导航深度做方向感。
  - 更多菜单/右键菜单：打开与关闭均可动画。
  - 批量栏：移出拥挤的 grid toolbar，改为底部浮动玻璃条，进出场均带动画；多选关闭时不会压到搜索栏。
  - 照片详情关闭：显式 `closing` 状态，退场可见。
  - lightbox / compare overlay：打开淡入，关闭时先退场；路由切换时立即清理。
  - 通用弹窗焦点陷阱与首焦点。
- `app/web/index.html`：引入新动效层，版本号统一 `20261025-motion1` 以绕过静态缓存。
- `app/web/release-motion.css` 内修正：模态、照片详情暗场、设置跳转 active 滑块、主题明暗变量适配、reduced-motion 优先级。

## 动效策略

| 层 | 时长 | 曲线 |
|---|---|---|
| 按压 | 100ms | ease |
| hover/局部反馈 | 180ms | spring |
| 菜单/批量/选择 | 260–360ms | spring |
| 页面/弹窗/抽屉/Agent | 360–520ms | spring，退场更快 |
| View Transition 页面 | 360ms | 方向感 10px 位移 |

## 验证

- `scripts/qa_release_motion.py`：31/31 通过。
- 首次配置弹窗：新空 profile 测试，760ms `first-run-pop` 与 mask 动画保留，弹窗可用。
- 标准/浅色与液态/深色主题：截图检查，无控制台异常。
- 动效关闭 / OS reduced-motion + 跟随系统：弹窗、AI 面板、光箱仍可用，静止。
- 后端测试：26 passed；1 个既有 `test_two_stage` 失败（与本次前端改动无关，需后续单独处理）。
- 已知：设置页的玻璃面板透明度受用户“玻璃透明度”设置影响，不属于本次动效层。

## 运行

```powershell
$root='D:\Documents\日常工作\活动照片初筛助手-源码-v0.5.1'
$env:LOCALAPPDATA='D:\AAAA乱七八糟\拾影演示'
& "$root\.venv\Scripts\python.exe" -m app --port 8945 --no-browser
& "$root\.venv\Scripts\python.exe" "$root\scripts\qa_release_motion.py"
```
