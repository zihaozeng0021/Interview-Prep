#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
面试准备 · 本地服务（只用 Python 标准库，无需安装任何依赖）

用法：
  python server.py               启动服务并自动打开浏览器
  python server.py --port 9000   指定端口（默认 8765，被占用时自动顺延）
  python server.py --no-browser  不自动打开浏览器
  python server.py --check       只检查题库格式并输出问题，不启动服务
  python server.py --outline     列出所有岗位 → 页面 → 知识点（及每个知识点的题数），不启动服务

目录约定（数据格式详见 AGENTS.md）：
  web/                     前端页面
  data/positions/<岗位>/   题库：position.json、jd.md、pages/<NN-页面>/{knowledge.md, questions.json}
  data/records/<岗位>.jsonl 作答记录（每行一次作答，程序自动追加）
  data/notes/<岗位>/<页面>.md 页面笔记（网页里编辑并自动保存，也可以直接用编辑器打开）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

if sys.version_info < (3, 8):
    sys.exit("需要 Python 3.8 或更高版本")

try:  # Windows 控制台输出中文时避免编码报错
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
POSITIONS_DIR = DATA_DIR / "positions"
RECORDS_DIR = DATA_DIR / "records"
ARCHIVE_DIR = RECORDS_DIR / "archive"
NOTES_DIR = DATA_DIR / "notes"
NOTE_HISTORY_KEEP = 30     # 每个页面保留的旧版本数
NOTE_SNAPSHOT_GAP = 600    # 连续编辑时，至少间隔这么多秒才留一份旧版本

ID_RE = re.compile(r"^[\w-]+$")                      # 岗位 / 页面 / 知识点 / 题目 id
TITLE_RE = re.compile(r"^#\s+(.+?)\s*$")              # knowledge.md 第一行：# 页面标题
POINT_RE = re.compile(r"^##\s+(.+?)\s*(?:\{#([\w-]+)\})?\s*$")  # ## 知识点标题 {#id}
FENCE_RE = re.compile(r"^\s*(```|~~~)")
PAGE_DIR_RE = re.compile(r"^(\d+)[-_ ]+(.+)$")         # 01-rag -> (1, "rag")
LETTERS = "ABCDEFGH"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
}

records_lock = threading.Lock()
notes_lock = threading.Lock()


# ───────────────────────────── 题库读取与校验 ─────────────────────────────

class Issues:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def error(self, where: str, msg: str) -> None:
        self.items.append({"level": "error", "where": where, "msg": msg})

    def warn(self, where: str, msg: str) -> None:
        self.items.append({"level": "warn", "where": where, "msg": msg})


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")  # 兼容带 BOM 的 UTF-8（记事本保存）


def read_json(path: Path):
    return json.loads(read_text(path))


def visible_dirs(parent: Path) -> list[Path]:
    """子文件夹；以 . 或 _ 开头的视为隐藏/草稿，不加载。"""
    if not parent.is_dir():
        return []
    return [d for d in parent.iterdir() if d.is_dir() and not d.name.startswith((".", "_"))]


def parse_knowledge(text: str, where: str, issues: Issues) -> tuple[str | None, str, list[dict]]:
    """把 knowledge.md 拆成：页面标题、导语、知识点列表（每个 ## 标题是一个知识点）。"""
    title = None
    intro: list[str] = []
    points: list[dict] = []
    current: dict | None = None
    in_fence = False
    fence_mark = ""

    for line in text.splitlines():
        fence = FENCE_RE.match(line)
        if fence:
            mark = fence.group(1)
            if not in_fence:
                in_fence, fence_mark = True, mark
            elif mark == fence_mark:
                in_fence = False
        elif not in_fence:
            if title is None and current is None:
                m = TITLE_RE.match(line)
                if m:
                    title = m.group(1)
                    continue
            m = POINT_RE.match(line)
            if m:
                current = {"id": m.group(2), "title": m.group(1).strip(), "lines": []}
                points.append(current)
                continue
        (current["lines"] if current else intro).append(line)

    seen: set[str] = set()
    out = []
    for i, p in enumerate(points, 1):
        pid = p["id"]
        if not pid:
            pid = f"p{i}"
            issues.warn(where, f"知识点「{p['title']}」缺少 id，请在标题后写 {{#英文id}}，否则题目无法稳定关联")
        if pid in seen:
            issues.error(where, f"知识点 id 重复：{pid}")
            continue
        seen.add(pid)
        out.append({"id": pid, "title": p["title"], "content": "\n".join(p["lines"]).strip()})

    if title is None:
        issues.error(where, "第一行需要是页面标题：# 标题")
    if not out:
        issues.warn(where, "没有知识点（用 ## 标题 {#id} 开始一个知识点）")
    return title, "\n".join(intro).strip(), out


