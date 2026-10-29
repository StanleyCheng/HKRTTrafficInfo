#!/usr/bin/env python3
"""Match ordered MTR Bus stops to continuous OSM route relations from a Geofabrik extract.

Input JSON is the locally extracted relation/way inventory documented in
`docs/mtr-bus-road-geometry.md`. Unmatched or ambiguous routes are omitted.
"""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EARTH = 6371000


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return EARTH*2*math.asin(min(1, math.sqrt(h)))


def permitted(way, member, reversed_way):
    tags = way.get('tags', {})
    role = member.get('role', '')
    if role == 'forward' and reversed_way or role == 'backward' and not reversed_way:
        return False
    if tags.get('oneway:bus') == 'no' or tags.get('oneway:psv') == 'no':
        return True
    oneway = tags.get('oneway', '')
    if oneway in ('yes', '1', 'true') or not oneway and tags.get('junction') == 'roundabout':
        return not reversed_way
    if oneway == '-1': return reversed_way
    return True


def components(relation, ways):
    """Follow relation order, splitting at disconnected or wrongly directed ways."""
    members = [m for m in relation['members'] if m['type'] == 'w']
    paths = []
    for initial_reverse in (False, True):
        current = []
        for member in members:
            way = ways.get(str(member['ref']))
            if not way or not way.get('tags', {}).get('highway') or len(way['geometry']) < 2:
                if len(current) > 1: paths.append(current)
                current = []
                continue
            points = way['geometry']
            orientations = [reverse for reverse in (False, True) if permitted(way, member, reverse)]
            if current:
                connected = [(distance(current[-1], points[-1] if reverse else points[0]), reverse) for reverse in orientations]
                connected = [option for option in connected if option[0] <= 0.05]
                if connected:
                    _, reverse = min(connected)
                    oriented = points[::-1] if reverse else points
                    current.extend(oriented[1:] if current[-1] == oriented[0] else oriented)
                    continue
                if len(current) > 1: paths.append(current)
            if not orientations:
                current = []
                continue
            reverse = initial_reverse if initial_reverse in orientations else orientations[0]
            current = list(points[::-1] if reverse else points)
        if len(current) > 1: paths.append(current)
    return paths


def match(path, stops):
    cumulative = [0.0]
    for a, b in zip(path, path[1:]): cumulative.append(cumulative[-1] + distance(a,b))
    choices = []
    for stop in stops:
        lng, lat = float(stop['STATION_LONGITUDE']), float(stop['STATION_LATITUDE'])
        cos = math.cos(math.radians(lat))
        candidates = []
        for i, (a,b) in enumerate(zip(path, path[1:])):
            x, y = (b[0]-a[0])*cos, b[1]-a[1]
            norm = x*x+y*y
            t = max(0.0, min(1.0, (((lng-a[0])*cos)*x + (lat-a[1])*y)/norm)) if norm else 0.0
            p = [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]
            error = distance((lng,lat), p)
            if error <= 65:
                candidates.append((cumulative[i] + t*(cumulative[i+1]-cumulative[i]), error, i, p))
        if not candidates: return None
        choices.append(candidates)
    # Dynamic programming maintains stop order on loops and chooses the minimum
    # accumulated stop error, without taking a distant occurrence of a stop.
    states = [(c[1], [c]) for c in choices[0]]
    for candidates in choices[1:]:
        new = []
        for c in candidates:
            previous = [s for s in states if c[0] > s[1][-1][0] + 0.1]
            if previous:
                best = min(previous, key=lambda s: s[0])
                new.append((best[0]+c[1], best[1]+[c]))
        if not new: return None
        states = new
    score, selected = min(states, key=lambda s: s[0])
    first, last = selected[0], selected[-1]
    if last[0]-first[0] < 1: return None
    # Reject excessive detours between successive stops, a common sign that a
    # loop or an unrelated variant has been matched to the wrong occurrence.
    for idx, (a,b) in enumerate(zip(selected, selected[1:])):
        straight = distance((float(stops[idx]['STATION_LONGITUDE']),float(stops[idx]['STATION_LATITUDE'])), (float(stops[idx+1]['STATION_LONGITUDE']),float(stops[idx+1]['STATION_LATITUDE'])))
        if b[0]-a[0] > max(1200, straight*4): return None
    coordinates = [first[3], *path[first[2]+1:last[2]+1], last[3]]
    if len(coordinates) < 2: return None
    return {'coordinates':coordinates,'stopDistances':[c[0]-first[0] for c in selected], 'score':score/len(stops), 'maxError':max(c[1] for c in selected)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('relations', help='extracted OSM relation/way JSON')
    parser.add_argument('--output', default=str(ROOT/'data/mtr-bus-road-geometry.json'))
    args = parser.parse_args()
    osm = json.loads(Path(args.relations).read_text())
    bus = json.loads((ROOT/'data/mtr-bus-network.json').read_text())
    grouped = defaultdict(list)
    for s in bus['stops']:
        grouped[f"{s['REFERENCE_ID']}:{s['DIRECTION']}"].append(s)
    routes, failures = {}, []
    for key, stops in grouped.items():
        stops.sort(key=lambda stop: int(stop['STATION_SEQNO']))
        if len(stops) < 2: continue
        candidates = []
        for relation in osm['relations']:
            if relation['tags'].get('ref') != stops[0]['ROUTE_ID']: continue
            for path in components(relation, osm['ways']):
                found = match(path, stops)
                if found:
                    candidates.append((found['score'], relation, found))
        if not candidates:
            failures.append(key)
            continue
        candidates.sort(key=lambda a: a[0])
        _, relation, found = candidates[0]
        routes[key] = {'relation':relation['id'], 'version':relation['version'], 'timestamp':str(relation['timestamp']), 'stopIds':[s['STATION_ID'] for s in stops], 'stopCoordinates':[[float(s['STATION_LONGITUDE']),float(s['STATION_LATITUDE'])] for s in stops], 'coordinates':[[round(x,7),round(y,7)] for x,y in found['coordinates']], 'stopDistances':[round(x,2) for x in found['stopDistances']], 'meanStopError':round(found['score'],1), 'maxStopError':round(found['maxError'],1)}
    result = {'source':osm['source'], 'license':'OpenStreetMap contributors, ODbL 1.0', 'routes':routes}
    Path(args.output).write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False)+'\n')
    print(f'Matched {len(routes)} of {len(grouped)} directions; unmatched: {", ".join(failures)}')

if __name__ == '__main__': main()
