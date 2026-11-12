# Overview Clear Wallpaper

一个 GNOME Shell 50 扩展：在概览的工作区卡片里显示**屏幕位置对齐、1:1 的清晰壁纸**，卡片外继续显示 Blur My Shell 处理过的壁纸；没有 Blur My Shell 时，卡片外回退为深色底 `#222226`。

实现方式已经改为**复用每个工作区卡片自带的壁纸 actor**，不再额外创建全屏清晰壁纸层，也不再使用片元着色器遮罩。因此窗口选择器里的绘制开销与系统原生概览基本相同。

## 效果

```text
overviewGroup
├─ [0] Blur My Shell 的 overview 背景组（模糊/变暗壁纸）
├─ [1] coverPane
└─ [2] OverviewActor
      └─ 工作区卡片（WorkspaceBackground）
         ├─ _bin（clip_to_allocation）
         │  └─ _backgroundGroup
         │     └─ Meta.BackgroundActor（本扩展放大并平移它）
         └─ 窗口克隆
```

- 当前工作区卡片：卡片的原生壁纸 actor 被放大到显示器尺寸并平移到屏幕原点，卡片自身的裁剪只露出与屏幕坐标对应的部分，所以壁纸是 1:1 的。
- 相邻工作区卡片：只露出一角时，这一角同样显示屏幕坐标 1:1 的壁纸裁切。如果壁纸在屏幕边缘本来就很暗，这一角看起来也会很暗；这是壁纸内容，不是卡片缺失。
- 卡片外：Blur My Shell 的模糊/变暗壁纸；Blur My Shell 不可用时是 `#222226`。
- 卡片阴影：使用系统原生阴影，不再需要阴影压制样式或重建的外层阴影。
- 应用网格：默认恢复系统原生行为，顶部窄条里每个工作区卡片显示自己的缩放壁纸。设置项可以改为继续显示清晰壁纸裁切。
- 搜索：卡片透明度由系统控制，壁纸随卡片一起淡出。
- 多显示器：按每张卡片所属的显示器计算屏幕坐标，不需要每个显示器额外创建图层。

## 目录

```text
extension/overview-clear@local/
├── metadata.json
├── extension.js
├── prefs.js                # 设置界面（Adw）
├── stylesheet.css          # 仅保留说明注释，不再包含样式规则
├── install.sh              # 安装到当前用户的扩展目录 / 卸载
├── schemas/
│   └── org.gnome.shell.extensions.overview-clear.gschema.xml
├── lib/
│   ├── constants.js        # 默认圆角、调试开关、Blur My Shell 标识
│   ├── bms.js              # Blur My Shell 检测、设置读取
│   ├── cardRegistry.js     # 卡片发现、原生壁纸 actor 的裁剪与恢复
│   └── manager.js          # 生命周期、信号、视图模式切换
├── test/
│   ├── run-nested.sh       # 交互式嵌套 Shell（需要 mutter-devkit）
│   ├── eval-nested.sh      # 无头虚拟显示器 + 自动截图
│   ├── perf-nested.sh      # 无头会话中的粗略 CPU 对比
│   ├── capture-screenshot.js
│   ├── diagnostics.js      # 卡片、actor、裁剪状态
│   ├── geometry.js         # 卡片 allocation / stage 变换诊断
│   ├── disable-extension.js
│   └── enable-extension.js
└── README.md
```

## 工作原理

### 窗口选择器

系统为每张工作区卡片创建一个 `WorkspaceBackground`，其中包含：

- `_bin`：设置了 `clip_to_allocation`，把绘制限制在卡片矩形内；
- `_backgroundGroup`：由 Shell 的 BinLayout 管理；
- `Meta.BackgroundActor`：由 `BackgroundManager` 创建，原本显示缩放后的卡片壁纸。

窗口选择器状态下，扩展对每张卡片做三件事：

