const state = {
  opportunities: [],
  customIndustries: [],
  filters: {
    q: "",
    market: "",
    grade: ""
  }
};

const api = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Keep the fallback message.
    }
    throw new Error(message);
  }
  return response.json();
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const gradeClass = (grade) => `grade-${grade}`;
const isFilePreview = () => window.location.protocol === "file:";

const renderFilePreviewNotice = () => {
  document.body.innerHTML = `
    <main class="standalone-notice">
      <section class="panel">
        <h1>请使用本地服务地址打开</h1>
        <p>当前是直接打开 HTML 文件，后端 API、行情刷新、飞书和每日更新不会运行。</p>
        <div class="notice-actions">
          <a class="primary-btn" href="http://localhost:7317/">打开本地服务</a>
          <code>npm run dev</code>
        </div>
      </section>
    </main>
  `;
};

const formatDuration = (start, end) => {
  const started = new Date(start).getTime();
  const finished = new Date(end || start).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return "-";
  const seconds = Math.max(0, Math.round((finished - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const summarizeRunErrors = (errors = []) => {
  if (!errors.length) return "-";
  return errors
    .slice(0, 2)
    .map((error) => [error.source, error.message || error.error].filter(Boolean).join(": "))
    .join("；");
};

const formatRunType = (type) =>
  ({
    "daily-run": "每日一键更新",
    "due-tasks": "执行待处理项",
    "official-disclosures": "官方披露",
    "rss-news": "新闻/RSS",
    "bulk-events": "批量事件",
    "manual-event": "手动事件",
    "market-snapshot": "行情快照"
  }[type] || type);

const showToast = (message, type = "info") => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  toast.dataset.type = type;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
};

const withToast = async (task, successMessage) => {
  try {
    const result = await task();
    if (successMessage) showToast(successMessage, "success");
    return result;
  } catch (error) {
    showToast(error.message, "error");
    throw error;
  }
};

const renderSystemStatus = async () => {
  const data = await api("/api/system/status");
  const lastRun = data.lastRun ? `${data.lastRun.status} / ${data.lastRun.imported ?? 0}条` : "暂无采集";
  $("#systemStatus").textContent = `事件${data.records.rawEvents} / 股票${data.records.groupedStocks} / ${lastRun}`;
  renderHealthPanel(data);
};

const healthStatusText = (status) =>
  ({
    fresh: "正常",
    stale: "需更新",
    missing: "缺数据"
  }[status] || "待检查");

const ageText = (hours) => {
  if (hours === null || hours === undefined) return "暂无";
  if (hours < 1) return "1小时内";
  if (hours < 24) return `${hours}小时前`;
  return `${Math.round(hours / 24)}天前`;
};

const renderHealthPanel = (data) => {
  const panel = $("#systemHealthPanel");
  if (!panel || !data.freshness) return;
  const { freshness } = data;
  const cards = [
    {
      label: "7日事件",
      value: `${freshness.recentEventCount}条`,
      meta: `最近更新 ${ageText(freshness.eventAgeHours)}`,
      status: freshness.eventStatus
    },
    {
      label: "行情快照",
      value: `${data.records.marketSnapshots}只`,
      meta: `最近更新 ${ageText(freshness.marketAgeHours)}`,
      status: freshness.marketStatus
    },
    {
      label: "模型复盘",
      value: data.lastRun?.type === "daily-run" ? "已串联" : "独立运行",
      meta: `最近复盘 ${ageText(freshness.reviewAgeHours)}`,
      status: freshness.reviewStatus
    },
    {
      label: "最近采集",
      value: data.lastRun ? formatRunType(data.lastRun.type) : "暂无",
      meta: data.lastRun ? `${data.lastRun.status} / 导入${data.lastRun.imported ?? 0} / 失败${data.lastRun.failed ?? 0}` : "点击每日一键更新",
      status: data.lastRun?.status === "success" ? "fresh" : data.lastRun ? "stale" : "missing"
    }
  ];
  panel.innerHTML = cards
    .map(
      (item) => `
        <article class="health-card ${item.status}">
          <div>
            <span>${item.label}</span>
            <strong>${item.value}</strong>
          </div>
          <em>${healthStatusText(item.status)}</em>
          <p>${item.meta}</p>
        </article>
      `
    )
    .join("") + `
      <article class="health-card ${data.nextActions?.length ? "stale" : "fresh"}">
        <div>
          <span>下一步</span>
          <strong>${data.nextActions?.length ? `${data.nextActions.length}项待处理` : "无需操作"}</strong>
        </div>
        <em>${data.nextActions?.length ? "需更新" : "正常"}</em>
        <p>${data.nextActions?.[0] || "当前数据仍在建议更新窗口内"}</p>
        <button id="runDueButton" class="secondary-btn" type="button" ${data.nextActions?.length ? "" : "disabled"}>执行待处理项</button>
      </article>
    `;
};

const renderUpdateSchedule = async () => {
  const schedule = await api("/api/system/update-schedule");
  $("#updateScheduleForm").innerHTML = `
    <div class="schedule-head">
      <div>
        <h3>更新计划</h3>
        <p class="muted">按任务类型控制建议刷新频率，系统据此判断是否需要更新。</p>
      </div>
      <button class="secondary-btn" type="submit">保存计划</button>
    </div>
    ${Object.entries(schedule)
      .map(
        ([key, item]) => `
          <label class="schedule-card" data-schedule-key="${key}">
            <span>
              <input name="${key}.enabled" type="checkbox" ${item.enabled ? "checked" : ""} />
              ${item.label}
            </span>
            <input name="${key}.cadenceHours" type="number" min="1" step="1" value="${item.cadenceHours}" />
            <p>${item.suggestedWindow}</p>
          </label>
        `
      )
      .join("")}
  `;
};

const submitUpdateSchedule = async (formElement) => {
  const payload = {};
  formElement.querySelectorAll(".schedule-card").forEach((card) => {
    const key = card.dataset.scheduleKey;
    payload[key] = {
      enabled: card.querySelector(`[name="${key}.enabled"]`).checked,
      cadenceHours: Number(card.querySelector(`[name="${key}.cadenceHours"]`).value || 1)
    };
  });
  await api("/api/system/update-schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  showToast("更新计划已保存", "success");
  await Promise.all([renderSystemStatus(), renderUpdateSchedule()]);
};

const runDueTasks = async () => {
  const button = $("#runDueButton");
  if (button) button.disabled = true;
  try {
    const result = await api("/api/system/run-due", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 7, markets: ["US", "HK"] })
    });
    showToast(`待处理项执行完成：${result.tasks.length}项，导入${result.imported}条，失败${result.failed}条`, result.failed ? "info" : "success");
    await Promise.all([
      renderOpportunities(),
      renderDailyReport(),
      renderPriorityWatch(),
      renderWatchlist(),
      renderReview(),
      renderIngestionRuns(),
      renderSystemStatus(),
      renderUpdateSchedule(),
      renderModel()
    ]);
  } finally {
    const freshButton = $("#runDueButton");
    if (freshButton) freshButton.disabled = false;
  }
};

const opportunityParams = () => {
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set("limit", "50");
  return params;
};

const renderOpportunities = async () => {
  const params = opportunityParams();
  params.set("group", "stock");
  const data = await api(`/api/opportunities?${params.toString()}`);
  state.opportunities = data.items;
  renderSummary(data.items);

  $("#opportunityGrid").innerHTML = data.items
    .map(
      (item) => `
        <article class="card">
          <div class="card-head">
            <div>
              <div class="symbol">${item.symbol}</div>
              <div class="stock-name">${item.stockName}</div>
            </div>
            <div class="score-badge ${gradeClass(item.grade)}">
              <strong>${item.grade}</strong>
              <span>${item.score}</span>
            </div>
          </div>
          <div class="tags">
            <span class="tag">${item.market === "US" ? "美股" : "港股"}</span>
            <span class="tag">${item.industry}</span>
            <span class="tag">${item.eventType}</span>
            <span class="tag">${item.poolStatus}</span>
            ${item.eventCount > 1 ? `<span class="tag">近7天${item.eventCount}条事件</span>` : ""}
          </div>
          <p>${item.event}</p>
          <div>
            <strong>为什么值得观察</strong>
            <ul>${item.reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>
          </div>
          <div class="card-actions">
            <button class="primary-btn" data-detail="${item.symbol}">详情</button>
            <button class="secondary-btn" data-watch="${item.id}">加入观察池</button>
            <button class="secondary-btn" data-action="${item.id}">重点跟踪</button>
          </div>
        </article>
      `
    )
    .join("");
};

const renderDailyReport = async () => {
  const data = await api(`/api/daily-report?${opportunityParams().toString()}`);
  $("#dailyReportTable").dataset.copyText = [
    ["股票代码", "股票名称", "市场", "行业", "评分", "等级", "触发事件", "入池状态", "后续观察点"].join("\t"),
    ...data.items.map((item) =>
      [
        item.stockCode,
        item.stockName,
        item.market === "US" ? "美股" : "港股",
        item.industry,
        item.score,
        item.grade,
        item.triggerEvent,
        item.poolStatus,
        item.followUpPoint
      ].join("\t")
    )
  ].join("\n");
  $("#dailyReportTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>股票代码</th>
          <th>股票名称</th>
          <th>市场</th>
          <th>行业</th>
          <th>评分</th>
          <th>等级</th>
          <th>触发事件</th>
          <th>入池状态</th>
          <th>后续观察点</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.stockCode}</strong></td>
                      <td>${item.stockName}</td>
                      <td>${item.market === "US" ? "美股" : "港股"}</td>
                      <td>${item.industry}</td>
                      <td>${item.score}</td>
                      <td>${item.grade}</td>
                      <td>${item.triggerEvent}</td>
                      <td>${item.poolStatus}</td>
                      <td>${item.followUpPoint || "-"}</td>
                    </tr>
                  `
                )
                .join("")
            : `<tr><td colspan="9" class="muted">暂无符合条件的每日输出</td></tr>`
        }
      </tbody>
    </table>
    <p class="muted">${data.disclaimer}</p>
  `;
};

const renderSummary = (items) => {
  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.grade] = (acc[item.grade] || 0) + 1;
      if (item.market === "HK") acc.hk += 1;
      if (item.market === "US") acc.us += 1;
      return acc;
    },
    { total: 0, S: 0, A: 0, B: 0, C: 0, D: 0, hk: 0, us: 0 }
  );
  $("#summaryStrip").innerHTML = `
    <div class="summary-item"><strong>${counts.total}</strong><span>机会卡片</span></div>
    <div class="summary-item"><strong>${counts.S + counts.A}</strong><span>S/A 优先观察</span></div>
    <div class="summary-item"><strong>${counts.hk}</strong><span>港股</span></div>
    <div class="summary-item"><strong>${counts.us}</strong><span>美股</span></div>
  `;
};

