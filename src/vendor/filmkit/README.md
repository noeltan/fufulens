# Vendored: FilmKit protocol code

The files in this directory are vendored from
[eggricesoy/filmkit](https://github.com/eggricesoy/filmkit) (MIT license,
see `LICENSE` in this directory), which reverse-engineered the Fujifilm
USB preset protocol via Wireshark captures of FUJIFILM X RAW STUDIO and
confirmed the property mapping on an X100VI.

FilmKit in turn builds on the reverse-engineering work of
[pinpox/rawji](https://github.com/pinpox/rawji),
[petabyt/fudge](https://github.com/petabyt/fudge), and libgphoto2.

Vendored unmodified (except dropping one unused local in `ptp/container.ts`
to satisfy this repo's stricter TypeScript settings):

- `ptp/` — PTP containers, WebUSB transport, camera session (preset
  read/write with verification)
- `profile/` — film sim / WB / effect enums, preset ↔ UI value translation
- `util/binary.ts` — little-endian pack/unpack helpers
- `parse-text-preset.ts` — fuzzy text parser for recipe text
- `webusb.d.ts` — WebUSB type declarations
