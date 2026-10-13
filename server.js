"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3099;
const ROOT = __dirname;
const SAVES_DIR = path.join(ROOT, "saves");
const PUBLIC_DIR = path.join(ROOT, "public");

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });

function safeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .slice(0, 32);
}

function savePath(player) {
  return path.join(SAVES_DIR, safeName(player) + ".json");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
  };
  return map[ext] || "application/octet-stream";
}

function serveStatic(reqPath, res) {
  let rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");

  const full = path.resolve(PUBLIC_DIR, rel);

  if (!full.startsWith(path.resolve(PUBLIC_DIR) + path.sep) && full !== path.resolve(PUBLIC_DIR)) {
    sendJSON(res, 403, { error: "Forbidden" });
    return;
  }

  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    let listing = [];
    try {
      listing = fs.readdirSync(PUBLIC_DIR);
    } catch (e) {
      listing = ["(cannot read public dir: " + e.message + ")"];
    }
    sendJSON(res, 404, {
      error: "Not found",
      path: rel,
      publicDir: PUBLIC_DIR,
      publicExists: fs.existsSync(PUBLIC_DIR),
      filesInPublic: listing
    });
    return;
  }

  const data = fs.readFileSync(full);
  res.writeHead(200, {
    "Content-Type": contentType(full),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const p = parsed.pathname || "/";

  try {
    if (p === "/api/health") {
      return sendJSON(res, 200, {
        ok: true,
        time: Date.now(),
        publicExists: fs.existsSync(PUBLIC_DIR),
        files: fs.existsSync(PUBLIC_DIR) ? fs.readdirSync(PUBLIC_DIR) : []
      });
    }

    if (p === "/api/players" && req.method === "GET") {
      const files = fs.existsSync(SAVES_DIR)
        ? fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json"))
        : [];
      const players = files.map((f) => {
        const name = f.replace(/\.json$/, "");
        let meta = { name, updatedAt: null, legacy: 0, captured: 0 };
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), "utf8"));
          meta.updatedAt = data.savedAt || null;
          meta.legacy = (data.zoo || []).reduce((s, z) => s + (z.points || 0), 0);
          meta.captured = (data.captured || []).length;
        } catch (_) {}
        return meta;
      });
      players.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return sendJSON(res, 200, { players });
    }

    const saveMatch = p.match(/^\/api\/save\/([^/]+)$/);
    if (saveMatch) {
      const player = safeName(decodeURIComponent(saveMatch[1]));
      if (!player) return sendJSON(res, 400, { error: "Invalid player name" });
      const file = savePath(player);

      if (req.method === "GET") {
        if (!fs.existsSync(file)) return sendJSON(res, 404, { error: "No save found" });
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return sendJSON(res, 200, data);
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const payload = Object.assign({}, body, { player, savedAt: Date.now() });
        fs.writeFileSync(file, JSON.stringify(payload));
        return sendJSON(res, 200, { ok: true, player, savedAt: payload.savedAt });
      }
      if (req.method === "DELETE") {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return sendJSON(res, 200, { ok: true });
      }
    }

    return serveStatic(p, res);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Wild Portfolio server at port " + PORT);
  console.log("PUBLIC_DIR =", PUBLIC_DIR, "exists =", fs.existsSync(PUBLIC_DIR));
  if (fs.existsSync(PUBLIC_DIR)) {
    console.log("Files:", fs.readdirSync(PUBLIC_DIR).join(", "));
  }
});
