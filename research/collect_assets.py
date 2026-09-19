"""Archive publicly served reference data and art; no authentication or private API access."""
import concurrent.futures
import json
import pathlib
import shutil
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
data = json.loads((ROOT / 'zh-hans.json').read_text(encoding='utf-8'))
dest = ROOT / 'assets'
dest.mkdir(exist_ok=True)
manifest = []
bundle = pathlib.Path('C:/Users/莫名/AppData/Local/Temp/browser-use/assets/7fdafd84-e0aa-414b-8172-bee175b4f57e')
raw = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
print(type(raw).__name__, flush=True)

def fetch(item):
    rel = f"images/items/{item['category']}/{item['imageName']}.webp"
    path = dest / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not path.exists():
            urllib.request.urlretrieve('https://godfield.net/' + rel, path)
        return {'url': 'https://godfield.net/' + rel, 'path': rel, 'ok': True}
    except Exception as exc:
        return {'url': 'https://godfield.net/' + rel, 'path': rel, 'ok': False, 'error': str(exc)}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    manifest = list(pool.map(fetch, data['items']))
(ROOT / 'item-assets-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'downloaded': sum(x['ok'] for x in manifest), 'failures': [x for x in manifest if not x['ok']]}, ensure_ascii=False), flush=True)
