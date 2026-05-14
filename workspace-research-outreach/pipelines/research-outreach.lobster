# Research → Summarise → Outreach pipeline
#
# Triggered by /run or /rerun from Telegram.
# Reads a target contact from Google Sheets, researches them, summarises findings,
# generates a personalised outreach sequence, and posts a preview to Telegram for approval.
#
# argsJson must include:
#   workspace_root  — absolute path to workspace-research-outreach
#   target          — bank name (case-insensitive) or "all" (picks first pending row)
#   force           — true to bypass findings-log cache, false to use cached research

name: research-outreach
description: Research a target bank, summarise findings, generate outreach sequence, post for approval

cwd: ${workspace_root}

args:
  workspace_root:
    description: Absolute path to workspace-research-outreach
  target:
    description: Bank name or "all" to pick the first pending contact
    default: "all"
  force:
    description: Set true to bypass the findings-log cache and force fresh research
    default: false

steps:
  - id: pre
    command: node scripts/pre.mjs

  - id: research
    command: node scripts/research.mjs
    stdin: $pre.stdout

  - id: summarise
    command: node scripts/summarise.mjs
    stdin: $research.stdout

  - id: outreach
    command: node scripts/outreach.mjs
    stdin: $summarise.stdout

  - id: post
    command: node scripts/post.mjs
    stdin: $outreach.stdout
