# Bin Opacity Demo

一个只做一件事的最小 GNOME Shell 50 演示扩展：

```js
WorkspaceBackground._bin.opacity = 0;
```

没有清晰壁纸层，没有遮罩着色器，没有修改 Blur My Shell。它只隐藏工作区卡片自己的缩放壁纸，用来观察上一轮讨论中“单纯 `_bin.opacity = 0`”的最终效果。

现有的 `extension/overview-clear@local` 保持不动，本目录是独立的最小演示。

## 预期效果

`WorkspaceBackground` 的结构大致是：

```text
Workspace
└─ WorkspaceBackground（St.Widget，保留圆角和 box-shadow）
   └─ _bin（Clutter.Actor）
      └─ _backgroundGroup
         └─ Meta.BackgroundActor（卡片自己的缩放壁纸）
```

把 `_bin.opacity` 设为 0 后：

- 卡片自己的缩放壁纸消失；
- 卡片内部变成完全透明；
- `WorkspaceBackground` 控件和它的 `box-shadow` 还在，所以卡片只剩一圈很淡的阴影；
- 窗口克隆、标题、关闭按钮、Dash、搜索、顶栏都不变；
- Blur My Shell 开着时，卡片内部透出 BMS 的模糊/变暗全屏壁纸，和卡片外部连续；
- Blur My Shell 没开时，卡片内部透出概览的深色底 `#222226`；
- 不会出现清晰的 1:1 壁纸。

另外，因为卡片不再在动画第 0 帧复现桌面壁纸，打开/关闭概览时会有一次“清晰桌面壁纸”和“BMS 处理背景”之间的跳变。

## 目录

```text
extension/bin-opacity-demo@local/
├── metadata.json
├── extension.js
├── README.md
└── test/
    ├── run-nested.sh       # 交互式嵌套 Shell
    ├── smoke-headless.sh   # 无头功能检查，不截图
    └── inspect-cards.js    # 在 Shell 内读取卡片 _bin.opacity
```

## 实现

- 包装 `WorkspaceBackground.prototype._init`：每个新的工作区背景创建后设置 `_bin.opacity = 0`。
- 包装 `WorkspacesDisplay.prototype._updateWorkspacesViews`：概览视图重建后重新扫描。
- 监听 `Main.overview` 的 `showing` 和 `shown`，扫描 `overviewGroup` 里已有的 `WorkspaceBackground`。
- 只改 `_bin.opacity`，不销毁 `_bgManager`、`_backgroundGroup` 或控件本身，所以 Blur My Shell 的 `_updateBorderRadius` 原型补丁仍能工作。
- `disable()` 时恢复原来的 `_bin.opacity`，并还原原型包装。
- `globalThis.__binOpacityDemo.hiddenCount()` 可查看当前隐藏的卡片数量。

## 交互式嵌套 Shell

需要 `mutter-devkit`（本机已安装 `/usr/libexec/mutter-devkit`）。

```bash
cd extension/bin-opacity-demo@local
./test/run-nested.sh
```

脚本会在当前图形会话里打开一个嵌套 GNOME Shell 窗口，并且：

- 把扩展和 Blur My Shell 复制到本目录下的 `.test-home-bin-opacity/`；
- 使用隔离的 `XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`；
- 使用 `GSETTINGS_BACKEND=keyfile`，不会修改当前会话的扩展列表和设置；
- 用 `dbus-run-session` 启动私有 D-Bus 会话。

测试步骤：

1. 点击嵌套窗口，按 Super 打开概览；
2. 观察卡片壁纸是否消失、是否只剩阴影、BMS 背景是否透出来；
3. 在嵌套窗口里按 `Alt+F2`，输入 `lg` 打开 Looking Glass，可执行：

```js
globalThis.__binOpacityDemo.hiddenCount()
```

或检查卡片：

```js
(() => {
    const out = [];
    const walk = a => {
        for (const c of a.get_children()) {
            if (c._bin && c._bgManager)
                out.push(c._bin.opacity);
            walk(c);
        }
    };
    walk(Main.layoutManager.overviewGroup);
    return JSON.stringify(out);
})()
```

4. 关闭嵌套窗口，或在 Alt+F2 中输入 `debugexit` 退出。

不启用 Blur My Shell 测试：

```bash
BMS_SRC=/nonexistent ./test/run-nested.sh
```

此时卡片内应透出 `#222226`。

日志：

```text
.test-home-bin-opacity/nested.log
```

应该能看到：

```text
[bin-opacity-demo] enabled
[bin-opacity-demo] hiding wallpaper via _bin.opacity = 0
[bin-opacity-demo] overview showing; hidden cards=1
```

## 无头功能检查

不需要图形窗口，也不截图，只检查 `_bin.opacity` 的实际值：

```bash
cd extension/bin-opacity-demo@local
./test/smoke-headless.sh
```

它会：

1. 在 `.test-home-bin-opacity-smoke/` 创建隔离环境；
2. 启动 `gnome-shell --wayland --headless --virtual-monitor 1920x1080 --unsafe-mode`；
3. 通过 `org.gnome.Shell.Eval` 打开概览；
4. 读取所有卡片的 `_bin.opacity`，输出 JSON；
5. 如果至少有一个卡片为 `0`，输出 `PASS`。

不启用 BMS：

```bash
BMS_SRC=/nonexistent ./test/smoke-headless.sh
```

## 已知限制

- 依赖 GNOME Shell 私有 API（`_bin`、`_updateWorkspacesViews`），只针对 Shell 50.x。
- 这是一个刻意的最小演示，不实现清晰 1:1 壁纸、遮罩、圆角裁剪、多显示器特殊处理或动画无缝衔接。
- Blur My Shell 是否存在只影响“透出来的是什么”，不影响本演示的核心行为。
- 嵌套 Shell 使用当前图形会话的 Wayland socket；它不会接管当前显示服务器。
