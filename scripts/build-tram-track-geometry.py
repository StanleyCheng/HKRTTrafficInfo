#!/usr/bin/env python3
"""Match TD's ordered tram stops to continuous route-specific OSM tram tracks."""
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

# TD route ID and direction -> OSM relation, checked by both endpoints and the
# complete ordered stop sequence. Relation names identify the same service.
RELATIONS = {'4001-1': 4088321, '4001-2': 4088368, '4002-1': 4088518, '4002-2': 4088517,
             '4003-1': 3263757, '4003-2': 4088000, '4004-1': 4088087, '4004-2': 4088086,
             '4005-1': 4088457, '4005-2': 4088481, '4007-1': 4088263, '4007-2': 4088262}


def components(relation, ways):
    """Keep relation order and preferred track direction; never bridge gaps."""
    paths, current = [], []
    for member in relation['members']:
        if member['type'] != 'w':
            continue
        way = ways.get(str(member['ref']))
        if not way or way.get('tags', {}).get('railway') != 'tram' or len(way.get('geometry', [])) < 2:
            if len(current) > 1:
                paths.append(current)
            current = []
            continue
        points = way['geometry']
        direction = way['tags'].get('railway:preferred_direction')
        options = [False] if direction == 'forward' else [True] if direction == 'backward' else [False, True]
        if current:
            connected = [(matcher.distance(current[-1], points[-1] if reverse else points[0]), reverse) for reverse in options]
            connected = [candidate for candidate in connected if candidate[0] <= .05]
            if connected:
                reverse = min(connected)[1]
                oriented = points[::-1] if reverse else points
                current.extend(oriented[1:])
                continue
            if len(current) > 1:
                paths.append(current)
        current = list(points[::-1] if options[0] else points)
    if len(current) > 1:
        paths.append(current)
    return paths


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('relations')
    parser.add_argument('--output', default=str(ROOT / 'data/tram-track-geometry.json'))
    args = parser.parse_args()
    osm = json.loads(Path(args.relations).read_text())
    network = json.loads((ROOT / 'data/tram-network.json').read_text())
    relations = {relation['id']: relation for relation in osm['relations']}
    routes = {}
    for route in network['routes']:
        relation = relations.get(RELATIONS.get(route['id']))
        if not relation:
            continue
        stops = [{'STATION_LATITUDE': lat, 'STATION_LONGITUDE': lng} for lat, lng in route['points']]
        matches = [found for path in components(relation, osm['ways']) if (found := matcher.match(path, stops)) and found['maxError'] <= 25]
        if not matches:
            continue
        shape = min(matches, key=lambda found: found['score'])
        routes[route['id']] = {'relation': relation['id'], 'version': relation['version'], 'timestamp': relation['timestamp'],
                               'stopPoints': route['points'], 'coordinates': [[round(lng, 7), round(lat, 7)] for lng, lat in shape['coordinates']],
                               'stopDistances': [round(distance, 2) for distance in shape['stopDistances']], 'maxStopError': round(shape['maxError'], 1)}
    Path(args.output).write_text(json.dumps({'source': osm['source'], 'license': 'OpenStreetMap contributors, ODbL 1.0', 'routes': routes}, separators=(',', ':')) + '\n')
    missing = [route['id'] for route in network['routes'] if route['id'] not in routes]
    print(f"Matched {len(routes)} of {len(network['routes'])} directions; unmatched: {', '.join(missing)}")


if __name__ == '__main__':
    main()
