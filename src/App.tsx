import { useEffect, useMemo, useRef, useState } from "react";

type Expense = {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  createdAt: number;
};

const STORAGE_KEY = "daily-expense-tracker-v1";
const LOCAL_BACKUP_ENDPOINT = "http://127.0.0.1:46729/backup";

const categories = ["吃饭", "日用", "其他"];

const normalizeCategory = (value: unknown) => {
  const category = typeof value === "string" ? value.trim() : "";
  if (categories.includes(category)) return category;
  if (["餐饮", "早餐", "午饭", "晚饭", "夜宵", "外卖", "咖啡", "奶茶"].includes(category)) {
    return "吃饭";
  }
  if (["交通", "购物", "娱乐", "住房", "医疗", "学习", "人情"].includes(category)) {
    return "日用";
  }
  return "其他";
};

const normalizeExpense = (item: Expense): Expense => ({
  ...item,
  category: normalizeCategory(item.category),
});

const todayString = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const currency = (n: number) => `¥${n.toFixed(2)}`;

const dateStringFromOffset = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const shortDate = (date: string) => date.slice(5).replace("-", "/");

const makeTrendBuckets = (items: Expense[], range: 7 | 28) => {
  if (range === 7) {
    return Array.from({ length: 7 }, (_, index) => {
      const date = dateStringFromOffset(index - 6);
      const total = items
        .filter((item) => item.date === date)
        .reduce((sum, item) => sum + item.amount, 0);
      return { key: date, label: shortDate(date), total };
    });
  }

  return Array.from({ length: 4 }, (_, index) => {
    const startOffset = -27 + index * 7;
    const endOffset = index === 3 ? 0 : startOffset + 6;
    const start = dateStringFromOffset(startOffset);
    const end = dateStringFromOffset(endOffset);
    const total = items
      .filter((item) => item.date >= start && item.date <= end)
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      key: `${start}-${end}`,
      label: `${shortDate(start)}-${shortDate(end)}`,
      total,
    };
  });
};

