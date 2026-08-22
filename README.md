# MyWorkbench

**本地优先的个人工作证据驾驶舱**（macOS / Windows）。界面为中文。

MyWorkbench 只扫描用户明确授权的本地目录，默认仅采集元数据，派生索引保存在本机，绝不写入原始来源。GitHub 仅用于源码与发布分发，不作为用户数据后端。

## 当前状态（v0.1.0）

- OLED 驾驶舱界面（总览 / 内容 / 质量 / 来源中心），全中文
- 固定槽位项目证据卡架：方向键、滚轮、拖动、点击选择；新项目入场动画
- 底部十四天活动轨迹，读取真实热力图数据
- 来源中心：11 个来源适配器（Obsidian、Git、Codex、Claude、iFlow、ZCode、Kimi Code、Gemini、Hermes、OpenClaw、Exports 兼容层），逐来源授权，正文单独授权
- 打包后的应用自托管界面与 API（同一回环源），带严格 CSP
- 质量视图区分成功 / 部分成功 / 被阻止的扫描与安全诊断

## 运行

```bash
npm install
npm run dev:web   # 界面服务（127.0.0.1:5173）
npm start         # 桌面窗口（开发模式）
```

打包安装镜像：

```bash
npm run dist:mac -c.directories.output=/tmp/myworkbench-release   # 本机建议加输出覆盖
npm run dist:win
```

推送 `v*` 标签会触发 GitHub Actions 构建双平台安装包。

## 开发顺序文档

1. 需求 — [docs/requirements.md](docs/requirements.md)
2. 设计 — [docs/design.md](docs/design.md)
3. 差距矩阵 — [docs/gap-matrix.md](docs/gap-matrix.md)
4. 实施计划 — [docs/implementation-plan.md](docs/implementation-plan.md)
5. 开源选型 — [docs/research/open-source-options.md](docs/research/open-source-options.md)
6. 当前状态 — [docs/m4-status.md](docs/m4-status.md)

## 隐私承诺

- 未逐来源明确授权前不扫描
- 默认仅元数据；会话与笔记正文需逐来源单独授权
- Git 源码正文不在 v1.0 索引范围
- 原始来源严格只读
- 派生索引可按来源删除并从已授权来源重建
- 用户数据、真实路径、会话正文、导出、数据库与日志绝不提交到仓库
