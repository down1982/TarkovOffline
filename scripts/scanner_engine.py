"""
Escape from Tarkov Offline Assistant - Scanner & Matcher Engine
Powered by RapidOCR + Robust Fuzzy Text Matching
"""
import os
import json
import re
import difflib
from typing import Dict, Any, List, Optional
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")

class TarkovScannerEngine:
    def __init__(self):
        self.ocr = RapidOCR()
        self.tasks = []
        self.hideout_stations = []
        self.collection_items = []
        self.load_databases()

    def load_databases(self):
        # 1. Load Tasks
        tasks_file = os.path.join(DATA_DIR, "tasks.json")
        if os.path.exists(tasks_file):
            with open(tasks_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.tasks = data.get("tasks", [])

        # 2. Load Hideout
        hideout_file = os.path.join(DATA_DIR, "hideout.json")
        if os.path.exists(hideout_file):
            with open(hideout_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.hideout_stations = data.get("stations", [])

        # 3. Load Collection Items
        coll_file = os.path.join(DATA_DIR, "collection.json")
        if os.path.exists(coll_file):
            with open(coll_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.collection_items = data.get("items", [])

    def recognize_image(self, img_input) -> List[Dict[str, Any]]:
        """
        Run OCR on an image (PIL Image, numpy array, or file path).
        Returns a list of detected text lines with bounding boxes.
        """
        if isinstance(img_input, Image.Image):
            img_np = np.array(img_input.convert("RGB"))
        elif isinstance(img_input, str):
            img = Image.open(img_input).convert("RGB")
            img_np = np.array(img)
        else:
            img_np = img_input

        res, _ = self.ocr(img_np)
        lines = []
        if res:
            for item in res:
                lines.append({
                    "box": item[0],
                    "text": item[1].strip(),
                    "score": float(item[2])
                })
        return lines

    def match_content(self, ocr_lines: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Match detected OCR lines against Tarkov databases (Items & Quests).
        """
        matched_items = []
        matched_tasks = []
        
        all_text_segments = [l["text"].strip() for l in ocr_lines if l["text"].strip()]
        full_text = " ".join(all_text_segments)
        full_text_clean = re.sub(r'[,.，。:：!！\-_/\\]', ' ', full_text)
        tokens = [t for t in full_text_clean.split() if t]

        # 1. Match Collection Items (What to keep)
        seen_item_ids = set()
        for item in self.collection_items:
            name = item["name"].strip()
            name_lower = name.lower()

            hit = False
            # Direct Substring in full text
            if name_lower in full_text.lower():
                hit = True
            else:
                for token in tokens:
                    token_lower = token.lower()
                    if len(token_lower) >= 3 and token_lower in name_lower:
                        hit = True
                        break
                    if len(name_lower) >= 3 and name_lower in token_lower:
                        hit = True
                        break
                    if len(token_lower) >= 2 and len(name_lower) >= 2:
                        ratio = difflib.SequenceMatcher(None, token_lower, name_lower).ratio()
                        if ratio >= 0.72:
                            hit = True
                            break

            if hit and item["id"] not in seen_item_ids:
                seen_item_ids.add(item["id"])
                matched_items.append({
                    "id": item["id"],
                    "name": item["name"],
                    "icon": item.get("icon") or f"./uploads/base/{item['id']}-base-image.webp",
                    "total_need": item.get("total_need", 0),
                    "requires_fir": item.get("requires_fir", False),
                    "sources": item.get("sources", [])
                })

        # 2. Match Tasks
        seen_task_ids = set()
        for task in self.tasks:
            t_title = task["title"].strip()
            t_title_lower = t_title.lower()

            hit = False
            # If title is in full text
            if t_title_lower in full_text.lower():
                hit = True
            else:
                for token in tokens:
                    if len(token) >= 2:
                        ratio = difflib.SequenceMatcher(None, token.lower(), t_title_lower).ratio()
                        if ratio >= 0.8:
                            hit = True
                            break

            if hit and task["id"] not in seen_task_ids:
                seen_task_ids.add(task["id"])
                matched_tasks.append({
                    "id": task["id"],
                    "title": task["title"],
                    "trader": task.get("trader", ""),
                    "trader_avatar": task.get("trader_avatar", ""),
                    "level": task.get("level", ""),
                    "is_kappa": task.get("is_kappa", False),
                    "objectives": task.get("objectives", [])
                })

        return {
            "full_text": full_text,
            "detected_lines_count": len(ocr_lines),
            "matched_items": matched_items,
            "matched_tasks": matched_tasks
        }
