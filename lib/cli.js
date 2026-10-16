"use strict";
// pixel-kit command line. Uses the same scale.js / recolor.js / folder.js
// code as the web app.

const fs = require("node:fs");
const path = require("node:path");
const PS = require("../scale.js");
const PR = require("../recolor.js");
const PF = require("../folder.js");
const { decodePng, encodePng, PngError } = require("./png.js");

const VERSION = require("../package.json").version;

// Stable exit codes.
const EXIT = {
  OK: 0, // every file succeeded
  FILES_FAILED: 1, // at least one file failed or was skipped
  USAGE: 2, // bad command or options
  MAP: 3, // the --map file is missing or invalid
  EXISTS: 4, // an output exists and --force was not given
  NO_INPUT: 5, // no supported image was found
  IO: 6, // could not write output
};

const COMMANDS = {
  colors: {
    summary: "List the unique colors used across images, with pixel counts.",
    usage: "pixel-kit colors <paths...> [--json]",
    options: [],
  },
  recolor: {
    summary: "Replace colors by exact match using a mapping file.",
    usage: "pixel-kit recolor <paths...> --map colors.json -o <dir> [--force] [--dry-run] [--json]",
    options: ["map", "out"],
  },
  scale: {
    summary: "Scale images with nearest-neighbor sampling.",
    usage: "pixel-kit scale <paths...> (--scale N | --width PX | --height PX) -o <dir> [--force] [--dry-run] [--json]",
    options: ["size", "out"],
  },
  process: {
    summary: "Recolor, then scale, in one pass. Either step may be omitted.",
    usage: "pixel-kit process <paths...> [--map colors.json] [--scale N | --width PX | --height PX] -o <dir> [--force] [--dry-run] [--json]",
    options: ["map", "size", "out"],
  },
};

const OPTION_HELP = {
  map: "  --map <file>      Color mapping JSON, as written by the web app's Export\n                    ({\"#rrggbb\": \"#rrggbb\"} or [{\"from\", \"to\"}]).",
  size: "  --scale <N>       Scale factor, e.g. 2 or 1.5.\n  --width <px>      Output width; height keeps the aspect ratio.\n  --height <px>     Output height; width keeps the aspect ratio.",
  out: "  -o, --out <dir>   Output directory. Relative paths of inputs are kept.\n  --force           Overwrite existing output files.\n  --dry-run         Report what would be written; write nothing.",
};

function mainHelp() {
  return [
    "pixel-kit " + VERSION + " — pixel-art tools for PNG files",
    "",
    "Usage: pixel-kit <command> [options]",
    "",
    "Commands:",
    ...Object.keys(COMMANDS).map((name) => "  " + name.padEnd(9) + COMMANDS[name].summary),
    "",
    "Global options:",
    "  --json            Print one JSON document on stdout instead of text.",
    "  -h, --help        Show help (also: pixel-kit <command> --help).",
    "  -v, --version     Show the version.",
    "",
    "Inputs may be files or folders. Folders are searched recursively; hidden",
    "files and other file types are ignored. Only PNG is read and written;",
    "JPEG, WebP, and GIF inputs are reported as skipped.",
    "",
    exitHelp(),
  ].join("\n");
}

function exitHelp() {
  return [
    "Exit codes:",
    "  0  success",
    "  1  one or more files failed or were skipped",
    "  2  invalid command or options",
    "  3  mapping file missing or invalid",
    "  4  output exists (use --force)",
    "  5  no supported input images",
    "  6  could not write output",
  ].join("\n");
}

function commandHelp(name) {
  const command = COMMANDS[name];
  return [
    command.summary,
    "",
    "Usage: " + command.usage,
    "",
    "Options:",
    ...command.options.map((key) => OPTION_HELP[key]),
    "  --json            Machine-readable output.",
    "  -h, --help        Show this help.",
    "",
    exitHelp(),
  ].join("\n");
}

