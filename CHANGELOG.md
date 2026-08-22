# 更新日志

本项目的所有重要变更记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [0.1.0] - 2026-08-22

### 新增
- 本地优先驾驶舱：总览、内容、质量、来源中心四个视图，全中文界面
- 项目证据卡架：固定槽位，方向键 / 滚轮 / 拖动 / 点击选择，新项目入场动画
- 十四天活动轨迹热力图与按日下钻
- 十一个来源适配器：Obsidian、Git、Codex、Claude、iFlow、ZCode、Kimi Code、Gemini、Hermes、OpenClaw、Exports 兼容层
- ZCode 适配器经真实 CLI rollout 数据验证（45 条记录零失败）
- 逐来源授权：默认仅元数据，正文需单独授权；撤销与删除派生索引相互独立
- 本地控制 API：安装令牌 + Origin 校验 + CSRF 防护
- 打包后的应用自托管界面与 API（同一回环源，严格 CSP）
- GitHub Actions 双平台构建（macOS DMG / Windows NSIS），测试门禁

### 安全
- 静态 UI 服务拒绝路径穿越；渲染层强制内容安全策略
- 敏感环境变量与凭据类字段在指标提取中默认过滤
