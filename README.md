# 🎬 KVideo 采集源巡检

KVideo（苹果CMS V10 采集源播放器）的订阅源仓库，种子来自：

- NAS 上 KVideo 的 EW订阅源（78 个）
- [puppet680/KVideo-config](https://github.com/puppet680/KVideo-config)（58 个）

两边合并去重后共 **98 个源**，由 GitHub Actions **每天自动巡检**（北京时间凌晨 2 点），失效源自动禁用并标注死因，可用源按 30 天成功率动态排序。

> 巡检思路参考 [puppet680/KVideo-config](https://github.com/puppet680/KVideo-config)，在其基础上增加了连通+搜索双重检测和同库镜像站标记。

## 📦 订阅文件

| 文件 | 内容 | KVideo 订阅地址 |
| :--- | :--- | :--- |
| [full.json](full.json) | 全量（含成人组），失效源 `enabled:false` | `https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/full.json` |
| [lite.json](lite.json) | 仅普通组且当前可用 | `https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/lite.json` |

在 KVideo 设置里添加订阅源即可，格式同 EW订阅源。

## 📁 文件结构

| 文件 | 说明 |
| :--- | :--- |
| `sources.json` | **主档**：所有源的人工维护入口，增删源改这个文件 |
| `check.js` | 巡检脚本：双检 + 状态机 + 镜像标记，零依赖纯 Node |
| `full.json` / `lite.json` | 巡检产物（自动生成，勿手改） |
| `report.md` | 可视化巡检报告（自动生成） |
| `history.json` | 30 天滚动历史（自动生成，是成功率计算的依据） |

## 🔍 检测逻辑

每个源做两步检测，全部通过才算 ✅：

1. `?ac=list` — 接口连通、返回 code=1、库非空（顺带取 total 库存数）
2. `?ac=detail&wd=斗罗大陆` — 用固定关键词真实搜索，验证搜索链路可用

状态机：

- ✅ **可用**：双检通过
- ❌ **失联**：今日检测失败（备注死因：超时/宕机、接口异常、库为空、搜索无结果）
- 🚨 **宕机预警**：连续 3 天以上失败
- 🚫 **手动禁用**：主档里 `enabled:false`

优先级自动计算：30 天全勤 → 1，成功率 ≥90% → 5，其他可用 → 10，失联 → 100+连续失败天数。

**同库镜像标记**：多个源 `total` 库存数完全相同时，大概率是同一后端的不同域名，报告和 `full.json` 里会互相标注 `mirrors`，方便只保留一条线路。

## ⚠️ 已知局限

巡检跑在 GitHub Actions（海外）上，与国内家庭宽带直连的可用性存在差异：部分源海外 ✅ 国内超时（或反之）。以实际播放体验为准，必要时可在自己 NAS 上加 self-hosted runner 获得本地视角。

## 🙏 致谢

- [puppet680/KVideo-config](https://github.com/puppet680/KVideo-config) — 每日巡检 + 自动清洗的思路
- [kuekhaoyang/kvideo](https://hub.docker.com/r/kuekhaoyang/kvideo) — KVideo 本体
