#!/usr/bin/env bun
import { run } from "./index";

const result = await run(process.argv.slice(2));
for (const msg of result.messages) console.log(msg);
process.exit(result.code);
