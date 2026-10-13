# Agent Note: 独立插件适配库的模块身份与读取生命周期

Status: implemented

## 问题

用户在其它机器上使用 npm/npx 安装的原版 dsh 0.2.1-alpha.2，要求一个 npm 插件包即可安装。上游更新不受本项目控制。dsh 的 profile 依赖解析不会让插件中的第二份 Session 覆盖安装目录中已加载的核心。另一个类的私有 attachments 也无法访问原版 SessionStore 的通知与存储关联。

## 决策

一个 npm 包同时交付 Host 与浏览器 lib。Host 仅适配精确 alpha.2：检查包版本与对象字段，更新共享 SurfaceManager 原型、原版 Session 的工具声明读取以及原版 V4 restore 的最终逻辑校验。删除始终调用原版 append，保持 Session 对象、存储句柄与通知身份。浏览器只包裹共享 Conversation 的窗口替换、追加、分页方法，原始 inputs 保留删除决策以支撑分页和注册表重建。

原 footer 仍持有其 children 和 preference hooks；插件在其声明生命周期内临时替换 renderer，卸载时恢复。重复声明原 child slots 会使 Web boot 失败，不能通过再注册相同 children 来影子覆盖。低优先级的无内容 occupant 仅触发注册表刷新。

读取适配持续到进程或页面结束，不随命令、按钮卸载恢复。必需删除事件的语义由[同会话整轮删除记录](2026-10-13-same-session-turn-deletion.md)持有；它是本次部分继承而非完全取代的活跃记录。重启后缺少插件的旧读取器拒绝这些记录。插件重新导入时，命令识别第一份读者闭包产生的稳定错误名称和代码，不能只依赖新模块的 instanceof。

## 曾考虑的替代方案

**等待上游接口发布。** 无法满足用户在当前原版上的安装要求。

**把修补核心包加入插件 dependencies。** 模块解析仍使用原版；重复 Session 类不能共享其模块私有附件，不采用。

**配套运行包和 npm overrides。** 可以统一整个依赖树，但要求额外运行包及替换启动入口，已从本项目交付路径撤下。

**读取时跳过 V4 校验。** 会接受损坏的生命周期、引用和删除范围。插件保留原物理解码，并使用完整 V4 校验与原版 Session 验证；未绕过校验。

**卸载时恢复原读者。** 会让当前进程重新解释含删除决策的日志，破坏读取一致性；只撤销用户操作贡献。

## 后果

用户沿用原 CLI，通过 plugin add 安装一个包。代价是依赖精确版本的非公共对象结构，需要在未来 dsh 版本上重新适配。普通 append 保持原增量路径，删除时重建投影。此机制不修改 dsh 安装目录，也不改写日志代际。

当前覆盖原版 npm Host、发布的浏览器 Conversation 类、AgentLoop 后续请求、JSONL flush 和冷读取、持久化分叉及插件卸载。官方 plugin add 和真实 Web 点击后服务重启通过。JSONL 独立迁移 verifier worker 未被接管；遇到必需插件记录时它会拒绝操作。其它存储与其它 dsh 版本尚无本项目的验证证据，不能由 alpha.2 默认 JSONL 的成功推定支持。
