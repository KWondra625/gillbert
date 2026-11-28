"""Gear stage 5, second half: Ask Gillbert answers gear questions (docs/plans/gear-tip-ups.md).

Changes one existing workflow, "Gillbert - POST - Ask Gillbert": two more Postgres tools beside
its seven, on the same read-only login (Gillbert AI Reader), each calling one function from
scripts/gear/13 with Query Parameters, plus a few lines in the agent's instructions. Backed up
first; --restore puts it back.

  Gear Stats   SELECT gear_ai_stats($1, $2, $3, $4)   fish by tip-up, bait and setup part
  Tip-ups      SELECT gear_ai_tipups($1)              a tip-up's owner, current setup, fish

  python -I -X utf8 gear/deploy_ask_gillbert_gear.py              Staging dry run
  python -I -X utf8 gear/deploy_ask_gillbert_gear.py --apply      Staging (Kurt's OK)
  python -I -X utf8 gear/deploy_ask_gillbert_gear.py --restore <backup dir>
  --prod: production, ONLY at release with Kurt's separate OK.
Needs scripts/gear/13 on that server first.
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deploy_gear_photos as P  # noqa: E402  (its helpers; same --apply / --prod flags)

ASK = "Gillbert - POST - Ask Gillbert"
TEMPLATE_TOOL = "Body of Water Breakdown"
RESTORE = sys.argv[sys.argv.index("--restore") + 1] if "--restore" in sys.argv else None

TOOLS = [
    ("Gear Stats",
     "Count fish by tip-up, bait, hook, line, leader, beads and flash: the same numbers as the app's Gear Stats "
     "page. Use it for questions like 'best bait', 'which tip-up catches the most', 'what hook works on Kegonsa', "
     "instead of counting from the catch data. Optional filters: one body of water, one species, a date range. "
     "Only catches logged on a tip-up count, each on the setup it had that day. Answers { error } if a name "
     "matches nothing.",
     "SELECT gear_ai_stats($1, $2, $3, $4) AS stats;",
     "={{ [ $fromAI('body_of_water', 'Body of water name to filter to, as in the catch data. Leave empty for all.', 'string'), "
     "$fromAI('species_name', 'Fish species name to filter to. Leave empty for all species.', 'string'), "
     "$fromAI('from_date', 'First day to include, YYYY-MM-DD (this ice season starts Nov 1). Leave empty for no limit.', 'string'), "
     "$fromAI('to_date', 'Last day to include, YYYY-MM-DD (an ice season ends Mar 31). Leave empty for no limit.', 'string') ] }}"),
    ("Tip-ups",
     "Look up the crew's tip-ups: owner, status (Active or Retired), current setup (line, leader, hook, beads, "
     "flash, whether it has a photo), fish caught and the last one, and, when only one tip-up matches, its recent "
     "changes. Use it for 'what's on KW 24-02', 'whose tip-up is…', 'what tip-ups does Dave have'.",
     "SELECT gear_ai_tipups($1) AS tip_ups;",
     "={{ [ $fromAI('search', \"Part of a tip-up's name (like KW 24-02) or its owner's name. Leave empty for every tip-up.\", 'string') ] }}"),
]

PROMPT_ANCHOR = "- If something isn't in the data, say so rather than guessing\n"
PROMPT_ADD = ("- Gear: a catch above may show caught_on (the tip-up and its setup that day: line, leader, hook, beads, "
              "flash) and bait_name. For rankings or counts of tip-ups, bait or setup parts use the Gear Stats tool; "
              "for a tip-up's owner or current setup use the Tip-ups tool. Nobody can change gear here: point them "
              "to the Gear page.\n")


def plan(live):
    nodes = copy.deepcopy(live["nodes"])
    by = {n["name"]: n for n in nodes}
    if all(name in by for name, *_ in TOOLS):
        return nodes, live["connections"]                       # already done
    tmpl = by[TEMPLATE_TOOL]
    assert tmpl["type"] == "n8n-nodes-base.postgresTool" and "AI Reader" in tmpl["credentials"]["postgres"]["name"], \
        "the template tool isn't on the AI reader login"
    conns = copy.deepcopy(live["connections"])
    for i, (name, desc, sql, params) in enumerate(TOOLS):
        n = copy.deepcopy(tmpl)
        n["id"] = P.nid()
        n["name"] = name
        n["position"] = [tmpl["position"][0] + 256 * (i + 1), tmpl["position"][1]]
        n["parameters"]["toolDescription"] = desc
        n["parameters"]["query"] = sql
        n["parameters"]["options"] = {"queryReplacement": params}
        nodes.append(n)
        conns[name] = {"ai_tool": [[{"node": "AI Agent", "type": "ai_tool", "index": 0}]]}
    opts = by["AI Agent"]["parameters"]["options"]
    assert opts["systemMessage"].count(PROMPT_ANCHOR) == 1, "agent instructions aren't what this script expects"
    opts["systemMessage"] = opts["systemMessage"].replace(PROMPT_ANCHOR, PROMPT_ANCHOR + PROMPT_ADD)
    return nodes, conns


if __name__ == "__main__":
    by_name = {w["name"]: w for w in P.get("/workflows?limit=250")["data"]}
    if ASK not in by_name:
        sys.exit(f"STOP: {ASK!r} not found on {P.HOST}")
    if RESTORE:
        for f in sorted(os.listdir(RESTORE)):
            old = json.load(open(os.path.join(RESTORE, f), encoding="utf-8"))
            back = P.put_workflow(old["id"], P.get(f"/workflows/{old['id']}"), old["nodes"], old["connections"])
            print(f"restored {old['name']} ({old['id']}) active={back['active']}")
        sys.exit("Restore done.")
    live = P.get(f"/workflows/{by_name[ASK]['id']}")
    nodes, conns = plan(live)
    if nodes == live["nodes"]:
        sys.exit(f"{ASK} on {P.HOST}: already up to date")
    backup_dir = os.path.join(P.DRAFTS, f"ask_gillbert_backup_{P.HOST}_{P.STAMP}")
    os.makedirs(backup_dir)
    json.dump(live, open(os.path.join(backup_dir, f"{live['id']}.json"), "w", encoding="utf-8"), indent=1)
    print(f"== {ASK}: {len(live['nodes'])} -> {len(nodes)} nodes")
    for name, *_ in TOOLS:
        print(f"   + {name} -> AI Agent (ai_tool)")
    print("   + instructions:", PROMPT_ADD.strip()[:120], "…")
    print(f"Backup: {backup_dir}")
    if not P.APPLY:
        sys.exit(f"dry run: nothing written to {P.HOST}")
    back = P.put_workflow(live["id"], live, nodes, conns)
    ok = ({n["name"]: n["parameters"] for n in back["nodes"]} == {n["name"]: n["parameters"] for n in nodes}
          and back["active"] == live["active"])
    print(f"{ASK} ({live['id']}): read-back {'OK' if ok else 'MISMATCH'} (active={back['active']})")
    if not ok:
        sys.exit(f"STOP: restore with --restore {backup_dir}")
    print(f"Done. Undo: --restore {backup_dir}")
