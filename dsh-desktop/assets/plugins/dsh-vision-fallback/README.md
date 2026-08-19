# dsh-vision-fallback — 默认视觉

拖入图片,在模型**派发之前**用 [picturereader](https://github.com/jing-hy/picturereader)
本地引擎(OCR + 像素扫描)把图片转成文本注入消息。任何不支持视觉的模型
(纯文本外部 API、本地 Ollama)都能稳定读图;识别**不调用**你的真实视觉
模型(qwen2.5vl / vision-router)。

## 为什么可靠

- 识别发生在 `llm/stream`(消息持久化之后、喂给 adapter 之前的最后边界),
  只重写「请求副本」,会话日志仍是图片缩略图;text-only 模型不会再收到
  二进制图片块,「图片不支持」这道关卡被彻底绕过。
- 识别全走本地 picturereader,无网络、无外接视觉模型,链路确定。
- 附件按 `attachmentId` 读字节,不落路径文本到输入框。

## 与 dsh-tool-vision 的区别

`dsh-tool-vision` 的「图片桥接」是把图片导出成临时文件 + 让模型**再调
`inspect_image`**(外接视觉模型)来看。本插件直接把识别结果当文本注入,
模型不需要再调任何工具、也不走外接视觉。**两者同时开可能重复处理同一张
图**,建议只用其中一个的桥接能力。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 主开关(不默认强制开启) |
| `engine` | `windows` | OCR 引擎:`windows` / `paddle` |
| `includeScan` | `true` | 注入紧凑像素摘要(布局/主色/结构) |
| `includeOcr` | `true` | 注入 OCR 文字 |
| `language` | `""` | OCR 语言,空 = 自动 |
| `maxImageBytes` | `15728640` | 单图字节上限 |
| `convertUnsupported` | `true` | webp/avif/svg/ico 先 sharp 转 png |

## 依赖与安装

- 需要两个运行时依赖:`picturereader`(识别引擎,纯 JS,含 pngjs/omggif/jpeg-js)
  和 `sharp`(webp/avif 等转 png)。通过 `dsh plugin add` 或插件市场安装时,
  pnpm 会自动装齐;缺少依赖时代码会降级为「识别失败」文本,不会拖垮插件树。
- OCR `windows` 引擎调用系统 Windows.Media.Ocr(**仅 Windows**);`paddle`
  引擎需要本机已有 `paddle_venv`(picturereader 默认查找
  `$env:DSH_PADDLE_PYTHON` 或 `C:/Users/Administrator/paddle_venv/...`,
  其他机器请显式设置 `DSH_PADDLE_PYTHON`)。

## 已知限制

- 已入库的历史图片(装插件/开开关**之前**就发过的)不会自动补识别;
  重新拖入即可。
- OCR(Windows 引擎)约 0.9s/张,是主要耗时;发送时可看到「识别中…」。