const renderDetail = async (symbol) => {
  const brief = await api(`/api/stocks/${encodeURIComponent(symbol)}/brief`);
  const item = brief.primaryOpportunity;
  $("#detailContent").innerHTML = `
    <div class="card-head">
      <div>
        <h2>${brief.symbol} ${brief.stockName}</h2>
        <p class="muted">${brief.market} / ${brief.industry} / 近7天${brief.events.length}条原始事件，${brief.opportunities.length}张评分卡</p>
      </div>
      <div class="score-badge ${gradeClass(item.grade)}">
        <strong>${item.grade}</strong>
        <span>${item.score}</span>
      </div>
    </div>
    <div class="detail-grid">
      <section class="detail-section">
        <strong>核心事件</strong>
        <p>${item.event}</p>
      </section>
      <section class="detail-section">
        <strong>结论</strong>
        <p>${item.conclusion}</p>
      </section>
      <section class="detail-section">
        <strong>市场验证</strong>
        <p>${brief.marketSnapshot ? `${formatPct(brief.marketSnapshot.changePct)} / 量比 ${brief.marketSnapshot.volumeRatio}` : "暂无行情快照"}</p>
      </section>
      <section class="detail-section">
        <strong>观察池</strong>
        <p>${brief.watchlist.length ? `已入池 ${brief.watchlist.length} 次` : "尚未入池"}</p>
      </section>
    </div>
    <div class="detail-grid">
      <section class="detail-section">
        <strong>为什么值得观察</strong>
        <ul>${item.reasons.map((text) => `<li>${text}</li>`).join("")}</ul>
      </section>
      <section class="detail-section">
        <strong>主要风险</strong>
        <ul>${item.risks.map((text) => `<li>${text}</li>`).join("")}</ul>
      </section>
      <section class="detail-section">
        <strong>后续观察</strong>
        <ul>${item.watchSignals.map((text) => `<li>${text}</li>`).join("")}</ul>
      </section>
    </div>
    <div class="detail-grid">
      ${Object.entries(item.dimensions)
        .map(
          ([key, value]) => `
            <section class="detail-section">
              <strong>${dimensionLabels[key]}：${value.score}</strong>
              <p>${value.reason}</p>
            </section>
          `
        )
        .join("")}
    </div>
    <section class="detail-section full-span">
      <strong>近7天事件</strong>
      <div class="event-list">
        ${brief.events
          .map(
            (event) => `
              <div class="event-row">
                <div>
                  <strong>${event.eventType}</strong>
                  <p>${event.title}</p>
                  <p class="muted">${new Date(event.publishedAt).toLocaleString()} / ${event.source} / ${event.sourceCredibility}级来源</p>
                </div>
                ${event.url ? `<a class="secondary-btn link-btn" href="${event.url}" target="_blank" rel="noopener noreferrer">来源</a>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
    </section>
    <section class="detail-section full-span">
      <strong>评分卡</strong>
      <div class="event-list">
        ${brief.opportunities
          .map(
            (opportunity) => `
              <div class="event-row">
                <div>
                  <strong>${opportunity.grade} / ${opportunity.score} / ${opportunity.eventType}</strong>
                  <p>${opportunity.event}</p>
                </div>
                <button class="secondary-btn" data-watch="${opportunity.id}">加入观察池</button>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
    <p class="muted">本系统为个人研究和复盘工具，所有内容仅用于信息整理、事件跟踪和模型验证。</p>
  `;
  $("#detailDialog").showModal();
};

const dimensionLabels = {
  eventStrength: "事件强度",
  expectationGap: "预期差",
  catalystCertainty: "催化剂确定性",
  marketValidation: "市场验证",
  trendFit: "产业趋势匹配度",
  valuationSupport: "估值与基本面支撑",
  riskCounter: "风险反证"
};

const renderWatchlist = async () => {
  const data = await api("/api/watchlist");
  $("#watchlistTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>股票</th>
          <th>ID</th>
          <th>入池日期</th>
          <th>等级/分数</th>
          <th>事件类型</th>
          <th>T+1</th>
          <th>T+3</th>
          <th>T+5</th>
          <th>T+10</th>
          <th>T+20</th>
          <th>相对大盘</th>
          <th>相对行业</th>
          <th>成交量</th>
          <th>最大回撤</th>
          <th>入池状态</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${data.items
          .map(
            (item) => `
              <tr>
                <td><strong>${item.symbol}</strong> <span class="muted">${item.stockName}</span></td>
                <td>${item.id}</td>
                <td>${item.entryDate}</td>
                <td>${item.entryGrade} / ${item.entryScore}</td>
                <td>${item.eventType}</td>
                <td>${formatPct(item.performance?.t1)}</td>
                <td>${formatPct(item.performance?.t3)}</td>
                <td>${formatPct(item.performance?.t5)}</td>
                <td>${formatPct(item.performance?.t10)}</td>
                <td>${formatPct(item.performance?.t20)}</td>
                <td>${formatPct(item.performance?.relativeMarket)}</td>
                <td>${formatPct(item.performance?.relativeIndustry)}</td>
                <td>${formatPct(item.performance?.volumeChange)}</td>
                <td>${formatPct(item.performance?.maxDrawdown)}</td>
                <td>${item.trackingStatus}</td>
                <td>${item.status}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
};

const renderPriorityWatch = async () => {
  const data = await api("/api/watch-pool/priority");
  $("#priorityWatchTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>股票代码</th>
          <th>股票名称</th>
          <th>市场</th>
          <th>入池日期</th>
          <th>入池价格</th>
          <th>入池评分</th>
          <th>等级</th>
          <th>触发事件</th>
          <th>当前价格</th>
          <th>T+1</th>
          <th>T+3</th>
          <th>T+5</th>
          <th>T+10</th>
          <th>T+20</th>
          <th>相对大盘</th>
          <th>相对行业</th>
          <th>成交量变化</th>
          <th>最新事件</th>
          <th>风险反证</th>
          <th>复盘结论</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.stockCode}</strong></td>
                      <td>${item.stockName}</td>
                      <td>${item.market === "US" ? "美股" : "港股"}</td>
                      <td>${item.entryDate}</td>
                      <td>${item.entryPrice ?? "-"}</td>
                      <td>${item.entryScore}</td>
                      <td>${item.entryLevel}</td>
                      <td>${item.triggerEvent}</td>
                      <td>${item.currentPrice ?? "-"}</td>
                      <td>${formatPct(item.performance?.t1)}</td>
                      <td>${formatPct(item.performance?.t3)}</td>
                      <td>${formatPct(item.performance?.t5)}</td>
                      <td>${formatPct(item.performance?.t10)}</td>
                      <td>${formatPct(item.performance?.t20)}</td>
                      <td>${formatPct(item.performance?.relativeMarket)}</td>
                      <td>${formatPct(item.performance?.relativeIndustry)}</td>
                      <td>${formatPct(item.performance?.volumeChange)}</td>
                      <td>${item.latestEvent || "-"}</td>
                      <td>${item.performance?.riskTriggered ? "已触发" : "未触发"}</td>
                      <td>${item.performance?.verdict || item.status}</td>
                    </tr>
                  `
                )
                .join("")
            : `<tr><td colspan="20" class="muted">暂无S/A级重点关注对象</td></tr>`
        }
      </tbody>
    </table>
    <p class="muted">${data.disclaimer}</p>
  `;
};

const renderPersonalActions = async () => {
  const data = await api("/api/personal-actions");
  $("#actionsTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>股票</th>
          <th>动作</th>
          <th>记录时间</th>
          <th>记录价格</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.items.length
            ? data.items
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.symbol || "-"}</strong></td>
                      <td>${item.actionType}</td>
                      <td>${new Date(item.recordedAt).toLocaleString()}</td>
                      <td>${item.recordPrice ?? "-"}</td>
                      <td>${item.note || "-"}</td>
                    </tr>
                  `
                )
                .join("")
            : `<tr><td colspan="5" class="muted">暂无个人动作记录</td></tr>`
        }
      </tbody>
    </table>
  `;
};

const renderIngestionRuns = async () => {
  const data = await api("/api/ingestion-runs");
  $("#ingestionRuns").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th>类型</th>
          <th>状态</th>
          <th>市场</th>
          <th>导入</th>
          <th>失败</th>
          <th>评分</th>
          <th>耗时</th>
          <th>错误摘要</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.items.length
            ? data.items
                .slice(0, 8)
                .map(
                  (item) => `
                    <tr>
                      <td>${new Date(item.createdAt).toLocaleString()}</td>
                      <td>${formatRunType(item.type)}</td>
                      <td>${item.status}</td>
                      <td>${(item.markets || []).join("/") || "-"}</td>
                      <td>${item.imported ?? 0}</td>
                      <td>${item.failed ?? 0}</td>
                      <td>${item.scored ?? 0}</td>
                      <td>${formatDuration(item.startedAt || item.createdAt, item.finishedAt || item.createdAt)}</td>
                      <td class="run-error">${summarizeRunErrors(item.errors)}</td>
                    </tr>
                  `
                )
                .join("")
            : `<tr><td colspan="9" class="muted">暂无采集记录</td></tr>`
        }
      </tbody>
    </table>
  `;
};

const renderSourceConfig = async () => {
  const data = await api("/api/data-sources/config");
  $("#sourceConfig").innerHTML = `
    <article class="panel">
      <h3>美股采集池</h3>
      <div class="pool-list">
        ${data.us
          .map(
            (item) => `
              <span class="tag pool-tag">${item.symbol}<button data-remove-source="us:${item.symbol}" aria-label="删除 ${item.symbol}">×</button></span>
            `
          )
          .join("")}
      </div>
    </article>
    <article class="panel">
      <h3>港股采集池</h3>
      <div class="pool-list">
        ${data.hk
          .map(
            (item) => `
              <span class="tag pool-tag">${item.symbol}<button data-remove-source="hk:${item.code}" aria-label="删除 ${item.symbol}">×</button></span>
            `
          )
          .join("")}
      </div>
    </article>
  `;
};

const renderNewsFeeds = async () => {
  const data = await api("/api/news-feeds");
  $("#newsFeeds").innerHTML = `
    <article class="panel">
      <h3>新闻/RSS源</h3>
      <div class="pool-list">
        ${data.items
          .map(
            (item) => `
              <span class="tag pool-tag">${item.name}<button data-remove-feed="${item.id}" aria-label="删除 ${item.name}">×</button></span>
            `
          )
          .join("")}
      </div>
    </article>
  `;
};

const renderFeishuStatus = async () => {
  const data = await api("/api/feishu/status");
  const push = data.configured ? "推送已配置" : "推送未配置";
  const command = data.appConfigured && data.verificationTokenConfigured ? "群指令已配置" : "群指令未完整配置";
  $("#feishuStatus").textContent = `${push} / ${command}`;
};

const renderBrokerStatus = async () => {
  const data = await api("/api/brokers/status");
  const futu = data.futu.enabled ? `富途已启用 ${data.futu.host}:${data.futu.port}` : "富途未启用";
  const tiger = data.tiger.enabled
    ? `老虎已启用 / ${data.tiger.configured ? "凭证完整" : "凭证未完整"}`
    : "老虎未启用";
  const ibkr = data.ibkr.enabled ? `IBKR已启用 ${data.ibkr.host}:${data.ibkr.port}` : "IBKR未启用";
  const chief = data.chief.enabled ? "致富证券已启用但等待官方API" : "致富证券未启用";
  $("#brokerStatus").textContent = `${futu} / ${tiger} / ${ibkr} / ${chief} / 只读模式`;

  const form = $("#brokerConfigForm");
  if (!form.dataset.loaded) {
    form.elements.futuEnabled.checked = data.futu.enabled;
    form.elements.futuHost.value = data.futu.host || "";
    form.elements.futuPort.value = data.futu.port || "";
    form.elements.tigerEnabled.checked = data.tiger.enabled;
    form.elements.tigerSandbox.checked = data.tiger.sandbox;
    form.elements.ibkrEnabled.checked = data.ibkr.enabled;
    form.elements.ibkrHost.value = data.ibkr.host || "";
    form.elements.ibkrPort.value = data.ibkr.port || "";
    form.elements.ibkrMode.value = data.ibkr.mode || "paper";
    form.elements.chiefEnabled.checked = data.chief.enabled;
    form.elements.chiefOfficialApiUrl.value = data.chief.officialApiUrl || "";
    form.elements.chiefApiNote.value = data.chief.note || "";
    form.dataset.loaded = "true";
  }
};

const renderReview = async () => {
  const data = await api("/api/reviews/weekly");
  const formatRate = (value) => (value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`);
  $("#reviewPanel").innerHTML = `
    <section class="panel">
      <h3>${data.week}</h3>
      <p class="muted">总入池 ${data.entryCount} 只，S/A重点关注 ${data.priorityEntryCount ?? "-"} 只</p>
    </section>
    <section class="panel">
      <h3>S/A表现</h3>
      <ul>
        <li>S级均值：${formatPct(data.sAverageReturn)}</li>
        <li>A级均值：${formatPct(data.aAverageReturn)}</li>
        <li>跑赢大盘比例：${formatRate(data.marketWinRate)}</li>
        <li>跑赢行业比例：${formatRate(data.industryWinRate)}</li>
      </ul>
    </section>
    <section class="panel">
      <h3>等级表现</h3>
      <ul>${data.gradePerformance.map((item) => `<li>${item.grade}：${item.count}只，跟踪均值${formatPct(item.avgReturn ?? item.avgT1)}，${item.verdict}</li>`).join("")}</ul>
    </section>
    <section class="panel">
      <h3>有效事件</h3>
      <p>${data.bestEventTypes.join("、")}</p>
    </section>
    <section class="panel">
      <h3>行业质量</h3>
      <ul>${
        data.industryStats?.length
          ? data.industryStats.map((item) => `<li>${item.industry}：${item.count}只，均值${formatPct(item.avgReturn)}，胜率${formatRate(item.winRate)}</li>`).join("")
          : "<li>样本不足</li>"
      }</ul>
    </section>
    <section class="panel">
      <h3>高分失败</h3>
      <p>${data.failedHighScoreCases?.length ? data.failedHighScoreCases.join("、") : "暂无"}</p>
    </section>
    <section class="panel">
      <h3>低分走强</h3>
      <p>${data.lowScoreWinners?.length ? data.lowScoreWinners.join("、") : "暂无"}</p>
    </section>
    <section class="panel">
      <h3>权重建议</h3>
      <ul>${data.weightSuggestions.map((item) => `<li>${item}</li>`).join("")}</ul>
      ${data.modelSuggestionId ? `<p class="muted">已生成待确认模型建议：${data.modelSuggestionId}</p>` : ""}
    </section>
  `;
};

