# Pixel Kit

Pixel-art tools in the browser and on the command line: exact-match color
replacement and nearest-neighbor scaling.

- Web app: open `index.html` (no build step).
- CLI: `npm link` in this folder, then run `pixel-kit --help`.

## CLI

```
pixel-kit colors  <paths...>                                  # unique colors + counts
pixel-kit recolor <paths...> --map colors.json -o out         # exact color replacement
pixel-kit scale   <paths...> --scale 2 -o out                 # or --width / --height
pixel-kit process <paths...> --map colors.json --scale 4 -o out
```

- Paths may be files or folders. Folders are searched recursively; hidden
  files and other file types are ignored. Relative paths are kept in `out`.
- The mapping file uses the same format as the web app's Export / Import.
- PNG only. Other image types are reported as skipped.
- `--json` prints one JSON document (per-file status, sizes, errors, summary).
- `--dry-run` reports what would be written. Existing outputs are never
  overwritten without `--force`. There are no prompts.

Exit codes: 0 success, 1 some files failed or were skipped, 2 bad command or
options, 3 bad mapping file, 4 output exists, 5 no input images, 6 write error.

Run the tests with `npm test`.
