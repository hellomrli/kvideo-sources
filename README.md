# kvideo-sources

为 KVideo 提供苹果 CMS V10 采集源订阅，通过每日接口与搜索巡检整理线路和备用镜像。

[最新巡检](report.md) · [订阅维护](docs/index.md) · [自动任务](https://github.com/hellomrli/kvideo-sources/actions/workflows/check.yml)

## 添加订阅

在 KVideo 设置中添加下面的订阅地址。`lite.json` 只保留普通组的启用线路：

```text
https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/lite.json
```

按需要选择其他文件：

| 文件 | 内容 | 订阅地址 |
|---|---|---|
| [lite.json](lite.json) | 普通组的启用线路 | `https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/lite.json` |
| [clean.json](clean.json) | 所有组的启用线路，包含成人组 | `https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/clean.json` |
| [full.json](full.json) | 全部组，保留禁用条目及原因，包含成人组 | `https://raw.githubusercontent.com/hellomrli/kvideo-sources/main/full.json` |

启用条目可能处于“保留观察”状态：近期有成功记录时，单日失败不会立即移出订阅。当天检测结果、成功率和线路备注见 [report.md](report.md)。

## 巡检提供什么

- 检查接口列表和真实关键词搜索，两步都通过才记为当日成功。
- 按最多 30 条每日历史计算成功率和优先级。
- 近期仍成功的线路保留观察，连续失败 3 天后自动禁用。
- 对疑似同库镜像保留一条首选线路，并在 `mirrorUrls` 中附上备用地址。
- 每天北京时间 02:00 自动更新，也可在 Actions 中指定搜索关键词手动运行。

巡检检查采集 API 和搜索结果，不逐条验证视频是否能播放。GitHub Actions 与家庭网络的位置不同，实际观看仍以播放器结果为准。

## 本地巡检

需要 Node.js 20，与当前自动任务一致；没有 npm 依赖。以下命令会访问所有启用源，并改写巡检产物：

```bash
git clone https://github.com/hellomrli/kvideo-sources.git
cd kvideo-sources
node check.js
```

默认搜索关键词是 `斗罗大陆`。指定其他关键词时传入第一个参数：

```bash
node check.js "庆余年"
```

完成后会更新 `full.json`、`clean.json`、`lite.json`、`report.md` 和 `history.json`。本地巡检从本机网络观察源可用性。

## 维护源列表

在 [sources.json](sources.json) 中增删线路。生成的订阅文件会在下一次巡检时重建，长期修改应写入主档。

新增源字段、手动禁用、镜像判断和失败排查见[文档索引](docs/index.md)。

## 来源与反馈

种子来自已维护的 EW 订阅和 [puppet680/KVideo-config](https://github.com/puppet680/KVideo-config)，巡检方案也参考了该项目。播放器项目见 [KVideo 容器](https://hub.docker.com/r/kuekhaoyang/kvideo)。

提交 [Issue](https://github.com/hellomrli/kvideo-sources/issues) 时提供源 ID、检查时间、网络位置和失败原因。仓库目前没有根目录许可证文件。
