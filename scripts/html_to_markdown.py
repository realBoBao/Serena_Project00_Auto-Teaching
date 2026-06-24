#!/usr/bin/env python3
"""
scripts/html_to_markdown.py — Convert HTML/file to clean Markdown (Node.js bridge)

Usage:
  python html_to_markdown.py <input_file>
  python html_to_markdown.py --html "<html string>"

Output: clean Markdown to stdout
"""

import sys
import os
from pathlib import Path

def html_to_md(html_content: str) -> str:
    """Convert HTML to Markdown using markdownify."""
    from markdownify import markdownify
    return markdownify(html_content, heading_style="ATX", strip=["img"])

def file_to_md(filepath: str) -> str:
    """Convert file to Markdown based on extension."""
    path = Path(filepath)
    ext = path.suffix.lower()
    
    if ext == ".html" or ext == ".htm":
        html = path.read_text(encoding="utf-8", errors="replace")
        return html_to_md(html)
    
    elif ext == ".txt":
        return path.read_text(encoding="utf-8", errors="replace")
    
    elif ext == ".xml" or ext == ".rss":
        # Parse XML/RSS → extract text content
        from defusedxml import ElementTree
        try:
            tree = ElementTree.parse(filepath)
            root = tree.getroot()
            parts = []
            for elem in root.iter():
                if elem.text and elem.text.strip():
                    tag = elem.tag.split("}")[-1]  # strip namespace
                    if tag in ("title", "h1", "h2", "h3", "h4"):
                        level = int(tag[1]) if tag[0] == "h" else 1
                        parts.append("#" * level + " " + elem.text.strip())
                    elif tag == "p":
                        parts.append(elem.text.strip())
                    elif tag == "description":
                        parts.append(elem.text.strip())
            return "\n\n".join(parts)
        except Exception:
            return path.read_text(encoding="utf-8", errors="replace")
    
    else:
        # Fallback: read as text
        return path.read_text(encoding="utf-8", errors="replace")

def main():
    if len(sys.argv) < 2:
        print("Usage: python html_to_markdown.py <file> OR --html '<html>'", file=sys.stderr)
        sys.exit(1)
    
    if sys.argv[1] == "--html":
        html = sys.argv[2]
        print(html_to_md(html))
    else:
        filepath = sys.argv[1]
        if not os.path.exists(filepath):
            print(f"Error: file not found: {filepath}", file=sys.stderr)
            sys.exit(1)
        print(file_to_md(filepath))

if __name__ == "__main__":
    main()
