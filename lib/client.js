/**
 * dsh-bili-whale —— 客户端半边（DSH「设置 → 养鱼」+ 🐟 私信/任务台窗口）
 *
 * 数据流：面板 ⇄ `/dsh-bili/api/*`（同源 fetch）⇄ `~/.dsh/bili-whale.config.json`
 *         —— 与工具链 `tools/lib/config.mjs` 读**同一份文件**，不存在"两套配置"。
 *
 * 2026-10-22 v0.11.0：本文件被一次编码事故（PowerShell 用 ANSI 读写 UTF-8）整篇毁掉过，
 *   **整份重写**。功能与 v0.10.3 一致；
 *   顺带把样式标签改成**版本化 + 内容变了就地替换**（以前热更新时旧 <style> 不换，界面新旧混用 ✗）。
 */
window.__ModuleLoader__.load({
  id: "dsh-bili-whale",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/dsh-bili/api";
    const MAX_EMOTES_SHOWN = 3;   // 与 tools/lib/outbox.mjs 的 MAX_EMOTES 对齐
    const MAX_STICKERS_SHOWN = 2; // 自己的表情包（评论配图）最多 2 张
    const VERSION = "v0.12.1";

    // 样式变了就改这里：旧标签会被新代码替换/清理，不会出现"界面是新的、样式是旧的"
    const CSS_VERSION = "v3";
    const CSS_TAG = `dsh-bili-whale/section.css.${CSS_VERSION}`;

    const CSS = [
      // 宽度跟着窗口走（以前写死 760px，1920 屏幕上右边空一大片 ✗）
      ".blw{width:100%;max-width:1280px;box-sizing:border-box;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".blw-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      // 宿主只提供 primary/secondary；`label-tertiary` 不存在（用了等于颜色没定义）
      ".blw-intro{color:var(--dsw-alias-label-secondary);margin:0 0 4px;font-size:13px;line-height:20px}",
      ".blw-group{margin-top:14px;font-size:13px;font-weight:600;line-height:20px}",
      ".blw-rows{display:flex;flex-direction:column}",
      ".blw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".blw-row:last-child{border-bottom:none}",
      ".blw-row>div:first-child{flex:1;min-width:190px}",
      ".blw-label{font-size:13px;line-height:19px}",
      ".blw-hint{color:var(--dsw-alias-label-secondary);margin-top:3px;font-size:11.5px;line-height:17px}",
      ".blw-input,.blw-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;min-width:180px;outline:none}",
      ".blw-select option{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}",
      ".blw-ta{width:100%;min-height:84px;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;padding:8px;outline:none;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
      // 私信页：左列表 + 右编辑（两栏可伸缩）
      ".blwo{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:12px;align-items:start;margin-top:8px}",
      ".blwo-list{display:flex;flex-direction:column;gap:6px;max-height:min(72vh,720px);overflow:auto;padding-right:2px}",
      ".blwo-item{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;font-size:12.5px;line-height:18px}",
      ".blwo-item.on{border-color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10)}",
      ".blwo-meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:3px}",
      ".blwo-pane{display:flex;flex-direction:column;gap:8px;min-width:0}",
      ".blwo-actions{display:flex;gap:8px;flex-wrap:wrap}",
      ".blwo-tabs{display:flex;gap:6px;margin:10px 0 2px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding-bottom:8px}",
      ".blwo-tab{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:18px;padding:3px 12px;cursor:pointer}",
      ".blwo-tab.on{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);background:rgba(127,127,127,.12)}",
      ".blwo-form{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-top:8px}",
      ".blwo-line{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".blwo-chk{display:inline-flex;gap:5px;align-items:center;font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".blwo-tasks{display:flex;flex-direction:column;gap:8px;margin-top:10px}",
      ".blwo-task{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}",
      ".blwo-taskline{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;line-height:18px}",
      ".blwo-chip{font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary)}",
      // 表情 / 贴纸
      ".blwo-emobtn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12px;line-height:16px;padding:2px 8px;cursor:pointer}",
      ".blwo-emopanel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;max-height:min(52vh,520px);overflow:auto;resize:vertical}",
      ".blwo-emogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:6px}",
      ".blwo-emo{background:transparent;border:1px solid transparent;border-radius:6px;padding:3px;cursor:pointer;line-height:0}",
      ".blwo-emo:hover{border-color:var(--dsw-alias-border-l2);background:rgba(127,127,127,.12)}",
      ".blwo-emo img{width:34px;height:34px;object-fit:contain}",
      ".blwo-stkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}",
      ".blwo-stk-item{padding:4px;border-radius:8px;line-height:0}",
      ".blwo-stk-item img{width:92px;height:92px;object-fit:contain;border-radius:6px}",
      ".blwo-emotext{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.14);color:var(--dsw-alias-label-primary)}",
      ".blw-input:focus-visible,.blw-select:focus-visible{border-color:var(--dsw-alias-label-primary)}",
      ".blw-input.blw-wide{min-width:260px}",
      ".blw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      // 主按钮：底色用中性半透明灰（两套主题都成立），强调只放边框和字重
      // （以前 background:brand-primary + color:#fff —— 这套主题 brand 是浅色 → 白底白字）
      ".blw-btn{appearance:none;-webkit-appearance:none;background:rgba(127,127,127,.22);background-image:none;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-label-primary);border-radius:6px;font-size:12.5px;font-weight:600;height:30px;padding:0 12px;cursor:pointer;box-sizing:border-box}",
      ".blw-btn:disabled{opacity:.45;cursor:default}",
      ".blw-btn2{appearance:none;-webkit-appearance:none;background:transparent;background-image:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:400}",
      ".blw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10);border-radius:8px;padding:10px 12px;max-height:240px;overflow:auto;margin-top:10px}",
      ".blw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px}",
      ".blw-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary);margin-left:6px}",
      ".blw-cookie{display:flex;flex-direction:column;gap:8px;min-width:250px}",
    ].join("");

    // ── 设置字段（唯一真相：加字段只改这里）────────────────────────────
    const FIELDS = [
      { group: "她是谁", path: ["persona", "name"], label: "角色名", hint: "她怎么被称呼", kind: "text" },
      { group: "她是谁", path: ["persona", "ownerTitle"], label: "她怎么称呼你", hint: "例如「主人」", kind: "text" },
      { group: "她是谁", path: ["persona", "selfClaim"], label: "她怎么自称", hint: "例如「我」「人家」", kind: "text" },

      { group: "你（主人）", path: ["owner", "mid"], label: "主人 mid", hint: "用来认「谁回过她 / 谁点了赞」", kind: "text" },
      { group: "你（主人）", path: ["owner", "name"], label: "主人昵称", hint: "@ 分享时写进正文", kind: "text" },
      { group: "你（主人）", path: ["self", "mid"], label: "她自己 mid", hint: "只读（来自 cookie）", kind: "text", readOnly: true },
      { group: "你（主人）", path: ["self", "name"], label: "她自己昵称", hint: "只读（来自 nav）", kind: "text", readOnly: true },

      { group: "作息", path: ["night", "skipChance"], label: "今晚不看的概率", hint: "0.3 = 三成", kind: "number" },
      { group: "作息", path: ["night", "maxVideos"], label: "单次醒来观看视频数量", hint: "初筛的候选数；筛完再挑 2–3 条深读", kind: "number" },

      { group: "口味", path: ["preferences", "like"], label: "爱看", hint: "逗号分隔", kind: "list" },
      { group: "口味", path: ["preferences", "dislike"], label: "不爱看", hint: "逗号分隔", kind: "list" },

      { group: "日记与推送", path: ["diary", "push"], label: "推送日记摘要", hint: "关掉 = 她照写两本日记，但不推给你（日记本身不能关 ✓）", kind: "switch" },

      { group: "工具链", path: ["toolsPath"], label: "工具目录", hint: "留空 = 用插件自带的 tools/ 或开发目录", kind: "text", wide: true },
    ];

    const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const setPath = (obj, path, value) => {
      let cur = obj;
      for (let i = 0; i < path.length - 1; i += 1) {
        const k = path[i];
        if (cur[k] == null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = value;
    };

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        let el = document.getElementById(CSS_TAG);
        if (!el) {
          el = document.createElement("style");
          el.id = CSS_TAG;
          document.head.appendChild(el);
        }
        // 热更新时内容变了就原地替换；旧版本的标签顺手清掉（否则两套规则打架）
        if (el.textContent !== CSS) el.textContent = CSS;
        for (const old of Array.from(document.querySelectorAll('style[id^="dsh-bili-whale/section.css"]'))) {
          if (old !== el) old.remove();
        }
      }, []);
    }

    // ── 表情库（两页共用）────────────────────────────────────────────
    //   私信页：点图 → 插到光标处；任务台：点图 → 指定"必须用这几个"
    function useEmoteLib() {
      const [lib, setLib] = useState(null);
      const [tag, setTag] = useState("");
      const [err, setErr] = useState("");
      const loadTag = useCallback(async (t) => {
        setTag(t ?? "");
        try {
          const r = await fetch(`${API}/emotes${t ? `?tag=${encodeURIComponent(t)}` : ""}`, { headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (!j.ok) { setErr(j.error || `HTTP ${r.status}`); return; }
          setLib(j);
          setErr("");
        } catch (e) { setErr(`表情库读不到：${e.message}`); }
      }, []);
      return { lib, tag, err, loadTag };
    }

    const EMO_ON = { borderColor: "var(--dsw-alias-label-primary)", background: "rgba(127,127,127,.16)" };

    // 表情库面板：顶部两个**分类** —— 官方表情 / 我的表情包
    function EmoteBoard({ lib, tag, err, loadTag, selected = [], onPick, stickers = [], onPickSticker }) {
      const mine = typeof onPickSticker === "function";
      const [view, setView] = useState("official");
      const [pack, setPack] = useState(null);
      const [packErr, setPackErr] = useState("");

      useEffect(() => {
        if (!mine || pack || packErr) return;
        let alive = true;
        (async () => {
          try {
            const r = await fetch(`${API}/stickers`, { headers: { accept: "application/json" } });
            const j = await r.json().catch(() => ({}));
            if (!alive) return;
            if (!j.ok) { setPackErr(j.error || `HTTP ${r.status}`); return; }
            setPack(j);
          } catch (e) { if (alive) setPackErr(`贴纸库读不到：${e.message}`); }
        })();
        return () => { alive = false; };
      }, [mine, pack, packErr]);

      const sel = new Set(selected);
      const selSt = new Set(stickers);
      return h("div", { className: "blwo-emopanel" },
        h("div", { className: "blwo-line" },
          h("button", { className: "blwo-emobtn", style: view === "official" ? EMO_ON : null, onClick: () => setView("official") },
            lib?.total ? `官方表情 ${lib.total}` : "官方表情"),
          mine ? h("button", { className: "blwo-emobtn", style: view === "mine" ? EMO_ON : null, onClick: () => setView("mine") },
            pack?.count ? `我的表情包 ${pack.count}` : "我的表情包") : null),

        view === "official"
          ? h("div", null,
              h("div", { className: "blwo-line" },
                h("button", { className: "blwo-emobtn", style: tag === "" ? EMO_ON : null, onClick: () => loadTag("") }, "全部"),
                (lib?.tags ?? []).slice(0, 16).map((t) => h("button", {
                  key: t.name,
                  className: "blwo-emobtn",
                  style: tag === t.name ? EMO_ON : null,
                  onClick: () => loadTag(t.name),
                }, `${t.name} ${t.n}`))),
              err ? h("div", { className: "blw-err" }, err) : null,
              !lib && !err ? h("div", { className: "blw-hint" }, "读取表情库…") : null,
              lib ? h("div", { className: "blwo-emogrid" },
                (lib.items ?? []).map((e) => {
                  const name = String(e.text).replace(/^\[|\]$/g, "");
                  const on = sel.has(name);
                  return h("button", {
                    key: e.text,
                    className: "blwo-emo",
                    title: `${e.text}${(e.tags ?? []).length ? " · " + e.tags.join("/") : ""}`,
                    style: on ? { borderColor: "var(--dsw-alias-label-primary)", background: "rgba(127,127,127,.28)" } : null,
                    onClick: () => onPick(name),
                  }, /^https?:\/\//.test(String(e.url ?? ""))
                    ? h("img", { src: e.url, alt: e.text, loading: "lazy" })
                    : h("span", { style: { fontSize: "10px", lineHeight: "12px" } }, name.slice(0, 4)));
                })) : null)
          : h("div", null,
              packErr ? h("div", { className: "blw-err" }, packErr) : null,
              !pack && !packErr ? h("div", { className: "blw-hint" }, "读取贴纸库…") : null,
              pack ? h("div", { className: "blwo-stkgrid" },
                (pack.items ?? []).map((x) => h("button", {
                  key: x.name,
                  className: "blwo-emo blwo-stk-item",
                  title: `${x.name}${(x.tags ?? []).length ? " · " + x.tags.join("/") : ""}`,
                  style: selSt.has(x.name) ? { borderColor: "var(--dsw-alias-label-primary)", background: "rgba(127,127,127,.28)" } : null,
                  onClick: () => onPickSticker(x.name),
                }, h("img", { src: `${API}/sticker?name=${encodeURIComponent(x.name)}`, alt: x.name, loading: "lazy" })))) : null,
              pack ? h("div", { className: "blw-hint" }, `「${pack.dir}」· ${pack.count} 张 · 点图选中，最多 ${MAX_STICKERS_SHOWN} 张`) : null,
              h("div", { className: "blw-hint" }, "评论配图：发布时上传到 B站 CDN，再用 pictures 字段附在评论上（发完回读核对）。"),
              h("div", { className: "blw-hint" }, "私信发图不受这个限制（dm --image \"名字\"）；目录里的图换了要重新 stickers sync")));
    }

    function Row({ f, cfg, set }) {
      const raw = getPath(cfg, f.path);
      const common = { className: "blw-input" + (f.wide ? " blw-wide" : "") };
      // list 字段：本地文本 state 管显示（逗号能打），数组只在解析时更新
      const [listText, setListText] = useState(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      useEffect(() => {
        setListText(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      }, [JSON.stringify(raw ?? null)]);
      let control;
      if (f.kind === "list") {
        control = h("input", {
          ...common,
          value: listText,
          readOnly: !!f.readOnly,
          onChange: (e) => {
            const v = e.target.value;
            setListText(v);
            set(f.path, v.split(/[,，]/).map((s) => s.trim()).filter(Boolean));
          },
        });
      } else if (f.kind === "number") {
        control = h("input", {
          ...common, type: "number", step: "any", value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value === "" ? undefined : Number(e.target.value)),
        });
      } else if (f.kind === "switch") {
        control = h("input", {
          type: "checkbox", checked: !!raw, disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.checked),
        });
      } else if (f.kind === "select") {
        control = h("select", {
          className: "blw-select", value: raw ?? "", disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value),
        }, (f.options ?? []).map((o) => h("option", { key: o, value: o }, o)));
      } else {
        control = h("input", {
          ...common, value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value),
        });
      }
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, f.label, f.readOnly ? h("span", { className: "blw-badge" }, "只读") : null),
          f.hint ? h("div", { className: "blw-hint" }, f.hint) : null),
        control);
    }

    // ── 作息窗口编辑器 ───────────────────────────────────────────────
    //   每个窗口自带"醒来几次"；保存时把总和写回 night.maxWakesPerDay（工具链读它）
    function WindowsEditor({ cfg, set }) {
      const wins = getPath(cfg, ["night", "windows"]);
      const list = Array.isArray(wins) ? wins : [];
      const upd = (i, patch) => set(["night", "windows"], list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => set(["night", "windows"], list.filter((_, j) => j !== i));
      const add = () => set(["night", "windows"], [...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      const timeInput = (v, onChange) =>
        h("input", { className: "blw-input", style: { width: "86px", minWidth: "86px" }, value: v ?? "", onChange: (e) => onChange(e.target.value) });
      return h("div", null,
        h("div", { className: "blw-rows" },
          list.length === 0
            ? h("div", { className: "blw-hint" }, "（没有窗口 = 永远不醒；至少加一个）")
            : list.map((w, i) =>
                h("div", { className: "blw-row", key: i },
                  h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                    h("span", { className: "blw-hint", style: { minWidth: "18px" } }, String(i + 1)),
                    timeInput(w.start, (v) => upd(i, { start: v })),
                    h("span", { className: "blw-hint" }, "→"),
                    timeInput(w.end, (v) => upd(i, { end: v })),
                    h("span", { className: "blw-hint" }, "醒来"),
                    h("input", {
                      className: "blw-input", style: { width: "56px", minWidth: "56px" }, type: "number", min: 1,
                      value: w.wakes ?? 1, onChange: (e) => upd(i, { wakes: Number(e.target.value) || 1 }),
                    }),
                    h("span", { className: "blw-hint" }, "次")),
                  h("button", { className: "blw-btn blw-btn2", disabled: list.length <= 1, onClick: () => del(i), title: "删掉这个窗口" }, "×")))),
        h("div", { style: { marginTop: "8px" } },
          h("button", { className: "blw-btn blw-btn2", onClick: add }, "+ 添加窗口")));
    }

    function SwitchRow({ label, hint, value, onChange, disabled }) {
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, label),
          hint ? h("div", { className: "blw-hint" }, hint) : null),
        h("input", { type: "checkbox", checked: !!value, disabled: !!disabled, onChange: (e) => onChange(e.target.checked) }));
    }

    // ── 分享（主动告诉你 · 二选一：评论 @ / 私信）────────────────────
    function ShareEditor({ cfg, set }) {
      const s = cfg.share ?? {};
      const daily = cfg.quota?.shareDaily ?? 3;
      const via = s.via === "dm" ? "dm" : "comment";
      const viaRadio = ([value, label, hint]) =>
        h("label", { key: value, style: { display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "10px", cursor: "pointer" } },
          h("input", { type: "radio", name: "blw-share-via", checked: via === value, style: { marginTop: "3px" }, onChange: () => set(["share", "via"], value) }),
          h("div", null,
            h("div", { className: "blw-label" }, label),
            h("div", { className: "blw-hint" }, hint)));
      return h("div", null,
        h("div", { className: "blw-group" }, "分享（主动告诉你 · 二选一）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "开", hint: "关掉 = 她只看不分享", value: s.enabled !== false, onChange: (v) => set(["share", "enabled"], v) }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "分享方式（二选一）"),
              h("div", { className: "blw-hint" }, "只在「有值得分享的」时才发；一条都不值得就一条都不发")),
            h("div", null,
              viaRadio(["comment", "评论区 @ 你", "在视频评论区发一条带 @ 的公开评论（原功能 · 别人也看得到）"]),
              viaRadio(["dm", "B站私信", "不发公开评论，直接把分享内容 + 视频链接私信给你（更干净，需要互关）"]))),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "每天上限"),
              h("div", { className: "blw-hint" }, via === "dm"
                ? "私信：一天只锁定你一个收信人，条数不限"
                : "同一视频 7 天内一次 · 只从「深读过的」里选 · 调大时会弹警告")),
            h("input", {
              className: "blw-input", style: { width: "80px", minWidth: "80px" }, type: "number", min: 0,
              value: daily, onChange: (e) => set(["quota", "shareDaily"], Number(e.target.value)),
            }))));
    }

    // ── 全天监听（别人找她）──────────────────────────────────────────
    function ListenEditor({ cfg, set }) {
      const L = cfg.listen ?? {};
      const mins = Math.max(1, Math.round((L.commentIntervalSec ?? 300) / 60));
      const sel = (value, options, onChange) =>
        h("select", { className: "blw-select", value, onChange: (e) => onChange(e.target.value) },
          options.map(([v, label]) => h("option", { key: v, value: v }, label)));
      const num = (value, onChange, w = "70px") =>
        h("input", { className: "blw-input", style: { width: w, minWidth: w }, type: "number", min: 0, value: value ?? "", onChange: (e) => onChange(Number(e.target.value)) });
      return h("div", null,
        h("div", { className: "blw-group" }, "全天监听（别人找她）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "评论区监听", hint: `每 ${mins} 分钟查一次「回复我的 / @我的」`, value: L.comment !== false, onChange: (v) => set(["listen", "comment"], v) }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "查一次间隔（分钟）"),
              h("div", { className: "blw-hint" }, "别小于 1 分钟，免得像刷接口")),
            num(mins, (v) => set(["listen", "commentIntervalSec"], Math.max(60, v * 60)))),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "只回"),
              h("div", { className: "blw-hint" }, "哪种通知算「找她」")),
            sel(L.scope ?? "both", [["both", "直接回我的 + @我的"], ["reply", "只回直接回我的"]], (v) => set(["listen", "scope"], v))),
          h(SwitchRow, { label: "同一个人最多只回一条", hint: "30 天内只回一次同一人（默认开 ✓）", value: L.oncePerPerson !== false, onChange: (v) => set(["listen", "oncePerPerson"], v) }),
          h(SwitchRow, { label: "全天（我睡着时也回）", hint: "关掉 = 只在她醒着的窗口里听", value: !!L.allDay, onChange: (v) => set(["listen", "allDay"], v) }),

          h(SwitchRow, {
            label: "私信监听（只认主人）", value: !!L.dm, onChange: (v) => set(["listen", "dm"], v),
            hint: "每 20 秒看一次主人有没有给你发私信 —— 有就叫醒你，实时回；他不说话就零开销",
          }),
          h(SwitchRow, { label: "直播间监听", hint: "蹲直播间弹幕里有没有叫她", value: !!L.live, onChange: (v) => set(["listen", "live"], v) }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "直播间房间号"),
              h("div", { className: "blw-hint" }, "留空 = 不蹲直播")),
            h("input", { className: "blw-input", style: { width: "120px", minWidth: "120px" }, value: L.liveRoom ?? "", placeholder: "例如 12345", onChange: (e) => set(["listen", "liveRoom"], e.target.value) })),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "直播间只回"),
              h("div", { className: "blw-hint" }, "只回主人 = 观众的一律不理；只回艾特她的 = 只看有没有人叫她")),
            sel(L.liveScope ?? "owner", [["owner", "只回主人"], ["mention", "只回艾特她的"]], (v) => set(["listen", "liveScope"], v)))),
          // 2026-10-22 主人定：自我介绍该回，但一天只回一次
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "别人问「你是谁」一天最多回"),
              h("div", { className: "blw-hint" }, "自我介绍属于「该答的」：额度内她自己回（一次一两句、不提你任何信息）；0 = 一律写草稿给你审")),
            num(L.introDaily ?? 1, (v) => set(["listen", "introDaily"], Math.max(0, Number(v) || 0)))),
          // 2026-10-22：唯一一个"对陌生人说话"的口子 —— 默认关
          h(SwitchRow, {
            label: "允许回复私信（只回先找她的人）",
            hint: "默认关。开了以后：对方必须**先**给她发过私信（72h 内）、必须互关、一天最多 1 条、同一人 30 天一次；只写她自己的事",
            value: L.replyDm === true,
            onChange: (v) => set(["listen", "replyDm"], v),
          }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "回复私信：一天最多几条"),
              h("div", { className: "blw-hint" }, "建议就 1 条。B站私信对陌生人风控很严，多了像营销号")),
            num(L.replyDmDaily ?? 1, (v) => set(["listen", "replyDmDaily"], Math.max(0, Number(v) || 0)))),
          // 2026-10-24 主人定：括号备注做成自动 + 可开关
          h(SwitchRow, {
            label: "回复末尾带上「消耗 / 额度」备注",
            hint: "自动在句末加「（本次消耗 N token · 本日对话次数已用完）」；N 是今天的真实用量。命令行可用 --no-cost-note 单条关掉",
            value: L.dmCostNote !== false,
            onChange: (v) => set(["listen", "dmCostNote"], v),
          }),
        h("div", { className: "blw-out" },
          "【风控护栏 · 不可关】撞到 12015 / 12051 / 10031 立刻停监听 + 报你\n" +
          "【权限说明 · 只读】这一轮只注册只读工具；「发评论」必须显式打开；\n不注册：上传视频、发动态、私信群发、抓全站"));
    }

    // ── 指定清单（点名的必看）────────────────────────────────────────
    function WatchEditor({ cfg, set }) {
      const w = cfg.watchlist ?? {};
      const toText = (arr, kind) => (Array.isArray(arr) ? arr : []).map((x) => {
        if (typeof x === "string") return x;
        if (kind === "ups") return x?.name ? `${x.mid} ${x.name}` : (x?.mid ?? "");
        return x?.note ? `${x.bv} ${x.note}` : (x?.bv ?? "");
      }).filter(Boolean).join("\n");
      const [ups, setUps] = useState(toText(w.ups, "ups"));
      const [vids, setVids] = useState(toText(w.videos, "videos"));
      useEffect(() => { setUps(toText(w.ups, "ups")); }, [JSON.stringify(w.ups ?? null)]);
      useEffect(() => { setVids(toText(w.videos, "videos")); }, [JSON.stringify(w.videos ?? null)]);
      const commitUps = (v) => { setUps(v); set(["watchlist", "ups"], v.split("\n").map((s) => s.trim()).filter(Boolean)); };
      const commitVids = (v) => { setVids(v); set(["watchlist", "videos"], v.split("\n").map((s) => s.trim()).filter(Boolean)); };
      return h("div", null,
        h("div", { className: "blw-group" }, "指定清单（点名的必看）"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row", style: { display: "block" } },
            h("div", { className: "blw-label" }, "指定 UP 主"),
            h("div", { className: "blw-hint" }, "一行一个：mid 或空间链接，后面跟名字 —— 名字不是装饰：空间接口被风控时，降级成「按名字 + mid 过滤」全靠它"),
            h("textarea", { className: "blw-ta", value: ups, placeholder: "123456 某某UP\nhttps://space.bilibili.com/123456", onChange: (e) => commitUps(e.target.value) })),
          h("div", { className: "blw-row", style: { display: "block" } },
            h("div", { className: "blw-label" }, "指定视频"),
            h("div", { className: "blw-hint" }, "一行一个：BV 号或视频链接，后面可跟一句备注；**即使看过也会保留**（你点名的，可能想再看一遍）"),
            h("textarea", { className: "blw-ta", value: vids, placeholder: "BV1xx411c7mD 想再看一遍\nhttps://www.bilibili.com/video/BV1xx411c7mD/", onChange: (e) => commitVids(e.target.value) }))));
    }

    // ── 预算（token · 估算口径）──────────────────────────────────────
    function BudgetEditor({ cfg, set }) {
      const b = cfg.budget ?? {};
      const num = (key, label, hint, min, max, step) =>
        h("div", { className: "blw-row" },
          h("div", null, h("div", { className: "blw-label" }, label), h("div", { className: "blw-hint" }, hint)),
          h("input", {
            className: "blw-input", style: { width: "104px", minWidth: "104px" }, type: "number", min, max, step,
            value: b[key] ?? "", onChange: (e) => set(["budget", key], e.target.value === "" ? undefined : Number(e.target.value)),
          }));
      return h("div", null,
        h("div", { className: "blw-group" }, "预算（token · 估算口径）"),
        h("div", { className: "blw-rows" },
          num("replyMaxTokens", "单条回复上限", "宿主 maxTokens 硬顶：一条回复最多生成多少 token —— 超了会被真的截断，不是估算", 256, 8000, 64),
          num("videoMaxTokens", "单次视频上限", "读之前先算账：超了自动截字幕 / 少给热评 / 不抽帧（抽帧按 5400 token 算）", 2000, 120000, 1000),
          num("wakeMaxTokens", "单次唤醒上限", "决定这一轮「初筛几条 + 深读几条」；`node bili.mjs budget status` 能看最近的账", 5000, 400000, 1000)),
        h("div", { className: "blw-out" },
          "单条回复 = 真硬顶（agent/request 下发 maxTokens）✓\n" +
          "单次视频 / 单次唤醒 = 在生成素材那一刻按预算裁好（截字幕、少热评、不抽帧），不是事后记账 ✓\n" +
          "中文按 1 字 ≈ 1 token 保守估；真实 usage 由宿主带回来，记进 whale-spend.jsonl（估算归估算、账单归账单）"));
    }

    // ── 口味源（关注 / 收藏 / 历史）──────────────────────────────────
    function TasteEditor({ cfg, set }) {
      const t = cfg.taste ?? {};
      const sw = (key, label, hint) => h(SwitchRow, { label, hint, value: t[key] !== false, onChange: (v) => set(["taste", key], v) });
      const num = (key, label, hint, min, max, step) =>
        h("div", { className: "blw-row" },
          h("div", null, h("div", { className: "blw-label" }, label), h("div", { className: "blw-hint" }, hint)),
          h("input", {
            className: "blw-input", style: { width: "92px", minWidth: "92px" }, type: "number", min, max, step,
            value: t[key] ?? "", onChange: (e) => set(["taste", key], e.target.value === "" ? undefined : Number(e.target.value)),
          }));
      return h("div", null,
        h("div", { className: "blw-group" }, "口味源（关注 / 收藏 / 历史）"),
        h("div", { className: "blw-rows" },
          sw("enabled", "启用", "关掉 = 回到「只按日记偏好」的老逻辑"),
          sw("owner", "读主人的公开收藏与关注", "零额外授权：B站公开的收藏夹和关注列表（实测能读 31 个夹 / 100 个关注）"),
          sw("excludeFavorites", "收藏过的直接跳过", "已经看过 / 想留着的不再推给她"),
          sw("excludeHistory", "看过的直接跳过", "只对登录账号自己的历史有效 —— 别人的观看历史 B 站不给"),
          num("boostFollow", "关注的人 +N 分", "默认 6；只加分、不排除（关掉只影响加分）", 0, 20, 1),
          num("boostTopic", "口味词 +N 分", "每个命中 +N，单条封顶 2N（默认 3）", 0, 10, 1),
          num("recentDays", "历史只学最近", "天（默认 30；点开就退的不学，看完的学得最重）", 1, 365, 5)),
        h("div", { className: "blw-out" },
          "档案落在 ~/.bili-ai/taste.json（本机；不上传、不进日记）\n" +
          "拉取：`node bili.mjs taste sync`；她下次醒来会自动 `taste sync --if-stale`（超 24h 才拉）\n" +
          "⚠️ 别人的观看历史读不到（B站只给登录账号）—— 要排除「你自己看过的」，需要把你自己的 cookie 也配进来"));
    }

    // ── 待审核（她回复别人之前，草稿先给你看）────────────────────────
    function PendingEditor() {
      const [items, setItems] = useState([]);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");

      const load = useCallback(async () => {
        try { const r = await fetch(`${API}/pending`, { headers: { accept: "application/json" } }); const j = await r.json(); setItems(j.items ?? []); } catch {}
      }, []);
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

      const act = async (id, what) => {
        setBusy(id + what); setMsg("");
        try {
          const r = await fetch(`${API}/pending/${what}`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ id }),
          });
          const j = await r.json().catch(() => ({}));
          setMsg(j.ok
            ? (what === "approve" ? `✓ 已发${j.rpid ? " · rpid=" + j.rpid : ""}` : "✓ 已删掉（也记了一笔「否」）")
            : `✗ ${j.error ?? "失败"}`);
          await load();
        } catch (e) { setMsg("✗ " + e.message); } finally { setBusy(""); }
      };

      return h("div", null,
        h("div", { className: "blw-group" }, "待审" + (items.length ? `（${items.length} 条）` : "")),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她回复别人之前，草稿先到这儿 —— 你点「发」才发 ✓（否掉也会记一笔，她会学着调）"),
        h("div", { className: "blw-rows" },
          items.length === 0
            ? h("div", { className: "blw-hint", style: { padding: "8px 0" } }, "（队列是空的 ✓）")
            : items.map((x) => h("div", { className: "blw-row", key: x.id },
                h("div", null,
                  h("div", { className: "blw-label" }, `@${x.who || "对方"}`, h("span", { className: "blw-badge" }, String(x.at ?? "").slice(5, 16).replace("T", " "))),
                  x.src ? h("div", { className: "blw-hint" }, `他说：${String(x.src).slice(0, 80)}`) : null,
                  h("div", { className: "blw-hint", style: { color: "var(--dsw-alias-label-primary)", marginTop: "4px" } }, `你要回：${x.message}`)),
                h("div", { style: { display: "flex", gap: "6px" } },
                  h("button", { className: "blw-btn", disabled: !!busy, onClick: () => act(x.id, "approve") }, busy === x.id + "approve" ? "发出中…" : "发"),
                  h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => act(x.id, "reject") }, "否"))))),
        msg ? h("div", { className: msg.startsWith("✓") ? "blw-hint" : "blw-err" }, msg) : null);
    }

    // ── 消息推送（她看完一轮，把摘要送到哪）──────────────────────────
    function NotifyEditor({ cfg, set, save }) {
      const n = cfg.notify ?? {};
      const type = ["none", "desktop", "dm", "webhook", "command"].includes(n.type) ? n.type : "none";
      const [testing, setTesting] = useState(false);
      const [testOut, setTestOut] = useState("");
      const setType = (v) => set(["notify", "type"], v);
      const radio = ([value, label]) =>
        h("label", { key: value, style: { display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "14px", cursor: "pointer", fontSize: "13px" } },
          h("input", { type: "radio", name: "blw-notify", checked: type === value, onChange: () => setType(value) }),
          label);
      const test = async () => {
        setTesting(true); setTestOut("…正在保存设置（测试前先落盘 ✓）\n");
        try {
          // 测试前先保存 —— 否则"点了别的单选、测试却还发到旧通道" ✗
          await save();
          const r = await fetch(`${API}/notify-test`, { method: "POST", headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          setTestOut((j.ok ? "✓ 已发送（设置已自动保存 ✓）\n" : "✗ 失败（设置已自动保存 ✓）\n") + (j.out || "") + (j.err ? "\n" + j.err : ""));
        } catch (e) { setTestOut("✗ " + e.message); } finally { setTesting(false); }
      };
      const box = { className: "blw-out", style: { marginTop: "8px" } };
      return h("div", null,
        h("div", { className: "blw-group" }, "消息推送"),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她看完一轮，把摘要送到哪？"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "方式"),
              h("div", { className: "blw-hint" }, "不推送 = 只写日记与事件流")),
            h("div", null, ["none", "desktop", "dm", "webhook", "command"].map((v, i) =>
              radio([v, ["不推送", "桌面通知", "B站私信", "Webhook", "自定义命令"][i]])))),

          type === "webhook" ? h("div", null,
            h("div", { className: "blw-row" },
              h("div", null,
                h("div", { className: "blw-label" }, "Webhook 地址"),
                h("div", { className: "blw-hint" }, "飞书 / 钉钉 / 企业微信 / QQ机器人 / WorkBuddy —— 把机器人给的地址贴进来就行（报文按域名自动适配 ✓）")),
              h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.url ?? "", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/", onChange: (e) => set(["notify", "url"], e.target.value) })),
            h("div", { className: "blw-row" },
              h("div", null,
                h("div", { className: "blw-label" }, "模板"),
                h("div", { className: "blw-hint" }, "纯文本最稳；飞书/钉钉用 markdown 会漂亮一点")),
              h("select", { className: "blw-select", value: n.template ?? "text", onChange: (e) => set(["notify", "template"], e.target.value) },
                h("option", { value: "text" }, "纯文本"),
                h("option", { value: "markdown" }, "markdown")))) : null,

          type === "command" ? h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "自定义命令"),
              h("div", { className: "blw-hint" }, "cmd = 可执行文件（如 node.exe）；消息**自动作为最后一个参数**传进去"),
              h("div", { className: "blw-hint" }, "⚠️ 不再支持 $MSG（2026-10-18 弃用：走 shell 有命令注入风险 ✗）")),
            h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.cmd ?? "", placeholder: 'C:\\path\\to\\node.exe', onChange: (e) => set(["notify", "cmd"], e.target.value) }),
            h("div", { className: "blw-hint", style: { marginTop: "6px" } }, "参数（JSON 数组，可留空；比如 [\"C:/path/to/cli.js\"]）"),
            h("input", {
              className: "blw-input blw-wide", style: { minWidth: "300px" },
              value: JSON.stringify(n.args ?? []),
              onChange: (e) => {
                try { const v = JSON.parse(e.target.value); set(["notify", "args"], Array.isArray(v) ? v : []); } catch {}
              },
              placeholder: '["C:/path/to/cli.js"]',
            })) : null),

        h("div", { className: "blw-actions", style: { borderTop: "none", marginTop: "8px", paddingTop: "0" } },
          h("button", { className: "blw-btn blw-btn2", onClick: test, disabled: testing }, testing ? "发送中…" : "发条测试"),
          type === "none" ? h("span", { className: "blw-hint" }, "（方式=不推送时，测试只验证命令能跑通）") : null),
        testOut ? h("div", box, testOut) : null);
    }

    // ── 【鱼的私信】窗口 ─────────────────────────────────────────────
    //   她发给主人的私信同步进本地收件箱；这里看、改、决定发不发评论区。
    //   ⚠️ 发评论只在你点按钮时发生；发出后状态变「已发」并带 rpid（可回读复核）。
    function OutboxPanel({ selectId } = {}) {
      useStyleOnce();
      const [data, setData] = useState(null);
      const [activeId, setActiveId] = useState("");
      const [draft, setDraft] = useState("");
      const [bv, setBv] = useState("");
      const [emotes, setEmotes] = useState([]);
      const [stickers, setStickers] = useState([]);
      const [emoOpen, setEmoOpen] = useState(false);
      const emoLib = useEmoteLib();
      const [mentions, setMentions] = useState([]);
      const [mentionText, setMentionText] = useState("");
      const taRef = React.useRef(null);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");
      const [err, setErr] = useState("");

      const load = useCallback(async () => {
        try {
          const r = await fetch(`${API}/outbox`, { headers: { accept: "application/json" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          setData(j);
          setActiveId((cur) => cur || (j.items?.[0]?.id ?? ""));
          setErr("");
        } catch (e) { setErr(`读取失败：${e.message}`); }
      }, []);
      useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

      // 从「任务台」点「看草稿」跳过来：把那条草稿选中
      useEffect(() => { if (selectId) setActiveId(selectId); }, [selectId]);

      const items = data?.items ?? [];
      const active = items.find((x) => x.id === activeId) ?? null;
      const activeKey = active?.id ?? "";
      useEffect(() => {
        if (!active) return;
        setDraft(active.edited || active.text || "");
        setBv(active.bv || "");
        setEmotes(Array.isArray(active.emotes) ? active.emotes : (active.emote ? [active.emote] : []));
        setStickers(Array.isArray(active.stickers) ? active.stickers : []);
        const ms = Array.isArray(active.mentions) ? active.mentions : [];
        setMentions(ms);
        setMentionText(ms.join("，"));
        setEmoOpen(false);
        setMsg("");
        setErr("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeKey]);

      const insertAtCursor = (token) => {
        const el = taRef.current;
        const start = el && typeof el.selectionStart === "number" ? el.selectionStart : draft.length;
        const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : draft.length;
        setDraft(draft.slice(0, start) + token + draft.slice(end));
        try {
          requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            el.setSelectionRange(start + token.length, start + token.length);
          });
        } catch { /* 没有 rAF 就算了，光标位置不影响正确性 */ }
      };
      const addEmote = (name) => {
        insertAtCursor(`[${name}]`);
        setEmotes((list) => (list.includes(name) || list.length >= MAX_EMOTES_SHOWN ? list : [...list, name]));
      };
      const toggleSticker = (name) => setStickers((list) => (
        list.includes(name) ? list.filter((x) => x !== name)
          : (list.length >= MAX_STICKERS_SHOWN ? list : [...list, name])
      ));
      const applyMentions = () => {
        const names = String(mentionText).split(/[,，、\s]+/).map((s) => s.replace(/^@+/, "").trim()).filter(Boolean).slice(0, 5);
        if (!names.length) { setErr("先填要 @ 的昵称（或 mid）"); return; }
        setMentions(names);
        const prefix = names.map((n) => "@" + n).join(" ") + " ";
        const body = draft.replace(/^(?:@[^\s@]+\s*)+/, "");
        setDraft(prefix + body);
        setErr("");
      };

      const call = async (path, body) => {
        const r = await fetch(`${API}/outbox/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      };

      const doSave = async () => {
        setBusy("save"); setErr("");
        try { await call("save", { id: active.id, text: draft, bv, emotes, mentions, stickers }); setMsg("✓ 已保存（只存本地，没有发出去）"); await load(); }
        catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };
      const doPost = async () => {
        if (!bv) { setErr("先填一个视频 BV —— 评论总得发在某个视频下面"); return; }
        if (!window.confirm(`确认把这条发到 ${bv} 的评论区？\n\n这是公开评论：发出后只能删，不能改。`)) return;
        setBusy("post"); setErr(""); setMsg("");
        try {
          const j = await call("post", { id: active.id, text: draft, bv, emotes, mentions, stickers });
          setMsg(`✓ 已发到评论区${j.rpid ? `（rpid=${j.rpid}）` : ""}：https://www.bilibili.com/video/${bv}/#reply${j.rpid ?? ""}`);
          await load();
        } catch (e) { setErr(`没发出去：${e.message}`); } finally { setBusy(""); }
      };
      const doReject = async () => {
        setBusy("reject"); setErr("");
        try { await call("reject", { id: active.id, reason: "" }); setMsg("已否掉（她下次能学到这种不要）"); await load(); }
        catch (e) { setErr(`操作失败：${e.message}`); } finally { setBusy(""); }
      };
      const doDelete = async () => {
        if (!window.confirm("删除这条记录？（不会撤回已经发出的私信或评论）")) return;
        setBusy("del"); setErr("");
        try { await call("delete", { id: active.id }); setActiveId(""); setMsg("已删除"); await load(); }
        catch (e) { setErr(`删除失败：${e.message}`); } finally { setBusy(""); }
      };

      const badgeOf = (s) => ({ pending: "待审", posted: "已发", rejected: "已否", archived: "归档" }[s] ?? s);
      if (!data) {
        return h("div", { className: "blw" }, h("div", { className: "blw-hint" }, err || "读取中…"));
      }

      return h("div", null,
        h("div", { className: "blwo" },
          h("div", { className: "blwo-list" },
            items.length === 0
              ? h("div", { className: "blw-hint" }, "（还没有私信。她发给你的下一条会自动出现在这里）")
              : items.map((x) => h("div", {
                  key: x.id,
                  className: "blwo-item" + (x.id === activeKey ? " on" : ""),
                  onClick: () => setActiveId(x.id),
                },
                h("div", null, (x.kind === "task" ? "🎯 " : "") + String(x.edited || x.text).replace(/\s+/g, " ").slice(0, 60)),
                h("div", { className: "blwo-meta" },
                  `${badgeOf(x.status)}${x.kind === "task" ? " · 任务稿" : ""} · ${String(x.at).slice(5, 16).replace("T", " ")}${x.bv ? " · " + x.bv : ""}`)))),
          active
            ? h("div", { className: "blwo-pane" },
                h("div", { className: "blw-hint" },
                  `原文 ${String(active.text).length} 字 · 状态 ${badgeOf(active.status)}` +
                  ((active.emotes ?? (active.emote ? [active.emote] : [])).length
                    ? ` · 表情 ${(active.emotes ?? [active.emote]).map((e) => "[" + e + "]").join("")}` : "") +
                  ((active.mentions ?? []).length ? ` · @ ${active.mentions.join(" ")}` : "") +
                  ((active.stickers ?? []).length ? ` · 配图 ${active.stickers.length} 张` : "") +
                  (active.rpid ? ` · rpid ${active.rpid}` : "") +
                  (active.postedAt ? ` · 发于 ${String(active.postedAt).slice(5, 16).replace("T", " ")}` : "")),
                h("textarea", {
                  ref: taRef,
                  className: "blw-ta", style: { minHeight: "clamp(180px, 26vh, 420px)" },
                  value: draft, onChange: (e) => setDraft(e.target.value),
                  placeholder: "要发出去的正文（改这里；原文不会被覆盖）",
                }),
                // 表情：点一下插到光标处（正文里出转义符 + 这里记名字，两份齐了才是真表情 ✓）
                h("div", { className: "blwo-line" },
                  h("span", { className: "blw-hint" }, "表情"),
                  emotes.length
                    ? emotes.map((e, i) => h("span", { key: e, className: "blwo-emotext" },
                        `[${e}]`,
                        h("span", {
                          style: { cursor: "pointer", marginLeft: "4px", opacity: .7 },
                          onClick: () => setEmotes((list) => list.filter((_, j) => j !== i)),
                        }, "×")))
                    : h("span", { className: "blw-hint" }, "（还没挑）"),
                  h("button", {
                    className: "blwo-emobtn",
                    onClick: () => setEmoOpen((v) => {
                      const next = !v;
                      if (next && !emoLib.lib) emoLib.loadTag(emoLib.tag || "");
                      return next;
                    }),
                  }, emoOpen ? "收起表情库" : "打开表情库"),
                  h("span", { className: "blw-hint" }, `最多 ${MAX_EMOTES_SHOWN} 个；点图就插到光标处`)),
                emoOpen
                  ? h("div", null,
                      h(EmoteBoard, {
                        lib: emoLib.lib, tag: emoLib.tag, err: emoLib.err, loadTag: emoLib.loadTag,
                        selected: emotes, onPick: addEmote,
                        stickers, onPickSticker: toggleSticker,
                      }),
                      h("div", { className: "blw-hint" },
                        "库不全就 `node bili.mjs emotes sync`。评论配图会随评论一起发（pictures 字段）。"))
                  : null,
                stickers.length
                  ? h("div", { className: "blwo-line" },
                      h("span", { className: "blw-hint" }, "配图"),
                      stickers.map((name, i) => h("span", { key: name, className: "blwo-emotext" },
                        `🖼 ${name}`,
                        h("span", {
                          style: { cursor: "pointer", marginLeft: "4px", opacity: .7 },
                          onClick: () => setStickers((list) => list.filter((_, j) => j !== i)),
                        }, "×"))),
                      h("span", { className: "blw-hint" }, "发布时上传并作为评论图片附上；一张都没进去会自动删评论"))
                  : null,
                h("div", { className: "blwo-line" },
                  h("span", { className: "blw-hint" }, "发到哪个视频"),
                  h("input", {
                    className: "blw-input", style: { width: "190px", minWidth: "190px" },
                    value: bv, placeholder: "BV1xx411c7mD",
                    onChange: (e) => setBv(e.target.value),
                  })),
                // @ 谁：B站 没有 @ 参数 —— @ 就是正文开头的文字，名字必须和对方现有昵称一致
                h("div", { className: "blwo-line" },
                  h("span", { className: "blw-hint" }, "@ 谁"),
                  h("input", {
                    className: "blw-input", style: { width: "230px", minWidth: "230px" },
                    value: mentionText, placeholder: "昵称或 mid，逗号分隔（可空）",
                    onChange: (e) => setMentionText(e.target.value),
                  }),
                  h("button", { className: "blwo-emobtn", disabled: !!busy, onClick: applyMentions }, "写进正文开头"),
                  h("span", { className: "blw-hint" }, "名字错一个字就 @ 不到；拿不准先 whois")),
                h("div", { className: "blwo-actions" },
                  h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: doSave }, busy === "save" ? "保存中…" : "保存修改"),
                  h("button", { className: "blw-btn", disabled: !!busy || !bv || active.status === "posted", onClick: doPost }, busy === "post" ? "发布中…" : "发到评论区"),
                  h("button", { className: "blw-btn blw-btn2", disabled: !!busy || active.status !== "pending", onClick: doReject }, "否掉"),
                  h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: doDelete }, "删除")),
                msg ? h("div", { className: "blw-hint", style: { color: "var(--dsw-alias-label-primary)" } }, msg) : null,
                err ? h("div", { className: "blw-err" }, err) : null,
                active.error ? h("div", { className: "blw-err" }, `上次失败：${active.error}`) : null,
                h("div", { className: "blw-hint" },
                  "发评论走的是 `comment`，不带 --auto —— 属于「你授权」的发言，不占她每天 3 条的自主额度 ✓"))
            : h("div", { className: "blw-hint" }, "左边选一条")),
        h("div", { className: "blw-hint", style: { marginTop: "10px" } },
          `待审 ${data.stats?.pending ?? 0} · 已发 ${data.stats?.posted ?? 0} · 已否 ${data.stats?.rejected ?? 0}`));
    }

    // ── 【任务台】窗口 ───────────────────────────────────────────────
    //   派活（视频 + 格式 + 字数 + 额外要求）· 看她做到哪了 · 看草稿。
    //   刻意**没有**"直接发布"按钮 —— 草稿一律进「私信」页，由主人在那边点发 ✓
    function TaskPanel({ onOpenDraft } = {}) {
      useStyleOnce();
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");
      const [err, setErr] = useState("");
      const [form, setForm] = useState({
        bv: "", format: "outline", chars: 280, instruction: "", emote: false, mentionOwner: false, mentionsText: "",
        emotes: [], stickers: [],
      });
      const [emoOpen, setEmoOpen] = useState(false);
      const emoLib = useEmoteLib();

      const load = useCallback(async () => {
        try {
          const r = await fetch(`${API}/task`, { headers: { accept: "application/json" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          setData(await r.json());
        } catch (e) { setErr(`读取失败：${e.message}`); }
      }, []);
      useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

      const formats = data?.formats ?? [];
      const labels = data?.labels ?? {};
      const fmtOf = (id) => formats.find((f) => f.id === id) ?? { id, label: id, chars: 280 };
      const cur = fmtOf(form.format);
      const pickFormat = (id) => setForm((s) => ({ ...s, format: id, chars: fmtOf(id).chars ?? s.chars }));
      const toggleEmote = (name) => setForm((s) => {
        if (s.emotes.includes(name)) return { ...s, emotes: s.emotes.filter((x) => x !== name) };
        if (s.emotes.length >= MAX_EMOTES_SHOWN) return s;
        return { ...s, emotes: [...s.emotes, name], emote: true };
      });
      const toggleSticker = (name) => setForm((s) => {
        if (s.stickers.includes(name)) return { ...s, stickers: s.stickers.filter((x) => x !== name) };
        if (s.stickers.length >= MAX_STICKERS_SHOWN) return s;
        return { ...s, stickers: [...s.stickers, name] };
      });

      const call = async (path, body) => {
        const r = await fetch(`${API}/task/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      };

      const add = async (now) => {
        setErr(""); setMsg("");
        setBusy(now ? "add-now" : "add");
        try {
          const j = await call("add", {
            ...form,
            mentions: String(form.mentionsText || "").split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean),
            now,
          });
          if (j.warn) setErr(j.warn);
          else if (!j.created) setMsg(`这条（${cur.label}）已经排在队列里了，没有重复派 ✓`);
          else if (j.prompted) setMsg(`✓ 已经把她叫起来了 —— 她会在会话里读视频、按「${cur.label}」写，写完进「私信」那一页等你 ✓`);
          else setMsg(`✓ 已排进下一次醒来（${j.task?.id ?? ""}）—— 想看现在做就点「现在就做」`);
          await load();
        } catch (e) { setErr(`没派出去：${e.message}`); } finally { setBusy(""); }
      };

      const runNow = async (id) => {
        setErr(""); setMsg(""); setBusy(`run-${id}`);
        try {
          await call("run", { id });
          setMsg("✓ 已经把她叫起来了 —— 她会先跑 debrief 看懂，再按格式写；写完进「私信」页等你 ✓");
          await load();
        } catch (e) { setErr(`没能叫醒她：${e.message}`); } finally { setBusy(""); }
      };

      const cancel = async (id) => {
        setBusy(`cancel-${id}`);
        try { await call("cancel", { id }); await load(); }
        catch (e) { setErr(`取消失败：${e.message}`); } finally { setBusy(""); }
      };

      const del = async (id) => {
        if (!window.confirm("删除这条任务记录？（已经交的草稿还在「私信」页）")) return;
        setBusy(`del-${id}`);
        try { await call("delete", { id }); await load(); }
        catch (e) { setErr(`删除失败：${e.message}`); } finally { setBusy(""); }
      };

      if (!data) {
        return h("div", null, h("div", { className: "blw-hint" }, err || "读取中…"));
      }
      const tasks = data.tasks ?? [];
      const stale = new Set(data.stale ?? []);
      const stamp = (iso) => String(iso ?? "").slice(5, 16).replace("T", " ");

      return h("div", null,
        h("div", { className: "blwo-form" },
          h("div", { className: "blwo-line" },
            h("span", { className: "blw-hint" }, "看哪条"),
            h("input", {
              className: "blw-input", style: { width: "230px" },
              value: form.bv, placeholder: "BV1xx411c7mD 或视频链接",
              onChange: (e) => setForm((s) => ({ ...s, bv: e.target.value })),
            }),
            h("span", { className: "blw-hint" }, "怎么写"),
            h("select", {
              className: "blw-select", style: { minWidth: "130px" },
              value: form.format, onChange: (e) => pickFormat(e.target.value),
            }, formats.map((f) => h("option", { key: f.id, value: f.id }, f.label))),
            h("span", { className: "blw-hint" }, "字数"),
            h("input", {
              className: "blw-input", style: { width: "74px", minWidth: "74px" }, type: "number",
              min: 20, max: 1000, value: form.chars,
              onChange: (e) => setForm((s) => ({ ...s, chars: Number(e.target.value) || s.chars })),
            })),
          h("div", { className: "blw-hint" }, `${cur.label}：${cur.hint ?? ""}`),
          h("textarea", {
            className: "blw-ta", style: { minHeight: "62px" },
            value: form.instruction,
            placeholder: "额外要求（可选；选「自定义」时这里就是主指令）—— 比如「别用感叹号」「一定要提到 03:12 那个实验」「别夸，挑刺」",
            onChange: (e) => setForm((s) => ({ ...s, instruction: e.target.value })),
          }),
          h("div", { className: "blwo-line" },
            h("label", { className: "blwo-chk" },
              h("input", { type: "checkbox", checked: form.emote, onChange: (e) => setForm((s) => ({ ...s, emote: e.target.checked })) }),
              "允许带表情（最多 3 个）"),
            h("label", { className: "blwo-chk" },
              h("input", { type: "checkbox", checked: form.mentionOwner, onChange: (e) => setForm((s) => ({ ...s, mentionOwner: e.target.checked })) }),
              "@ 我")),
          h("div", { className: "blwo-line" },
            h("span", { className: "blw-hint" }, "还要 @ 谁"),
            h("input", {
              className: "blw-input", style: { width: "260px" },
              value: form.mentionsText,
              placeholder: "昵称 / mid，逗号分隔（可空）",
              onChange: (e) => setForm((s) => ({ ...s, mentionsText: e.target.value })),
            }),
            h("span", { className: "blw-hint" }, "她会写进正文开头；名字错一个字就 @ 不到")),
          h("div", { className: "blwo-line" },
            h("span", { className: "blw-hint" }, "指定表情"),
            form.emotes.length
              ? form.emotes.map((e, i) => h("span", { key: e, className: "blwo-emotext" },
                  `[${e}]`,
                  h("span", {
                    style: { cursor: "pointer", marginLeft: "4px", opacity: .7 },
                    onClick: () => setForm((s) => ({ ...s, emotes: s.emotes.filter((_, j) => j !== i) })),
                  }, "×")))
              : h("span", { className: "blw-hint" }, "（不指定 = 她不带表情）"),
            h("button", {
              className: "blwo-emobtn",
              onClick: () => {
                const next = !emoOpen;
                setEmoOpen(next);
                if (next && !emoLib.lib) emoLib.loadTag(emoLib.tag || "");
              },
            }, emoOpen ? "收起表情库" : "从表情库挑"),
            h("span", { className: "blw-hint" }, `最多 ${MAX_EMOTES_SHOWN} 个；挑了就按这几个写`)),
          emoOpen
            ? h(EmoteBoard, {
                lib: emoLib.lib, tag: emoLib.tag, err: emoLib.err, loadTag: emoLib.loadTag,
                selected: form.emotes, onPick: toggleEmote,
                stickers: form.stickers, onPickSticker: toggleSticker,
              })
            : null,
          form.stickers.length
            ? h("div", { className: "blwo-line" },
                h("span", { className: "blw-hint" }, "配图"),
                form.stickers.map((name, i) => h("span", { key: name, className: "blwo-emotext" },
                  `🖼 ${name}`,
                  h("span", {
                    style: { cursor: "pointer", marginLeft: "4px", opacity: .7 },
                    onClick: () => setForm((s) => ({ ...s, stickers: s.stickers.filter((_, j) => j !== i) })),
                  }, "×"))),
                h("span", { className: "blw-hint" }, "交稿时跟着走；发布时作为评论图片附上"))
            : null,
          h("div", { className: "blwo-actions" },
            h("button", { className: "blw-btn", disabled: !!busy || !form.bv, onClick: () => add(true) },
              busy === "add-now" ? "派活中…" : "现在就做"),
            h("button", { className: "blw-btn blw-btn2", disabled: !!busy || !form.bv, onClick: () => add(false) },
              busy === "add" ? "排队中…" : "排进下一次醒来")),
          msg ? h("div", { className: "blw-hint", style: { color: "var(--dsw-alias-label-primary)" } }, msg) : null,
          err ? h("div", { className: "blw-err" }, err) : null),

        h("div", { className: "blw-hint", style: { marginTop: "12px" } },
          "她的活是：`debrief` 看懂这条（预算上限就是设置里的「单次视频」）→ 按格式写 → 交草稿。",
          h("b", null, " 她不会发评论"), " —— 草稿进「私信」页，发不发你点。"),

        tasks.length === 0
          ? h("div", { className: "blw-hint", style: { marginTop: "10px" } }, "（还没有任务。上面填个 BV 就能派第一个）")
          : h("div", { className: "blwo-tasks" },
              tasks.map((t) => h("div", { key: t.id, className: "blwo-task" },
                h("div", { className: "blwo-taskline" },
                  h("span", { className: "blwo-chip" }, labels[t.status] ?? t.status),
                  h("b", { style: { fontFamily: "ui-monospace,Menlo,monospace" } }, t.bv),
                  h("span", null, fmtOf(t.format).label),
                  (t.emotes ?? []).length
                    ? h("span", { className: "blw-hint" }, `表情 ${t.emotes.map((e) => "[" + e + "]").join("")}`)
                    : null,
                  (t.stickers ?? []).length
                    ? h("span", { className: "blw-hint" }, `🖼 ${t.stickers.join(" ")}`)
                    : null,
                  h("span", { className: "blw-hint" }, `≤${t.chars} 字 · ${stamp(t.at)}`),
                  stale.has(t.id) ? h("span", { className: "blw-err" }, "像卡住了（可重做）") : null),
                t.title ? h("div", { className: "blw-hint" }, `《${t.title}》`) : null,
                t.instruction ? h("div", { className: "blw-hint" }, `要求：${t.instruction}`) : null,
                t.error ? h("div", { className: "blw-err" }, `上次：${t.error}`) : null,
                h("div", { className: "blwo-actions" },
                  t.draftId && onOpenDraft
                    ? h("button", { className: "blw-btn", onClick: () => onOpenDraft(t.draftId) },
                        t.status === "posted" ? "看发出的那条" : "看草稿")
                    : null,
                  t.status !== "posted" && t.status !== "cancelled"
                    ? h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => runNow(t.id) },
                        busy === `run-${t.id}` ? "叫醒中…" : (t.attempts ? "重做" : "立刻做"))
                    : null,
                  t.status === "todo" || t.status === "running" || t.status === "drafted"
                    ? h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => cancel(t.id) }, "取消")
                    : null,
                  h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => del(t.id) }, "删除")))),
              h("div", { className: "blw-hint", style: { marginTop: "2px" } },
                `排队 ${data.stats?.todo ?? 0} · 在做 ${data.stats?.running ?? 0} · 待审 ${data.stats?.drafted ?? 0} · 已发 ${data.stats?.posted ?? 0}`)));
    }

    // ── 窗口外壳：两页（私信 / 任务台）────────────────────────────────
    function WhaleWindow() {
      useStyleOnce();
      const [tab, setTab] = useState("dm");
      const [dmId, setDmId] = useState("");
      const [counts, setCounts] = useState({ pending: 0, tasks: 0 });

      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const [o, t] = await Promise.all([
              fetch(`${API}/outbox`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)),
              fetch(`${API}/task`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)),
            ]);
            if (!alive) return;
            const s = t?.stats ?? {};
            setCounts({
              pending: o?.stats?.pending ?? 0,
              tasks: Number(s.todo ?? 0) + Number(s.running ?? 0) + Number(s.drafted ?? 0),
            });
          } catch { /* 数字刷不出来不影响用 */ }
        };
        tick();
        const iv = setInterval(tick, 30000);
        return () => { alive = false; clearInterval(iv); };
      }, []);

      return h("div", { className: "blw" },
        h("h3", { className: "blw-title" }, "鱼的私信 · 任务台",
          h("span", { className: "blwo-chip", style: { marginLeft: "8px", fontWeight: 400 } }, VERSION)),
        h("p", { className: "blw-intro" },
          "「私信」是她写给你的 —— 改完你决定发不发；",
          "「任务台」是你派活给她 —— 指定哪条视频、按什么格式写，她只交草稿。"),
        h("div", { className: "blwo-tabs" },
          h("button", { className: "blwo-tab" + (tab === "dm" ? " on" : ""), onClick: () => setTab("dm") },
            counts.pending ? `私信 · ${counts.pending} 待审` : "私信"),
          h("button", { className: "blwo-tab" + (tab === "task" ? " on" : ""), onClick: () => setTab("task") },
            counts.tasks ? `任务台 · ${counts.tasks} 在办` : "任务台")),
        tab === "dm"
          ? h(OutboxPanel, { selectId: dmId })
          : h(TaskPanel, { onOpenDraft: (id) => { setDmId(id); setTab("dm"); } }));
    }

    // ── 设置页（养鱼）──────────────────────────────────────────────
    function BiliWhaleSection() {
      useStyleOnce();
      const [cfg, setCfg] = useState(null);
      const [savedJson, setSavedJson] = useState("");
      const [out, setOut] = useState("");
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState("");
      const [ck, setCk] = useState({ sessdata: "", bili_jct: "", buvid3: "" });
      const [ckMsg, setCkMsg] = useState("");

      const load = useCallback(async () => {
        setErr("");
        try {
          const r = await fetch(`${API}/settings`, { headers: { accept: "application/json" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? "（被信任栅栏拒绝）" : ""}`);
          const j = await r.json();
          setCfg(j.config ?? {});
          setSavedJson(JSON.stringify(j.config ?? {}));
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);

      useEffect(() => { load(); }, [load]);

      const set = (path, value) => setCfg((c) => {
        const next = JSON.parse(JSON.stringify(c ?? {}));
        setPath(next, path, value);
        return next;
      });

      const save = async () => {
        setBusy("save"); setErr(""); setOut("");
        try {
          const wins = cfg?.night?.windows ?? [];
          const total = Math.max(1, wins.reduce((s, w) => s + (Number(w.wakes) || 1), 0));
          const body = { ...(cfg ?? {}), night: { ...(cfg?.night ?? {}), maxWakesPerDay: total } };
          const r = await fetch(`${API}/settings`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ config: body }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setOut(`✓ 已保存${j.warn ? `\n⚠️ ${j.warn}` : ""}\n配置：${j.configPath ?? "~/.dsh/bili-whale.config.json"}`);
          if (j.config) { setCfg(j.config); setSavedJson(JSON.stringify(j.config)); }
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };

      const deps = async () => {
        setBusy("deps"); setErr(""); setOut("检查中…");
        try {
          const r = await fetch(`${API}/deps`, { headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          const lines = (j.items ?? []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} —— ${i.detail ?? ""}`);
          await load();
          if (j.self) lines.push("", `她自己：${j.self.name}（mid ${j.self.mid}）✓`);
          setOut([...lines, "", j.ok ? "全部可用 ✓" : "有项不可用 ✗"].join("\n"));
        } catch (e) { setErr(`依赖体检失败：${e.message}`); } finally { setBusy(""); }
      };

      const saveCookie = async () => {
        setBusy("cookie"); setErr(""); setCkMsg("");
        try {
          const r = await fetch(`${API}/cookie`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(ck),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setCkMsg(`✓ ${j.detail ?? "已写入"}`);
          setCk({ sessdata: "", bili_jct: "", buvid3: "" });
        } catch (e) { setCkMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      if (!cfg) {
        return h("div", { className: "blw" },
          h("h3", { className: "blw-title" }, "养鱼"),
          err ? h("div", { className: "blw-err" }, err) : h("div", { className: "blw-hint" }, "读取中…"));
      }

      const groups = [];
      for (const f of FIELDS) {
        let g = groups.find((x) => x.name === f.group);
        if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
        g.fields.push(f);
      }
      const renderGroup = (g) => h("div", { key: g.name },
        h("div", { className: "blw-group" }, g.name),
        g.name === "作息" ? h(WindowsEditor, { cfg, set }) : null,
        h("div", { className: "blw-rows" }, g.fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set }))));
      const cut = Math.max(0, groups.findIndex((g) => g.name === "口味") + 1) || groups.length;
      const groupsTop = groups.slice(0, cut);
      const groupsBottom = groups.slice(cut);
      const ci = { className: "blw-input" };

      return h("div", { className: "blw" },
        h("h3", { className: "blw-title" }, "养鱼"),
        h("p", { className: "blw-intro" },
          "agent 自己按作息刷 B 站、看懂视频、写两本日记，把值得的 @ 你。",
          "所有值写在 ", h("code", null, "~/.dsh/bili-whale.config.json"),
          "（与工具链共用同一份 ✓；这里没显示的字段保存时原样保留 ✓）"),

        ...groupsTop.map(renderGroup),

        h(ShareEditor, { cfg, set }),
        h(ListenEditor, { cfg, set }),
        h(WatchEditor, { cfg, set }),
        h(BudgetEditor, { cfg, set }),
        h(TasteEditor, { cfg, set }),

        ...groupsBottom.filter((g) => g.name !== "工具链").map(renderGroup),
        h(NotifyEditor, { cfg, set, save }),
        ...groupsBottom.filter((g) => g.name === "工具链").map(renderGroup),

        h("div", { className: "blw-group" }, "B 站 cookie"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "凭据"),
              h("div", { className: "blw-hint" }, "浏览器 F12 → Cookie 里复制（SESSDATA 是 HttpOnly，console 拿不到 ✗）；写入后永不回显 ✓")),
            h("div", { className: "blw-cookie" },
              h("input", { ...ci, placeholder: "SESSDATA", value: ck.sessdata, onChange: (e) => setCk((s) => ({ ...s, sessdata: e.target.value })) }),
              h("input", { ...ci, placeholder: "bili_jct", value: ck.bili_jct, onChange: (e) => setCk((s) => ({ ...s, bili_jct: e.target.value })) }),
              h("input", { ...ci, placeholder: "buvid3（可空）", value: ck.buvid3, onChange: (e) => setCk((s) => ({ ...s, buvid3: e.target.value })) }),
              h("button", { className: "blw-btn blw-btn2", onClick: saveCookie, disabled: !!busy || !ck.sessdata || !ck.bili_jct },
                busy === "cookie" ? "写入中…" : "写入凭据"),
              ckMsg ? h("div", { className: ckMsg.startsWith("✓") ? "blw-hint" : "blw-err" }, ckMsg) : null))),

        h("div", { className: "blw-actions" },
          h("button", { className: "blw-btn", onClick: save, disabled: !!busy }, busy === "save" ? "保存中…" : "保存"),
          cfg && savedJson && JSON.stringify(cfg) !== savedJson
            ? h("span", { style: { marginLeft: "10px", color: "#ffb020", fontSize: "13px" } }, "● 有改动还没保存（改了不点保存 = 没生效 ✗）")
            : null,
          h("button", { className: "blw-btn blw-btn2", onClick: deps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
          h("button", { className: "blw-btn blw-btn2", onClick: load, disabled: !!busy }, "重新读取")),

        err ? h("div", { className: "blw-err" }, err) : null,
        out ? h("div", { className: "blw-out" }, out) : null,
        h("div", { className: "blw-hint" }, "装完先点「依赖体检」：cookie / ffmpeg / node / 数据目录 都 ✓ 才算可用。"));
    }

    const inject = ["slots"];
    const NS = "bili-whale";
    const NAMES = { nav: "养鱼" };

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 6, label: () => NAMES.nav },
              BiliWhaleSection,
            ),
            "bili-whale: settings section",
          ),
        "bili-whale: settings section",
      );

      // 私信窗口：左侧一个 🐟 图标 → 整页窗口。
      //   用 main + sidebar.panellist：宿主公开契约里唯一**不依附某个会话**的整页窗口 ✓
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.panellist", () =>
            ctx.slots.register(
              { name: "sidebar.panellist", id: "bili-whale-outbox", order: 30, label: () => "鱼的私信 · 任务台" },
              (owner = {}) => h("span", { style: { fontSize: `${owner.size ?? 16}px`, lineHeight: 1 } }, "🐟"),
            ),
            "bili-whale: sidebar entry",
          ),
        "bili-whale: sidebar entry",
      );
      ctx.effect(
        () =>
          ctx.slots.inject("main", () =>
            ctx.slots.register(
              { name: "main", key: "bili-whale-outbox" },
              () => h(WhaleWindow, {}),
            ),
            "bili-whale: outbox panel",
          ),
        "bili-whale: outbox panel",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.BiliWhaleSection = BiliWhaleSection;
    exports.FIELDS = FIELDS;
    return module.exports;
  },
});
