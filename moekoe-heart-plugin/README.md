# MoeKoe 播放栏红心收藏插件 (`moekoe-playerbar-heart`)

专为 [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic) Windows 桌面版开发的红心收藏增强插件。

## 功能特性

- **点击红心添加 / 取消收藏**：在底部播放栏或全屏歌词页点击红心，未收藏时添加到「我喜欢」歌单，已收藏时再次点击即可取消收藏。
- **实时高亮显示颜色**：已收藏歌曲的红心自动高亮为红色（`#ff4d6a`）并带有点击缩放动画；未收藏歌曲恢复默认图标颜色，自适应深色/浅色主题。
- **双位置实时联动**：底部播放栏与全屏歌词页的红心按钮状态同步更新。
- **跨音质智能匹配**：自动匹配普通/HQ/FLAC 等不同音质的 Hash 及歌名-歌手，切歌与切换音质时状态准确。
- **无需手动配置**：自动复用 MoeKoeMusic Windows 客户端内置 API（`window.kugouapi`）与登录态，自动识别「我喜欢」歌单。

## 安装方法（Windows 版 MoeKoeMusic）

### 方式一：通过 `.zip` 压缩包一键安装（推荐）

1. 打开 MoeKoeMusic Windows 客户端。
2. 进入 **设置 -> 插件管理 -> 已安装插件**。
3. 点击 **安装插件**，选择 `moekoe-heart-plugin.zip`。
4. 点击 **刷新插件**（或重启客户端）即可生效。

### 方式二：手动复制到插件目录

1. 在 MoeKoeMusic **设置 -> 插件管理** 中点击 **打开插件目录**。
2. 将整个 `moekoe-heart-plugin` 文件夹复制到插件目录中。
3. 点击 **刷新插件**（或重启客户端）即可生效。

## 文件说明

- `manifest.json`：MoeKoeMusic 插件清单（Manifest V3，含 `moekoe: true` 适配标记）
- `content.js`：将主逻辑注入页面主环境
- `injected.js`：红心状态同步、歌单增删 API 调用与点击事件接管
- `styles.css`：红心高亮颜色与点击动画样式
- `icons/`：插件图标（16x16 / 48x48 / 128x128）