const renderIndustries = async () => {
  const data = await api("/api/custom-industries");
  state.customIndustries = data.items;
  $("#industryList").innerHTML = data.items
    .map(
      (item) => `
        <article class="industry-card">
          <header>
            <div>
              <h3>${item.name}</h3>
              <p class="muted">${item.note}</p>
            </div>
            <span class="tag">${item.priority}优先级</span>
          </header>
          <p class="meta">关键词：${item.keywords.join("、")}</p>
          <p class="meta">股票池：${item.stockPool.join("、")}</p>
          <p class="meta">排除词：${item.excludedKeywords.join("、")}</p>
        </article>
      `
    )
    .join("");
  $$(".industry-card").forEach((card, index) => {
    const item = state.customIndustries[index];
    if (!item) return;
    const actions = document.createElement("div");
    actions.className = "industry-actions";
    actions.innerHTML = `
      <button class="secondary-btn" type="button" data-edit-industry="${item.id}">编辑</button>
      <button class="secondary-btn danger-btn" type="button" data-delete-industry="${item.id}">删除</button>
    `;
    card.append(actions);
  });
};

const resetIndustryForm = () => {
  const form = $("#industryForm");
  form.reset();
  form.elements.id.value = "";
  form.querySelector('button[type="submit"]').textContent = "添加行业";
  $("#industryCancelButton").hidden = true;
};

