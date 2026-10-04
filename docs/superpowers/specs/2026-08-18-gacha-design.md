# 抽卡（Gacha）功能设计

- 日期：2026-08-18（2026-10-04 修订：产出物由「卡片 + 独立令牌」改为「受限订阅」）
- 仓库：e:\new-api（QuantumNous/new-api fork）
- 状态：设计已确认（方案 A：抽卡直接发放 `UserSubscription`）
- 参考实现：https://github.com/Animnia/TokenGacha（抽卡交互、保底、稀有度分档）

## 1. 背景与目标

在 new-api 中转站中加入"抽卡"玩法：用户可以用钱包余额（quota）购买不同价格的卡包（青铜盲盒 / 白银盲盒 / 王者盲盒等），抽到**绑定模型范围 + 分组 + 额度 + 有效期**的订阅权益，用自己的普通令牌即可消费（走已有订阅抵扣与计价系统），运营商可自定义用户回报率并保证自身不亏。

目标：
1. 用户侧：抽卡页（高级翻卡动画 + 音效）、我的抽卡权益页、模型广场稀有度展示。
2. 经济侧：卡包价格由运营者配置，系统实时测算"期望回报率 / 期望成本"，保证运营者不亏（期望成本 < 价格）。
3. 权益侧：抽到的权益复用订阅链路，**不再需要专属令牌或请求头**；订阅新增模型范围维度，只有范围内的模型可消耗该订阅额度。
4. 分级侧：模型元数据增加 N / R / SR / SSR / UR 稀有度分级，支持从 DeepSWE 公开榜单自动同步 + 管理端手动覆盖，展示到模型广场卡片。

### 2026-10-04 修订要点（替代原卡片方案）

原方案抽到的是 `UserGachaCard`（模型 + 分组 + 额度），必须通过独立 `GachaCardToken` 令牌或 `New-Api-Card` 请求头才能消费，而完整令牌只在抽卡瞬间显示一次、之后只有掩码且没有重置入口。功能从未上线，因此直接废弃卡片与令牌机制，不保留双轨：

- 抽到的权益改为 `UserSubscription`（`plan_id = 0`、`source = gacha`），额度与有效期直接落在订阅上。
- `SubscriptionPlan` / `UserSubscription` 新增 `usable_models` 维度，与既有 `usable_groups` 完全同构（空 = 不限制）。
- 相同模型范围 + 相同分组的抽卡权益自动叠加到同一张订阅（额度相加、到期取更晚、累计抽中次数 +1）。
- 累计抽中次数驱动合并徽标：1-2 ⭐ / 3-5 🌙 / 6+ ☀️（保留原多卡合并的等级展示特色）。
- 抽卡权益额度用完后**回退钱包余额**，与普通订阅一致（抽卡本质是变相加余额，稀有度只影响抽取概率）。
- `user_gacha_cards`、`gacha_card_tokens`、`GachaCardFunding`、`New-Api-Card` 头及其认证中间件一并删除。

### 产品决策（用户已确认）

- 购买货币：**钱包余额 quota**（复用现有扣费体系），展示时按现有 currency 配置换算为法币（￥/$，与其余页面一致）。
- 卡的使用凭证：**卡库 + 资金来源**（每张卡是独立的资金源，锁定模型 + 分组 + 额度 + 有效期；非"每卡一个专属令牌"）。
- 模型分级数据源：**DeepSWE 自动同步 + 管理端手动覆盖**。
- 保底机制：**可配置保底**（每个卡池独立配置：保底抽数、保底档位、十连软保底，可关闭）。
- 卡的额度单位：quota（与余额一致）。
- 卡支持过期：运营者在卡条目上配置过期天数（0 = 永久）。
- 抽卡前端：**高级版**翻卡动画 + 粒子特效 + 高级音效（参考 TokenGacha，音效用 Web Audio API 程序化合成，零外部资源）。

## 2. 总体架构

