# Prototype Instructions

开发优先级：先完成并验证规则逻辑，再补交互动画，最后完善界面。规则计算必须可脱离浏览器和动画独立运行；扩展玩法应通过明确规则配置/能力处理器接入。未核实的原版规则要明确列出，不能把测试通过等同于完全还原。逻辑阶段优先修复状态流转、合法行动、资源守恒和结算顺序，并添加回归测试。

动画必须以原站实战视频和公开客户端中可核对的行为为准。不得自行加入大遮罩、卡牌碰撞、翻牌飞入等原版没有的效果。原版使用对应攻守列的提示块和上下遮片抽牌；新增动画要记录来源、位置、颜色、时长，并实际验证。

战斗优先：结算必须展示攻守双方所用神器、伤害/安全/反射/乱弹结果和抽牌过程。动画串行播放，未完成时不得提交下一行动。防御可用性由共享规则提前判断，不可用牌直接禁用，不能依赖提交后的错误提示。保持原站战斗布局和素材。

操作反馈遵循原版：主动奇迹可以先选牌，确认时MP不足应显示原版提示，不要只禁用按钮或静默返回。祈祷、空舍弃等失败也应提供明确提示，且失败不得提交命令、扣资源或推进回合。防守不适用的卡片仍需提前禁用。

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.
