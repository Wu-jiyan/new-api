# 好感值系统 + 手动解锁设计

日期：2026-09-01

## 背景与目标

AI 角色系统当前按「累计消耗 token」自动解锁阶段（`RefreshUserCharacterProgress` 达标即推进 `max_stage`），解锁无仪式感，条件单一。本次新增：

1. **好感值系统框架（0-100）**：新增好感数据维度与界面展示，增长逻辑占位预留，供后续真实玩法（剧情选择、聊天互动）接入。
2. **双门槛解锁**：角色与阶段解锁除 token 要求外，增加好感门槛（可配置，默认 0=不要求）。
3. **手动解锁**：达标（eligible）后不再自动解锁，由用户在画廊卡片/详情页点击「解锁」按钮触发，配光晕扩散+淡入动画，增强成就感。
4. 第一阶段（阶段 0，首次对话解锁）同样改为手动解锁，保证流程一致性。

## 术语

- **好感（affinity）**：用户对单个角色的羁绊值，0-100，存 `user_character_progress.affinity`。
- **达标（eligible）**：某阶段已满足全部解锁条件（calls / tokens / affinity），但尚未点击解锁。
- **已解锁（claimed）**：用户已点击解锁并通过，`max_stage` 至少推进到该阶段。

## 数据模型变更

### 1. `user_character_progress` 表加列

| 列 | 类型 | 说明 |
|---|---|---|
| `affinity` | INT | 好感值 0-100，默认 0。占位期无增长逻辑，值恒为存储值 |

### 2. `characters` 表加列

| 列 | 类型 | 说明 |
|---|---|---|
| `affinity_required` | INT | 角色整体解锁（进入该角色剧情）所需好感门槛，默认 0 |

### 3. `CharacterStage`（存于 `stages_json`）加字段

```go
AffinityRequired int `json:"affinity_required,omitempty"` // 该阶段好感门槛，默认 0
```

阶段 0 的 `unlock_tokens` 保持 0（首次调用即 token 达标），但解锁改为手动。

## 解锁状态机

### 判定规则

单阶段达标判定 `isEligible(stage, userUsage)`：

```
calls >= 1
&& tokens >= stage.UnlockTokens
&& affinity >= stage.AffinityRequired
&& affinity >= character.AffinityRequired   // 角色整体门槛
```

`RefreshUserCharacterProgress`（[character_unlock.go](e:\new-api\model\character_unlock.go)）**不再自动推进 `max_stage`**，只刷新 `total_tokens / total_calls / affinity`。历史已解锁的 `max_stage` 数据保留，不回退。

### 顺序解锁

新增持久化函数 `UnlockUserCharacterStage(userId, modelName, stageIdx)`：

- 仅允许解锁 `max_stage + 1` 的阶段（顺序推进，不可跳级）；未解锁任何阶段时 `max_stage = -1`，可解锁阶段 0。
- 校验目标阶段 eligible，成功则 `max_stage = stageIdx`，更新 `last_unlock_at`。
- 返回最新 `max_stage`。

### 好感增长占位

新增 model 方法（占位，不接路由、无调用方）：

```go
// GainAffinity 增加用户对该角色的好感，封顶 100。
// 占位框架：当前无调用方，待剧情选择/聊天互动玩法接入后启用。
func GainAffinity(userId int, modelName string, delta int) error
```

## 后端 API

### `GET /api/character`（ListCharacters）与 `GET /api/character/:modelName`（GetCharacter）

返回字段扩展：

- 顶层新增：`affinity`（该用户好感值）、`affinity_required`（角色好感门槛，透传 `characters` 列）。
- 每个 `stage` 新增：`affinity_required`、`claimed`（`index <= max_stage`）、`eligible`（达标但未解锁）。
- 立绘/剪影暴露规则不变：已 claimed 的阶段暴露素材，未解锁暴露剪影。

### `POST /api/character/:modelName/unlock`

请求：`{"stage": 0}`。校验：角色存在、用户已登录、目标阶段为 `max_stage+1` 且 eligible。成功后返回最新 `{max_stage, claimed 状态}`。失败返回具体原因（token 不足/好感不足/顺序错误）。

路由注册于用户组 `/api/character`，注意在 `/:modelName` 之前注册避免被捕获。

### 解锁校验的存量接口

`CharacterChat`、`GetCharacterScript`、playground 注入逻辑仍以 `max_stage` 判定，语义从「达标」自然变为「已手动解锁」，无需额外改动。

## 前端交互

### 画廊卡片（gallery.tsx CharacterCard）

三态渲染：

| 状态 | 表现 |
|---|---|
| 锁定（calls<1 或未达标） | 剪影 + 锁图标，进度条不变 |
| 可解锁（eligible） | 剪影上方浮现发光「解锁」按钮，点击触发解锁 |
| 已解锁（claimed） | 立绘 + 「进入剧情」按钮（现状） |

### 详情页（character/index.tsx）

- 立绘区上方展示好感条：`♥ {affinity}/100`（进度条样式与 token 进度一致）。
- 阶段列表行新增状态：锁（未达标，展示 token/好感差距）→ 发光「解锁」按钮（达标未解锁）→ 「已解锁」。
- 「进入剧情」按钮在阶段未手动解锁前保持 disabled 并提示「需先解锁」。

### 解锁动画

点击「解锁」→ `POST unlock` 成功 → 播放光晕扩散（按钮/卡片边缘一圈发光环向外扩散）→ 剪影渐变为立绘淡入。动画克制动效（~600ms），不使用夸张粒子。解锁失败 toast 展示原因。

### 管理员端

- 角色编辑器基本信息区：新增「好感门槛」数字输入（`affinity_required`，0-100）。
- 阶段编辑区：每阶段新增「好感门槛」数字输入（阶段 JSON `affinity_required`）。
- 展示/保存逻辑沿用现有 stages 表单流。

## 数据迁移与兼容

- 新增列均默认 0/占位，现有角色零影响（解锁仍按 token，因为好感门槛 0 且好感 ≥ 0 恒成立；但解锁从自动改手动——历史已解锁保留，未解锁不再自动推进，此为预期行为变更）。
- `stages_json` 反序列化：缺省 `affinity_required` 解析为 0，向后兼容。
- 无数据回填需求；如有 SQLite 迁移需按项目现状手动 `ALTER TABLE`（沿用历史做法）。

## i18n

7 语言（en/zh/zh-TW/fr/ja/ru/vi）补充文案 key（置于 `character.*` 命名空间）：

- `character.affinity`（好感/进度条标题）
- `character.unlock`（解锁按钮）
- `character.unlockReady`（可解锁提示）
- `character.unlockInsufficient`（好感不足文案，可复用占位）
- `character.affinityRequired`（阶段好感门槛标签，管理员端）
- 阶段状态：锁定/可解锁/已解锁 现有 key 复用。

## 测试

- model 单测：`RefreshUserCharacterProgress` 不再推进 `max_stage`；`UnlockUserCharacterStage` 顺序/越界/达标校验；`GainAffinity` 封顶。
- controller 单测：unlock 接口成功、token 不足、好感不足、跳级 403；存量 chat/script 接口在手动解锁语义下行为正确。
- 前端类型检查 `npx tsgo --noEmit`。

## 不做的事（YAGNI）

- 不做好感增长的真实玩法（剧情选项加分、对话好感），仅预留 `GainAffinity` 入口。
- 不做好感排行榜/跨角色总览。
- 不做解锁动画的配置项（固定一套克制光晕）。
