import { useEffect } from "react";
import { GameScreen } from "./components/GameScreen";
import { Genesis } from "./components/Genesis";
import { MainMenu } from "./components/MainMenu";
import { Settings } from "./components/Settings";
import { useStore } from "./store/gameStore";
import "./App.css";

export default function App() {
  const { screen, init, settingsLoaded } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  if (!settingsLoaded) {
    return <div className="app-loading">载入中……</div>;
  }

  switch (screen) {
    case "menu":
      return <MainMenu />;
    case "genesis":
      return <Genesis />;
    case "game":
      return <GameScreen />;
    case "settings":
      return <Settings />;
  }
}
