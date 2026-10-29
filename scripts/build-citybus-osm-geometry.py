#!/usr/bin/env python3
"""Build per-prefix Citybus OSM route candidates, without inferring missing paths."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('route_matcher', ROOT / 'scripts/build-mtr-bus-road-geometry.py')
matcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matcher)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('relations')
    parser.add_argument('--output', default=str(ROOT / 'data/citybus-osm'))
    args = parser.parse_args()
    osm = json.loads(Path(args.relations).read_text())
    output = {}
    for relation in osm['relations']:
        code = relation['tags'].get('ref', '').strip().upper()
        if not code or not code.isascii() or not code.isalnum():
            continue
        unique, seen = [], set()
        for path in matcher.components(relation, osm['ways']):
            key = tuple(map(tuple, path))
            if len(path) < 2 or key in seen:
                continue
            seen.add(key)
            unique.append([[round(x, 6), round(y, 6)] for x, y in path])
        if unique:
            output.setdefault(code[0], {}).setdefault(code, []).append({'relation': relation['id'], 'version': relation['version'], 'paths': unique})
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    for prefix, routes in output.items():
        (destination / f'{prefix}.json').write_text(json.dumps(routes, separators=(',', ':')) + '\n')
    print(f"Built {len(output)} shards for {sum(map(len, output.values()))} Citybus route numbers")

if __name__ == '__main__':
    main()