```
                    用户钱包 quota
                        │ 购买卡包（扣费，LogTypeGacha）
                        ▼
             卡池（青铜/白银/王者）── 抽卡（概率 + 保底 + 幂等）
                        │ 事务内发放 / 叠加订阅
                        ▼
        UserSubscription（source=gacha, plan_id=0）
             usable_models（模型范围）+ usable_groups（分组）
             amount_total / end_time / merge_count（合并徽标）
                        │
                用户自己的普通 API 令牌
                        │ 订阅抵扣：模型 ∈ usable_models 且分组 ∈ usable_groups
                        ▼
        BillingSession ── SubscriptionFunding（既有资金源，不新增）
                        │ 预扣 → 上游请求 → 结算/退款
                        ▼
   消费日志（Other.subscription_id）→ 抽卡来源消耗不计重复收入
```

关键原则：
- 抽卡扣费、发放订阅、保底计数、流水写入在**同一事务**内完成，`pull_id` 做幂等键。
- 抽卡权益**不新增资金源**，完全走既有 `SubscriptionFunding` 的预扣 / 结算 / 退款链路。
- 不带任何特殊请求头：用户用原有令牌即可消费抽到的额度，未订阅模型自动落到钱包或其它订阅。
- 会计口径：卡包购买收入计入"抽卡收入"独立收入项；抽卡来源订阅的消耗不计重复收入（钱在买卡时已收）、只计成本与用量。

## 3. 数据模型

### 3.1 Model 表新增列（model/model_meta.go）

```go
Rating       string  `json:"rating,omitempty" gorm:"size:16;default:''"`        // 稀有度档位 N / R / SR / SSR / UR，空 = 未分级
RatingScore  float64 `json:"rating_score,omitempty" gorm:"default:0"`           // DeepSWE Pass@1 分数
RatingSource string  `json:"rating_source,omitempty" gorm:"size:32;default:''"` // 来源：deepswe / manual
```

- `RatingSource = manual` 的模型，DeepSWE 同步任务**不覆盖**。
- 由 `DB.AutoMigrate(&Model{})` 自动迁移（MySQL / SQLite / PostgreSQL），与 cost_quota 的 ClickHouse 问题无关（这是主库）。

### 3.2 gacha_pools 表（GachaPool）

