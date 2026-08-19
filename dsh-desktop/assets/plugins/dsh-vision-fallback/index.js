/**
 * dsh-vision-fallback — 默认视觉(图片拖入 → 发送 → 模型只收 OCR 文本)。
 *
 * 思路(「图片可见、OCR 隐身」):
 *   拖入的图片在会话里保持为 `ImageBlock { attachment }`,UI 照常显示
 *   缩略图;本插件挂在 `llm/stream` 瀑布上(模型派发的最后边界),在喂给
 *   adapter 之前把请求副本里的图片块换成文本块:
 *
 *     ImageBlock ──(附件读字节)→ sharp 转 webp/avif 等为 png
 *                ──(picturereader)→ OCR(本地 Windows/Paddle)+ 紧凑像素摘要
 *                ──(换个请求副本)→ 纯文本 text 块,任何模型都能稳定读到。
 *
 *   会话日志仍是图片(用户输入处不出现 OCR),只有模型收到文本,彻底杜绝
 *   「该模型不支持图片」。开关一刀切:开启后所有模型的图片都先本地识别。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { ensureSettingsNamespaceExposed } from "./vendor/dsh-settings-expose.js";

/** Cordis 插件名(即 cordis.patch.yml 里的 id)。 */
const name = "vision-fallback";
/** 依赖宿主附件存储(读图字节)+ llm(派发前兜底)。 */
const inject = ["attachments", "llm"];
/** 本插件拥有的设置命名空间(Web UI 设置卡片)。 */
const NS = settingsNamespace("vision-fallback");

/** 运行期配置(默认关闭,不强制开启)。 */
const Config = z.object({
  /** 主开关:开启后所有模型的图片都走本地识别再注入文本(一刀切)。 */
  enabled: z.boolean().default(false),
  /** OCR 引擎:"windows"(默认,免装) | "paddle"(炫光/弯曲/游戏字更好)。 */
  engine: z.string().default("windows"),
  /** 注入紧凑像素摘要(布局/主色/结构)。 */
  includeScan: z.boolean().default(true),
  /** 注入 OCR 文字。 */
  includeOcr: z.boolean().default(true),
  /** OCR 语言(BCP-47,如 zh-Hans;空 = 按用户语言自动)。 */
  language: z.string().default(""),
  /** 单个图片字节上限;超出则跳过并提示。 */
  maxImageBytes: z.number().default(15 * 1024 * 1024),
  /** webp/avif/svg/ico 等先用 sharp 转 png(建议开启)。 */
  convertUnsupported: z.boolean().default(true),
});

/** picturereader 纯 JS 解码器原生支持的扩展名。 */
const NATIVE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp"]);
/** 能被 sharp 转成 png 的不支持格式。 */
const CONVERTIBLE_EXT = new Set([".webp", ".avif", ".svg", ".ico", ".tiff", ".tif"]);

/** 由 mediaType 推导扩展名的完整映射。 */
const EXT_BY_MEDIA = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/tiff": ".tiff",
};

/** 惰性动态加载 picturereader 的 core.js(单一事实来源,复用不复制)。 */
const require = createRequire(import.meta.url);
let corePromise = null;
function loadCore() {
  if (!corePromise) {
    const pkgPath = require.resolve("picturereader/package.json");
    const coreUrl = pathToFileURL(join(dirname(pkgPath), "src/core.js")).href;
    corePromise = import(coreUrl);
  }
  return corePromise;
}

/** 从附件拿扩展名:优先 mediaType,退回文件名。 */
function pickExt(attachment) {
  const ext = EXT_BY_MEDIA[attachment?.mediaType];
  if (ext) return ext;
  const nm = attachment?.name ?? "";
  const dot = nm.lastIndexOf(".");
  return dot >= 0 ? nm.slice(dot).toLowerCase() : ".img";
}

/** 深冻结(宿主会把每条持久消息冻结;新造的消息要一致)。 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/** 固化默认值;settings 作用域 get() 未必每次都带 schema 默认,靠这里兜底。 */
const DEFAULTS = {
  enabled: false,
  engine: "windows",
  includeScan: true,
  includeOcr: true,
  language: "",
  maxImageBytes: 15 * 1024 * 1024,
  convertUnsupported: true,
};

/** 把运行期配置压平到确定值:即使某字段缺失,也绝不让识别静默降级。 */
function normalizeConfig(cfg) {
  const c = cfg ?? {};
  const max = Number(c.maxImageBytes);
  return {
    enabled: c.enabled === true,
    engine: c.engine === "paddle" ? "paddle" : "windows",
    includeScan: c.includeScan !== false,
    includeOcr: c.includeOcr !== false,
    language: typeof c.language === "string" ? c.language : "",
    maxImageBytes: Number.isFinite(max) && max > 0 ? max : DEFAULTS.maxImageBytes,
    convertUnsupported: c.convertUnsupported !== false,
  };
}

