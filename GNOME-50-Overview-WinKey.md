# GNOME 50.6 按下 Win（Super）键后的显示与渲染逻辑

本文基于本机实际运行的软件版本：

| 项目 | 值 |
| --- | --- |
| GNOME Shell | 50.6 |
| Mutter | 50.6 |
| 会话类型 | Wayland |
| overlay-key | `Super` |
| enable-animations | `true` |
| workspaces-only-on-primary | `true` |
| dynamic-workspaces | `true` |
| `toggle-overview` 快捷键 | 空列表（本机仅靠 Super 触发） |

源码位置（均在本工作区内）：

- 当前安装版本中编译进 `libshell-18.so` 的 JavaScript：`gnome-shell-js/`
- gnome-shell 50.6 完整源码：`src-shell/`
- mutter 50.6 完整源码：`src-mutter/`

下文的 `文件:行号` 都指这两份 50.6 源码。

---

## 0. 一句话结论

Win 键在 Mutter 中不是普通快捷键，而是 `overlay-key`：按下时只记录状态、不触发界面；单独松开时 Mutter 发出 `overlay-key` 信号。GNOME Shell 收到信号后调用 `Main.overview.toggle()`，显示一个覆盖全屏的 Shell actor 层，隐藏真实窗口组，把每个窗口用 `Clutter.Clone` 实时克隆到概览卡片里，并用 250 毫秒的数值插值完成“全屏桌面到概览”的连续变形。最后，这些 actor 和普通桌面内容由同一个 Clutter 场景图交给 Mutter 的 Cogl/EGL 渲染器合成上屏。

关键点：整个概览不是 Mutter 的窗口特效，也不是截图，而是 Shell 在同一个 Clutter 舞台中新增、隐藏和变换 actor 的结果。

---

## 1. 输入路径：Super 为什么是 overlay key

### 1.1 配置来源

`org.gnome.mutter overlay-key` 的默认值是 `Super`。Mutter 在初始化键盘绑定管理器时读取该配置，并把它解析成实际的 keysym/keycode：

- `src-mutter/src/core/keybindings.c:831-834`：`meta_prefs_get_overlay_bindings()` 后调用 `resolve_special_key_combo()`。
- `src-mutter/src/core/keybindings.c:2742-2745`：注册内置处理器 `overlay-key`，标志为 `META_KEY_BINDING_BUILTIN | META_KEY_BINDING_NO_AUTO_GRAB`，即由 Mutter 内部处理、不向 X server 抢 grab。

### 1.2 按下与松开的判定

核心函数是 `process_special_modifier_key()`（`src-mutter/src/core/keybindings.c:1522-1580`）：

1. 第一次收到 Super 的 `KEY_PRESS`，且当前没有其他修饰键、keycode 命中 overlay 组合：
   - 设置 `overlay_key_only_pressed = TRUE`；
   - 返回 `CLUTTER_EVENT_PROPAGATE`，让事件继续传播。
2. 如果在按住 Super 期间按了别的键（例如 Super+Tab、Super+方向键）：
   - 清除 `overlay_key_only_pressed`；
   - 后续事件按普通快捷键处理，不会在松开时打开概览。
3. 如果松开时 `overlay_key_only_pressed` 仍为真：
   - 清除标志；
   - 找到对应 binding，再经过 `meta_compositor_filter_keybinding()`（由 Shell 的 action mode 决定是否允许）；
   - 调用 `meta_display_overlay_key_activate()`。

`process_overlay_key()`（`keybindings.c:1583-1605`）还做了一层限制：如果当前焦点窗口正在抑制快捷键（`meta_window_shortcuts_inhibited()`），则裸按 Super 不会触发概览。

### 1.3 事件被谁先看到

事件分发的顺序在 `src-mutter/src/core/events.c:258-264`：Mutter 先调用 `meta_keybindings_process_event()`；如果它返回“已处理”，事件就不会再传给合成器或 Wayland 客户端。因此：

- Super 按下：继续传播，应用会看到 Super 修饰键按下；
- Super 单独松开：被 Mutter 拦截，并发出信号。

### 1.4 信号发出

`src-mutter/src/core/display.c:2247-2250`：

```c
void
meta_display_overlay_key_activate (MetaDisplay *display)
{
  g_signal_emit (display, display_signals[OVERLAY_KEY], 0);
}
```

信号定义在 `display.c:312`。

### 1.5 时序

```text
按下 Super
  └─ 仅记录 overlay_key_only_pressed = TRUE，界面无变化
      ├─ 期间按其他键 → 取消，转入正常快捷键逻辑
      ├─ 期间点击鼠标/触摸/滚轮 → 取消（keybindings.c:1700-1707）
      └─ 单独松开 Super
          └─ 检查焦点窗口是否抑制快捷键
              └─ 检查当前 Shell action mode 是否允许 overlay-key
                  └─ MetaDisplay 发出 "overlay-key"
```

---

## 2. Shell 侧入口：overlay-key 如何变成 toggle

### 2.1 唯一的信号处理点

`src-shell/js/ui/overviewControls.js:419-439`：

