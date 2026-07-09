// 主菜单：新的人生 / 读档 / 设置。

import { useStore } from "../store/gameStore";
import { UpdateBanner } from "./UpdateBanner";

export function MainMenu() {
  const { saves, startNewGame, loadSave, deleteSave, setScreen, settings, lastError } = useStore();
  const noLlm = settings.profiles.length === 0;

  return (
    <div className="menu-screen">
      <UpdateBanner />
      <h1 className="menu-title">人生模拟器</h1>
      <p className="menu-tagline">每一次出生都是一次掷骰。这一世，你想怎么活？</p>

      <div className="menu-actions">
        <button className="btn-primary menu-btn" onClick={startNewGame}>
          ✧ 新的人生
        </button>
        <button className="btn-ghost menu-btn" onClick={() => setScreen("settings")}>
          ⚙ 设置
        </button>
      </div>

      {noLlm && (
        <p className="menu-warning">
          尚未配置大模型——游戏可以离线试玩（规则引擎照常运转），但叙事会是干巴巴的流水账。
          去「设置」里接入一个后端体验完整版。
        </p>
      )}
      {lastError && <p className="menu-warning">{lastError}</p>}

      {saves.length > 0 && (
        <div className="menu-saves">
          <h2>继续人生</h2>
          {saves.map((s) => (
            <div key={s.id} className="save-row">
              <button className="save-load" onClick={() => void loadSave(s.id)}>
                <span className="save-name">{s.name}</span>
                <span className="save-date">{s.date}</span>
              </button>
              <button
                className="btn-ghost btn-danger"
                onClick={() => {
                  if (confirm(`删除存档「${s.name}」？此操作不可恢复。`)) void deleteSave(s.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
