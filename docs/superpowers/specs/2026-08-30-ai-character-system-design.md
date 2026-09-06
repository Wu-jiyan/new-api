# AI 角色（Character）系统设计

- 日期：2026-08-30
- 仓库：e:\new-api（QuantumNous/new-api fork）
- 状态：待审阅

## 1. 背景与目标

在 new-api 中转站中加入"AI 角色"玩法：为平台接入的模型（deepseek、claude、gpt、glm 等）配置漫画立绘形象与 galgame 化的人设，作为营销、宣传、吸引留存的手段。

核心玩法闭环：

1. **立绘预生成**：管理端用内置工具调用 GPT Image 生成立绘（预先生成、静态存储，非实时），也可手动上传。
2. **调用即解锁**：用户真实调用某个模型，按累计 token 消耗分阶段解锁该模型的立绘与剧情（角色档案在模型广场卡片与详情页展示）。
3. **剧情互动**：解锁后可播放"小剧场"（预设剧本逐句播放），并可与角色直接对话（真实调用该模型 + 人设 prompt，正常计费）。

### 产品决策（用户已确认）

- 功能形态：**galgame 剧情互动**，与抽卡（gacha）系统完全解耦，不依赖抽卡。
- 展示位置：**模型广场（Pricing 页）模型卡片背景** + **独立角色详情页**。
- 解锁机制：**分阶段解锁（固定三阶段）**，条件基于**真实调用**。
- 统计口径：该用户对该模型**累计成功调用的 token 数**（input+output 总和），从现有 `QuotaData` 聚合表统计（公平：不同模型价格不同，不按 quota 计算）。
- 阶段①：首次成功调用 → 解锁基础立绘（卡片剪影变立绘）。
- 阶段②：累计 ≥ 10M tokens → 解锁第二形象 + 剧情第一章。
- 阶段③：累计 ≥ 50M tokens → 解锁最终形象 + 完整剧情。
- 阈值全局可配置（默认 10M / 50M），支持单模型覆盖。
- 剧情形式：**小剧场播放 + 真人对话**。
- 对话计费：消耗用户自己的额度，正常计费。
- 立绘来源：**内置 AI 生成立绘（GPT Image）+ 手动上传**。
- 未解锁呈现：**剪影**（角色轮廓 + 锁标签，暗示可解锁）。
- 实现路径：**独立角色模块**（独立数据表、独立路由、独立管理端页面，不污染现有 Model 表与 Pricing 页逻辑）。

## 2. 总体架构

```
                        ┌─────────────────────────────────────────────┐
                        │              管理端（管理员）                │
                        │  角色 CRUD / AI 生成立绘 / 立绘上传 / 剧本编辑 │
                        └──────────────────┬──────────────────────────┘
                                           │ gpt-image-1（走平台 relay）
                                           ▼
                     uploads/characters/{model}/{stage}.png（本地静态存储）
                                           │
                        ┌──────────────────┴──────────────────────────┐
                        │                   后端                       │
                        │  character / user_character_progress 表     │
                        │  解锁统计：QuotaData 聚合（token）            │
                        │  小剧场剧本（存角色表 JSON）                  │
                        │  对话：用户令牌 → relay → 真实模型 + 人设 prompt│
                        └──────────────────┬──────────────────────────┘
                                           │
        ┌──────────────────────────────────┼──────────────────────────────────┐
        │               前端               │                                    │
   Pricing 卡片（立绘背景/剪影）     角色详情页 /character/:modelName    角色管理页
        │                          （大立绘+阶段进度+小剧场+对话）               │
        └──────────────────────────────────┴──────────────────────────────────┘
```

关键原则：

- 角色配置与用户进度**独立成表**，Model 表只增加极少量关联所需字段（如需要）。
- 解锁统计**惰性刷新**：用户访问角色信息时，从 QuotaData 聚合一次，与已解锁阶段比较后更新进度表；配合短 TTL 内存缓存避免重复聚合。
- 立绘**预生成、静态存储**：无论 AI 生成还是手动上传，统一落盘到本地 `uploads/characters/`，数据库只存相对路径；不依赖第三方图床。
- 对话复用现有 relay 链路：角色对话 = 用户自己的 API 令牌 + 指定模型 + 前置人设 system prompt，计费与正常调用完全一致。
- 未解锁剧本/立绘在前端做 UX 限制（剪影、锁），图片 URL 使用不可枚举路径（含随机段），静态直出。

## 3. 数据模型

### 3.1 character 表（model/character.go）

每行 = 一个启用角色的模型。

```go
type Character struct {
    ID           int    `gorm:"primaryKey"`
    ModelName    string `gorm:"size:128;uniqueIndex;not null"` // 关联模型名
    DisplayName  string `gorm:"size:64"`                       // 角色名
    Title        string `gorm:"size:128"`                      // 称号（如"深境观测者"）
    Description  string `gorm:"type:text"`                     // 人设介绍
    Tags         string `gorm:"type:text"`                     // 标签，逗号分隔（推理系/中文原生…）
    SystemPrompt string `gorm:"type:text"`                     // 对话人设 prompt
    StagesJSON   string `gorm:"type:text"`                     // 三阶段配置（立绘/解锁条件/剧本）
    Enabled      bool   `gorm:"default:true"`
    CreatedAt    int64
    UpdatedAt    int64
}
```

