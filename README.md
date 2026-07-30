# DeskHabitat

A tiny animated animal habitat living on your desktop.

一个生活在桌面上的微型动物栖息地。

## 当前阶段

项目已完成 M0 基础骨架，正式桌宠功能将从 M1 开始逐阶段实现。

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

Electron 43 的 Windows 运行时会在首次执行 `npm run setup:electron` 或启动应用时下载。如果所在网络访问 Electron 发布服务器较慢，可以按照 Electron 官方安装说明配置镜像；不要把个人的全局镜像配置提交到仓库。

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