```js
this._lastOverlayKeyTime = 0;
global.display.connectObject('overlay-key', () => {
    if (this._a11ySettings.get_boolean('stickykeys-enable'))
        return;

    const {initialState, finalState, transitioning} =
        this._stateAdjustment.getStateTransitionParams();

    const time = GLib.get_monotonic_time() / 1000;
    const timeDiff = time - this._lastOverlayKeyTime;
    this._lastOverlayKeyTime = time;

    const shouldShift = St.Settings.get().enable_animations
        ? transitioning && finalState > initialState
        : Main.overview.visible && timeDiff < Overview.ANIMATION_TIME;

    if (shouldShift)
        this._shiftState(Meta.MotionDirection.UP);
    else
        Main.overview.toggle();
}, this);
```

可以读出三个实际行为：

1. 开启粘滞键（sticky keys）时，Super 不打开概览，避免与辅助功能冲突。
2. 如果概览正在“打开”动画中再次按 Super，则不是关闭，而是把状态向上移一格：窗口选择器 → 应用网格。这就是“快速双击 Super 打开应用网格”的实现。GNOME 的 NEWS 中也记录了该功能（`src-shell/NEWS:1747`）。
3. 其余情况调用 `Main.overview.toggle()`：已显示就关闭，未显示就打开。

关闭动画进行中再次按 Super 不会产生效果，因为 `Overview.toggle()` 看到 `_visible` 为真而调用 `hide()`，但 `_shown` 已被置为假，`hide()` 会提前返回（`js/ui/overview.js:536-561`）。

### 2.2 Action mode 过滤

Shell 允许 overlay-key 在哪些模式下工作：

`src-shell/js/ui/main.js:120-121`：

```js
wm.allowKeybinding('overlay-key',
    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
```

过滤发生在 `src-shell/js/ui/windowManager.js:1617-1633` 的 `_filterKeybinding()` 中。锁屏、系统模态等模式不在允许集合里，因此 Super 不会在锁屏上打开概览。

### 2.3 其他同样会打开概览的入口

| 入口 | 代码 |
| --- | --- |
| Activities 按钮点击 | `js/ui/panel.js:213-265` |
| 左上角热区 | `js/ui/layout.js` 的热区回调，最终调用 `Main.overview.toggle()` |
| `toggle-overview` 快捷键 | `js/ui/overview.js:219-224`（本机该项为空） |
| 触摸板/触屏上滑手势 | `js/ui/overview.js:226-239`、`355-395` |
| 显示应用网格 | `js/ui/overview.js:609-611`（`showApps()`） |

热区和 Activities 按钮还有 0.5 秒的去抖判断，避免同一次操作既触发热区又点击按钮导致开了又关（`overview.js:434-449`）。

---

## 3. 打开过程：状态机与 grab

### 3.1 显示状态机

`js/ui/overview.js:80-106` 定义四个状态：

```text
HIDDEN ──show──> SHOWING ──动画结束──> SHOWN
   ^                 │                  │
   │                 └──hide──> HIDING <┘
   └──────────────── 动画结束 ───────────┘
```

允许的转换是严格校验的。状态改变时同时发出 `showing`、`shown`、`hiding`、`hidden` 信号，面板、搜索、缩略图等模块都监听这些信号。

`_changeShownState()`（`overview.js:242-258`）还负责一件事：

```js
if (this._shownState === OverviewShownState.HIDDEN)
    global.compositor.disable_unredirect();
else if (state === OverviewShownState.HIDDEN)
    global.compositor.enable_unredirect();
```

也就是进入概览期间禁用“直接扫描输出（unredirect）”，强制 Mutter 走合成路径，否则全屏应用可能绕过合成器直接上屏，概览就盖不住它。

### 3.2 show() 做了什么

`Overview.show()`（`overview.js:483-501`）顺序很关键：

1. 标记 `_shown = true`；
2. `_syncGrab()`：在非动画状态下请求 Shell 的模态 grab，action mode 设为 `OVERVIEW`（`overview.js:451-481`）。如果已有别的 grab，则放弃打开；
3. `Main.layoutManager.showOverview()`；
4. `_animateVisible()`。

`Main.layoutManager.showOverview()`（`js/ui/layout.js:357-363`）只做三件事：显示 `overviewGroup`、隐藏 `screenTransition`、把 `_inOverview` 置真并刷新可见性。

刷新可见性的核心在 `js/ui/layout.js:987-994`：

```js
_updateVisibility() {
    const windowsVisible = Main.sessionMode.hasWindows && !this._inOverview;

    global.window_group.visible = windowsVisible;
    global.top_window_group.visible = windowsVisible;
    ...
}
```

所以概览一出现，真实的窗口组（以及位于其中的桌面壁纸层）和顶层弹出窗口组会立刻隐藏，屏幕上只剩概览自己绘制的克隆。

### 3.3 动画开始前

`_animateVisible()`（`overview.js:504-520`）：

