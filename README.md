# TUNO Web

TUNO brings country radio stations together in a single browser-based application. Search for a country, browse its available stations, and start listening.

The site is built with plain HTML, CSS, and JavaScript. It has no build step or external framework.

## Live website

https://dp2702.github.io/radioaxar/

## Features

- Radio stations from countries around the world
- Country and station search
- Music, news, and other station categories
- Favorites stored locally on the device
- Recently played stations
- Automatic fallback when a station cannot be played
- Station checker for finding and removing unavailable stations
- Responsive interface for phones, tablets, and computers
- No account or sign-up required

## Station checker

The station-checking code is included directly in `index.html`.

This is intentional. Loading the checker as a separate `check_stations.js` file did not work reliably across the generated country pages and dynamically rendered search results.

The checker:

1. Reads the currently loaded stations from `window.currentStations`.
2. Matches displayed station elements using their `data-id` values.
3. Retrieves each stream from `station.stream.url`.
4. Tests the visible station streams.
5. Hides stations that cannot be played.
6. Remembers unavailable streams in the browser using `localStorage`.
7. Continues working when country pages, filters, and search results are rendered dynamically.

When changing the checker, update the embedded station-checker section inside `index.html`.

The standalone `check_stations.js` file is not required unless the application is changed to load it explicitly with a valid external script element.

## Station data

Country station data is provided as JSON:

```text
https://akarafilovski.github.io/tuno-data/radio/<CC>.json
