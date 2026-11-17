---
title: Skills and files
description: Write a skill as a folder, link its files with relative paths, and let the agent fetch what it needs.
---

A skill is a folder, not one file. `SKILL.md` is the entry point; references, templates and examples sit beside it and are linked with plain relative paths. The agent loads `SKILL.md`, sees what else is in the folder, and fetches only what the task needs.

This guide is for people who write skills. The app has to expose the file tools for any of this to work; see [Files](https://github.com/rezzahub/donghanh/blob/main/docs/features/files.md) for the developer side.

## A skill folder

```
pricing/
├── SKILL.md
└── references/
    ├── discounts.md
    ├── plans.md
    └── regions/
        └── eu.md
```

`SKILL.md`:

```markdown
---
name: pricing
description: Quote prices and apply discounts for a customer.
metadata:
  include: references/plans.md
---

# Pricing

Start from the plan table in [plans](references/plans.md), which is included below.

- Discounts and who may approve them: [discounts](references/discounts.md).
- EU customers have their own rules: [EU pricing](references/regions/eu.md).
```

Two rules about the frontmatter. `name` must equal the folder name, in lowercase letters, digits and single hyphens. And `include` goes in the nested `metadata:` block, indented, as a comma-separated string; a flat `include:` at the top level is ignored.

## Link with relative paths

Write links as plain relative paths: `references/discounts.md`, `../shared/glossary.md`. A path resolves against the folder of the file that contains the link, as in any Markdown renderer. In `references/regions/eu.md`, a link to `../plans.md` means `references/plans.md`.

Do not write absolute uris or full paths from the root of your store. A skill written with relative links keeps working when it moves, and is the same text a person sees when they open the file.

When the agent loads the skill, `use_skill` also returns a table of every link it resolved (`references/discounts.md → skills://team/pricing/references/discounts.md`), so the agent never has to work out a path itself.

## Include what must always be there

The agent gets `SKILL.md` and a list of the other files. Anything else it has to ask for with a tool call. List the files the agent must have in front of it for every use of the skill in `metadata.include`:

```yaml
metadata:
  include: references/plans.md, references/discounts.md
```

- Comma-separated paths, relative to the `SKILL.md` folder. They arrive inline, in the order you list them.
- 32 KB in total, and whole files only. A file that would pass the limit, is missing, is binary or has a line over 2,000 characters is not included; it stays in the file list and the result carries a note telling the agent to read it. That is never an error, but it is a skill that does not work as you wrote it, so keep the included files small.
- Include the few things every run needs. Leave the rest to be fetched. Including everything fills the agent's context before it has started.

## Make files easy to choose

The file list shows each file's size, line count and a one-line description, so the agent can choose without opening it. The description comes from the file itself: the `description` in its frontmatter, else its first heading, else its first non-empty line. Start every reference file with one of these:

```markdown
# EU pricing

VAT-inclusive prices and the three countries with a price floor.
```

A file that opens with a table or an unlabeled paragraph is listed by that line, which tells the agent nothing.

Keep `SKILL.md` short. It is read in full on every use. Put the steps and the decisions in it, and move detail into references that the agent opens when the step needs them.

## What the agent does

The agent calls `use_skill`, reads `SKILL.md` and the included files, then fetches the rest:

- `read_file` opens a file one page at a time (200 lines by default). Pass the uri from the file list, or a relative path with `base` set to the uri of the file that links it. When a page is cut off, the result gives the exact arguments for the next one.
- `grep_files` finds exact text in the folder, for example a price code, and shows the lines. Use it before reading a large file.

You do not need to explain these tools inside the skill. Name the file the agent should open, and say when.

## Checklist

- Folder name equals `name`; the description says when to use the skill.
- Links are relative and point at files that exist.
- `metadata.include` lists only the files needed on every run, comma-separated, well under 32 KB.
- Each reference file starts with a heading or a `description`.
- `SKILL.md` is short and says when to open each reference.