1. 置 `_visible`、`_animationInProgress`、`_visibleTarget`；
2. 把全屏的 `_coverPane` 提到最上层并显示，防止动画期间点击穿透或双击 Dash；
3. `prepareToEnterOverview()`：搜索复位，工作区视图准备；
4. 状态切到 `SHOWING`，禁用 unredirect；
5. `animateToOverview(WINDOW_PICKER, callback)`。

`overviewGroup` 本身在 `LayoutManager._init()` 中创建（`js/ui/layout.js:252-261`），是一个绑定到整个 `uiGroup` 的反应式 St.Widget，CSS 背景是纯色：

```css
#overviewGroup {
  background-color: #222226;
}
```

（`src-shell/data/theme/gnome-shell-dark.css:2247-2248`）

它不是透明遮罩，而是一块不透明的深灰底，因此会完全盖住主显示器后面的普通窗口。

---

## 4. 场景图：概览到底由哪些 actor 组成

### 4.1 顶层结构

Mutter 的后端创建唯一的 `MetaStage`（`src-mutter/src/backends/meta-backend.c:1242`），Shell 通过 `meta_backend_get_stage()` 取得它（`src-shell/src/shell-global.c:996`）。Shell 在舞台上搭出如下层次（从下到上）：

```text
MetaStage
└─ uiGroup (LayoutManager, no layout)
   ├─ window_group
   │  ├─ backgroundGroup        ← 桌面壁纸
   │  └─ MetaWindowActor ...    ← 真实窗口
   ├─ overviewGroup             ← 概览（本例主角）
   │  ├─ coverPane              ← 动画期间透明的输入阻挡层
   │  ├─ OverviewActor (仅主显示器)
   │  │  └─ ControlsManager
   │  │     ├─ searchEntryBin
   │  │     ├─ appDisplay
   │  │     ├─ dash
   │  │     ├─ searchController
   │  │     ├─ thumbnailsBox
   │  │     └─ workspacesDisplay (最后添加，位于最上层)
   │  └─ SecondaryMonitorDisplay ...（其他显示器）
   ├─ screenShieldGroup         ← 锁屏时盖住概览
   ├─ panelBox                  ← 顶栏，位于概览之上
   ├─ top_window_group          ← 弹出菜单/工具提示；概览时也被隐藏
   ├─ modalDialogGroup
   ├─ keyboardBox
   └─ screenshotUIGroup ...
```

`overviewGroup` 通过 `addChrome()` 被插到 `top_window_group` 下面，而 `panelBox` 更晚插入，因此在概览之上（`layout.js:245-250`、`855-878`）。这就是为什么概览打开时顶栏仍然可见。

锁屏组在概览之上，所以锁屏会盖住概览；系统模态对话框又在最上层。

### 4.2 主显示器与其他显示器

- 主显示器：`OverviewActor` 带 `MonitorConstraint({primary: true})`（`js/ui/overview.js:37`），其子 `ControlsManager` 设置了 `clip_to_allocation: true`（`js/ui/overviewControls.js:315-321`）。
- 其他显示器：`WorkspacesDisplay._updateWorkspacesViews()` 为每个非主显示器创建 `SecondaryMonitorDisplay`，直接加到 `Main.layoutManager.overviewGroup`，并带 `MonitorConstraint({index, work_area: true})`（`js/ui/workspacesView.js:1022-1055`、`js/ui/workspacesView.js:590-605`）。

本机 `workspaces-only-on-primary=true`，所以其他显示器使用 `ExtraWorkspaceView`：它创建一个 `metaWorkspace = null` 的 `Workspace`，显示该显示器上的壁纸和窗口卡片（`js/ui/workspacesView.js:540-590`）。`Workspace._isMyWindow()` 在 `metaWorkspace` 为 null 时只按显示器过滤（`js/ui/workspace.js:1327-1333`），因此副屏不会显示主屏的工作区内容，而是显示自己屏幕上的窗口。

### 4.3 为什么第一帧看起来和桌面一模一样

`ControlsManager` 的子元素顺序是：

```js
this.add_child(this._searchEntryBin);
this.add_child(this._appDisplay);
this.add_child(this.dash);
this.add_child(this._searchController);
this.add_child(this._thumbnailsBox);
this.add_child(this._workspacesDisplay);   // 最后添加，位于最上层
```

（`js/ui/overviewControls.js:374-379`）

打开动画开始时，状态值是 `HIDDEN`（数值 0）：

- 工作区被分配到整个工作区矩形；
- 工作区背景的圆角半径为 0、边距为 0；
- 窗口克隆位于窗口真实屏幕位置；
- 由于 `workspacesDisplay` 在最上层，它恰好把搜索框、Dash、缩略图全部盖住。

所以第一帧与桌面视觉一致，只是真实窗口换成了等价的克隆。随后工作区卡片缩小，才逐步“露出”搜索框、Dash 和缩略图。这是这套布局最巧妙的地方：遮挡关系本身就是转场。

---

## 5. 布局与逐帧动画

### 5.1 三档状态与布局管理器

`ControlsState`（`js/ui/overviewControls.js:31-36`）：