```go
type GachaPool struct {
	Id           int            `json:"id" gorm:"primaryKey"`
	Name         string         `json:"name" gorm:"size:64;not null"`   // 如"青铜盲盒"
	Description  string         `json:"description" gorm:"type:text"`
	Price        int64          `json:"price" gorm:"not null"`          // 单抽价格（quota）
	TenPrice     int64          `json:"ten_price" gorm:"default:0"`     // 十连价格（quota），0 = 不提供十连
	Enabled      bool           `json:"enabled" gorm:"default:true"`
	SortOrder    int            `json:"sort_order" gorm:"default:0"`
	PityEnabled  bool           `json:"pity_enabled" gorm:"default:false"` // 是否启用硬保底
	PityMax      int            `json:"pity_max" gorm:"default:0"`         // 硬保底抽数（如 50）
	PityRarity   string         `json:"pity_rarity" gorm:"size:16"`        // 保底必出档位（如 SSR）
	PityUprate   float64        `json:"pity_uprate" gorm:"default:0"`      // 保底时升级到 UR 的概率（0~1）
	TenGuarantee string         `json:"ten_guarantee" gorm:"size:16"`      // 十连软保底档位（如 SR），空 = 无
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### 3.3 gacha_card_entries 表（GachaCardEntry）— 卡池条目

```go
type GachaCardEntry struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	PoolId     int    `json:"pool_id" gorm:"index;not null"`
	Models     string `json:"models" gorm:"type:text;not null"`   // 模型范围，逗号分隔；须全部在模型配置中且该分组下有启用渠道
	Group      string `json:"group" gorm:"size:64;not null"`      // 绑定分组（须存在分组倍率配置），发放为订阅 usable_groups
	Weight     int    `json:"weight" gorm:"not null"`             // 概率权重（池内相对权重，同一档位多条叠加即该档概率）
	Quota      int64  `json:"quota" gorm:"not null"`              // 订阅额度（quota）
	ExpireDays int    `json:"expire_days" gorm:"default:0"`       // 有效期天数，0 = 永久
}
```

一条条目 = 一种可抽到的权益（模型范围 + 分组 + 额度 + 有效期）。模型范围可只填一个模型，也可填一组模型（如"GPT-5 全家桶"），发放后成为该范围的专属订阅。同一模型范围 + 同一分组只会存在一张抽卡订阅，重复抽中自动叠加。

### 3.4 user_subscriptions 表新增字段 — 抽卡权益落在订阅上

原 `user_gacha_cards` 表整体废弃（功能未上线，无历史数据需要迁移），抽卡权益直接落在既有订阅表：

```go
// UserSubscription 新增
UsableModels []string `json:"usable_models" gorm:"type:text;serializer:json"` // 模型范围（空 = 任意模型）
MergeCount   int      `json:"merge_count" gorm:"not null;default:1"`          // 累计抽中次数，驱动 ⭐/🌙/☀️ 徽标
```

- `plan_id = 0`：抽卡权益没有对应套餐计划，因此不参与额度重置周期（`QuotaResetPeriod` 是套餐属性）。
- `source = "gacha"`：与 `order` / `admin` 区分，用于权益页筛选、展示与利润聚合口径。
- `allow_wallet_overflow = true`：额度用完后回退钱包（抽卡本质是变相加余额）。
- `usable_groups` 复用条目上的 `group`，语义与既有分组限制完全一致。
- 合并徽标阈值（前端展示映射）：`merge_count` 1-2 ⭐ / 3-5 🌙 / 6+ ☀️。

`SubscriptionPlan` 同步新增 `usable_models`，让运营购买的套餐也能限定模型范围（本期可选，默认空 = 不限制）。

### 3.5 gacha_pull_records 表（GachaPullRecord）— 抽卡流水

```go
type GachaPullRecord struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	PullId      string `json:"pull_id" gorm:"size:64;uniqueIndex;not null"` // 幂等键（客户端 UUID）
	UserId      int    `json:"user_id" gorm:"index;not null"`
	PoolId      int    `json:"pool_id" gorm:"index;not null"`
	Count       int    `json:"count" gorm:"not null"`          // 1 或 10
	Cost        int64  `json:"cost" gorm:"not null"`           // 消耗 quota
	Cards       string `json:"cards" gorm:"type:text"`         // 抽中权益快照 JSON（subscription_id/models/group/quota/rarity/merge_count）
	PityBefore  int    `json:"pity_before" gorm:"default:0"`
	PityAfter   int    `json:"pity_after" gorm:"default:0"`
	Status      int    `json:"status" gorm:"default:0"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
}
```

### 3.6 users 表新增保底计数

`model/user.go` 的 `User` 结构体新增：

```go
GachaPity string `json:"gacha_pity,omitempty" gorm:"type:text"` // JSON: {"<poolId>": 当前保底计数}
```

保底计数放用户行，抽卡事务内 `SELECT ... FOR UPDATE` 锁用户行即可保证并发安全（抽卡为低频操作，行锁足够）。

### 3.7 logs 表

- 新增日志类型常量：`LogTypeGacha = 8`（卡包购买 / 抽卡）。
- 抽卡权益的调用消费日志**不新增列**：沿用订阅既有的 `Other.subscription_id / subscription_plan_title` 等字段，另记 `gacha_source: true` 供利润聚合区分。
  - 理由：`logs` 表支持 ClickHouse 独立库，加列需同步处理 ClickHouse 迁移（此前 cost_quota 已踩过 `type "double" does not exist` 的坑）；`Other` JSON 已存在且快照语义一致，成本最低。

## 4. 经济模型

### 4.1 术语

