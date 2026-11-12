# 概览清晰壁纸层：单层壁纸 + 卡片区域遮罩

## Context

目标是在 GNOME Shell 50.6 上做一个新扩展，与 Blur My Shell（BMS）共存：

- BMS 已经在 `overviewGroup` 底层提供全屏、每显示器一份的模糊/变暗壁纸。
- Shell 原生每个工作区卡片仍会绘制自己的“缩放壁纸缩略图”。
- 希望卡片圆角矩形内显示屏幕位置对齐的 1:1 清晰壁纸，卡片外继续显示 BMS 处理过的壁纸。
- 不采用“每个卡片一个壁纸 actor”，而是每个显示器只增加一层清晰壁纸，用遮罩选择卡片区域。

已确认的决策：

1. 清晰壁纸按**屏幕位置对齐**（方案 A），卡片移动时不缩放壁纸。
2. 应用网格状态下**保留**顶部窄条里的清晰壁纸。
3. BMS 未启用或关闭概览模糊时，卡片外回退为深色底 `#222226`，清晰卡片仍然生效。
4. 只在**嵌套 GNOME Shell 会话**中测试，不修改当前会话。

## 目标架构

```text
Main.layoutManager.overviewGroup
├─ [0] BMS overview background group（已存在，保持不动）
├─ [1] 本扩展 sharpGroup
│     ├─ monitor 0 清晰层：St.Widget + BackgroundManager + CardMaskEffect
│     ├─ monitor 1 清晰层：...
│     └─ ...
├─ [2] coverPane（Shell 动画输入阻挡层）
├─ [3] OverviewActor（主显示器）
│     └─ ControlsManager → WorkspacesDisplay → Workspace 卡片
│         卡片壁纸通过 _bin.opacity = 0 隐藏，保留控件、边框、阴影
└─ [4] SecondaryMonitorDisplay（副屏卡片，壁纸同样隐藏）
```

- 每个显示器一层清晰壁纸，尺寸/位置与 `Main.layoutManager.monitors[i]` 完全一致。
- 清晰层使用 `Shell.GLSLEffect` 子类，片元着色器计算所有卡片圆角矩形的并集覆盖率；覆盖率之外 alpha=0，BMS 层透出。
- 卡片自己的 `_bin.opacity` 设为 0，不销毁 `WorkspaceBackground` / `_bgManager` / `_backgroundGroup`，避免破坏 BMS 对 `_updateBorderRadius` 的原型补丁和卡片阴影。

## 文件与目录

在项目工作区内创建：

```text
extension/overview-clear@local/
├── metadata.json                 # uuid, name, shell-version ["50"]
├── extension.js                  # Entry，enable/disable，Manager 生命周期
├── lib/
│   ├── manager.js                # 总控：overview 信号、BMS 同步、重建
│   ├── cardRegistry.js           # 卡片发现、隐藏壁纸、几何/透明度/半径
│   ├── monitorLayer.js           # 每显示器 St.Widget + BackgroundManager + Effect
│   ├── maskEffect.js             # Shell.GLSLEffect 子类、GLSL、uniform 上传
│   ├── bms.js                    # BMS 检测、schema、圆角设置、z-order
│   └── constants.js              # MAX_CARDS、默认半径、debug 开关
├── test/
│   └── run-nested.sh             # 隔离 XDG + dbus-run-session + 嵌套 Shell
└── README.md                     # 安装/测试/调试说明
```

不创建首版设置界面和 GSettings schema；行为用常量控制。安装脚本只写入工作区内的测试目录，用户手动执行。

## 实现步骤

### 1. 扩展骨架与嵌套测试环境

- `metadata.json`：`uuid: "overview-clear@local"`，`shell-version: ["50"]`，`session-modes: ["user"]`。
- `extension.js` 继承 `Extension`，`enable()` 创建 `Manager`，`disable()` 逆序清理。
- `test/run-nested.sh`：
  - 在工作区 `.test-home/` 下创建 `XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`、`XDG_RUNTIME_DIR`；
  - 复制本扩展和 BMS 到 `$XDG_DATA_HOME/gnome-shell/extensions/`；
  - 运行 `glib-compile-schemas --strict`；
  - 在 `dbus-run-session` 内设置 `GSETTINGS_BACKEND=keyfile` 和 `org.gnome.shell enabled-extensions`，再启动 `gnome-shell --wayland`（GNOME Shell 50 无 `--nested` 选项；不加 `--display-server` 即嵌套模式）；
  - 日志输出到工作区 `.test-home/nested.log`。
