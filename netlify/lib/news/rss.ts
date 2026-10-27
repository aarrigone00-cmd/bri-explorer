// Minimal RSS 2.0 / Atom parser: enough for news feeds, no dependencies.

export interface FeedItem {
  title: string;
  url: string;
  description: string;
  /** ISO timestamp, or '' when the feed gives no usable date. */
  published: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text from a feed field: CDATA unwrapped, tags removed, entities decoded. */
export function toText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Descriptions are often HTML that was itself entity-encoded.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

const field = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
};

function toIso(raw: string): string {
  const t = toText(raw);
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (rss) {
    for (const b of rss) {
      const link = toText(field(b, 'link')) || toText(field(b, 'guid'));
      items.push({
        title: toText(field(b, 'title')),
        url: link,
        description: toText(field(b, 'description')),
        published: toIso(field(b, 'pubDate') || field(b, 'dc:date')),
      });
    }
  } else {
    for (const b of xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []) {
      const links = [...b.matchAll(/<link\s[^>]*>/gi)].map((m) => m[0]);
      const alt = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l)) ?? links[0] ?? '';
      items.push({
        title: toText(field(b, 'title')),
        url: decodeEntities(alt.match(/href=["']([^"']+)["']/i)?.[1] ?? ''),
        description: toText(field(b, 'summary') || field(b, 'content')),
        published: toIso(field(b, 'published') || field(b, 'updated')),
      });
    }
  }
  return items.filter((i) => i.title && /^https?:\/\//i.test(i.url));
}
