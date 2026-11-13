# 商店截图与功能说明

## 使用的壁纸

- 文件：`/usr/share/backgrounds/fedora-workstation/futurecity_light.webp`
- 名称：Future City
- 作者：Máirín Duffy
- 来源：Fedora Workstation Backgrounds（软件包 `fedora-workstation-backgrounds-1.6-9.fc44`）
- 许可证：CC-BY-4.0
- 选择原因：Fedora 自带的免费壁纸，绿色和蓝色几何面具有足够细节；卡片内外在边界处的亮暗和纹理连续，最容易看出“卡片内 1:1 清晰、卡片外模糊”的屏幕坐标对齐效果。

## 壁纸署名

如果这些截图用于商店页面，请保留以下署名：

> Screenshot wallpaper: "Future City" by Máirín Duffy, Fedora Workstation Backgrounds, CC BY 4.0.

许可证全文：https://creativecommons.org/licenses/by/4.0/

## 截图环境

- GNOME Shell 50.6，Wayland；
- 无头虚拟显示器 1920x1080，1x 缩放；
- Blur My Shell 启用；
- 扩展：`overview-clear-wallpaper@ohana986.github.io`；
- JPEG 由无头会话生成的 PNG 转换，质量参数 `-q:v 2`；PNG 原始帧生成在 `.test-home/`，该目录不纳入版本库，清理后可由脚本重新生成。

截图是在 1x 环境下生成的。125% 缩放和双显示器已经单独验证正常，但没有对应的商店截图。

## 推荐上传顺序

如果商店页面限制 5 张，建议按以下顺序上传：

1. `01-window-picker.jpg`
2. `02-overview-opening.jpg`
3. `03-workspace-scroll.jpg`
4. `04-app-grid-native.jpg`
5. `05-app-grid-sharp.jpg`

`06-overview-closing.jpg` 和 `07-app-grid-transition.jpg` 是补充动画帧，可以放在说明文档中，或在后续版本更新时使用。

## 文件说明

| 文件 | 内容 | 观察点 |
|---|---|---|
| `00-desktop-reference.jpg` | 概览关闭时的真实桌面 | 作为屏幕坐标参考；卡片内的清晰区域应与这张图的对应位置一致。不建议作为商店主图。 |
| `01-window-picker.jpg` | 窗口选择器稳定状态 | 卡片内部是 1:1 清晰壁纸，卡片外是 Blur My Shell 的模糊壁纸；绿色几何面的边缘跨过卡片边界时保持连续。 |
| `02-overview-opening.jpg` | 打开概览动画中间帧 | 卡片还在放大和移动，但卡片内的壁纸已经是屏幕坐标 1:1 裁切，不随卡片缩放；说明裁剪跟随卡片几何而不是重新缩放壁纸。 |
| `03-workspace-scroll.jpg` | 滚轮切换工作区动画中间帧 | 主卡片和左侧相邻卡片的一角都显示清晰裁切；壁纸固定在屏幕坐标上，没有跟着卡片横向滑动，也没有晚一帧。 |
| `04-app-grid-native.jpg` | 应用网格，设置开启（默认） | 顶部窄条使用系统原生行为：每个缩略图显示完整壁纸的缩放版本，所以两张缩略图都像是完整的画面。 |
| `05-app-grid-sharp.jpg` | 应用网格，设置关闭 | 顶部窄条使用 1:1 裁切：两个缩略图分别显示屏幕空间中不同的区域，而不是完整的缩放壁纸。 |
| `06-overview-closing.jpg` | 关闭概览动画中间帧 | 清晰卡片向全屏扩张，模糊边界收窄；说明关闭动画期间仍然保持屏幕坐标对齐。 |
| `07-app-grid-transition.jpg` | 窗口选择器切换到应用网格的中间帧 | 卡片缩小的过程中仍然显示 1:1 裁切，直到应用网格稳定后才按设置恢复原生壁纸。 |

## 功能说明

可直接用于商店描述：

> Overview Clear Wallpaper shows a sharp, screen-aligned 1:1 crop of the desktop wallpaper inside the overview workspace cards. The area outside the cards keeps the Blur My Shell processed wallpaper, so each card looks like a clear window onto the real desktop. The extension reuses each card's native Meta.BackgroundActor, so there is no extra full-screen layer, offscreen texture, or full-screen shader; rendering cost stays close to the native overview. Blur My Shell is optional: without it, the area outside the cards falls back to the dark `#222226` background. The app grid uses the native wallpaper by default and can optionally use the same 1:1 crop. Requires GNOME Shell 50.x; GNOME Shell 51 is not supported.
>
> Screenshot wallpaper: "Future City" by Máirín Duffy, Fedora Workstation Backgrounds, CC BY 4.0.

中文说明：

> 在概览的工作区卡片内显示屏幕位置对齐、1:1 的清晰壁纸，卡片外继续显示 Blur My Shell 处理过的模糊壁纸，因此卡片像是桌面上的一扇清晰窗口。扩展复用每张卡片自带的 `Meta.BackgroundActor`，不额外创建全屏图层、离屏纹理或全屏着色器，绘制开销接近系统原生概览。Blur My Shell 是可选依赖；没有它时卡片外回退为深色底 `#222226`。应用网格默认使用系统原生壁纸，也可以选择继续使用 1:1 裁切。仅支持 GNOME Shell 50.x，不支持 GNOME Shell 51。

## 复现

```bash
cd extension/overview-clear-wallpaper@ohana986.github.io
./test/capture-store-screenshots.sh /usr/share/backgrounds/fedora-workstation/futurecity_light.webp
```

脚本会运行无头嵌套会话，并把选中的帧转换到仓库根目录的 `screenshots/`。不指定壁纸时不会自动运行，必须显式传入图片路径。

## 注意事项

- 第一张商店截图会作为缩略图，建议使用 `01-window-picker.jpg`。
- 应用网格截图包含当前系统的应用图标；如果需要完全中性的应用列表，可以在干净用户配置中重新运行截图脚本。
- 截图中的 Blur My Shell 使用默认的概览模糊效果；没有测试 Blur My Shell 关闭时的深色底回退截图。
- 这些截图使用了 CC-BY-4.0 壁纸，商店页面或发布说明中应保留上面的署名和许可证链接。