const defaultSort = (list: Expense[]) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? defaultSort((parsed as Expense[]).map(normalizeExpense)) : [];
    } catch {
      return [];
    }
  });

  const [date, setDate] = useState(todayString());
  const [category, setCategory] = useState("吃饭");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<7 | 28>(7);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1200);

    fetch(LOCAL_BACKUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: expenses }),
      signal: controller.signal,
    }).catch(() => {
      // The local backup helper is optional; the app should stay quiet if it is not running.
    }).finally(() => {
      window.clearTimeout(timeout);
    });

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((item) => {
      const matchesSearch =
        !search ||
        item.category.includes(search) ||
        item.note.toLowerCase().includes(search.toLowerCase()) ||
        String(item.amount).includes(search);

      const matchesDate = !filterDate || item.date === filterDate;
      const matchesSelected = !showSelectedOnly || selectedIds.includes(item.id);

      return matchesSearch && matchesDate && matchesSelected;
    });
  }, [expenses, search, filterDate, showSelectedOnly, selectedIds]);

  const todayTotal = useMemo(() => {
    const today = todayString();
    return expenses
      .filter((item) => item.date === today)
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const monthTotal = useMemo(() => {
    const prefix = todayString().slice(0, 7);
    return expenses
      .filter((item) => item.date.startsWith(prefix))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const categorySummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filteredExpenses) {
      map.set(item.category, (map.get(item.category) || 0) + item.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filteredExpenses]);

  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => sum + item.amount, 0);
  }, [filteredExpenses]);

  const activeDayCount = useMemo(() => {
    return new Set(filteredExpenses.map((item) => item.date)).size;
  }, [filteredExpenses]);

  const averageDaily = activeDayCount === 0 ? 0 : filteredTotal / activeDayCount;
  const averagePerExpense =
    filteredExpenses.length === 0 ? 0 : filteredTotal / filteredExpenses.length;
  const biggestExpense = filteredExpenses.reduce<Expense | null>((winner, item) => {
    if (!winner || item.amount > winner.amount) return item;
    return winner;
  }, null);
  const topCategory = categorySummary[0];

  const trendData = useMemo(() => {
    return makeTrendBuckets(filteredExpenses, trendRange);
  }, [filteredExpenses, trendRange]);

  const trendMax = Math.max(...trendData.map((item) => item.total), 1);
  const trendTotal = trendData.reduce((sum, item) => sum + item.total, 0);
  const trendActiveDays = trendData.filter((item) => item.total > 0).length;
  const trendAverage = trendActiveDays === 0 ? 0 : trendTotal / trendActiveDays;
  const trendPeak = trendData.reduce((winner, item) => {
    if (!winner || item.total > winner.total) return item;
    return winner;
  }, trendData[0]);

  const selectedTotal = useMemo(() => {
    return expenses
      .filter((item) => selectedIds.includes(item.id))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses, selectedIds]);

  const exportText = useMemo(() => JSON.stringify(expenses, null, 2), [expenses]);

  const addExpense = () => {
    const value = Number(amount);
    if (!date || Number.isNaN(value) || value <= 0) return;

    const newExpense: Expense = {
      id: crypto.randomUUID(),
      date,
      category,
      amount: value,
      note: note.trim(),
      createdAt: Date.now(),
    };

    setExpenses((prev) => defaultSort([newExpense, ...prev]));
    setAmount("");
    setNote("");
  };

  const removeExpense = (id: string) => {
    setExpenses((prev) => prev.filter((item) => item.id !== id));
    setSelectedIds((prev) => prev.filter((itemId) => itemId !== id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
  };

  const allFilteredSelected =
    filteredExpenses.length > 0 &&
    filteredExpenses.every((item) => selectedIds.includes(item.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !filteredExpenses.some((item) => item.id === id))
      );
    } else {
      setSelectedIds((prev) => {
        const merged = new Set([...prev, ...filteredExpenses.map((item) => item.id)]);
        return [...merged];
      });
    }
  };

  const removeSelectedExpenses = () => {
    if (selectedIds.length === 0) return;
    setExpenses((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
    setSelectedIds([]);
    setShowSelectedOnly(false);
  };

  const resetToDefaultOrder = () => {
    setExpenses((prev) => defaultSort(prev));
  };

  const sortByCategory = () => {
    setExpenses((prev) =>
      [...prev].sort((a, b) => {
        const categoryCompare = a.category.localeCompare(b.category, "zh-Hans-CN");
        if (categoryCompare !== 0) return categoryCompare;
        return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
      })
    );
  };

  const moveFilteredItem = (fromId: string | null, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;

    const filteredIds = filteredExpenses.map((item) => item.id);

    setExpenses((prev) => {
      const prevCopy = [...prev];
      const subset = prevCopy.filter((item) => filteredIds.includes(item.id));
      const oldIndex = subset.findIndex((item) => item.id === fromId);
      const newIndex = subset.findIndex((item) => item.id === toId);

      if (oldIndex === -1 || newIndex === -1) return prev;

      const movedItem = subset[oldIndex];
      const newSubset = [...subset];
      newSubset.splice(oldIndex, 1);
      newSubset.splice(newIndex, 0, movedItem);

      let subsetPointer = 0;

      return prevCopy.map((item) =>
        filteredIds.includes(item.id) ? newSubset[subsetPointer++] : item
      );
    });
  };

  const exportJSON = () => {
    try {
      const blob = new Blob([exportText], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expenses-${todayString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setShowExportPanel(true);
    }
  };

  const copyExportText = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      window.alert("数据已复制到剪贴板。");
    } catch {
      window.alert("复制失败，请手动复制。");
    }
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const importJSON = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed)) {
        window.alert("导入失败：文件内容不是数组格式。");
        return;
      }

      const normalized: Expense[] = parsed
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
        .map((item, index: number) => ({
          id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
          date:
            typeof item.date === "string" && item.date.length >= 10
              ? item.date.slice(0, 10)
              : todayString(),
          amount: Number(item.amount) > 0 ? Number(item.amount) : 0,
          category: normalizeCategory(item.category),
          note: typeof item.note === "string" ? item.note : "",
          createdAt:
            typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
              ? item.createdAt
              : Date.now() + index,
        }))
        .filter((item) => item.amount > 0);

      setExpenses(defaultSort(normalized));
      setSelectedIds([]);
      setShowSelectedOnly(false);
      window.alert(`导入成功，共导入 ${normalized.length} 条记录。`);
    } catch {
      window.alert("导入失败：请选择正确的 JSON 文件。");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="topbar">
          <div>
            <h1>每日开支记录</h1>
            <p className="subtitle">每天随手记账，自动统计与筛选。</p>
          </div>

          <div className="button-row">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importJSON}
            />
            <button className="btn btn-secondary" onClick={triggerImport}>
              导入数据
            </button>
            <button className="btn" onClick={exportJSON}>
              导出数据
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowExportPanel((prev) => !prev)}
            >
              {showExportPanel ? "收起导出面板" : "显示导出面板"}
            </button>
          </div>
        </div>

        {showExportPanel && (
          <div className="card export-panel">
            <div className="section-head">
              <h2>导出数据面板</h2>
              <div className="button-row">
                <button className="btn btn-secondary" onClick={copyExportText}>
                  复制 JSON
                </button>
                <button className="btn" onClick={exportJSON}>
                  再试一次下载
                </button>
              </div>
            </div>
            <p className="tip">如果下载被拦截，可以复制下面内容并保存为 .json 文件。</p>
            <textarea className="export-textarea" readOnly value={exportText} />
          </div>
        )}

        <div className="workbench-grid">
          <div className="card entry-card">
            <h2>新增一笔开支</h2>

            <div className="form-grid">
              <div className="field">
                <label>日期</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>备注</label>
                <input
                  placeholder="例如 午饭、地铁、牙膏"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>分类</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>金额</label>
                <input
                  type="number"
                  placeholder="例如 18.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            <button className="btn full-width" onClick={addExpense}>
              保存这笔开支
            </button>
          </div>

          <div className="summary-panel">
            <div className="stats-grid compact-stats">
              <div className="card stat-card">
                <div className="stat-title">今日支出</div>
                <div className="stat-value">{currency(todayTotal)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-title">本月支出</div>
                <div className="stat-value">{currency(monthTotal)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-title">记录条数</div>
                <div className="stat-value">{expenses.length}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-title">筛选合计</div>
                <div className="stat-value">{currency(filteredTotal)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card analytics-card">
          <div className="section-head compact-head">
            <div>
              <h2>支出分析</h2>
              <p className="tip">统计会跟随搜索、日期筛选和“只看已勾选项”变化。</p>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="chart-panel">
              <h3>分类占比</h3>
              <div className="category-list compact">
                {categorySummary.length === 0 ? (
                  <p className="muted">暂无可统计的分类。</p>
                ) : (
                  categorySummary.map(([name, total]) => {
                    const percent = filteredTotal === 0 ? 0 : (total / filteredTotal) * 100;

                    return (
                      <div key={name} className="category-item">
                        <div className="category-row">
                          <span>{name}</span>
                          <strong>
                            {currency(total)} · {percent.toFixed(0)}%
                          </strong>
                        </div>
                        <div className="progress">
                          <div className="progress-bar" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="chart-panel">
              <div className="panel-head">
                <h3>{trendRange === 7 ? "最近 7 天" : "最近 4 周"}</h3>
                <div className="range-toggle" aria-label="趋势范围">
                  <button
                    className={trendRange === 7 ? "active" : ""}
                    type="button"
                    onClick={() => setTrendRange(7)}
                  >
                    7天
                  </button>
                  <button
                    className={trendRange === 28 ? "active" : ""}
                    type="button"
                    onClick={() => setTrendRange(28)}
                  >
                    4周
                  </button>
                </div>
              </div>
              <div className={`bar-chart ${trendRange === 28 ? "bar-chart-weekly" : ""}`}>
                {trendData.map((item) => {
                  const height = item.total === 0 ? 4 : Math.max(10, (item.total / trendMax) * 100);

                  return (
                    <div key={item.key} className="bar-item" title={`${item.label} ${currency(item.total)}`}>
                      <div className="bar-value">{item.total ? currency(item.total) : "¥0"}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ height: `${height}%` }} />
                      </div>
                      <div className="bar-label">{item.label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="range-summary">
                <span>合计 {currency(trendTotal)}</span>
                <span>日均 {currency(trendAverage)}</span>
                <span>峰值 {trendPeak ? `${trendPeak.label} ${currency(trendPeak.total)}` : "暂无"}</span>
              </div>
            </div>

            <div className="chart-panel">
              <h3>关键指标</h3>
              <div className="insight-list">
                <div className="insight-item">
                  <span>日均支出</span>
                  <strong>{currency(averageDaily)}</strong>
                </div>
                <div className="insight-item">
                  <span>单笔均值</span>
                  <strong>{currency(averagePerExpense)}</strong>
                </div>
                <div className="insight-item">
                  <span>最大单笔</span>
                  <strong>{biggestExpense ? currency(biggestExpense.amount) : "¥0.00"}</strong>
                  <em>{biggestExpense ? `${biggestExpense.date} ${biggestExpense.note || biggestExpense.category}` : "暂无"}</em>
                </div>
                <div className="insight-item">
                  <span>最高分类</span>
                  <strong>{topCategory ? topCategory[0] : "暂无"}</strong>
                  <em>{topCategory ? currency(topCategory[1]) : "暂无数据"}</em>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <h2>开支明细</h2>
            <div className="button-row">
              <button className="btn btn-secondary" onClick={sortByCategory}>
                按分类排序
              </button>
              <button className="btn btn-secondary" onClick={resetToDefaultOrder}>
                恢复默认排序
              </button>
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-info">
              当前显示 <strong>{filteredExpenses.length}</strong> 条，已选{" "}
              <strong>{selectedIds.length}</strong> 项，合计{" "}
              <strong>{currency(selectedTotal)}</strong>
            </div>
            <div className="button-row">
              <button
                className="btn btn-secondary"
                onClick={() => setShowSelectedOnly((prev) => !prev)}
              >
                {showSelectedOnly ? "显示全部" : "只看已勾选项"}
              </button>
              <button className="btn btn-secondary" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected ? "清空勾选" : "全选当前列表"}
              </button>
              <button
                className="btn btn-danger"
                onClick={removeSelectedExpenses}
                disabled={selectedIds.length === 0}
              >
                删除勾选项
              </button>
            </div>
          </div>

          <div className="filter-grid">
            <input
              placeholder="搜索分类、备注、金额"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="empty">还没有记录，先新增一笔吧。</div>
          ) : (
            <div className="table-wrap">
              <div className="table">
                <div className="table-head row">
                  <div></div>
                  <div></div>
                  <div>日期</div>
                  <div>分类</div>
                  <div>备注</div>
                  <div className="text-right">金额</div>
                  <div className="text-right">操作</div>
                </div>

                {filteredExpenses.map((item) => (
                  <div
                    key={item.id}
                    className={`row ${draggedId === item.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDraggedId(item.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      moveFilteredItem(draggedId, item.id);
                      setDraggedId(null);
                    }}
                    onDragEnd={() => setDraggedId(null)}
                  >
                    <div>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelect(item.id)}
                      />
                    </div>
                    <div className="drag-handle">≡</div>
                    <div>{item.date}</div>
                    <div>
                      <span className="tag">{item.category}</span>
                    </div>
                    <div className="truncate">{item.note || ""}</div>
                    <div className="text-right">{currency(item.amount)}</div>
                    <div className="text-right">
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => removeExpense(item.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