- 卡条目 i：模型 m_i、分组 g_i、权重 w_i、额度 q_i（quota）。
- 条目概率 p_i = w_i / Σw（池内按权重归一）。
- 单抽期望价值 `E_value = Σ p_i × q_i`（用户拿到即可在该模型 + 分组消费的权益，单位 quota）。
- 实际回报率 `RTP = E_value / Price`（Price 为单抽价格）。
- 期望成本 `E_cost = Σ p_i × q_i × unit_cost(m_i, g_i)`，其中 `unit_cost` = 该模型在该分组下的单位成本（quota 成本比率），取自渠道成本系统（ChannelCostSettings 的模型成本价格表推算；无成本数据的模型标记"成本未知"，不计入汇总并提示）。
- 运营者毛利 = Price − E_cost（保底会抬升实际成本，见 4.3）。

### 4.2 管理端测算面板

卡池编辑页实时显示（后端计算返回）：
1. **期望价值**：`E_value`（quota 展示 + 换算法币，复用前端 `formatQuotaWithCurrency`）。
2. **预估回报率**：`E_value / Price × 100%`。
3. **预估成本**：`E_cost` 与 **价格 − 期望成本** 差值。
4. **告警**：当 `E_cost >= Price` 或存在"成本未知"条目权重占比过高时，红色告警"该卡池可能亏损"。
5. **含保底修正**：启用硬保底时按 4.3 的近似法修正 `E_value` 与 `E_cost`，显示"含保底预估回报率"。

运营者通过调整价格 / 条目权重 / 额度即可"自定义用户回报率"，同时系统提示保证不亏。

### 4.3 保底对期望的影响（近似估算）

硬保底（每 PityMax 抽必出 ≥ PityRarity 档）会提升长期期望概率。采用保守近似：保底档（及更高档）的有效概率下界 ≈ `1/PityMax`，其余档位按原比例归一；十连软保底类似（必出 ≥ TenGuarantee 档使每十连至少一张该档以上）。系统用修正后的概率计算"含保底期望价值 / 成本"，运营者可据此把价格定在安全线以上。

### 4.4 会计口径（利润分析）

```
卡包购买（LogTypeGacha）：quota = 卡包价格   → 计入"抽卡收入"（收入侧新增项）
卡调用  （LogTypeConsume + Other.gacha_card_id）：
    quota = 卡内消耗额度 → 从"调用收入"聚合中排除（钱已在买卡时收过，避免重复计收入）
    cost_quota = 真实上游成本 → 照常计入"调用成本"
普通调用（LogTypeConsume 无 gacha 标识）：行为不变

总利润 = 调用收入 + 抽卡收入 − 调用成本 − 充值让利
```

长期看：抽卡收入 ≈ 所有卡包实收，调用成本 ≈ 所有卡的实际消耗，利润 = 卡包实收 − 卡实际消耗成本，符合"保证不亏"目标。需要调整利润聚合查询（`model/channel_cost.go` 的聚合 SQL）：排除带 gacha 标识消费日志的 quota 计入收入，并新增 LogTypeGacha 收入项。

## 5. 抽卡逻辑

### 5.1 概率抽取

按条目权重累计随机（参考 TokenGacha 的权重区间累加法，但直接落到条目粒度）：

```go
// pool 有效条目按权重累计
func drawEntry(entries []GachaCardEntry) GachaCardEntry {
	r := rand.Float64() * totalWeight
	for _, e := range entries {
		r -= float64(e.Weight)
		if r < 0 { return e }
	}
	return entries[len(entries)-1]
}
```

管理端展示各档位聚合概率（Σ 同一 rating 条目的 p_i）作为参考。

### 5.2 保底（可配置，每池独立）