class UsageError extends Error {
  constructor(message, exit = EXIT.USAGE, code = "usage") {
    super(message);
    this.exit = exit;
    this.code = code;
  }
}

function parseArgs(argv) {
  const opts = { paths: [], json: false, force: false, dryRun: false, help: false, version: false };
  const takes = { "--map": "map", "--scale": "scale", "--width": "width", "--height": "height", "--out": "out", "-o": "out" };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    if (arg.startsWith("--") && arg.includes("=")) {
      inline = arg.slice(arg.indexOf("=") + 1);
      arg = arg.slice(0, arg.indexOf("="));
    }
    if (arg === "--json") opts.json = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (takes[arg]) {
      const value = inline !== null ? inline : argv[++i];
      if (value === undefined) throw new UsageError(arg + " needs a value.");
      if (opts[takes[arg]] !== undefined) throw new UsageError(arg + " was given more than once.");
      opts[takes[arg]] = value;
    } else if (arg === "--") {
      opts.paths.push(...argv.slice(i + 1));
      break;
    } else if (arg.startsWith("-") && arg !== "-") throw new UsageError("Unknown option: " + arg);
    else opts.paths.push(arg);
  }
  return opts;
}

// Collects { abs, rel } for every candidate image. Folder inputs keep the
// folder name as the first path segment, like the web app's folder picker.
function collectInputs(paths) {
  const items = [];
  const missing = [];
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel + "/" + entry.name;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.isFile() && PF.isSupported(entry.name)) items.push({ abs, rel: childRel });
    }
  };
  for (const input of paths) {
    let stat;
    try {
      stat = fs.statSync(input);
    } catch (error) {
      missing.push(input);
      continue;
    }
    const base = path.basename(path.resolve(input));
    if (stat.isDirectory()) walk(input, base);
    else items.push({ abs: input, rel: base });
  }
  return { items, missing };
}

function readMap(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new UsageError("Cannot read mapping file: " + file, EXIT.MAP, "map");
  }
  try {
    return PR.importMapping(text);
  } catch (error) {
    throw new UsageError("Mapping file is not valid JSON of the form {\"#rrggbb\": \"#rrggbb\"}: " + file, EXIT.MAP, "map");
  }
}

function sizeSettings(opts) {
  const given = ["scale", "width", "height"].filter((key) => opts[key] !== undefined);
  if (given.length > 1) throw new UsageError("Use only one of --scale, --width, --height.");
  if (!given.length) return null;
  const key = given[0];
  const ratio = PS.decimalRatio(opts[key]);
  if (!ratio) throw new UsageError("--" + key + " needs a positive number.");
  if (key === "scale") return { mode: "scale", edge: "width", scaleRatio: ratio, pixelRatio: null, label: "x" + opts[key] };
  return { mode: "pixels", edge: key, scaleRatio: null, pixelRatio: ratio, label: key + " " + opts[key] + "px" };
}

function countReplaced(before, after) {
  let n = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) n++;
  }
  return n;
}

function loadImage(item) {
  const record = { input: item.abs, path: item.rel, status: "ok" };
  if (!/\.png$/i.test(item.rel)) {
    return { record: { ...record, status: "skipped", code: "format", message: "Only PNG is supported by the CLI." } };
  }
  try {
    const image = decodePng(fs.readFileSync(item.abs));
    record.width = image.width;
    record.height = image.height;
    return { record, image };
  } catch (error) {
    const code = error instanceof PngError ? error.code : "read";
    return { record: { ...record, status: "error", code, message: error instanceof PngError ? error.message : "Could not read file." } };
  }
}

