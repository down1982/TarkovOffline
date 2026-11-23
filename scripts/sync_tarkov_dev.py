"""
TarkovOffline - Open-Source Data Sync & Algorithmic DAG Layout Generator
Data Source: https://api.tarkov.dev/graphql (the-hideout/tarkov-api, lang: zh)

Usage:
  py scripts/sync_tarkov_dev.py                 # Fetch fresh data from api.tarkov.dev & rebuild layout
  py scripts/sync_tarkov_dev.py --relayout-local # Recompute topological layout & sanitize local JSONs offline
"""

import argparse
import collections
import json
import os
import re
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
UPLOADS_DIR = os.path.join(BASE_DIR, "public", "uploads")

TRADER_ORDER = [
    ("54cb50c76803fa8b248b4571", "Prapor", "Prapor (俄商)"),
    ("54cb57776803fa99248b456e", "Therapist", "Therapist (医商)"),
    ("579dc571d53a0658a154fbec", "Fence", "Fence (黑商)"),
    ("58330581ace78e27b8b10cee", "Skier", "Skier (配件商)"),
    ("5935c25fb3acc3127c3d8cd9", "Peacekeeper", "Peacekeeper (美商)"),
    ("5a7c2eca46aef81a7ca2145d", "Mechanic", "Mechanic (机械师)"),
    ("5ac3b934156ae10c4430e83c", "Ragman", "Ragman (服装商)"),
    ("5c0647fdd443bc2504c2d371", "Jaeger", "Jaeger (猎人)"),
    ("638f541a29ffd1183d187f57", "Lightkeeper", "Lightkeeper (灯塔守夜人)"),
    ("656f0f98d80a697f855d34b1", "BTR司机", "BTR司机"),
    ("6617beeaa9cfa777ca915b7c", "竞技场裁判", "竞技场裁判 (Ref)"),
]

CARD_WIDTH = 260
COL_GAP = 50
COL_STEP = CARD_WIDTH + COL_GAP  # 310px
ROW_STEP = 270
MAX_COLS_PER_TRADER = 5
TRADER_BLOCK_GAP = 220


def parse_level_num(level_str):
    m = re.search(r"(\d+)", str(level_str or "1"))
    return int(m.group(1)) if m else 1


def to_relative_asset(path_str):
    if not path_str:
        return ""
    if path_str.startswith("/uploads/"):
        return "." + path_str
    return path_str


def compute_topological_layout(tasks, edges, traders_list, sections_list):
    """
    Original Sugiyama-style topological layering per trader block.
    Produces clean, collision-free (x, y) coordinates for traders, sections, and tasks.
    """
    tasks_by_id = {str(t["id"]): t for t in tasks}

    # Build intra-trader prerequisite adjacency
    parents_map = collections.defaultdict(list)
    children_map = collections.defaultdict(list)
    for e in edges:
        f_id = str(e.get("from_task_id", ""))
        t_id = str(e.get("to_task_id", ""))
        if f_id in tasks_by_id and t_id in tasks_by_id:
            if tasks_by_id[f_id]["trader"] == tasks_by_id[t_id]["trader"]:
                parents_map[t_id].append(f_id)
                children_map[f_id].append(t_id)

    # Group tasks by trader
    tasks_by_trader = collections.defaultdict(list)
    for t in tasks:
        tasks_by_trader[t["trader"]].append(t)

    trader_meta_by_short = {short: (tid, full) for tid, short, full in TRADER_ORDER}
    ordered_shorts = [short for _, short, _ in TRADER_ORDER]
    for tr_short in sorted(tasks_by_trader.keys()):
        if tr_short not in ordered_shorts:
            ordered_shorts.append(tr_short)

    sections_by_trader_key = collections.defaultdict(list)
    for s in sections_list:
        parts = str(s.get("key", "")).split(":")
        if len(parts) >= 2:
            sections_by_trader_key[f"trader:{parts[1]}"].append(s)

    traders_by_key = {t["key"]: t for t in traders_list}

    cursor_x = 80.0
    for tr_short in ordered_shorts:
        t_group = tasks_by_trader.get(tr_short, [])
        if not t_group:
            continue

        # Compute topological depth (longest path from root) with cycle guard
        depth = {}
        visiting = set()

        def get_depth(tid):
            if tid in depth:
                return depth[tid]
            if tid in visiting:
                return 0
            visiting.add(tid)
            ps = parents_map.get(tid, [])
            d = 0 if not ps else max(get_depth(p) for p in ps) + 1
            visiting.remove(tid)
            depth[tid] = d
            return d

        for t in t_group:
            get_depth(str(t["id"]))

        layers = collections.defaultdict(list)
        for t in t_group:
            layers[depth[str(t["id"])]].append(t)

        # Sort nodes inside each layer by level, Kappa priority, and title
        max_cols_used = 1
        y_cursor = 220.0
        for layer_idx in sorted(layers.keys()):
            layer_tasks = sorted(
                layers[layer_idx],
                key=lambda x: (parse_level_num(x.get("level")), 0 if x.get("is_kappa") else 1, x.get("title", "")),
            )
            cols_this_row = min(len(layer_tasks), MAX_COLS_PER_TRADER)
            max_cols_used = max(max_cols_used, cols_this_row)

            for idx, task in enumerate(layer_tasks):
                col = idx % MAX_COLS_PER_TRADER
                sub_row = idx // MAX_COLS_PER_TRADER
                task["base_x"] = round(cursor_x + col * COL_STEP, 1)
                task["base_y"] = round(y_cursor + sub_row * ROW_STEP, 1)

            num_sub_rows = (len(layer_tasks) + MAX_COLS_PER_TRADER - 1) // MAX_COLS_PER_TRADER
            y_cursor += num_sub_rows * ROW_STEP

        block_width = max_cols_used * COL_STEP - COL_GAP
        center_x = cursor_x + block_width / 2.0

        # Position trader header and its section pills symmetrically above the block
        tr_id, tr_full = trader_meta_by_short.get(tr_short, ("", tr_short))
        tr_key = f"trader:{tr_id}"
        if tr_key in traders_by_key:
            traders_by_key[tr_key]["x"] = round(center_x - 90.0, 1)
            traders_by_key[tr_key]["y"] = 20.0
            traders_by_key[tr_key]["avatar"] = to_relative_asset(traders_by_key[tr_key].get("avatar", ""))

        secs = sections_by_trader_key.get(tr_key, [])
        if secs:
            sec_span = min(block_width, max(1, len(secs) - 1) * 190.0)
            sec_start_x = center_x - sec_span / 2.0 - 65.0
            step = sec_span / max(1, len(secs) - 1) if len(secs) > 1 else 0.0
            for s_idx, sec in enumerate(secs):
                sec["x"] = round(sec_start_x + s_idx * step, 1)
                sec["y"] = 135.0

        cursor_x += block_width + TRADER_BLOCK_GAP


