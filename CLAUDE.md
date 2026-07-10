# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

人生模拟器：Tauri 2 + React 19 + TypeScript + zustand 的单机人生模拟游戏。LLM（可选配置）负责叙事与选项生成，规则引擎持有全部数值真值。代码注释与 UI 均为中文，保持这个风格。

## 常用命令

```bash
npm run dev              # Vite 开发服务器（端口 1420，strictPort；纯浏览器可跑，持久化退回 localStorage）
npm run tauri dev        # 完整桌面应用（需要 Rust 工具链）
npm run build            # tsc + vite build（发布前必须过）
npx tsc --noEmit         # 只做类型检查
npx vitest run           # 全部测试（引擎单测，Node 环境无 DOM）
npx vitest run -t "运气豁免"   # 按名字跑单个测试
```

发版流程见 README.md：同步改 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 的版本号 → 打 tag 推送 → GitHub Actions 自动构建签名发布，应用内置 updater 自动更新。签名私钥在仓库 secret `TAURI_SIGNING_PRIVATE_KEY`。

## 架构红线（改任何东西前先读）

1. **引擎持数值真值，LLM 只产出文本与结构化意图**。所有 LLM 输出必须经引擎净化落地：`sanitizeLlmChoices`（行动卡）、`parseIntents` 的白名单校验（意图）、`splitNarrativeHooks`（叙事线头）——数值一律 clamp 到合法区间，解析失败静默降级到离线兜底。每个 LLM 功能都必须有无 LLM 兜底，游戏离线可完整运行。
2. **NSFW 路由隔离**：露骨内容只发给明确标了 `nsfw` 角色的后端，`profileForRole` 对 nsfw 绝不回退到其他 profile（防止发给官方 API）。改 LLM 路由时不得破坏这条。**上下文同样隔离**：nsfw 后端生成的原文只留在游戏日志展示（`LogEntry.nsfw` 标记），记忆存 `NSFW_MEMORY_PLACEHOLDER` 替身、线头不采收、出卡提示词的「上回合叙事」换替身——保证后续发给常规后端的 prompt 不携带露骨原文（`llm.test.ts` 有断言）。
3. **确定性 RNG**：引擎内随机全部走 `Rng`（种子化，`rngState` 存在 GameState 里、每次消耗后写回）。UI 侧需要"同回合稳定"的随机（决策盘、建议）用 `seed ^ turn` 派生独立序列，不消耗主 RNG。
4. **存档兼容**：给 `GameState` / `AppSettings` 加字段时，必须在 `store/persist.ts # migrateGame`（存档）或 `DEFAULT_SETTINGS` 合并（设置，`readSettingsFile` 已做展开合并）里补默认值，旧存档必须能继续玩。

## 回合状态机（核心数据流）

zustand store（`store/gameStore.ts`）驱动：`idle → parsing → swinging → narrating → idle`。

1. 玩家从决策盘选卡（`submitChoices`）或自由输入（`submitTurn`，经 `parseIntents` 拆意图）；
2. `engine/turn.ts # beginTurn`：高危意图与需判定的事件生成 `SwingCheck`（转针参数）；
3. 转针：`SwingBar` 只负责表现，停针瞬间调 store `judgeSwing` → 引擎 `resolver.ts # judgeSwing`（落点→五档→大失败的运气豁免掷点，写回 rngState）；演出结束 `confirmSwing` 推进下一针或结算；
4. `finalizeTurn`：只读判定结果（不再掷点），五档倍率结算 deltas、应用、时间推进（被动收支/精力恢复/衰老/跨年时代事件）、死亡判定；
5. `finishTurn`（store）：结算浮字（`FloatingDeltas`）、`narrateTurn`（叙事 + HOOKS 线头）、线头生命周期（4 回合窗口、上限 6）、`refreshLlmChoices` 异步生成下回合灵感卡。

关键陷阱：UI 展示和 `submitChoices` 校验必须用同一份 `mergedBoard(game, llmChoices)`（固定卡池 + 本回合 LLM 卡合并），否则选中的灵感卡会被误判过期。

## 引擎模块速览（src/engine，纯 TS、可在 Node 直接测）

