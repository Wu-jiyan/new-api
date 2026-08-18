# 抽卡（Gacha）功能设计

- 日期：2026-08-18
- 仓库：e:\new-api（QuantumNous/new-api fork）
- 状态：待审阅（用户确认核心产品决策，等待设计文档审阅）
- 参考实现：https://github.com/Animnia/TokenGacha（抽卡交互、保底、稀有度分档）

## 1. 背景与目标

在 new-api 中转站中加入"抽卡"玩法：用户可以用钱包余额（quota）购买不同价格的卡包（青铜盲盒 / 白银盲盒 / 王者盲盒等），抽到绑定**模型 + 分组 + 额度**的真实可用卡，用卡调用对应模型（走已有计价系统与成本系统），运营商可自定义用户回报率并保证自身不亏。

目标：
1. 用户侧：抽卡页（高级翻卡动画 + 音效）、卡库页、模型广场稀有度展示。
2. 经济侧：卡包价格由运营者配置，系统实时测算"期望回报率 / 期望成本"，保证运营者不亏（期望成本 < 价格）。
3. 凭证侧：抽到的卡是用户资产，调用 API 时通过请求头指定使用某张卡，后端校验"模型 + 分组"匹配后从卡额度扣费（新增资金来源，接入现有 BillingSession）。
4. 分级侧：模型元数据增加 N / R / SR / SSR / UR 稀有度分级，支持从 DeepSWE 公开榜单自动同步 + 管理端手动覆盖，展示到模型广场卡片。

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
                        │ 事务内发卡
                        ▼
             UserGachaCard 卡库（模型 + 分组 + 额度 + 有效期）
                        │
   用户令牌 + header `New-Api-Card: <card_id>`
                        │ 校验：卡归属 / 状态 / 有效期 / 模型匹配 / 分组匹配
                        ▼
        BillingSession ── GachaCardFunding（新资金源，实现 FundingSource）
                        │ 预扣 → 上游请求 → 结算/退款
                        ▼
   消费日志（Other.gacha_card_id）→ 利润聚合口径调整
```

关键原则：
- 抽卡扣费、发卡、保底计数、流水写入在**同一事务**内完成，`pull_id` 做幂等键。
- 卡扣费走 `FundingSource` 接口，复用 BillingSession 的预扣 / 结算 / 退款链路，与钱包、订阅并列。
- 未带 `New-Api-Card` 头的请求完全走现有逻辑，不改变现有计费行为。
- 会计口径：卡包购买收入计入"调用收入"之外的独立收入项；卡调用消费日志不计重复收入、只计成本与用量。

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
	ModelName  string `json:"model_name" gorm:"size:128;not null"` // 模型名（须在模型配置中且该分组下有启用渠道）
	Group      string `json:"group" gorm:"size:64;not null"`       // 绑定分组（须存在分组倍率配置）
	Weight     int    `json:"weight" gorm:"not null"`              // 概率权重（池内相对权重，同一档位多条叠加即该档概率）
	Quota      int64  `json:"quota" gorm:"not null"`               // 卡额度（quota）
	ExpireDays int    `json:"expire_days" gorm:"default:0"`        // 过期天数，0 = 永久
}
```

一条条目 = 一种可抽到的卡（模型 + 分组 + 额度）。同一模型可配置多条不同分组的条目（如"GPT-5.6 Sol × GPT Pro 分组"、"GPT-5.6 Sol × GPT Team 分组"）。

### 3.4 user_gacha_cards 表（UserGachaCard）— 用户卡库

```go
type UserGachaCard struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"index;not null"`
	PoolId       int    `json:"pool_id" gorm:"index"`
	PullRecordId int    `json:"pull_record_id" gorm:"index"`
	ModelName    string `json:"model_name" gorm:"size:128;not null;index"`
	Group        string `json:"group" gorm:"size:64;not null"`
	TotalQuota   int64  `json:"total_quota" gorm:"not null"` // 原始额度
	RemainQuota  int64  `json:"remain_quota" gorm:"not null"` // 剩余额度
	Status       int    `json:"status" gorm:"default:0"`      // 0 可用 / 1 已用完 / 2 已过期 / 3 已禁用
	ExpiredTime  int64  `json:"expired_time" gorm:"bigint"`   // 过期时间戳，-1 永久
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64  `json:"updated_time" gorm:"bigint"`
}
```

### 3.5 gacha_pull_records 表（GachaPullRecord）— 抽卡流水

```go
type GachaPullRecord struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	PullId      string `json:"pull_id" gorm:"size:64;uniqueIndex;not null"` // 幂等键（客户端 UUID）
	UserId      int    `json:"user_id" gorm:"index;not null"`
	PoolId      int    `json:"pool_id" gorm:"index;not null"`
	Count       int    `json:"count" gorm:"not null"`          // 1 或 10
	Cost        int64  `json:"cost" gorm:"not null"`           // 消耗 quota
	Cards       string `json:"cards" gorm:"type:text"`         // 抽到卡列表 JSON（card_id/model/group/quota/rarity）
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
- 卡调用消费日志**不新增列**，通过 `Other` JSON 快照记录审计字段：`{"gacha_card_id": 123, "gacha_model": "...", "gacha_group": "..."}`。
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
   c. 生成 count 张卡（5.1 + 5.2 保底逻辑），写 user_gacha_cards
   d. 更新 users.gacha_pity
   e. 扣费：model.DecreaseUserQuota(userId, cost, false)
   f. 写 gacha_pull_records（含 PityBefore/After）+ LogTypeGacha 日志（quota=cost）
