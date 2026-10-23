"""Refresh official commuter catalogues. Requires access-parser and pyproj.
Run: python3 -m pip install access-parser pyproj; python3 scripts/update-commuter-data.py
No runtime Python dependency. Pedestrian connections remain viewport queries.
"""
import csv
import io
import json
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from access_parser import AccessParser
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
TD = 'https://static.data.gov.hk/td/routes-and-fares/'
MTR = 'https://opendata.mtr.com.hk/data/'
SOURCES = []

def download(url):
    SOURCES.append(url)
    return urllib.request.urlopen(url, timeout=45).read()

def table(name):
    return list(csv.DictReader(io.StringIO(download(MTR + name + '.csv').decode('utf-8-sig'))))

def mdb(name, tab):
    with tempfile.NamedTemporaryFile(suffix='.mdb') as file:
        file.write(download(TD + name + '.mdb')); file.flush()
        columns = AccessParser(file.name).parse_table(tab)
    return [dict(zip(columns, row)) for row in zip(*columns.values())]

def save(name, data):
    path = ROOT / 'data' / name
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(name, len(path.read_bytes()), 'bytes')

routes, stops, fares = table('mtr_bus_routes'), table('mtr_bus_stops'), table('mtr_bus_fares')
save('mtr-bus-network.json', {'routes': routes, 'stops': stops, 'fares': fares})

stations = {row['Station ID']: row['Station Code'] for row in table('mtr_lines_and_stations')}
network = json.loads((ROOT / 'data/mtr-network.json').read_text())['stations']
categories = {row['Item_Code']: row for row in table('barrier_free_facility_category')}
facilities = {}
for row in table('barrier_free_facilities'):
    code = stations.get(row['Station_No'])
    category = categories.get(row['Key'])
    if row['Value'] != 'Y' or not code or code not in network or not category:
        continue
    station = facilities.setdefault(code, {'id': code, **network[code], 'facilities': []})
    station['facilities'].append({'en': category['Facility_En'], 'tc': category['Facility_Zh'], 'exitEn': row['AJTextEn'], 'exitTc': row['AJTextZh']})
save('accessible-stations.json', list(facilities.values()))

url = 'https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1697081907714_17556/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000'
collection = json.loads(download(url))
if collection.get('exceededTransferLimit') or not collection.get('features'):
    raise ValueError('Incomplete taxi stand catalogue')
save('taxi-stands.json', [{'id': str(f['properties']['OBJECTID']), 'lng': f['geometry']['coordinates'][0], 'lat': f['geometry']['coordinates'][1], 'tc': f['properties']['Location_TC'], 'en': f['properties']['Location_EN'], 'typeTc': f['properties']['Status_TC'], 'typeEn': f['properties']['Status_EN'], 'districtTc': f['properties']['District_TC'], 'districtEn': f['properties']['District_EN']} for f in collection['features']])

stops, routes, sequence = mdb('STOP_TRAM', 'STOP'), mdb('ROUTE_TRAM', 'ROUTE'), mdb('RSTOP_TRAM', 'RSTOP')
project = Transformer.from_crs(2326, 4326, always_xy=True)
points = {}
for stop in stops:
    lng, lat = project.transform(stop['X'], stop['Y'])
    points[stop['STOP_ID']] = {'id': str(stop['STOP_ID']), 'lng': round(lng, 6), 'lat': round(lat, 6), 'routes': []}
for stop in sequence:
    point = points.get(stop['STOP_ID'])
    if point:
        point.update(tc=stop['STOP_NAMEC'], en=stop['STOP_NAMEE'])
        if str(stop['ROUTE_ID']) not in point['routes']:
            point['routes'].append(str(stop['ROUTE_ID']))
lines = []
for route in routes:
    for direction in [1, 2]:
        ordered = sorted([s for s in sequence if s['ROUTE_ID'] == route['ROUTE_ID'] and s['ROUTE_SEQ'] == direction], key=lambda s: s['STOP_SEQ'])
        coords = [[points[s['STOP_ID']]['lat'], points[s['STOP_ID']]['lng']] for s in ordered if s['STOP_ID'] in points]
        if len(coords) > 1:
            lines.append({'id': f"{route['ROUTE_ID']}-{direction}", 'routeId': str(route['ROUTE_ID']), 'tc': route['ROUTE_NAMEC'], 'en': route['ROUTE_NAMEE'], 'fare': route['FULL_FARE'] / 10000, 'points': coords})
save('tram-network.json', {'stops': [p for p in points.values() if p.get('en')], 'routes': lines})
save('commuter-sources.json', {'retrievedAt': datetime.now(timezone.utc).isoformat(), 'sources': list(dict.fromkeys(SOURCES)), 'pedestrian': 'https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-pedestrian-network', 'limitations': ['Tram lines connect published ordered stops, rather than surveyed tracks.', 'MTR access markers locate stations; exit descriptions do not provide surveyed entrance positions.', 'Published accessibility does not indicate current lift operation.', 'Taxi stands do not indicate vehicle availability or queue lengths.']})