- `types.ts`：全部共享类型；`GameState` 即存档格式。
- `resolver.ts`：转针参数（`SWING_EASE_LEVELS` 三档难度旋钮，摆速×√EASE、区宽×1/√EASE）、`judgeSwing`、五档结算（`TIER_MULT`，高危成功档 ×1.25）、`applyDeltas`。
- `turn.ts`：回合编排 + `advanceTime`（被动结算）+ `fastForward`（跳过时间，UI 提供 1单位~1年档位）。
- `decisions.ts`：决策盘——`STAGE_POOL` 固定卡池、`ERAS` 时代底色 + `EPOCH_EVENTS` 大事年表（按国家优先匹配，命中年份 `WorldPulse.major=true` 并接管行动修正）、导演系统（读最近 4 回合选择倾向插卡）、`contextualChoices` 情境卡（欠债/亲人病重/关系裂痕/技能磨砺/闲钱/线头回响，引用真实姓名与数字，用独立 RNG 保证 LLM 卡到达后日常卡抽样不变）、`personalizeDraft`（"才艺/专业技能"占位词按角色种子换成稳定的个人特长）、`boardHeadline`（情境化标题）、`sanitizeLlmChoices`。
- `skills.ts`：技能名推断——技能必须是手艺名词（木工/吉他），不是行动描述，也不是学段标签；优先级：意图自带 skill 字段 > 关键词词典 > 类别兜底（study→"学识"、work→按职业赛道 `TRACK_SKILLS` 映射成真手艺）> 不积累；学龄前不长技能。技能有真实机制作用：`skillMasteryFor` 熟练度抵扣判定难度（×3/级）、放大工作/理财正向收入（×6%/级）；升级门槛 `xpToNext` 随等级递增。旧存档学段课业在 `persist.ts # migrateGame` 并入"学识"。
- `lifecycle.ts`：职业/关系/衰老 + `settleResidence`（迁移：从行动摘要识别"搬到X/去X工作/南下X"等，判定成功才更新 `identity.residence`；在 `finalizeTurn` 里先于 `settleCareer` 结算，入职单位用 `currentCityOf` 取当前城市）。
- `scene.ts`：场景模式——镜头从「一季」拉近到「此刻」的连续对手戏：时间冻结、每拍扣 5 精力（上限 12 拍），玩家一拍台词/动作、`narrateSceneBeat` 接一拍剧情（NSFW 场景全程走 nsfw 后端并带完整场景记录保证连续性）；`settleScene` 收场结算好感/心境/共同记忆。收场时露骨场景的记忆同样只留替身文案。**每拍实时后果**：LLM 在正文尾行输出 `EFFECTS:{...}`（金钱/好感/心境/人脉/法律状态/状态增减），`sanitizeSceneEffects` clamp 净化（花销不超钱包+5000 透支、法律走白名单）、`applySceneEffects` 当场落地并浮字反馈；法律处境非清白时显示在面板与 statusCard，`boardHeadline` 对通缉/服刑有专属标题。
- `economy.ts`：经济系统——`LIFESTYLES` 生活方式档位（成年后生效：开销倍率×城市系数，换心境锚点/精力恢复/魅力年漂移/社交判定减免；存款撑不过 4 个周期自动降档）、`connectionsBoost` 人脉护航（花 5~15 点人脉换本回合高危行动难度 -最多10，`beginTurn` 的 opts 传入）。一次性花费经 `ActionIntent.moneyCost` 结算：无论成败都扣钱，报班技能经验 ×2.5、就医健康恢复 ×2（resolver）；`selectionError` 与 `sanitizeLlmChoices` 都校验付得起。
- `memory.ts`：`statusCard` / `historyContext`，喂给所有 LLM prompt 的角色上下文。
- 精力（energy）跨回合保留：行动扣、恢复卡与时间推进回，选卡时时间格（3 格）+ 精力双重预算。
- 开发者面板（游戏头部 🛠，`components/DevPanel.tsx` + store 的 `devMutate`/`devSkipTurns`/`devSkipToYear`）：直接改写属性/精力/金钱/人脉（超上限自动抬 ceiling）、瞬时快进时间（走 `fastForward` 被动结算、不走 LLM）、死亡后可复活、LLM 路由日志（`client.ts # llmCallLog`：每次请求记用途→后端→耗时，NSFW 行紫色高亮；控制台同步打印 `[LLM路由]`）。改动在关面板时落盘。

## LLM 层（src/llm）

- `types.ts`：多 profile 按角色路由（narrative/nsfw/summary），`AppSettings` 含内容分级、叙事风格、判定难度。同一角色多个后端时排在前面的优先；设置页有「一键双后端」预设（DeepSeek 常规 + Grok 成人）。
- `prompts.ts`：全部提示词模板。叙事 prompt 要求尾行输出 `HOOKS:[...]` 线头；出卡 prompt 要求第一张为"回响卡"（回应上回合叙事/线头）。
- `orchestrator.ts`：`parseIntents` / `narrateTurn` / `proposeChoices` / `narrateSkip` / `writeEpitaph`，全部带离线兜底。

API key 在 Tauri 侧存系统凭据管理器（`secret_get`/`secret_set` invoke），设置 JSON 里不落盘。

## 测试

`src/engine/engine.test.ts` 覆盖引擎全部规则（含概率机制的统计学断言，如运气豁免约对半）。测试环境是 Node：引擎与 `llm/prompts.ts` 必须保持可脱离 Tauri/DOM 导入。改判定参数、结算公式、净化器时同步改这里的断言。
