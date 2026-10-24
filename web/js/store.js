// 数据层：题库缓存、作答记录、统计。作答记录先写内存，再写入服务端文件；
// 写入失败的记录暂存在浏览器里，下次成功连接时补写。

import { api } from './api.js';
import { computeStats, rankQuestions, countStates } from './rank.js';

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (e) {
      console.error(e);
    }
  }
}

let positionsCache = null;
const cache = new Map();

export async function getPositions(force = false) {
  if (!positionsCache || force) positionsCache = await api.positions();
  return positionsCache;
}

export async function getPosition(pid, force = false) {
  if (!force && cache.has(pid)) return cache.get(pid);
  const [bank, rec] = await Promise.all([api.position(pid), api.records(pid)]);
  const pos = build(bank, rec.records || []);
  pos.skippedRecords = rec.skipped || 0;
  for (const r of readPending(pid)) addAttempt(pos, r);
  cache.set(pid, pos);
  if (readPending(pid).length) flushPending(pid);
  return pos;
}

function build(bank, records) {
  const pos = {
    ...bank,
    questions: [],
    qById: new Map(),
    pageById: new Map(),
    pointByKey: new Map(),
    attempts: new Map(),
    version: 0,
  };
  let order = 0;
  bank.pages.forEach((page, i) => {
    page.no = String(page.index ?? i + 1).padStart(2, '0');
    pos.pageById.set(page.id, page);
    for (const pt of page.points) {
      pt.pageId = page.id;
      pos.pointByKey.set(`${page.id}/${pt.id}`, pt);
    }
    for (const q of page.questions) {
      q.pageId = page.id;
      q.order = order++;
      pos.questions.push(q);
      pos.qById.set(q.gid, q);
    }
  });
  for (const r of records) addAttempt(pos, r);
  return pos;
}

function addAttempt(pos, r) {
  if (!pos.qById.has(r.q)) return; // 题目已删除的旧记录：保留在文件里，但不参与统计
  let list = pos.attempts.get(r.q);
  if (!list) pos.attempts.set(r.q, (list = []));
  list.push(r);
  if (list.length > 1 && list[list.length - 2].t > r.t) list.sort((a, b) => a.t - b.t);
  pos.version++;
}

export function attemptsOf(pos, gid) {
  return pos.attempts.get(gid) || [];
}

// 统计结果按「记录版本 + 分钟」缓存：时间衰减变化很慢，没必要每次重算
function memo(pos, key, fn) {
  const minute = Math.floor(Date.now() / 60000);
  const slot = pos[key];
  if (slot && slot.v === pos.version && slot.m === minute) return slot.value;
  const value = fn();
  pos[key] = { v: pos.version, m: minute, value };
  return value;
}

export function stats(pos) {
  return memo(pos, '_stats', () => computeStats(pos.questions, pos.attempts));
}

export function ranked(pos) {
  return memo(pos, '_ranked', () => rankQuestions(pos.questions, stats(pos)));
}

export function counts(pos, questions = pos.questions) {
  return countStates(questions, stats(pos));
}

export function answeredCount(pos, questions = pos.questions) {
  let n = 0;
  for (const q of questions) if (pos.attempts.get(q.gid)?.length) n++;
  return n;
}

export async function record(pos, q, { ok, pick, src, dur, unknown = false }) {
  const isUnknown = unknown === true;
  const r = { t: Date.now(), q: q.gid, ok: isUnknown ? false : ok, pick: isUnknown ? '' : pick, src, dur: Math.max(0, Math.round(dur || 0)) };
  if (isUnknown) r.unknown = true;
  addAttempt(pos, r);
  emit('records', pos);
  try {
    await api.saveRecords(pos.id, [r]);
    if (readPending(pos.id).length) await flushPending(pos.id);
  } catch {
    writePending(pos.id, [...readPending(pos.id), r]);
    emit('pending', pos.id);
  }
}

export async function resetRecords(pos) {
  const res = await api.archiveRecords(pos.id);
  pos.attempts.clear();
  pos.version++;
  writePending(pos.id, []);
  emit('records', pos);
  emit('pending', pos.id);
  return res.archived;
}

// ── 未写入成功的记录 ──
const pendingKey = (pid) => `prep.pending.${pid}`;

function readPending(pid) {
  try {
    const v = JSON.parse(localStorage.getItem(pendingKey(pid)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writePending(pid, list) {
  try {
    if (list.length) localStorage.setItem(pendingKey(pid), JSON.stringify(list));
    else localStorage.removeItem(pendingKey(pid));
  } catch {
    /* 存储不可用 */
  }
}

export function pendingCount(pid) {
  return readPending(pid).length;
}

export async function flushPending(pid) {
  const list = readPending(pid);
  if (!list.length) return true;
  try {
    await api.saveRecords(pid, list);
    writePending(pid, readPending(pid).slice(list.length));
    emit('pending', pid);
    return true;
  } catch {
    emit('pending', pid);
    return false;
  }
}
