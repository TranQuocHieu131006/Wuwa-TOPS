// Engine chạy hoàn toàn trên trình duyệt (thay cho Flask + SQLite).
// - Dữ liệu gốc: static/data.js (window.WUWA_DATA)
// - Chỉnh sửa từ trang Admin: lưu trong localStorage của trình duyệt đó (không ảnh hưởng người khác)
(function (root) {
  "use strict";

  const SCORE_MAX = 100;     // thang điểm 1–100
  const SCORE_MIN_EFF = 0.1; // điểm sàn sau khi trừ bậc (team vẫn được tính)
  const RANK_PENALTY = 0.5;  // mỗi bậc hạ xuống (S→A→B→…→F) bị trừ 0.5 điểm; cùng bậc thì không trừ
  const SLOT_TIERS = ["S", "A", "B", "C", "D", "E", "F"];
  const LEGACY_MAX = 3;     // dữ liệu cũ chưa có "tiers": suy ra từ vị trí, tối đa tới C (như trước đây)
  const tierIdx = v => { const i = SLOT_TIERS.indexOf(String(v || "").toUpperCase()); return i < 0 ? 0 : i; };
  // Bậc của từng nhân vật trong slot. Dữ liệu cũ chưa có "tiers" thì suy ra từ vị trí (1→S, 2→A, 3→B, 4+→C)
  // để điểm các team cũ giữ nguyên.
  function slotTierIdx(t, si, k) {
    const tt = t.tiers && t.tiers[si];
    if (tt && tt[k] !== undefined) return tierIdx(tt[k]);
    return Math.min(k, LEGACY_MAX);
  }
  // Chuẩn hóa tiers theo slots (đủ độ dài, giá trị hợp lệ)
  function normTiers(slots, tiers) {
    return slots.map((s, si) => s.map((_, k) => {
      const v = tiers && tiers[si] && tiers[si][k];
      return SLOT_TIERS.includes(String(v || "").toUpperCase()) ? String(v).toUpperCase() : SLOT_TIERS[Math.min(k, LEGACY_MAX)];
    }));
  }
  // ---- Cặp chuẩn (pairs): team có thể khai báo các bộ 2–3 nhân vật ăn ý với nhau, dạng [idA, idB, idC?]
  // (3 ô, được để trống 1 ô). Khi TẤT CẢ nhân vật của bộ cùng có mặt trong đội hình thì mỗi người được nâng 1 bậc
  // (A→S, B→A...; S vẫn là S). Đứng riêng (thiếu người) thì giữ nguyên bậc đã chấm trong slot.
  // các nhân vật phải xếp được vào các slot KHÁC NHAU thì mới đứng chung đội hình được
  function canSeat(ids, slots) {
    const rec = (k, used) => {
      if (k === ids.length) return true;
      for (let i = 0; i < slots.length; i++) if (!used.has(i) && slots[i].includes(ids[k])) {
        used.add(i);
        const ok = rec(k + 1, used);
        used.delete(i);
        if (ok) return true;
      }
      return false;
    };
    return rec(0, new Set());
  }
  function normPairs(slots, pairs) {
    const out = [], seen = new Set();
    for (const p of pairs || []) {
      const ids = [];
      for (const x of Array.isArray(p) ? p : []) {
        const n = parseInt(x, 10);
        if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);   // ô trống (0/null) bị bỏ
      }
      if (ids.length < 2 || ids.length > 3 || !canSeat(ids, slots)) continue;
      const key = ids.slice().sort((x, y) => x - y).join(",");
      if (seen.has(key)) continue;
      seen.add(key); out.push(ids);
    }
    return out;
  }
  // các bộ đang "khớp" (đủ mọi người) trong đội hình ids
  function activePairs(t, ids) {
    return (t.pairs || []).filter(p => p.every(x => ids.includes(x)));
  }
  function boostedIds(t, ids) {
    const out = new Set();
    for (const p of activePairs(t, ids)) p.forEach(x => out.add(x));
    return out;
  }
  const effIdx = (idx, boosted) => boosted ? Math.max(idx - 1, 0) : idx;

  // Dạng team: "meta" = team chuẩn, "alt" = alternative (team chắp vá). Dữ liệu cũ chưa có -> coi là meta.
  const KINDS = ["meta", "alt"];
  const normKind = v => v === "alt" ? "alt" : "meta";

  // ---- Điểm cộng "lên meta" cho Nên pull ai? ----
  // Team meta có cặp (A,B) + người thứ 3 (C). Nếu DPS của team meta đó đang phải chơi trong team alt, thì pull người còn thiếu của cặp:
  //   +50  nếu đã có người kia của cặp VÀ C  (pull xong là đủ bộ meta)
  //   +25  nếu đã có người kia của cặp nhưng chưa có C (mới hoàn thành cặp)
  const META_FULL = 50, META_PAIR = 25;
  // cặp 2 người (a,b): có cách xếp a,b vào 2 slot khác nhau mà slot còn lại có người đang sở hữu (C)?
  function pairHasC(t, pair, owned) {
    const [a, b] = pair;
    for (let i = 0; i < 3; i++) if (t.slots[i].includes(a))
      for (let j = 0; j < 3; j++) if (j !== i && t.slots[j].includes(b)) {
        const k = 3 - i - j;
        if (t.slots[k].some(c => c !== a && c !== b && owned.has(c))) return true;
      }
    return false;
  }
  // o (bất kỳ vai trò nào: DPS hay support) đã có người xích khác (khác x) đang sở hữu, ở một cặp khác?
  function dpsAlreadyChained(o, x, pair, templates, owned) {
    for (const t of templates) {
      if (t.kind !== "meta") continue;
      for (const p of t.pairs || []) {
        if (p === pair || !p.includes(o) || p.includes(x)) continue;
        if (p.some(y => y !== o && owned.has(y))) return true;
      }
    }
    return false;
  }
  // trả về { bonus, team, dps, complete, self } tốt nhất cho nhân vật x (chưa sở hữu); bonus = 0 nếu không có
  //  - x là support/sub trong cặp: cần có DPS (slot 1) của team meta đó đang phải chơi trong team alt  -> self=false
  //  - x chính là DPS (slot 1) của team meta: x chưa có nên không có chuyện "đang chơi alt"; chỉ cần
  //    người còn lại trong cặp đã có (đối xứng với trường hợp trên)                                    -> self=true
  function metaBonusFor(x, templates, owned, usedMeta) {
    let best = { bonus: 0 }, redundant = false, freeLink = false;
    // xét độc lập với điều kiện DPS bên dưới: mọi cặp meta của x có người đang sở hữu
    for (const t of templates) {
      if (t.kind !== "meta") continue;
      for (const pair of t.pairs || []) {
        if (!pair.includes(x)) continue;
        const have = pair.filter(i => i !== x && owned.has(i));
        if (!have.length) continue;
        if (have.some(o => dpsAlreadyChained(o, x, pair, templates, owned))) redundant = true; else freeLink = true;
      }
    }
    for (const t of templates) {
      if (t.kind !== "meta" || !t.slots.some(s => s.includes(x))) continue;
      const self = t.slots[0].includes(x);
      // DPS (slot 1) của team meta này đang được dùng trong team alt
      const dps = self ? [] : t.slots[0].filter(i => i !== x && owned.has(i) && !usedMeta.has(i));
      if (!self && !dps.length) continue;
      for (const pair of t.pairs || []) {
        if (!pair.includes(x)) continue;
        const others = pair.filter(i => i !== x);
        const have = others.filter(i => owned.has(i));
        if (!have.length) continue;                                  // chưa có ai trong cặp -> không cộng
        // A xích với B và C (A, B, C là DPS hay support đều như nhau): nếu A đã có sẵn người xích khác (B) rồi thì không cộng điểm xích cho C nữa
        if (have.some(o => dpsAlreadyChained(o, x, pair, templates, owned))) continue;
        let bonus = 0, complete = false;
        if (pair.length === 3) { complete = have.length === 2; bonus = complete ? META_FULL : META_PAIR; }
        else if (have.length === 1) { complete = pairHasC(t, pair, owned); bonus = complete ? META_FULL : META_PAIR; }
        if (bonus > best.bonus) best = { bonus, team: t, dps, complete, self };
      }
    }
    // redundant = x chỉ xích được với người đã có người xích khác rồi -> không cần pull x nữa
    if (!best.bonus && redundant && !freeLink) best.redundant = true;
    return best;
  }

  const MAX_COPIES = 2;       // Matrix: tối đa 2 lần dùng / nhân vật
  const CDN = "https://cdn.prydwen.gg/images/wuthering-waves/characters/{slug}_icon.webp";
  const STORE_KEY = "wuwa.admin.db.v1";

  // ------------------------------------------------------------------ utils
  const clone = o => JSON.parse(JSON.stringify(o));
  const slugify = name => String(name).toLowerCase().replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const r2 = x => Math.round(x * 100) / 100;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ solver
  function expandTemplate(t, allowed) {
    const slotOpts = [];
    for (let si = 0; si < t.slots.length; si++) {
      const slot = t.slots[si];
      const opts = [];
      slot.forEach((rid, k) => { if (!allowed || allowed.has(rid)) opts.push([rid, slotTierIdx(t, si, k)]); });
      if (!opts.length) return [];
      slotOpts.push(opts);
    }
    const best = new Map();
    for (const a of slotOpts[0]) for (const b of slotOpts[1]) for (const c of slotOpts[2]) {
      if (a[0] === b[0] || a[0] === c[0] || b[0] === c[0]) continue;
      const ids = [a[0], b[0], c[0]];
      const bst = boostedIds(t, ids);
      const pen = (effIdx(a[1], bst.has(a[0])) + effIdx(b[1], bst.has(b[0])) + effIdx(c[1], bst.has(c[0]))) * RANK_PENALTY;
      const score = r2(Math.max(Number(t.score) - pen, SCORE_MIN_EFF));
      const key = ids.slice().sort((x, y) => x - y).join(",");
      const cur = best.get(key);
      if (!cur || score > cur.score) best.set(key, { tid: t.id, ids, score });
    }
    return [...best.values()];
  }

  function buildPool(templates, allowed) {
    const pool = [];
    for (const t of templates) for (const c of expandTemplate(t, allowed)) {
      c.pts = Math.round(c.score * 100);
      pool.push(c);
    }
    return pool;
  }

  function components(concrete) {
    const parent = new Map();
    const find = x => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    for (const c of concrete) {
      const r0 = find(c.ids[0]);
      for (let k = 1; k < 3; k++) parent.set(find(c.ids[k]), r0);
    }
    const groups = new Map();
    concrete.forEach((c, ci) => {
      const r = find(c.ids[0]);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(ci);
    });
    return [...groups.values()];
  }

  class Timeout extends Error {}

  // ---- HiGHS (WASM): bộ giải quy hoạch nguyên chính xác; không tải được thì dùng branch & bound ở dưới
  let highs = null;
  const ready = (async () => {
    try {
      if (typeof root.Module === "function") {
        const base = root.WUWA_WASM_BASE || "static/vendor/";
        highs = await root.Module({ locateFile: f => base + f });
      }
    } catch (e) { highs = null; }
  })();

  function solveMilp(concrete, caps, budgetMs, maxTeams) {
    const n = concrete.length;
    const byChar = new Map();
    concrete.forEach((c, j) => c.ids.forEach(i => {
      if (!byChar.has(i)) byChar.set(i, []);
      byChar.get(i).push(j);
    }));
    const rows = [];
    for (const [i, list] of byChar) if (list.length > caps.get(i)) rows.push(`c${i}: ` + list.map(j => "x" + j).join(" + ") + ` <= ${caps.get(i)}`);
    if (maxTeams && maxTeams < n) rows.push("cap: " + concrete.map((_, j) => "x" + j).join(" + ") + ` <= ${maxTeams}`);
    const lp = "Maximize\n obj: " + concrete.map((c, j) => `${c.pts} x${j}`).join(" + ") +
      "\nSubject To\n " + (rows.length ? rows.join("\n ") : "free: x0 >= 0") +
      "\nBinary\n " + concrete.map((_, j) => "x" + j).join(" ") + "\nEnd\n";
    const r = highs.solve(lp, { time_limit: Math.max(0.3, budgetMs / 1000) });
    if (r.Status !== "Optimal") return null;
    const picks = [];
    for (let j = 0; j < n; j++) if (r.Columns["x" + j].Primal > 0.5) picks.push(j);
    return [picks.reduce((a, j) => a + concrete[j].pts, 0), picks];
  }

  // Branch & bound chính xác cho 1 cụm nhân vật độc lập.
  function solveComponent(concrete, idxs, caps, deadline) {
    const teams = idxs.slice().sort((a, b) => concrete[b].pts - concrete[a].pts);
    const chars = [...new Set(teams.flatMap(ci => concrete[ci].ids))].sort((a, b) => a - b);
    const pos = new Map(chars.map((c, k) => [c, k]));
    const n = teams.length, m = chars.length;
    const A = new Int32Array(n), B = new Int32Array(n), C = new Int32Array(n), P = new Float64Array(n);
    teams.forEach((ci, k) => {
      const ids = concrete[ci].ids;
      A[k] = pos.get(ids[0]); B[k] = pos.get(ids[1]); C[k] = pos.get(ids[2]); P[k] = concrete[ci].pts;
    });
    const rem = Int32Array.from(chars.map(c => caps.get(c)));
    const byChar = Array.from({ length: m }, () => []);
    for (let k = 0; k < n; k++) { byChar[A[k]].push(k); byChar[B[k]].push(k); byChar[C[k]].push(k); }

    // Cận trên: mỗi team chia đều điểm cho 3 thành viên; mỗi nhân vật chỉ góp được
    // tối đa `rem` phần tốt nhất trong các team còn khả thi.
    function bound(k0) {
      let tot = 0;
      for (let x = 0; x < m; x++) {
        const need = rem[x];
        if (need <= 0) continue;
        let got = 0;
        const list = byChar[x];
        for (let q = 0; q < list.length; q++) {
          const k = list[q];
          if (k < k0) continue;
          if (rem[A[k]] > 0 && rem[B[k]] > 0 && rem[C[k]] > 0) {
            tot += P[k] / 3;
            if (++got >= need) break;
          }
        }
      }
      return tot;
    }

    // nghiệm khởi đầu: tham lam theo điểm giảm dần
    let best = 0, bestList = [];
    {
      const r0 = Int32Array.from(rem);
      for (let k = 0; k < n; k++) {
        if (r0[A[k]] > 0 && r0[B[k]] > 0 && r0[C[k]] > 0) {
          r0[A[k]]--; r0[B[k]]--; r0[C[k]]--;
          best += P[k]; bestList.push(k);
        }
      }
    }
    const cur = [];
    let counter = 0;

    function rec(k, score) {
      if ((++counter & 1023) === 0 && Date.now() > deadline) throw new Timeout();
      if (score > best) { best = score; bestList = cur.slice(); }
      if (k >= n || score + bound(k) <= best) return;
      for (let j = k; j < n; j++) {
        const a = A[j], b = B[j], c = C[j];
        if (rem[a] > 0 && rem[b] > 0 && rem[c] > 0) {
          rem[a]--; rem[b]--; rem[c]--;
          cur.push(j);
          rec(j + 1, score + P[j]);
          cur.pop();
          rem[a]++; rem[b]++; rem[c]++;
        }
        if (score + bound(j + 1) <= best) return;
      }
    }
    rec(0, 0);
    return [best, bestList.map(j => teams[j])];
  }

  function greedy(concrete, idxs, caps, weights) {
    const remaining = new Map(caps);
    const order = idxs.slice().sort((a, b) => weights.get(b) - weights.get(a));
    const picks = []; let total = 0;
    for (const ci of order) {
      const ids = concrete[ci].ids;
      if (ids.every(i => (remaining.get(i) || 0) > 0)) {
        ids.forEach(i => remaining.set(i, remaining.get(i) - 1));
        picks.push(ci); total += concrete[ci].pts;
      }
    }
    return [picks, total];
  }

  // Khi quá thời gian: tham lam + nhiễu ngẫu nhiên
  function heuristic(concrete, idxs, caps, ms) {
    const rng = mulberry32(7);
    const base = new Map(idxs.map(ci => [ci, concrete[ci].pts]));
    let [bp, bt] = greedy(concrete, idxs, caps, base);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const w = new Map(idxs.map(ci => [ci, concrete[ci].pts * (0.7 + 0.6 * rng())]));
      const [p, t] = greedy(concrete, idxs, caps, w);
      if (t > bt) { bp = p; bt = t; }
    }
    return [bt, bp];
  }

  // caps: Map(id -> số lần dùng tối đa). pool: danh sách team cụ thể dựng sẵn (tuỳ chọn).
  function solve(templates, caps, budgetMs = 4000, pool = null, maxTeams = null) {
    let concrete;
    if (pool) concrete = pool.filter(c => c.ids.every(i => caps.has(i)));
    else concrete = buildPool(templates, new Set(caps.keys()));
    const usable = new Set(concrete.map(c => c.tid)).size;
    if (!concrete.length) return { picked: [], score: 0, usable, approx: false, concrete: [] };

    if (highs) {
      try {
        const out = solveMilp(concrete, caps, budgetMs, maxTeams);
        if (out) {
          const picked = out[1].map(ci => concrete[ci]).sort((a, b) => b.score - a.score);
          return { picked, score: r2(out[0] / 100), usable, approx: false, concrete };
        }
      } catch (e) { /* rơi về branch & bound */ }
    }

    let deadline = Date.now() + budgetMs;
    let total = 0, picks = [], approx = false;
    const comps = components(concrete).sort((a, b) => a.length - b.length);
    for (const idxs of comps) {
      let sc, pk;
      try {
        [sc, pk] = solveComponent(concrete, idxs, caps, deadline);
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        approx = true;
        [sc, pk] = heuristic(concrete, idxs, caps, Math.min(1000, budgetMs / 3));
        deadline = Date.now() + 500;
      }
      total += sc; picks = picks.concat(pk);
    }
    let picked = picks.map(ci => concrete[ci]).sort((a, b) => b.score - a.score);
    let score = r2(total / 100);
    if (maxTeams && picked.length > maxTeams) {      // nhánh dự phòng (không có HiGHS): lấy N team điểm cao nhất
      picked = picked.slice(0, maxTeams);
      score = r2(picked.reduce((a, c) => a + c.pts, 0) / 100);
      approx = true;
    }
    return { picked, score, usable, approx, concrete };
  }

  function buildCaps(owned, duplicates, validIds) {
    const caps = new Map();
    for (let x of owned) { x = Number(x); if (validIds.has(x)) caps.set(x, 1); }
    for (let x of duplicates) {
      x = Number(x);
      if (caps.has(x)) caps.set(x, Math.min(caps.get(x) + 1, MAX_COPIES));
    }
    return caps;
  }

  // ------------------------------------------------------------------ gợi ý team cho nhân vật dư
  function fillForLeftover(t, rid, owned, busy) {
    const members = [null, null, null];
    let found = false;
    for (let si = 0; si < 3; si++) {
      if (t.slots[si].includes(rid)) { members[si] = rid; found = true; break; }
    }
    if (!found) return null;
    const empty = [0, 1, 2].filter(si => members[si] === null);
    // thử mọi cách lấp các slot trống (tối đa 2 slot) rồi chọn cách tốt nhất:
    // ít người thiếu nhất -> ít người đã bận nhất -> điểm cao nhất (có tính cặp chuẩn) -> ưu tiên người đứng trước trong slot
    let best = null;
    const rec = (k, cur, ord) => {
      if (k === empty.length) {
        const ids = cur.slice();
        if (new Set(ids).size !== 3) return;
        const missing = ids.filter(m => !owned.has(m)).length;
        const busyN = ids.filter(m => owned.has(m) && busy.has(m) && m !== rid).length;
        const sc = teamScoreFor(t, ids);
        if (!best || missing < best.missing || (missing === best.missing && (busyN < best.busyN ||
            (busyN === best.busyN && (sc > best.sc || (sc === best.sc && ord < best.ord)))))) {
          best = { ids, missing, busyN, sc, ord };
        }
        return;
      }
      const si = empty[k];
      t.slots[si].forEach((x, i) => { cur[si] = x; rec(k + 1, cur, ord + i); });
      cur[si] = null;
    };
    rec(0, members.slice(), 0);
    return best ? best.ids : null;
  }

  function teamScoreFor(t, members) {
    let pen = 0;
    const bst = boostedIds(t, members);
    members.forEach((m, si) => { const i = t.slots[si].indexOf(m); pen += i >= 0 ? effIdx(slotTierIdx(t, si, i), bst.has(m)) : 0; });
    return r2(Math.max(Number(t.score) - pen * RANK_PENALTY, SCORE_MIN_EFF));
  }

  function incompleteSuggestions(leftoverIds, owned, busy, templates) {
    const bestByKey = new Map();
    for (const rid of leftoverIds) {
      const cands = [];
      for (const t of templates) {
        const members = fillForLeftover(t, rid, owned, busy);
        if (!members) continue;
        const missing = members.filter(m => !owned.has(m)).length;
        const busyN = members.filter(m => owned.has(m) && busy.has(m) && m !== rid).length;
        cands.push({ missing, busyN, sc: teamScoreFor(t, members), t, members });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => a.missing - b.missing || a.busyN - b.busyN || b.sc - a.sc || a.t.id - b.t.id);
      const { t, members, sc } = cands[0];
      const key = t.id + ":" + members.join(",");
      if (!bestByKey.has(key)) bestByKey.set(key, { t, members, sc, for: [] });
      bestByKey.get(key).for.push(rid);
    }
    const out = [...bestByKey.values()].map(v => ({
      team_id: v.t.id, name: v.t.name, tier: v.t.tier, team_type: v.t.team_type,
      notes: v.t.notes, score: v.sc, slots: v.t.slots, for: v.for, pairs_active: activePairs(v.t, v.members),
      members: v.members.map(m => ({
        id: m, missing: !owned.has(m), busy: owned.has(m) && busy.has(m) && !v.for.includes(m),
      })),
    }));
    const miss = x => x.members.filter(m => m.missing).length;
    out.sort((a, b) => miss(a) - miss(b) || b.score - a.score);
    return out;
  }

  // ------------------------------------------------------------------ lưu trữ
  function seedDb() {
    const d = clone(root.WUWA_DATA);
    return { resonators: d.resonators, teams: d.teams, edited: false, scoreScale: SCORE_MAX };
  }
  function loadDb() {
    try {
      const raw = root.localStorage && localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.resonators && d.teams) {
          if (d.scoreScale !== SCORE_MAX) {           // chỉnh sửa lưu từ phiên bản cũ (thang 0–10) -> x10
            d.teams.forEach(t => { t.score = r2(Number(t.score || 0) * 10); });
            d.scoreScale = SCORE_MAX;
          }
          return d;
        }
      }
    } catch (e) { /* bỏ qua */ }
    return seedDb();
  }
  function saveDb(db) {
    db.edited = true;
    db.scoreScale = SCORE_MAX;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { throw new Error("Không lưu được vào trình duyệt (bị chặn localStorage?)"); }
  }
  const hasLocalEdits = () => { try { return !!localStorage.getItem(STORE_KEY); } catch (e) { return false; } };
  const resetLocalEdits = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* bỏ qua */ } };
  const nextId = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;

  const ROLES = ["DPS", "supDPS", "Healer"];
  const normRole = v => ROLES.includes(v) ? v : "DPS";
  const normDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
  // Trạng thái banner: available = đã ra mắt (đang có), upcoming = sắp ra mắt, rerun = đang rerun,
  // debut = đang debut (banner ra mắt), soon = sắp rerun, limited = đã limited (đang ngoài banner), norerun = không rerun nữa
  const STATUSES = ["available", "upcoming", "debut", "rerun", "soon", "limited", "norerun"];
  const normStatus = v => STATUSES.includes(v) ? v : "available";
  // Potential -> điểm cộng/trừ vào điểm pull (người dùng tự chấm trong Admin). "" = chưa chấm = 0
  root.POTENTIAL_POINTS = { "S+": 50, "S": 20, "A": 0, "B": -10, "C": -20, "D": -30, "E": -50, "F": -100 };
  const normPotential = v => (v in root.POTENTIAL_POINTS) ? v : "";
  // dữ liệu cũ trong trình duyệt chưa có role/date/status/potential -> lấy từ data.js gốc theo slug
  let _seedMeta = null;
  function seedMeta() {
    if (_seedMeta) return _seedMeta;
    _seedMeta = {};
    for (const r of (root.WUWA_DATA && root.WUWA_DATA.resonators) || [])
      _seedMeta[r.slug || slugify(r.name)] = { role: r.role, date: r.date, status: r.status, potential: r.potential };
    return _seedMeta;
  }

  // gom mọi thuộc tính phụ của 1 Resonator (ưu tiên dữ liệu đã lưu, thiếu thì lấy từ data.js gốc)
  function resMeta(r) {
    const slug = r.slug || slugify(r.name);
    const sm = seedMeta()[slug] || {};
    let status = r.status;
    if (status === undefined) {
      if (r.released === 0 || r.released === false) status = "upcoming";
      else status = sm.status === "upcoming" ? "available" : sm.status;
    }
    status = normStatus(status);
    return {
      slug, status, released: status === "upcoming" ? 0 : 1,
      role: normRole(r.role ?? sm.role), date: normDate(r.date ?? sm.date),
      potential: normPotential(r.potential ?? sm.potential ?? ""),
    };
  }

  function resView(db) {
    return db.resonators.map(r => {
      const m = resMeta(r);
      const remote = CDN.replace("{slug}", m.slug);
      return { ...r, ...m, remote, img: remote };
    }).sort((a, b) => {
      const x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  const teamsView = (db, activeOnly) =>
    db.teams.filter(t => !activeOnly || t.active).map(t => ({ ...clone(t), kind: normKind(t.kind) }))
      .sort((a, b) => b.score - a.score || a.id - b.id);

  function fail(msg) { throw new Error(msg); }

  function validateTeam(db, data) {
    let slots, score;
    try {
      slots = data.slots.map(s => s.map(x => { const n = parseInt(x, 10); if (Number.isNaN(n)) throw 0; return n; }));
      score = parseFloat(data.score ?? 0);
      if (Number.isNaN(score)) throw 0;
    } catch (e) { fail("Dữ liệu team không hợp lệ"); }
    if (score < 1 || score > SCORE_MAX) fail("Điểm team phải từ 1 đến 100");
    if (slots.length !== 3 || slots.some(s => !s.length)) fail("Team cần đủ 3 slot, mỗi slot ít nhất 1 nhân vật");
    if (slots.some(s => new Set(s).size !== s.length)) fail("Một slot không được có nhân vật trùng");
    const valid = new Set(db.resonators.map(r => r.id));
    if (slots.some(s => s.some(x => !valid.has(x)))) fail("Có nhân vật không tồn tại");
    const pairs = normPairs(slots, data.pairs);
    if (!expandTemplate({ id: 0, slots, tiers: normTiers(slots, data.tiers), pairs, score }, null).length) fail("Không ghép được 3 nhân vật khác nhau từ các slot này");
    const s = k => String(data[k] || "").trim();
    return { name: s("name"), slots, tiers: normTiers(slots, data.tiers), pairs, score, kind: normKind(data.kind), team_type: s("team_type"), notes: s("notes") };
  }

  // ------------------------------------------------------------------ "API" (thay cho Flask)
  const handlers = [];
  const route = (method, re, fn) => handlers.push({ method, re, fn });

  route("GET", /^\/api\/resonators$/, () => resView(loadDb()));
  route("POST", /^\/api\/resonators$/, (_, body) => {
    const db = loadDb();
    const name = String(body.name || "").trim();
    if (!name) fail("Cần nhập tên");
    if (db.resonators.some(r => r.name === name)) fail("Resonator này đã tồn tại");
    const id = nextId(db.resonators);
    db.resonators.push({
      id, name, rarity: String(body.rarity || "5★").trim(), element: String(body.element || "").trim(),
      released: normStatus(body.status) === "upcoming" ? 0 : ([0, false, "0"].includes(body.released) ? 0 : 1),
      status: body.status !== undefined ? normStatus(body.status) : ([0, false, "0"].includes(body.released) ? "upcoming" : "available"),
      slug: String(body.slug || "").trim() || slugify(name),
      role: normRole(body.role), date: normDate(body.date), potential: normPotential(body.potential),
    });
    saveDb(db);
    return { id };
  });
  route("PUT", /^\/api\/resonators\/(\d+)$/, ([id], body) => {
    const db = loadDb();
    const r = db.resonators.find(x => x.id === +id);
    if (!r) fail("Không tìm thấy");
    const name = String(body.name ?? r.name).trim() || r.name;
    if (db.resonators.some(x => x.name === name && x.id !== r.id)) fail("Tên bị trùng");
    r.name = name;
    r.rarity = body.rarity ?? r.rarity;
    r.element = body.element ?? r.element;
    r.released = [0, false, "0"].includes(body.released ?? r.released) ? 0 : 1;
    r.slug = String(body.slug ?? r.slug ?? "").trim() || slugify(name);
    if (body.role !== undefined) r.role = normRole(body.role);
    if (body.date !== undefined) r.date = normDate(body.date);
    if (body.potential !== undefined) r.potential = normPotential(body.potential);
    if (body.status !== undefined) r.status = normStatus(body.status);
    else if (r.released === 0) r.status = "upcoming";
    else if (r.status === "upcoming" || r.status === undefined) r.status = resMeta({ ...r, status: undefined, released: 1 }).status;
    r.released = r.status === "upcoming" ? 0 : 1;
    saveDb(db);
    return { ok: true };
  });
  route("DELETE", /^\/api\/resonators\/(\d+)$/, ([id], _b) => {
    const db = loadDb();
    const rid = +id;
    const used = db.teams.filter(t => t.slots.some(s => s.includes(rid))).map(t => t.name || `#${t.id}`);
    if (used.length) fail("Đang được dùng trong team: " + used.slice(0, 5).join(", ") + (used.length > 5 ? "…" : "") + ". Hãy sửa/xóa các team đó trước.");
    const n = db.resonators.length;
    db.resonators = db.resonators.filter(r => r.id !== rid);
    if (db.resonators.length === n) fail("Không tìm thấy");
    saveDb(db);
    return { ok: true };
  });

  route("GET", /^\/api\/teams$/, () => teamsView(loadDb(), false));
  route("POST", /^\/api\/teams$/, (_, body) => {
    const db = loadDb();
    const t = validateTeam(db, body || {});
    const id = nextId(db.teams);
    db.teams.push({ id, ...t, active: 1, source: "user" });
    saveDb(db);
    return { id };
  });
  route("PUT", /^\/api\/teams\/(\d+)$/, ([id], body) => {
    const db = loadDb();
    const t = validateTeam(db, body || {});
    const cur = db.teams.find(x => x.id === +id);
    if (!cur) fail("Không tìm thấy team");
    Object.assign(cur, t);
    saveDb(db);
    return { ok: true };
  });
  route("POST", /^\/api\/teams\/(\d+)\/active$/, ([id], body) => {
    const db = loadDb();
    const cur = db.teams.find(x => x.id === +id);
    if (!cur) fail("Không tìm thấy team");
    cur.active = body && body.active ? 1 : 0;
    saveDb(db);
    return { ok: true };
  });
  route("POST", /^\/api\/teams\/(\d+)\/kind$/, ([id], body) => {
    const db = loadDb();
    const cur = db.teams.find(x => x.id === +id);
    if (!cur) fail("Không tìm thấy team");
    cur.kind = normKind(body && body.kind);
    saveDb(db);
    return { ok: true };
  });
  route("DELETE", /^\/api\/teams\/(\d+)$/, ([id]) => {
    const db = loadDb();
    const n = db.teams.length;
    db.teams = db.teams.filter(t => t.id !== +id);
    if (db.teams.length === n) fail("Không tìm thấy team");
    saveDb(db);
    return { ok: true };
  });
  route("POST", /^\/api\/teams\/reseed-prydwen$/, () => {
    const db = loadDb();
    const seed = seedDb();
    const seedName = Object.fromEntries(seed.resonators.map(r => [r.id, r.name]));
    const n2i = Object.fromEntries(db.resonators.map(r => [r.name, r.id]));
    const missing = new Set();
    for (const t of seed.teams) for (const s of t.slots) for (const id of s)
      if (!(seedName[id] in n2i)) missing.add(seedName[id]);
    if (missing.size) fail("Thiếu resonator: " + [...missing].sort().join(", "));
    db.teams = db.teams.filter(t => t.source !== "prydwen");
    for (const t of seed.teams) {
      db.teams.push({ ...t, id: nextId(db.teams), slots: t.slots.map(s => s.map(id => n2i[seedName[id]])),
        pairs: (t.pairs || []).map(pr => pr.map(id => n2i[seedName[id]])), source: "prydwen" });
    }
    saveDb(db);
    return { ok: true, count: seed.teams.length };
  });

  function exportJson(db) {
    const res = Object.fromEntries(db.resonators.map(r => [r.id, r]));
    return {
      version: 5, score_scale: SCORE_MAX,
      resonators: resView({ resonators: db.resonators }).map(r => ({ name: r.name, rarity: r.rarity, element: r.element, released: r.released, status: r.status, role: r.role, date: r.date, potential: r.potential })),
      teams: teamsView(db, false).map(t => ({
        name: t.name, score: t.score, tier: t.tier, patch: t.patch, kind: t.kind, team_type: t.team_type,
        notes: t.notes, active: t.active, source: t.source,
        slots: t.slots.map(s => s.filter(i => res[i]).map(i => res[i].name)),
        tiers: t.slots.map((s, si) => s.map((_, k) => SLOT_TIERS[slotTierIdx(t, si, k)])),
        pairs: (t.pairs || []).filter(pr => pr.every(i => res[i])).map(pr => pr.map(i => res[i].name)),
      })),
    };
  }
  route("GET", /^\/api\/export$/, () => exportJson(loadDb()));
  route("POST", /^\/api\/import$/, (_, data) => {
    const db = loadDb();
    const n2i = Object.fromEntries(db.resonators.map(r => [r.name, r.id]));
    for (const r of data.resonators || []) {
      const nm = String(r.name || "").trim();
      if (nm && !(nm in n2i)) {
        const id = nextId(db.resonators);
        db.resonators.push({ id, name: nm, rarity: r.rarity || "5★", element: r.element || "", released: r.status === "upcoming" || r.released === 0 ? 0 : 1, status: r.status !== undefined ? normStatus(r.status) : (r.released === 0 ? "upcoming" : "available"), slug: slugify(nm), role: normRole(r.role), date: normDate(r.date), potential: normPotential(r.potential) });
        n2i[nm] = id;
      }
    }
    const existing = new Set(db.teams.map(t => t.name + "|" + JSON.stringify(t.slots)));
    const k = data.score_scale === SCORE_MAX ? 1 : 10;      // file backup cũ dùng thang 0–10
    let added = 0, skipped = 0;
    for (const t of data.teams || []) {
      let slots;
      try { slots = t.slots.map(s => s.map(n => { if (!(n in n2i)) throw 0; return n2i[n]; })); }
      catch (e) { skipped++; continue; }
      if (slots.length !== 3 || slots.some(s => !s.length)) { skipped++; continue; }
      const key = (t.name || "") + "|" + JSON.stringify(slots);
      if (existing.has(key)) { skipped++; continue; }
      db.teams.push({
        id: nextId(db.teams), name: t.name || "", slots, tiers: normTiers(slots, t.tiers),
        pairs: normPairs(slots, (t.pairs || []).map(pr => pr.map(n => n2i[n]))), score: Math.min(SCORE_MAX, r2(parseFloat(t.score || 0) * k)), tier: t.tier || "",
        patch: t.patch || "", kind: normKind(t.kind), team_type: t.team_type || "", notes: t.notes || "",
        active: t.active === 0 || t.active === false ? 0 : 1, source: t.source || "user",
      });
      existing.add(key); added++;
    }
    saveDb(db);
    return { added, skipped };
  });

  route("POST", /^\/api\/optimize$/, (_, data) => {
    const db = loadDb();
    const valid = new Set(db.resonators.map(r => r.id));
    const caps = buildCaps(data.owned || [], data.duplicates || [], valid);
    // Xếp team chỉ lấy điểm từ team ALT; team META dành riêng cho "Nên pull ai?"
    const templates = teamsView(db, true).filter(t => t.kind === "alt");
    const tmap = new Map(templates.map(t => [t.id, t]));
    const mt = Math.floor(Number(data.max_teams));
    const maxTeams = Number.isFinite(mt) && mt >= 1 ? mt : null;     // rỗng / không hợp lệ = không giới hạn
    const sol = solve(templates, caps, 4000, null, maxTeams);

    const used = new Map();
    for (const c of sol.picked) for (const i of c.ids) used.set(i, (used.get(i) || 0) + 1);
    const leftover = [], busy = new Set();
    for (const [i, cap] of caps) {
      const u = used.get(i) || 0;
      if (cap - u > 0) leftover.push({ id: i, count: cap - u });
      if (u >= cap) busy.add(i);
    }
    const teams = sol.picked.map(c => {
      const t = tmap.get(c.tid);
      return { team_id: t.id, name: t.name, tier: t.tier, team_type: t.team_type, patch: t.patch,
        notes: t.notes, score: c.score, members: c.ids.slice(), slots: t.slots, pairs_active: activePairs(t, c.ids) };
    });
    return {
      teams, score: sol.score, approx: sol.approx, usable_templates: sol.usable, owned_count: caps.size, max_teams: maxTeams,
      leftover,
      incomplete: incompleteSuggestions(leftover.map(l => l.id), new Set(caps.keys()), busy, templates),
    };
  });

  // Chấm điểm các team do người dùng tự kéo thả (có thể thiếu người, thứ tự slot tùy ý).
  // Mỗi team: tìm team trong DB khớp nhất (điểm cao nhất) mà mọi thành viên đang có đều nằm được trong 1 slot riêng.
  // - Đủ 3 người + khớp: trả về điểm và thứ tự đã sắp theo slot của team DB (order).
  // - Thiếu người: trả về gợi ý (hints) cho các slot còn trống.
  route("POST", /^\/api\/eval-teams$/, (_, data) => {
    const templates = teamsView(loadDb(), true);
    return (data.teams || []).map(raw => {
      const mem = (raw || []).filter(x => x !== null && x !== undefined).map(Number);
      if (!mem.length || new Set(mem).size !== mem.length) return { matched: false, complete: false };
      let best = null;
      for (const t of templates) {
        if (!t.slots || t.slots.length !== 3) continue;
        const assign = [null, null, null];
        const base = new Map();   // id -> bậc gốc trong slot đã gán
        const rec = (k, _pen) => {
          if (k === mem.length) {
            const bst = boostedIds(t, mem);
            let pen = 0;
            for (const [id, idx] of base) pen += effIdx(idx, bst.has(id));
            const sc = r2(Math.max(Number(t.score) - pen * RANK_PENALTY, SCORE_MIN_EFF));
            if (!best || sc > best.sc) best = { t, sc, assign: assign.slice() };
            return;
          }
          for (let si = 0; si < 3; si++) {
            if (assign[si] !== null) continue;
            const idx = t.slots[si].indexOf(mem[k]);
            if (idx < 0) continue;
            assign[si] = mem[k];
            base.set(mem[k], slotTierIdx(t, si, idx));
            rec(k + 1, 0);
            base.delete(mem[k]);
            assign[si] = null;
          }
        };
        rec(0, 0);
      }
      if (!best) return { matched: false, complete: mem.length === 3 };
      const { t, sc, assign } = best;
      const complete = mem.length === 3;
      return {
        matched: true, complete, team_id: t.id, name: t.name, tier: t.tier, team_type: t.team_type,
        patch: t.patch, notes: t.notes, slots: t.slots,
        score: complete ? sc : null,
        order: complete ? assign : null,
        pairs_active: complete ? activePairs(t, mem) : [],
        hints: complete ? [] : assign.map((m, si) => m === null
          ? { si, ids: t.slots[si].filter(i => !mem.includes(i)) } : null).filter(Boolean),
      };
    });
  });

  route("POST", /^\/api\/pull-advisor$/, (_, data) => {
    const db = loadDb();
    const res = resView(db);
    const valid = new Set(res.map(r => r.id));
    const caps = buildCaps(data.owned || [], data.duplicates || [], valid);
    const templates = teamsView(db, true);
    const tmap = new Map(templates.map(t => [t.id, t]));
    const candidates = res.filter(r => !caps.has(r.id));      // gồm cả nhân vật sắp ra mắt

    // dựng sẵn mọi team cụ thể 1 lần cho (đang có + ứng viên); mỗi lần mô phỏng chỉ cần lọc
    const universe = new Set([...caps.keys(), ...candidates.map(r => r.id)]);
    const pool = buildPool(templates, universe);

    const base = solve(templates, caps, 3000, pool);
    // nhân vật đang được dùng trong team meta (theo cách xếp tối ưu hiện tại); DPS nào không nằm trong đây = đang chơi alt/chưa có chỗ
    const usedMeta = new Set();
    for (const c of base.picked) if ((tmap.get(c.tid) || {}).kind === "meta") c.ids.forEach(i => usedMeta.add(i));
    const ownedSet = new Set(caps.keys());

    // "Nên pull" chỉ xét META team: team alt (chắp vá) không được dùng để gợi ý pull, kể cả khi đã có 2 mảnh ghép
    const metaPool = pool.filter(c => (tmap.get(c.tid) || {}).kind === "meta");
    const baseMeta = solve(templates, caps, 3000, metaPool);
    const perSim = Math.max(300, Math.min(1500, 15000 / Math.max(candidates.length, 1)));
    const results = [];
    for (const r of candidates) {
      const simCaps = new Map(caps); simCaps.set(r.id, 1);
      const unlocked = metaPool.filter(c => c.ids.includes(r.id) && c.ids.every(i => simCaps.has(i)));
      // không meta team nào mở khóa -> kết quả y hệt hiện tại, khỏi giải lại
      const after = unlocked.length ? solve(templates, simCaps, perSim, metaPool)
        : { picked: [], score: baseMeta.score, usable: baseMeta.usable };
      const gain = r2(after.score - baseMeta.score);
      const newTeams = after.picked.filter(c => c.ids.includes(r.id));
      const potPts = root.POTENTIAL_POINTS[r.potential] || 0;
      const mb = metaBonusFor(r.id, templates, ownedSet, usedMeta);
      if (mb.redundant) continue;     // A đã xích với B (đang có) rồi -> không gợi ý pull C nữa
      results.push({
        id: r.id, name: r.name, gain, new_score: r2(base.score + gain),
        potential: r.potential, potential_pts: potPts,
        meta_bonus: mb.bonus,
        meta: mb.bonus ? { team_id: mb.team.id, name: mb.team.name, dps: mb.dps, complete: mb.complete, self: mb.self } : null,
        pull: r2(gain + potPts + mb.bonus),
        pairable: unlocked.length > 0 || mb.bonus > 0,    // ghép được ít nhất 1 META team (hoặc ghép cặp meta) với nhân vật đang có
        unlocked: new Set(unlocked.map(c => c.tid)).size,
        best_unlocked: unlocked.reduce((m, c) => Math.max(m, c.score), 0),
        teams: newTeams.map(c => ({ team_id: c.tid, name: tmap.get(c.tid).name, tier: tmap.get(c.tid).tier,
          score: c.score, members: c.ids.slice() })),
      });
    }
    results.sort((a, b) => b.pull - a.pull || b.gain - a.gain || b.best_unlocked - a.best_unlocked || b.new_score - a.new_score);
    return { base_score: base.score, owned_count: caps.size, results };
  });

  async function engineApi(url, method = "GET", body) {
    await ready;
    const path = String(url).split("?")[0].replace(/\/+$/, "");
    for (const h of handlers) {
      if (h.method !== method) continue;
      const m = path.match(h.re);
      if (m) return clone(h.fn(m.slice(1), body || {}));
    }
    throw new Error("Không có API: " + method + " " + url);
  }

  // xuất data.js để cập nhật dữ liệu gốc của site
  function exportDataJs() {
    const db = loadDb();
    const line = o => JSON.stringify(o);
    const fields = ["id", "name", "slots", "tiers", "pairs", "score", "kind", "team_type", "notes", "active", "source"];
    const res = db.resonators.slice().sort((a, b) => a.id - b.id)
      .map(r => { const m = resMeta(r); return "  " + line({ id: r.id, name: r.name, rarity: r.rarity, element: r.element, released: m.released, slug: m.slug, role: m.role, date: m.date, status: m.status, potential: m.potential }); });
    const teams = db.teams.slice().sort((a, b) => a.id - b.id)
      .map(t => "  " + line(Object.fromEntries(fields.map(k => [k, k === "tiers" ? normTiers(t.slots, t.tiers) : k === "pairs" ? normPairs(t.slots, t.pairs) : k === "kind" ? normKind(t.kind) : t[k]])
        .filter(([k, v]) => !(k === "pairs" && !v.length)))));
    return "// Dữ liệu gốc của site (Resonator + team). Xuất từ trang Admin.\n" +
      "window.WUWA_DATA = {\n \"resonators\": [\n" + res.join(",\n") + "\n ],\n \"teams\": [\n" + teams.join(",\n") + "\n ]\n};\n";
  }

  root.engineApi = engineApi;
  root.WuwaEngine = {
    KINDS, normKind, engineApi, solve, buildPool, buildCaps, expandTemplate, exportDataJs, normTiers, SLOT_TIERS, metaBonusFor,
    hasLocalEdits, resetLocalEdits, loadDb, exportJson, ready,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.WuwaEngine;
})(typeof window !== "undefined" ? window : globalThis);