`StagesJSON` 结构（固定三阶段）：

```json
{
  "stages": [
    {
      "index": 0,
      "name": "初遇",
      "image_url": "/uploads/characters/deepseek-v3/0/abc123.png",
      "unlock_tokens": 0,
      "unlock_text": "首次调用该模型即可解锁基础立绘",
      "script": [
        { "speaker": "DeepSeek", "text": "我一直在等一个愿意拨开迷雾的人。", "pose": "default" }
      ]
    },
    {
      "index": 1,
      "name": "同行",
      "image_url": "/uploads/characters/deepseek-v3/1/def456.png",
      "unlock_tokens": 10000000,
      "unlock_text": "累计消耗 10M tokens 解锁第二形象与剧情",
      "script": [ ]
    },
    {
      "index": 2,
      "name": "羁绊",
      "image_url": "/uploads/characters/deepseek-v3/2/ghi789.png",
      "unlock_tokens": 50000000,
      "unlock_text": "累计消耗 50M tokens 解锁最终形象与完整剧情",
      "script": [ ]
    }
  ]
}
```

- 阶段① `unlock_tokens: 0` 表示首次成功调用即解锁（语义上 unlock_tokens=0）。
- `script` 为小剧场剧本数组，逐句播放；一期每句固定立绘 + 打字机文字，`pose` 字段预留二期表情/多图切换。
- 每阶段解锁条件以 `unlock_tokens`（token 阈值）为准；若该模型为 0 阶段解锁（仅阶段①），后端判定首次调用成功后写入进度。

### 3.2 user_character_progress 表

每行 = 用户 × 模型 的解锁进度。

```go
type UserCharacterProgress struct {
    ID           int    `gorm:"primaryKey"`
    UserID       int    `gorm:"uniqueIndex:idx_ucp_user_model;not null"`
    ModelName    string `gorm:"size:128;uniqueIndex:idx_ucp_user_model;not null"`
    TotalTokens  int64  // 累计成功调用 token（input+output）
    TotalCalls   int64  // 累计成功调用次数
    MaxStage     int    // 已解锁最高阶段（0 = 基础立绘）
    LastUnlockAt int64
    UpdatedAt    int64
}
```

### 3.3 配置（Option 表新增 key）

- `character_stage_thresholds`（JSON）：`{"stage2_tokens": 10000000, "stage3_tokens": 50000000}`，全局默认阈值。
- `character_image_model`：AI 生成立绘使用的模型名，默认 `gpt-image-1`。
- `character_image_group`：AI 生成立绘使用的分组（走哪个渠道）。

## 4. 后端 API

### 4.1 管理端（middleware.AdminAuth）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/character/admin/characters` | 角色列表（含是否启用） |
| POST | `/api/character/admin/characters` | 创建角色（绑定 model_name） |
| PUT | `/api/character/admin/characters/:id` | 更新角色（人设/剧本/阈值覆盖） |
| DELETE | `/api/character/admin/characters/:id` | 删除角色 |
| POST | `/api/character/admin/characters/:id/stages/:index/generate` | **AI 生成立绘**：入参 prompt+风格，调用配置的 gpt-image-1 渠道生成，落盘并更新 image_url |
| POST | `/api/character/admin/characters/:id/stages/:index/image` | 手动上传立绘 |
| POST | `/api/character/admin/characters/:id/stages/:index/script` | 保存小剧场剧本 |
| PUT | `/api/character/admin/thresholds` | 更新全局阈值 |

AI 生成立绘流程：

1. 管理员输入人设/风格描述（可基于角色人设自动组装提示词，也可手写）。
2. 后端构造 `images/generations` 请求（`model` = `character_image_model`，`size` 竖版如 `1024x1536`），以管理员令牌走平台 relay 到配置分组。
3. 结果（b64_json 或 url）落盘到 `uploads/characters/{model}/{stage}/{rand}.png`。
4. 更新 `stages[index].image_url`，返回给前端预览；管理员可反复生成替换。

### 4.2 用户端（middleware.UserAuth）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/character/characters` | 启用角色列表（模型名、角色名、称号、当前用户解锁阶段） |
| GET | `/api/character/:modelName` | 角色详情：人设、标签、三阶段立绘与解锁状态（已解锁可见立绘，未解锁只返回"解锁条件文案"） |
| GET | `/api/character/:modelName/script/:stageIndex` | 小剧场剧本（未解锁该阶段返回 403） |
| POST | `/api/character/:modelName/chat` | 角色对话（SSE 流式）：用户令牌转发真实模型 + 人设 prompt，正常计费 |

### 4.3 解锁统计与判定（model/character_unlock.go）

