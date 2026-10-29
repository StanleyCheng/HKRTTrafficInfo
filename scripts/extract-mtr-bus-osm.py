#!/usr/bin/env python3
"""Extract MTR Bus candidate relations and their ways from an OSM PBF snapshot.

Requires pyosmium. The JSON output is input to build-mtr-bus-road-geometry.py.
"""
import argparse
import json
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pbf', help='Hong Kong OSM extract in PBF format')
    parser.add_argument('output', help='path for extracted relation/way JSON')
    parser.add_argument('--source', required=True, help='dated URL of the input PBF')
    args = parser.parse_args()
    bus = json.loads((ROOT / 'data/mtr-bus-network.json').read_text())
    refs = {route['ROUTE_ID'].strip().upper() for route in bus['routes']}

    class Relations(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.relations = []
            self.ways = set()

        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('route') != 'bus' or tags.get('ref', '').strip().upper() not in refs:
                return
            identity = ' '.join(tags.get(key, '') for key in ('name', 'name:en', 'network', 'operator')).lower()
            if not any(term in identity for term in ('mtr', '港鐵', '九廣')):
                return
            members = [{'type': str(member.type), 'ref': member.ref, 'role': member.role} for member in relation.members]
            self.ways.update(member['ref'] for member in members if member['type'] == 'w')
            self.relations.append({'id': relation.id, 'version': relation.version, 'timestamp': str(relation.timestamp), 'tags': tags, 'members': members})

    relations = Relations()
    relations.apply_file(args.pbf)

    class Ways(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways = {}
            self.incomplete = set()

        def way(self, way):
            if way.id not in relations.ways:
                return
            if any(not node.location.valid() for node in way.nodes):
                self.incomplete.add(way.id)
                return
            self.ways[way.id] = {'id': way.id, 'tags': dict(way.tags), 'geometry': [[node.lon, node.lat] for node in way.nodes]}

    ways = Ways()
    ways.apply_file(args.pbf, locations=True, idx='flex_mem')
    if ways.incomplete:
        raise ValueError(f'{len(ways.incomplete)} relation member ways have missing nodes')
    missing = relations.ways - set(ways.ways)
    if missing:
        raise ValueError(f'{len(missing)} relation member ways are missing from the extract')
    Path(args.output).write_text(json.dumps({'source': args.source, 'relations': relations.relations, 'ways': ways.ways}, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Extracted {len(relations.relations)} relations and {len(ways.ways)} ways')


if __name__ == '__main__':
    main()
