/**
 * Parser checks for getMetOfficeWarnings: `node --test server/functions/`
 *
 * Caveat worth knowing: no Met Office warnings were in force when this was
 * written, so the HTML fixture below is reconstructed from the class names the
 * live page's own stylesheet declares (.warnings-content, .warning-header,
 * .header-title.YELLOW, .warning-headline, .warning-period,
 * .warning-description) rather than captured from a real warning. If the page
 * ever stops parsing, compare a live capture against this fixture first — and
 * note the RSS feed is the fallback precisely because of this uncertainty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAccessiblePage,
  parseRss,
  parsePeriod,
  regionsFrom,
  typeFrom,
  severityFrom,
} from './getMetOfficeWarnings.js';

const NOW = new Date('2026-09-04T12:00:00Z');

const NO_WARNINGS_PAGE = `
  <div id="content-container" class="accessible-content-container">
    <div class="warnings-content"><h2>No warnings in force</h2></div>
  </div>`;

const TWO_WARNINGS_PAGE = `
  <div class="warnings-content">
    <div class="warning-header">
      <div class="header-title YELLOW">Yellow warning of rain</div>
    </div>
    <div class="warning-headline">Yellow warning of rain affecting South West England and Wales</div>
    <div class="warning-period">from 1500 on Thu 4 Sep to 2100 on Thu 4 Sep</div>
    <div class="warning-description">Heavy rain may cause some flooding and travel disruption.</div>

    <div class="warning-header">
      <div class="header-title AMBER">Amber warning of thunderstorms</div>
    </div>
    <div class="warning-headline">Amber warning of thunderstorms affecting East Midlands</div>
    <div class="warning-period">from 1800 on Fri 5 Sep to 0600 on Sat 6 Sep</div>
    <div class="warning-description">Frequent lightning and large hail are likely.</div>
  </div>`;

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>Yellow warning of wind affecting Highlands &amp; Eilean Siar</title>
      <description>Strong winds from 0300 on Sat 6 Sep to 1500 on Sat 6 Sep.</description>
    </item>
  </channel></rss>`;

test('quiet page yields no warnings (not a parse failure)', () => {
  assert.deepEqual(parseAccessiblePage(NO_WARNINGS_PAGE, NOW), []);
});

test('unrecognised markup returns null so the RSS fallback kicks in', () => {
  assert.equal(parseAccessiblePage('<div>something else entirely</div>', NOW), null);
});

test('warnings page yields one entry per warning', () => {
  const out = parseAccessiblePage(TWO_WARNINGS_PAGE, NOW);
  assert.equal(out.length, 2);

  const [rain, storms] = out;
  assert.equal(rain.severity, 'Yellow');
  assert.equal(rain.type, 'Rain');
  assert.deepEqual(rain.regions, ['South West England', 'Wales']);
  assert.equal(rain.validFrom, '2026-09-04T15:00:00.000Z');
  assert.equal(rain.validTo, '2026-09-04T21:00:00.000Z');
  assert.match(rain.description, /flooding/);

  assert.equal(storms.severity, 'Amber');
  assert.equal(storms.type, 'Thunderstorms');
  assert.deepEqual(storms.regions, ['East Midlands']);
  assert.equal(storms.validFrom, '2026-09-05T18:00:00.000Z');
  assert.equal(storms.validTo, '2026-09-06T06:00:00.000Z');
});

test('RSS fallback parses items', () => {
  const out = parseRss(RSS, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'Yellow');
  assert.equal(out[0].type, 'Wind');
  assert.deepEqual(out[0].regions, ['Highlands', 'Eilean Siar']);
  assert.equal(out[0].validFrom, '2026-09-06T03:00:00.000Z');
  assert.equal(out[0].validTo, '2026-09-06T15:00:00.000Z');
});

test('RSS with no items yields no warnings', () => {
  assert.deepEqual(parseRss('<rss><channel></channel></rss>', NOW), []);
});

test('year is inferred as the nearest one across a new year', () => {
  const newYear = new Date('2027-01-02T00:00:00Z');
  // A late-December warning read in early January belongs to the year before.
  const { validFrom } = parsePeriod('from 2100 on Wed 30 Dec to 0300 on Thu 31 Dec', newYear);
  assert.equal(validFrom, '2026-12-30T21:00:00.000Z');
});

test('unparseable period degrades to nulls rather than throwing', () => {
  assert.deepEqual(parsePeriod('valid until further notice'), {
    validFrom: null,
    validTo: null,
  });
});

test('field helpers', () => {
  assert.equal(typeFrom('Yellow warning of extreme heat'), 'Extreme Heat');
  assert.equal(typeFrom('Red warning of snow'), 'Snow');
  assert.equal(typeFrom('warning of something odd'), 'Other');
  assert.equal(severityFrom('RED warning of wind'), 'Red');
  assert.equal(severityFrom('no colour here'), 'Yellow');
  assert.deepEqual(regionsFrom('Yellow warning of ice affecting Grampian, Strathclyde and Wales'), [
    'Grampian',
    'Strathclyde',
    'Wales',
  ]);
  assert.deepEqual(regionsFrom('no affecting clause'), []);
});