const editIndustry = (id) => {
  const item = state.customIndustries.find((industry) => industry.id === id);
  if (!item) return;
  const form = $("#industryForm");
  form.elements.id.value = item.id;
  form.elements.name.value = item.name || "";
  form.elements.keywords.value = (item.keywords || []).join(", ");
  form.elements.stockPool.value = (item.stockPool || []).join(", ");
  form.elements.priority.value = item.priority || form.elements.priority.value;
  form.querySelector('button[type="submit"]').textContent = "保存修改";
  $("#industryCancelButton").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
};

const renderModel = async () => {
  const data = await api("/api/model/config");
  const formatRate = (value) => (value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`);
  const evidenceText = (item) => {
    if (!item.evidence) return "";
    const lowScore = item.evidence.lowScoreWinners?.length ? `｜低分走强${item.evidence.lowScoreWinners.length}` : "";
    const topIndustry = item.evidence.industryStats?.[0]?.industry ? `｜最强行业${item.evidence.industryStats[0].industry}` : "";
    return `样本${item.evidence.sampleSize ?? item.evidence.priorityEntryCount ?? "-"}｜重点均值${formatPct(item.evidence.priorityAverageReturn)}｜跑赢大盘${formatRate(item.evidence.marketWinRate)}｜跑赢行业${formatRate(item.evidence.industryWinRate)}${lowScore}${topIndustry}`;
  };
  const weights = Object.entries(data.weights)
    .map(
      ([key, value]) => `
        <div class="weight-row">
          <div>
            <strong>${dimensionLabels[key]}</strong>
            <p class="muted">${data.id}</p>
          </div>
          <div class="bar" aria-label="${dimensionLabels[key]}权重${value}%"><span style="width:${value * 4}%"></span></div>
          <strong>${value}%</strong>
        </div>
      `
    )
    .join("");
  const suggestions = (data.suggestions || [])
    .map(
      (item) => `
        <div class="weight-row">
          <div>
            <strong>${item.status === "confirmed" ? "已确认建议" : "待确认建议"}</strong>
            <p class="muted">${item.reason}</p>
            ${evidenceText(item) ? `<p class="muted">${evidenceText(item)}</p>` : ""}
          </div>
          ${
            item.status === "pending"
              ? `<button class="secondary-btn" data-confirm-model="${item.id}">确认调整</button>`
              : `<span class="tag">已生效</span>`
          }
        </div>
      `
    )
    .join("");
  $("#modelWeights").innerHTML = `${weights}${suggestions}`;
};

const formatPct = (value) => {
  if (value === null || value === undefined) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
};

const addToWatchlist = async (opportunityId) => {
  await api("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opportunityId })
  });
  await Promise.all([renderOpportunities(), renderDailyReport(), renderPriorityWatch(), renderWatchlist()]);
};

const recordPersonalAction = async (opportunityId, actionType = "重点跟踪") => {
  await api("/api/personal-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opportunityId, actionType })
  });
  await renderPersonalActions();
};

const parseList = (value) =>
  value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const submitEvent = async (formElement) => {
  const form = new FormData(formElement);
  const result = await api("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: form.get("symbol"),
      stockName: form.get("stockName"),
      market: form.get("market"),
      industry: form.get("industry"),
      eventType: form.get("eventType"),
      sourceCredibility: form.get("sourceCredibility"),
      source: form.get("source"),
      catalystDate: form.get("catalystDate"),
      title: form.get("title"),
      summary: form.get("summary"),
      followupSignals: parseList(form.get("followupSignals") || "")
    })
  });
  formElement.reset();
  await Promise.all([renderOpportunities(), renderDailyReport()]);
  await renderDetail(result.opportunity.symbol);
};

const submitMarketSnapshot = async (formElement) => {
  const form = new FormData(formElement);
  await api("/api/market-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: form.get("symbol"),
      price: form.get("price"),
      changePct: form.get("changePct"),
      relativeMarketPct: form.get("relativeMarketPct"),
      volumeRatio: form.get("volumeRatio")
    })
  });
  formElement.reset();
  await api("/api/reviews/weekly/regenerate", { method: "POST" });
  await Promise.all([renderOpportunities(), renderDailyReport(), renderPriorityWatch(), renderWatchlist(), renderReview()]);
};

const submitPerformance = async (formElement) => {
  const form = new FormData(formElement);
  const watchlistId = form.get("watchlistId");
  await api(`/api/watchlist/${watchlistId}/performance`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      t1: numberOrNull(form.get("t1")),
      t3: numberOrNull(form.get("t3")),
      t5: numberOrNull(form.get("t5")),
      t10: numberOrNull(form.get("t10")),
      t20: numberOrNull(form.get("t20")),
      relativeMarket: numberOrNull(form.get("relativeMarket")),
      relativeIndustry: numberOrNull(form.get("relativeIndustry")),
      maxDrawdown: numberOrNull(form.get("maxDrawdown")),
      volumeChange: numberOrNull(form.get("volumeChange")),
      followupCatalyst: form.get("followupCatalyst") === "true",
      riskTriggered: form.get("riskTriggered") === "true",
      verdict: form.get("verdict") || "内测手动更新",
      review: form.get("review") || "由内测页面手动录入。"
    })
  });
  await api("/api/reviews/weekly/regenerate", { method: "POST" });
  formElement.reset();
  await Promise.all([renderDailyReport(), renderPriorityWatch(), renderWatchlist(), renderReview()]);
};

const runDailyUpdate = async () => {
  const button = $("#dailyRunButton");
  button.disabled = true;
  try {
    const result = await api("/api/daily-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 7, markets: ["US", "HK"] })
    });
    showToast(`每日更新完成：导入${result.imported}条，失败${result.failed}条，状态${result.status}`, result.failed ? "info" : "success");
    await Promise.all([
      renderOpportunities(),
      renderDailyReport(),
      renderPriorityWatch(),
      renderWatchlist(),
      renderReview(),
      renderIngestionRuns(),
      renderSystemStatus(),
      renderUpdateSchedule(),
      renderModel()
    ]);
  } finally {
    button.disabled = false;
  }
};

const collectDisclosures = async (markets) => {
  const buttons = [$("#collectAllButton"), $("#collectUsButton"), $("#collectHkButton")];
  buttons.forEach((button) => (button.disabled = true));
  try {
    const result = await api("/api/collect/disclosures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markets, days: 7 })
    });
    showToast(`采集完成：导入${result.run.imported}条，状态${result.run.status}`, "success");
    await Promise.all([renderOpportunities(), renderDailyReport(), renderPriorityWatch(), renderWatchlist(), renderIngestionRuns(), renderSystemStatus()]);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
};

const collectNews = async () => {
  const button = $("#collectNewsButton");
  button.disabled = true;
  try {
    const result = await api("/api/collect/news", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 7 })
    });
    showToast(`新闻采集完成：导入${result.run.imported}条，状态${result.run.status}`, result.errors.length ? "info" : "success");
    await Promise.all([renderOpportunities(), renderDailyReport(), renderPriorityWatch(), renderWatchlist(), renderIngestionRuns(), renderSystemStatus()]);
  } finally {
    button.disabled = false;
  }
};

const refreshMarketSnapshots = async () => {
  const button = $("#refreshMarketButton");
  button.disabled = true;
  try {
    const result = await api("/api/market/refresh", { method: "POST" });
    showToast(`行情刷新完成：更新${result.imported}只，同步走势${result.performanceSynced || 0}条，失败${result.failed}只`, result.failed ? "info" : "success");
    await api("/api/reviews/weekly/regenerate", { method: "POST" });
    await Promise.all([renderOpportunities(), renderDailyReport(), renderPriorityWatch(), renderWatchlist(), renderReview(), renderSystemStatus()]);
  } finally {
    button.disabled = false;
  }
};

const pushFeishu = async (path, successMessage) => {
  const result = await api(path, { method: "POST" });
  if (result.skipped) {
    showToast(result.error, "info");
    return;
  }
  showToast(successMessage, result.ok ? "success" : "error");
};

const testBroker = async (path, successMessage) => {
  const result = await api(path, { method: "POST" });
  if (!result.ok) {
    const message = result.error || (result.missing?.length ? `缺少配置：${result.missing.join(", ")}` : "券商 API 测试未通过");
    showToast(message, "error");
    return;
  }
  showToast(successMessage, "success");
};

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  return Number(value);
};

const initNavigation = () => {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.remove("active"));
      $$(".view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
    });
  });
};

const initEvents = () => {
  $("#searchInput").addEventListener("input", (event) => {
    state.filters.q = event.target.value;
    Promise.all([renderOpportunities(), renderDailyReport()]);
  });
  $("#marketFilter").addEventListener("change", (event) => {
    state.filters.market = event.target.value;
    Promise.all([renderOpportunities(), renderDailyReport()]);
  });
  $("#gradeFilter").addEventListener("change", (event) => {
    state.filters.grade = event.target.value;
    Promise.all([renderOpportunities(), renderDailyReport()]);
  });
  $("#opportunityGrid").addEventListener("click", async (event) => {
    const detailId = event.target.dataset.detail;
    const watchId = event.target.dataset.watch;
    const actionId = event.target.dataset.action;
    if (detailId) await renderDetail(detailId);
    if (watchId) await addToWatchlist(watchId);
    if (actionId) await recordPersonalAction(actionId);
  });
  $("#backupButton").addEventListener("click", async () => {
    await withToast(async () => {
      const backup = await api("/api/system/backup", { method: "POST" });
      return backup;
    }, "备份已完成");
  });
  $("#copyDailyReportButton").addEventListener("click", async () => {
    const text = $("#dailyReportTable").dataset.copyText || "";
    if (!text) {
      showToast("暂无可复制的每日表格", "info");
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast("每日表格已复制", "success");
  });
  $("#detailContent").addEventListener("click", async (event) => {
    const watchId = event.target.dataset.watch;
    if (!watchId) return;
    await addToWatchlist(watchId);
  });
  $("#eventForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitEvent(event.currentTarget);
  });
  $("#marketForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitMarketSnapshot(event.currentTarget);
  });
  $("#performanceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPerformance(event.currentTarget);
  });
  $("#updateScheduleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitUpdateSchedule(event.currentTarget);
  });
  $("#systemHealthPanel").addEventListener("click", async (event) => {
    if (event.target.id === "runDueButton") await runDueTasks();
  });
  $("#dailyRunButton").addEventListener("click", () => runDailyUpdate());
  $("#collectAllButton").addEventListener("click", () => collectDisclosures(["US", "HK"]));
  $("#collectUsButton").addEventListener("click", () => collectDisclosures(["US"]));
  $("#collectHkButton").addEventListener("click", () => collectDisclosures(["HK"]));
  $("#collectNewsButton").addEventListener("click", () => collectNews());
  $("#refreshMarketButton").addEventListener("click", () => refreshMarketSnapshots());
  $("#feishuTestButton").addEventListener("click", () => pushFeishu("/api/feishu/test", "飞书测试消息已发送"));
  $("#feishuDailyButton").addEventListener("click", () => pushFeishu("/api/feishu/push/daily", "飞书每日榜已发送"));
  $("#feishuRiskButton").addEventListener("click", () => pushFeishu("/api/feishu/push/risk", "飞书风险提醒已发送"));
  $("#futuTestButton").addEventListener("click", () => testBroker("/api/brokers/futu/test", "富途 OpenD 连接正常"));
  $("#tigerTestButton").addEventListener("click", () => testBroker("/api/brokers/tiger/test", "老虎配置检查通过"));
  $("#ibkrTestButton").addEventListener("click", () => testBroker("/api/brokers/ibkr/test", "IBKR TWS / Gateway 连接正常"));
  $("#chiefTestButton").addEventListener("click", () => testBroker("/api/brokers/chief/test", "致富证券官方 API 检查通过"));
  $("#feishuConfigForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await withToast(async () => {
      await api("/api/feishu/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          webhookUrl: form.get("webhookUrl"),
          appId: form.get("appId"),
          appSecret: form.get("appSecret"),
          verificationToken: form.get("verificationToken")
        })
      });
      formElement.reset();
      await renderFeishuStatus();
    }, "飞书配置已保存");
  });
  $("#brokerConfigForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await withToast(async () => {
      await api("/api/brokers/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          futuEnabled: form.get("futuEnabled") === "on",
          futuHost: form.get("futuHost"),
          futuPort: form.get("futuPort"),
          tigerEnabled: form.get("tigerEnabled") === "on",
          tigerClientId: form.get("tigerClientId"),
          tigerAccount: form.get("tigerAccount"),
          tigerPrivateKeyPath: form.get("tigerPrivateKeyPath"),
          tigerLicense: form.get("tigerLicense"),
          tigerSandbox: form.get("tigerSandbox") === "on",
          ibkrEnabled: form.get("ibkrEnabled") === "on",
          ibkrHost: form.get("ibkrHost"),
          ibkrPort: form.get("ibkrPort"),
          ibkrMode: form.get("ibkrMode"),
          chiefEnabled: form.get("chiefEnabled") === "on",
          chiefOfficialApiUrl: form.get("chiefOfficialApiUrl"),
          chiefApiNote: form.get("chiefApiNote")
        })
      });
      formElement.dataset.loaded = "";
      await renderBrokerStatus();
    }, "券商配置已保存");
  });
  $("#sourceStockForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const market = form.get("market");
    await withToast(async () => {
      await api(`/api/data-sources/${market}/stocks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: form.get("symbol"),
          code: form.get("code"),
          stockName: form.get("stockName"),
          cik: form.get("cik"),
          industry: form.get("industry")
        })
      });
      formElement.reset();
      await Promise.all([renderSourceConfig(), renderSystemStatus()]);
    }, "采集池已更新");
  });
  $("#sourceConfig").addEventListener("click", async (event) => {
    const value = event.target.dataset.removeSource;
    if (!value) return;
    const [market, symbol] = value.split(":");
    await withToast(async () => {
      await api(`/api/data-sources/${market}/stocks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      await Promise.all([renderSourceConfig(), renderSystemStatus()]);
    }, "已从采集池删除");
  });
  $("#newsFeedForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await withToast(async () => {
      await api("/api/news-feeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          url: form.get("url"),
          sourceCredibility: form.get("sourceCredibility")
        })
      });
      formElement.reset();
      await renderNewsFeeds();
    }, "新闻源已更新");
  });
  $("#newsFeeds").addEventListener("click", async (event) => {
    const id = event.target.dataset.removeFeed;
    if (!id) return;
    await withToast(async () => {
      await api(`/api/news-feeds/${encodeURIComponent(id)}`, { method: "DELETE" });
      await renderNewsFeeds();
    }, "新闻源已删除");
  });
  $("#industryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const id = form.get("id");
    await api(id ? `/api/custom-industries/${encodeURIComponent(id)}` : "/api/custom-industries", {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        keywords: parseList(form.get("keywords") || ""),
        stockPool: parseList(form.get("stockPool") || ""),
        priority: form.get("priority"),
        enabled: true,
        pushEnabled: false
      })
    });
    resetIndustryForm();
    await renderIndustries();
  });
  $("#industryCancelButton").addEventListener("click", resetIndustryForm);
  $("#industryList").addEventListener("click", async (event) => {
    const editId = event.target.dataset.editIndustry;
    const deleteId = event.target.dataset.deleteIndustry;
    if (editId) {
      editIndustry(editId);
      return;
    }
    if (!deleteId) return;
    if (!confirm("确认删除这个自定义行业？")) return;
    await withToast(async () => {
      await api(`/api/custom-industries/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
      resetIndustryForm();
      await renderIndustries();
    }, "自定义行业已删除");
  });
  $("#modelWeights").addEventListener("click", async (event) => {
    const suggestionId = event.target.dataset.confirmModel;
    if (!suggestionId) return;
    await api(`/api/model/suggestions/${suggestionId}/confirm`, { method: "POST" });
    await renderModel();
  });
  $("#closeDialog").addEventListener("click", () => $("#detailDialog").close());
};

const bootstrap = async () => {
  initNavigation();
  initEvents();
  await Promise.all([
    renderOpportunities(),
    renderDailyReport(),
    renderSystemStatus(),
    renderPriorityWatch(),
    renderWatchlist(),
    renderPersonalActions(),
    renderSourceConfig(),
    renderNewsFeeds(),
    renderFeishuStatus(),
    renderBrokerStatus(),
    renderIngestionRuns(),
    renderUpdateSchedule(),
    renderReview(),
    renderIndustries(),
    renderModel()
  ]);
};

if (isFilePreview()) {
  renderFilePreviewNotice();
} else {
  bootstrap().catch((error) => {
    document.body.innerHTML = `<main class="app"><h1>加载失败</h1><p>${error.message}</p></main>`;
  });
}
