/**
 * dsh-vision-fallback — client half (「默认视觉」).
 *
 * Two pieces:
 *  1. A compact「默认视觉」checkbox injected at `conversation.input.right`
 *     (the trailing cluster, right before the model seat + send button).
 *     It live-flips `vision-fallback.enabled` in the settings scope, which
 *     the host bridge reads on every `llm/stream` dispatch.
 *  2. A「默认视觉」settings section (engine / summary / OCR / limits).
 *
 * The actual conversion happens HOST-SIDE on the `llm/stream` waterfall:
 * the thumbnail stays in the conversation log, the model receives only the
 * locally-recognized text. The image is admitted (model declares
 * `input: ["text","image"]`), the thumbnail stays in the composer, and only
 * the model's outgoing request carries the text. The client never rewrites
 * the draft.
 *
 * Hand-written ModuleLoader bundle — no build step (same pattern as
 * dsh-tool-vision).
 */
window.__ModuleLoader__.load({
  id: "dsh-vision-fallback",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    var CSS =
      ".__vf_toggle{display:inline-flex;align-items:center;gap:6px;height:100%;user-select:none;cursor:pointer}" +
      ".__vf_check{accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;margin:0}" +
      ".__vf_text{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap}" +
      ".__vf_root{max-width:640px;display:flex;flex-direction:column;gap:10px}" +
      ".__vf_field{display:flex;flex-direction:column;gap:4px}" +
      ".__vf_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}" +
      ".__vf_override{font-size:10px;color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px}" +
      ".__vf_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__vf_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%}" +
      ".__vf_row{display:flex;align-items:center;gap:8px}" +
      ".__vf_actions{display:flex;gap:8px;align-items:center;margin-top:4px}" +
      ".__vf_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}" +
      ".__vf_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__vf_btn:disabled{opacity:.5;cursor:default}" +
      ".__vf_btnPrimary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-accent)}" +
      ".__vf_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__vf_error{font-size:12px;color:var(--dsw-alias-state-error-primary)}" +
      ".__vf_unavailable{font-size:13px;color:var(--dsw-alias-label-tertiary)}";
    var tagId = "dsh-vision-fallback/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-vision-fallback";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var NS = "visionFallback";
    var inject = ["slots", "locale", "settingsScope"];

    var zh = {
      nav: "默认视觉",
      toggle: "默认视觉",
      toggleTitle: "开启后,拖入图片会照常显示缩略图;发送时由本地 picturereader(OCR + 像素扫描)转成文本,任何模型都能稳定读图。识别不走外接视觉模型。",
      intro: "拖入图片 → 显示缩略图 → 发送时自动用本地 OCR + 像素扫描转成文本,再发给模型。识别全程本地,不调用真实视觉模型。修改即时生效。",
      enabled: "启用默认视觉(发送框旁的勾选控制的也是这一项)",
      engine: "OCR 引擎",
      engineWindows: "Windows(免装,印刷/界面文字)",
      enginePaddle: "Paddle(炫光/弯曲/游戏字更好)",
      includeScan: "注入像素摘要(布局/主色/结构)",
      includeOcr: "注入 OCR 文字",
      language: "OCR 语言(空 = 自动,如 zh-Hans)",
      maxImageBytes: "图片大小上限(字节)",
      convertUnsupported: "webp/avif/svg/ico 等先用 sharp 转 png",
      save: "保存",
      reset: "恢复默认",
      saved: "已保存",
      saving: "保存中…",
      error: "保存失败",
      unavailable: "设置命名空间不可用(服务端未注册 vision-fallback 命名空间?)",
      overridden: "已覆盖",
      loading: "加载中…"
    };
    var en = {
      nav: "Default Vision",
      toggle: "Default Vision",
      toggleTitle: "When on, dragged images keep their thumbnail; on send they are converted to text locally by picturereader (OCR + pixel scan) so any model can read them. No external vision model is called.",
      intro: "Drag an image → keep the thumbnail → on send it is converted to text locally (OCR + pixel scan). Fully local; no real vision model is called. Edits hot-apply.",
      enabled: "Enable default vision (the composer checkbox controls this too)",
      engine: "OCR engine",
      engineWindows: "Windows (no install; UI/printed text)",
      enginePaddle: "Paddle (better for glowing/curved/game text)",
      includeScan: "Inject pixel summary (layout/colors/structure)",
      includeOcr: "Inject OCR text",
      language: "OCR language (empty = auto, e.g. zh-Hans)",
      maxImageBytes: "Max image bytes",
      convertUnsupported: "Convert webp/avif/svg/ico to png via sharp",
      save: "Save",
      reset: "Reset",
      saved: "Saved",
      saving: "Saving…",
      error: "Save failed",
      unavailable: "Settings namespace unavailable (vision-fallback not registered server-side?)",
      overridden: "overridden",
      loading: "Loading…"
    };

    var FIELDS = [
      { key: "enabled", type: "checkbox" },
      { key: "engine", type: "select", options: [{ value: "windows" }, { value: "paddle" }] },
      { key: "includeScan", type: "checkbox" },
      { key: "includeOcr", type: "checkbox" },
      { key: "language", type: "text" },
      { key: "maxImageBytes", type: "number" },
      { key: "convertUnsupported", type: "checkbox" }
    ];

    function labelOf(f, t) {
      if (f.key === "enabled") return t("enabled");
      if (f.key === "engine") return t("engine");
      if (f.key === "includeScan") return t("includeScan");
      if (f.key === "includeOcr") return t("includeOcr");
      if (f.key === "language") return t("language");
      if (f.key === "maxImageBytes") return t("maxImageBytes");
      if (f.key === "convertUnsupported") return t("convertUnsupported");
      return f.key;
    }

    function useScope(scope) {
      var snap = react.useState(function () { return scope.getSnapshot(); });
      var snapshot = snap[0];
      var setSnapshot = snap[1];
      react.useEffect(function () {
        scope.load();
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () { alive = false; if (un) un(); if (scope.dispose) scope.dispose(); };
      }, [scope]);
      return snapshot;
    }

    // ── composer checkbox (rendered at conversation.input.right) ──────────
    function VisionToggle(props) {
      var t = props.t;
      var scope = props.scope;
      var snapshot = useScope(scope);
      var ready = snapshot.status === "ready";
      var checked = ready ? Boolean(snapshot.value && snapshot.value.enabled) : false;
      return h("label", { className: "__vf_toggle", title: t("toggleTitle") },
        h("input", { className: "__vf_check", type: "checkbox", checked: checked, disabled: !ready, onChange: function (e) {
          var on = e.target.checked;
          if (on) scope.set("enabled", true);
          else scope.unset("enabled");
        } }),
        h("span", { className: "__vf_text" }, t("toggle"))
      );
    }

    // ── settings section ──────────────────────────────────────────────────
    function ConfigSection(props) {
      var t = props.t;
      var scope = props.scope;
      var snapshot = useScope(scope);
      var ready = snapshot.status === "ready" && snapshot.value !== void 0;
      var [draft, setDraft] = react.useState({});
      var [busy, setBusy] = react.useState(false);
      var [notice, setNotice] = react.useState(null);
      var [error, setError] = react.useState(null);

      react.useEffect(function () {
        if (ready) setDraft(function (prev) { return Object.assign({}, prev, valueToDraft(snapshot.value)); });
      }, [ready]);

      if (snapshot.status === "unavailable") return h("p", { className: "__vf_unavailable" }, t("unavailable"));
      if (!ready) return h("p", { className: "__vf_status" }, t("loading"));

      var value = snapshot.value;
      var user = snapshot.user || {};

      function fieldDraft(f) {
        if (f.type === "checkbox") return draft[f.key] !== void 0 ? draft[f.key] : Boolean(value[f.key]);
        if (f.type === "number") return draft[f.key] !== void 0 ? draft[f.key] : String(value[f.key] ?? "");
        return draft[f.key] !== void 0 ? draft[f.key] : String(value[f.key] ?? "");
      }
      function setField(f, v) {
        setDraft(function (prev) { var next = Object.assign({}, prev); next[f.key] = v; return next; });
        setNotice(null); setError(null);
      }

      function onSave() {
        setBusy(true); setNotice(null); setError(null);
        var writes = FIELDS.map(function (f) {
          var d = fieldDraft(f);
          if (f.type === "checkbox") {
            if (Boolean(d) === Boolean(value[f.key])) return Promise.resolve();
            return Boolean(d) ? scope.set(f.key, true) : scope.unset(f.key);
          }
          if (f.type === "number") {
            if (Number(d) === Number(value[f.key] ?? 0)) return Promise.resolve();
            return Number(d) > 0 ? scope.set(f.key, Number(d)) : scope.unset(f.key);
          }
          if (String(d) === String(value[f.key] ?? "")) return Promise.resolve();
          if (String(d).trim() === "" && !(f.key in user)) return Promise.resolve();
          return String(d).trim() === "" ? scope.unset(f.key) : scope.set(f.key, d);
        });
        Promise.all(writes).then(function () {
          setBusy(false); setNotice(t("saved"));
          if (scope.load) scope.load();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      function onReset() {
        setBusy(true); setNotice(null); setError(null);
        Promise.all(FIELDS.map(function (f) { return scope.unset(f.key); })).then(function () {
          setBusy(false); setNotice(t("saved"));
          if (typeof scope.load === "function") scope.load().then(function () {
            var fresh = scope.getSnapshot();
            if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
          }).catch(function () {});
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      return h("div", { className: "__vf_root" },
        h("p", { className: "__vf_hint", style: { margin: "0 0 4px" } }, t("intro")),
        FIELDS.map(function (f) {
          var overridden = f.key in user;
          var row;
          if (f.type === "checkbox") {
            row = h("span", { className: "__vf_row" },
              h("input", { className: "__vf_check", type: "checkbox", checked: Boolean(fieldDraft(f)), onChange: function (e) { setField(f, e.target.checked); } }),
              h("span", { className: "__vf_label" }, labelOf(f, t)),
              overridden ? h("span", { className: "__vf_override" }, t("overridden")) : null
            );
          } else if (f.type === "select") {
            row = h("span", { className: "__vf_row" },
              h("span", { className: "__vf_label" }, labelOf(f, t)),
              overridden ? h("span", { className: "__vf_override" }, t("overridden")) : null,
              h("select", { className: "__vf_input", style: { width: "auto" }, value: fieldDraft(f), onChange: function (e) { setField(f, e.target.value); } },
                f.options.map(function (o) {
                  return h("option", { key: o.value, value: o.value }, o.value === "windows" ? t("engineWindows") : t("enginePaddle"));
                }))
            );
          } else {
            return h("label", { key: f.key, className: "__vf_field" },
              h("span", { className: "__vf_label" }, labelOf(f, t), overridden ? h("span", { className: "__vf_override" }, t("overridden")) : null),
              h("input", {
                className: "__vf_input",
                type: f.type === "number" ? "number" : "text",
                value: fieldDraft(f),
                onChange: function (e) { setField(f, e.target.value); }
              })
            );
          }
          return h("label", { key: f.key, className: "__vf_field" },
            row
          );
        }),
        h("div", { className: "__vf_actions" },
          h("button", { type: "button", className: "__vf_btn __vf_btnPrimary", onClick: onSave, disabled: busy || !snapshot.writable }, t("save")),
          h("button", { type: "button", className: "__vf_btn", onClick: onReset, disabled: busy || !snapshot.writable }, t("reset")),
          notice ? h("span", { className: "__vf_status" }, notice) : null,
          busy ? h("span", { className: "__vf_status" }, t("saving")) : null,
          error ? h("span", { className: "__vf_error" }, error) : null
        )
      );
    }

    function valueToDraft(value) {
      var out = {};
      for (var i = 0; i < FIELDS.length; i += 1) {
        var f = FIELDS[i];
        out[f.key] = f.type === "checkbox" ? Boolean(value[f.key]) : String(value[f.key] ?? "");
      }
      return out;
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-vision-fallback: dictionaries");
      var scope = ctx.settingsScope.bind({ namespace: "vision-fallback" });

      ctx.slots.inject("conversation.input.right", function () {
        return ctx.slots.register({
          name: "conversation.input.right",
          id: "vision-fallback-toggle",
          order: 0,
          locale: NS
        }, function (props) {
          return h(VisionToggle, Object.assign({}, props, { scope: scope, t: t }));
        });
      });

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "vision-fallback",
          order: 26,
          label: function () { return t("nav"); },
          locale: NS
        }, function (props) {
          return h(ConfigSection, Object.assign({}, props, { scope: scope, t: t }));
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});