- **硬保底**：若 `PityEnabled && PityMax > 0`，当该池连续抽 PityMax−1 次未出 ≥ PityRarity 档时，第 PityMax 抽强制从 ≥ PityRarity 档条目中抽取；其中以 `PityUprate` 概率升级为从 UR 档条目抽取。抽出 ≥ PityRarity 档后保底计数清零，否则 +1（参考 TokenGacha：50 抽保底，20% UR / 80% SSR）。
- **十连软保底**：若 `TenGuarantee` 非空，十连中全部低于该档时，最后一张替换为 ≥ TenGuarantee 档的随机条目（替换后不改变保底计数，与 TokenGacha 一致）。
- 保底计数按 `(用户, 卡池)` 独立存储（users.gacha_pity JSON）。

### 5.3 抽卡接口流程（事务 + 幂等）

```
POST /api/gacha/pool/:id/pull  { "count": 1|10, "pull_id": "<uuid>" }

1. 若 pull_id 已存在（幂等表命中）→ 直接返回上次结果。
2. 校验：池启用、count 合法、价格存在（十连价格 0 时禁止 count=10）。
3. 事务：
   a. SELECT 用户行 FOR UPDATE（锁 pity 计数 + 后续余额扣减）
   b. 校验钱包余额 ≥ cost（单抽 Price / 十连 TenPrice）
   c. 生成 count 份权益（5.1 + 5.2 保底逻辑），逐份发放或叠加到抽卡订阅（见 5.4）
   d. 更新 users.gacha_pity
   e. 扣费：model.DecreaseUserQuota(userId, cost, false)
   f. 写 gacha_pull_records（含 PityBefore/After）+ LogTypeGacha 日志（quota=cost）
4. 提交；返回抽卡结果（每份权益：subscription_id/models/group/quota/rarity/expire/merge_count）。
```

幂等：`gacha_pull_records.pull_id` 唯一索引。客户端生成 UUID，网络重试重发相同 pull_id 时服务端直接返回原结果，不重复扣费。

### 5.4 权益发放与自动叠加

同一事务内，对每份抽中的权益执行"发放或叠加"：

```
grantGachaSubscriptionTx(tx, userId, entry):
  models = 归一化(entry.Models)          // 去空白、去重、排序，作为合并键的一部分
  quota  = EntryDrawQuota(entry)          // 支持区间随机
  now    = 当前时间
  end    = entry.ExpireDays > 0 ? now + ExpireDays*86400 : 极大值（永久）

  目标行 = tx.Where("user_id = ? AND source = 'gacha' AND status = 'active' AND end_time > ?
                      AND usable_models = ? AND usable_groups = ?", ...)  // 归一化后的规范形式
  if 命中:
      AmountTotal += quota
      EndTime     = max(EndTime, end)   // 有效期取更晚，额度不因叠加而提前过期
      MergeCount += 1
  else:
      新建 UserSubscription{ PlanId: 0, Source: "gacha", UsableModels: models,
                             UsableGroups: [entry.Group], AmountTotal: quota,
                             StartTime: now, EndTime: end, MergeCount: 1,
                             AllowWalletOverflow: true }
```

- 合并键 = （用户, 归一化模型集合, 归一化分组集合, source=gacha, 未过期）。模型集合不同绝不合并，避免"GPT 全家桶"和"Claude 套件"混在一张权益里。
- 归一化必须稳定（排序 + 去空白），否则 `['a','b']` 与 `['b','a']` 会分裂成两张权益。
- 已耗尽（`AmountUsed >= AmountTotal`）或已过期的订阅不参与叠加，改为新建一张，避免把已用完的额度"复活"。
- `SELECT ... FOR UPDATE` 锁命中的订阅行，保证并发抽卡不会把两份额度叠加丢一份。

## 6. 抽卡权益的使用（订阅抵扣 + 模型范围）

### 6.1 调用方式

抽到的权益就是一张普通订阅，用户用**自己已有的 API 令牌**直接调用即可，不需要任何特殊请求头、专属令牌或分组切换。

### 6.2 模型范围校验

