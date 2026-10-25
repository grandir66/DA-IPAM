from pathlib import Path
import json,base64
base=Path(__file__).resolve().parent.parent
import tempfile
work=tempfile.TemporaryDirectory(prefix='da-ipam-guida-')
tmp=Path(work.name)
data=json.loads((base/'contenuti.json').read_text())
images={p.stem:'data:image/webp;base64,'+base64.b64encode(p.read_bytes()).decode() for p in (base/'schermate').glob('*.webp')}
font='data:font/ttf;base64,'+base64.b64encode((base/'assets/Signika.ttf').read_bytes()).decode()
s=(base/'sorgenti/template.txt').read_text().replace("const FONT = '__FONT__';\n",'').replace('__DATA__',json.dumps(data,ensure_ascii=False)).replace('__IMAGES__',json.dumps(images)).replace('__FONT__',font)
canvas=Path.home()/'.cursor/projects/Users-riccardo-Progetti-Domarc/canvases/DA-IPAM-guida-funzionamento.canvas.tsx'
canvas.write_text(s)
# La pagina esportabile usa lo stesso componente e gli stessi contenuti, con un adattatore minimo per il tema.
shim='''import {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
const brand={navy:'#0D2537',cyan:'#00A7E7',gold:'#FFD400',bg:'#FFFFFF',muted:'#4A6070',border:'#D0D8DC',soft:'#F3F5F6',link:'#00658A'};
function useHostTheme(){return {bg:{editor:brand.bg,chrome:brand.navy,elevated:brand.bg},text:{primary:brand.navy,secondary:brand.muted,link:brand.link,onAccent:brand.navy},fill:{secondary:brand.soft,tertiary:brand.soft},stroke:{primary:brand.border},accent:{primary:brand.cyan}}}
const H1=({children}:any)=><h1>{children}</h1>;
const H2=({children}:any)=><h2>{children}</h2>;
const Button=({children,onClick,disabled}:any)=><button disabled={disabled} onClick={onClick} style={{padding:'8px 13px',border:'1px solid var(--line)',background:'var(--soft)',color:'var(--fg)',borderRadius:4,opacity:disabled?.45:1}}>{children}</button>;
'''
htmlsource=shim+s[s.index('const DATA = '):]
# Il tema dell'HTML applica il brand; il canvas adotta il tema host come richiesto dal suo SDK.
htmlsource=htmlsource.replace("'--navfg':theme.text.primary","'--navfg':brand.bg").replace("'--navactive':theme.fill.secondary","'--navactive':brand.link").replace("'--navmark':theme.accent.primary","'--navmark':brand.gold").replace("'--navinput':theme.bg.elevated","'--navinput':brand.navy").replace("'--navline':theme.stroke.primary","'--navline':brand.muted").replace("'--pinbg':theme.accent.primary","'--pinbg':brand.gold")
htmlsource+='\ncreateRoot(document.getElementById("root")!).render(<Guida/>);\n'
(tmp/'guida-html.tsx').write_text(htmlsource)
print('Creati canvas, sorgenti guida e metadati:',len(data['chapters']),'capitoli,',len(images),'schermate.')

import os,subprocess
repo=base.parent.parent
node=Path('/opt/homebrew/opt/node@22/bin/node')
if not node.exists():
 import shutil
 node=Path(shutil.which('node') or 'node')
env=dict(os.environ,NODE_PATH=str(repo/'node_modules'))
subprocess.run([str(repo/'node_modules/.bin/esbuild'),str(tmp/'guida-html.tsx'),'--bundle','--minify','--jsx=automatic','--outfile='+str(tmp/'guida-bundle.js')],check=True,env=env)
js=(tmp/'guida-bundle.js').read_text().replace('</script','<\\/script')
(base/'DA-IPAM-guida.html').write_text('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>DA-IPAM · Guida visuale al funzionamento</title><style>body{margin:0}button:disabled{cursor:default}</style></head><body><div id="root"></div><script>'+js+'</script></body></html>')
print('HTML autonomo generato:',base/'DA-IPAM-guida.html')