- 每次修改 JS 后重启嵌套 Shell（ESM 模块在会话内只导入一次）。

### 2. BMS 检测与层级

`lib/bms.js`：

- 用 `Main.extensionManager.lookup('blur-my-shell@aunetx')` 判断 ACTIVE。
- 通过 `ext.dir.get_child('schemas')` + `Gio.SettingsSchemaSource.new_from_directory()` 读取 BMS 的 `org.gnome.shell.extensions.blur-my-shell.overview`：
  - `blur` 是否存在且为 true；
  - `workspace-corner-radius`（默认 30）。
- 按名字 `bms-overview-backgroundgroup` 在 `overviewGroup` 中查找 BMS 背景组。
- 将 sharpGroup 插到 BMS 组之上、`OverviewActor` 之下：
  - 优先 `overviewGroup.set_child_above_sibling(sharpGroup, bmsGroup)`；
  - BMS 不存在时插入 index 1；
  - 每次 `Main.overview` 的 `showing`、BMS 扩展状态变化、BMS 设置变化时重新确认顺序。
- 不导入 BMS 内部模块，不依赖 `_bms_pipeline` 等私有字段；只依赖组名和 schema。
- 监听 `Main.extensionManager` 的 `extension-state-changed` 和 BMS schema 的 `changed::blur` / `changed::workspace-corner-radius`，重新同步层级和半径。

### 3. 每显示器清晰壁纸层

`lib/monitorLayer.js`，复用 `src-shell/js/ui/background.js:684-838` 的 `BackgroundManager`：

- 每个 `Main.layoutManager.monitors[i]`：
  - `St.Widget({ x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height, reactive: false })`；
  - `new BackgroundManager({ container: layer, monitorIndex: i, controlPosition: false })`；
  - 默认 `useContentSize: true`，背景 actor 自然尺寸等于显示器，位于 `(0,0)`，与 BMS/桌面同源、1:1；
  - 将 `CardMaskEffect` 添加到 `layer` 上；
  - `layer` 加入 `sharpGroup`。
- `sharpGroup` 本身为 `St.Widget({ reactive: false })`，覆盖全 stage。
- `monitors-changed` 时销毁并重建所有 layer、BackgroundManager 和 effect；不要复用旧 monitor 索引的 actor。
- 销毁顺序参考 BMS：先移除 effect，再 `bgManager.destroy()`，最后 `layer.destroy()`。

### 4. 遮罩着色器

`lib/maskEffect.js`，继承 `Shell.GLSLEffect`（参考 `src-shell/src/shell-glsl-effect.h`、`src-shell/js/ui/lightbox.js:32-85` 的 `RadialShaderEffect`）：

- `vfunc_build_pipeline()` 中 `add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, declarations, code, true)`。
- uniform 设计：
  - `uniform vec4 u_rects[MAX_CARDS];`（x, y, w, h，清晰层局部逻辑像素）；
  - `uniform float u_radii[MAX_CARDS];`
  - `uniform float u_alphas[MAX_CARDS];`
  - `uniform float u_count;`（用 float 而不是 int，Shell.GLSLEffect 只提供 float/matrix 上传）；
  - `uniform float u_size_x; uniform float u_size_y;`（避免 vec2 uniform 的 GI 兼容问题）；
  - `uniform float u_debug;`
- 片元逻辑：
  - `vec2 p = cogl_tex_coord_in[0].xy * vec2(u_size_x, u_size_y);`
  - 固定上界循环 MAX_CARDS，`if (float(i) >= u_count) break;`；
  - 圆角矩形 SDF + `smoothstep` 抗锯齿，`coverage = max(coverage, cov * u_alphas[i]);`
  - `cogl_color_out = cogl_color_in * coverage;`
  - `u_debug > 0.5` 时输出灰度遮罩，便于验证。
- uniform 上传：
  - `this.set_uniform_float(loc, 4, flatRects)`；
  - `this.set_uniform_float(loc, 1, radii)`；
  - `this.set_uniform_float(loc, 1, alphas)`；
  - 如果 `get_uniform_location('u_rects') < 0` 或数组上传失败，降级为每个矩形拆成独立标量 uniform（最多 8 个），并记录 warning。
