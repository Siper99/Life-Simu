# 人生模拟器 (life-sim)

Tauri + React + TypeScript 的人生模拟游戏。

## 发布新版本（自动更新）

应用内置 Tauri updater：启动时会检查
`https://github.com/Siper99/Life-Simu/releases/latest/download/latest.json`，
发现新版即可一键下载安装并重启。设置页也有「检查更新」按钮。

发布流程：

1. 改版本号（两处保持一致）：`src-tauri/tauri.conf.json` 的 `version` 和 `src-tauri/Cargo.toml` 的 `version`
2. 提交并打标签推送：

   ```bash
   git commit -am "release: v0.1.1"
   git tag v0.1.1
   git push origin main --tags
   ```

3. GitHub Actions（`.github/workflows/release.yml`）会自动构建 Windows 安装包、
   签名并发布 Release（含 `latest.json` 与 `.sig`）。旧版应用即可自动发现新版。

前置条件（只需配置一次）：仓库 Settings → Secrets and variables → Actions →
新建 secret `TAURI_SIGNING_PRIVATE_KEY`，值为本机 `~/.tauri/life-sim.key` 私钥文件的完整内容。
**私钥务必备份，丢失后老用户将无法收到更新。**

注意：自动更新只对通过安装包（`life-sim_x.y.z_x64-setup.exe` / `.msi`）安装的版本生效，
直接运行裸 `life-sim.exe` 不支持自动更新。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
