(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const colors = [
    "#3b82f6",
    "#22c55e",
    "#eab308",
    "#f97316",
    "#a855f7",
    "#14b8a6",
    "#ef4444",
    "#ec4899",
  ];
  const columnWidth = 16;
  const pad = 16;
  let lastRows = [];
  let graphSvg = null;
  let commitList = null;

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !root) {
      return;
    }
    if (message.type === "empty") {
      renderEmpty(message.text || "");
    } else if (message.type === "history") {
      renderHistory(message);
    }
  });

  root?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const pill = target.closest("[data-ref]");
    if (pill instanceof HTMLElement && pill.dataset.ref) {
      vscode.postMessage({
        type: "ref",
        name: pill.dataset.ref,
        kind: pill.dataset.kind,
      });
      event.stopPropagation();
      return;
    }
    const row = target.closest("[data-hash]");
    if (row instanceof HTMLElement && row.dataset.hash) {
      vscode.postMessage({ type: "commit", hash: row.dataset.hash });
    }
  });

  root?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.ref) {
      vscode.postMessage({
        type: "ref",
        name: target.dataset.ref,
        kind: target.dataset.kind,
      });
      event.preventDefault();
      return;
    }
    const row = target.closest("[data-hash]");
    if (row instanceof HTMLElement && row.dataset.hash) {
      vscode.postMessage({ type: "commit", hash: row.dataset.hash });
      event.preventDefault();
    }
  });

  vscode.postMessage({ type: "ready" });

  function renderEmpty(text) {
    if (!root) {
      return;
    }
    root.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "empty";
    paragraph.textContent = text;
    root.appendChild(paragraph);
  }

  function renderHistory(message) {
    if (!root) {
      return;
    }
    root.replaceChildren();
    graphSvg = null;
    commitList = null;
    lastRows = [];
    const header = document.createElement("div");
    header.className = "header";
    header.textContent = message.title || "";
    root.appendChild(header);
    if (!message.rows || message.rows.length === 0) {
      const paragraph = document.createElement("p");
      paragraph.className = "empty";
      paragraph.textContent = message.emptyText || "";
      root.appendChild(paragraph);
      return;
    }
    const history = document.createElement("div");
    history.className = "history";
    graphSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    graphSvg.classList.add("graph");
    commitList = document.createElement("div");
    commitList.className = "commits";
    lastRows = message.rows;
    for (const row of message.rows) {
      commitList.appendChild(renderRow(row));
    }
    history.append(graphSvg, commitList);
    root.appendChild(history);
    requestAnimationFrame(drawGraph);
  }

  function renderRow(row) {
    const article = document.createElement("div");
    article.className = "row";
    article.dataset.hash = row.hash;
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.title = row.hash;

    const meta = document.createElement("div");
    meta.className = "meta";
    const subject = document.createElement("div");
    subject.className = "subject";
    subject.textContent = row.subject || row.shortHash;
    const details = document.createElement("div");
    details.className = "details";
    details.textContent = [row.shortHash, row.author, row.date]
      .filter(Boolean)
      .join("  ");
    meta.append(subject, details);
    if (row.refs && row.refs.length > 0) {
      const refs = document.createElement("div");
      refs.className = "refs";
      for (const ref of row.refs) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `ref ${ref.kind}`;
        pill.dataset.ref = ref.name;
        pill.dataset.kind = ref.kind;
        pill.textContent = ref.name;
        refs.appendChild(pill);
      }
      meta.appendChild(refs);
    }
    article.appendChild(meta);
    return article;
  }

  function drawGraph() {
    if (!graphSvg || !commitList || lastRows.length === 0) {
      return;
    }
    const articles = [...commitList.children];
    if (articles.length !== lastRows.length) {
      return;
    }
    const heights = articles.map((article) => article.offsetHeight);
    if (heights.some((height) => height <= 0)) {
      return;
    }
    const laneCount = Math.max(...lastRows.map((row) => row.laneCount || 1), 1);
    const width = pad + laneCount * columnWidth;
    const total = heights.reduce((sum, height) => sum + height, 0);
    graphSvg.setAttribute("width", String(width));
    graphSvg.setAttribute("height", String(total));
    graphSvg.setAttribute("viewBox", `0 0 ${width} ${total}`);
    graphSvg.replaceChildren();
    const x = (lane) => pad + lane * columnWidth;
    let top = 0;
    const bands = heights.map((height) => {
      const band = { top, bottom: top + height, center: top + 22 };
      top += height;
      return band;
    });
    lastRows.forEach((row, index) => {
      const band = bands[index];
      for (const lane of row.through || []) {
        graphSvg.appendChild(
          drawLine(
            x(lane),
            band.top - 1,
            x(lane),
            band.bottom + 1,
            color(lane),
          ),
        );
      }
      if (row.fromAbove) {
        graphSvg.appendChild(
          drawLine(
            x(row.lane),
            band.top - 1,
            x(row.lane),
            band.center,
            color(row.lane),
          ),
        );
      }
      for (const parent of row.parentLanes || []) {
        graphSvg.appendChild(
          drawCurve(
            x(row.lane),
            band.center,
            x(parent),
            band.bottom + 1,
            color(parent),
          ),
        );
      }
    });
    lastRows.forEach((row, index) => {
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", String(x(row.lane)));
      circle.setAttribute("cy", String(bands[index].center));
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", color(row.lane));
      graphSvg.appendChild(circle);
    });
  }

  window.addEventListener("resize", () => requestAnimationFrame(drawGraph));

  function drawLine(x1, y1, x2, y2, stroke) {
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    element.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
    element.setAttribute("stroke", stroke);
    element.setAttribute("fill", "none");
    element.setAttribute("stroke-width", "2");
    element.setAttribute("stroke-linecap", "butt");
    return element;
  }

  function drawCurve(x1, y1, x2, y2, stroke) {
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    const midY = y1 + (y2 - y1) * 0.55;
    const path =
      x1 === x2
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    element.setAttribute("d", path);
    element.setAttribute("stroke", stroke);
    element.setAttribute("fill", "none");
    element.setAttribute("stroke-width", "2");
    element.setAttribute("stroke-linecap", "butt");
    return element;
  }

  function color(lane) {
    return colors[Math.abs(lane) % colors.length];
  }
})();