4. 提交；返回抽卡结果（每张卡：card_id/model/group/rarity/icon/quota/expire）。
```

幂等：`gacha_pull_records.pull_id` 唯一索引。客户端生成 UUID，网络重试重发相同 pull_id 时服务端直接返回原结果，不重复扣费。

## 6. 卡的使用（GachaCardFunding）

### 6.1 请求协议

用户调用 API 时在请求头指定：

```
New-Api-Card: <card_id>
```

一次请求**只使用一张卡**（不支持多卡叠加）。未带该头 → 走原有钱包 / 订阅逻辑，完全兼容。

### 6.2 校验规则（鉴权后、计费前）

1. 卡属于当前用户，且 `Status = 0`（可用），未过期（`ExpiredTime == -1` 或 `> now`）。
2. `card.ModelName == 请求模型名`。
3. **请求分组以卡的 group 为准**：将 RelayInfo 的请求分组覆盖为 `card.Group`（token 分组仅需是用户的任意可用分组——鉴权阶段已校验；用户可能没有卡分组的 token，所以不能要求 token 分组等于卡分组）。
4. 校验模型在 `card.Group` 下存在启用渠道与分组倍率（确保可计费）。
5. 校验通过 → BillingSession 使用 GachaCardFunding；任一步失败 → 返回明确错误（"卡不可用 / 卡与请求模型或分组不匹配"），提示用户更换卡或移除请求头。

### 6.3 GachaCardFunding（service/funding_source.go 新增）

```go
type GachaCardFunding struct {
	cardId     int
	userId     int
	requestId  string
	preConsumed int64 // 预扣额度
}

func (f *GachaCardFunding) Source() string { return BillingSourceGachaCard } // "gacha_card"

func (f *GachaCardFunding) PreConsume(amount int) error {
	// SELECT ... FOR UPDATE 锁卡行 → 校验状态/过期/剩余额度 → 扣减 RemainQuota → 更新状态（用完置 1）
}

func (f *GachaCardFunding) Settle(delta int) error {
	// 正数补扣 / 负数退还卡额度；用完置 1
}

