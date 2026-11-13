# Overview Clear Wallpaper

GNOME Shell 50 扩展的开发仓库。扩展在概览的工作区卡片内显示屏幕位置对齐、1:1 的清晰壁纸，卡片外继续显示 Blur My Shell 处理过的壁纸；没有 Blur My Shell 时，卡片外回退为深色底 `#222226`。

完整的安装、原理、性能与测试说明见 [extension/overview-clear-wallpaper@ohana986.github.io/README.md](extension/overview-clear-wallpaper@ohana986.github.io/README.md)。

## 仓库结构

```text
Overview_Clear_Wallpaper/
├── extension/
│   ├── overview-clear-wallpaper@ohana986.github.io/      # 主扩展：源码、schema、设置页、安装脚本、测试脚本
│   └── bin-opacity-demo@local/    # 早期验证卡片 _bin opacity 行为的演示扩展
├── archives/                      # 已安装版本的快照压缩包与校验值
├── screenshots/                   # 商店截图与功能说明
├── docs/
│   └── plans/                     # 设计阶段的实现计划
├── GNOME-50-Overview-WinKey.md    # 按下 Super 键后概览显示与渲染流程的分析笔记
├── build.sh                       # 生成 extensions.gnome.org 上传包
├── LICENSE                        # GPL-2.0-or-later
└── .gitignore
```

以下目录只存在于本地，不纳入版本库（见 `.gitignore`）：

- `.test-home*/`：无头测试会话的隔离 `XDG` 目录、截图和日志，由测试脚本自动生成；
- `gnome-shell-js/`、`mutter-src/`、`src-shell/`、`src-mutter/`：从上游源码包解析出的参考实现，供查阅私有 API 与渲染顺序；
- `tarballs/`：`gnome-shell-50.6.tar.xz`、`mutter-50.6.tar.xz` 原始源码包。

## 安装

以普通桌面用户运行，不要使用 sudo：

```bash
cd extension/overview-clear-wallpaper@ohana986.github.io
./install.sh
```

安装后注销并重新登录（Wayland 会话不能单独重启 GNOME Shell），再执行：

```bash
gnome-extensions enable overview-clear-wallpaper@ohana986.github.io
```

卸载：

```bash
./install.sh --uninstall
```

## 测试

```bash
cd extension/overview-clear-wallpaper@ohana986.github.io
./test/eval-nested.sh    # 无头虚拟显示器，自动截图并做像素对齐检查
./test/perf-nested.sh    # 对比扩展启用与禁用的 CPU 开销
```

两个脚本都会在项目根目录创建 `.test-home*` 隔离目录，不会影响当前桌面会话。

## 构建上架包

```bash
./build.sh
```

脚本会在 `dist/` 下生成 `overview-clear-wallpaper@ohana986.github.io.shell-extension.zip`，并检查 `lib/`、schema、翻译和运行文件是否齐全。`build.sh` 会编译 `po/` 中的翻译，只把 `locale/<语言>/LC_MESSAGES/<UUID>.mo` 放进 zip。生成后可以用隔离的 `XDG_DATA_HOME` 验证安装：

```bash
XDG_DATA_HOME="$PWD/.test-home-pack/share" \
  gnome-extensions install --force dist/overview-clear-wallpaper@ohana986.github.io.shell-extension.zip
```

## 商店截图

`screenshots/` 目录包含 1920x1080 的商店截图和说明。使用真实壁纸重新生成：

```bash
cd extension/overview-clear-wallpaper@ohana986.github.io
./test/capture-store-screenshots.sh /path/to/wallpaper.jpg
```

截图选择、观察点和可直接使用的商店描述见 [screenshots/README.md](screenshots/README.md)。当前一套截图使用 Fedora 自带的 Future City 壁纸（CC-BY-4.0，作者 Máirín Duffy），发布时应保留署名。

## 版本快照

`archives/overview-clear@local-installed-20261112-131552.tar.gz` 是 2026-11-12 安装到当前会话的版本副本，同目录的 `.sha256` 文件保存校验值。该校验值为：

```text
069c4de19942ac6f2f6e3fa0c000e4d779d5168f42c6bced4ae6bfac7cb1bb0f
```

该快照早于滚轮切换工作区抖动问题的修复，仅用于回溯对比，不是当前源码。

## 环境要求

- GNOME Shell 50.x（本机 50.6，Wayland）；
- 不支持 GNOME Shell 51；
- 125% 缩放和双显示器环境已初步验证正常；
- 可选：Blur My Shell（UUID `blur-my-shell@aunetx`）；
- 交互式嵌套测试另需 `mutter-devkit`，无头测试不需要。

## 许可

本项目使用 GPL-2.0-or-later 许可证，完整文本见根目录的 `LICENSE`。
