# WWB

可扩展的 God Field 网页游戏重建工程，包含多人战斗、独立规则引擎和管理后台。前端使用 React + TypeScript，服务端使用 Node.js + Express + Socket.IO，持久化使用 SQLite。

## 本地运行

安装 Node.js 22.13 或更新版本，在仓库根目录执行：

```sh
cd game
npm ci
npm start
```

- 游戏：http://127.0.0.1:5173/
- 管理后台：http://127.0.0.1:5173/admin

默认仅监听本机。后台初始账号和初始化方式见[后台使用说明](game/docs/admin-guide.md)。

## 项目文档

| 文档 | 用途 |
| --- | --- |
| [更新日志](CHANGELOG.md) | 按时间记录已完成的功能、修复和迁移要求 |
| [开发与文档维护约定](CONTRIBUTING.md) | 每次修改如何验证，以及需要同步哪些文档 |
| [工程说明](game/README.md) | 当前范围、目录职责、启动和玩法扩展方式 |
| [后台使用与运维](game/docs/admin-guide.md) | 数据管理、发布、权限、备份与迁移 |
| [后台设计](game/docs/admin-design.md) | 设计理由、实现范围与后续扩展方向 |
| [实现顺序](game/docs/implementation-order.md) | 按规则、动画、界面的顺序推进工作 |
| [规则核对](game/docs/rule-audit.md) | 已核对规则及仍需验证的行为 |
| [动画参考](game/docs/animation-reference.md) | 动画依据与表现规范 |
| [研究与差异](game/docs/research.md) | 原站资料、证据和重建限制 |
| [视觉验收](game/design-qa.md) | 界面与交互检查记录 |

## 换电脑与数据

代码可通过 Git 同步。在 `game` 目录运行 `npm run backup` 备份数据；用户、后台配置、发布历史和上传图片不会随 `git pull` 下载，需要按[迁移说明](game/docs/admin-guide.md#数据备份和换电脑)另行迁移。

这是独立重建工程，不代表取得原站服务端源码，也不保证所有隐藏规则完全一致。素材和名称的权利归原作者，当前未获得素材再发布许可。
