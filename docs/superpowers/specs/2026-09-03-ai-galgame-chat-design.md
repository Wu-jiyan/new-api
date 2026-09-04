# AI Galgame 角色对话引擎设计

> 日期：2026-09-03
> 关联 spec：`2026-09-01-affinity-unlock-design.md`（好感解锁系统，本设计在其之上延伸）
> 状态：设计待审阅

## 1. 背景与目标

角色系统已有「立绘 / 姿态 / 阶段 / 背景 / 切换动画」「好感 0-100 解锁门槛」「小剧场（script 剧本）」，但对话仍停留在两种弱形态：(a) 小剧场只是纯剧本播放，播完即止；(b)「角色对话」跳通用 Playground 注入一个 system prompt，无任何角色视觉与记忆。

本次目标：让用户能**真正与 AI 角色做 galgame 式对话**——角色调用真实 API、遵守角色设定、按约定 JSON 自主切换姿态/背景/动画、好感随对话动态变化、对话长期持久化可续谈，且**小剧场结束后可选择退出或继续，并把小剧场剧情带入自由对话**。

## 2. 范围

### 2.1 本次交付（四块，按依赖顺序推进）

1. **对话会话与消息持久化**：单主线会话 + 消息落库 + 续谈与历史加载。
2. **AI 视觉协议**：定义「回复 JSON」契约，AI 自主输出姿态/背景/动画指令，前端驱动立绘。
3. **动态好感**：AI 自报好感变化，服务端限幅落库，持续充当解锁门槛。
4. **小剧场衔接**：小剧场结束后「退出 / 继续」，继续则把小剧场剧情作为开场上下文带入自由对话。

### 2.2 明确不做（Out of Scope）

- 向量/嵌入检索式长期记忆；多会话/分支存档；语音；模型侧 function calling/tool 依赖；AI 画像/人格随时间重写；对话中自动推进解锁阶段。
- 本设计不改动现有解锁（手动解锁）与画廊三态逻辑。

## 3. 决策记录（与用户确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 本次范围 | 四块全做，按依赖顺序（1→2→3→4） |
| 2 | 会话形态 | 角色单主线续谈：每角色每用户仅一个会话，再次进入自动续谈 |
| 3 | 记忆策略 | 滑动窗口 + 自动摘要：近期 N 轮原文 + 早期摘要段落 |
| 4 | 好感机制 | AI 在回复 JSON 自报 delta，服务端限幅（±3/轮 + 小时护栏） |
| 5 | 协议解析层 | 视觉指令前端解析（保留流式打字机）；好感/记忆由服务端基于 tee 聚合全文处理 |

## 4. 现状基线（复用点）

- `POST /api/character/:model/chat`（controller/character.go:207-268）：校验解锁 → `BuildCharacterChatRequest` 注入 system prompt → 回环转发 `/pg/chat/completions`（controller/playground.go → controller/relay.go → relay.TextHelper）→ SSE 流式透传。计费与普通聊天同链路（service/text_quota.go、service/billing.go）。**骨架直接复用**。
- 无任何对话/历史/记忆存储；`GainAffinity`（model/character_unlock.go:171）无调用方，`AffinityRequired` 门槛判定已就绪。
- 前端 StoryPlayer（web/src/features/character/components/story-player.tsx）含全套视觉派生（pose/background/effect/flash/key 换图动画）与打字机；ai-elements（Message/Conversation/Response）与 playground hooks（use-stream-request/use-chat-handler）可复用。
- 角色数据结构：model/character.go（Character.SystemPrompt 即「对话人设」；CharacterStage: poses/background_url/effect；CharacterScript: text/pose/effect/background/choices；背景库 CharacterBackground 按 name 引用）。

## 5. 数据模型（新增 2 张表，加入 model/main.go AutoMigrate 列表）

### character_chat_sessions

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| user_id | int | 联合唯一 `idx_sess_user_model(user_id, model_name)` |
| model_name | string(128) | 角色 model_name |
| stage_index | int | 默认 0；对话当前绑定阶段 |
| initial_context | text | 小剧场带入的开场剧情（一次性固定携带） |
| summary | text | 滚动摘要（早期记忆压缩） |
| message_count | int | 默认 0；统计消息条数 |
| summary_through | int | 默认 0；最近一次成功摘要覆盖到的消息条数（摘要水位） |
| last_message_at | bigint | 最后消息时间 |
| created_at / updated_at | bigint | |

约束：单主线 = `user_id + model_name` 唯一，重复进入返回既有会话。

### character_chat_messages

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| session_id | int | 索引；关联 sessions |
| user_id | int | 冗余索引（跨会话隔离查询） |
| model_name | string(128) | 冗余 |
| role | string | `user` / `assistant` |
| content | text | **纯台词文本**（assistant 存 reply 文本而非 JSON 原文） |
| pose / effect / background | string | assistant 可选冗余（流结束解析出的视觉字段；user 为空） |
| affinity_delta | int | assistant 冗余（实际应用的 delta；user 为 0） |
| created_at | bigint | |

