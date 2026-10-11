import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeries, parseStation } from './index.js';

const SERIES = [
  'Areal values from HadUK-Grid 1km gridded climate data from land surface network',
  'Last updated 01-Oct-2026 11:55',
  'year    jan    feb    mar    apr    may    jun    jul    aug    sep    oct    nov    dec     win     spr     sum     aut     ann',
  '1884    5.8    4.6    5.7    6.5   10.7   13.4   15.6   16.5   14.0    8.6    4.9    3.7     ---    7.64   15.21    9.15    9.19',
  '2026    3.7    6.4    7.9    9.9   13.4   17.3   19.4   18.2   15.8                         5.46   10.37   18.29                ',
].join('\n');

test('series: fixed columns, so a part-filled year does not read its seasons as Oct-Dec', () => {
  const s = parseSeries(SERIES);
  assert.equal(s.updated, '01-Oct-2026 11:55');
  assert.deepEqual(s.rows[1884].slice(0, 3), [5.8, 4.6, 5.7]);
  assert.equal(s.rows[2026][8], 15.8);
  assert.deepEqual(s.rows[2026].slice(9), [null, null, null]);
});

test('series: rejects a page that is not a series file', () => {
  assert.throws(() => parseSeries('<html>not found</html>'));
});

const STATION = [
  'Braemar',
  'Location: 315200E 791400N, 339 metres amsl (1959 to Apr 2005), ',
  '& 315200E 791900N, Lat 57.006 Lon -3.396, 327 metres amsl (Aug 2005 onwards)',
  '   yyyy  mm   tmax    tmin      af    rain     sun',
  '              degC    degC    days      mm   hours',
  '   1959   1    1.7    -5.7      27     ---    34.2',
  '   2026   9   15.7*    7.7       1    69.4    98.0#  Provisional',
].join('\n');

test('station: latest location, flags stripped, missing values null', () => {
  const s = parseStation(STATION);
  assert.equal(s.name, 'Braemar');
  assert.equal(s.lat, 57.006);
  assert.equal(s.lon, -3.396);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].rain, null);
  assert.equal(s.rows[1].tmax, 15.7);
  assert.equal(s.rows[1].sun, 98);
  assert.equal(s.rows[1].provisional, true);
});
