import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";

export type ParsedEmailEntry = {
  attachmentNames?: string[];
  senderName?: string;
  occurredAt?: string;
  html?: string;
  remoteHtml?: string;
  hasRemoteContent?: boolean;
  htmlPresentation?: "card" | "document";
};

const MAX_DOCUMENT_LENGTH = 2_000_000;
const MAX_ENTRY_LENGTH = 1_000_000;
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

const ALLOWED_TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i",
  "img", "ins", "kbd", "li", "main", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span", "strong", "style",
  "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  // `align` and `valign` are obsolete on the modern web, but remain part of
  // the de facto HTML email layout contract. They are inert presentational
  // values, and dropping them visibly changes otherwise safe messages.
  "*": ["align", "class", "dir", "lang", "role", "style", "title", "valign", "aria-label", "aria-hidden"],
  a: ["href", "name", "rel", "target", "title"],
  blockquote: ["cite"],
  col: ["align", "span", "valign", "width"],
  colgroup: ["align", "span", "valign", "width"],
  font: ["color", "face", "size"],
  img: ["align", "alt", "border", "class", "data-remote-src", "decoding", "height", "hspace", "loading", "referrerpolicy", "src", "style", "title", "vspace", "width"],
  ol: ["reversed", "start", "type"],
  table: ["align", "bgcolor", "border", "cellpadding", "cellspacing", "height", "role", "summary", "width"],
  tbody: ["align", "char", "charoff", "valign"],
  td: ["abbr", "align", "axis", "bgcolor", "colspan", "headers", "height", "nowrap", "rowspan", "scope", "valign", "width"],
  tfoot: ["align", "char", "charoff", "valign"],
  th: ["abbr", "align", "axis", "bgcolor", "colspan", "headers", "height", "nowrap", "rowspan", "scope", "valign", "width"],
  thead: ["align", "char", "charoff", "valign"],
  tr: ["align", "bgcolor", "char", "charoff", "height", "valign"],
  ul: ["type"],
};

function safeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

function isHeyImageProxy(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "gopher.hey.com";
  } catch { return false; }
}

function privacyProxyImageUrl(value: string): string {
  if (!isHeyImageProxy(value)) return value;
  const marker = "=/https://";
  const offset = value.indexOf(marker);
  if (offset < 0) return value;
  const nested = `https://${value.slice(offset + marker.length)}`;
  try {
    const url = new URL(nested);
    // HEY's signed proxy URLs can expire outside the HEY web session. GitHub's
    // camo host is itself a privacy proxy, so it remains safe and reliable here.
    return url.hostname === "camo.githubusercontent.com" ? nested : value;
  } catch { return value; }
}

function normalizedImageUrl(value: string): string {
  const candidate = value.trim();
  if (candidate.startsWith("/assets/")) return new URL(candidate, "https://app.hey.com").toString();
  return privacyProxyImageUrl(candidate);
}

function isHeyStaticAsset(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "app.hey.com" && url.pathname.startsWith("/assets/");
  } catch { return false; }
}

function isTrustedImageProxy(value: string): boolean {
  try {
    const url = new URL(value);
    return isHeyImageProxy(value) || isHeyStaticAsset(value) || (url.protocol === "https:" && url.hostname === "camo.githubusercontent.com");
  } catch { return false; }
}

function safeEmbeddedImage(value: string): boolean {
  return /^data:image\/(?:gif|png|jpe?g|webp);base64,[a-z\d+/=]+$/i.test(value);
}

function scrubCss(value: string, allowRemote: boolean): string {
  return value
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;?/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;}]+;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote: string, raw: string) => {
      const url = raw.trim();
      if (safeEmbeddedImage(url)) return `url("${url}")`;
      if (allowRemote && safeRemoteUrl(url)) return `url("${url.replace(/["\\\n\r]/g, "")}")`;
      return "none";
    });
}

function imageAttributes(attribs: Record<string, string>, allowRemote: boolean): Record<string, string> {
  const source = normalizedImageUrl(attribs.src ?? attribs.url ?? "");
  const width = Number.parseInt(attribs.width ?? "", 10);
  const height = Number.parseInt(attribs.height ?? "", 10);
  const isTrackingPixel = Number.isFinite(width) && Number.isFinite(height) && width <= 2 && height <= 2;
  const result: Record<string, string> = {
    alt: attribs.alt ?? attribs.caption ?? "",
    decoding: "async",
    loading: "lazy",
    referrerpolicy: "no-referrer",
  };
  // The transform from HEY's Action Text attachment element to a normal image
  // must not discard the sender's safe layout hooks. Email templates commonly
  // size or position these assets through a class, inline style, or legacy
  // alignment attribute rather than width/height alone.
  if (attribs.align) result.align = attribs.align;
  if (attribs.border) result.border = attribs.border;
  if (attribs.class) result.class = attribs.class;
  if (attribs.hspace) result.hspace = attribs.hspace;
  if (attribs.style) result.style = attribs.style;
  if (attribs.vspace) result.vspace = attribs.vspace;
  if (attribs.title) result.title = attribs.title;
  if (attribs.width) result.width = attribs.width;
  if (attribs.height) result.height = attribs.height;
  if (safeEmbeddedImage(source)) result.src = source;
  else if (safeRemoteUrl(source) && !isTrackingPixel) {
    if (allowRemote || isTrustedImageProxy(source)) result.src = source;
    else {
      result.src = TRANSPARENT_PIXEL;
      result["data-remote-src"] = source;
    }
  }
  return result;
}

