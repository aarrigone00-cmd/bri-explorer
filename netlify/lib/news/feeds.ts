// Free, public RSS feeds the weekly news collector reads. No keys needed.
// Chinese state media are included so Beijing's own framing is represented,
// and are labelled as such on the site.

export interface Feed {
  id: string;
  publisher: string;
  url: string;
  /** Shown next to the publisher name, e.g. "Chinese state media". */
  note?: string;
  /** True when the feed is all about China, so a China mention isn't required. */
  chinaOnly?: boolean;
}

export const FEEDS: Feed[] = [
  { id: 'bbc', publisher: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/asia/china/rss.xml', chinaOnly: true },
  { id: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/world/china/rss', chinaOnly: true },
  { id: 'scmp', publisher: 'South China Morning Post', url: 'https://www.scmp.com/rss/4/feed', chinaOnly: true },
  { id: 'diplomat', publisher: 'The Diplomat', url: 'https://thediplomat.com/feed/' },
  { id: 'aljazeera', publisher: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'dialogue-earth', publisher: 'Dialogue Earth', url: 'https://dialogue.earth/en/feed/' },
  { id: 'cgtn', publisher: 'CGTN', url: 'https://www.cgtn.com/subscribe/rss/section/world.xml', note: 'Chinese state media' },
];