说明：JSON 原文不落库；流结束时后端解析一次，字段拆分入库，历史拼装/回放零转换。

## 6. 接口设计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/character/:modelName/chat` | **改造**。请求体 `{ content?, stage_index?, from_story? }`。`from_story: true` 表示从小剧场进入（此时 content 可空，开场白由服务端生成）；否则 `content` 必填为用户输入。首轮自动创建/续用单线会话；返回 SSE 流（同现状）。会话级前置校验同现状（未解锁 403） |
| GET | `/api/character/:modelName/chat/messages` | 分页历史 `?cursor_id=&limit=`（默认最新 30 条，倒序分页） |
| GET | `/api/character/:modelName/chat/meta` | 返回 session 元信息（stage_index/summary 摘要片段/有无 initial_context/消息数）——前端对话页初始化用 |

不新增好感上报端点：好感变化由服务端在流结束后自动处理。

### 会话驱动 POST /chat 语义

1. 取/建单线会话（取角色 `ch.Stages()` 对应 stage_index 默认取用户已解锁最深 stage 或请求指定）。
2. 落库本条 user 消息（content=输入原文）。
3. 服务端组装 prompt（见 §7），转发内部 `/pg`（沿用现有链路与计费）。
4. SSE 透传的同时 tee 聚合 assistant 流式 content 全文。
5. 流结束（或出错）：解析全文 → 拆 `reply / pose / effect / background / affinity_delta` → 落库 assistant 消息（content=reply + 冗余字段）→ 限幅好感并落库 → 检查并触发滚动摘要（§8）。解析失败：content=原文全文、视觉冗余为空、delta=0，对话不中断。
6. 错误透传规则与现状一致（非 2xx/网络错误原样透传）。

## 7. AI 角色扮演协议

### 7.1 每回合输出契约

AI 每回合**只输出一个 JSON 对象**（system prompt 强约束，不依赖 JSON mode）：

```json
{
  "reply": "台词正文（用户看到的全部台词）",
  "pose": "happy",
  "effect": "fade",
  "background": "机房",
  "affinity_delta": 1
}
```

字段约束：

- `reply`：必填，正文；允许无姿态场景下自然对话。
- `pose`：可选；只能取 system prompt 中列出的「当前阶段可用姿态名」，非法值前端忽略（维持现状）；`null` 表示维持。
- `effect`：可选；枚举 `fade | black | white | null`（与现有脚本动画一致：fade=立绘淡入、black/white=全屏闪屏）。
- `background`：可选；只能取「背景库名」或当前阶段背景名，非法值忽略；`null` 维持。
- `affinity_delta`：可选；整数建议值，服务端限幅（见 §9），仅作参考。

### 7.2 system prompt 组装结构（服务端拼装顺序）

1. 角色人设：`Character.SystemPrompt`（为空时给默认 galgame 人设兜底）。
2. 阶段设定：`stage_index` 对应的 `CharacterStage.Name` + 一句当前剧情语境。
3. 视觉资源清单：本阶段 poses 名列表、可用背景名列表、effect 枚举——**只列已配置资源**。
4. 开场剧情：`session.initial_context`（小剧场带入，固定携带）。
5. 记忆：`session.summary`（早期摘要）。
6. 历史：窗口内最近 N 轮原文（user=原文；assistant=纯台词文本）。
7. 输出协议：字段 schema + 单例示例 + 「只输出 JSON，禁止 markdown 围栏/多余文字」。

### 7.3 前端解析（对话页）

