# Approval pipeline
#
# Triggered by: approve N / reject N / edit N: <changes>
# Parses the action, applies it to the pending draft, and confirms via Telegram.
#
# argsJson must include:
#   workspace_root  — absolute path to workspace-research-outreach
#   action          — "approve" | "reject" | "edit"
#   draft_id        — draft number (string) matching a key in memory/drafts/pending.json
#   changes         — edit instructions (required when action=edit)

name: approval
description: Approve, reject, or edit a pending outreach draft

cwd: ${workspace_root}

args:
  workspace_root:
    description: Absolute path to workspace-research-outreach
  action:
    description: approve | reject | edit
  draft_id:
    description: Draft number to act on
  changes:
    description: Edit instructions (only used when action=edit)
    default: ""

steps:
  - id: approval
    command: node scripts/approval.mjs
