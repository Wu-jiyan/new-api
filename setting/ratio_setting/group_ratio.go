package ratio_setting

import (
	"encoding/json"
	"errors"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

// groupForcedPriceMap maps a billing group to a flat USD price per request.
// A group listed here charges exactly that amount for every request billed as
// the group, whatever the model's own price, ratio or billing expression says.
// An absent group means the group follows normal model pricing.
var groupForcedPriceMap = types.NewRWMap[string, float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupForcedPrice        *types.RWMap[string, float64]            `json:"group_forced_price"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
		GroupForcedPrice:        groupForcedPriceMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	if groupRatioSetting.GroupForcedPrice == nil {
		groupRatioSetting.GroupForcedPrice = groupForcedPriceMap
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog(common.LogText("group ratio not found: %s", name))
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := groupGroupRatioMap.Get(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := gp[usingGroup]
	if !ok {
		return -1, false
	}
	return ratio, true
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := json.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}

// GetGroupForcedPrice returns the flat USD per-request price a group charges
// instead of its models' own pricing. The second result is false when the
// group has no forced price and normal pricing applies.
func GetGroupForcedPrice(name string) (float64, bool) {
	price, ok := groupForcedPriceMap.Get(name)
	if !ok || price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
		return 0, false
	}
	return price, true
}

func GetGroupForcedPriceCopy() map[string]float64 {
	return groupForcedPriceMap.ReadAll()
}

// CheckGroupForcedPrice rejects anything that cannot be converted into a
// positive quota: zero would silently turn the group into a free one, and
// negative or non-finite values could produce a negative charge.
func CheckGroupForcedPrice(jsonStr string) error {
	prices := make(map[string]float64)
	if err := common.UnmarshalJsonStr(jsonStr, &prices); err != nil {
		return err
	}
	for name, price := range prices {
		if price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
			return errors.New("group forced price must be a positive number: " + name)
		}
	}
	return nil
}