| 值 | 状态 | 画面含义 |
| --- | --- | --- |
| 0 | `HIDDEN` | 桌面状态（概览不可见或动画端点） |
| 1 | `WINDOW_PICKER` | 窗口选择器 |
| 2 | `APP_GRID` | 应用网格 |

`OverviewAdjustment` 是一个 `St.Adjustment`，范围 0 到 2（`overviewControls.js:261-310`）。`ControlsManagerLayout.vfunc_allocate()`（`overviewControls.js:155-248`）每一帧根据这个数值重新分配所有子元素。

关键常量（`overviewControls.js:21-29`）：

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `SMALL_WORKSPACE_RATIO` | 0.15 | 应用网格时顶部工作区条高度占工作区高度的比例 |
| `DASH_MAX_HEIGHT_RATIO` | 0.16 | Dash 最大高度比例 |
| `VERTICAL_SPACING_RATIO` | 0.02 | 控件之间的垂直间距比例 |
| `SIDE_CONTROLS_ANIMATION_TIME` | 250 ms | 搜索、缩略图、应用网格等过渡时长 |
| `Overview.ANIMATION_TIME` | 250 ms | 打开/关闭概览的主时长（`overview.js:12`） |

### 5.2 窗口选择器状态的几何

以主显示器工作区（已排除顶栏 strut）为基准，高度记为 `H`，宽度记为 `W`：

```text
y = 工作区顶部
┌─────────────────────────────────────────────┐
│  searchEntryBin（搜索框，宽度 24em，居中）    │  height = 搜索框首选高度
│  间距 spacing = round(H * 0.02)              │
│  thumbnailsBox（工作区数超过阈值时显示，横向排列）│
│  间距                                         │
│  workspacesDisplay                            │
│  ┌─────────────────────────────────────────┐ │
│  │  当前工作区卡片：壁纸 + 窗口克隆 + 标题   │ │
│  └─────────────────────────────────────────┘ │
│  Dash（最大 0.16H，底部居中）                  │
└─────────────────────────────────────────────┘
```

对应计算：

- 搜索框：`overviewControls.js:164-168`；
- Dash：`overviewControls.js:172-180`；
- 缩略图：`overviewControls.js:184-196`（动态工作区模式下至少 3 个工作区才显示，静态模式下多于 1 个就显示，见 `js/ui/workspaceThumbnail.js:703-707`）；
- 工作区：`_computeWorkspacesBoxForState()`（`overviewControls.js:80-110`）。

`WINDOW_PICKER` 状态下工作区的起点约为：

```text
workArea.y + searchHeight
          + 0.6 * spacing
          + thumbnailsHeight
          + 0.4 * spacing * expandFraction
```

高度为工作区高度减去 Dash、搜索框、缩略图和间距。

`APP_GRID` 状态下工作区被压到顶部，高度只有工作区的 15%，应用网格占据剩余空间（`overviewControls.js:101-106`、`112-135`）。

### 5.3 打开动画时间线

`animateToOverview()`（`overviewControls.js:721-738`）：

```js
this._stateAdjustment.value = ControlsState.HIDDEN;
this._stateAdjustment.ease(state, {
    duration: 250,
    mode: Clutter.AnimationMode.EASE_OUT_SINE,
    ...
});
```

逐帧发生的事：

| 时间 | 状态值 | 画面 |
| --- | --- | --- |
| 0 ms | 0 | 工作区铺满工作区；圆角 0；窗口在真实位置；搜索/Dash/缩略图被盖住；真实窗口组已隐藏，克隆接替 |
| 0-250 ms | 0→1，缓出正弦 | 工作区卡片四周缩进、圆角增大；当前工作区窗口从真实位置插值到缩略图网格，其他工作区窗口淡入并展开；面板由黑变透明 |
| 250 ms | 1 | 窗口选择器稳定；`_coverPane` 隐藏；保持模态 grab |

同时发生的变化：

- 工作区背景的分配在“铺满”和“内缩 12 逻辑像素”之间插值（`src-shell/src/shell-workspace-background.c:71-88`）；
- 圆角半径在 0 和 `30 * scaleFactor` 之间插值（`js/ui/workspace.js:1004-1008`）；
- 其他工作区的窗口透明度从 0 渐变为 255（`js/ui/workspace.js:447-455`）；
- 顶栏加上 `:overview` 伪类，CSS 背景透明，过渡时长 250 ms（`js/ui/panel.js:461-466`、`data/theme/gnome-shell-sass/widgets/_panel.scss:98-104`）。

### 5.4 关闭动画

`animateFromOverview()`（`overviewControls.js:740-754`）把状态值缓动回 `HIDDEN`，时长 250 ms，模式为 `EASE_OUT_QUAD`。动画结束后 `Overview._hideDone()`（`overview.js:579-597`）：

1. 隐藏 `_coverPane`；
2. `Main.layoutManager.hideOverview()`：隐藏 `overviewGroup`，并让 `window_group`、`top_window_group` 重新可见；
3. 状态切回 `HIDDEN`，恢复 unredirect；
4. 释放模态 grab；
5. 清除面板内联样式。