function attachmentDimension(value: unknown): string | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 && number <= 10_000 ? String(Math.round(number)) : undefined;
}

function expandTrixAttachments(fragment: ReturnType<typeof load>): void {
  for (let pass = 0; pass < 3; pass += 1) {
    const attachments = fragment("figure[data-trix-attachment]");
    if (attachments.length === 0) return;
    let expanded = false;
    attachments.each((_index, figure) => {
      const raw = fragment(figure).attr("data-trix-attachment");
      if (!raw || raw.length > MAX_ENTRY_LENGTH) return;
      try {
        const attachment = JSON.parse(raw) as Record<string, unknown>;
        const contentType = typeof attachment.contentType === "string" ? attachment.contentType : "";
        if (contentType === "text/html" && typeof attachment.content === "string") {
          fragment(figure).replaceWith(normalizeHeyHtmlFragment(attachment.content));
          expanded = true;
          return;
        }
        if ((contentType === "image" || contentType.startsWith("image/")) && typeof attachment.url === "string") {
          const attributesRaw = fragment(figure).attr("data-trix-attributes");
          let caption = "";
          let trixAttributes: Record<string, unknown> = {};
          if (attributesRaw && attributesRaw.length < 10_000) {
            trixAttributes = JSON.parse(attributesRaw) as Record<string, unknown>;
            if (typeof trixAttributes.caption === "string") caption = trixAttributes.caption;
          }
          const width = attachmentDimension(attachment.width) ?? attachmentDimension(trixAttributes.width);
          const height = attachmentDimension(attachment.height) ?? attachmentDimension(trixAttributes.height);
          const replacement = load("<figure class=\"email-inline-attachment\"><img><figcaption></figcaption></figure>", null, false);
          replacement("img").attr({
            src: attachment.url,
            alt: caption,
            loading: "lazy",
            decoding: "async",
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
          });
          if (caption) replacement("figcaption").text(caption);
          else replacement("figcaption").remove();
          fragment(figure).replaceWith(replacement.html());
          expanded = true;
        } else if (typeof attachment.filename === "string") {
          const replacement = load('<p class="email-file-placeholder"></p>', null, false);
          replacement("p").text(`Attachment: ${attachment.filename}`);
          fragment(figure).replaceWith(replacement.html());
          expanded = true;
        }
      } catch {
        // A malformed attachment must not prevent the rest of the message from rendering.
      }
    });
    if (!expanded) return;
  }
}

function sanitizeFragment(fragment: string, allowRemote: boolean): string {
  const $ = load(fragment, null, false);
  $("script, noscript, iframe, frame, frameset, object, embed, form, input, textarea, select, option, button, base, meta, link, video, audio, source, canvas, svg, math").remove();
  $("style").each((_index, element) => {
    $(element).text(scrubCss($(element).html() ?? "", allowRemote));
  });
  $("[style]").each((_index, element) => {
    const style = $(element).attr("style");
    if (style) $(element).attr("style", scrubCss(style, allowRemote));
  });

  return sanitizeHtml($.root().html() ?? "", {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: { img: ["data", "http", "https"] },
    allowProtocolRelative: false,
    allowVulnerableTags: true,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          // Preserve the sender's already-scrubbed, allowlisted presentation.
          // sanitize-html still applies ALLOWED_ATTRIBUTES and allowedSchemes
          // after this transform, so event handlers and unsafe URLs remain out.
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (_tagName, attribs) => ({ tagName: "img", attribs: imageAttributes(attribs, allowRemote) }),
      "action-text-attachment": (_tagName, attribs) => ({ tagName: "img", attribs: imageAttributes(attribs, allowRemote) }),
    },
  });
}

function unwrapTrixShadowTemplate(fragment: string): string {
  const templateStart = fragment.indexOf("<template");
  if (templateStart < 0) return fragment;
  const contentStart = fragment.indexOf(">", templateStart);
  const contentEnd = fragment.lastIndexOf("</template>");
  if (contentStart < 0 || contentEnd <= contentStart) return fragment;
  return fragment.slice(contentStart + 1, contentEnd);
}