function runColors(opts) {
  const { items, missing } = collectInputs(opts.paths);
  const files = missing.map((input) => ({ input, status: "error", code: "missing", message: "No such file or folder." }));
  const images = [];
  for (const item of items) {
    const { record, image } = loadImage(item);
    if (image) {
      record.colors = PR.extractColors([image.data]).length;
      images.push(image.data);
    }
    files.push(record);
  }
  const colors = PR.extractColors(images).map((c) => ({ hex: c.hex, count: c.count }));
  const failed = files.filter((f) => f.status !== "ok").length;
  const exit = !images.length ? EXIT.NO_INPUT : failed ? EXIT.FILES_FAILED : EXIT.OK;
  return {
    exit,
    result: { command: "colors", ok: exit === EXIT.OK, exitCode: exit, colors, files, summary: { files: files.length, read: images.length, failed, colors: colors.length } },
    text: () => [
      ...colors.map((c) => c.hex + "\t" + c.count),
      ...files.filter((f) => f.status !== "ok").map((f) => "# " + f.status + ": " + (f.path || f.input) + " — " + f.message),
    ].join("\n"),
  };
}

function runWrite(command, opts) {
  const spec = COMMANDS[command].options;
  if (!opts.out) throw new UsageError("-o/--out <dir> is required.");
  const mapping = spec.includes("map") && opts.map !== undefined ? readMap(opts.map) : null;
  if (command === "recolor" && !mapping) throw new UsageError("--map is required.");
  if (!spec.includes("map") && opts.map !== undefined) throw new UsageError("--map is not used by '" + command + "'. Use 'process'.");
  const size = spec.includes("size") ? sizeSettings(opts) : null;
  if (!spec.includes("size") && ["scale", "width", "height"].some((key) => opts[key] !== undefined)) {
    throw new UsageError("Size options are not used by '" + command + "'. Use 'process'.");
  }
  if (command === "scale" && !size) throw new UsageError("Give --scale, --width, or --height.");
  if (command === "process" && !size && !mapping) throw new UsageError("Give --map and/or a size option.");

  const { items, missing } = collectInputs(opts.paths);
  const files = missing.map((input) => ({ input, status: "error", code: "missing", message: "No such file or folder." }));
  const seen = new Set();
  const jobs = [];
  for (const item of items) {
    const { record, image } = loadImage(item);
    files.push(record);
    if (!image) continue;
    if (seen.has(item.rel)) {
      Object.assign(record, { status: "skipped", code: "duplicate", message: PS.MESSAGES.duplicate });
      continue;
    }
    seen.add(item.rel);
    let outW = image.width;
    let outH = image.height;
    if (size) {
      const result = PS.outputSize(image.width, image.height, size);
      if (!result.ok) {
        Object.assign(record, { status: "error", code: result.code, message: PS.MESSAGES[result.code] });
        continue;
      }
      outW = result.width;
      outH = result.height;
    }
    record.output = path.join(opts.out, ...item.rel.split("/"));
    record.outWidth = outW;
    record.outHeight = outH;
    jobs.push({ record, image });
  }

  if (!items.length) return finish(command, opts, EXIT.NO_INPUT, files, "No supported input images.");

  const existing = jobs.filter((job) => fs.existsSync(job.record.output));
  if (existing.length && !opts.force) {
    existing.forEach((job) => Object.assign(job.record, { status: "error", code: "exists", message: "Output exists; use --force to overwrite." }));
    return finish(command, opts, EXIT.EXISTS, files, existing.length + " output file(s) already exist. Nothing was written. Use --force to overwrite.");
  }

  let ioFailed = false;
  for (const { record, image } of jobs) {
    let data = image.data;
    if (mapping) {
      const recolored = PR.applyMapping(data, mapping);
      record.replacedPixels = countReplaced(data, recolored);
      data = recolored;
    }
    let outData = data;
    if (size) {
      outData = new Uint8ClampedArray(record.outWidth * record.outHeight * 4);
      PS.scaleImageData(data, image.width, image.height, outData, record.outWidth, record.outHeight, 0, record.outHeight);
    }
    if (opts.dryRun) {
      record.status = "planned";
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(record.output), { recursive: true });
      fs.writeFileSync(record.output, encodePng(outData, record.outWidth, record.outHeight));
      record.status = "written";
    } catch (error) {
      Object.assign(record, { status: "error", code: "write", message: "Could not write: " + error.message });
      ioFailed = true;
    }
  }

  const failed = files.filter((f) => !["written", "planned"].includes(f.status)).length;
  let exit = EXIT.OK;
  if (ioFailed) exit = EXIT.IO;
  else if (failed) exit = EXIT.FILES_FAILED;
  return finish(command, opts, exit, files, null, { mapping, size });
}