此时窗口克隆已经回到真实几何位置，真实窗口随即接替，视觉上没有跳变。

### 5.5 工作区卡片内部：窗口如何排成网格

每个 `Workspace` 含一个 `WorkspaceLayout`（`js/ui/workspace.js:412-910`）。它做两件事：

1. 计算“目标网格”；
2. 在“窗口真实几何”和“目标网格”之间按状态值插值。

目标网格算法在 `UnalignedLayoutStrategy` 中（`js/ui/workspace.js:144-410`）：

- 按窗口中心排序，尽量保持窗口之间的相对位置；
- 依次尝试 1 行、2 行、3 行……直到布局不再改善；
- 用“缩放收益”和“空间利用率”两个权重选择最佳布局（`LAYOUT_SCALE_WEIGHT = 1`、`LAYOUT_SPACE_WEIGHT = 0.1`，`workspace.js:24-25`）；
- 单个窗口的最大缩放不超过原尺寸的 95%（`WINDOW_PREVIEW_MAXIMUM_SCALE = 0.95`，`workspace.js:18`）；
- 对小窗口额外放大，避免计算器等小窗口缩得太小：高度比例越低，倍率越接近 1.5（`workspace.js:183-202`）；
- 窗口间距：布局管理器初始值为 20，但主题 `.window-picker { spacing: 6px; }` 会把它改成 6 逻辑像素（`js/ui/workspace.js:420`、`js/ui/workspace.js` 的 `_onStyleChanged()`、`gnome-shell-dark.css:2251-2253`），并叠加标题、关闭按钮等 chrome 的额外空间（`workspace.js:500-545`）。

`vfunc_allocate()`（`workspace.js:629-760`）中：

```js
x = Util.lerp(workspaceBoxX, x, stateAdjustementValue);
y = Util.lerp(workspaceBoxY, y, stateAdjustementValue);
width = Util.lerp(workspaceBoxWidth, width, stateAdjustementValue);
height = Util.lerp(workspaceBoxHeight, height, stateAdjustementValue);
```

- 状态值 0：属于当前工作区的窗口位于真实屏幕几何；不属于当前工作区的窗口从零尺寸开始；
- 状态值 1：窗口位于上面算出的网格槽位。

因此概览里的“缩放动画”不是给整个工作区做 `scale`，而是每帧重新计算每个窗口的位置和尺寸，属于布局插值。

另外，非活动工作区整体缩放到 94%（`WORKSPACE_INACTIVE_SCALE = 0.94`，`js/ui/workspacesView.js:25`、`246-265`）。

---

## 6. 窗口预览：实时纹理克隆，而不是截图

### 6.1 克隆的创建

`WindowPreview` 继承自 `Shell.WindowPreview`，内部有一个 `Shell.WindowPreviewLayout`（`js/ui/windowPreview.js:37-75`、`415-427`）。这个 C 布局管理器对每个窗口执行：

```c
window_actor = CLUTTER_ACTOR (meta_window_get_compositor_private (window));
actor = clutter_clone_new (window_actor);
```

（`src-shell/src/shell-window-preview-layout.c:397-401`）

也就是直接克隆 `MetaWindowActor`，不是抓取一张静态图。窗口里的视频、光标、动画在概览中会继续更新。

### 6.2 真实窗口已经隐藏，克隆为什么还能画

前面提到 `_updateVisibility()` 会把 `global.window_group` 设为不可见。按常理，被隐藏的 actor 及其子 actor 不会被绘制，但 `ClutterClone` 有专门处理：

`src-mutter/clutter/clutter/clutter-clone.c:123-184`：

```c
if (!clutter_actor_is_mapped (priv->clone_source))
  {
    _clutter_actor_set_enable_paint_unmapped (priv->clone_source, TRUE);
    was_unmapped = TRUE;
  }
...
clutter_actor_paint (priv->clone_source, paint_context);
```

克隆在绘制时会临时允许“绘制未映射的源 actor”，因此即使 `window_group` 不可见，克隆仍然可以把窗口内容画出来。

同时，`MetaWindowActor` 会统计“有多少个已映射的克隆”：

`src-mutter/src/compositor/meta-window-actor.c:139-172`：

```c
if (priv->n_mapped_clones > 0)
  {
    is_visible = TRUE;
    goto out;
  }
```

`cloned`/`decloned` 信号和克隆的 `notify::mapped` 会维护这个计数（`meta-window-actor.c:538-578`）。这样一来，窗口虽然被 Shell 隐藏，但只要有克隆在画它，Mutter 仍会把它视为“有效可见”，并抑制系统挂起状态。实际像素更新由克隆每帧重新绘制源 actor 完成。

### 6.3 预览上的附加元素

`WindowPreview` 还包含：

- 窗口标题（`.window-caption`，悬停显示）；
- 关闭按钮（`.window-close`，可关闭时显示）；
- 应用图标徽标（`.window-icon`，只在窗口选择器状态显示，随状态值缩放，`windowPreview.js:235-255`）；
- 悬停时窗口容器放大：每边增加 5 逻辑像素，即约 5% 的放大（`WINDOW_ACTIVE_SIZE_INC = 5`，`windowPreview.js:19`、`343-352`）；
- 标题和关闭按钮淡入 200 ms，鼠标静止 750 ms 后自动隐藏（`windowPreview.js:16-20`）。