- MAX_CARDS 首版取 32；超过上限时只取屏幕内/可见的前 32 张卡片并打日志。
- 在 `vfunc_paint_target()` 中先读取当前卡片几何并上传 uniform，再调用基类绘制，保证使用当前帧几何。

### 5. 卡片发现、隐藏壁纸与几何

`lib/cardRegistry.js`：

- 主要钩子：包装 `WorkspaceBackground.prototype._init`（从 `resource:///org/gnome/shell/ui/workspace.js` 导入）：
  - 调用原实现；
  - `this._bin.opacity = 0`（隐藏卡片自带壁纸，保留 `_background` 的阴影和 BMS 圆角补丁）；
  - 记录原始 opacity，注册到 Manager；
  - 连接 `destroy` 注销。
- 安全网：包装 `WorkspacesDisplay.prototype._updateWorkspacesViews` 和 `WorkspacesView.prototype._updateWorkspaces`，调用原实现后扫描 `Main.layoutManager.overviewGroup` 子树，找到所有 `WorkspaceBackground` 实例并补注册/补隐藏。覆盖动态工作区、手势进入、启动动画等路径。
- 不修改 `_bin` 子节点顺序，不销毁 `_backgroundGroup` / `_bgManager`，不补丁 `_updateBorderRadius`（BMS 已占用）。
- 几何读取（在 effect 的 `vfunc_paint_target` 或绘制前更新）：
  - `box = background.get_allocation_box()`；这是 C 侧已内缩、按 state 插值后的卡片可见背景矩形。
  - 用 `background.apply_relative_transform_to_point(null, {x:0,y:0,z:0})` 和 `{x:box.get_width(), y:box.get_height(), z:0}` 得到 stage 坐标；减去 monitor 原点得到清晰层局部坐标。
  - `scale = transformedWidth / box.get_width()`（取 x/y 平均或较小值），用于把逻辑半径换算到 stage 坐标。
  - `alpha = background.get_paint_opacity() / 255`；若 `!background.is_mapped()` 或 `!background.visible`，alpha=0。`get_paint_opacity` 已包含祖先 opacity，因此搜索淡出和启动动画无需单独处理。
  - `radius = cornerRadius * workspaceStateAdjustment.value * scale`，`cornerRadius` 来自 BMS `workspace-corner-radius`，默认 30；主屏 APP_GRID 的 state 为 0（方角），副屏 Extra 仍为 1。
  - 按 `background._monitorIndex` 分组，只把对应显示器的矩形传给该层。
- 重绘触发：
  - `Main.overview` 的 `showing` / `shown` / `hiding`；
  - `overviewControls._stateAdjustment.notify::value`；
  - 每个 background 的 `notify::allocation`；
  - `WorkspacesDisplay.notify::opacity`、`WorkspacesView.notify::visible`；
  - `Workspace.notify::scale-x/scale-y`、`notify::n-workspaces`；
  - `monitors-changed`、BMS 设置变化。
  - 触发时调用 `layer.queue_repaint()`；几何在绘制时读取，避免 `stateAdjustment` notify 早于 allocation 导致的一帧滞后。

### 6. Manager 生命周期

`lib/manager.js`：

- `enable()`：
  - 安装 hook；
  - 等待 `Main.layoutManager.primaryMonitor` / `startup-complete` 后创建 sharpGroup 和每显示器 layer；
  - 连接 overview、monitors、BMS、workspace manager 信号；
  - 对当前已有的 `WorkspaceBackground` 做一次扫描。
- `disable()`：
  - 恢复被包装的原型方法（仅当仍是自己的包装）；
  - 对仍在世的 background 恢复 `_bin.opacity` 原值；
  - 移除 effect、销毁 BackgroundManager、销毁 layer 和 sharpGroup；
  - 断开所有信号，清空卡片表。
- `enable()` 幂等；`disable()` 可重复调用；监听 `Main.uiGroup` 的 `destroy` 触发清理。

### 7. 应用网格、搜索、多显示器