1. `SubscriptionUsableModelsAllow(usableModels, model)`：空列表 = 不限制；非空 = 请求模型必须在列表内（与 `SubscriptionUsableGroupsAllow` 同构）。
2. `PreConsumeUserSubscription(requestId, userId, group, model, quotaType, amount)` 增加 `model` 参数，候选过滤顺序：状态/有效期 → 分组匹配 → **模型匹配** → 额度是否够 → 扣减。
3. `HasActiveUserSubscription` / `UserActiveSubscriptionsAllowWalletOverflow` / `activeUserSubscriptionsForGroup` 同步接受模型参数，否则会出现"该模型不可用却判定有订阅"的错判，导致本该回退钱包的请求被拒。
4. 匹配不到任何订阅时按既有逻辑回退钱包（`allow_wallet_overflow = true`），抽卡权益不改变这一行为。

### 6.3 无 plan 的抽卡订阅

`PreConsumeUserSubscription` 现有实现会对每个候选订阅 `getSubscriptionPlanByIdTx(sub.PlanId)`，而 `plan_id <= 0` 直接返回 `invalid plan id`。抽卡订阅 `plan_id = 0`，因此：

- 载入 plan 失败且 `sub.PlanId <= 0` 时跳过额度重置（`maybeResetUserSubscriptionWithPlanTx`），其余流程不变。
- 这是本方案对订阅抵扣链路的**唯一**行为改动，其余预扣 / 结算 / 退款 / 额度提醒全部复用既有实现。

### 6.4 权限说明（分组解锁）

抽卡条目上的 `group` 映射为订阅的 `usable_groups`，语义与购买套餐的分组限制一致：用户对**该分组内、且在模型范围内**的模型可用抽卡权益抵扣额度，不因抽卡获得任何额外的分组权限或令牌权限。

## 7. 模型分级（DeepSWE 同步）

### 7.1 同步任务

- 定时任务（每日，可手动触发）拉取 `https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json`。
- 取每个模型 best-per-model 行的 Pass@1 分数。
- 模型名匹配（精确 → 前缀 / 包含 → 管理端手动映射表），匹配成功且 `RatingSource != manual` 的模型：写入 `RatingScore` 并按阈值计算 `Rating`，`RatingSource = "deepswe"`。
- 同步失败不阻塞其他功能，仅记录日志；管理端显示"上次同步时间 / 成功数 / 失败数"。

### 7.2 档位阈值（全局可配置）

系统设置新增 `GachaRatingThresholds`（默认值参考 TokenGacha 的 Artificial Analysis 分档比例，映射到 DeepSWE 分数）：

```
UR  ≥ 65   （深粉 #ec4899）
SSR 55–65  （金   #f59e0b）
SR  45–55  （紫   #9333ea）
R   30–45  （蓝   #3b82f6）
N   < 30   （灰   #94a3b8）
```

阈值可在管理端调整，调整后重算所有 `RatingSource = deepswe` 的模型。

### 7.3 手动覆盖

管理端模型分级页可对任意模型设置档位 / 分数，保存后 `RatingSource = "manual"`，同步任务跳过。

### 7.4 展示

- `GET /api/pricing` 的模型数据追加 `rating / rating_score`（未分级模型不返回或返回空）。
- 模型广场卡片右上角稀有度角标（颜色如上）；模型详情页显示 DeepSWE 分数。
- 分级同步 / 覆盖后需刷新定价缓存（复用 `RefreshPricing`）。

## 8. 后端 API