克隆本身被设置为不参与拾取（`Shell.util_set_hidden_from_pick(clone, true)`），鼠标交互由外层反应式 actor 处理，避免拖拽时选到克隆（`windowPreview.js:417-427`）。

---

## 7. 背景、圆角与阴影

### 7.1 概览底色

概览组本身是纯色 `#222226`，由 St 的主题节点直接绘制成矩形（`gnome-shell-dark.css:2247-2248`）。它不是壁纸模糊，也不是半透明遮罩。

### 7.2 工作区卡片

`WorkspaceBackground` 继承自 `Shell.WorkspaceBackground`（`js/ui/workspace.js:942-1025`）：

- 内部是一个 `Meta.BackgroundGroup`，由 `BackgroundManager` 放入当前显示器的壁纸 `Meta.BackgroundActor`；
- 壁纸内容由 `Meta.BackgroundContent` 绘制，使用自定义 Cogl 管线；
- 圆角不是裁剪矩形，而是片元着色器里的圆角覆盖计算：

`src-mutter/src/compositor/meta-background-content.c:140-190` 中的着色器片段：

```glsl
uniform float clip_radius;

rounded_rect_coverage (vec2 p)
{
  float center_left  = bounds.x + clip_radius;
  ...
}
...
cogl_color_out *= rounded_rect_coverage (texture_coord);
```

JS 侧根据状态值设置半径：

```js
backgroundContent.rounded_clip_radius =
    Util.lerp(0, cornerRadius, this._stateAdjustment.value);
```

（`js/ui/workspace.js:1004-1008`）

`cornerRadius = scaleFactor * 30`，所以高 DPI 下圆角也按比例放大。

`Shell.WorkspaceBackground` 的分配逻辑还负责“从全屏收缩成卡片”：

`src-shell/src/shell-workspace-background.c:71-88`：

```c
scaled_height = height - BACKGROUND_MARGIN * 2 * scale_factor;
scaled_width = (scaled_height / height) * width;
...
clutter_actor_box_interpolate (box, &scaled_box,
                               self->state_adjustment_value, &my_box);
```

`BACKGROUND_MARGIN = 12`。状态值 0 时占满整个工作区，状态值 1 时上下各留 12 逻辑像素的边距，并按比例收窄宽度。CSS 中的 `.workspace-background` 同时提供 30 像素圆角和阴影：

```css
.workspace-background {
  border-radius: 30px;
  background-color: rgba(3, 2, 1, 0);
  box-shadow: 0 4px 16px 4px rgba(0, 0, 0, 0.2);
}
```

（`gnome-shell-dark.css:2271-2274`）

### 7.3 St 的阴影如何画

`box-shadow` 不是简单的矩形绘制。Shell 的 St 会：

1. 把阴影形状渲染到离屏纹理；
2. 用 `ClutterBlurNode` 做 GPU 模糊（`src-shell/src/st/st-private.c:434`）；
3. 再用 Cogl 管线把它合成到目标位置（`st-private.c:799-830`）。

概览中工作区卡片、窗口关闭按钮等阴影都走这条路径。

### 7.4 离屏重定向

- 搜索框设置 `OffscreenRedirect.ALWAYS`（`overviewControls.js:334`），每帧先渲染到离屏纹理再合成；
- 顶栏同样设置为 `ALWAYS`（`panel.js:439-442`）；
- 窗口预览使用 `AUTOMATIC_FOR_OPACITY`（`windowPreview.js:60`）。

这些设置影响的是绘制路径和缓存策略，不改变最终布局。

---

## 8. 搜索与应用网格

### 8.1 搜索

概览显示时，`SearchController` 会在舞台上挂一个 `key-press-event` 处理器（`js/ui/searchController.js:95-110`），因此不需要先点击搜索框：

- 可打印字符：把焦点交给搜索框，并把当前事件转发进去，开始搜索（`searchController.js:166-200`）；
- Escape：
  - 搜索中：先清空搜索（`reset()`）；
  - 应用网格中：退回窗口选择器；
  - 其他：关闭概览。

搜索激活时，`ControlsManager._onSearchChanged()`（`overviewControls.js:609-643`）在 250 ms 内：

- 应用网格和窗口选择器透明度降为 0；
- 缩略图淡出并缩放；
- 搜索结果层显示出来（搜索结果层自身在后续切换中带 250 ms 透明度过渡）；
- 把工作区设为不可交互，避免误操作。

### 8.2 应用网格

`showApps()` 让状态值从 1 → 2（`overviewControls.js:645-667`、`721-738`）：

- 工作区被压缩成顶部约 15% 高的条带；
- 应用网格从下方滑入并占据剩余空间；
- 缩略图透明度 255 → 0、缩放 1 → 0.5、向下平移；
- 应用网格的布局盒在状态 1 时位于工作区底部之外，状态 2 时移到工作区条带下方（`overviewControls.js:112-135`），由于 `ControlsManager` 裁剪到自身分配区域，滑动过程呈现为从下方升起。

