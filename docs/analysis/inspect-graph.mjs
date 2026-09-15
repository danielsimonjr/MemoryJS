import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

const files=fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.ts')&&!f.endsWith('.d.ts')).map(f=>'src/'+f.replaceAll('\\','/'));
const nodes=[],edges=[],external={},counts={functions:0,classes:0,interfaces:0,typeAliases:0,variables:0,lines:0};
for(const file of files){const code=fs.readFileSync(file,'utf8');counts.lines+=code.split('\n').length; const ast=parseSync(file,code); if(ast.errors.length) throw Error(file+JSON.stringify(ast.errors));
function visit(n){if(!n||typeof n!=='object')return;if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type))counts.functions++;if(n.type==='ClassDeclaration')counts.classes++;if(n.type==='TSInterfaceDeclaration')counts.interfaces++;if(n.type==='TSTypeAliasDeclaration')counts.typeAliases++;if(n.type==='VariableDeclarator')counts.variables++;
if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(n.type)&&typeof n.source?.value==='string'){const s=n.source.value;const type=n.importKind==='type'||n.exportKind==='type'||(n.specifiers?.length>0&&n.specifiers.every(x=>x.importKind==='type'||x.exportKind==='type'));if(s.startsWith('.')){const to=path.posix.normalize(path.posix.join(path.posix.dirname(file),s)).replace(/\.js$/,'.ts');edges.push({from:file,to,kind:type?'type':n.type==='ImportExpression'?'dynamic':'runtime'});}else external[s]=(external[s]||0)+1;} for(const [k,v]of Object.entries(n)){if(k==='parent')continue;if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
visit(ast.program);nodes.push(file);}
const adj=new Map(nodes.map(n=>[n,[]]));for(const e of edges)if(e.kind==='runtime'&&adj.has(e.to))adj.get(e.from).push(e.to);
let i=0;const ids=new Map(),low=new Map(),stack=[],on=new Set(),scc=[];function dfs(v){ids.set(v,i);low.set(v,i++);stack.push(v);on.add(v);for(const w of adj.get(v)){if(!ids.has(w)){dfs(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(on.has(w))low.set(v,Math.min(low.get(v),ids.get(w)));}if(low.get(v)===ids.get(v)){const c=[];let w;do{w=stack.pop();on.delete(w);c.push(w);}while(w!==v);if(c.length>1)scc.push(c);}}nodes.forEach(n=>{if(!ids.has(n))dfs(n);});
const rank=direction=>nodes.map(n=>({file:n,count:edges.filter(e=>e.kind==='runtime'&&e[direction]===n).length})).sort((a,b)=>b.count-a.count).slice(0,12);
const result={files:files.length,counts,edgeCounts:Object.fromEntries(['runtime','type','dynamic'].map(k=>[k,edges.filter(e=>e.kind===k).length])),runtimeCycles:scc,fanOut:rank('from'),fanIn:rank('to'),external,edges};
fs.writeFileSync(new URL('./dependency-graph.json', import.meta.url),JSON.stringify(result,null,2));delete result.edges;console.log(JSON.stringify(result,null,2));
