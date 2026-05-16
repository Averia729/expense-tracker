const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 46729;
const backupDir = path.join(os.homedir(), "Desktop", "记账备份");
const logPath = path.join(backupDir, "backup-log.txt");

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function log(message) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toLocaleString("sv-SE", { hour12: false });
  fs.appendFileSync(logPath, `[${stamp}] ${message}\n`, "utf8");
}

function send(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST" || req.url !== "/backup") {
    send(res, 404, { ok: false, error: "not_found" });
    return;
  }

  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 10 * 1024 * 1024) {
      req.destroy();
    }
  });

  req.on("end", () => {
    try {
      const parsed = JSON.parse(raw || "{}");
      const records = parsed.records;
      if (!Array.isArray(records)) {
        send(res, 400, { ok: false, error: "records_must_be_array" });
        return;
      }

      fs.mkdirSync(backupDir, { recursive: true });
      const formatted = `${JSON.stringify(records, null, 2)}\n`;
      const datedPath = path.join(backupDir, `expenses-${todayString()}.json`);
      const latestPath = path.join(backupDir, "expenses-latest.json");
      fs.writeFileSync(datedPath, formatted, "utf8");
      fs.writeFileSync(latestPath, formatted, "utf8");
      log(`Local web sync backup succeeded: ${datedPath}; records=${records.length}`);
      send(res, 200, { ok: true, count: records.length });
    } catch (error) {
      log(`Local web sync backup failed: ${error instanceof Error ? error.message : String(error)}`);
      send(res, 500, { ok: false, error: "backup_failed" });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`Local expense backup server listening on http://127.0.0.1:${PORT}`);
});