- 流式渲染 reply 全文（打字机）；流结束后一次容错解析：剥 ```json 围栏、剥离前后说明文字、定位首 `{` 到末 `}` 后 `JSON.parse`。
- 解析成功：`pose/effect/background` 驱动立绘/背景/闪屏切换；解析失败：仅显示全文，视觉不变，对话不中断（可静默记一次日志，不做 toast 打扰）。

## 8. 记忆：滑动窗口 + 自动摘要

- **窗口**：组装历史取最近 40 条消息原文（user+assistant 计数）；更早消息不参与每轮请求。
- **归档触发**：新消息落库后，当 `message_count - summary_through ≥ 60` 时触发一次摘要（40 条窗口外的待归档部分）。
- **摘要生成**：调一次模型（复用会话同一上游链路与用户计费），输入 = 旧 summary + 待归档消息序列，输出 ≈ 500 字以内的事件/关系/承诺要点，覆盖写回 `session.summary`，成功后 `summary_through = message_count`。
- **失败策略**：摘要失败静默（`summary_through` 不推进，差值继续累计，下轮触发），不影响对话。
- 前端展示不受影响：历史列表直接读 messages 表，窗口裁剪只在请求拼装层发生。

## 9. 好感闭环与护栏

- 流结束解析到 `affinity_delta` → clamp 单次至 `[-3, 3]`。
- **小时护栏**：以该会话近 1 小时内已应用 delta 之和计，若 |本次后累计| 超过 10 则本次丢弃（静默）。
- 通过护栏则调用 `GainAffinity(userId, modelName, delta)`（0-100，上限封顶，model/character_unlock.go 既有实现）。
- 前端好感展示：对话页流结束后 invalidate 角色查询，好感条自动刷新；delta≠0 时在好感条旁浮动 `+2`/`-1` 气泡提示。
- 好感仍作为解锁门槛数据源，现有 eligible 判定零改动。

## 10. 小剧场衔接

- StoryPlayer 结束屏新增主按钮「继续对话」（`character.story.continue`），保留「关闭」。
- 点「继续对话」→ 调 `POST /chat { from_story: true, stage_index }`（幂等建会话）。首次创建时：服务端把该阶段 script 内容压缩为 `initial_context` 落库（一次性固定携带），并以小剧场结束语境生成一段 user 开场白落库（如「（你刚刚经历完与她的初遇，现在她就在你面前）……」），使 AI 第一句即接住剧情、对话可立即开始。会话已存在（再次进入）则走普通续谈，不再写 initial_context/开场白。
- 退出：关闭 StoryPlayer 回原页，进度语义 = 小剧场本身仍可随时重播（现有行为），不影响对话会话。
- detail 页保留「开始对话」直达对话页（`from_story` 缺省，空开场，无 initial_context）。

## 11. 前端对话页

路由：`/character/$modelName/chat`（TanStack 文件路由，放 `_authenticated/character/$modelName/chat.tsx`）。

布局（自上而下）：

1. 顶栏：返回按钮 + 角色名/阶段标签 + 好感条（爱心条样式复用 detail 页）。
2. 场景区：背景图（层） + 立绘（随 `pose` 用 `key={img}` 换图 + effect 闪屏/淡入），沿用 story-player 的视觉派生函数（抽成共享 hook/组件，避免双份逻辑漂移）。
3. 消息区：复用 ai-elements（Conversation/Message）+ 打字机效果；assistant 失败行显示重试按钮；空态引导语。
4. 输入区：复用 playground 输入/发送交互模式；发送中禁用 + 停止生成按钮；Enter 发送 / Shift+Enter 换行。

进入页流程：`GET /chat/meta` 拿会话信息（无则展示「开始对话」空态，首条消息即建会话）；`GET /chat/messages` 加载历史并重放视觉（回退到最后一条有 pose 的 assistant 或阶段默认）。

入口调整：gallery 已解锁卡与 detail 的「进入剧情」走 StoryPlayer（不改）；StoryPlayer ended 增加「继续对话」；detail「与角色对话」按钮从 playground 改为跳转 `/character/$modelName/chat`。

## 12. 错误处理与边界

- 解锁未满足：`POST /chat` 前置 403（沿用现状）。
- 上游错误：SSE 错误流透传（沿用现状）；网络失败透传 502。
- tee 聚合失败/中断：已收到的部分若可解析则尽力落库 assistant；解析失败落原文。
- 摘要失败 / 好感护栏丢弃：静默，不影响主流程与响应。
- 并发：单线会话由 `user_id+model_name` 唯一键 + 应用层防并发（同一用户同时两条请求时按创建时间排队/拒绝后到者，见实现细节——允许「返回 429 请稍后再试」的简单策略）。
- JSON 越界/非法 pose/background：前端忽略并维持当前视觉。

## 13. 测试策略

- 后端单测（model/controller）：
  - 会话幂等创建与单主线约束；消息落库与分页。
  - prompt 组装（含 summary/initial_context/窗口裁剪边界）。
  - 全文解析拆分（reply/pose/effect/background/delta；坏 JSON 兜底原文）。
  - 好感限幅（±3 clamp、小时护栏、0-100 封顶）。
  - 摘要触发阈值与失败静默。
  - 解锁前置 403 回归不破坏。
- 前端：对话页解析器单测（合法 JSON / 围栏 / 前言后语 / 坏 JSON）；类型检查。
- 端到端手工：小剧场 → 继续 → 对话（AI 输出切姿态/背景）→ 好感变化 → 关闭重进续谈 → 长对话触发摘要后角色仍记得早期事件。

## 14. 风险与开放点

- **AI JSON 稳定性**：纯 prompt 约束输出 JSON 在弱模型上可能偶发格式漂移；靠容错解析 + 兜底原文保证不中断。若后续确有模型支持 JSON mode 可低成本启用（改组装参数）。
- **摘要计费**：摘要调用计入用户会话上游消耗，需在 UI 说明或在文档记录（默认接受）。
- **非 OpenAI 兼容渠道**：沿用现有 /pg OpenAI 兼容协议，聚合按 content 字段提取，非标准流格式无法聚合时降级为「仅落 user、assistant 落原文尝试」。

## 15. 交付顺序（实现计划拆任务依据）

1. 后端数据层：两张新表 + AutoMigrate + 会话幂等 CRUD。
2. 后端会话驱动改造：POST /chat 组装/落库/tee 聚合/解析拆分。
3. 摘要机制与好感限幅落库。
4. 新端点 meta / messages。
5. 前端对话页（场景区/消息区/输入区 + 解析器）。
6. StoryPlayer「继续对话」衔接 + detail 入口切换。
7. i18n 7 语言新 key。
8. 回归与端到端验证。