1. 把 `Meta.BackgroundActor` 的 `allocation` 直接设置为显示器大小，位置设置为“显示器原点相对 `_backgroundGroup` 的坐标”。这不是修改 actor 的请求尺寸，因此不会改变卡片的 preferred size，也不会改变工作区布局。
2. 把 actor 的缩放设置为 `1 / 卡片当前缩放`，抵消工作区布局对卡片的缩放，让壁纸最终以 1:1 出现在屏幕上。
3. 通过 `Meta.BackgroundContent.set_rounded_clip_bounds()` 和 `rounded_clip_radius` 把可见区域限制为卡片的圆角矩形。

`_bin` 的矩形裁剪负责卡片边界，圆角裁剪负责四个角。卡片自己的 `box-shadow` 仍然由系统绘制，壁纸会盖住阴影内半圈，所以视觉结果与原生卡片一致。

BinLayout 每次重新分配 actor 时都会把它改回卡片大小。扩展监听 actor 的 `notify::allocation`，发现分配被改回后立即恢复为裁剪用的 allocation。这个恢复只改变 allocation，不触发工作区重新布局。

### 应用网格

进入应用网格并稳定后，`app-grid-native-wallpaper` 默认为开启，扩展会把 actor 恢复为：

- 缩放 `1`；
- 由卡片自己的 BinLayout 重新分配为卡片大小；
- 由 Shell 和 Blur My Shell 自己的 `_updateRoundedClipBounds()` / `_updateBorderRadius()` 恢复原生圆角裁剪。

因此应用网格中的工作区卡片与禁用扩展时逐像素一致。

关闭该设置时，应用网格顶部窄条继续使用 1:1 裁剪，行为和旧版本一致。

### 视图切换

窗口选择器到应用网格的过渡期间保持 1:1 裁剪，让壁纸跟随卡片缩放和移动；应用网格完全稳定后才切换为原生缩放壁纸。离开应用网格时，第一帧就恢复裁剪。

因此进入应用网格的最后一刻，窄条里的壁纸会从 1:1 裁切变成卡片缩放壁纸。此时卡片已经很小，变化范围有限；旧版本使用的是约 250 毫秒的交叉淡化，新版本不再保留这项额外绘制。

## 性能

旧版本的主要开销来自：

- 每个显示器一个全屏 `Shell.GLSLEffect`，每帧都要渲染离屏纹理并执行遮罩着色器；
- 每张卡片一个用于重建外层阴影的 `St.Widget`，需要绘制主题的 `box-shadow`；
- 卡片原生壁纸被隐藏，再由清晰层重新绘制一遍。

新版本不再创建这些对象。窗口选择器绘制的是卡片本来就有的壁纸 actor，只是换了一个 allocation 和裁剪矩形，因此没有额外的全屏绘制、离屏纹理或阴影 actor。

无头嵌套会话中的粗略测量（`test/perf-nested.sh`，软件渲染，8 次“打开概览 → 应用网格 → 关闭概览”循环，单位是 10 毫秒的 CPU tick）：

```text
旧版本：扩展启用 141 tick，扩展禁用 114 tick（单次测量）
新版本：四次测量分别为
        启用 115 / 禁用 116
        启用 129 / 禁用 120
        启用 119 / 禁用 118
        启用 116 / 禁用 118
```

新版本的差值为负 1 到正 9 tick，落在测量波动范围内；旧版本多出的约 27 tick 则是稳定可见的额外耗时。静态概览（不操作、不重绘）两种版本都是 0 tick。无头环境使用软件 GL，绝对数值不代表真实 GPU；但可以看出新版本相对禁用扩展已经没有可测量的额外开销。

## 依赖

- GNOME Shell 50.x（本机 50.6，Wayland）。
- 可选：Blur My Shell（UUID `blur-my-shell@aunetx`）。没有它也能工作，只是卡片外是深色底。
- 交互式嵌套测试需要 `mutter-devkit`：

```bash
sudo dnf install mutter-devkit
```

`eval-nested.sh` 使用无头虚拟显示器，不需要 `mutter-devkit`；`perf-nested.sh` 也不需要。

## 安装到当前会话

在项目内以普通桌面用户运行安装脚本，不要使用 sudo：

```bash
cd extension/overview-clear@local
./install.sh
```

脚本会：

