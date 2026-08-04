# DeskHabitat

A tiny animated animal habitat living on your desktop.

一个生活在桌面上的微型动物栖息地。

## 当前阶段

项目已完成 M0 至 M5；M6 工具栏、放置预览、设施移动旋转删除及布局校验已进入验收阶段。

当前技术栈：

- Electron 43
- TypeScript 6
- PixiJS 8
- Vite 8
- electron-builder
- Node.js 内置测试运行器

## 环境要求

- Windows 10/11 x64
- Node.js 24 或更高版本
- npm 11 或更高版本

## 开发

```bash
npm install
npm run setup:electron
npm run dev
```

开发环境默认使用居中的 `900×600` 普通可缩放调试窗口，避免透明全屏窗口影响日常操作。需要缩放或操作窗口时，先从托盘切换到“布置模式”；生活和暂停模式默认启用鼠标穿透。需要在开发环境验收真实桌面覆盖行为时使用：

```powershell
$env:DESK_HABITAT_DESKTOP_WINDOW = "1"
npm run dev
```

托盘菜单可以切换生活、布置和暂停模式，也可以恢复鼠标穿透、切换置顶策略及退出应用。开发调试窗口中可按 `Ctrl+Shift+P` 强制恢复鼠标穿透。

Electron 43 的 Windows 运行时会在首次执行 `npm run setup:electron` 或启动应用时下载。如果所在网络访问 Electron 发布服务器较慢，可以按照 Electron 官方安装说明配置镜像；不要把个人的全局镜像配置提交到仓库。

由于当前项目父目录包含 `#`，Vite 开发服务器无法可靠解析源码 URL。`npm run dev` 会改用 Vite 持续构建，并在构建产物变化时自动重启 Electron；保存源码后仍会自动刷新运行中的应用。

常用命令：

```bash
npm run check      # 静态检查、类型检查和单元测试
npm run build      # 生成主进程、preload 和渲染层生产构建
npm start          # 构建并启动生产模式
npm run dist:win   # 生成 Windows NSIS 安装包
```

## 架构边界

- `src/main`：Electron 窗口、应用生命周期和系统能力。
- `src/preload`：向渲染层暴露最小、类型安全的白名单 API。
- `src/renderer`：PixiJS 渲染与后续桌宠交互。
- `src/shared`：IPC 契约及不依赖运行环境的共享逻辑。
- `tests`：可独立运行的核心逻辑测试。

安全默认值为 `contextIsolation: true`、`nodeIntegration: false` 和 `sandbox: true`。渲染层不能直接使用 Node.js 或文件系统。

## 项目文档

- [完整项目计划书](./IMPLEMENTATION_PLAN.md)
- [M1 Windows 人工验收清单](./docs/M1_MANUAL_TEST.md)
- [M2 等距世界人工验收清单](./docs/M2_MANUAL_TEST.md)
- [M3 兔子与基础模拟人工验收清单](./docs/M3_MANUAL_TEST.md)
- [M4 导航与栅栏人工验收清单](./docs/M4_MANUAL_TEST.md)
- [M5 需求与设施闭环人工验收清单](./docs/M5_MANUAL_TEST.md)
- [M6 布置模式人工验收清单](./docs/M6_MANUAL_TEST.md)