function finish(command, opts, exit, files, message, extra = {}) {
  const count = (status) => files.filter((f) => f.status === status).length;
  const summary = {
    files: files.length,
    written: count("written"),
    planned: count("planned"),
    skipped: count("skipped"),
    failed: count("error"),
  };
  const result = {
    command,
    ok: exit === EXIT.OK,
    exitCode: exit,
    dryRun: opts.dryRun,
    out: opts.out,
    ...(extra.mapping ? { mapping: extra.mapping } : {}),
    ...(extra.size ? { size: extra.size.label } : {}),
    ...(message ? { error: { code: exitName(exit), message } } : {}),
    files,
    summary,
  };
  const text = () => {
    const lines = files.map((f) => {
      const tag = f.status.padEnd(8);
      const where = f.path || f.input;
      if (f.status === "written" || f.status === "planned") {
        return tag + where + " -> " + f.output + " (" + f.outWidth + "x" + f.outHeight + (f.replacedPixels !== undefined ? ", " + f.replacedPixels + " px recolored" : "") + ")";
      }
      return tag + where + " — " + f.message;
    });
    if (message) lines.push(message);
    lines.push(
      (opts.dryRun ? "Dry run: " + summary.planned + " would be written" : summary.written + " written") +
        ", " + summary.skipped + " skipped, " + summary.failed + " failed.",
    );
    return lines.join("\n");
  };
  return { exit, result, text };
}

function exitName(exit) {
  return Object.keys(EXIT).find((key) => EXIT[key] === exit).toLowerCase();
}

function run(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const [command, ...rest] = argv;
  let opts;
  const json = argv.includes("--json");
  const fail = (error) => {
    if (json) io.stdout.write(JSON.stringify({ command: command || null, ok: false, exitCode: error.exit, error: { code: error.code, message: error.message } }, null, 2) + "\n");
    else io.stderr.write("pixel-kit: " + error.message + "\n" + (error.exit === EXIT.USAGE ? "Run 'pixel-kit --help' for usage.\n" : ""));
    return error.exit;
  };
  if (!command || command === "-h" || command === "--help" || command === "help") {
    const topic = command === "help" ? rest[0] : null;
    io.stdout.write((topic && COMMANDS[topic] ? commandHelp(topic) : mainHelp()) + "\n");
    return command ? EXIT.OK : EXIT.USAGE;
  }
  if (command === "-v" || command === "--version") {
    io.stdout.write(VERSION + "\n");
    return EXIT.OK;
  }
  if (!COMMANDS[command]) return fail(new UsageError("Unknown command: " + command));
  try {
    opts = parseArgs(rest);
    if (opts.help) {
      io.stdout.write(commandHelp(command) + "\n");
      return EXIT.OK;
    }
    if (!opts.paths.length) throw new UsageError("Give at least one file or folder.");
    const outcome = command === "colors" ? runColors(opts) : runWrite(command, opts);
    if (opts.json) io.stdout.write(JSON.stringify(outcome.result, null, 2) + "\n");
    else {
      const text = outcome.text();
      (outcome.exit === EXIT.OK ? io.stdout : outcome.exit === EXIT.FILES_FAILED ? io.stdout : io.stderr).write(text + "\n");
    }
    return outcome.exit;
  } catch (error) {
    if (error instanceof UsageError) return fail(error);
    return fail(Object.assign(new UsageError("Unexpected error: " + error.message, EXIT.IO, "io")));
  }
}

module.exports = { run, EXIT };