def normalize_answer(answer) -> str:
    if isinstance(answer, list):
        answer = "".join(str(a) for a in answer)
    if not isinstance(answer, str):
        return ""
    return "".join(sorted(set(re.sub(r"[\s,，、/]", "", answer.upper()))))


def load_questions(path: Path, page_id: str, dir_name: str, points: list[dict], issues: Issues) -> list[dict]:
    where = f"{dir_name}/questions.json"
    if not path.exists():
        issues.warn(where, "缺少 questions.json")
        return []
    try:
        data = read_json(path)
    except json.JSONDecodeError as e:
        issues.error(where, f"JSON 格式错误：第 {e.lineno} 行第 {e.colno} 列，{e.msg}")
        return []
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        data = data["questions"]
    if not isinstance(data, list):
        issues.error(where, "内容应为题目数组 [ {...}, {...} ]")
        return []

    point_ids = {p["id"] for p in points}
    seen: set[str] = set()
    out = []
    for i, q in enumerate(data, 1):
        qw = f"{where} 第 {i} 题"
        if not isinstance(q, dict):
            issues.error(qw, "题目应为对象 {...}")
            continue
        qid = str(q.get("id") or "").strip()
        if not qid:
            issues.error(qw, "缺少 id")
            continue
        qw = f"{where}#{qid}"
        if not ID_RE.match(qid):
            issues.error(qw, "id 只能包含字母、数字、下划线、连字符")
            continue
        if qid in seen:
            issues.error(qw, "id 重复")
            continue
        seen.add(qid)

        stem = q.get("stem")
        options = q.get("options")
        if not isinstance(stem, str) or not stem.strip():
            issues.error(qw, "缺少题干 stem")
            continue
        if not isinstance(options, list) or len(options) < 2 or not all(isinstance(o, str) and o.strip() for o in options):
            issues.error(qw, "options 至少需要 2 个非空字符串选项")
            continue
        if len(options) > len(LETTERS):
            issues.error(qw, f"选项最多 {len(LETTERS)} 个")
            continue
        if len({o.strip() for o in options}) != len(options):
            issues.warn(qw, "存在重复选项")

        answer = normalize_answer(q.get("answer"))
        valid = LETTERS[: len(options)]
        if not answer or any(c not in valid for c in answer):
            issues.error(qw, f"答案 {q.get('answer')!r} 不在选项范围 A-{valid[-1]} 内")
            continue
        qtype = q.get("type") or ("multi" if len(answer) > 1 else "single")
        if qtype not in ("single", "multi"):
            issues.error(qw, "type 只能是 single 或 multi")
            continue
        if qtype == "single" and len(answer) > 1:
            issues.error(qw, "单选题只能有一个答案")
            continue

        refs = q.get("points") or []
        if isinstance(refs, str):
            refs = [refs]
        refs = [str(r) for r in refs]
        missing = [r for r in refs if r not in point_ids]
        if missing:
            issues.warn(qw, f"关联的知识点不存在：{', '.join(missing)}")
        refs = [r for r in refs if r in point_ids]
        if not refs:
            issues.warn(qw, "没有关联任何知识点（points）")

        explanation = str(q.get("explanation") or "").strip()
        if not explanation:
            issues.warn(qw, "缺少解析 explanation")

        out.append({
            "id": qid,
            "gid": f"{page_id}/{qid}",
            "type": qtype,
            "points": refs,
            "stem": stem.strip(),
            "options": [o.strip() for o in options],
            "answer": answer,
            "explanation": explanation,
            "shuffle": q.get("shuffle", True) is not False,
        })

    covered = {r for q in out for r in q["points"]}
    for p in points:
        if p["id"] not in covered:
            issues.warn(where, f"知识点「{p['title']}」还没有对应的题目")
    return out


