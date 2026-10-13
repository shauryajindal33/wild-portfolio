"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3099;
const SAVES_DIR = path.join(__dirname, "saves");
const PUBLIC_DIR = path.join(__dirname, "public");

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

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

function send(res, status, data, type) {
  const body = type === "raw" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": type === "raw" ? "text/html; charset=utf-8" : "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function serveStatic(reqPath, res) {
  let file = reqPath === "/" ? "/index.html" : reqPath;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, { error: "Not found" });
  }
  const ext = path.extname(full).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
  const data = fs.readFileSync(full);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
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
      return send(res, 200, { ok: true, time: Date.now() });
    }

    if (p === "/api/players" && req.method === "GET") {
      const files = fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json"));
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
      return send(res, 200, { players });
    }

    const saveMatch = p.match(/^\/api\/save\/([^/]+)$/);
    if (saveMatch) {
      const player = safeName(decodeURIComponent(saveMatch[1]));
      if (!player) return send(res, 400, { error: "Invalid player name" });
      const file = savePath(player);

      if (req.method === "GET") {
        if (!fs.existsSync(file)) return send(res, 404, { error: "No save found" });
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return send(res, 200, data);
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const payload = Object.assign({}, body, { player, savedAt: Date.now() });
        fs.writeFileSync(file, JSON.stringify(payload));
        return send(res, 200, { ok: true, player, savedAt: payload.savedAt });
      }
      if (req.method === "DELETE") {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return send(res, 200, { ok: true });
      }
    }

    return serveStatic(p, res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Wild Portfolio server at http://localhost:" + PORT);
});
