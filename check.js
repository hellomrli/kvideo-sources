// KVideo 采集源每日巡检
// 用法: node check.js [搜索关键字]
// 输入: sources.json (主档)  输出: full.json / lite.json / report.md / history.json

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SOURCES_PATH = path.join(ROOT, "sources.json");
const HISTORY_PATH = path.join(ROOT, "history.json");
const FULL_PATH = path.join(ROOT, "full.json");
const LITE_PATH = path.join(ROOT, "lite.json");
const REPORT_PATH = path.join(ROOT, "report.md");

const SEARCH_KEYWORD = process.argv[2] || "斗罗大陆";
const TIMEOUT_MS = 12000;
const MAX_RETRY = 2;
const CONCURRENCY = 12;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf-8"));
let history = fs.existsSync(HISTORY_PATH)
  ? JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"))
  : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json,*/*" },
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, data: null, body: text.slice(0, 80) };
    }
  } finally {
    clearTimeout(timer);
  }
}

// 双重检测: ac=list 验证接口连通与库规模, ac=detail&wd= 验证搜索真实可用
async function testSource(item) {
  if (item.enabled === false)
    return { pass: false, reason: "手动禁用", manual: true, total: null };

  let list = null;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      list = await fetchJson(`${item.baseUrl}?ac=list`);
      break;
    } catch (e) {
      list = { error: true };
      if (attempt < MAX_RETRY) await sleep(1000);
    }
  }
  if (list.error || !list.ok || !list.data || typeof list.data !== "object")
    return { pass: false, reason: "超时/宕机", total: null };
  if (list.data.code !== undefined && Number(list.data.code) !== 1)
    return { pass: false, reason: `接口返回 code=${list.data.code}`, total: null };

  const total = Number(list.data.total);
  if (!Number.isFinite(total) || total <= 0)
    return { pass: false, reason: "库为空", total: 0 };

  let detail = null;
  try {
    detail = await fetchJson(
      `${item.baseUrl}?ac=detail&wd=${encodeURIComponent(SEARCH_KEYWORD)}`
    );
  } catch {
    detail = { ok: false };
  }
  const hits = detail?.ok && detail.data?.list?.length > 0;
  if (!hits) return { pass: false, reason: "搜索无结果", total };

  return { pass: true, reason: "正常", total };
}

// 简易并发池
async function runPool(items, worker) {
  const out = new Array(items.length);
  let idx = 0;
  async function lane() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return out;
}

(async () => {
  console.log(`巡检开始: ${sources.length} 个源, 关键词 [${SEARCH_KEYWORD}]`);
  const t0 = Date.now();
  const results = await runPool(sources, async (item) => {
    const r = await testSource(item);
    console.log(`${r.pass ? "✅" : "❌"} ${item.id} ${r.reason}${r.total ? ` (total=${r.total})` : ""}`);
    return { ...item, ...r };
  });

  // 相同 total 的源大概率是同一后端的镜像站, 标记出来
  const byTotal = {};
  for (const r of results) if (r.pass && r.total > 1000) (byTotal[r.total] ||= []).push(r.id);
  const mirrors = Object.values(byTotal).filter((ids) => ids.length > 1);

  // 更新历史(按日期去重, 重跑当天只留最后一次)
  const today = new Date().toISOString().slice(0, 10);
  history = history.filter((h) => h.date !== today);
  history.push({
    date: today,
    results: results.map((r) => ({ api: r.baseUrl, ok: r.pass })),
  });
  if (history.length > 30) history = history.slice(-30);

  const stats = results.map((item) => {
    const entries = history
      .map((h) => h.results.find((x) => x.api === item.baseUrl))
      .filter(Boolean);
    const okCount = entries.filter((h) => h.ok).length;
    const rate = entries.length ? (okCount / entries.length) * 100 : 0;
    const trend = history
      .slice(-7)
      .map((h) => {
        const r = h.results.find((x) => x.api === item.baseUrl);
        return r ? (r.ok ? "✅" : "❌") : "-";
      })
      .join("");

    let streakFail = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const r = history[i].results.find((x) => x.api === item.baseUrl);
      if (r && !r.ok) streakFail++;
      else break;
    }

    let icon = "✅";
    if (item.manual) icon = "🚫";
    else if (streakFail >= 3) icon = "🚨";
    else if (!item.pass) icon = "❌";

    let priority = 50;
    if (icon === "✅") priority = rate >= 100 ? 1 : rate >= 90 ? 5 : 10;
    else if (icon === "🚫") priority = 999;
    else priority = 100 + streakFail;

    const mirrorGroup = mirrors.find((ids) => ids.includes(item.id));
    // 粘性启用: 采集站搜索接口偶发抽风, 单日失败不立即踢出订阅
    // 规则: 当日通过, 或 7 天内仍有成功且连续失败 < 3 天
    const recent = history
      .slice(-7)
      .map((h) => h.results.find((x) => x.api === item.baseUrl))
      .filter(Boolean);
    const ok7 = recent.filter((r) => r.ok).length;
    const sticky = !item.manual && (item.pass || (ok7 >= 1 && streakFail < 3));
    return {
      ...item,
      icon,
      rate: rate.toFixed(1) + "%",
      trend,
      priority,
      sticky,
      mirror: mirrorGroup ? mirrorGroup.filter((i) => i !== item.id) : [],
    };
  });

  // full.json: 全量, 非 ✅ 自动禁用并附死因
  // 同库镜像(total 相同)只保留一条最优线路, 其余不再单独输出; 备用域名附在保留线路的 mirrorUrls 里
  const dropIds = new Set();
  for (const ids of mirrors) {
    const members = stats
      .filter((s) => ids.includes(s.id))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    members.slice(1).forEach((m) => dropIds.add(m.id));
  }
  const full = stats
    .filter((s) => !dropIds.has(s.id))
    .map((s) => {
      const alts = s.mirror.map((id) => {
        const m = stats.find((x) => x.id === id);
        return m ? m.baseUrl : null;
      }).filter(Boolean);
      return {
        id: s.id,
        name: s.name,
        baseUrl: s.baseUrl,
        group: s.group || "normal",
        enabled: s.sticky,
        priority: s.priority,
        ...(s.icon !== "✅"
          ? { _comment: s.sticky ? `${s.reason} (近期仍有成功,保留观察)` : s.reason }
          : {}),
        ...(alts.length ? { mirrors: s.mirror, mirrorUrls: alts } : {}),
      };
    })
    .sort((a, b) => a.priority - b.priority);
  fs.writeFileSync(FULL_PATH, JSON.stringify(full, null, 2));

  // lite.json: 仅普通组且当前可用
  const lite = full.filter((s) => s.group === "normal" && s.enabled);
  fs.writeFileSync(LITE_PATH, JSON.stringify(lite, null, 2));

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  // report.md
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  let md = `# 🎬 KVideo 采集源巡检报告\n\n`;
  md += `> **更新时间：** ${now} CST | **检测关键字：** ${SEARCH_KEYWORD} | **总源数：** ${stats.length} | **可用：** ${stats.filter((s) => s.icon === "✅").length}\n\n`;
  md += `| 状态 | 名称 | 组 | 优先级 | 成功率 | 7天趋势 | 库存 | 镜像站 | 源站 | 备注 |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :--- | ---: | :--- | :--- | :--- |\n`;
  for (const s of [...stats].sort((a, b) => a.priority - b.priority)) {
    const host = s.baseUrl.replace(/^https?:\/\//, "").split("/")[0];
    md += `| ${s.icon} | **${s.name}** (${s.id}) | ${s.group} | ${s.priority} | ${s.rate} | \`${s.trend}\` | ${s.total ?? "-"} | ${s.mirror.join(",") || "-"} | [${host}](${s.baseUrl}) | ${s.icon === "✅" ? "-" : s.reason} |\n`;
  }
  md += `\n### 🪞 同库镜像组 (total 相同, 大概率同一后端)\n\n订阅文件 (full.json / lite.json) 中每组只保留最优一条线路, 备用域名见该线路的 \`mirrorUrls\` 字段。\n`;
  if (mirrors.length === 0) md += `- 无\n`;
  for (const ids of mirrors) md += `- ${ids.join(" / ")}\n`;
  md += `\n### 💡 状态说明\n- ✅ 可用(连通+搜索双通过) | ❌ 今日失联 | 🚨 连断3天+ | 🚫 手动禁用\n- 订阅保留规则(粘性): 当日通过, 或 7 天内仍有成功且未连断 3 天; 连断 3 天才真正移出订阅\n- 优先级: 1=30天全勤 5=成功率≥90% 10=其他可用 100+=失联(数字为连续失败天数)\n- 巡检环境: GitHub Actions (海外视角, 国内直连可用性可能不同)\n`;
  fs.writeFileSync(REPORT_PATH, md);

  const pass = stats.filter((s) => s.icon === "✅").length;
  console.log(`完成: ${pass}/${stats.length} 可用, 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