def page_sort_key(d: Path):
    m = PAGE_DIR_RE.match(d.name)
    return (int(m.group(1)) if m else 10**9, d.name)


def load_page(page_dir: Path, issues: Issues) -> dict:
    m = PAGE_DIR_RE.match(page_dir.name)
    index, page_id = (int(m.group(1)), m.group(2)) if m else (None, page_dir.name)
    where = page_dir.name
    if not ID_RE.match(page_id):
        issues.error(where, "页面文件夹名只能包含字母、数字、下划线、连字符，例如 01-rag")

    kfile = page_dir / "knowledge.md"
    if kfile.exists():
        title, intro, points = parse_knowledge(read_text(kfile), f"{where}/knowledge.md", issues)
    else:
        issues.warn(where, "缺少 knowledge.md")
        title, intro, points = None, "", []

    questions = load_questions(page_dir / "questions.json", page_id, page_dir.name, points, issues)
    return {
        "id": page_id,
        "dir": page_dir.name,
        "index": index,
        "title": title or page_id,
        "intro": intro,
        "points": points,
        "questions": questions,
    }


def position_dir(pid: str) -> Path | None:
    if not pid or not ID_RE.match(pid) or pid.startswith(("_", ".")):
        return None
    d = POSITIONS_DIR / pid
    return d if d.is_dir() else None


def load_position(pdir: Path) -> dict:
    issues = Issues()
    meta: dict = {}
    mfile = pdir / "position.json"
    if mfile.exists():
        try:
            meta = read_json(mfile)
        except json.JSONDecodeError as e:
            issues.error("position.json", f"JSON 格式错误：第 {e.lineno} 行第 {e.colno} 列，{e.msg}")
        if not isinstance(meta, dict):
            issues.error("position.json", "内容应为对象 {...}")
            meta = {}
    else:
        issues.warn("position.json", "缺少 position.json，暂用文件夹名作为岗位名")

    jd_file = pdir / "jd.md"
    jd = read_text(jd_file).strip() if jd_file.exists() else None

    pages = []
    seen: set[str] = set()
    for d in sorted(visible_dirs(pdir / "pages"), key=page_sort_key):
        page = load_page(d, issues)
        if page["id"] in seen:
            issues.error(d.name, f"页面 id 重复：{page['id']}")
            continue
        seen.add(page["id"])
        pages.append(page)
    if not pages:
        issues.warn("pages", "还没有页面（在 pages/ 下新建 01-xxx 文件夹）")

    for page in pages:
        nf = note_file(pdir.name, page["id"])
        page["noteSize"] = nf.stat().st_size if nf.is_file() else 0
    note_dir = NOTES_DIR / pdir.name
    if note_dir.is_dir():
        ids = {p["id"] for p in pages}
        for f in sorted(note_dir.glob("*.md")):
            if f.stem not in ids:
                issues.warn(f"data/notes/{pdir.name}/{f.name}", "这份笔记没有对应的页面（页面 id 改过的话，把文件名改成新的页面 id）")

    return {
        "id": pdir.name,
        "name": str(meta.get("name") or pdir.name),
        "company": str(meta.get("company") or ""),
        "description": str(meta.get("description") or ""),
        "order": meta.get("order") if isinstance(meta.get("order"), (int, float)) else 0,
        "jd": jd,
        "path": f"data/positions/{pdir.name}",
        "pages": pages,
        "issues": issues.items,
    }