- 应用网格：保留清晰窄条（用户选择），不额外淡出；主屏卡片 state=0，遮罩自然变成矩形窄条；副屏 Extra 卡片 state=1，保持圆角。
- 搜索：`background.get_paint_opacity()` 跟随 WorkspacesDisplay 淡出；主屏清晰遮罩自动消失，副屏不受影响。
- `workspaces-only-on-primary=true`：副屏 `ExtraWorkspaceView` 只有一个 `Workspace(null, monitorIndex)`，同样注册/隐藏壁纸；通过 `_monitorIndex` 分组。
- 非 only-on-primary：副屏普通 `WorkspacesView` 的每张卡片同样处理。
- 多显示器逐个创建 layer；不共享 actor/effect 实例。

## 验证

### 嵌套会话

运行 `extension/overview-clear@local/test/run-nested.sh`，在嵌套 Shell 中：

1. 只启用本扩展（BMS 关闭）：卡片内清晰壁纸、卡片外 `#222226`；确认回退。
2. 启用 BMS（默认 `overview.blur=true`）：卡片内清晰、卡片外模糊变暗；确认层级和 1:1 对齐。
3. 1 个工作区、3 个以上工作区各测一次。
4. 窗口选择器、打开/关闭动画、搜索、应用网格、动态增删工作区。
5. 有副屏时测试 workspaces-only-on-primary 的 true/false 两种。
6. 修改 BMS `workspace-corner-radius`，确认遮罩圆角同步。
7. 修改壁纸/切换深色模式，确认清晰层与 BMS 背景同步更新。
8. 反复 disable/enable 扩展，确认无 JS 错误、无 actor/信号泄漏、`overviewGroup` 子 actor 数量不增长。

### 调试命令

- `CLUTTER_DEBUG=shader`：检查 GLSL 编译。
- `CLUTTER_PAINT=redraws,paint-volumes`：检查 effect 边界和重绘。
- `CLUTTER_PAINT=damage-region`：检查遮罩变化时的重绘区域。
- 在 Looking Glass 中检查：
  - `Main.layoutManager.overviewGroup.get_children().map(c => [c.name, c.visible])`
  - 每张卡片的 `_background.get_allocation_box()`、`_bin.opacity`、`get_paint_opacity()`
  - effect 的 `u_count`、矩形数组（通过临时 debug 日志）。
- 设置 `u_debug=1`（常量或临时设置）先只看遮罩灰度，再恢复混合输出。

### 验收标准

- 卡片内壁纸与 BMS 背景在卡片边界处内容对齐，无缩放/偏移跳变。
- 卡片外是 BMS 处理背景；BMS 关闭时是 `#222226`。
- 卡片圆角、阴影、边框保留，窗口预览和 UI 位于清晰壁纸之上。
- 打开/关闭、搜索、应用网格、工作区切换动画期间遮罩无明显滞后或闪烁。
- BMS 启用/禁用、设置变更后不需要重启 Shell 即可恢复正确层级。
- 扩展禁用后完全恢复原生卡片壁纸和原始层级。

## 风险与处理

- **私有 API**：`WorkspaceBackground._bin`、`_updateWorkspacesViews`、`_stateAdjustment` 等非稳定接口；首版锁定 GNOME Shell 50.x，README 说明版本限制。
- **BMS 升级**：只依赖组名 `bms-overview-backgroundgroup` 和 BMS schema；组名/设置读取失败时回退深色底并记录日志。
- **uniform 数组兼容性**：优先 `Shell.GLSLEffect.set_uniform_float` 的数组路径；失败时降级为独立标量 uniform（最多 8 卡）并提示。
- **全屏离屏 FBO 开销**：每显示器一个 `Shell.GLSLEffect`，测试 4K/HiDPI 下的内存和帧率；必要时只在窗口选择器启用，或限制到主显示器。
- **主屏卡片遮挡**：通过隐藏 `_bin.opacity` 解决；若未来 Shell 改变卡片结构，安全网扫描可能失效，需要重新适配。
- **启动动画时序**：原型包装 + 安全网扫描覆盖 `'showing'` 早于对象创建的情况。
- **ESM 缓存**：修改 JS 后必须重启嵌套 Shell；README 写明。
- **工作区切换动画**：本方案不插入 BMS 的 animation background group；切换动画期间保持 BMS 处理背景，不保证清晰层出现（首版范围外）。

## 范围外

- 首版不做设置界面/GSettings。
- 不实现自己的模糊/半透明背景层（BMS 关闭时接受深色底回退）。
- 不改造工作区切换动画的清晰层。
- 不安装到当前用户会话，只提供嵌套测试脚本和手动安装说明。