从应用网格回到窗口选择器的动画使用 `EASE_OUT_SINE`，时长同为 250 ms（`overviewControls.js:645-658`）。

---

## 9. 渲染管线：从 actor 到屏幕

### 9.1 每帧的绘制顺序

Mutter 的 `MetaStage` 是 Clutter 舞台的实现。每次重绘时，`MetaStageImpl` 对每个显示器的 `ClutterStageView` 执行：

`src-mutter/src/backends/meta-stage-impl.c:405-421`：

```c
_clutter_stage_maybe_setup_viewport (stage, stage_view);
clutter_stage_paint_view (stage, stage_view, redraw_clip, frame);
clutter_stage_view_after_paint (stage_view, redraw_clip);
```

`clutter_stage_paint_view()` 最终进入 `clutter_stage_do_paint_view()`（`clutter/clutter/clutter-stage.c:370-444`）：

1. 创建根绘制节点，用舞台背景色清屏；
2. 计算裁剪区域对应的视锥，用于剔除；
3. 递归绘制舞台子 actor。

绘制顺序就是第 4 节的 actor 树顺序：桌面壁纸和窗口在最下，概览在其上，顶栏和模态层在最上。概览打开时 `window_group` 不可见，因此真实窗口不会参与绘制；概览中的克隆会单独绘制源 actor 的内容。

### 9.2 St、Clutter、Cogl、EGL 的分工

```text
JS（GJS）
  GObject 属性、Clutter 动画、St.Adjustment 状态值
        │ 每帧 notify::value → layout_changed
        ▼
St / Clutter 场景图
  布局分配、CSS 主题节点、背景/边框/阴影/圆角
        │ 生成 ClutterPaintNode 树
        ▼
Cogl
  管线、纹理、着色器、裁剪、离屏 FBO、模糊
        │ OpenGL ES / EGL
        ▼
Mesa（AMD Radeon 760M）
  渲染到 stage view 的 framebuffer
        ▼
KMS 原子提交 / EGL swap → 屏幕
```

补充说明：

- Mutter 50 自带 Clutter 和 Cogl（`src-mutter/clutter/`、`src-mutter/src/compositor/*`），不是外部的独立库；
- 原生后端使用 EGL 和 OpenGL ES（`src-mutter/src/backends/native/meta-renderer-native.c` 使用 `CoglWinsysEGL`、`EGL_OPENGL_ES_API`）；
- 每个显示器对应一个 `ClutterStageView`，有各自的 framebuffer 和帧时钟；分数缩放、不同刷新率都在这一层处理；
- 帧的调度由 `ClutterFrameClock` 驱动（`src-mutter/clutter/clutter/clutter-frame-clock.c`）。250 ms 的动画在 60 Hz 下约 15 帧。

### 9.3 损伤区域与直接扫描输出

- 普通绘制使用 damage region（损伤区域）做局部重绘：`meta-stage-impl.c:555-700` 计算重绘裁剪，只画发生变化的矩形；
- 概览打开时 `disable_unredirect()`，禁止全屏窗口走 direct scanout（`src-mutter/src/compositor/compositor.c:1299-1347`）；
- 概览关闭后恢复 unredirect，全屏游戏等可以重新绕过合成。

### 9.4 概览的绘制开销主要来自哪里

1. 每个可见窗口的克隆都要把源窗口的当前缓冲再绘制一次；窗口越多、分辨率越高，片元开销越大；
2. St 的阴影模糊需要离屏渲染和多次采样；
3. 壁纸的圆角着色器、工作区卡片的合成；
4. 动画期间每帧都重新分配布局（CPU 侧的 JS + Clutter 布局），但绘制仍然由 GPU 完成。

---

## 10. 关闭与窗口激活

### 10.1 再次按 Super

概览完全显示后再次按 Super，`overlay-key` 处理器走 `Main.overview.toggle()`，`_visible` 为真，于是 `hide()`，执行第 5.4 节的关闭动画。

### 10.2 点击窗口预览

`Workspace._onCloneSelected()`（`js/ui/workspace.js:1390-1400`）根据当前工作区与概览状态决定：

- 点击当前工作区的窗口，或在应用网格状态下点击：`Main.activateWindow()`；
- 点击其他工作区的窗口且仍在窗口选择器：先激活该工作区，留在概览中。

`Main.activateWindow()` 最后会调用 `overview.hide()`（`js/ui/main.js:844-861`），所以激活窗口一定伴随概览关闭。

### 10.3 Escape

按第 8.1 节的顺序逐级退出：先清搜索，再退出应用网格，最后关闭概览。

---

## 11. 源码地图

### Mutter 侧