- 把 `metadata.json`、`extension.js`、`prefs.js`、`stylesheet.css`、`lib/*.js`、`schemas/*.gschema.xml`、`README.md` 复制到 `${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/overview-clear@local`；
- 在目标目录里运行 `glib-compile-schemas --strict schemas`，生成 `gschemas.compiled`，供扩展和设置页读取；
- 如果已有安装，先移动到同目录下带时间戳的 `.bak` 目录；
- 调用 `gnome-extensions enable overview-clear@local` 并打印扩展状态；
- 不修改 Blur My Shell 或其他扩展。

`schemas/` 目录必须复制，并在目标目录里执行一次：

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/overview-clear@local/schemas
```

否则设置页不可用，`app-grid-native-wallpaper` 会按开启处理，扩展其余功能不受影响。

Wayland 会话不能只重启 GNOME Shell。如果安装后状态不是 `ENABLED`，注销并重新登录，然后执行：

```bash
gnome-extensions enable overview-clear@local
```

卸载：

```bash
./install.sh --uninstall
```

或者手动：

```bash
gnome-extensions disable overview-clear@local
rm -rf ~/.local/share/gnome-shell/extensions/overview-clear@local
```

## 设置

扩展提供一个设置页：

```bash
gnome-extensions prefs overview-clear@local
```

也可以打开“扩展”应用，选择本扩展后点击齿轮按钮。

当前设置项：

- **应用网格使用系统默认壁纸**（键名 `app-grid-native-wallpaper`，默认开启）：
  - 开启时，应用网格顶部的窄条恢复系统原生行为，每个工作区卡片显示自己的缩放壁纸，卡片自身的圆角和阴影也按原生方式呈现。
  - 关闭时，应用网格顶部窄条继续使用本扩展的 1:1 壁纸裁剪。

作用范围与行为：

- 只影响应用网格稳定后的状态。窗口选择器、搜索界面和过渡动画仍然使用 1:1 裁剪。
- 该设置不改变按 Super 键进入哪个视图；Super 键仍然进入原来的窗口选择器。应用网格需要通过 Super+A、Dash 中的“显示应用程序”按钮或触控板上滑进入。
- 修改后通过 GSettings 的信号立即生效，不需要重启 GNOME Shell。扩展禁用或 schema 不可用时按开启处理，即应用网格保持系统原生壁纸。

## 测试

### 无头自动验证（推荐先跑）

```bash
cd extension/overview-clear@local
./test/eval-nested.sh
```

它会：

1. 在工作区 `.test-home/` 下创建隔离的 `XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`；
2. 复制本扩展和 Blur My Shell 到隔离扩展目录；
3. 在 `dbus-run-session` 中启动 `gnome-shell --wayland --headless --virtual-monitor 1920x1080 --unsafe-mode`；
4. 用 ffmpeg 生成一张 1920x1080 的高对比测试图案（色条、网格和大号数字），便于检查屏幕坐标 1:1 对齐；
5. 关闭概览，截取真正的桌面壁纸；再打开概览，在打开动画中间截取一帧，稳定后再截取一帧；
6. 在窗口选择器中确认每张卡片的 `Meta.BackgroundActor` 被放大到 1920x1080、缩放约为 1.06、裁剪圆角约为 28；
7. 用滚轮切换工作区，在滑动动画中截取两帧，确认卡片移动时壁纸仍然固定在屏幕坐标上，没有跟着卡片滑动或抖动；
8. 进入应用网格，确认 actor 恢复为卡片大小、缩放为 1、`cropping` 为 false；
9. 在应用网格中禁用扩展、重新启用扩展，分别截图；
10. 关闭设置项，确认应用网格窄条重新出现 1:1 裁剪；
11. 回到窗口选择器，禁用再启用扩展，确认裁剪恢复。

输出：

- `.test-home/desktop.png`：概览关闭时的真实桌面壁纸截图，用作 1:1 对齐参考。
- `.test-home/overview-mid.png`：概览打开动画中间的截图，用于检查裁剪是否跟随卡片缩放。
- `.test-home/overview-scroll-mid.png`、`.test-home/overview-scroll-mid2.png`：滚轮切换工作区动画中的两帧，用于检查壁纸是否固定在屏幕坐标上。
- `.test-home/overview-scroll-end.png`：滚动结束、切换到下一个工作区后的稳定截图。
- `.test-home/overview.png`：窗口选择器稳定后的截图。
- `.test-home/overview-appgrid-native.png`：设置开启时应用网格的原生壁纸截图。
- `.test-home/overview-appgrid-disabled.png`：在应用网格中禁用扩展后的原生参考截图。
- `.test-home/overview-appgrid-reenabled.png`：在应用网格中重新启用后的截图。
- `.test-home/overview-appgrid-sharp.png`：关闭设置后应用网格的 1:1 裁剪截图。
- `.test-home/overview-disabled.png`：窗口选择器中禁用扩展后的原生截图。
- `.test-home/overview-reenabled.png`：窗口选择器中重新启用后的截图。
- `.test-home/eval-nested.log`：Shell 日志。

本次验证结果：

- 窗口选择器稳定帧：卡片内部随机 300 个采样点全部与真实桌面壁纸逐像素一致。
- 打开动画中间帧：同样 300 个采样点全部一致，说明裁剪跟随了卡片的缩放和位移。
- 滚轮切换工作区的两帧动画：两帧中卡片内部的采样点都全部与真实桌面壁纸一致（300/300、150/150、150/150、80/80），壁纸没有跟着卡片滑动。
- 应用网格原生帧与禁用扩展参考帧：逐像素对比只在时钟文字区域有差异，壁纸区域完全一致。
- 应用网格重新启用帧与禁用扩展参考帧：逐像素对比 0 个差异点。
- Shell 日志中没有 `JS ERROR`。

不启用 Blur My Shell 的测试：

```bash
BMS_SRC=/nonexistent ./test/eval-nested.sh
```

此时卡片内应显示清晰壁纸，卡片外是 `#222226`。