def list_positions() -> list[dict]:
    out = []
    for d in visible_dirs(POSITIONS_DIR):
        if not ID_RE.match(d.name):
            continue
        p = load_position(d)
        out.append({
            "id": p["id"],
            "name": p["name"],
            "company": p["company"],
            "description": p["description"],
            "order": p["order"],
            "pageCount": len(p["pages"]),
            "questionCount": sum(len(pg["questions"]) for pg in p["pages"]),
            "issueCount": len(p["issues"]),
        })
    out.sort(key=lambda p: (p["order"], p["name"]))
    return out


# ───────────────────────────── 作答记录 ─────────────────────────────

def records_file(pid: str) -> Path:
    return RECORDS_DIR / f"{pid}.jsonl"


def read_records(pid: str) -> tuple[list[dict], int]:
    path = records_file(pid)
    out: list[dict] = []
    skipped = 0
    if not path.exists():
        return out, skipped
    with records_lock, path.open("r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if isinstance(r, dict) and isinstance(r.get("q"), str) and isinstance(r.get("ok"), bool) and isinstance(r.get("t"), (int, float)):
                out.append(r)
            else:
                skipped += 1
    out.sort(key=lambda r: r["t"])
    return out, skipped


def append_records(pid: str, items: list) -> int:
    now = int(time.time() * 1000)
    clean = []
    for r in items:
        if not isinstance(r, dict) or not isinstance(r.get("q"), str) or not isinstance(r.get("ok"), bool):
            continue
        t = r.get("t")
        rec = {
            "t": int(t) if isinstance(t, (int, float)) and 0 < t <= now + 86_400_000 else now,
            "q": r["q"][:200],
            "ok": r["ok"],
        }
        if isinstance(r.get("pick"), str):
            rec["pick"] = r["pick"][:16]
        if isinstance(r.get("src"), str):
            rec["src"] = r["src"][:16]
        if isinstance(r.get("dur"), (int, float)) and r["dur"] >= 0:
            rec["dur"] = int(r["dur"])
        clean.append(rec)
    if not clean:
        return 0
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    with records_lock, records_file(pid).open("a", encoding="utf-8", newline="\n") as f:
        for rec in clean:
            f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return len(clean)


def archive_records(pid: str) -> str | None:
    """重置 = 把记录文件移动到 data/records/archive/，不直接删除。"""
    src = records_file(pid)
    if not src.exists():
        return None
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{pid}-{datetime.now():%Y%m%d-%H%M%S}.jsonl"
    with records_lock:
        shutil.move(str(src), str(ARCHIVE_DIR / name))
    return f"data/records/archive/{name}"


# ───────────────────────────── 页面笔记 ─────────────────────────────

def page_ids(pdir: Path) -> set[str]:
    ids = set()
    for d in visible_dirs(pdir / "pages"):
        m = PAGE_DIR_RE.match(d.name)
        ids.add(m.group(2) if m else d.name)
    return ids


def note_file(pid: str, page_id: str) -> Path:
    return NOTES_DIR / pid / f"{page_id}.md"


def digest(raw: bytes) -> str:
    """文件内容指纹：网页保存时带上它，用来发现文件是否在别处被改过。"""
    return hashlib.sha256(raw).hexdigest()[:16] if raw else ""


def decode_note(raw: bytes) -> str:
    return raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n")


def read_note(pid: str, page_id: str) -> dict:
    path = note_file(pid, page_id)
    with notes_lock:
        raw = path.read_bytes() if path.is_file() else b""
    return {"content": decode_note(raw), "hash": digest(raw), "size": len(raw), "path": f"data/notes/{pid}/{page_id}.md"}


def snapshot_note(pid: str, page_id: str, old_raw: bytes, new_size: int) -> None:
    """覆盖前把旧内容存到 _history/：连续编辑时每 10 分钟最多一份；内容一下少了一半以上（比如误删）时总会存。"""
    hdir = NOTES_DIR / pid / "_history" / page_id
    snaps = sorted(hdir.glob("*.md")) if hdir.is_dir() else []
    recent = bool(snaps) and time.time() - snaps[-1].stat().st_mtime < NOTE_SNAPSHOT_GAP
    if recent and new_size >= len(old_raw) * 0.5:
        return
    hdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target, n = hdir / f"{stamp}.md", 1
    while target.exists():
        target, n = hdir / f"{stamp}_{n}.md", n + 1
    target.write_bytes(old_raw)
    snaps.append(target)
    for old in snaps[:-NOTE_HISTORY_KEEP]:
        try:
            old.unlink()
        except OSError:
            pass


def write_note(pid: str, page_id: str, content: str, base: str | None) -> tuple[int, dict]:
    path = note_file(pid, page_id)
    new_raw = content.replace("\r\n", "\n").encode("utf-8")
    with notes_lock:
        old_raw = path.read_bytes() if path.is_file() else b""
        current = digest(old_raw)
        if base is not None and base != current:
            return 409, {"error": "笔记文件已在别处修改", "content": decode_note(old_raw), "hash": current}
        if old_raw and old_raw != new_raw:
            snapshot_note(pid, page_id, old_raw, len(new_raw))
        if not content.strip():
            if path.exists():
                path.unlink()
            return 200, {"hash": "", "size": 0}
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        with open(tmp, "wb") as f:
            f.write(new_raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)  # 原子替换：保存过程中断电也不会留下半个文件
        return 200, {"hash": digest(new_raw), "size": len(new_raw)}


# ───────────────────────────── HTTP 服务 ─────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    server_version = "InterviewPrep/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):  # 保持控制台安静
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        # Windows 注册表可能把 .js 映射成 text/plain，导致 ES 模块加载失败，这里显式指定
        return MIME.get(os.path.splitext(str(path))[1].lower()) or super().guess_type(path)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            return self.handle_api("GET", url.path)
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            return self.handle_api("POST", url.path)
        self.send_error(405)

    def do_PUT(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            return self.handle_api("PUT", url.path)
        self.send_error(405)

    def send_json(self, obj, status: int = 200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 5_000_000:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw.decode("utf-8") or "null")

    def handle_api(self, method: str, path: str):
        parts = [unquote(p) for p in path.split("/")[2:] if p]
        try:
            if method == "GET" and parts == ["positions"]:
                return self.send_json(list_positions())

            if method == "GET" and len(parts) == 2 and parts[0] == "positions":
                pdir = position_dir(parts[1])
                if not pdir:
                    return self.send_json({"error": "岗位不存在"}, 404)
                return self.send_json(load_position(pdir))

            if len(parts) >= 2 and parts[0] == "records":
                pid = parts[1]
                if not position_dir(pid):
                    return self.send_json({"error": "岗位不存在"}, 404)
                if method == "GET" and len(parts) == 2:
                    recs, skipped = read_records(pid)
                    return self.send_json({"records": recs, "skipped": skipped})
                if method == "POST" and len(parts) == 2:
                    body = self.read_body()
                    saved = append_records(pid, body if isinstance(body, list) else [body])
                    return self.send_json({"saved": saved})
                if method == "POST" and parts[2:] == ["archive"]:
                    return self.send_json({"archived": archive_records(pid)})

            if len(parts) == 3 and parts[0] == "notes":
                pid, page_id = parts[1], parts[2]
                pdir = position_dir(pid)
                if not pdir:
                    return self.send_json({"error": "岗位不存在"}, 404)
                if not ID_RE.match(page_id) or page_id not in page_ids(pdir):
                    return self.send_json({"error": "页面不存在"}, 404)
                if method == "GET":
                    return self.send_json(read_note(pid, page_id))
                if method == "PUT":
                    body = self.read_body()
                    if not isinstance(body, dict) or not isinstance(body.get("content"), str):
                        return self.send_json({"error": "缺少笔记内容 content"}, 400)
                    base = body.get("base") if isinstance(body.get("base"), str) else None
                    status, payload = write_note(pid, page_id, body["content"], base)
                    return self.send_json(payload, status)

            return self.send_json({"error": "未知接口"}, 404)
        except Exception as e:  # 返回错误信息，方便在页面上看到原因
            traceback.print_exc()
            return self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 上 SO_REUSEADDR 会允许两个进程抢同一个端口，必须关闭
    allow_reuse_address = os.name != "nt"


def make_server(port: int) -> tuple[Server, int]:
    for p in range(port, port + 20):
        try:
            return Server(("127.0.0.1", p), Handler), p
        except OSError:
            continue
    sys.exit(f"端口 {port}-{port + 19} 都被占用了，请用 --port 指定其他端口")


def run_check() -> int:
    dirs = [d for d in visible_dirs(POSITIONS_DIR) if ID_RE.match(d.name)]
    if not dirs:
        print("data/positions/ 下还没有岗位。")
        return 0
    errors = 0
    for d in sorted(dirs):
        p = load_position(d)
        n_points = sum(len(pg["points"]) for pg in p["pages"])
        n_q = sum(len(pg["questions"]) for pg in p["pages"])
        print(f"[{p['id']}] {p['name']}：{len(p['pages'])} 页，{n_points} 个知识点，{n_q} 道题")
        if not p["issues"]:
            print("  没有发现问题")
        for it in p["issues"]:
            tag = "错误" if it["level"] == "error" else "提示"
            errors += it["level"] == "error"
            print(f"  {tag}  {it['where']}：{it['msg']}")
    return 1 if errors else 0


def run_outline() -> int:
    """打印已有内容的结构，供人或 agent 判断新岗位与已有岗位的重叠、检查覆盖情况。"""
    dirs = [d for d in visible_dirs(POSITIONS_DIR) if ID_RE.match(d.name)]
    if not dirs:
        print("data/positions/ 下还没有岗位。")
        return 0
    positions = sorted((load_position(d) for d in dirs), key=lambda p: (p["order"], p["name"]))
    for p in positions:
        n_points = sum(len(pg["points"]) for pg in p["pages"])
        n_q = sum(len(pg["questions"]) for pg in p["pages"])
        company = f"（{p['company']}）" if p["company"] else ""
        print(f"[{p['id']}] {p['name']}{company}  {len(p['pages'])} 页 / {n_points} 个知识点 / {n_q} 道题  order={p['order']}")
        if p["description"]:
            print(f"  说明：{p['description']}")
        print(f"  JD：{p['path']}/jd.md" if p["jd"] else "  JD：无")
        for pg in p["pages"]:
            counts: dict[str, int] = {}
            for q in pg["questions"]:
                for ref in q["points"]:
                    counts[ref] = counts.get(ref, 0) + 1
            print(f"  {pg['dir']}  {pg['title']}  ({len(pg['questions'])} 题)")
            for pt in pg["points"]:
                print(f"    - {pt['id']}  {pt['title']}  [{counts.get(pt['id'], 0)} 题]")
        if p["issues"]:
            print(f"  另有 {len(p['issues'])} 项格式问题，运行 --check 查看")
        print()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="面试准备本地服务")
    ap.add_argument("--port", type=int, default=8765, help="端口，默认 8765")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--check", action="store_true", help="只检查题库格式")
    ap.add_argument("--outline", action="store_true", help="列出所有岗位、页面和知识点")
    args = ap.parse_args()

    if args.check:
        sys.exit(run_check())
    if args.outline:
        sys.exit(run_outline())

    POSITIONS_DIR.mkdir(parents=True, exist_ok=True)
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    httpd, port = make_server(args.port)
    url = f"http://127.0.0.1:{port}/"
    print(f"面试准备已启动：{url}")
    print(f"题库目录：{POSITIONS_DIR}")
    print(f"作答记录：{RECORDS_DIR}")
    print("关闭此窗口或按 Ctrl+C 停止服务。")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
