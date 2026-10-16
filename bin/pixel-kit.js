#!/usr/bin/env node
"use strict";
process.exitCode = require("../lib/cli.js").run(process.argv.slice(2));
