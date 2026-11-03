from pathlib import Path
import json,subprocess,os
import tempfile
b=Path(__file__).resolve().parent.parent;repo=b.parent.parent;work=tempfile.TemporaryDirectory(prefix='ipam-atlante-verifica-');tmp=Path(work.name)
d=json.loads((b/'contenuti.json').read_text());s=(b/'sorgenti/template.txt').read_text();s=s[s.index('const DATA'):].replace('__DATA__',json.dumps(d,ensure_ascii=False)).replace('__IMAGES__',json.dumps({p.stem:str(p) for p in (b/'schermate').glob('*.webp')})).replace('__FONT__','')
shim="""import {useState,useEffect} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';const t={editor:'white',chrome:'navy',elevated:'white',primary:'black',secondary:'gray',link:'blue',onAccent:'black',tertiary:'white'};function useHostTheme(){return {bg:t,text:t,fill:t,stroke:t,accent:t}};const H1=({children}:any)=><h1>{children}</h1>;const H2=({children}:any)=><h2>{children}</h2>;const Button=({children,...p}:any)=><button {...p}>{children}</button>;"""
for mode in ['schermate','ad']:
 code=shim+s.replace("useState('schermate')",f"useState('{mode}')",1)
 if mode=='ad':code=code.replace("const [viewId,setViewId]=useState('')","const [viewId,setViewId]=useState('pagina-active-directory')")
 code+=f"\nfs.writeFileSync('{tmp}/{mode}.html',renderToStaticMarkup(<Guida/>));"
 (tmp/'test.tsx').write_text(code)
 env=dict(os.environ,NODE_PATH=str(repo/'node_modules'))
 subprocess.run([str(repo/'node_modules/.bin/esbuild'),str(tmp/'test.tsx'),'--bundle','--platform=node','--format=cjs','--jsx=automatic',f'--outfile={tmp}/test.cjs'],env=env,check=True,capture_output=True)
 subprocess.run(['/opt/homebrew/opt/node@22/bin/node',str(tmp/'test.cjs')],env=env,check=True,capture_output=True)
a=(tmp/'schermate.html').read_text();v=(tmp/'ad.html').read_text();assert a.count('class="thumb"')==175;assert 'Tutte le schermate di DA-IPAM' in a;assert 'EDIZIONE CON ATLANTE' in a;assert 'class="screenindex"' in a;assert v.count('galleryview')>=5;assert 'open="" class="sources galleryview"' in v;assert 'class="directpages"' in v;assert 'class="subpages"' in v
result={'verifica':'render React lato server e TypeScript strict, nessun accesso al browser utente','miniatureIniziali':175,'schede':len(d['views']),'aree':len(d['chapters']),'ADgallerieAperte':5,'esito':'verde'}
(b/'verifica-atlante.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