/** 是否存在图片块(用于快速跳过)。 */
function hasImageBlock(messages) {
  return (messages ?? []).some(
    (m) => Array.isArray(m?.content) && m.content.some((b) => b?.type === "image"),
  );
}

/** 把扫描结果的紧凑字段压成 ~300 字符的摘要(不含 4.4KB 的 ASCII 网格)。 */
function compactScan(value, maxLen = 420) {
  const parts = [];
  if (value?.texture) {
    const t = value.texture;
    const tag = (value.distinctShades ?? 1) >= 8 ? "偏照片" : "偏扁平/绘图";
    parts.push(
      `质感${tag}:光滑${t.smooth ?? 0}% 中${t.medium ?? 0}% 粗糙${t.rough ?? 0}%`,
    );
  }
  if (value?.colors?.length) {
    parts.push(`主色:${value.colors.slice(0, 5).map((c) => `${c.name}${c.pct}%`).join("/")}`);
  }
  if (value?.hues?.length) {
    const hues = value.hues
      .filter((h) => h.name !== "achromatic")
      .slice(0, 4)
      .map((h) => `${h.name}${h.pct}%`)
      .join("/");
    if (hues) parts.push(`色相:${hues}`);
  }
  if (value?.structure?.length) parts.push(`结构:${value.structure.join(";")}`);
  if (value?.regions?.length) {
    const regions = value.regions
      .slice(0, 4)
      .map((r) => `${r.color}${r.pct}%@行${r.rows[0]}-${r.rows[1]}列${r.cols[0]}-${r.cols[1]}`)
      .join(",");
    parts.push(`区块:${regions}`);
  }
  let out = parts.join(" | ");
  if (out.length > maxLen) out = `${out.slice(0, maxLen)}…`;
  return out || "(内容为空或全透明)";
}

/**
 * 从原始字节把一张图片识别成文本(核心;附件桥接与浏览器端路由共用)。
 * @param {Buffer} bytes - 图片字节
 * @param {string} ext - 扩展名(含点,如 ".jpg")
 * @param {object} config - 运行期配置
 * @returns {Promise<string>}
 */
async function recognizeBytes(bytes, ext, config) {
  const cfg = normalizeConfig(config);
  if (bytes.length > cfg.maxImageBytes) {
    return `[图片过大被跳过:${Math.round(bytes.length / 1024)}KB,上限${Math.round(cfg.maxImageBytes / 1024)}KB]`;
  }

  let buffer = bytes;
  let useExt = ext;
  if (!NATIVE_EXT.has(useExt)) {
    if (cfg.convertUnsupported && CONVERTIBLE_EXT.has(useExt)) {
      const sharp = (await import("sharp")).default;
      buffer = await sharp(bytes).rotate().png().toBuffer(); // rotate() 应用 EXIF 方向
      useExt = ".png";
    } else {
      return `[不支持的图片格式:${useExt || "(无扩展名)"}]`;
    }
  }

  const core = await loadCore();
  const out = [];

  if (cfg.includeScan) {
    try {
      const decoded = core.decodeImage(buffer, useExt);
      const scan = core.analyzeImage(decoded.data, decoded.width, decoded.height, {
        size: 32,
        mode: "auto",
      });
      out.push(`[像素] ${decoded.width}x${decoded.height}: ${compactScan(scan)}`);
    } catch (error) {
      out.push(`[像素摘要失败:${String(error)}]`);
    }
  }

  if (cfg.includeOcr) {
    try {
      const opts = { engine: cfg.engine };
      if (cfg.language) opts.language = cfg.language;
      const res = await core.ocrImage(buffer, useExt, opts);
      const lines = (res?.lines ?? []).map((l) => String(l.text ?? "").trim()).filter(Boolean);
      out.push(lines.length ? `[OCR] ${lines.join(" / ")}` : "[OCR] 未识别到文字");
    } catch (error) {
      out.push(`[OCR 失败:${String(error)}]`);
    }
  }

  const text = out.join("\n").trim();
  return text || "[图片已处理,未提取到可用内容]";
}

/**
 * 从附件商店把一张图片识别成文本(pre-step 桥接用)。
 * @param {object} attachment - ImageBlock.attachment
 * @param {object} ctx - cordis 上下文(只需 attachments)
 * @param {object} config - 运行期配置
 * @returns {Promise<string>}
 */