用户端：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gacha/pools` | 卡池列表（含价格、概率公示、保底说明、期望价值展示） |
| GET | `/api/gacha/pool/:id` | 卡池详情（条目预览、概率公示） |
| POST | `/api/gacha/pool/:id/pull` | 抽卡 `{count, pull_id}` |
| GET | `/api/gacha/pool/:id/pull` 结果内 | 抽卡结果（每份含 subscription_id/models/group/quota/rarity/expire/merge_count/badge） |
| GET | `/api/gacha/entitlements` | 我的抽卡权益（source=gacha 的订阅：模型范围 / 分组 / 剩余额度 / 到期 / 合并徽标），支持分页与状态筛选 |
| GET | `/api/gacha/stats` | 我的抽卡统计（总抽数、各档出货、总花费） |

管理端（`/api/gacha/admin/*`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/gacha/admin/pools` | 卡池列表 / 新建 |
| PUT/DELETE | `/api/gacha/admin/pools/:id` | 编辑 / 删除 |
| GET/POST/PUT/DELETE | `/api/gacha/admin/pools/:id/entries` | 条目 CRUD（模型多选 + 分组 + 权重 + 额度 + 有效期） |
| GET | `/api/gacha/admin/pools/:id/economics` | 经济测算（期望价值/回报率/期望成本/保底修正/告警） |
| POST | `/api/gacha/admin/sync-rating` | 手动触发 DeepSWE 同步 |
| GET | `/api/gacha/admin/ratings` | 模型分级列表（含未分级、同步状态） |
| PUT | `/api/gacha/admin/ratings/:modelId` | 手动设置 / 覆盖分级 |
| PUT | `/api/gacha/admin/settings` | 档位阈值等全局设置 |

## 9. 前端页面

用户侧：

- `/gacha` 抽卡页：
  - 卡池选择区（名称、价格、概率公示弹窗、保底说明、期望价值）。
  - 单抽 / 十连按钮，余额展示（`formatCurrencyFromUSD`）。
  - **高级抽卡动画**（参考 TokenGacha `llm-gacha.html`）：3D 翻卡（`perspective` + `rotateY` + 弹性曲线 + `.pop` 弹跳）、SSR 金色 / UR 粉色流光（`urGlow`）、canvas 全屏粒子爆发、金币飞向余额（`element.animate` 抛物线 + 落点 burst）、屏幕震动。JS 文件拆分，不改主路由页结构。
  - **高级音效**：Web Audio API 程序化合成（零外部资源）：抽卡前奏鼓点、单卡翻转音、十连连翻、SR 金色琶音、SSR 号角、UR 流星坠落、扣款/入账金币声；右上角音效开关（localStorage 记忆）。
- `/gacha/entitlements` 我的权益页（原卡库页）：按权益展示模型范围（多模型折叠为 "+N"）、分组 badge、剩余额度（quota→法币）、到期时间与合并徽标（⭐/🌙/☀️ + "已合并 N 次"）。顶部一句话说明"用你自己的 API 令牌直接调用，额度自动抵扣"，不再展示任何令牌或请求头用法。
- 抽中结果卡：模型范围 + 分组 + 额度 + 到期 + 合并徽标；若本次叠加到已有权益，显示"已合并到现有权益（累计 N 次）"而不是新卡。
- 订阅页（`/subscription` 等既有页面）：模型范围非空的订阅显示"仅限：模型 A / B / C"标签，与分组限制并列。
- 模型广场（`/pricing`）：卡片稀有度角标；模型详情页 DeepSWE 分数展示。

管理端：

- `/admin/gacha` 卡池管理：池 CRUD（价格 / 十连价 / 保底配置 / 启用）；条目管理（**模型多选** + 分组 + 权重 + 额度 + 过期天数，保存时校验每个模型在绑定分组下有启用渠道）；经济测算面板（期望价值 / 回报率 / 期望成本 / 告警）。
- `/admin/gacha/ratings` 模型分级：分级列表（模型名 / DeepSWE 分数 / 档位 / 来源），手动覆盖，同步按钮与状态。

## 10. 风控与并发

1. **抽卡幂等**：`pull_id` 唯一索引，重试返回原结果，防重复扣费 / 重复发放。
2. **抽卡事务**：用户行 `FOR UPDATE` 串行化同用户的并发抽卡，保证保底计数、权益叠加与余额扣减原子。
3. **叠加并发**：命中已有权益时对该行 `FOR UPDATE` 后再累加，避免两笔并发抽卡互相覆盖额度。
4. **过期清理**：沿用订阅的 `ExpireDueSubscriptions` 定时任务，抽卡权益无需独立清理器。
5. **条目合法性校验**：创建/编辑条目时校验模型列表非空、每个模型存在、分组存在分组倍率、每个模型在该分组有启用渠道，否则拒绝保存（避免抽到废权益）。
6. **权益边界**：模型范围与分组限制叠加生效，模型不在范围内时该权益不参与抵扣，自然落到钱包或其它订阅；审计通过 `Other.subscription_id` 可溯源。
7. **经济安全**：管理端实时测算与告警；保底抬高的成本纳入"含保底回报率"展示。
8. **促销 / 免费额度**：抽卡消费与普通消费一致，直接从钱包 quota 扣除。是否允许免费赠送 / 邀请奖励等"白嫖"额度用于抽卡，由运营者通过现有余额发放机制自行控制，本期不单独做余额冻结。

## 11. 测试计划

- 单元测试：
  - 概率分布：大样本抽取频率与配置权重偏差 < 1%；各档位聚合概率正确。
  - 保底：连续 PityMax−1 次不出 ≥ PityRarity 档后必出；PityUprate 升级；出高档次后计数清零；十连软保底替换逻辑。
  - 经济计算：`E_value / E_cost / 含保底修正回报率` 公式单测。
  - 档位映射：DeepSWE 分数 → 档位阈值边界（含临界值）与手动覆盖优先级。
  - 模型范围：`SubscriptionUsableModelsAllow` 的空列表 / 命中 / 未命中三态。
- 集成测试：
  - 抽卡事务：并发抽卡（同用户）、`pull_id` 幂等重试、余额不足拒绝且无副作用。
  - 权益叠加：同范围叠加（额度相加、到期取更晚、merge_count+1）；不同模型集合不合并；已耗尽/已过期不叠加。
  - 订阅抵扣：范围内模型可扣、范围外模型跳过该订阅、`plan_id = 0` 不因缺 plan 报错、额度用尽回退钱包。
  - 回归：普通购买订阅（`plan_id > 0`）的预扣 / 重置 / 结算 / 退款行为完全不变；钱包计费不受影响。
- API 测试：用户 / 管理端全部接口的 happy path 与错误码。
- 前端：条目模型多选、抽中动画与徽标展示、权益列表"已合并 N 次"。
- 数据库：`user_subscriptions` 新增列与 `gacha_card_entries.models` 的迁移需在 SQLite / MySQL / PostgreSQL 三引擎上分别验证（含从旧结构升级）。

## 12. 实施阶段（2026-10-04 修订）

- **阶段 1：订阅的模型范围维度**。`SubscriptionPlan` / `UserSubscription` 新增 `usable_models`，`merge_count`；`SubscriptionUsableModelsAllow` 与抵扣链路的模型过滤；`plan_id = 0` 跳过额度重置；订阅查询接口与列表展示。
- **阶段 2：抽卡发放改为订阅**。条目 `model_name` → `models`（含校验与多选保存）；`PullGachaCards` 内发放 / 叠加事务；删除 `user_gacha_cards`、`gacha_card_tokens`、`GachaCardFunding`、`New-Api-Card` 头与其中间件、卡库接口、过期清理任务。
- **阶段 3：前端**。抽中结果改为权益展示（含叠加徽标）、我的权益页、订阅页模型范围标签、管理端条目模型多选。
- **阶段 4：验证与打磨**。三数据库迁移验证、订阅抵扣回归、利润聚合口径（抽卡来源消耗不计收入）、概率公示文案。

阶段 1 独立可交付（订阅支持模型范围），阶段 2 后抽卡闭环打通（抽到即用普通令牌消费），阶段 3 完成易用性收口。

## 13. 非目标（本期不做）

- 权益交易 / 转赠 / 出售。
- 独立"抽卡代币"体系（本期直接用钱包 quota）。
- 保底计数的精确马尔可夫求解（用保守近似即可）。
- 抽卡专属令牌与 `New-Api-Card` 请求头（已随卡片方案一并废弃删除，不是保留兼容）。
- 抽卡权益的额度重置周期（抽卡订阅无套餐计划，额度一次性发放、到期即止）。