- 新增聚合方法：按 `user_id + model_name` 从 `QuotaData` 汇总 `SUM(token_used)` 与 `SUM(count)`（复用现有 `QuotaData` 表的 `TokenUsed`、`Count` 字段）。
- 惰性刷新：用户访问角色列表/详情时，聚合一次 → 与 `UserCharacterProgress` 比较 → 若达到更高阶段则更新 `MaxStage` 并写入 `LastUnlockAt`。
- 阈值取 `character_stage_thresholds`（全局），角色表 `stages` 的 `unlock_tokens` 为最终生效值（管理端创建/编辑角色时默认填充全局阈值，可单模型覆盖）。
- 内存缓存：聚合结果缓存数分钟 TTL，降低 QuotaData 查询压力。

### 4.4 角色对话（controller/character.go）

- 请求：`{messages: [{role, content}...]}`。
- 后端校验：角色存在且启用、该用户已达到阶段①（解锁基础立绘）。
- 转发：以用户 Authorization 令牌为凭据，构造 `model = 角色.model_name` 的请求，在 messages 头部插入 `{role: "system", content: SystemPrompt}`，走平台 relay 链路（与用户正常调用同一计费路径），SSE 流式回传。
- 计费：完全复用现有 relay 计费，消耗用户自身额度。

## 5. 前端

### 5.1 Pricing 模型卡片（features/pricing/components/model-card.tsx）

- 卡片背景：若该模型有启用角色且用户已解锁阶段①，以立绘为背景（暗色渐变 + 右侧角色立绘，保留文字信息可读性）；未解锁显示**剪影**（人形剪影 + 「🔒 调用后解锁」标签）。
- 卡片操作区新增「角色档案」入口（有角色的模型），进入角色详情页 `/character/:modelName`。
- 点击卡片主体仍进入原有模型详情页（价格/性能信息不变）。

### 5.2 角色详情页（新路由 /character/:modelName）

- 大立绘（已解锁阶段最高形象；未解锁显示剪影 + 解锁条件文案）。
- 角色档案：角色名、称号、标签、人设介绍。
- 三阶段进度条：显示当前解锁阶段与下一阶段达成进度（已用 token / 目标 token）。
- 小剧场播放器：已解锁阶段可播放，立绘 + 打字机逐句文字 + 角色名，点击推进（galgame 文本框风格）。
- 「与角色对话」入口：进入 SSE 流式对话面板（消息列表 + 输入框，风格与平台一致）。

### 5.3 管理端（新路由 /_authenticated/system-settings/… 或运营模块）

- 角色列表 + 创建/编辑弹窗：选择模型、填角色名/称号/人设/标签/对话人设 prompt。
- 三阶段编辑器：每阶段——立绘区（AI 生成按钮 + 上传按钮 + 预览/重新生成）、解锁条件（默认全局阈值，可覆盖）、解锁文案、小剧场剧本编辑（逐句添加：说话人/台词/表情位）。
- 全局阈值设置。

### 5.4 路由与导航

- 前端路由按 TanStack file-based 新增：`/character/$modelName`（登录可见解锁状态）。
- 管理端侧边栏新增「角色管理」入口。

## 6. 图片存储

- 目录：`data/uploads/characters/{model_name}/{stage}/{rand}.png`（`rand` 为随机串，URL 不可枚举）。
- 后端提供静态路由 `/uploads/...` 直出图片（带长缓存头）。
- 数据库只存相对路径 `/uploads/characters/...`；前端拼全量 URL 展示。
- AI 生成结果与手动上传统一走同一落盘逻辑。

## 7. 分期交付

**一期（核心闭环）**
1. 数据模型：character / user_character_progress + 全局阈值配置。
2. 管理端：角色 CRUD、AI 生成立绘（gpt-image-1）、立绘上传、剧本编辑。
3. 图片存储与静态路由。
4. 解锁统计与判定（QuotaData 聚合 + 惰性刷新 + 缓存）。
5. 前端：Pricing 卡片立绘背景/剪影 + 角色入口；角色详情页（立绘/档案/阶段进度/小剧场）；管理端角色页。

**二期（互动与传播）**
1. 角色对话（SSE 流式转发 + 人设 prompt）。
2. 角色图鉴聚合页（我的收集进度）。
3. 分享卡片（解锁立绘生成分享图）。

## 8. 测试

- 后端单测：
  - 解锁判定：首次调用 / token 阈值边界（恰好等于、差 1 token）/ 全局阈值与单模型覆盖优先级。
  - QuotaData 聚合与进度表幂等更新。
  - 小剧场剧本接口权限：未解锁阶段返回 403。
  - AI 生成：mock 生图接口，验证落盘与 image_url 更新。
- 前端测试：
  - Pricing 卡片立绘/剪影渲染与解锁状态切换。
  - 角色详情页阶段进度与剧本播放器。
- 端到端：建角色 → 模拟调用 → 解锁 → 卡片变立绘 → 播放剧本。

## 9. 风险与对策

- **QuotaData 数据量**：惰性聚合 + 内存缓存（分钟级 TTL）；数据量大时可降级为定时预聚合任务。
- **生图成本**：AI 生成为管理端显式操作，一次一张，按需生成，避免浪费。
- **对话滥用**：对话走用户自身令牌计费，天然成本自担；角色对话仅对已解锁角色开放。
- **立绘可见性**：前端剪影限制 + 图片 URL 不可枚举；如需更强保护，二期可加静态路由鉴权。
