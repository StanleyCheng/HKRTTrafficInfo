# Browser-direct CORS probe

Observed: 2026-10-03T14:42:07.566Z. GET requests with Origin: https://hkrttrafficinfo.vercel.app; no Referer.

| Feed | HTTP | Access-Control-Allow-Origin | Bytes | Browser eligible | Error |
| --- | --- | --- | --- | --- | --- |
| boundary-resident | 200 | (absent) | 485 | no / unverified |  |
| boundary-visitor | 200 | (absent) | 485 | no / unverified |  |
| kmb | 200 | * | 1482 | yes |  |
| citybus | 200 | * | 97 | yes |  |
| gmb | 200 | * | 1747 | yes |  |
| nlb | 200 | * | 445 | yes |  |
| warnings | 200 | * | 2 | yes |  |
| approaches | 403 | (absent) | 52 | no / unverified |  |
| works | 403 | (absent) | 52 | no / unverified |  |
| slp-locations | 200 | * | 4386 | yes |  |
| slp-readings | 200 | * | 12317 | yes |  |

These are real GET response header checks; they do not simulate browser CORS enforcement. Transport failures leave CORS unverified. Journey boards, works, tolls, rail and ferry remain server-only regardless of probe success because of referer or shared-load requirements.

- boundary-resident: https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json
- boundary-visitor: https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeV.json
- kmb: https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/18492910339410B1
- citybus: https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/001145/1
- gmb: https://data.etagmb.gov.hk/eta/stop/20001142
- nlb: https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=1&stopId=1&lang=en
- warnings: https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en
- approaches: https://www.hkemobility.gov.hk/api/drss/getTextInfo/JourneyTime/en/H1
- works: https://www.hkemobility.gov.hk/api/drss/layer/map?service=WFS&version=1.0.0&request=GetFeature&typeName=DRSS:VW_ROAD_WORK_EN&outputFormat=application/json&srsName=EPSG:4326
- slp-locations: https://static.data.gov.hk/td/traffic-data-slp/info/traffic_speed_volume_occ_info-slp.csv
- slp-readings: https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol_SLP-all.xml