func (f *GachaCardFunding) Refund() error {
	// 退还预扣（带 requestId 幂等保护，参考 SubscriptionFunding.Refund 的事务退款模式）
}
```

- 预扣金额仍由现有 `ModelPriceHelperPerCall` 按（模型, 卡分组）计算，分组折扣生效，与用户正常调用扣费口径完全一致（**计价系统复用**）。
- 卡额度不足：预扣失败返回"卡余额不足"，不自动回退钱包（用户显式指定卡即期望用卡）。
- 消费日志：`Other` JSON 写入 `gacha_card_id / gacha_model / gacha_group`；`cost_quota` 照常计算。

### 6.4 权限说明（分组解锁）

抽到的卡绑定分组可能是用户平时不可用的分组（如 GPT Pro）。卡本身作为**该模型 + 该分组的临时授权凭证**，允许该用户仅对**卡内模型 + 卡内分组**发起调用。这是一个刻意的权限设计（抽卡解锁），但必须限定边界：
- 只有携带有效 `New-Api-Card` 头且卡归属当前用户才放行；
- 带卡时请求分组被覆盖为卡分组（类似订阅升级的临时分组，但范围更小：仅卡内模型 + 分组）；
- 模型以卡内为准，不允许通过改请求模型绕过卡的限制去调其他模型；
- token 鉴权仍走现有流程（状态 / 过期 / 归属 / 用户可用分组），分组覆盖发生在鉴权通过后、计费前。

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
| GET | `/api/gacha/cards` | 我的卡库（分页、状态/模型/分组筛选） |
| GET | `/api/gacha/cards/:id` | 卡详情 |
| GET | `/api/gacha/stats` | 我的抽卡统计（总抽数、各档出货、总花费） |

管理端（`/api/gacha/admin/*`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/gacha/admin/pools` | 卡池列表 / 新建 |
| PUT/DELETE | `/api/gacha/admin/pools/:id` | 编辑 / 删除 |
| GET/POST/PUT/DELETE | `/api/gacha/admin/pools/:id/entries` | 条目 CRUD |
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
- `/gacha/cards` 卡库页：卡片网格（模型图标 + 名称 + 分组 badge + 稀有度边框 + 剩余额度 quota→法币 + 过期时间），"如何用卡"提示（`New-Api-Card` 头示例），筛选 / 搜索。
- 模型广场（`/pricing`）：卡片稀有度角标；模型详情页 DeepSWE 分数展示。

管理端：

- `/admin/gacha` 卡池管理：池 CRUD（价格 / 十连价 / 保底配置 / 启用）；条目管理（模型 + 分组 + 权重 + 额度 + 过期天数）；经济测算面板（期望价值 / 回报率 / 期望成本 / 告警）。
- `/admin/gacha/ratings` 模型分级：分级列表（模型名 / DeepSWE 分数 / 档位 / 来源），手动覆盖，同步按钮与状态。

## 10. 风控与并发

1. **抽卡幂等**：`pull_id` 唯一索引，重试返回原结果，防重复扣费 / 重复发卡。
2. **抽卡事务**：用户行 `FOR UPDATE` 串行化同用户的并发抽卡，保证保底计数与余额扣减原子。
3. **卡扣费并发**：`PreConsume` 对卡行 `FOR UPDATE`；`Refund` 带 `requestId` 幂等保护（同订阅退款模式），不允许非幂等重试多退。
4. **过期清理**：调用时校验；后台定时任务把过期卡置 `Status = 2`。
5. **条目合法性校验**：创建条目时校验模型存在、分组存在分组倍率、该模型在该分组有启用渠道，否则拒绝创建（避免抽到废卡）。
6. **权限边界**：卡作为分组解锁凭证仅限卡内模型 + 分组，不允许扩大；审计通过 `Other.gacha_card_id` 可溯源。
7. **经济安全**：管理端实时测算与告警；保底抬高的成本纳入"含保底回报率"展示。
8. **促销 / 免费额度**：抽卡消费与普通消费一致，直接从钱包 quota 扣除。是否允许免费赠送 / 邀请奖励等"白嫖"额度用于抽卡，由运营者通过现有余额发放机制自行控制，本期不单独做余额冻结。

## 11. 测试计划

- 单元测试：
  - 概率分布：大样本（如 10 万次）抽取频率与配置权重偏差 < 1%；各档位聚合概率正确。
  - 保底：连续 PityMax−1 次不出 ≥ PityRarity 档后必出；PityUprate 升级；出高档次后计数清零；十连软保底替换逻辑。
  - 经济计算：`E_value / E_cost / 含保底修正回报率` 公式单测。
  - 档位映射：DeepSWE 分数 → 档位阈值边界（含临界值）与手动覆盖优先级。
- 集成测试：
  - 抽卡事务：并发抽卡（同用户）、`pull_id` 幂等重试、余额不足拒绝且无副作用。
  - 卡扣费：`PreConsume / Settle / Refund` 与余额回退、卡用完置状态、过期拒绝。
  - 模型 / 分组校验：卡与请求模型不匹配、分组不匹配、非本人卡均拒绝。
- API 测试：用户 / 管理端全部接口的 happy path 与错误码。
- 回归：未带 `New-Api-Card` 头的调用行为与利润口径不变；钱包 / 订阅计费不受影响。
- 前端：组件渲染、动画 / 音效开关、quota→法币换算展示正确。

## 12. 实施阶段

- **阶段 1：模型分级**。Model 加字段 + DeepSWE 同步任务 + 管理端分级页 + `/api/pricing` 与模型广场角标。
- **阶段 2：抽卡核心**。四个新实体 + 抽卡 API（事务 / 保底 / 幂等）+ 钱包扣费 + LogTypeGacha + 用户抽卡页（动画 / 音效）+ 卡库页。
- **阶段 3：卡使用与会计**。GachaCardFunding 接入 BillingSession + `New-Api-Card` 协议 + 模型 / 分组校验 + 利润聚合口径调整 + 管理端卡池 / 条目 / 经济测算页。
- **阶段 4：打磨**。概率公示合规文案、抽卡统计 / 成就、动画音效细节、管理端体验。

每阶段独立可交付，阶段 2 后即具备完整抽卡闭环（抽到卡可查询），阶段 3 打通真实调用。

## 13. 非目标（本期不做）

- 多卡叠加使用（一个请求用多张卡）。
- 卡交易 / 转赠 / 出售。
- 独立"抽卡代币"体系（本期直接用钱包 quota）。
- 保底计数的精确马尔可夫求解（用保守近似即可）。