async function recognizeImage(attachment, ctx, config) {
  const { data } = await ctx.attachments.readImage(attachment);
  // 读图服务返回的是 Uint8Array(可能是 Buffer,也可能不是);统一成 Buffer。
  if (!(data instanceof Uint8Array)) throw new Error(`attachment 未返回字节: ${typeof data}`);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return recognizeBytes(bytes, pickExt(attachment), config);
}

/**
 * 把消息里的图片块替换成识别文本;无图消息原引用返回。
 */
async function bridgeMessages(messages, ctx, config) {
  const next = [];
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content) || !content.some((b) => b?.type === "image")) {
      next.push(message);
      continue;
    }
    const blocks = [];
    let nth = 0;
    for (const block of content) {
      if (block?.type !== "image") {
        blocks.push(block);
        continue;
      }
      nth += 1;
      let text;
      try {
        text = await recognizeImage(block.attachment, ctx, config);
      } catch (error) {
        text = `[图片识别失败:${String(error)}]`;
      }
      const label = block.attachment?.name ? `「${block.attachment.name}」` : `图${nth}`;
      blocks.push({
        type: "text",
        text: `[默认视觉] 用户发送了图片${label},已自动转成文字:\n${text}`,
      });
    }
    next.push(deepFreeze({ ...message, content: blocks }));
  }
  return next;
}

/**
 * 挂 `llm/stream` 瀑布 —— 在「模型派发」这道最后边界把图片块换成 OCR
 * 文本。这里不动会话日志,只换一个请求副本去喂 adapter:
 *
 *   · 会话里仍是图片 → UI 继续显示缩略图(用户输入处不再出现 OCR);
 *   · 只有模型收到 OCR 文本,text-only 模型也能稳定读懂图片。
 *
 * 为什么不用 `agent/pre-step`:pre-step 替换的是「即将持久化的消息」,
 * 它会成为 UI 可见的用户消息(用户输入框里会出现一大串 OCR)。
 * `llm/stream` 是消息持久化之后、喂给 adapter 之前的官方拦截点,在这里
 * 只改「请求副本」、不动会话日志。
 */
function attachLlmBridge(ctx, getConfig) {
  // `llm/stream` 监听器必须「同步返回一个 async generator」:waterfall 上游
  // 对监听器返回值做 `yield*`,`async function` 返回 Promise,会被抛成
  // “yield* (intermediate value) is not async iterable” 炸掉整个 turn。
  // 因此这里保持同步、立即返回生成器,桥接逻辑放进生成器内部;下游委托放
  // try/catch 之外,避免下游流自身的错误被捕获后再次派发造成双重请求。
  ctx.on("llm/stream", function (options, next) {
    const llm = this; // cordis waterfall 把 subject(LlmRuntime)绑定为 this
    return (async function* () {
      let downstream;
      const cfg = normalizeConfig(getConfig());
      if (cfg.enabled && options && Array.isArray(options.messages) && hasImageBlock(options.messages)) {
        try {
          const messages = await bridgeMessages(options.messages, ctx, cfg);
          // 原 request 被 deep-freeze 不能原地改;新造一个「未标记 agent-loop」
          // 的等价副本重新派发(provider/model 不变,adapter 重新 resolve,
          // 副本会跳过请求重建不变式)。会话里仍是图片,只有模型收到 OCR 文本。
          downstream = llm.stream({ ...options, messages });
        } catch (error) {
          ctx.logger?.warn?.(`[vision-fallback] 派发前兜底失败,放行原请求: ${String(error)}`);
        }
      }
      yield* downstream ?? next();
    })();
  }, { global: true });
}

function apply(ctx, config) {
  // settings 支撑:base 层 + Web 设置卡片(settings.yaml)实时覆盖。
  let current = config;
  let sourceGetter = null;
  const getConfig = () => (sourceGetter ? sourceGetter() : current);
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {},
  });
  // 老版本 dsh-host-apiproxy 用 WEB_SETTINGS_NAMESPACES 白名单限制 Web 设置
  // 命名空间;补一下让设置卡片在旧内核也能显示(新内核自动暴露,此处为幂等 no-op)。
  ensureSettingsNamespaceExposed(ctx, "vision-fallback", ctx.logger);

  // 派发前兜底:会话里保留图片(UI 显示缩略图),仅模型收到 OCR 文本。
  attachLlmBridge(ctx, getConfig);
}

export {
  Config,
  apply,
  bridgeMessages,
  compactScan,
  inject,
  name,
  recognizeBytes,
  recognizeImage,
};