### 粗略性能对比

```bash
cd extension/overview-clear@local
./test/perf-nested.sh
```

脚本会在同一个无头会话中测量“扩展启用”和“扩展禁用”两种状态的静态耗时和连续切换概览的耗时。输出里的 `ticks` 是 `/proc/<pid>/stat` 的 CPU tick，每秒 100 tick。

### 交互式嵌套（需要 mutter-devkit）

```bash
cd extension/overview-clear@local
./test/run-nested.sh
```

脚本使用隔离的 `XDG_DATA_HOME` 和 `GSETTINGS_BACKEND=keyfile`，不会修改当前会话的扩展列表。关闭嵌套窗口退出；或在嵌套窗口里按 `Alt+F2` 输入 `debugexit`。

注意：如果 `/usr/libexec/mutter-devkit` 不存在，脚本会直接提示安装，不会退化成接管当前显示服务器。

## 调试

`lib/constants.js`：

```js
export const DEFAULT_CORNER_RADIUS = 30;
export const DEBUG = false;
```

- `DEBUG = true`：输出启用、卡片注册等日志。

环境变量：

```bash
CLUTTER_PAINT=redraws,paint-volumes \
./test/run-nested.sh
```

- `CLUTTER_PAINT=redraws,paint-volumes`：检查卡片壁纸的重绘范围和 effect 边界。
- `CLUTTER_PAINT=damage-region`：检查裁剪变化时的损伤区域。

Looking Glass（嵌套会话中 `Alt+F2` 输入 `lg`）可检查：

```js
Main.overview._overview._controls._stateAdjustment.getStateTransitionParams()
Main.layoutManager.overviewGroup.get_children().map(c => [c.name, c.visible]);
```

也可以对任意卡片执行：

```js
const bg = /* 找到 _bin 和 _bgManager 都存在的 actor */;
const actor = bg._bgManager.backgroundActor;
[actor.get_allocation_box(), actor.scale_x, actor.content.rounded_clip_radius]
```

## 实现要点

