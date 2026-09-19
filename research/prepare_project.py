import json,re,pathlib
from html.parser import HTMLParser
root=pathlib.Path(__file__).resolve().parent
game=root.parent/'game'
class Images(HTMLParser):
    def __init__(self): super().__init__();self.images=[]
    def handle_starttag(self,tag,attrs):
        if tag=='img':self.images.append(dict(attrs))
layouts={}
for key in ['trade','weapons','armor','sundries','miracles','devils','guardians','phenomena']:
    parser=Images();parser.feed((root/(key+'.html')).read_text(encoding='utf-8'));layout={}
    for a in parser.images:
        if '/items/'+key+'/' not in a.get('src',''):continue
        style=a.get('style','');x=re.search(r'left: ([\d.]+)px',style);y=re.search(r'top: ([\d.]+)px',style)
        layout[pathlib.Path(a['src']).stem]={'left':float(x[1]) if x else 0,'top':float(y[1]) if y else 0}
    layouts[key]=layout
(game/'src/reference-layouts.json').write_text(json.dumps(layouts),encoding='utf-8')
icons=game/'public/assets/icons';icons.mkdir(parents=True,exist_ok=True)
svgs=re.findall(r'<svg.*?</svg>',(root/'private-room.html').read_text(encoding='utf-8'),re.S)
for n,svg in enumerate(svgs):
    (icons/f'room-{n}.svg').write_text(svg,encoding='utf-8')
    print(n,svg[:500])
