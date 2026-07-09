// 主菜单更新横幅：启动时静默检查，有新版才出现。

import { useEffect, useState } from "react";
import { UpdateInfo, checkForUpdate } from "../updater";

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // 静默失败：离线或开发环境不打扰用户
    checkForUpdate().then(setUpdate).catch(() => {});
  }, []);

  if (!update) return null;

  const install = async () => {
    setInstalling(true);
    setError("");
    try {
      await update.install();
    } catch (e) {
      setInstalling(false);
      setError(String(e).slice(0, 120));
    }
  };

  return (
    <div className="update-banner">
      <span>🔄 发现新版本 v{update.version}</span>
      {installing ? (
        <span className="update-status">正在下载安装，完成后自动重启…</span>
      ) : (
        <button className="btn-primary" onClick={() => void install()}>
          立即更新
        </button>
      )}
      {error && <span className="update-error">更新失败：{error}</span>}
    </div>
  );
}