export function normalizeHeyHtmlFragment(fragment: string): string {
  return unwrapTrixShadowTemplate(fragment)
    .replace(/\\(?:&quot;|&#34;|&#x22;)/gi, "\"")
    .replace(/\\(?:&apos;|&#39;|&#x27;)/gi, "'")
    .replace(/\\(["'])/g, "$1")
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/&amp;(nbsp|amp|quot|apos|lt|gt|#\d+|#x[a-f\d]+);/gi, "&$1;");
}

function hasBlockedRemoteContent(fragment: string): boolean {
  const candidates = [
    ...fragment.matchAll(/(?:src|url)\s*=\s*["'](https?:\/\/[^"']+)/gi),
    ...fragment.matchAll(/url\(\s*["']?(https?:\/\/[^)'"\s]+)/gi),
  ];
  return candidates.some((match) => !isTrustedImageProxy(match[1] ?? ""));
}

function needsDocumentRendering(html: string): boolean {
  const images = (html.match(/<img\b/gi) ?? []).length;
  const tables = (html.match(/<table\b/gi) ?? []).length;
  return images > 0 || tables > 1 || /<style\b|email-file-placeholder/i.test(html) || html.length > 12_000;
}

function headerMetadata(value: string): Pick<ParsedEmailEntry, "senderName" | "occurredAt"> {
  const text = value.replace(/\s+/g, " ").trim().replace(/^From:\s*/i, "");
  const match = text.match(/^(.*?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/);
  if (!match) return text && text !== "Sender metadata" ? { senderName: text } : {};
  return {
    ...(match[1]?.trim() ? { senderName: match[1].trim() } : {}),
    ...(match[2] ? { occurredAt: match[2] } : {}),
  };
}

export function parseThreadHtmlDocument(stdout: string): Map<string, ParsedEmailEntry> {
  const result = new Map<string, ParsedEmailEntry>();
  if (!stdout.trim() || stdout.length > MAX_DOCUMENT_LENGTH) return result;
  const $ = load(stdout);

  $("article[data-entry-id]").each((_index, article) => {
    const id = $(article).attr("data-entry-id")?.trim();
    if (!id) return;
    const articleBody = load($(article).html() ?? "", null, false);
    const header = articleBody.root().children("header").first();
    const metadata = headerMetadata(header.text());
    header.remove();
    const visibleChildren = articleBody.root().children().filter((_childIndex, child) => {
      const node = articleBody(child);
      return node.text().trim().length > 0 || (node.html() ?? "").trim().length > 0 || Object.keys(child.attribs ?? {}).length > 0;
    });
    const htmlPresentation = visibleChildren.length <= 1 ? "document" : "card";
    expandTrixAttachments(articleBody);
    articleBody("action-text-attachment").each((_attachmentIndex, element) => {
      const node = articleBody(element);
      const contentType = node.attr("content-type") ?? "";
      const filename = node.attr("filename") ?? "";
      if (contentType === "image" || contentType.startsWith("image/")) return;
      if (!contentType && (!filename || /\.(png|jpe?g|gif|webp|avif)$/i.test(filename))) return;
      const replacement = load('<p class="email-file-placeholder"></p>', null, false);
      replacement("p").text(filename ? `Attachment: ${filename}` : "Attachment");
      node.replaceWith(replacement.html());
    });
    articleBody("figure").filter((_figureIndex, figure) => {
      const node = articleBody(figure);
      return node.text().trim().length === 0 && (node.html() ?? "").trim().length === 0;
    }).remove();
    const serialized = articleBody.html() ?? "";
    const fragment = normalizeHeyHtmlFragment(serialized);
    const attachmentNames = load(fragment)(".email-file-placeholder").map((_i, el) => load(el).text().replace(/^Attachment:\s*/, "").trim()).get().filter(Boolean);
    if (attachmentNames.length) Object.assign(metadata, { attachmentNames });
    if (!fragment.trim() || fragment.length > MAX_ENTRY_LENGTH) {
      if (Object.keys(metadata).length > 0) result.set(id, metadata);
      return;
    }
    const hasRemoteContent = hasBlockedRemoteContent(fragment);
    const html = sanitizeFragment(fragment, false);
    if (!html.trim() || !needsDocumentRendering(html)) {
      if (Object.keys(metadata).length > 0) result.set(id, metadata);
      return;
    }
    result.set(id, {
      ...metadata,
      html,
      hasRemoteContent,
      htmlPresentation,
      ...(hasRemoteContent ? { remoteHtml: sanitizeFragment(fragment, true) } : {}),
    });
  });

  return result;
}
