const $ = (selector) => document.querySelector(selector);

const api = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
};

const gradeClass = (grade) => (grade === "S" || grade === "A" ? "" : `grade-${grade}`);

const render = async () => {
  const data = await api("/api/opportunities?group=stock&limit=50");
  const top = data.items.slice(0, 12);
  const counts = top.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.grade === "S" || item.grade === "A") acc.priority += 1;
      if (item.market === "HK") acc.hk += 1;
      return acc;
    },
    { total: 0, priority: 0, hk: 0 }
  );

  $("#summary").innerHTML = `
    <div class="summary-item"><strong>${counts.total}</strong><span>观察</span></div>
    <div class="summary-item"><strong>${counts.priority}</strong><span>S/A</span></div>
    <div class="summary-item"><strong>${counts.hk}</strong><span>港股</span></div>
  `;

  $("#cards").innerHTML = top
    .map(
      (item) => `
        <article class="card" data-symbol="${item.symbol}">
          <div class="card-head">
            <div>
              <div class="symbol">${item.symbol}</div>
              <div class="muted">${item.stockName}</div>
            </div>
            <div class="grade ${gradeClass(item.grade)}">${item.grade}<br />${item.score}</div>
          </div>
          <div class="tags">
            <span class="tag">${item.market}</span>
            <span class="tag">${item.industry}</span>
            <span class="tag">${item.eventType}</span>
          </div>
          <p>${item.event}</p>
        </article>
      `
    )
    .join("");
};

const renderStock = async (symbol) => {
  const data = await api(`/api/stocks/${encodeURIComponent(symbol)}/brief`);
  const item = data.primaryOpportunity;
  $("#stockDetail").hidden = false;
  $("#stockDetail").innerHTML = `
    <h2>${data.symbol} ${data.stockName}</h2>
    <p class="muted">${data.market} / ${data.industry} / ${data.events.length}条事件</p>
    <p><strong>${item.grade} / ${item.score}</strong></p>
    <p>${item.event}</p>
    <strong>原因</strong>
    <ul>${item.reasons.map((text) => `<li>${text}</li>`).join("")}</ul>
    <strong>风险</strong>
    <ul>${item.risks.map((text) => `<li>${text}</li>`).join("")}</ul>
  `;
  $("#stockDetail").scrollIntoView({ behavior: "smooth", block: "start" });
};

$("#refreshButton").addEventListener("click", render);
$("#queryButton").addEventListener("click", () => {
  const symbol = $("#symbolInput").value.trim();
  if (symbol) renderStock(symbol);
});
$("#cards").addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (card) renderStock(card.dataset.symbol);
});

render();