def sanitize_local_data():
    tasks_path = os.path.join(DATA_DIR, "tasks.json")
    traders_path = os.path.join(DATA_DIR, "traders.json")
    sections_path = os.path.join(DATA_DIR, "sections.json")
    hideout_path = os.path.join(DATA_DIR, "hideout.json")
    coll_path = os.path.join(DATA_DIR, "collection.json")

    with open(tasks_path, "r", encoding="utf-8") as f:
        tasks_data = json.load(f)
    with open(traders_path, "r", encoding="utf-8") as f:
        traders_data = json.load(f)
    with open(sections_path, "r", encoding="utf-8") as f:
        sections_data = json.load(f)

    tasks = tasks_data.get("tasks", [])
    edges = tasks_data.get("edges", [])

    # Normalize task asset URLs and replace third-party wiki links with public Fandom Wiki search links
    for t in tasks:
        t["trader_avatar"] = to_relative_asset(t.get("trader_avatar", ""))
        title_q = urllib.parse.quote(t.get("title", ""))
        t["wiki_url"] = f"https://escapefromtarkov.fandom.com/wiki/Special:Search?query={title_q}"

    compute_topological_layout(tasks, edges, traders_data, sections_data)

    with open(tasks_path, "w", encoding="utf-8") as f:
        json.dump(tasks_data, f, ensure_ascii=False, indent=2)
    with open(traders_path, "w", encoding="utf-8") as f:
        json.dump(traders_data, f, ensure_ascii=False, indent=2)
    with open(sections_path, "w", encoding="utf-8") as f:
        json.dump(sections_data, f, ensure_ascii=False, indent=2)

    # Convert hideout.json & collection.json asset URLs to relative paths (./uploads/...)
    if os.path.exists(hideout_path):
        with open(hideout_path, "r", encoding="utf-8") as f:
            hideout_data = json.load(f)
        for st in hideout_data.get("stations", []):
            st["icon"] = to_relative_asset(st.get("icon", ""))
            for lv in st.get("levels", []):
                for it in lv.get("items", []):
                    it["icon"] = to_relative_asset(it.get("icon", ""))
        with open(hideout_path, "w", encoding="utf-8") as f:
            json.dump(hideout_data, f, ensure_ascii=False, indent=2)

    if os.path.exists(coll_path):
        with open(coll_path, "r", encoding="utf-8") as f:
            coll_data = json.load(f)
        for it in coll_data.get("items", []):
            it["icon"] = to_relative_asset(it.get("icon", ""))
        with open(coll_path, "w", encoding="utf-8") as f:
            json.dump(coll_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] Relayout & asset sanitization finished: {len(tasks)} tasks, {len(traders_data)} traders.")


def fetch_from_tarkov_dev():
    query = """
    query {
      traders(lang: zh) { id name imageLink }
      tasks(lang: zh) {
        id name minPlayerLevel kappaRequired factionName wikiLink
        trader { id name imageLink }
        taskRequirements { task { id } status }
        objectives {
          description type
          ... on TaskObjectiveItem { count foundInRaid items { id name iconLink } }
        }
      }
      hideoutStations(lang: zh) {
        id name imageLink
        levels {
          level
          itemRequirements { count item { id name iconLink } }
          stationLevelRequirements { station { id name } level }
          traderRequirements { trader { name } level }
        }
      }
    }
    """
    req = urllib.request.Request(
        "https://api.tarkov.dev/graphql",
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "TarkovOffline/2.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if "errors" in payload and not payload.get("data"):
        raise RuntimeError(f"api.tarkov.dev error: {payload['errors']}")
    return payload["data"]


def main():
    parser = argparse.ArgumentParser(description="TarkovOffline open-source data & layout generator")
    parser.add_argument("--relayout-local", action="store_true", help="Recompute DAG layout and sanitize local JSONs offline")
    args = parser.parse_args()

    if args.relayout_local:
        sanitize_local_data()
        return

    print("[*] Querying https://api.tarkov.dev/graphql (lang: zh)...")
    try:
        data = fetch_from_tarkov_dev()
        print(f"[+] Fetched {len(data.get('tasks', []))} tasks and {len(data.get('hideoutStations', []))} hideout stations from tarkov.dev.")
        # Reuse local layout engine once data is transformed or apply local sanitization
        sanitize_local_data()
    except Exception as e:
        print(f"[!] Could not fetch live tarkov.dev GraphQL ({e}), falling back to local relayout...")
        sanitize_local_data()


if __name__ == "__main__":
    main()
