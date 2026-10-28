# 重试失败请求

`dsh-session-tree` 的重试功能，在输入框上方提供“重试失败请求”按钮。适用于 DSH 桌面端，也兼容使用相同 Client 和 Fetch carrier 的 Web 部署。

## 安装到桌面端

随整个插件一起安装，不单独安装 retry 功能。安装目录和包名见[仓库说明](../README.md#安装到桌面端)。

当前仅写入了源码，尚未安装或确认桌面端运行效果。实现依据本机 `deepseek-harness` checkout 的接口；未通过运行中的 Cordis inspection 核对桌面端版本。

## 使用

1. 插件启用后继续正常聊天。
2. provider 的自动重试耗尽后，输入框上方出现失败原因和“重试失败请求”按钮。
3. 点击后，在原来的 turn/step 内重新请求模型。日志保留失败的 attempt，已完成的工具结果和消息不被删除，也不会新增“继续”消息。
4. 若再次失败，会再次显示按钮。原界面的“停止”可取消等待或正在执行的重试。

按钮操作后，模型恢复运行，仍可能像正常执行一样发起新的工具调用。插件不会重新执行先前已完成的步骤，但不承诺外部副作用回滚或模型之后绝不再调用相同工具。

## 本版范围

- 插件必须在请求失败前已经启用。它通过 `agent/request-error` 在轮次关闭前等待手动操作，因此等待期间原界面仍可能显示“运行中”。
- 不恢复已写入 `turn/end` 的旧失败轮次，不实现 reroll，不伪造用户消息唤醒已结束的 Agent。
- 只接管 provider 正常重试策略允许的错误。`always` 模式保持自动重试；无策略的失败、普通工具错误和非 eligible 错误继续原有处理。
- 等待状态属于当前 Host 进程。刷新视图可以重新连接；退出/重启 Host、取消 Agent 或卸载插件会结束等待。重启后不能恢复旧按钮。
- 同一请求的重复点击、过期按钮和跨 Session 的 requestId 会被拒绝。不同 Session 的等待互不影响。

## 实现入口

- `src/retry/index.js`：`agent/request-error` 恢复监听、认证的 Fetch 路由和工具注册，由根目录 Host 入口加载。
- `src/retry/recovery.js`：手动恢复状态、取消清理、请求身份校验及状态推送。
- `src/retry/client.js`：Client slot、中文/英文按钮和状态连接。使用宿主主题 token，不加载第二份 React。
- `/api/deshark.session-retry`：GET 返回单 Session 的状态流，POST 执行 `status` 或 `retry`。路由由 DSH 的共享连接层认证，不自行打开端口。
- `session_retry_failed_request`：同一 Host 操作的 deferred agent tool；先以 `action: "status"` 获取 `requestId`，再以 `action: "retry"` 提交。它不能让正在等待的 Agent 自己执行工具，需要另一个具备该工具的调用方。

状态通过事件推送，Client 不轮询 session，也不扫描原始事件。Host 在等待期间保留原有 loop；实际请求和持久化仍由 dsh 自身负责。插件不增加 Session 事件类型，不修改历史文件。工具定义采用 deferred loading；本次未测量桌面端首轮 prompt token 差异。

## 手动验收

- 在一个测试会话触发 provider 的可重试错误，确认自动重试完成后显示按钮与错误原因。
- 恢复服务后点击按钮，确认模型继续执行、没有新增用户消息，先前已完成的工具结果保持不变。
- 保持故障再点击，确认下次失败仍可重试；双击不会并发执行两次。
- 等待时点击“停止”，确认按钮消失，Agent 可以接收下一条正常消息。
- 等待时切换 Session、刷新 Client，确认重连后按钮仍属于正确的 Session。
- 在两个 Session 同时制造错误，确认点击只恢复所选 Session。
- 检查中文/英文、浅色/深色外观，以及插件管理中的图标与说明。
- 等待时禁用插件，确认不会卡住 Agent 或残留状态连接。

运行测试及实际安装由使用者完成。
