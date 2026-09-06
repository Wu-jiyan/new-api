# AI 角色：galgame 剧情全屏模式 + 立绘灯箱 设计

日期：2026-08-30
状态：已批准（用户确认后直接实施）

## 背景

现有 AI 角色系统（Pricing 卡片 / 详情页 / 图鉴 / 打字机小剧场）已上线。用户希望进一步提升 galgame 沉浸感：

1. 立绘（含剪影）点击打开全屏灯箱查看大图
2. 剧情更迭升级为"铺满全屏的环境"：透明背景人物立绘（多姿态）+ 独立空白背景分离素材，进入剧情全屏播放，底部对话栏 + 用户回答选择，配淡入淡出/闪黑/闪白过渡

## 关键决策（已与用户确认）

- **素材体系**：新增一套剧情素材，现有 `image_url`（展示立绘）保留用于卡片/详情页展示；每阶段新增 `background_url`（空白背景）+ `poses[]`（多张透明立绘）
- **选项逻辑**：简单分支后汇合——不同选项各接 1-2 句专属回应台词，之后回到主线
- **过渡配置**：每阶段一个默认效果（`default_effect`），台词行级可覆写（`effect`）
- **剧情入口**：模型广场卡片 + 图鉴 + 详情页全入口，点击即全屏

## 数据模型（`model/character.go`，经 `stages_json` 一次保存）

```go
// 过渡效果枚举：fade（淡入淡出）/ black（闪黑）/ white（闪白）
type CharacterPose struct {
    Name     string `json:"name"`
    ImageURL string `json:"image_url"`
}

type CharacterChoice struct {
    Text   string `json:"text"`             // 选项按钮文案
    Reply  string `json:"reply"`            // 选中后的回应台词
    Pose   string `json:"pose,omitempty"`   // 回应时姿态
    Effect string `json:"effect,omitempty"` // 回应时过渡（可选）
}

type CharacterScript struct {
    Speaker string            `json:"speaker"`
    Text    string            `json:"text"`
    Pose    string            `json:"pose,omitempty"`    // 本句姿态（引用 poses.name）
    Effect  string            `json:"effect,omitempty"`  // 本句过渡，覆盖阶段默认
    Choices []CharacterChoice `json:"choices,omitempty"` // 回答选项（可选）
}

type CharacterStage struct {
    Index          int               `json:"index"`
    Name           string            `json:"name"`
    ImageURL       string            `json:"image_url"`        // 展示立绘（保留）
    BackgroundURL  string            `json:"background_url,omitempty"` // 剧情空白背景
    DefaultEffect  string            `json:"default_effect,omitempty"` // 阶段默认过渡
    Poses          []CharacterPose   `json:"poses,omitempty"`  // 多姿态透明立绘
    UnlockTokens   int64             `json:"unlock_tokens"`
    UnlockText     string            `json:"unlock_text"`
    Script         []CharacterScript `json:"script"`
}
```

`DefaultCharacterStages` 生成的阶段默认 `default_effect: "fade"`。

## 管理端（`web/src/features/character-admin/index.tsx`）

每阶段卡片下新增「剧情素材」区：

- **背景图**：上传 / AI 生成（固定提示词：干净空白背景、无人物、无文字、无比例敏感元素、光影氛围统一、适配多分辨率裁切）
- **姿态列表**：可增删，每姿态 = 名称（normal/happy/shy…）+ 上传 / AI 生成（提示词：透明背景 PNG、单人全身立绘、无背景、光影与背景一致）
- **台词行扩展**：
  - 「姿态」下拉（选项 = 该阶段 poses.name + 空）
  - 「过渡」下拉（阶段默认 / fade / black / white）
  - 「回答选项」子列表（可展开增删）：按钮文案 + 回应台词 + 回应姿态（可选）+ 回应效果（可选）

保存仍走 `stages_json` 一次提交。

## 生成/上传接口扩展（`controller/character_admin.go`）

`generateCharacterImage` / `uploadCharacterImage` 增加类型参数 `type`（`portrait` 展示立绘 / `background` 剧情背景 / `pose` 姿态）与姿态名 `pose_name`：

- `portrait`：现状不变，存阶段 `image_url`
- `background`：存阶段 `background_url`
- `pose`：追加到阶段 `poses[]`（name=pose_name），同名覆盖

文件存储复用 `SaveCharacterImage`（保存后自动生成剪影；背景/姿态不生成剪影——未解锁不进全屏）。

## 全屏播放器 StoryPlayer（新组件 `web/src/features/character/components/story-player.tsx`）

- **触发**：`open` + `character`（已解锁阶段）props；渲染为 `fixed inset-0 z-50` 全屏遮罩
- **背景**：当前阶段 `background_url` 或 `image_url`，`object-cover` 铺满
- **人物**：当前台词 `pose` 对应的 `poses[].image_url`，`absolute` 底部居中、高度 `max(65vh, ...)` 按视口缩放、`object-contain` 底部对齐；无姿态时隐藏
- **对话栏**：底部半透明栏，说话人名 + 打字机逐句 + 点击继续（复用 ScriptPlayer 交互风格）
- **选项**：当前句带 `choices` 时，打字完成后在对话栏上方显示选项按钮；点击 → 将该选项 `reply` 作为临时台词插入播放（应用 pose/effect）→ 结束后继续主线
- **过渡**：进入剧情 / 切阶段 / 切姿态时按 `effect`（句级）或 `default_effect`（阶段级）播放：fade（opacity 过渡）、black/white（遮罩闪屏）
- **退出**：ESC 或右上角关闭按钮；播放中禁用关闭（可选：不强制）
- **解锁联动**：仅已解锁阶段可进入；入口按钮未解锁时显示锁 + 点击提示解锁条件（复用现有解锁文案）

## 立绘灯箱 Lightbox（新组件 `web/src/features/character/components/lightbox.tsx`）

- 详情页立绘区、图鉴卡片立绘，点击打开全屏灯箱（`fixed inset-0 z-50`，黑色背景，图片居中大图，`object-contain`）
- 剪影同样可点击打开
- 点击任意处 / ESC 关闭

## 剧情入口

- **模型广场卡片**（`model-card.tsx`）：角色入口按钮旁增加「进入剧情」播放按钮，仅当已解锁（`total_calls>=1` 且 `max_stage>=0` 且有剧情素材）时可用
- **图鉴**（`gallery.tsx`）：卡片增加「进入剧情」按钮
- **详情页**（`character/index.tsx`）：小剧场区上方增加「全屏进入剧情」按钮
- 全部点击 → 打开 StoryPlayer（播放当前已解锁最高阶段的剧情）

## i18n

新增 key：进入剧情、全屏剧情、回答选项相关（7 语言：en/zh/zh-TW/fr/ja/ru/vi）。

## 测试

- Go：`CharacterStages` 序列化/反序列化含新字段（pose/effect/choices/background/poses/default_effect）；admin 接口扩展参数
- 前端：`npx tsgo --noEmit` 类型检查；管理端表单增删姿态/选项逻辑手测
- 播放器：手动验证打字机、选项分支、过渡效果、ESC 退出
