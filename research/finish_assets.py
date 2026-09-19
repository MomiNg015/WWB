import concurrent.futures,json,pathlib,urllib.request,shutil,re
root=pathlib.Path(__file__).resolve().parent
assets=root/'assets';game=root.parent/'game'
data=json.loads((root/'zh-hans.json').read_text(encoding='utf8'))
paths=[f"images/items/{i['category']}/{i['imageName']}.webp" for i in data['items']]
paths+=re.findall(r'src="(/images/curses/[^\"]+)"',(root/'curses.html').read_text(encoding='utf8'))
paths+=['audio/click.mp3']
def get(rel):
 rel=rel.lstrip('/');p=assets/rel;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and p.stat().st_size:return None
 for n in range(3):
  try:
   with urllib.request.urlopen('https://godfield.net/'+rel,timeout=15) as r:p.write_bytes(r.read())
   return None
  except Exception as e:err=str(e)
 return {'path':rel,'error':err}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:fail=[x for x in pool.map(get,paths) if x]
shutil.copytree(assets,game/'public/assets',dirs_exist_ok=True)
print(json.dumps({'failed':fail,'itemImages':len(list((assets/'images/items').rglob('*.webp')))},ensure_ascii=False),flush=True)
