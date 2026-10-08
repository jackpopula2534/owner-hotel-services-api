import { normalizeSlug, validateSlug, SECTION_TYPES } from './website.constants';
import {
  buildDefaultContent,
  cleanUrl,
  sanitizeSections,
  sanitizeSeo,
  sanitizeSiteContent,
  sanitizeTheme,
} from './website-content';
import { toGuestDisplayName } from './website-public.service';

describe('website slug rules', () => {
  it.each(['grand-hotel', 'abc', 'hotel99', 'a1-b2'])('accepts %s', (slug) => {
    expect(validateSlug(slug)).toBeNull();
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(41), 'too long'],
    ['-hotel', 'leading dash'],
    ['hotel-', 'trailing dash'],
    ['my--hotel', 'double dash'],
    ['my_hotel', 'underscore'],
    ['โรงแรม', 'thai chars'],
    ['www', 'reserved'],
    ['admin', 'reserved'],
    ['staysync', 'reserved'],
  ])('rejects %s (%s)', (slug) => {
    expect(validateSlug(slug)).not.toBeNull();
  });

  it('normalizes case and whitespace only', () => {
    expect(normalizeSlug('  Grand-Hotel ')).toBe('grand-hotel');
    expect(normalizeSlug('a b')).toBe('a b');
  });
});

describe('cleanUrl', () => {
  it('blocks non-http schemes', () => {
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('data:text/html,<script>')).toBeNull();
    expect(cleanUrl('/relative.jpg')).toBeNull();
    expect(cleanUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });

  it('enforces host allowlist + https', () => {
    const hosts = ['google.com'];
    expect(cleanUrl('https://www.google.com/maps/embed?pb=1', hosts)).toContain('google.com');
    expect(cleanUrl('http://www.google.com/maps', hosts)).toBeNull();
    expect(cleanUrl('https://evilgoogle.com/maps', hosts)).toBeNull();
    expect(cleanUrl('https://google.com.evil.io/maps', hosts)).toBeNull();
  });
});

describe('sanitizeSections', () => {
  it('always returns exactly one section per type with defaults', () => {
    const sections = sanitizeSections(undefined, 'Grand');
    expect(sections.map((s) => s.type).sort()).toEqual([...SECTION_TYPES].sort());
    expect(sections.map((s) => s.order)).toEqual(sections.map((_, i) => i));
    const hero = sections.find((s) => s.type === 'hero');
    expect(hero?.enabled).toBe(true);
    expect(hero?.props).toMatchObject({ headline: { th: 'Grand', en: 'Grand' } });
    expect(sections.find((s) => s.type === 'offers')?.enabled).toBe(false);
  });

  it('drops duplicate/unknown types, respects order, strips bad urls', () => {
    const sections = sanitizeSections(
      [
        {
          type: 'gallery',
          enabled: true,
          order: 0,
          props: { images: ['https://x.io/1.jpg', 'javascript:x', 'https://x.io/1.jpg'] },
        },
        { type: 'gallery', enabled: false, order: 5 },
        { type: 'evil', enabled: true, order: 0, props: { html: '<script>' } },
        { type: 'hero', enabled: 'yes', order: 1 },
      ],
      'Grand',
    );
    expect(sections).toHaveLength(SECTION_TYPES.length);
    expect(sections[0].type).toBe('gallery');
    expect(sections[0].enabled).toBe(true);
    expect(sections[0].props).toMatchObject({ images: ['https://x.io/1.jpg'] });
    expect(sections[1].type).toBe('hero');
    expect(sections[1].enabled).toBe(true); // non-boolean → default
    expect(JSON.stringify(sections)).not.toContain('<script>');
  });

  it('validates location map embed + coordinates', () => {
    const [loc] = sanitizeSections(
      [
        {
          type: 'location',
          order: 0,
          props: { mapEmbedUrl: 'https://evil.io/map', lat: 200, lng: '98.9' },
        },
      ],
      'H',
    );
    expect(loc.props).toMatchObject({ mapEmbedUrl: null, lat: null, lng: 98.9 });
  });

  it('cleans offers (ids, dates, cap)', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: i === 0 ? 'bad id!' : `o${i}`,
      title: { th: 'โปร' },
      validFrom: i === 0 ? '2026-02-30' : '2026-10-01',
    }));
    const [offers] = sanitizeSections([{ type: 'offers', order: 0, props: { items } }], 'H');
    const list = (offers.props as { items: Array<{ id: string; validFrom: string | null }> }).items;
    expect(list.length).toBeLessThan(30);
    expect(list[0]).toMatchObject({ id: 'offer-1', validFrom: null });
    expect(list[1].validFrom).toBe('2026-10-01');
  });
});

describe('sanitizeSiteContent', () => {
  it('cleans contact links to their own platforms', () => {
    const c = sanitizeSiteContent(
      {
        contact: {
          phone: '081-234-5678<b>',
          email: 'not-an-email',
          lineOaUrl: 'https://lin.ee/abc',
          facebookUrl: 'https://phish.io/facebook.com',
          instagramUrl: 'https://www.instagram.com/hotel',
        },
      },
      'H',
    );
    expect(c.contact).toEqual({
      phone: '081-234-5678',
      email: null,
      lineOaUrl: 'https://lin.ee/abc',
      facebookUrl: null,
      instagramUrl: 'https://www.instagram.com/hotel',
    });
  });

  it('cleans room type overrides', () => {
    const c = sanitizeSiteContent(
      {
        roomTypes: {
          Deluxe: {
            displayName: { th: 'ดีลักซ์' },
            hidden: true,
            order: 2,
            coverImages: ['ftp://x'],
          },
        },
      },
      'H',
    );
    expect(c.roomTypes.Deluxe).toEqual({
      displayName: { th: 'ดีลักซ์', en: '' },
      description: { th: '', en: '' },
      coverImages: [],
      hidden: true,
      order: 2,
    });
  });
});

describe('theme / seo / defaults', () => {
  it('falls back to template colors on invalid input', () => {
    expect(sanitizeTheme({ primary: 'red', accent: '#ABCDEF', font: 'comic' }, 'fresh')).toEqual({
      primary: '#0f766e',
      accent: '#abcdef',
      font: 'sans',
      logoUrl: null,
    });
  });

  it('seo title defaults to hotel name and is capped', () => {
    expect(sanitizeSeo({}, 'Grand').title).toEqual({ th: 'Grand', en: 'Grand' });
    expect(sanitizeSeo({ description: { th: 'x'.repeat(500) } }, 'G').description.th).toHaveLength(
      160,
    );
  });

  it('default content enables dining only when there are restaurants', () => {
    const withR = buildDefaultContent({
      hotelName: 'H',
      phone: '021234567',
      email: 'a@b.co',
      hasRestaurants: true,
    });
    const without = buildDefaultContent({
      hotelName: 'H',
      phone: null,
      email: null,
      hasRestaurants: false,
    });
    expect(withR.sections.find((s) => s.type === 'dining')?.enabled).toBe(true);
    expect(without.sections.find((s) => s.type === 'dining')?.enabled).toBe(false);
    expect(withR.contact).toMatchObject({ phone: '021234567', email: 'a@b.co' });
  });
});

describe('toGuestDisplayName', () => {
  it('hides surname', () => {
    expect(toGuestDisplayName('Somchai', 'Kaewdee')).toBe('Somchai K.');
    expect(toGuestDisplayName('Somchai', null)).toBe('Somchai');
    expect(toGuestDisplayName(null, 'Kaewdee')).toBe('K.');
    expect(toGuestDisplayName(' ', undefined)).toBe('Guest');
  });
});
