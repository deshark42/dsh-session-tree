# dsh-session-tree

面向 dsh 的会话管理插件，正在开发首个版本。删除最后一轮消息是目前实现的第一个功能，初版尚未完成。当前开发版本为 `0.1.0`，计划使用的 npm 包名为 `@deshark42/dsh-session-tree`。

## 当前功能

最后一轮回复的时间右侧显示垃圾桶按钮。点击即可在**同一个聊天**移除这一轮的用户消息、助手回复和工具往返，并从后续模型上下文中排除。聊天 ID 不变；支持连续删除，刷新和重启后保持结果。也可以输入 `/delete-last-turn`。

## 安装

当前开发包适用于**原版 npm/npx dsh `0.2.1-alpha.2` 的 Web profile**。删除、读取和界面适配库已编译进包中，无需修补或替换 dsh，无需配套运行包，也无需改变原来的启动方式。

将 `deshark42-dsh-session-tree-0.1.0.tgz` 复制到运行 dsh 的机器，在包所在目录执行：

```sh
dsh plugin --profile web add ./deshark42-dsh-session-tree-0.1.0.tgz
```

然后重新启动原来的 dsh，并刷新浏览器。使用自定义 profile 时，把 `web` 换成实际名称。通过 npx 使用 dsh 时可以执行：

```sh
npx @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web add ./deshark42-dsh-session-tree-0.1.0.tgz
```

这是 npm 格式的本地开发包，尚未发布到 npm registry。插件管理页面也可填写本地包的路径。

安装时 peer dependency 提示来自 profile 与 dsh 安装目录的分离：依赖由当前 dsh 提供。不要向 profile 再安装一份 Session 核心包。dsh 的 Node.js 要求为 `^22.19` 或 `>=24`。

## 使用与边界

等待回复完成，或先停止回复，再点击垃圾桶。按钮只出现在最后一轮有消息的回复操作栏；回复进行中或提交尚未完成时禁用。没有助手操作栏的轮次仍可通过命令删除。空的拒绝轮次不遮挡之前的消息。

按钮发送 `/delete-last-turn <轮次号>`。Host 在 Agent 的维护锁内再次核对目标，等待日志 flush 后报告成功。旧页面和重复请求不会删除另一轮。传输结果未知时不自动重试；刷新查看命令结果。存储失败会明确报告“已经移除但保存失败”，不能假装回滚，也不应再次删除。

最后一轮之后存在独立的上下文编辑，例如手动压缩时，插件拒绝删除，以免破坏引用。轮内压缩会随整轮一起从模型消息投影排除，恢复之前被遮蔽的上下文。

原始事件仍保存在追加式日志中；此功能移除聊天展示和后续模型上下文，**不擦除磁盘内容**，也不撤销文件修改、工具执行、goal、schedule 或子 Agent 等副作用。原始日志导出、搜索和历史请求查看仍可能包含这些内容。

删除记录是必需事件。重启后读取这些聊天需要保留本插件；移除插件后，原版读取器会拒绝未知记录，防止已删除消息悄悄恢复。插件卸载只撤销命令、按钮和样式；已加载的读取适配保留至当前进程或页面结束。

适配使用 dsh 的内部实现，Host 严格检查 `0.2.1-alpha.2` 和所需字段，浏览器检查窗口方法与字段。其它 dsh 版本需要单独适配，不宣称通用兼容。目前真实安装和重启验证覆盖 Web 默认 JSONL 存储。JSONL 的独立迁移校验 worker 保持原版；若它遇到插件必需事件，会拒绝该操作。普通 V4 追加、冷读取和新建分叉不依赖替换 worker。

## 独立 lib 如何工作

Session v4 的事实是追加式事件日志：连续 `seq` 标识事件，`turn/start` 与 `turn/end` 标记一轮，`step/start` 与 `step/end` 标记模型请求与工具往返。模型消息通过 `surfaceOp` 派生；聊天界面由 Conversation 组装器派生。持久化按版本代际保存，不能直接截断已提交文件。

| 插件代码 | 职责 |
|---|---|
| `src/lib/host.ts` | 在共享原版 Session 对象上安装适配，提供插件自己的 `deleteLastTurn()` |
| `src/lib/vendor/session/` | 校验完整轮次、重建消息 Surface 与工具声明 |
| `src/lib/vendor/format/` | 完整 V4 逻辑校验，识别删除坐标与恢复后的消息引用 |
| `src/lib/client.ts` | 扩展原版 Conversation 的替换、追加、分页路径，保留原始窗口用于重建 |
| `src/client/index.ts` | 在原操作栏的声明生命周期内替换 footer，卸载时恢复原 renderer 和子插槽 |
| `src/index.js` | 注册命令，持有维护锁至保存完成 |

lib 通过**原版 `Session.append()`**写入必需的 `session/turn-deleted { turn, startSeq, endSeq }`，保留原版 SessionStore 的私有 attachments、事件通知和存储句柄。它不另建一份 Session 类，也不修改安装目录的文件。原格式读取器继续负责物理解码、事件连续性与继承切点；包含删除记录时，最后的逻辑校验使用插件的 V4 校验器和适配后的原版 Session。

仅把修补 Session 放进插件 dependencies 无法达到这个效果：dsh 的核心已经加载了安装目录中的模块，插件依赖中的另一份类无法替换它。

构建产物为 `lib/host.js` 和 `lib/client.js`，一起进入同一个 npm 包。`lib/` 是生成目录，不提交到 Git；`npm pack` 会自动构建并将其打包。复用代码及许可证见 [THIRD-PARTY.md](THIRD-PARTY.md)。

## 开发验证

构建工具和浏览器测试辅助代码使用相邻 dsh 源码的开发依赖；源码位于别处时设置 `DSH_SOURCE`。删除实现本身已 vendored，不要求 dsh 源码带有核心补丁。

先准备隔离的原版测试运行时：

```sh
npm install --prefix .artifacts/stock-runtime @deepseek-ai/dsh@0.2.1-alpha.2 --no-audit --no-fund
npm install --ignore-scripts
npm run build
npm test
npm run typecheck
npm run test:stock
npm pack
```

Host 测试和类型检查使用原版 npm 发布包。浏览器测试通过 npm 包的 closure factory 读取原版 Conversation 类；按钮测试使用插件自己的 footer。覆盖同 ID 删除、真实 AgentLoop 的下一次请求、JSONL flush 和冷读取、连续删除、完整工具往返、工具声明、轮内压缩、目标冲突、非法记录、插件卸载后的读取、包含删除记录的持久化分叉、实时更新、刷新、分页、注册表重建、按钮顺序与双击防护。

另已在隔离 Web profile 中用官方 `plugin add` 安装单个 tgz，实际点击第二轮的垃圾桶，再停止并重启原版 dsh，确认第二轮没有恢复。没有改动用户实际 profile 或聊天。

## 许可证

本项目的原创代码及对复用源码的修改采用 [MIT 许可证](LICENSE)。改编自 DeepSeek Harness 的部分源码保留上游版权声明和 MIT 许可证，详见 [THIRD-PARTY.md](THIRD-PARTY.md)。
