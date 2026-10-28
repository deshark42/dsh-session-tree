# dsh-session-tree

DeepSeek Harness 的会话管理插件。本仓库根目录就是可安装的 bundle，各项功能放在 `src/` 下。

当前已编写的功能是[重试失败请求](docs/retry.md)：自动重试停止后，在输入框上方显示手动重试按钮，在原轮次内重新请求模型，保留已完成的步骤和工具结果，不追加“继续”消息。功能尚未安装或完成桌面端运行验证。

## 安装到桌面端

### 从 GitHub 安装

代码上传后，可在其他机器的 DSH 桌面端打开 **插件管理 → 添加插件**，输入：

```text
https://github.com/deshark42/dsh-session-tree.git#master
```

这会安装 `master` 分支当前的版本，无需复制本机目录，也不需要发布到 npm。目标机器需要能通过 Git 访问该仓库；私有仓库还需要目标机器的 GitHub 访问权限。安装后启用 bundle，按结果提示决定是否重启桌面端。

需要固定某个版本时，把 `#master` 换成该次提交的完整 SHA。安装不会持续跟随 GitHub 自动更新；后续更新需在插件管理中重新安装指定版本，按结果提示重启。

### 从本地目录安装

在 DSH 桌面端的插件管理中安装本仓库根目录：

```text
C:\Users\deshark\code\dsh-session-tree
```

包名为 `@deshark/dsh-session-tree`，Loader 行 id 为 `deshark-session-tree`。按安装结果决定是否重启桌面端。不需要构建，也没有依赖安装脚本。

## 目录

```text
package.json       插件包和 Client manifest
cordis.patch.yml   bundle 注册
index.js           Host 入口，组合各功能
src/retry/         失败请求重试：Host、Client、恢复状态
locale/            插件展示信息
icon.svg           插件图标
docs/retry.md      重试功能说明及手动验收步骤
.agents/           Agent 工作流与决策笔记
scripts/           Agent Notes 门禁
```

`./client` 当前直接导出重试功能的 Client 入口，其模块 id 对应整个插件包。后续功能继续在同一 bundle 内扩展。

运行测试由使用者完成。重试功能的适用范围和限制见[功能说明](docs/retry.md)。