- 扩展包装 `WorkspaceBackground.prototype._init`，在每个工作区背景创建后登记卡片；同时包装 `WorkspacesDisplay._updateWorkspacesViews` 和 `WorkspacesView._updateWorkspaces`，在视图重建或动态工作区增删后重新扫描。
- 卡片登记时保存背景 actor 的引用，并监听 `BackgroundManager` 的 `changed` 信号。壁纸更换后 BackgroundManager 会创建新的 actor，扩展重新绑定并重新应用裁剪。
- 裁剪的 allocation 使用 `_backgroundGroup` 自己的 stage 变换计算，而不是直接用卡片的 allocation。`_backgroundGroup` 在卡片内部可能带有额外的偏移，使用它自己的变换才能得到精确的屏幕坐标。
- 调用 `actor.allocate()` 直接设置 allocation，而不是调用 `set_allocation()`。`set_allocation()` 只能在 actor 自己的 allocate 虚函数里使用，从外部调用不会生效。
- 裁剪几何在 `ClutterStage` 的 `before-paint` 信号里刷新。该信号在布局阶段之后、绘制之前发出；`Meta.LaterType.BEFORE_REDRAW` 则在布局之前执行。滚轮切换工作区时，工作区缩放和位置每一帧都在变化，如果在 `BEFORE_REDRAW` 里计算，壁纸会比卡片晚一帧，表现为卡片内画面抖动。模式切换仍放在 `BEFORE_REDRAW` 里，保证在布局前完成。
- actor 的 `notify::allocation` 会重新计算裁剪并强制重新分配，因为 BinLayout 在每次布局时都会先把 actor 改回卡片大小。这里必须用当前几何重新计算，不能只恢复上一帧保存的矩形。
- 不修改 `_backgroundGroup` 的 layout manager。把它改成 FixedLayout 会改变卡片的 preferred size，进而改变工作区布局；当前实现保留 BinLayout，只在 actor 被重新分配后覆盖 allocation。
- 圆角裁剪使用 `Meta.BackgroundContent` 的 `set_rounded_clip_bounds()` 和 `rounded_clip_radius`。`rounded-clip-bounds` 不是 GObject 属性，只有 setter；扩展在每次更新和 `rounded-clip-radius` 变化时重新写入边界。
- 监听 `global.display` 的 `workareas-changed`，在面板高度或工作区区域变化后重新计算裁剪。
- 应用网格状态下不操作 actor；恢复时只把缩放设回 1，并把 allocation 交还给 BinLayout，避免手写 allocation 与系统产生小数像素差异。
- 扩展禁用时对所有卡片恢复原生缩放和 BinLayout allocation，并调用 Shell/Blur My Shell 自己的圆角方法。
- 性能：静态概览没有每帧工作；动画期间每个合成帧只更新少量 actor 的 allocation、缩放和裁剪矩形，不创建离屏纹理，不执行全屏着色器。

## 已知限制

- 依赖 GNOME Shell 私有 API（`_bin`、`_backgroundGroup`、`_bgManager`、`_updateBorderRadius`、`_updateRoundedClipBounds`、`_stateAdjustment` 等），目前只针对 Shell 50.x。
- 壁纸是屏幕空间 1:1 裁剪，卡片内的壁纸与缩放后的窗口不再保持原来的空间对应。
- 进入应用网格的最后一刻会从 1:1 裁剪切换为原生缩放壁纸；离开应用网格时第一帧恢复裁剪。旧版本的交叉淡化已移除。
- 壁纸更换时 BackgroundManager 会短暂交叉淡化新旧 actor。旧 actor 不在扩展的控制范围内，如果正好在概览打开时更换壁纸，可能看到很短的未裁剪缩略图。
- Blur My Shell 关闭时只回退深色底，不自己实现模糊层。
- 工作区切换动画（`WorkspaceAnimationController`）不在本扩展的范围内。
- 多显示器、分数缩放、显示器热插拔已按代码路径处理，但只在单显示器 1x 的无头环境中做了截图验证，建议在实际多屏环境再测。
- 圆角半径来自 Blur My Shell 的 `workspace-corner-radius`，没有 Blur My Shell 时使用 30。