| 作用 | 位置 |
| --- | --- |
| overlay-key 配置解析 | `src/core/keybindings.c:831-834` |
| 特殊修饰键按下/松开判定 | `src/core/keybindings.c:1522-1580` |
| overlay-key 处理与快捷键抑制检查 | `src/core/keybindings.c:1583-1605` |
| 键事件分发（先于客户端） | `src/core/events.c:258-264` |
| overlay-key 信号发出 | `src/core/display.c:2247-2250` |
| 窗口 actor 克隆计数与有效可见性 | `src/compositor/meta-window-actor.c:139-172`、`538-578` |
| ClutterClone 绘制未映射源 | `clutter/clutter/clutter-clone.c:123-184` |
| 舞台逐显示器绘制 | `src/backends/meta-stage-impl.c:405-421`、`555-700` |
| 舞台绘制入口 | `clutter/clutter/clutter-stage.c:370-444` |
| 壁纸圆角着色器 | `src/compositor/meta-background-content.c:140-190`、`1157` |
| unredirect 开关 | `src/compositor/compositor.c:1299-1347` |
| EGL/GLES 原生渲染 | `src/backends/native/meta-renderer-native.c` |
| 帧时钟 | `clutter/clutter/clutter-frame-clock.c` |

### GNOME Shell 侧

| 作用 | 位置 |
| --- | --- |
| overlay-key 信号处理 | `js/ui/overviewControls.js:419-439` |
| 概览显示状态机 | `js/ui/overview.js:80-106` |
| show/hide/toggle | `js/ui/overview.js:483-607` |
| 模态 grab | `js/ui/overview.js:451-481` |
| unredirect 切换 | `js/ui/overview.js:242-258` |
| overviewGroup 创建 | `js/ui/layout.js:252-261` |
| 真实窗口组隐藏/恢复 | `js/ui/layout.js:987-994` |
| 控件布局计算 | `js/ui/overviewControls.js:155-248` |
| 打开/关闭动画 | `js/ui/overviewControls.js:721-754` |
| 搜索交互与 Escape | `js/ui/searchController.js:95-200` |
| 工作区卡片尺寸/圆角 | `js/ui/workspace.js:942-1025`、`src/shell-workspace-background.c:71-88` |
| 窗口网格算法 | `js/ui/workspace.js:144-410` |
| 窗口几何插值 | `js/ui/workspace.js:629-760` |
| 窗口预览与克隆 | `js/ui/windowPreview.js:37-75`、`415-427`、`src/shell-window-preview-layout.c:397-401` |
| 工作区缩略图 | `js/ui/workspaceThumbnail.js`（`WindowClone`、`ThumbnailsBox`） |
| 多显示器工作区 | `js/ui/workspacesView.js:540-830`、`1022-1055` |
| 顶栏透明化 | `js/ui/panel.js:461-466` |
| 主题 | `data/theme/gnome-shell-dark.css`、`data/theme/gnome-shell-sass/widgets/` |

---

## 12. 如何自己观察和验证

### 12.1 在运行中的会话里查看对象树

按 `Alt+F2`，输入 `lg` 打开 Looking Glass，在 Inspector 中可以查看：

```js
Main.overview.visible
Main.overview.visibleTarget
Main.overview.controls._stateAdjustment.value
Main.layoutManager.overviewGroup
global.window_group.visible
global.get_window_actors().length
```

在 Evaluator 中修改 `Main.overview.controls._stateAdjustment.value = 0.5`，可以直接看到半开状态的布局，便于理解插值。

### 12.2 调试环境变量

只建议在当前会话之外（例如嵌套会话）使用：

```bash
MUTTER_DEBUG=keybindings gnome-shell --nested --wayland
MUTTER_DEBUG_PAINT=damage-region gnome-shell --nested --wayland
MUTTER_DEBUG_PAINT=disable-direct-scanout gnome-shell --nested --wayland
```

- `keybindings`：打印 overlay-key 的按下/松开判定；
- `damage-region`：把每帧重绘区域着色显示；
- `disable-direct-scanout`：强制关闭直接扫描输出，便于观察合成路径。

### 12.3 通过设置改变行为

```bash
# 关闭动画，观察“双击 Super”改为按 250 ms 时间窗判定
gsettings set org.gnome.desktop.interface enable-animations false

# 改变 overlay-key（例如改成 Super_R 或禁用为空）
gsettings set org.gnome.mutter overlay-key 'Super_R'
gsettings set org.gnome.mutter overlay-key ''

# 让所有显示器各自拥有工作区
gsettings set org.gnome.mutter workspaces-only-on-primary false
```

修改前请确认自己知道如何恢复，尤其是 `overlay-key` 置空后只能通过 Activities 按钮或热区打开概览。

### 12.4 观察点小结

- 按 Super 时界面不会在按下瞬间变化，而是在松开瞬间变化；
- 按住 Super 再按其他键不会打开概览；
- 快速双击 Super（在 250 ms 打开动画内）会进入应用网格；
- 概览打开时真实窗口组被隐藏，屏幕上看到的是 `Clutter.Clone` 的实时纹理；
- 工作区卡片不是整体缩放，而是逐帧重新布局每个窗口；
- 概览底色是纯色 `#222226`，壁纸只出现在工作区卡片内部。
